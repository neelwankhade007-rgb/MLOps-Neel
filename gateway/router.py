import os
import socket
import time
import logging
import threading
from typing import List, Optional

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("gateway_service")

HEADLESS_DNS = os.environ.get(
    "HEADLESS_DNS", "inference-service-headless.mlops.svc.cluster.local"
)
INFERENCE_PORT = int(os.environ.get("INFERENCE_PORT", "8000"))
DISCOVERY_INTERVAL_S = float(os.environ.get("DISCOVERY_INTERVAL_S", "10"))


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
    Concurrency-safe round-robin router over dynamically discovered
    inference replica endpoints.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._endpoints: List[str] = []
        self._index: int = 0
        self._weights = _load_weights()
        self._wrr_current: List[int] = []
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
                # Reset index to stay within bounds
                if self._endpoints:
                    self._index = self._index % len(self._endpoints)
                else:
                    self._index = 0
            return list(self._endpoints)

    def _background_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                self.refresh()
            except Exception as exc:
                logger.error("Background discovery failed: %s", exc)
            self._stop_event.wait(DISCOVERY_INTERVAL_S)

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

    def next_endpoint(self, strategy: str = "round_robin", exclude: Optional[List[str]] = None) -> Optional[str]:
        """Return the next endpoint URL, optionally using smooth weighted round-robin."""
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
                else:
                    index = self._index % count
                    self._index = (self._index + 1) % count
                ip = self._endpoints[index]
                url = f"http://{ip}:{INFERENCE_PORT}"
                if url not in excluded:
                    return url
            return None

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
        return list(self._weights)

    @property
    def model_run_id(self) -> Optional[str]:
        return self._model_run_id
