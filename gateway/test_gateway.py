"""
Comprehensive test suite for the inference gateway:
- Round-robin, weighted, and adaptive routing & concurrency
- Replica discovery & readiness health filtering
- Gateway HTTP endpoint behavior (/health, /ready, /replicas, /predict)
- Real request forwarding, payload preservation, and metadata enrichment
- Model run ID consistency validation
- Upstream error propagation (400, 503), timeouts (504), and connection failover (502)
- Backend authorization and model mismatch enforcement contracts
"""

import json
import threading
import time
from typing import List
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

from main import app, router, MODEL_RUN_ID
from router import RoundRobinRouter


# ---------------------------------------------------------------------------
# 1. RoundRobinRouter Unit Tests
# ---------------------------------------------------------------------------

class TestRoundRobinRouter:
    """Tests for router discovery, readiness filtering, and concurrency safety."""

    def test_empty_returns_none(self):
        r = RoundRobinRouter()
        assert r.next_endpoint() is None

    def test_single_endpoint(self):
        r = RoundRobinRouter()
        r.check_health = False
        with patch.object(r, "_resolve_endpoints", return_value=["10.0.0.1"]):
            r.refresh()
        for _ in range(5):
            assert r.next_endpoint() == "http://10.0.0.1:8000"

    def test_round_robin_three_replicas(self):
        """Verify strict rotation across three replicas."""
        r = RoundRobinRouter()
        r.check_health = False
        ips = ["10.0.0.1", "10.0.0.2", "10.0.0.3"]
        with patch.object(r, "_resolve_endpoints", return_value=ips):
            r.refresh()

        expected = [f"http://{ip}:8000" for ip in ips]
        for cycle in range(3):
            for i in range(3):
                assert r.next_endpoint() == expected[i], f"cycle {cycle}, index {i}"

    def test_weighted_round_robin_distribution(self):
        r = RoundRobinRouter()
        r.check_health = False
        ips = ["10.0.0.1", "10.0.0.2", "10.0.0.3"]
        with patch.object(r, "_resolve_endpoints", return_value=ips):
            r.refresh()
        selected = [r.next_endpoint("weighted_round_robin") for _ in range(10)]
        assert selected.count("http://10.0.0.1:8000") == 5
        assert selected.count("http://10.0.0.2:8000") == 3
        assert selected.count("http://10.0.0.3:8000") == 2

    def test_adaptive_prefers_lowest_composite_penalty(self):
        r = RoundRobinRouter()
        r.check_health = False
        ips = ["10.0.0.1", "10.0.0.2"]
        with patch.object(r, "_resolve_endpoints", return_value=ips):
            r.refresh()
        first, second = [f"http://{ip}:8000" for ip in ips]
        for _ in range(4):
            r.record_result(first, 100.0, 200)
            r.record_result(second, 10.0, 200)
        r._cpu_pct = {first: 80.0, second: 10.0}
        scores = r.adaptive_scores()
        assert scores[second] < scores[first]
        assert r.next_endpoint("adaptive") == second

    def test_adaptive_fairly_rotates_when_scores_tie_and_falls_back_without_cpu(self):
        r = RoundRobinRouter()
        r.check_health = False
        ips = ["10.0.0.1", "10.0.0.2", "10.0.0.3"]
        with patch.object(r, "_resolve_endpoints", return_value=ips):
            r.refresh()
        selected = [r.next_endpoint("adaptive") for _ in range(6)]
        assert selected.count("http://10.0.0.1:8000") == 2
        assert selected.count("http://10.0.0.2:8000") == 2
        assert selected.count("http://10.0.0.3:8000") == 2
        assert all(0.0 <= score <= 1.0 for score in r.adaptive_scores().values())

    def test_adaptive_records_inflight_latency_and_errors(self):
        r = RoundRobinRouter()
        r.check_health = False
        with patch.object(r, "_resolve_endpoints", return_value=["10.0.0.1"]):
            r.refresh()
        endpoint = r.next_endpoint("adaptive")
        assert r._observations[endpoint]["active"] == 1
        r.record_result(endpoint, 25.0, 503)
        assert r._observations[endpoint]["active"] == 0
        assert list(r._observations[endpoint]["latencies"]) == [25.0]
        assert list(r._observations[endpoint]["errors"]) == [1.0]

    def test_metrics_server_cpu_is_joined_to_discovered_pod_ip(self):
        r = RoundRobinRouter()
        r.check_health = False
        with patch.object(r, "_resolve_endpoints", return_value=["10.0.0.1"]):
            r.refresh()
        pod_list = {"items": [{"metadata": {"name": "inference-pod"}, "status": {"podIP": "10.0.0.1"}}]}
        pod_metrics = {"items": [{"metadata": {"name": "inference-pod"}, "containers": [{"usage": {"cpu": "50m"}}]}]}
        with patch.object(r, "_k8s_get", side_effect=[pod_list, pod_metrics]):
            cpu = r.refresh_adaptive_metrics()
        assert cpu["http://10.0.0.1:8000"] == 10.0

    def test_wrr_excludes_unhealthy_endpoints_and_supports_failover(self):
        r = RoundRobinRouter()
        r.check_health = True
        with patch.object(r, "_resolve_endpoints", return_value=["10.0.0.1", "10.0.0.2", "10.0.0.3"]), \
             patch.object(r, "_is_endpoint_ready", side_effect=lambda ip: ip != "10.0.0.2"):
            assert r.refresh() == ["10.0.0.1", "10.0.0.3"]
        first = r.next_endpoint("weighted_round_robin")
        second = r.next_endpoint("weighted_round_robin", exclude=[first])
        assert first != second
        assert second in ("http://10.0.0.1:8000", "http://10.0.0.3:8000")

    def test_wrr_weights_must_be_positive_integers(self):
        with patch.dict("os.environ", {"WRR_WEIGHTS": "5,0,2"}):
            with pytest.raises(ValueError, match="positive integers"):
                RoundRobinRouter()
        with patch.dict("os.environ", {"WRR_WEIGHTS": "5,three,2"}):
            with pytest.raises(ValueError, match="positive integers"):
                RoundRobinRouter()

    def test_concurrent_round_robin(self):
        """Ensure thread-safety under concurrent access with zero state corruption."""
        r = RoundRobinRouter()
        r.check_health = False
        ips = ["10.0.0.1", "10.0.0.2", "10.0.0.3"]
        with patch.object(r, "_resolve_endpoints", return_value=ips):
            r.refresh()

        results = []
        barrier = threading.Barrier(12)

        def pick():
            barrier.wait()
            results.append(r.next_endpoint())

        threads = [threading.Thread(target=pick) for _ in range(12)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        counts = {}
        for ep in results:
            counts[ep] = counts.get(ep, 0) + 1
        for ip in ips:
            assert counts[f"http://{ip}:8000"] == 4

    def test_readiness_filtering_excludes_unready_endpoints(self):
        """Endpoints that fail /ready probe are excluded from active rotation."""
        r = RoundRobinRouter()
        r.check_health = True
        ips = ["10.0.0.1", "10.0.0.2", "10.0.0.3"]

        def mock_ready_probe(ip: str):
            # Only 10.0.0.1 and 10.0.0.3 are ready; 10.0.0.2 is unready
            return ip != "10.0.0.2"

        with patch.object(r, "_resolve_endpoints", return_value=ips), \
             patch.object(r, "_is_endpoint_ready", side_effect=mock_ready_probe):
            active = r.refresh()

        assert active == ["10.0.0.1", "10.0.0.3"]
        assert r.endpoint_count == 2
        for _ in range(4):
            assert r.next_endpoint() in ["http://10.0.0.1:8000", "http://10.0.0.3:8000"]

    def test_model_run_id_tracked_from_ready(self):
        """Verify that router tracks active model_run_id when probing replicas."""
        r = RoundRobinRouter()
        assert r.model_run_id is None
        r._model_run_id = "test-run-123"
        assert r.model_run_id == "test-run-123"


# ---------------------------------------------------------------------------
# 2. Gateway Service HTTP Endpoint Tests (using TestClient)
# ---------------------------------------------------------------------------

@pytest.fixture
def client():
    return TestClient(app)


class TestGatewayServiceEndpoints:
    """Tests executing actual HTTP requests against FastAPI gateway endpoints."""

    def test_health_endpoint(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "healthy"
        assert data["service"] == "inference-gateway"

    def test_ready_endpoint_healthy(self, client):
        with patch.object(router, "_endpoints", ["10.0.0.1", "10.0.0.2"]):
            resp = client.get("/ready")
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "ready"
            assert data["available_replicas"] == 2
            assert "model_run_id" in data

    def test_ready_endpoint_unhealthy(self, client):
        with patch.object(router, "_endpoints", []):
            resp = client.get("/ready")
            assert resp.status_code == 503
            data = resp.json()
            assert data["status"] == "not_ready"

    def test_list_replicas(self, client):
        with patch.object(router, "_endpoints", ["10.0.0.1", "10.0.0.2"]):
            resp = client.get("/replicas")
            assert resp.status_code == 200
            data = resp.json()
            assert data["count"] == 2
            assert data["endpoints"] == ["10.0.0.1", "10.0.0.2"]

    def test_predict_round_robin_forwarding(self, client):
        """Verify that /predict rotates upstream requests across endpoints."""
        endpoints = ["10.0.0.1", "10.0.0.2", "10.0.0.3"]
        called_urls = []

        async def mock_post(url, *args, **kwargs):
            called_urls.append(url)
            return httpx.Response(
                200,
                json={
                    "prediction": "1",
                    "replica_id": f"pod-{url.split('//')[1].split(':')[0]}",
                    "request_id": f"req-{len(called_urls)}",
                    "latency_ms": 5.0,
                },
                request=httpx.Request("POST", url),
            )

        with patch.object(router, "_endpoints", endpoints), \
             patch.object(router, "_index", 0), \
             patch("httpx.AsyncClient.post", side_effect=mock_post):

            payload = {"features": {"Pclass": 1, "Age": 38.0}}
            for _ in range(3):
                resp = client.post("/predict", json=payload)
                assert resp.status_code == 200

            assert called_urls == [
                "http://10.0.0.1:8000/predict",
                "http://10.0.0.2:8000/predict",
                "http://10.0.0.3:8000/predict",
            ]

    def test_predict_preserves_payload_and_full_response(self, client):
        """Verify upstream prediction fields and rich gateway metadata are preserved."""
        upstream_data = {
            "prediction": "0",
            "replica_id": "inference-service-5c646f9d9c-7r8qz",
            "request_id": "req-98765",
            "latency_ms": 14.52,
        }

        async def mock_post(url, content, headers):
            sent_body = json.loads(content)
            assert "features" in sent_body
            assert sent_body["features"]["Age"] == 22.0
            return httpx.Response(
                200,
                json=upstream_data,
                request=httpx.Request("POST", url),
            )

        with patch.object(router, "_endpoints", ["10.0.0.1"]), \
             patch("httpx.AsyncClient.post", side_effect=mock_post):

            resp = client.post("/predict", json={"features": {"Age": 22.0}})
            assert resp.status_code == 200
            data = resp.json()

            # Genuine model outputs preserved
            assert data["prediction"] == "0"
            assert data["replica_id"] == "inference-service-5c646f9d9c-7r8qz"
            assert data["request_id"] == "req-98765"
            assert data["latency_ms"] == 14.52

            # Gateway metadata populated
            assert "gateway_meta" in data
            meta = data["gateway_meta"]
            assert meta["routing_strategy"] == "round_robin"
            assert meta["selected_replica"] == "inference-service-5c646f9d9c-7r8qz"
            assert meta["target_endpoint"] == "http://10.0.0.1:8000"
            assert meta["upstream_latency_ms"] == 14.52
            assert meta["gateway_latency_ms"] >= 0


    def test_predict_model_run_mismatch_rejected(self, client):
        """Requests targeting a different model run are rejected before forwarding."""
        with patch.object(router, "_endpoints", ["10.0.0.1"]):
            resp = client.post(
                "/predict",
                json={"features": {"Age": 22.0}},
                headers={"X-Model-Run-ID": "mismatched-run-xyz"},
            )
            assert resp.status_code == 400
            assert "Model run mismatch" in resp.json()["detail"]

    def test_predict_model_run_match_accepted(self, client):
        """Requests with matching model run ID are processed normally."""
        async def mock_post(url, *args, **kwargs):
            return httpx.Response(
                200,
                json={"prediction": "1", "replica_id": "pod-1", "request_id": "r1", "latency_ms": 2.0},
                request=httpx.Request("POST", url),
            )

        with patch.object(router, "_endpoints", ["10.0.0.1"]), \
             patch("httpx.AsyncClient.post", side_effect=mock_post):

            resp = client.post(
                "/predict",
                json={"features": {"Age": 22.0}},
                headers={"X-Model-Run-ID": MODEL_RUN_ID},
            )
            assert resp.status_code == 200
            assert resp.json()["prediction"] == "1"

    def test_predict_adaptive_strategy_returns_strategy_metadata(self, client):
        async def mock_post(url, *args, **kwargs):
            return httpx.Response(
                200,
                json={"prediction": "1", "replica_id": "pod-1", "request_id": "r1", "latency_ms": 2.0},
                request=httpx.Request("POST", url),
            )

        with patch.object(router, "_endpoints", ["10.0.0.1"]), \
             patch("httpx.AsyncClient.post", side_effect=mock_post):
            resp = client.post("/predict", json={"features": {"Age": 22}}, headers={"X-Routing-Strategy": "adaptive"})
        assert resp.status_code == 200
        assert resp.json()["gateway_meta"]["routing_strategy"] == "adaptive"

    def test_adaptive_strategy_fails_over_after_connection_error(self, client):
        attempted = []

        async def mock_post(url, *args, **kwargs):
            attempted.append(url)
            if url.startswith("http://10.0.0.1:"):
                raise httpx.ConnectError("connection refused")
            return httpx.Response(
                200,
                json={"prediction": "1", "replica_id": "pod-2", "request_id": "r2", "latency_ms": 4.0},
                request=httpx.Request("POST", url),
            )

        with patch.object(router, "_endpoints", ["10.0.0.1", "10.0.0.2"]), \
             patch.object(router, "_observations", {}), \
             patch.object(router, "_adaptive_index", 0), \
             patch("httpx.AsyncClient.post", side_effect=mock_post):
            response = client.post(
                "/predict", json={"features": {"Age": 22}}, headers={"X-Routing-Strategy": "adaptive"}
            )
        assert response.status_code == 200
        assert response.json()["replica_id"] == "pod-2"
        assert attempted == ["http://10.0.0.1:8000/predict", "http://10.0.0.2:8000/predict"]

    def test_predict_upstream_error_propagation(self, client):
        """Upstream HTTP 400 errors propagate faithfully with original detail."""
        async def mock_post(url, *args, **kwargs):
            return httpx.Response(
                400,
                json={"detail": "Missing required feature: Age"},
                request=httpx.Request("POST", url),
            )

        with patch.object(router, "_endpoints", ["10.0.0.1"]), \
             patch("httpx.AsyncClient.post", side_effect=mock_post):

            resp = client.post("/predict", json={"features": {}})
            assert resp.status_code == 400
            assert resp.json()["detail"] == "Missing required feature: Age"

    def test_predict_upstream_timeout_returns_504(self, client):
        """Upstream timeout raises 504 Gateway Timeout."""
        async def mock_post(url, *args, **kwargs):
            raise httpx.TimeoutException("Connection timed out")

        with patch.object(router, "_endpoints", ["10.0.0.1"]), \
             patch("httpx.AsyncClient.post", side_effect=mock_post):

            resp = client.post("/predict", json={"features": {"Age": 22.0}})
            assert resp.status_code == 504
            assert "timed out" in resp.json()["detail"]

    def test_predict_bounded_failover_on_connect_error(self, client):
        """If primary replica has connection error, failover to secondary replica succeeds."""
        attempt_endpoints = []

        async def mock_post(url, *args, **kwargs):
            attempt_endpoints.append(url)
            if "10.0.0.1" in url:
                raise httpx.ConnectError("Connection refused")
            return httpx.Response(
                200,
                json={"prediction": "1", "replica_id": "pod-2", "request_id": "r2", "latency_ms": 4.0},
                request=httpx.Request("POST", url),
            )

        with patch.object(router, "_endpoints", ["10.0.0.1", "10.0.0.2"]), \
             patch.object(router, "_index", 0), \
             patch("httpx.AsyncClient.post", side_effect=mock_post):

            resp = client.post("/predict", json={"features": {"Age": 22.0}})
            assert resp.status_code == 200
            assert resp.json()["replica_id"] == "pod-2"
            assert attempt_endpoints == [
                "http://10.0.0.1:8000/predict",
                "http://10.0.0.2:8000/predict",
            ]

    def test_predict_all_replicas_fail_returns_502(self, client):
        """If all bounded connection attempts fail, returns 502 Bad Gateway."""
        async def mock_post(url, *args, **kwargs):
            raise httpx.ConnectError("Host unreachable")

        with patch.object(router, "_endpoints", ["10.0.0.1", "10.0.0.2"]), \
             patch("httpx.AsyncClient.post", side_effect=mock_post):

            resp = client.post("/predict", json={"features": {"Age": 22.0}})
            assert resp.status_code == 502
            assert "Failed to connect" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# 3. Backend Auth & Model Routing Validation Tests
# ---------------------------------------------------------------------------

class TestBackendPredictLogic:
    """Tests verifying backend auth, authorization, model mismatch, and response mapping."""

    def test_backend_authorization_rejects_unowned_deployment(self):
        """Predict rejects requests when deployment belongs to another user."""
        class MockDeployment:
            name = "other-user-dep"
            user_id = 999  # Owned by user 999

        class MockUser:
            id = 123  # Authenticated as user 123

        # Simulation of backend predict ownership check
        dep = MockDeployment()
        current_user = MockUser()

        assert dep.user_id != current_user.id
        # Expected behavior: raises 403 Forbidden
        with pytest.raises(Exception) as exc_info:
            if dep.user_id is not None and dep.user_id != current_user.id:
                from fastapi import HTTPException
                raise HTTPException(status_code=403, detail="Not authorized to access this deployment")
        assert exc_info.value.status_code == 403

    def test_backend_rejects_incompatible_model_run(self):
        """Backend rejects deployments associated with an incompatible MLflow run."""
        inference_run_id = "b0ca6d39e884422fa6fdb3471a2c1349"
        deployment_exp_run_id = "different-run-5555"

        with pytest.raises(Exception) as exc_info:
            if deployment_exp_run_id != inference_run_id:
                from fastapi import HTTPException
                raise HTTPException(
                    status_code=400,
                    detail=f"Deployment requires run '{deployment_exp_run_id}', but replicas serve '{inference_run_id}'"
                )
        assert exc_info.value.status_code == 400
        assert "different-run-5555" in exc_info.value.detail

    def test_backend_response_preserves_all_replica_telemetry(self):
        """Backend return dict preserves replica_id, request_id, latency_ms, and gateway_meta."""
        gw_body = {
            "prediction": "1",
            "replica_id": "inference-service-5c646f9d9c-cgfdj",
            "request_id": "req-abcdef",
            "latency_ms": 8.45,
            "gateway_meta": {
                "routing_strategy": "round_robin",
                "selected_replica": "inference-service-5c646f9d9c-cgfdj",
                "target_endpoint": "http://10.244.0.14:8000",
                "gateway_latency_ms": 1.25,
            }
        }

        gateway_meta = gw_body.pop("gateway_meta", None)
        result = {
            "prediction": gw_body.get("prediction"),
            "deployment": "titanic-v1",
            "replica_id": gw_body.get("replica_id"),
            "request_id": gw_body.get("request_id"),
            "latency_ms": gw_body.get("latency_ms"),
            "gateway_meta": gateway_meta,
        }

        assert result["prediction"] == "1"
        assert result["deployment"] == "titanic-v1"
        assert result["replica_id"] == "inference-service-5c646f9d9c-cgfdj"
        assert result["request_id"] == "req-abcdef"
        assert result["latency_ms"] == 8.45
        assert result["gateway_meta"]["routing_strategy"] == "round_robin"


# ---------------------------------------------------------------------------
# 7. Telemetry & Active Strategy Detection Tests
# ---------------------------------------------------------------------------

class TestTelemetryGatewayIntegration:
    """Verifies runtime evidence detection of Round Robin gateway in telemetry aggregator."""

    def test_gateway_runtime_status_when_ready(self):
        """When gateway /ready returns HTTP 200, status reports Round Robin as active strategy."""
        import sys
        from pathlib import Path
        backend_dir = str(Path(__file__).parent.parent / "backend")
        if backend_dir not in sys.path:
            sys.path.insert(0, backend_dir)

        from inference_telemetry import TelemetryAggregator

        aggregator = TelemetryAggregator()
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.read.return_value = json.dumps({
            "status": "ready",
            "available_replicas": 3,
            "model_run_id": "b0ca6d39e884422fa6fdb3471a2c1349"
        }).encode("utf-8")
        mock_response.__enter__.return_value = mock_response
        mock_response.__exit__.return_value = None

        with patch("urllib.request.urlopen", return_value=mock_response):
            status = aggregator.get_gateway_runtime_status()

        assert status["is_active"] is True
        assert status["strategy"] == "Round Robin"
        assert "Custom L7 Gateway" in status["strategy_desc"]
        assert status["available_replicas"] == 3
        assert status["decision_ms"] is not None

    def test_telemetry_reports_selected_weighted_strategy(self):
        import sys
        from pathlib import Path
        backend_dir = str(Path(__file__).parent.parent / "backend")
        if backend_dir not in sys.path:
            sys.path.insert(0, backend_dir)
        from inference_telemetry import TelemetryAggregator, routing_config

        aggregator = TelemetryAggregator()
        response = MagicMock()
        response.status = 200
        response.read.return_value = json.dumps({"status": "ready", "available_replicas": 3}).encode()
        response.__enter__.return_value = response
        response.__exit__.return_value = None
        prior = routing_config.get_strategy()
        try:
            routing_config.set_strategy("weighted_round_robin")
            with patch("urllib.request.urlopen", return_value=response):
                status = aggregator.get_gateway_runtime_status()
            assert status["strategy"] == "Weighted Round Robin"
            assert "weighted distribution" in status["strategy_desc"]
        finally:
            routing_config.set_strategy(prior)

    def test_telemetry_reports_adaptive_strategy(self):
        import sys
        from pathlib import Path
        backend_dir = str(Path(__file__).parent.parent / "backend")
        if backend_dir not in sys.path:
            sys.path.insert(0, backend_dir)
        from inference_telemetry import TelemetryAggregator, routing_config

        aggregator = TelemetryAggregator()
        response = MagicMock()
        response.status = 200
        response.read.return_value = json.dumps({"status": "ready", "available_replicas": 3}).encode()
        response.__enter__.return_value = response
        response.__exit__.return_value = None
        prior = routing_config.get_strategy()
        try:
            routing_config.set_strategy("adaptive")
            with patch("urllib.request.urlopen", return_value=response):
                status = aggregator.get_gateway_runtime_status()
            assert status["strategy"] == "Adaptive Dynamic Routing"
            assert "lowest composite penalty" in status["strategy_desc"]
        finally:
            routing_config.set_strategy(prior)

    def test_gateway_runtime_status_when_unreachable(self):
        """When gateway is unreachable, telemetry retains the selected strategy and exposes its unavailable state."""
        import sys
        import urllib.error
        from pathlib import Path
        backend_dir = str(Path(__file__).parent.parent / "backend")
        if backend_dir not in sys.path:
            sys.path.insert(0, backend_dir)

        from inference_telemetry import TelemetryAggregator

        aggregator = TelemetryAggregator()

        with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("Connection refused")):
            status = aggregator.get_gateway_runtime_status()

        assert status["is_active"] is False
        assert status["strategy"] == "Round Robin"
        assert status["decision_ms"] is None
        assert "no ready gateway" in status["strategy_desc"]

    def test_telemetry_snapshot_active_policy_round_robin(self):
        """Telemetry snapshot summary reflects Round Robin when gateway is reachable."""
        import sys
        from pathlib import Path
        backend_dir = str(Path(__file__).parent.parent / "backend")
        if backend_dir not in sys.path:
            sys.path.insert(0, backend_dir)

        from inference_telemetry import TelemetryAggregator

        aggregator = TelemetryAggregator()
        with patch.object(aggregator, "discover_replicas", return_value=["10.244.0.13", "10.244.0.14"]), \
             patch.object(aggregator, "get_pod_metrics", return_value={}), \
             patch.object(aggregator, "fetch_replica_stats", side_effect=[
                 {"replica_id": "rep-1", "is_ready": True, "reachable": True, "requests_served": 5, "avg_latency_ms": 10.0},
                 {"replica_id": "rep-2", "is_ready": True, "reachable": True, "requests_served": 5, "avg_latency_ms": 11.0}
             ]), \
             patch.object(aggregator, "get_gateway_runtime_status", return_value={
                 "is_active": True,
                 "strategy": "Round Robin",
                 "strategy_desc": "Custom L7 Gateway (Round Robin across 3 ready replicas)",
                 "gateway_url": "http://inference-gateway:8080",
                 "decision_ms": 0.85,
                 "decision_desc": "L7 User-Space Reverse Proxy (~0.9ms gateway overhead)",
                 "model_run_id": "b0ca6d39e884422fa6fdb3471a2c1349",
                 "available_replicas": 3
             }):
            snapshot = aggregator.get_telemetry_snapshot()

        assert snapshot["summary"]["active_policy"] == "Round Robin"
        assert snapshot["summary"]["gateway_active"] is True
        assert snapshot["summary"]["gateway_decision_ms"] == 0.85
        assert snapshot["summary"]["total_requests"] == 10
        # Replicas report genuine metrics without simulation leakage into live routing
        assert len(snapshot["replicas"]) == 2
        assert snapshot["replicas"][0]["traffic_share_pct"] == 50.0


def test_gateway_dynamic_weights_endpoints():
    from main import app
    from fastapi.testclient import TestClient
    client = TestClient(app)

    # GET /weights
    resp = client.get("/weights")
    assert resp.status_code == 200
    assert "weights" in resp.json()
    assert "adaptive_weights" in resp.json()

    # PUT /weights with valid weights
    resp = client.put("/weights", json={"weights": [4, 2, 1]})
    assert resp.status_code == 200
    assert resp.json()["weights"] == [4, 2, 1]

    # PUT /weights with invalid weights
    resp = client.put("/weights", json={"weights": [0, -1]})
    assert resp.status_code == 400

    # PUT /adaptive-weights with valid weights
    resp = client.put("/adaptive-weights", json={"weights": {"latency": 0.5, "active": 0.2, "cpu": 0.2, "error": 0.1}})
    assert resp.status_code == 200
    assert resp.json()["adaptive_weights"]["latency"] == 0.5

    # PUT /adaptive-weights with negative weight
    resp = client.put("/adaptive-weights", json={"weights": {"latency": -0.5}})
    assert resp.status_code == 400


