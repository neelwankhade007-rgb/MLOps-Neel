import os
import socket
import json
import ssl
import time
import logging
import threading
import urllib.request
from collections import deque
from typing import Any, Dict, List, Optional

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("gateway_service")

HEADLESS_DNS = os.environ.get(
    "HEADLESS_DNS", "inference-service-headless.mlops.svc.cluster.local"
)
INFERENCE_PORT = int(os.environ.get("INFERENCE_PORT", "8000"))
DISCOVERY_INTERVAL_S = float(os.environ.get("DISCOVERY_INTERVAL_S", "10"))
ADAPTIVE_METRICS_INTERVAL_S = max(1.0, float(os.environ.get("ADAPTIVE_METRICS_INTERVAL_S", "5")))
K8S_API_URL = "https://kubernetes.default.svc"
K8S_TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token"
K8S_CA_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
ADAPTIVE_WEIGHTS = {"latency": 0.40, "active": 0.30, "cpu": 0.20, "error": 0.10}


def _load_weights() -> List[int]:
    raw = os.environ.get("WRR_WEIGHTS", "5,3,2")
    try:
        weights = [int(item.strip()) for item in raw.split(",")]
    except (TypeError, ValueError):
        raise ValueError("WRR_WEIGHTS must be comma-separated positive integers")
    if not weights or any(weight <= 0 for weight in weights):
        raise ValueError("WRR_WEIGHTS must contain only positive integers")
    return weights


