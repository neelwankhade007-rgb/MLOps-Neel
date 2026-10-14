import os
import threading
from typing import Dict, Any, Tuple

STRATEGY_NATIVE = "native"
STRATEGY_ROUND_ROBIN = "round_robin"

STRATEGY_LABELS = {
    STRATEGY_NATIVE: "Native Kubernetes Service",
    STRATEGY_ROUND_ROBIN: "Round Robin",
}


class RoutingConfig:
    """
    Centralized, thread-safe routing strategy configuration shared between
    the backend prediction endpoint and telemetry test traffic harness.
    """

    def __init__(self):
        self._lock = threading.Lock()
        default_strat = os.environ.get("DEFAULT_ROUTING_STRATEGY", STRATEGY_ROUND_ROBIN).strip().lower().replace("-", "_")
        self._active_strategy = (
            STRATEGY_ROUND_ROBIN if default_strat in ("round_robin", "round robin", "rr") else STRATEGY_NATIVE
        )
        self.gateway_url = os.environ.get("GATEWAY_URL", "http://inference-gateway:8080").rstrip("/")
        self.native_url = os.environ.get("INFERENCE_SERVICE_URL", "http://inference-service:8000").rstrip("/")

    def get_strategy(self) -> str:
        """Returns the canonical strategy identifier ('native' or 'round_robin')."""
        with self._lock:
            return self._active_strategy

    def get_strategy_label(self) -> str:
        """Returns the human-readable strategy label."""
        with self._lock:
            return STRATEGY_LABELS.get(self._active_strategy, "Native Kubernetes Service")

    def set_strategy(self, strategy: str) -> str:
        """
        Validates and updates the active strategy.
        Accepts canonical and display names (case-insensitive).
        Returns canonical strategy name or raises ValueError.
        """
        if not isinstance(strategy, str):
            raise ValueError("Strategy must be a string")

        normalized = strategy.strip().lower().replace("-", "_")
        if normalized in ("native", "native_kubernetes_service", "native kubernetes service", "k8s"):
            canonical = STRATEGY_NATIVE
        elif normalized in ("round_robin", "round robin", "rr", "gateway"):
            canonical = STRATEGY_ROUND_ROBIN
        else:
            raise ValueError(
                f"Invalid routing strategy '{strategy}'. Supported strategies: 'native', 'round_robin'"
            )

        with self._lock:
            self._active_strategy = canonical
            return self._active_strategy

    def get_target_url(self) -> Tuple[str, str]:
        """
        Returns (target_predict_url, canonical_strategy) based on active strategy.
        """
        with self._lock:
            strat = self._active_strategy

        if strat == STRATEGY_ROUND_ROBIN:
            return f"{self.gateway_url}/predict", STRATEGY_ROUND_ROBIN
        else:
            return f"{self.native_url}/predict", STRATEGY_NATIVE

    def to_dict(self) -> Dict[str, Any]:
        with self._lock:
            strat = self._active_strategy

        return {
            "strategy": strat,
            "strategy_label": STRATEGY_LABELS.get(strat, "Native Kubernetes Service"),
            "gateway_url": self.gateway_url,
            "native_url": self.native_url,
            "supported_strategies": [STRATEGY_NATIVE, STRATEGY_ROUND_ROBIN],
        }


# Global singleton instance
routing_config = RoutingConfig()
