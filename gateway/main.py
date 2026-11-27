import os
import time
import logging
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, Request, Response, status

from benchmark_metrics import exposition, observe
from router import RoundRobinRouter

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("gateway_service")

UPSTREAM_TIMEOUT_S = 10.0

app = FastAPI(
    title="MLOps Inference Gateway",
    description="Inference gateway with round-robin, weighted, and adaptive routing",
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
        "wrr_weights": router.weights,
        "model_run_id": router.model_run_id or MODEL_RUN_ID,
    }


# -- prediction proxy -----------------------------------------------------

@app.get("/metrics", include_in_schema=False)
def metrics():
    return Response(exposition(), media_type="text/plain; version=0.0.4")


@app.post("/predict")
async def predict(request: Request):
    start = time.perf_counter_ns()
    upstream_ns = [0, 0]
    strategy = request.headers.get("X-Routing-Strategy", "round_robin").strip().lower()
    label = strategy if strategy in ("round_robin", "weighted_round_robin", "adaptive") else "invalid"
    outcome = "error"
    try:
        result = await forward_prediction(request, strategy, upstream_ns)
        if not isinstance(result, Response) or result.status_code < 400:
            outcome = "ok"
        return result
    finally:
        observe("handler_processing", label, outcome,
                time.perf_counter_ns() - start - upstream_ns[0])


async def post_upstream(client, url, body, strategy, upstream_ns):
    start = time.perf_counter_ns()
    outcome = "error"
    try:
        response = await client.post(url, content=body, headers={"Content-Type": "application/json"})
        outcome = "ok" if 200 <= response.status_code < 300 else "http_error"
        return response
    except httpx.TimeoutException:
        outcome = "timeout"
        raise
    except httpx.ConnectError:
        outcome = "connect_error"
        raise
    finally:
        elapsed = time.perf_counter_ns() - start
        upstream_ns[0] += elapsed
        upstream_ns[1] = elapsed
        observe("upstream_http", strategy, outcome, elapsed)


async def forward_prediction(request: Request, strategy: str, upstream_ns: list[int]):
    """
    Forward a prediction request using the selected gateway strategy.
    """
    if router.endpoint_count == 0:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No inference replicas available",
        )

    # Validate model run consistency if caller requested a specific run
    expected_run_id = request.headers.get("X-Model-Run-ID")
    if strategy not in ("round_robin", "weighted_round_robin", "adaptive"):
        raise HTTPException(status_code=400, detail="Unsupported gateway routing strategy")
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
    attempted: list[str] = []
    upstream_resp = None

    async with httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT_S) as client:
        for attempt in range(max_attempts):
            target = router.next_endpoint(strategy=strategy, exclude=attempted)
            if target is None:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="No inference replicas available",
                )

            url = f"{target}/predict"
            attempted.append(target)
            try:
                upstream_resp = await post_upstream(client, url, body, strategy, upstream_ns)
                router.record_result(target, upstream_ns[1] / 1e6, upstream_resp.status_code, strategy)
                break  # Successfully communicated with replica
            except httpx.TimeoutException:
                router.record_result(target, upstream_ns[1] / 1e6, None, strategy)
                raise HTTPException(
                    status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                    detail=f"Upstream replica timed out after {UPSTREAM_TIMEOUT_S}s",
                )
            except httpx.ConnectError as exc:
                router.record_result(target, upstream_ns[1] / 1e6, None, strategy)
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
                router.record_result(target, upstream_ns[1] / 1e6, None, strategy)
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
        "routing_strategy": strategy,
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


@app.get("/adaptive-scores")
def adaptive_scores():
    """Expose the scores and choice from the latest adaptive routing decision."""
    decision = router.last_adaptive_decision()
    return {
        "scores": decision["scores"],
        "selected_endpoint": decision["selected_endpoint"],
        "calculated_at": decision["calculated_at"],
    }


# -- weights and configuration --------------------------------------------

from pydantic import BaseModel


class WeightsPayload(BaseModel):
    weights: list[int]


class AdaptiveWeightsPayload(BaseModel):
    weights: dict[str, float]


@app.get("/weights")
def get_weights():
    return {
        "weights": router.weights,
        "wrr_weights": router.weights,
        "adaptive_weights": getattr(router, "adaptive_weights", {"latency": 0.4, "active": 0.3, "cpu": 0.2, "error": 0.1}),
    }


@app.put("/weights")
def update_weights(payload: WeightsPayload):
    try:
        updated = router.set_weights(payload.weights)
        return {"status": "ok", "weights": updated, "wrr_weights": updated}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.put("/adaptive-weights")
def update_adaptive_weights(payload: AdaptiveWeightsPayload):
    try:
        updated = router.set_adaptive_weights(payload.weights)
        return {"status": "ok", "adaptive_weights": updated}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