class RoundRobinRouter:
    """
    Concurrency-safe strategy router over dynamically discovered inference replicas.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._endpoints: List[str] = []
        self._index: int = 0
        self._weights = _load_weights()
        self._wrr_current: List[int] = []
        self._adaptive_index = 0
        self._observations: Dict[str, Dict[str, Any]] = {}
        self._cpu_pct: Dict[str, float] = {}
        self._metrics_lock = threading.Lock()
        self._stop_event = threading.Event()
        self._discovery_thread: Optional[threading.Thread] = None
        self._model_run_id: Optional[str] = None
        self.check_health: bool = os.environ.get("CHECK_HEALTH_ON_DISCOVERY", "true").lower() in ("true", "1", "yes")

    # -- discovery --------------------------------------------------------

    def _is_endpoint_ready(self, ip: str) -> bool:
        """Probe /ready endpoint of an inference replica."""
        url = f"http://{ip}:{INFERENCE_PORT}/ready"
        try:
            import urllib.request
            import json
            req = urllib.request.Request(url, headers={"User-Agent": "Gateway-Probe"})
            with urllib.request.urlopen(req, timeout=1.5) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode())
                    if data.get("status") == "ready":
                        if "run_id" in data and not self._model_run_id:
                            self._model_run_id = data["run_id"]
                        return True
        except Exception:
            pass
        return False

    def _resolve_endpoints(self) -> List[str]:
        """Resolve headless DNS to a sorted list of replica IPs."""
        try:
            _, _, ips = socket.gethostbyname_ex(HEADLESS_DNS)
            if ips:
                return sorted(ips)
        except socket.gaierror:
            logger.warning("DNS resolution failed for %s", HEADLESS_DNS)
        except Exception as exc:
            logger.warning("Endpoint discovery error: %s", exc)
        return []

    def refresh(self) -> List[str]:
        """Perform a single synchronous refresh and return the new list."""
        raw_ips = self._resolve_endpoints()
        if self.check_health and raw_ips:
            # Filter to only healthy, ready endpoints
            ready_ips = [ip for ip in raw_ips if self._is_endpoint_ready(ip)]
        else:
            ready_ips = raw_ips

        with self._lock:
            if ready_ips != self._endpoints:
                logger.info(
                    "Endpoints updated: %s -> %s", self._endpoints, ready_ips
                )
                self._endpoints = ready_ips
                self._wrr_current = [0] * len(ready_ips)
                self._adaptive_index = self._adaptive_index % max(1, len(ready_ips))
                ready_urls = {f"http://{ip}:{INFERENCE_PORT}" for ip in ready_ips}
                self._observations = {
                    url: self._observations.get(url, self._new_observation())
                    for url in ready_urls
                }
                self._cpu_pct = {url: value for url, value in self._cpu_pct.items() if url in ready_urls}
                # Reset index to stay within bounds
                if self._endpoints:
                    self._index = self._index % len(self._endpoints)
                else:
                    self._index = 0
            return list(self._endpoints)

    def _background_loop(self) -> None:
        last_discovery = time.monotonic()
        last_metrics = 0.0
        while not self._stop_event.is_set():
            now = time.monotonic()
            if now - last_discovery >= DISCOVERY_INTERVAL_S:
                try:
                    self.refresh()
                except Exception as exc:
                    logger.error("Background discovery failed: %s", exc)
                last_discovery = now
            if now - last_metrics >= ADAPTIVE_METRICS_INTERVAL_S:
                try:
                    self.refresh_adaptive_metrics()
                except Exception as exc:
                    logger.warning("Adaptive metrics refresh failed: %s", exc)
                last_metrics = now
            self._stop_event.wait(min(1.0, ADAPTIVE_METRICS_INTERVAL_S))

    def start(self) -> None:
        """Bootstrap endpoints and start background refresh."""
        self.refresh()
        self._discovery_thread = threading.Thread(
            target=self._background_loop, daemon=True, name="endpoint-discovery"
        )
        self._discovery_thread.start()
        logger.info("Endpoint discovery started (interval=%ss)", DISCOVERY_INTERVAL_S)

    def stop(self) -> None:
        self._stop_event.set()
        if self._discovery_thread:
            self._discovery_thread.join(timeout=5)

    # -- routing ----------------------------------------------------------

    @staticmethod
    def _new_observation() -> Dict[str, Any]:
        return {"latencies": deque(maxlen=50), "errors": deque(maxlen=50), "active": 0}

    def _k8s_get(self, path: str) -> Optional[dict]:
        if not os.path.exists(K8S_TOKEN_PATH):
            return None
        try:
            with open(K8S_TOKEN_PATH, "r", encoding="utf-8") as token_file:
                token = token_file.read().strip()
            request = urllib.request.Request(
                f"{K8S_API_URL}{path}",
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            )
            context = ssl.create_default_context()
            if os.path.exists(K8S_CA_PATH):
                context.load_verify_locations(cafile=K8S_CA_PATH)
            with urllib.request.urlopen(request, context=context, timeout=2.0) as response:
                return json.loads(response.read().decode())
        except Exception as exc:
            logger.debug("Kubernetes telemetry request failed: %s", exc)
            return None

    @staticmethod
    def _cpu_millicores(value: str) -> Optional[float]:
        try:
            if value.endswith("n"):
                return int(value[:-1]) / 1_000_000
            if value.endswith("u"):
                return int(value[:-1]) / 1_000
            if value.endswith("m"):
                return float(value[:-1])
            return float(value) * 1000
        except (TypeError, ValueError):
            return None

    def refresh_adaptive_metrics(self) -> Dict[str, float]:
        """Refresh pod CPU readings from Metrics Server, keyed by discovered endpoint URL."""
        pods = self._k8s_get("/api/v1/namespaces/mlops/pods?labelSelector=app%3Dinference-service")
        metrics = self._k8s_get("/apis/metrics.k8s.io/v1beta1/namespaces/mlops/pods")
        cpu_by_ip: Dict[str, float] = {}
        if pods and metrics:
            ip_to_name = {
                item.get("status", {}).get("podIP"): item.get("metadata", {}).get("name")
                for item in pods.get("items", [])
                if item.get("status", {}).get("podIP") and item.get("metadata", {}).get("name")
            }
            for item in metrics.get("items", []):
                pod_name = item.get("metadata", {}).get("name")
                pod_ip = next((ip for ip, name in ip_to_name.items() if name == pod_name), None)
                if not pod_ip:
                    continue
                total_millicores = 0.0
                valid = True
                for container in item.get("containers", []):
                    value = self._cpu_millicores(container.get("usage", {}).get("cpu", ""))
                    if value is None:
                        valid = False
                        break
                    total_millicores += value
                if valid:
                    # Match the existing telemetry model: inference pod CPU limit is 500m.
                    cpu_by_ip[pod_ip] = min(100.0, total_millicores / 500.0 * 100.0)

        with self._metrics_lock:
            with self._lock:
                ready_ips = list(self._endpoints)
                self._cpu_pct = {
                    f"http://{ip}:{INFERENCE_PORT}": cpu_by_ip[ip]
                    for ip in ready_ips if ip in cpu_by_ip
                }
                return dict(self._cpu_pct)

    def _adaptive_scores_locked(self) -> Dict[str, float]:
        endpoints = [f"http://{ip}:{INFERENCE_PORT}" for ip in self._endpoints]
        if not endpoints:
            return {}
        rows = {}
        for endpoint in endpoints:
            observation = self._observations.setdefault(endpoint, self._new_observation())
            latencies = list(observation["latencies"])
            errors = list(observation["errors"])
            rows[endpoint] = {
                "latency": sum(latencies) / len(latencies) if latencies else None,
                "active": int(observation["active"]),
                "cpu": self._cpu_pct.get(endpoint),
                "error": sum(errors) / len(errors) if errors else None,
            }

        available = {
            key: [row[key] for row in rows.values() if row[key] is not None]
            for key in ADAPTIVE_WEIGHTS
        }
        usable = {key: bool(values) for key, values in available.items()}
        if not any(usable.values()):
            usable["active"] = True
        weight_total = sum(ADAPTIVE_WEIGHTS[key] for key in usable if usable[key])
        scores = {endpoint: 0.0 for endpoint in endpoints}
        for key, weight in ADAPTIVE_WEIGHTS.items():
            if not usable[key]:
                continue
            values = available[key]
            maximum = max(values) if values else 0.0
            for endpoint, row in rows.items():
                value = row[key]
                # A missing sample is treated as the worst observed value, never as a free win.
                if value is None:
                    normalized = 1.0 if maximum > 0 else 0.0
                elif key == "cpu":
                    normalized = min(1.0, max(0.0, float(value) / 100.0))
                else:
                    normalized = min(1.0, max(0.0, float(value) / maximum)) if maximum > 0 else 0.0
                scores[endpoint] += (weight / weight_total) * normalized
        return scores

    def adaptive_scores(self) -> Dict[str, float]:
        with self._lock:
            return dict(self._adaptive_scores_locked())

    def next_endpoint(self, strategy: str = "round_robin", exclude: Optional[List[str]] = None) -> Optional[str]:
        """Select a ready endpoint by RR, WRR, or lowest healthy-replica penalty."""
        with self._lock:
            if not self._endpoints:
                return None
            excluded = set(exclude or [])
            count = len(self._endpoints)
            weights = [self._weights[i] if i < len(self._weights) else 1 for i in range(count)]
            if len(self._wrr_current) != count:
                self._wrr_current = [0] * count
            for _ in range(count):
                if strategy == "weighted_round_robin":
                    total = sum(weights)
                    for i, weight in enumerate(weights):
                        self._wrr_current[i] += weight
                    index = max(range(count), key=lambda i: self._wrr_current[i])
                    self._wrr_current[index] -= total
                elif strategy == "adaptive":
                    scores = self._adaptive_scores_locked()
                    candidates = [i for i, ip in enumerate(self._endpoints) if f"http://{ip}:{INFERENCE_PORT}" not in excluded]
                    if not candidates:
                        return None
                    lowest = min(scores.get(f"http://{self._endpoints[i]}:{INFERENCE_PORT}", 0.0) for i in candidates)
                    tied = [i for i in candidates if abs(scores.get(f"http://{self._endpoints[i]}:{INFERENCE_PORT}", 0.0) - lowest) < 1e-9]
                    index = next((i for i in tied if i >= self._adaptive_index), tied[0])
                    self._adaptive_index = (index + 1) % count
                else:
                    index = self._index % count
                    self._index = (self._index + 1) % count
                ip = self._endpoints[index]
                url = f"http://{ip}:{INFERENCE_PORT}"
                if url not in excluded:
                    observation = self._observations.setdefault(url, self._new_observation())
                    observation["active"] = int(observation["active"]) + 1
                    return url
            return None

    def record_result(self, endpoint: str, latency_ms: float, status_code: Optional[int]) -> None:
        """Update rolling routing signals after a completed or failed upstream attempt."""
        with self._lock:
            if endpoint not in {f"http://{ip}:{INFERENCE_PORT}" for ip in self._endpoints}:
                return
            observation = self._observations.setdefault(endpoint, self._new_observation())
            observation["active"] = max(0, int(observation["active"]) - 1)
            observation["latencies"].append(max(0.0, float(latency_ms)))
            observation["errors"].append(1.0 if status_code is None or status_code < 200 or status_code >= 300 else 0.0)

    def set_weights(self, weights: List[int]) -> List[int]:
        if not weights or not isinstance(weights, (list, tuple)):
            raise ValueError("Weights must be a non-empty list of integers")
        parsed = []
        for w in weights:
            try:
                val = int(w)
                if val <= 0:
                    raise ValueError("Each weight must be a positive integer (> 0)")
                parsed.append(val)
            except (ValueError, TypeError):
                raise ValueError("Weights must contain only positive integers")
        with self._lock:
            self._weights = list(parsed)
            self._wrr_current = [0] * len(self._endpoints)
            return list(self._weights)

    def set_adaptive_weights(self, weights: Dict[str, float]) -> Dict[str, float]:
        if not isinstance(weights, dict):
            raise ValueError("Adaptive weights must be a dictionary")
        parsed = {}
        for k, v in weights.items():
            if k in ADAPTIVE_WEIGHTS:
                try:
                    val = float(v)
                except (ValueError, TypeError):
                    raise ValueError(f"Weight '{k}' must be a float")
                if not (0.0 <= val <= 1.0):
                    raise ValueError(f"Weight '{k}' must be between 0.0 and 1.0")
                parsed[k] = val
        with self._lock:
            for k, val in parsed.items():
                ADAPTIVE_WEIGHTS[k] = val
            return dict(ADAPTIVE_WEIGHTS)

    @property
    def endpoints(self) -> List[str]:
        with self._lock:
            return list(self._endpoints)

    @property
    def endpoint_count(self) -> int:
        with self._lock:
            return len(self._endpoints)

    @property
    def weights(self) -> List[int]:
        with self._lock:
            return list(self._weights)

    @property
    def cpu_metrics(self) -> Dict[str, float]:
        with self._lock:
            return dict(self._cpu_pct)

    @property
    def model_run_id(self) -> Optional[str]:
        return self._model_run_id

