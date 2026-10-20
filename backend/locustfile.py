"""Locust workload used by the authenticated dashboard load-test controls."""

import json
import os
import random
import tempfile
import time
from collections import Counter, deque
from datetime import datetime, timezone

import gevent
from gevent.lock import Semaphore
from locust import HttpUser, constant, events, task


TARGET_RPS = max(0.1, float(os.environ.get("LOCUST_TARGET_RPS", "1")))
REQUEST_LIMIT = max(1, int(os.environ.get("LOCUST_REQUEST_LIMIT", "50")))
DEPLOYMENT_NAME = os.environ.get("DEPLOYMENT_NAME", "").strip()
API_TOKEN = os.environ.get("LOCUST_API_TOKEN", "").strip()
METRICS_PATH = os.environ.get("LOCUST_METRICS_PATH", os.path.join(tempfile.gettempdir(), "locust-metrics.json"))
ROUTING_STRATEGY = os.environ.get("LOCUST_ROUTING_STRATEGY", "unknown")

PASSENGERS = [
    {"PassengerId": 1, "Pclass": 1, "Sex": "female", "Age": 38.0, "SibSp": 1, "Parch": 0, "Ticket": "PC 17599", "Fare": 71.2833, "Cabin": "C85", "Embarked": "C"},
    {"PassengerId": 2, "Pclass": 1, "Sex": "female", "Age": 35.0, "SibSp": 1, "Parch": 0, "Ticket": "113803", "Fare": 53.1, "Cabin": "C123", "Embarked": "S"},
    {"PassengerId": 3, "Pclass": 1, "Sex": "male", "Age": 54.0, "SibSp": 0, "Parch": 0, "Ticket": "17463", "Fare": 51.862, "Cabin": "E46", "Embarked": "S"},
    {"PassengerId": 4, "Pclass": 3, "Sex": "female", "Age": 4.0, "SibSp": 1, "Parch": 1, "Ticket": "PP 9549", "Fare": 16.7, "Cabin": "G6", "Embarked": "S"},
    {"PassengerId": 5, "Pclass": 1, "Sex": "female", "Age": 58.0, "SibSp": 0, "Parch": 0, "Ticket": "113783", "Fare": 26.55, "Cabin": "C103", "Embarked": "S"},
    {"PassengerId": 6, "Pclass": 2, "Sex": "male", "Age": 34.0, "SibSp": 0, "Parch": 0, "Ticket": "248698", "Fare": 13.0, "Cabin": "D56", "Embarked": "S"},
    {"PassengerId": 7, "Pclass": 1, "Sex": "male", "Age": 28.0, "SibSp": 0, "Parch": 0, "Ticket": "113788", "Fare": 35.5, "Cabin": "A6", "Embarked": "S"},
    {"PassengerId": 8, "Pclass": 1, "Sex": "female", "Age": 19.0, "SibSp": 3, "Parch": 2, "Ticket": "19950", "Fare": 263.0, "Cabin": "C23 C25 C27", "Embarked": "S"},
    {"PassengerId": 9, "Pclass": 1, "Sex": "female", "Age": 49.0, "SibSp": 0, "Parch": 0, "Ticket": "PC 17572", "Fare": 76.729, "Cabin": "D33", "Embarked": "C"},
    {"PassengerId": 10, "Pclass": 1, "Sex": "male", "Age": 65.0, "SibSp": 0, "Parch": 1, "Ticket": "113509", "Fare": 61.979, "Cabin": "B30", "Embarked": "C"},
]

_lock = Semaphore()
_next_slot = 0.0
_reserved = 0
_metrics = {"sent": 0, "success": 0, "failed": 0, "observed_rps": 0.0, "replica_distribution": {}, "events": []}
_request_times = deque()
_started_at = time.monotonic()
_environment = None


def _write_metrics():
    if not METRICS_PATH:
        return
    tmp_path = f"{METRICS_PATH}.tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8") as output:
            json.dump(_metrics, output)
        os.replace(tmp_path, METRICS_PATH)
    except OSError:
        pass


