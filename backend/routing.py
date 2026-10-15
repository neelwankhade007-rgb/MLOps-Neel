import os
import threading
from typing import Dict, Any, Tuple

STRATEGY_NATIVE = "native"
STRATEGY_ROUND_ROBIN = "round_robin"
STRATEGY_WEIGHTED_ROUND_ROBIN = "weighted_round_robin"

STRATEGY_LABELS = {
    STRATEGY_NATIVE: "Native Kubernetes Service",
    STRATEGY_ROUND_ROBIN: "Round Robin",
    STRATEGY_WEIGHTED_ROUND_ROBIN: "Weighted Round Robin",
}


class RoutingConfig:
    """
    Centralized, thread-safe routing strategy configuration shared between
    the backend prediction endpoint and telemetry test traffic harness.
    """

    def __init__(self):
        self._lock = threading.Lock()
        default_strat = os.environ.get("DEFAULT_ROUTING_STRATEGY", STRATEGY_ROUND_ROBIN).strip().lower().replace("-", "_")
        aliases = {
            "round_robin": STRATEGY_ROUND_ROBIN, "round robin": STRATEGY_ROUND_ROBIN,
            "rr": STRATEGY_ROUND_ROBIN, "weighted_round_robin": STRATEGY_WEIGHTED_ROUND_ROBIN,
            "weighted round robin": STRATEGY_WEIGHTED_ROUND_ROBIN, "wrr": STRATEGY_WEIGHTED_ROUND_ROBIN,
            "native": STRATEGY_NATIVE, "native_kubernetes_service": STRATEGY_NATIVE,
            "native kubernetes service": STRATEGY_NATIVE, "k8s": STRATEGY_NATIVE,
        }
        self._active_strategy = aliases.get(default_strat, STRATEGY_NATIVE)
        self.gateway_url = os.environ.get("GATEWAY_URL", "http://inference-gateway:8080").rstrip("/")
        self.native_url = os.environ.get("INFERENCE_SERVICE_URL", "http://inference-service:8000").rstrip("/")
        raw_weights = os.environ.get("WRR_WEIGHTS", "5,3,2")
        try:
            self.wrr_weights = [int(item.strip()) for item in raw_weights.split(",")]
        except (TypeError, ValueError):
            raise ValueError("WRR_WEIGHTS must be comma-separated positive integers")
        if not self.wrr_weights or any(weight <= 0 for weight in self.wrr_weights):
            raise ValueError("WRR_WEIGHTS must contain only positive integers")

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
        elif normalized in ("weighted_round_robin", "weighted round robin", "wrr"):
            canonical = STRATEGY_WEIGHTED_ROUND_ROBIN
        else:
            raise ValueError(
                f"Invalid routing strategy '{strategy}'. Supported strategies: 'native', 'round_robin', 'weighted_round_robin'"
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

        if strat in (STRATEGY_ROUND_ROBIN, STRATEGY_WEIGHTED_ROUND_ROBIN):
            return f"{self.gateway_url}/predict", strat
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
            "wrr_weights": list(self.wrr_weights),
            "supported_strategies": [STRATEGY_NATIVE, STRATEGY_ROUND_ROBIN, STRATEGY_WEIGHTED_ROUND_ROBIN],
        }


# Global singleton instance
routing_config = RoutingConfig()
