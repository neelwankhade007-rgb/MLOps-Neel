# MLOps Inference Gateway

Round-robin routing gateway for distributing prediction requests across inference replicas.

## Architecture

The gateway sits between the backend and inference replicas:

```
Frontend → Backend → Gateway → Inference Replicas (3x)
                         ↓
                   Round Robin
```

## Features

- **Round-robin load balancing**: Distributes requests evenly across replicas
- **Dynamic endpoint discovery**: Discovers replica IPs via headless DNS (`inference-service-headless.mlops.svc.cluster.local`)
- **Automatic refresh**: Re-discovers endpoints every 10s to handle pod restarts
- **Concurrency-safe**: Thread-safe round-robin selection
- **Health/readiness probes**: Kubernetes integration
- **Timeout handling**: 10s upstream timeout with 504 response
- **Error propagation**: Preserves upstream HTTP status codes (400, 503, etc.)
- **Routing metadata**: Attaches `gateway_meta` with selected replica and latency

## Endpoints

- `POST /predict` - Forward prediction to next replica via round-robin
- `GET /health` - Liveness probe
- `GET /ready` - Readiness probe (503 if no replicas discovered)
- `GET /replicas` - List discovered replica endpoints

## Configuration

Environment variables:
- `HEADLESS_DNS` - Headless service DNS (default: `inference-service-headless.mlops.svc.cluster.local`)
- `INFERENCE_PORT` - Replica port (default: `8000`)
- `DISCOVERY_INTERVAL_S` - Refresh interval (default: `10`)

## Response Contract

The gateway forwards the upstream response and adds routing metadata:

```json
{
  "prediction": "Survived",
  "replica_id": "inference-service-abc123",
  "request_id": "req-xyz789",
  "latency_ms": 42.5,
  "gateway_meta": {
    "routing_strategy": "round_robin",
    "selected_replica": "http://10.244.0.5:8000",
    "gateway_latency_ms": 15.2
  }
}
```

## Testing

```bash
pytest gateway/test_gateway.py -v
```

Tests cover:
- Round-robin rotation across 3 replicas
- Concurrent request handling
- Endpoint discovery and membership changes
- Health/readiness behavior
- Response contract validation

## Deployment

```bash
# Build image
docker build -t mlops-gateway:latest gateway/

# Deploy to Kubernetes
kubectl apply -f kubernetes/workloads/07-gateway.yaml
```

Service: `inference-gateway.mlops.svc.cluster.local:8080`

## Integration

The backend forwards predictions to the gateway:

```python
GATEWAY_URL = os.environ.get("GATEWAY_URL", "http://inference-gateway:8080")

# Backend predict endpoint forwards to gateway
response = urllib.request.urlopen(f"{GATEWAY_URL}/predict", payload)
```

## Constraints

- **Round robin only** - No adaptive routing based on load/latency
- **No retries** - Failed requests are not retried to avoid duplication
- **Single replica gateway** - The gateway itself is not load-balanced (can be scaled if needed)
