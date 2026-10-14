import os
import time
import logging
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, Request, Response, status

from router import RoundRobinRouter

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("gateway_service")

UPSTREAM_TIMEOUT_S = 10.0

app = FastAPI(
    title="MLOps Inference Gateway",
    description="Round-robin routing gateway for inference replicas",
    version="1.0.0",
)

router = RoundRobinRouter()


@app.on_event("startup")
def startup():
    router.start()


@app.on_event("shutdown")
def shutdown():
    router.stop()


# -- health / readiness ---------------------------------------------------

@app.get("/health")
def health():
    """Liveness probe – process is running."""
    return {"status": "healthy", "service": "inference-gateway"}


MODEL_RUN_ID = os.environ.get("MODEL_RUN_ID", "b0ca6d39e884422fa6fdb3471a2c1349")


@app.get("/ready")
def ready(response: Response):
    """Readiness probe – at least one inference replica is known."""
    if router.endpoint_count == 0:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {
            "status": "not_ready",
            "detail": "No inference replicas discovered",
        }
    return {
        "status": "ready",
        "available_replicas": router.endpoint_count,
        "model_run_id": router.model_run_id or MODEL_RUN_ID,
    }


# -- prediction proxy -----------------------------------------------------

@app.post("/predict")
async def predict(request: Request):
    """
    Forward a prediction request to the next inference replica via
    round-robin and return its response with routing metadata.
    """
    if router.endpoint_count == 0:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No inference replicas available",
        )

    # Validate model run consistency if caller requested a specific run
    expected_run_id = request.headers.get("X-Model-Run-ID")
    active_run_id = router.model_run_id or MODEL_RUN_ID
    if expected_run_id and expected_run_id != active_run_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Model run mismatch: request expects run '{expected_run_id}', but inference cluster serves '{active_run_id}'",
        )

    try:
        body = await request.body()
    except Exception:
        raise HTTPException(status_code=400, detail="Failed to read request body")

    t_start = time.perf_counter()
    max_attempts = min(2, max(1, router.endpoint_count))
    last_error: Optional[Exception] = None
    target: Optional[str] = None
    upstream_resp = None

    async with httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT_S) as client:
        for attempt in range(max_attempts):
            target = router.next_endpoint()
            if target is None:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="No inference replicas available",
                )

            url = f"{target}/predict"
            try:
                upstream_resp = await client.post(
                    url,
                    content=body,
                    headers={"Content-Type": "application/json"},
                )
                break  # Successfully communicated with replica
            except httpx.TimeoutException:
                raise HTTPException(
                    status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                    detail=f"Upstream replica timed out after {UPSTREAM_TIMEOUT_S}s",
                )
            except httpx.ConnectError as exc:
                last_error = exc
                logger.warning(
                    "Connection error to replica %s (attempt %d/%d): %s",
                    target, attempt + 1, max_attempts, exc
                )
                if attempt == max_attempts - 1:
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail=f"Failed to connect to replica at {target}: {exc}",
                    )
            except httpx.HTTPError as exc:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Upstream request failed: {exc}",
                )

    latency_ms = (time.perf_counter() - t_start) * 1000.0

    if upstream_resp is None:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"All replica connection attempts failed: {last_error}",
        )

    # Propagate upstream error status codes faithfully
    if upstream_resp.status_code >= 400:
        return Response(
            content=upstream_resp.content,
            status_code=upstream_resp.status_code,
            media_type="application/json",
        )

    # Successful response: merge upstream JSON with routing metadata
    try:
        upstream_data = upstream_resp.json()
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Invalid JSON from upstream replica",
        )

    # Attach routing metadata under a separate key so model output is untouched
    upstream_data["gateway_meta"] = {
        "routing_strategy": "round_robin",
        "selected_replica": upstream_data.get("replica_id", target),
        "target_endpoint": target,
        "upstream_latency_ms": upstream_data.get("latency_ms"),
        "gateway_latency_ms": round(latency_ms, 3),
        "model_run_id": active_run_id,
    }

    return upstream_data


# -- discovery info --------------------------------------------------------

@app.get("/replicas")
def list_replicas():
    """Return currently known replica endpoints."""
    return {
        "endpoints": router.endpoints,
        "count": router.endpoint_count,
    }
