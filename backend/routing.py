import json
import os
import threading
import urllib.request
from typing import Dict, Any, Tuple, List, Optional

STRATEGY_NATIVE = "native"
STRATEGY_ROUND_ROBIN = "round_robin"
STRATEGY_WEIGHTED_ROUND_ROBIN = "weighted_round_robin"
STRATEGY_ADAPTIVE = "adaptive"

STRATEGY_LABELS = {
    STRATEGY_NATIVE: "Native Kubernetes Service",
    STRATEGY_ROUND_ROBIN: "Round Robin",
    STRATEGY_WEIGHTED_ROUND_ROBIN: "Weighted Round Robin",
    STRATEGY_ADAPTIVE: "Adaptive Dynamic Routing",
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
            "adaptive": STRATEGY_ADAPTIVE, "adaptive_dynamic_routing": STRATEGY_ADAPTIVE,
            "adaptive dynamic routing": STRATEGY_ADAPTIVE,
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
        self.adaptive_weights: Dict[str, float] = {
            "lat": 0.40,
            "req": 0.30,
            "cpu": 0.20,
            "err": 0.10,
        }

    def get_strategy(self) -> str:
        """Returns the canonical identifier for the active routing strategy."""
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
        elif normalized in ("adaptive", "adaptive_dynamic_routing", "adaptive dynamic routing"):
            canonical = STRATEGY_ADAPTIVE
        else:
            raise ValueError(
                f"Invalid routing strategy '{strategy}'. Supported strategies: 'native', 'round_robin', 'weighted_round_robin', 'adaptive'"
            )

        with self._lock:
            self._active_strategy = canonical
            return self._active_strategy

    def set_wrr_weights(self, weights: List[int]) -> List[int]:
        """
        Validates and updates Weighted Round Robin replica weights.
        Ensures non-empty list of positive integers.
        Synchronizes with gateway if available.
        """
        if not weights or not isinstance(weights, (list, tuple)):
            raise ValueError("wrr_weights must be a non-empty list of integers")
        parsed = []
        for w in weights:
            try:
                val = int(w)
                if val <= 0:
                    raise ValueError("Each weight must be a positive integer (> 0)")
                parsed.append(val)
            except (ValueError, TypeError):
                raise ValueError("wrr_weights must contain only positive integers")

        with self._lock:
            self.wrr_weights = list(parsed)

        # Notify gateway if running
        try:
            req_data = json.dumps({"weights": parsed}).encode("utf-8")
            req = urllib.request.Request(
                f"{self.gateway_url}/weights",
                data=req_data,
                headers={"Content-Type": "application/json"},
                method="PUT"
            )
            with urllib.request.urlopen(req, timeout=1.5):
                pass
        except Exception:
            pass

        return list(self.wrr_weights)

    def set_adaptive_weights(self, weights: Dict[str, float]) -> Dict[str, float]:
        """
        Validates and updates dynamic objective weights for adaptive routing.
        """
        if not isinstance(weights, dict):
            raise ValueError("adaptive_weights must be a dictionary")
        parsed = {}
        for k in ("lat", "req", "cpu", "err"):
            if k in weights:
                try:
                    val = float(weights[k])
                except (ValueError, TypeError):
                    raise ValueError(f"Weight '{k}' must be a float")
                if not (0.0 <= val <= 1.0):
                    raise ValueError(f"Weight '{k}' must be between 0.0 and 1.0")
                parsed[k] = val
            else:
                with self._lock:
                    parsed[k] = self.adaptive_weights.get(k, 0.25)

        with self._lock:
            self.adaptive_weights = parsed

        # Notify gateway if running
        try:
            gw_map = {
                "latency": parsed.get("lat", 0.40),
                "active": parsed.get("req", 0.30),
                "cpu": parsed.get("cpu", 0.20),
                "error": parsed.get("err", 0.10)
            }
            req_data = json.dumps({"weights": gw_map}).encode("utf-8")
            req = urllib.request.Request(
                f"{self.gateway_url}/adaptive-weights",
                data=req_data,
                headers={"Content-Type": "application/json"},
                method="PUT"
            )
            with urllib.request.urlopen(req, timeout=1.5):
                pass
        except Exception:
            pass

        return dict(self.adaptive_weights)

    def get_target_url(self) -> Tuple[str, str]:
        """
        Returns (target_predict_url, canonical_strategy) based on active strategy.
        """
        with self._lock:
            strat = self._active_strategy

        if strat in (STRATEGY_ROUND_ROBIN, STRATEGY_WEIGHTED_ROUND_ROBIN, STRATEGY_ADAPTIVE):
            return f"{self.gateway_url}/predict", strat
        else:
            return f"{self.native_url}/predict", STRATEGY_NATIVE

    def to_dict(self) -> Dict[str, Any]:
        with self._lock:
            strat = self._active_strategy
            wrr = list(self.wrr_weights)
            adaptive = dict(self.adaptive_weights)

        return {
            "strategy": strat,
            "strategy_label": STRATEGY_LABELS.get(strat, "Native Kubernetes Service"),
            "gateway_url": self.gateway_url,
            "native_url": self.native_url,
            "wrr_weights": wrr,
            "adaptive_weights": adaptive,
            "supported_strategies": [STRATEGY_NATIVE, STRATEGY_ROUND_ROBIN, STRATEGY_WEIGHTED_ROUND_ROBIN, STRATEGY_ADAPTIVE],
        }



# Global singleton instance
routing_config = RoutingConfig()
