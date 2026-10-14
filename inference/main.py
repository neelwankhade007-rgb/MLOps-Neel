import os
import socket
import time
import logging
from typing import Dict, Any, Optional

from fastapi import FastAPI, HTTPException, Request, Response, status
from pydantic import BaseModel
import pandas as pd
import mlflow
import mlflow.pyfunc

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("inference_service")

# Service Configuration
REPLICA_ID = os.environ.get("HOSTNAME", socket.gethostname())
MODEL_RUN_ID = os.environ.get("MODEL_RUN_ID", "b0ca6d39e884422fa6fdb3471a2c1349")
MLFLOW_TRACKING_URI = os.environ.get("MLFLOW_TRACKING_URI", "http://mlflow:5000")

app = FastAPI(
    title="MLOps Dedicated Inference Service",
    description="High-performance replica-aware inference service for ML models",
    version="1.0.0"
)

import collections
import uuid
from datetime import datetime

# In-memory service state
model_artifact = None
explicit_schema: Optional[Dict[str, Any]] = None
is_ready = False
load_error: Optional[str] = None
request_counter = 0
success_counter = 0
error_counter = 0
active_requests = 0
total_latency_ms = 0.0
recent_latencies = collections.deque(maxlen=1000)
recent_requests = collections.deque(maxlen=30)

def get_percentile(data, p: float) -> float:
    if not data:
        return 0.0
    s = sorted(data)
    idx = int(len(s) * p)
    if idx >= len(s):
        idx = len(s) - 1
    return round(float(s[idx]), 3)

def load_artifacts():
    global model_artifact, explicit_schema, is_ready, load_error
    try:
        logger.info(f"Connecting to MLflow at {MLFLOW_TRACKING_URI} for run {MODEL_RUN_ID}...")
        mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)
        
        # Load explicit schema
        schema_path = f"runs:/{MODEL_RUN_ID}/explicit_schema.json"
        logger.info(f"Loading schema artifact from {schema_path}...")
        explicit_schema = mlflow.artifacts.load_dict(schema_path)
        
        # Load MLflow model
        model_uri = f"runs:/{MODEL_RUN_ID}/model"
        logger.info(f"Loading model artifact from {model_uri}...")
        model_artifact = mlflow.pyfunc.load_model(model_uri)
        
        is_ready = True
        load_error = None
        logger.info(f"Replica {REPLICA_ID}: Model and schema successfully loaded for run {MODEL_RUN_ID}.")
    except Exception as e:
        is_ready = False
        load_error = str(e)
        logger.error(f"Replica {REPLICA_ID}: Failed to load model artifacts: {e}", exc_info=True)

@app.on_event("startup")
def startup_event():
    load_artifacts()

@app.get("/health")
def health_check():
    """Liveness probe: verifies service process is running."""
    return {"status": "healthy", "replica_id": REPLICA_ID}

@app.get("/ready")
def readiness_check(response: Response):
    """Readiness probe: verifies model artifacts are loaded and ready for inference."""
    if not is_ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {
            "status": "not_ready",
            "replica_id": REPLICA_ID,
            "error": load_error or "Artifacts still loading"
        }
    return {
        "status": "ready",
        "replica_id": REPLICA_ID,
        "run_id": MODEL_RUN_ID
    }

@app.get("/stats")
def get_stats():
    """Returns local runtime metrics for this replica."""
    avg_latency = (total_latency_ms / request_counter) if request_counter > 0 else 0.0
    p50 = get_percentile(recent_latencies, 0.5)
    p95 = get_percentile(recent_latencies, 0.95)
    p99 = get_percentile(recent_latencies, 0.99)
    return {
        "replica_id": REPLICA_ID,
        "run_id": MODEL_RUN_ID,
        "is_ready": is_ready,
        "requests_served": request_counter,
        "requests_success": success_counter,
        "requests_error": error_counter,
        "active_requests": active_requests,
        "avg_latency_ms": round(avg_latency, 3),
        "p50_latency_ms": p50,
        "p95_latency_ms": p95,
        "p99_latency_ms": p99,
        "recent_requests": list(recent_requests)
    }

