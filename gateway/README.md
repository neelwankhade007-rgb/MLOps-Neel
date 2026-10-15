# MLOps Inference Gateway

Round-robin, weighted round-robin, and opt-in adaptive routing gateway for distributing prediction requests across inference replicas.

## Architecture

The gateway sits between the backend and inference replicas:

```
Frontend → Backend → Gateway → Inference Replicas (3x)
                         ↓
                 Selected L7 Strategy
```

## Features

- **Round-robin load balancing**: Distributes requests evenly across replicas
- **Adaptive dynamic routing**: Selects the ready replica with the lowest observed composite penalty
- **Dynamic endpoint discovery**: Discovers replica IPs via headless DNS (`inference-service-headless.mlops.svc.cluster.local`)
- **Automatic refresh**: Re-discovers endpoints every 10s to handle pod restarts
- **Concurrency-safe**: Thread-safe round-robin and smooth weighted round-robin selection
- **Health/readiness probes**: Kubernetes integration
- **Timeout handling**: 10s upstream timeout with 504 response
- **Error propagation**: Preserves upstream HTTP status codes (400, 503, etc.)
- **Routing metadata**: Attaches `gateway_meta` with selected replica and latency

## Endpoints

- `POST /predict` - Forward prediction to a ready replica; backend selects `round_robin`, `weighted_round_robin`, or `adaptive` with `X-Routing-Strategy`
- `GET /health` - Liveness probe
- `GET /ready` - Readiness probe (503 if no replicas discovered)
- `GET /replicas` - List discovered replica endpoints

## Configuration

Environment variables:
- `HEADLESS_DNS` - Headless service DNS (default: `inference-service-headless.mlops.svc.cluster.local`)
- `INFERENCE_PORT` - Replica port (default: `8000`)
- `DISCOVERY_INTERVAL_S` - Refresh interval (default: `10`)
- `ADAPTIVE_METRICS_INTERVAL_S` - CPU metric refresh interval (default: `5` seconds)

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

# Apply the gateway's namespace-scoped read-only pod/metrics permissions and config
kubectl apply -f kubernetes/config/04-gateway-rbac.yaml
kubectl apply -f kubernetes/config/01-configmap.yaml

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

Set `WRR_WEIGHTS` to comma-separated positive integers. The
default is `5,3,2` for three replicas. Weights apply in the sorted order of the current
ready endpoint list; unready endpoints are removed before assignment. Endpoints beyond the
configured list receive weight `1`.

## Constraints

- **Adaptive mode is opt-in** - When selected, the gateway picks the healthy replica with the lowest observed composite penalty, using 40% latency, 30% in-flight requests, 20% CPU, and 10% recent errors. CPU metrics refresh from Metrics Server every 5 seconds by default; missing metric dimensions are omitted and remaining weights are renormalized.
- **Bounded failover** - On connection failure, the gateway tries one alternate ready replica; it does not retry upstream HTTP responses
- **Single replica gateway** - The gateway itself is not load-balanced (can be scaled if needed)
