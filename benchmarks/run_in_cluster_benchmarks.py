#!/usr/bin/env python3
"""
Orchestrates in-cluster Locust benchmarks via the ephemeral locust-runner pod,
targeting http://inference-service.mlops.svc.cluster.local:8000.
Records pre/post Prometheus counters, CPU/memory, and Locust metrics.
Saves results into benchmarks/results/cluster_service_dns/ to keep them
distinct from the port-forward baseline.
"""

import os
import sys
import time
import json
import csv
import subprocess
from datetime import datetime

RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results", "cluster_service_dns")
os.makedirs(RESULTS_DIR, exist_ok=True)

POD_NAME = "locust-runner"
NAMESPACE = "mlops"
TARGET_HOST = "http://inference-service.mlops.svc.cluster.local:8000"

PROFILES = [
    {
        "name": "cluster_smoke_test",
        "description": "Cluster Service-DNS Smoke Test (1 user, 10s)",
        "users": 1,
        "spawn_rate": 1,
        "duration": "10s",
        "duration_sec": 10
    },
    {
        "name": "cluster_light_load",
        "description": "Cluster Service-DNS Light Load (3 users, 30s)",
        "users": 3,
        "spawn_rate": 1,
        "duration": "30s",
        "duration_sec": 30
    },
    {
        "name": "cluster_moderate_load",
        "description": "Cluster Service-DNS Moderate Load (5 users, 30s)",
        "users": 5,
        "spawn_rate": 2,
        "duration": "30s",
        "duration_sec": 30
    }
]

def get_pod_resources():
    try:
        proc = subprocess.run(
            ["kubectl", "top", "pods", "-n", NAMESPACE, "--no-headers"],
            capture_output=True,
            text=True,
            timeout=10
        )
        resources = {}
        for line in proc.stdout.strip().splitlines():
            parts = line.split()
            if len(parts) >= 3 and "inference-service" in parts[0]:
                pod_name = parts[0]
                cpu_raw = parts[1]
                mem_raw = parts[2]
                resources[pod_name] = {
                    "cpu": cpu_raw,
                    "memory": mem_raw
                }
        return resources
    except Exception as e:
        return {"error": str(e)}