def _reserve_slot():
    """Reserve at most REQUEST_LIMIT requests and schedule a global RPS ceiling."""
    global _next_slot, _reserved
    with _lock:
        if _reserved >= REQUEST_LIMIT:
            return False
        _reserved += 1
        now = time.monotonic()
        scheduled = max(now, _next_slot)
        _next_slot = scheduled + 1.0 / TARGET_RPS
    gevent.sleep(max(0.0, scheduled - now))
    return True


def _record_request(response, started):
    elapsed_ms = round((time.monotonic() - started) * 1000.0, 2)
    status = response.status_code if response is not None else 0
    body = {}
    if response is not None and status == 200:
        try:
            body = response.json()
        except (ValueError, TypeError):
            body = {}

    success = status == 200 and "prediction" in body
    request_id = body.get("request_id") or f"locust-{time.time_ns()}"
    replica_id = body.get("replica_id") or "unknown"
    now = time.monotonic()
    with _lock:
        _metrics["sent"] += 1
        _metrics["success" if success else "failed"] += 1
        distribution = Counter(_metrics["replica_distribution"])
        if success:
            distribution[replica_id] += 1
        _metrics["replica_distribution"] = dict(distribution)
        _request_times.append(now)
        while _request_times and _request_times[0] < now - 5.0:
            _request_times.popleft()
        _metrics["observed_rps"] = round(len(_request_times) / min(5.0, max(1.0, now - _started_at)), 2)
        _metrics["events"] = ([{
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "request_id": request_id,
            "replica_id": replica_id,
            "prediction": body.get("prediction"),
            "latency_ms": body.get("latency_ms", elapsed_ms),
            "roundtrip_ms": elapsed_ms,
            "routing_strategy": ROUTING_STRATEGY,
            "status": status,
            "status_text": "200 OK" if success else f"HTTP {status or 'error'}",
            "traffic_type": "locust_dashboard",
        }] + _metrics["events"][:49])
        finished_at_limit = _metrics["sent"] >= REQUEST_LIMIT
        _write_metrics()

    if finished_at_limit:
        if _environment is not None and _environment.runner is not None:
            _environment.runner.quit()


@events.test_start.add_listener
def _on_test_start(environment, **kwargs):
    global _next_slot, _reserved, _metrics, _started_at, _environment
    with _lock:
        _environment = environment
        _next_slot = 0.0
        _reserved = 0
        _started_at = time.monotonic()
        _request_times.clear()
        _metrics = {"sent": 0, "success": 0, "failed": 0, "observed_rps": 0.0, "replica_distribution": {}, "events": []}
        _write_metrics()


@events.test_stop.add_listener
def _on_test_stop(environment, **kwargs):
    _write_metrics()


class DashboardInferenceUser(HttpUser):
    host = os.environ.get("TARGET_HOST", "http://127.0.0.1:8000")
    wait_time = constant(0)

    def on_start(self):
        if not DEPLOYMENT_NAME or not API_TOKEN:
            raise RuntimeError("Dashboard run must provide a deployment and authenticated API token")

    @task
    def predict(self):
        if not _reserve_slot():
            gevent.sleep(0.05)
            return

        started = time.monotonic()
        response = None
        try:
            with self.client.post(
                f"/api/v1/predict/{DEPLOYMENT_NAME}",
                json={"features": random.choice(PASSENGERS)},
                headers={"Authorization": f"Bearer {API_TOKEN}", "Content-Type": "application/json"},
                name="/api/v1/predict/[deployment]",
                catch_response=True,
                timeout=20,
            ) as response:
                try:
                    data = response.json()
                except (ValueError, TypeError):
                    data = {}
                if response.status_code == 200 and "prediction" in data:
                    response.success()
                else:
                    response.failure(f"HTTP {response.status_code}: {response.text[:100]}")
        except Exception:
            response = None
        finally:
            _record_request(response, started)