@app.get("/metrics")
def get_metrics():
    """Prometheus exposition format for replica telemetry scraping."""
    p50_s = get_percentile(recent_latencies, 0.5) / 1000.0
    p95_s = get_percentile(recent_latencies, 0.95) / 1000.0
    p99_s = get_percentile(recent_latencies, 0.99) / 1000.0
    total_dur_s = total_latency_ms / 1000.0

    lines = [
        "# HELP inference_requests_total Total number of inference requests",
        "# TYPE inference_requests_total counter",
        f'inference_requests_total{{replica_id="{REPLICA_ID}",status="200"}} {success_counter}',
        f'inference_requests_total{{replica_id="{REPLICA_ID}",status="500"}} {error_counter}',
        "# HELP inference_request_duration_seconds Latency summary of inference requests in seconds",
        "# TYPE inference_request_duration_seconds summary",
        f'inference_request_duration_seconds{{replica_id="{REPLICA_ID}",quantile="0.5"}} {p50_s:.4f}',
        f'inference_request_duration_seconds{{replica_id="{REPLICA_ID}",quantile="0.95"}} {p95_s:.4f}',
        f'inference_request_duration_seconds{{replica_id="{REPLICA_ID}",quantile="0.99"}} {p99_s:.4f}',
        f'inference_request_duration_seconds_sum{{replica_id="{REPLICA_ID}"}} {total_dur_s:.4f}',
        f'inference_request_duration_seconds_count{{replica_id="{REPLICA_ID}"}} {request_counter}',
        "# HELP inference_active_requests Number of requests currently being served",
        "# TYPE inference_active_requests gauge",
        f'inference_active_requests{{replica_id="{REPLICA_ID}"}} {active_requests}',
        "# HELP inference_replica_up Replica health and readiness status",
        "# TYPE inference_replica_up gauge",
        f'inference_replica_up{{replica_id="{REPLICA_ID}"}} {1 if is_ready else 0}'
    ]
    return Response(content="\n".join(lines) + "\n", media_type="text/plain; version=0.0.4; charset=utf-8")

