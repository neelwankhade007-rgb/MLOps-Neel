"""Routing strategy configuration and authenticated API coverage."""

import os
from types import SimpleNamespace

from routing import (
    RoutingConfig,
    STRATEGY_NATIVE,
    STRATEGY_ROUND_ROBIN,
    STRATEGY_WEIGHTED_ROUND_ROBIN,
    STRATEGY_ADAPTIVE,
    routing_config,
)


def test_strategy_config_switches_between_all_routing_modes():
    config = RoutingConfig()
    assert config.set_strategy("native") == STRATEGY_NATIVE
    assert config.get_target_url()[1] == STRATEGY_NATIVE
    assert config.set_strategy("round robin") == STRATEGY_ROUND_ROBIN
    assert config.get_target_url()[1] == STRATEGY_ROUND_ROBIN
    assert config.set_strategy("wrr") == STRATEGY_WEIGHTED_ROUND_ROBIN
    assert config.get_target_url()[1] == STRATEGY_WEIGHTED_ROUND_ROBIN
    assert config.set_strategy("adaptive dynamic routing") == STRATEGY_ADAPTIVE
    assert config.get_target_url()[1] == STRATEGY_ADAPTIVE
    assert config.to_dict()["supported_strategies"] == [
        STRATEGY_NATIVE, STRATEGY_ROUND_ROBIN, STRATEGY_WEIGHTED_ROUND_ROBIN, STRATEGY_ADAPTIVE
    ]


def test_strategy_config_rejects_unknown_strategy():
    config = RoutingConfig()
    try:
        config.set_strategy("random")
    except ValueError:
        pass
    else:
        raise AssertionError("invalid strategy should fail validation")


def test_strategy_config_validates_and_exposes_positive_weights(monkeypatch):
    monkeypatch.setenv("WRR_WEIGHTS", "5,3,2")
    assert RoutingConfig().to_dict()["wrr_weights"] == [5, 3, 2]
    monkeypatch.setenv("WRR_WEIGHTS", "5,0,2")
    try:
        RoutingConfig()
    except ValueError as exc:
        assert "positive integers" in str(exc)
    else:
        raise AssertionError("zero weight should fail validation")


def test_strategy_api_requires_authentication_and_allows_authenticated_switching():
    import pytest
    pytest.importorskip("pandas", reason="backend API dependencies are not fully installed")
    os.environ.setdefault("DATABASE_URL", "sqlite://")
    from fastapi.testclient import TestClient
    from main import app, get_current_user
    client = TestClient(app)
    routing_config.set_strategy(STRATEGY_ROUND_ROBIN)
    assert client.get("/api/v1/inference-monitoring/routing-strategy").status_code == 401

    user = SimpleNamespace(id=42, username="router-user")
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        response = client.put(
            "/api/v1/inference-monitoring/routing-strategy",
            json={"strategy": STRATEGY_WEIGHTED_ROUND_ROBIN},
        )
        assert response.status_code == 200
        assert response.json()["strategy"] == STRATEGY_WEIGHTED_ROUND_ROBIN
        adaptive = client.put(
            "/api/v1/inference-monitoring/routing-strategy",
            json={"strategy": STRATEGY_ADAPTIVE},
        )
        assert adaptive.status_code == 200
        assert adaptive.json()["strategy"] == STRATEGY_ADAPTIVE
        invalid = client.put(
            "/api/v1/inference-monitoring/routing-strategy", json={"strategy": "unknown"}
        )
        assert invalid.status_code == 422
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        routing_config.set_strategy(STRATEGY_ROUND_ROBIN)


def test_wrr_weights_dynamic_configuration():
    config = RoutingConfig()
    updated = config.set_wrr_weights([4, 2, 1])
    assert updated == [4, 2, 1]
    assert config.wrr_weights == [4, 2, 1]
    assert config.to_dict()["wrr_weights"] == [4, 2, 1]

    # Reject non-positive or empty
    try:
        config.set_wrr_weights([])
    except ValueError as exc:
        assert "non-empty" in str(exc)
    else:
        raise AssertionError("Empty weights should fail")

    try:
        config.set_wrr_weights([3, 0, 1])
    except ValueError as exc:
        assert "positive integers" in str(exc)
    else:
        raise AssertionError("Zero weight should fail")


def test_adaptive_weights_dynamic_configuration():
    config = RoutingConfig()
    updated = config.set_adaptive_weights({"lat": 0.5, "req": 0.2, "cpu": 0.2, "err": 0.1})
    assert updated["lat"] == 0.5
    assert updated["err"] == 0.1
    assert config.adaptive_weights["lat"] == 0.5

    # Reject invalid weights
    try:
        config.set_adaptive_weights({"lat": -0.1, "req": 0.5, "cpu": 0.3, "err": 0.3})
    except ValueError as exc:
        assert "between 0.0 and 1.0" in str(exc)
    else:
        raise AssertionError("Negative weight should fail")

