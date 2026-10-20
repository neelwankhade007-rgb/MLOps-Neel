import os
import random
import logging
from collections import Counter
from locust import HttpUser, task, between, events

logger = logging.getLogger("locust_benchmark")

# Representative valid passenger profiles satisfying explicit_schema.json
VALID_PASSENGERS = [
    {
        "PassengerId": 1,
        "Pclass": 1,
        "Sex": "female",
        "Age": 38.0,
        "SibSp": 1,
        "Parch": 0,
        "Ticket": "PC 17599",
        "Fare": 71.2833,
        "Cabin": "C85",
        "Embarked": "C"
    },
    {
        "PassengerId": 2,
        "Pclass": 1,
        "Sex": "female",
        "Age": 35.0,
        "SibSp": 1,
        "Parch": 0,
        "Ticket": "113803",
        "Fare": 53.1000,
        "Cabin": "C123",
        "Embarked": "S"
    },
    {
        "PassengerId": 3,
        "Pclass": 1,
        "Sex": "male",
        "Age": 54.0,
        "SibSp": 0,
        "Parch": 0,
        "Ticket": "17463",
        "Fare": 51.8625,
        "Cabin": "E46",
        "Embarked": "S"
    },
    {
        "PassengerId": 4,
        "Pclass": 3,
        "Sex": "female",
        "Age": 4.0,
        "SibSp": 1,
        "Parch": 1,
        "Ticket": "PP 9549",
        "Fare": 16.7000,
        "Cabin": "G6",
        "Embarked": "S"
    },
    {
        "PassengerId": 5,
        "Pclass": 1,
        "Sex": "female",
        "Age": 58.0,
        "SibSp": 0,
        "Parch": 0,
        "Ticket": "113783",
        "Fare": 26.5500,
        "Cabin": "C103",
        "Embarked": "S"
    },
    {
        "PassengerId": 6,
        "Pclass": 2,
        "Sex": "male",
        "Age": 34.0,
        "SibSp": 0,
        "Parch": 0,
        "Ticket": "248698",
        "Fare": 13.0000,
        "Cabin": "D56",
        "Embarked": "S"
    },
    {
        "PassengerId": 7,
        "Pclass": 1,
        "Sex": "male",
        "Age": 28.0,
        "SibSp": 0,
        "Parch": 0,
        "Ticket": "113788",
        "Fare": 35.5000,
        "Cabin": "A6",
        "Embarked": "S"
    },
    {
        "PassengerId": 8,
        "Pclass": 1,
        "Sex": "female",
        "Age": 19.0,
        "SibSp": 3,
        "Parch": 2,
        "Ticket": "19950",
        "Fare": 263.0000,
        "Cabin": "C23 C25 C27",
        "Embarked": "S"
    },
    {
        "PassengerId": 9,
        "Pclass": 1,
        "Sex": "female",
        "Age": 49.0,
        "SibSp": 0,
        "Parch": 0,
        "Ticket": "PC 17572",
        "Fare": 76.7292,
        "Cabin": "D33",
        "Embarked": "C"
    },
    {
        "PassengerId": 10,
        "Pclass": 1,
        "Sex": "male",
        "Age": 65.0,
        "SibSp": 0,
        "Parch": 1,
        "Ticket": "113509",
        "Fare": 61.9792,
        "Cabin": "B30",
        "Embarked": "C"
    }
]

# Thread-safe in-memory metrics collectors
replica_distribution = Counter()
server_latencies = []

@events.test_start.add_listener
def on_test_start(environment, **kwargs):
    replica_distribution.clear()
    server_latencies.clear()

@events.test_stop.add_listener
def on_test_stop(environment, **kwargs):
    total = sum(replica_distribution.values())
    print("\n" + "=" * 60)
    print("LOCUST TEST SUMMARY — REPLICA DISTRIBUTION & SERVER LATENCY")
    print("=" * 60)
    print(f"Total Successful Sampled Responses: {total}")
    for rep, count in sorted(replica_distribution.items()):
        pct = (count / total * 100.0) if total > 0 else 0.0
        print(f"  - {rep}: {count} requests ({pct:.1f}%)")
    if server_latencies:
        s_sorted = sorted(server_latencies)
        p50 = s_sorted[int(len(s_sorted) * 0.50)]
        p95 = s_sorted[int(len(s_sorted) * 0.95)] if len(s_sorted) >= 5 else s_sorted[-1]
        p99 = s_sorted[int(len(s_sorted) * 0.99)] if len(s_sorted) >= 10 else s_sorted[-1]
        avg = sum(server_latencies) / len(server_latencies)
        print(f"Server-Side Model Latency: Avg={avg:.2f}ms | P50={p50:.2f}ms | P95={p95:.2f}ms | P99={p99:.2f}ms")
    print("=" * 60 + "\n")

class TitanicInferenceUser(HttpUser):
    # Target the authenticated backend route so requests use its active routing strategy.
    host = os.environ.get("TARGET_HOST", "http://localhost:8000")
    deployment_name = os.environ.get("DEPLOYMENT_NAME", "").strip()
    api_token = os.environ.get("LOCUST_API_TOKEN", "").strip()

    # Controlled pacing between requests (100ms - 400ms) to prevent flooding
    wait_time = between(0.1, 0.4)

    def on_start(self):
        if not self.deployment_name:
            raise RuntimeError("Set DEPLOYMENT_NAME to an existing deployment owned by the authenticated user")
        if not self.api_token:
            raise RuntimeError("Set LOCUST_API_TOKEN to a valid bearer token from /api/v1/auth/login")

    @task
    def predict(self):
        passenger = random.choice(VALID_PASSENGERS)
        payload = {"features": passenger}

        with self.client.post(
            f"/api/v1/predict/{self.deployment_name}",
            json=payload,
            headers={"Authorization": f"Bearer {self.api_token}", "Content-Type": "application/json"},
            name="/api/v1/predict/[deployment]",
            catch_response=True
        ) as response:
            if response.status_code == 200:
                try:
                    data = response.json()
                    if "prediction" in data:
                        response.success()
                        rep = data.get("replica_id", "unknown")
                        replica_distribution[rep] += 1
                        server_lat = data.get("latency_ms")
                        if server_lat is not None:
                            server_latencies.append(server_lat)
                    else:
                        response.failure("Missing 'prediction' key in response JSON")
                except Exception as e:
                    response.failure(f"JSON parse error: {e}")
            else:
                response.failure(f"HTTP {response.status_code}: {response.text[:100]}")