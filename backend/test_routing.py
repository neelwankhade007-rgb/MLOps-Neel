"""Routing strategy configuration and authenticated API coverage."""

import os
from types import SimpleNamespace

from routing import (
    RoutingConfig,
    STRATEGY_NATIVE,
    STRATEGY_ROUND_ROBIN,
    STRATEGY_WEIGHTED_ROUND_ROBIN,
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
    assert config.to_dict()["supported_strategies"] == [
        STRATEGY_NATIVE, STRATEGY_ROUND_ROBIN, STRATEGY_WEIGHTED_ROUND_ROBIN
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
        invalid = client.put(
            "/api/v1/inference-monitoring/routing-strategy", json={"strategy": "unknown"}
        )
        assert invalid.status_code == 422
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        routing_config.set_strategy(STRATEGY_ROUND_ROBIN)