def get_prometheus_counts():
    try:
        cmd = [
            "kubectl", "exec", "-n", NAMESPACE, "deploy/prometheus", "--",
            "wget", "-qO-", "http://localhost:9090/api/v1/query?query=inference_requests_total"
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        data = json.loads(proc.stdout)
        counts = {}
        for item in data.get("data", {}).get("result", []):
            rep = item["metric"].get("replica_id")
            status = item["metric"].get("status")
            val = int(float(item["value"][1]))
            if rep:
                if rep not in counts:
                    counts[rep] = {}
                counts[rep][status] = val
        return counts
    except Exception as e:
        return {"error": str(e)}

def parse_locust_stats(local_csv_prefix):
    stats_file = f"{local_csv_prefix}_stats.csv"
    if not os.path.exists(stats_file):
        return {}

    summary = {}
    with open(stats_file, mode="r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get("Name") == "Aggregated":
                req_count = int(row.get("Request Count", 0))
                fail_count = int(row.get("Failure Count", 0))
                rps = float(row.get("Requests/s", 0.0))
                avg_lat = float(row.get("Average Response Time", 0.0))
                min_lat = float(row.get("Min Response Time", 0.0))
                max_lat = float(row.get("Max Response Time", 0.0))
                med_lat = float(row.get("Median Response Time", 0.0))
                summary = {
                    "requests": req_count,
                    "failures": fail_count,
                    "failure_rate_pct": round((fail_count / max(1, req_count)) * 100.0, 2),
                    "throughput_rps": rps,
                    "client_avg_ms": avg_lat,
                    "client_min_ms": min_lat,
                    "client_max_ms": max_lat,
                    "client_p50_ms": med_lat
                }
                for col in ["50%", "95%", "99%"]:
                    if col in row and row[col]:
                        summary[f"client_p{col.replace('%', '')}_ms"] = float(row[col])
                break
    return summary

def run_in_cluster_profile(profile):
    print("\n" + "=" * 75)
    print(f"RUNNING IN-CLUSTER PROFILE: {profile['description']}")
    print(f"Host: {TARGET_HOST} | Users: {profile['users']} | Duration: {profile['duration']}")
    print("=" * 75)

    # 1. Pre-test state
    pre_resources = get_pod_resources()
    pre_prom_counts = get_prometheus_counts()
    print("Pre-test Pod Resources:", pre_resources)
    print("Pre-test Prometheus Counts:", pre_prom_counts)

    # 2. Exec Locust inside pod
    pod_csv_prefix = f"/tmp/{profile['name']}"
    cmd = [
        "kubectl", "exec", "-n", NAMESPACE, POD_NAME, "--",
        "locust",
        "-f", "/tmp/locustfile.py",
        "--headless",
        "-u", str(profile["users"]),
        "-r", str(profile["spawn_rate"]),
        "-t", profile["duration"],
        "--host", TARGET_HOST,
        "--csv", pod_csv_prefix
    ]

    t0 = time.time()
    proc = subprocess.run(cmd, capture_output=True, text=True)
    duration_actual = time.time() - t0
    print(proc.stdout)
    if proc.stderr:
        print("Stderr:", proc.stderr)

    time.sleep(1) # Scrape settling

    # 3. Post-test state
    post_resources = get_pod_resources()
    post_prom_counts = get_prometheus_counts()

    # 4. Copy CSV results from pod to local RESULTS_DIR
    for suffix in ["_stats.csv", "_failures.csv", "_stats_history.csv", "_exceptions.csv"]:
        src = f"{NAMESPACE}/{POD_NAME}:{pod_csv_prefix}{suffix}"
        dst = os.path.join(RESULTS_DIR, f"{profile['name']}{suffix}")
        subprocess.run(["kubectl", "cp", src, dst], capture_output=True)

    # 5. Parse metrics
    local_csv_prefix = os.path.join(RESULTS_DIR, profile["name"])
    locust_metrics = parse_locust_stats(local_csv_prefix)

    # Calculate replica delta from Prometheus
    replica_delta = {}
    if isinstance(pre_prom_counts, dict) and isinstance(post_prom_counts, dict):
        for rep, stats in post_prom_counts.items():
            post_200 = stats.get("200", 0)
            pre_200 = pre_prom_counts.get(rep, {}).get("200", 0)
            replica_delta[rep] = max(0, post_200 - pre_200)

    total_delta = sum(replica_delta.values())
    traffic_distribution_pct = {}
    if total_delta > 0:
        for rep, count in replica_delta.items():
            traffic_distribution_pct[rep] = round((count / total_delta) * 100.0, 1)

    result_entry = {
        "profile": profile["name"],
        "description": profile["description"],
        "routing_target": TARGET_HOST,
        "benchmark_execution_environment": "In-Cluster Ephemeral Pod (locust-runner)",
        "timestamp_utc": datetime.utcnow().isoformat() + "Z",
        "concurrency_users": profile["users"],
        "spawn_rate": profile["spawn_rate"],
        "duration_configured": profile["duration"],
        "duration_actual_sec": round(duration_actual, 2),
        "locust_metrics": locust_metrics,
        "prometheus_replica_delta": replica_delta,
        "traffic_distribution_pct": traffic_distribution_pct,
        "pod_resources_before": pre_resources,
        "pod_resources_after": post_resources
    }

    return result_entry

def main():
    print("=" * 75)
    print("INITIATING IN-CLUSTER SERVICE-DNS BENCHMARK SUITE")
    print(f"Target Service DNS: {TARGET_HOST}")
    print("=" * 75)

    all_results = []
    for p in PROFILES:
        res = run_in_cluster_profile(p)
        all_results.append(res)
        time.sleep(3) # Cool-down between profiles

    summary_file = os.path.join(RESULTS_DIR, "cluster_service_dns_summary.json")
    with open(summary_file, "w", encoding="utf-8") as f:
        json.dump(all_results, f, indent=2)

    print("\n" + "=" * 75)
    print(f"IN-CLUSTER BENCHMARKS COMPLETE. Results saved to: {summary_file}")
    print("=" * 75)

if __name__ == "__main__":
    main()