@app.post("/predict")
async def predict(request: Request):
    """
    Inference endpoint:
    Accepts the original Titanic features, validates, applies one-hot encoding,
    reindexes to model schema, and returns prediction with replica ID and latency.
    """
    global request_counter, success_counter, error_counter, total_latency_ms, active_requests
    
    t_start = time.perf_counter()
    req_id = f"req-{uuid.uuid4().hex[:6]}"
    active_requests += 1
    
    try:
        if not is_ready or model_artifact is None or explicit_schema is None:
            # Try loading once more if previously failed
            load_artifacts()
            if not is_ready:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=f"Model artifact is not ready on replica {REPLICA_ID}: {load_error}"
                )

        try:
            payload = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON payload")

        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="Request body must be a JSON object")

        # Support either {"features": {...}} or direct feature dictionary
        if "features" in payload and isinstance(payload["features"], dict):
            raw_features = payload["features"]
        else:
            raw_features = payload

        features_schema = explicit_schema.get("features", [])
        validated_features: Dict[str, Any] = {}

        # 1. Validation & numeric conversion
        for feature in features_schema:
            fname = feature["name"]
            ftype = feature.get("type", "string")
            required = feature.get("required", False)

            if required and fname not in raw_features:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Missing required feature: {fname}"
                )

            if fname in raw_features:
                val = raw_features[fname]
                if ftype == "number":
                    if val is None or val == "":
                        validated_features[fname] = 0.0
                    elif not isinstance(val, (int, float)):
                        try:
                            validated_features[fname] = float(val)
                        except (ValueError, TypeError):
                            raise HTTPException(
                                status_code=status.HTTP_400_BAD_REQUEST,
                                detail=f"Invalid numeric value for {fname}: {val}"
                            )
                    else:
                        validated_features[fname] = float(val)
                elif ftype == "categorical":
                    options = feature.get("options")
                    str_val = str(val) if val is not None else ""
                    if options and len(options) > 0 and str_val not in options:
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Unknown categorical value for {fname}: {val}. Allowed: {options}"
                        )
                    validated_features[fname] = str_val
                else:
                    validated_features[fname] = val

        # 2. Preprocessing: DataFrame -> One-Hot Encoding -> Schema Alignment
        try:
            df = pd.DataFrame([validated_features])
            df_dummies = pd.get_dummies(df)

            expected_columns = explicit_schema.get("encoded_columns", [])
            if expected_columns:
                df_aligned = df_dummies.reindex(columns=expected_columns, fill_value=0)
            else:
                # Fallback if encoded_columns is missing
                if hasattr(model_artifact, '_model_impl') and hasattr(model_artifact._model_impl, 'sklearn_model'):
                    expected_columns = model_artifact._model_impl.sklearn_model.feature_names_in_
                    df_aligned = df_dummies.reindex(columns=expected_columns, fill_value=0)
                else:
                    df_aligned = df_dummies

            # 3. Model Inference
            raw_prediction = model_artifact.predict(df_aligned)
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Inference execution failed: {e}", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Inference execution failed: {str(e)}"
            )

        # 4. Format Output
        pred_val = raw_prediction[0].item() if hasattr(raw_prediction[0], 'item') else raw_prediction[0]
        classes = explicit_schema.get("classes")
        if classes and isinstance(pred_val, (int, float)) and int(pred_val) < len(classes):
            pred_output = str(classes[int(pred_val)])
        else:
            pred_output = str(pred_val)

        latency_ms = (time.perf_counter() - t_start) * 1000.0

        # Update runtime counters
        request_counter += 1
        success_counter += 1
        total_latency_ms += latency_ms
        recent_latencies.append(latency_ms)
        recent_requests.appendleft({
            "id": req_id,
            "timestamp": datetime.utcnow().strftime("%H:%M:%S.%f")[:-3],
            "replica_id": REPLICA_ID,
            "latency_ms": round(latency_ms, 2),
            "status": 200,
            "status_text": "200 OK"
        })

        return {
            "prediction": pred_output,
            "replica_id": REPLICA_ID,
            "request_id": req_id,
            "latency_ms": round(latency_ms, 3)
        }
    except HTTPException as he:
        latency_ms = (time.perf_counter() - t_start) * 1000.0
        request_counter += 1
        error_counter += 1
        total_latency_ms += latency_ms
        recent_latencies.append(latency_ms)
        recent_requests.appendleft({
            "id": req_id,
            "timestamp": datetime.utcnow().strftime("%H:%M:%S.%f")[:-3],
            "replica_id": REPLICA_ID,
            "latency_ms": round(latency_ms, 2),
            "status": he.status_code,
            "status_text": f"{he.status_code} {he.detail[:30]}"
        })
        raise
    except Exception as exc:
        latency_ms = (time.perf_counter() - t_start) * 1000.0
        request_counter += 1
        error_counter += 1
        total_latency_ms += latency_ms
        recent_latencies.append(latency_ms)
        recent_requests.appendleft({
            "id": req_id,
            "timestamp": datetime.utcnow().strftime("%H:%M:%S.%f")[:-3],
            "replica_id": REPLICA_ID,
            "latency_ms": round(latency_ms, 2),
            "status": 500,
            "status_text": "500 Internal Error"
        })
        raise
    finally:
        active_requests = max(0, active_requests - 1)

@app.get("/")
def root():
    return {
        "service": "inference-service",
        "replica_id": REPLICA_ID,
        "run_id": MODEL_RUN_ID,
        "is_ready": is_ready
    }
