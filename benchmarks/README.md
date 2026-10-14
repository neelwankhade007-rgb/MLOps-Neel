# MLOps Inference Service Benchmarking Harness

This directory contains the reproducible Locust load-testing harness for benchmarking the three-replica Titanic inference service deployed on Kubernetes.

This benchmark establishes the **Native Kubernetes Service (ClusterIP L4 iptables)** baseline, against which subsequent routing policies (Round Robin, Weighted Round Robin, Adaptive Multi-Signal) will be compared.

---

## 1. Prerequisites

1. **Python 3.10+** with `locust` installed:
   ```powershell
   python -m pip install locust
   ```
2. **Kubernetes Port-Forward:**
   Ensure the inference service port-forward is active on port 8000:
   ```powershell
   kubectl port-forward -n mlops service/inference-service 8000:8000
   ```
   Verify readiness before testing:
   ```powershell
   curl.exe -s http://localhost:8000/health
   curl.exe -s http://localhost:8000/ready
   ```

---

## 2. Directory Structure

```
benchmarks/
├── locustfile.py      # Locust benchmark user and telemetry collection
├── README.md          # Exact instructions and profile documentation
└── results/           # Machine-readable output (CSV, JSON, summaries)
    ├── smoke_test_stats.csv
    ├── light_load_stats.csv
    ├── moderate_load_stats.csv
    └── baseline_summary.json
```

---

## 3. Configuration & Overrides

By default, the benchmark targets `http://localhost:8000`. You can configure the target URL without modifying code:

- **Via CLI flag:**
  ```powershell
  python -m locust -f benchmarks/locustfile.py --host http://localhost:8000 ...
  ```
- **Via Environment Variable:**
  ```powershell
  $env:TARGET_HOST = "http://localhost:8000"
  python -m locust -f benchmarks/locustfile.py ...
  ```

---

## 4. Benchmark Profiles

### Profile 1: Smoke Test (Verification)
- **Concurrency:** 1 user
- **Spawn rate:** 1 user/sec
- **Duration:** 10 seconds
- **Purpose:** Verify payload validity, end-to-end connectivity, and zero error rate.

```powershell
python -m locust -f benchmarks/locustfile.py --headless -u 1 -r 1 -t 10s --host http://localhost:8000 --csv benchmarks/results/smoke_test
```

### Profile 2: Light Load (Steady Baseline)
- **Concurrency:** 3 users (1 per replica)
- **Spawn rate:** 1 user/sec
- **Duration:** 30 seconds
- **Purpose:** Measure steady-state latency and initial request distribution under nominal traffic.

```powershell
python -m locust -f benchmarks/locustfile.py --headless -u 3 -r 1 -t 30s --host http://localhost:8000 --csv benchmarks/results/light_load
```

### Profile 3: Moderate Load (Multi-User Pressure)
- **Concurrency:** 5 users
- **Spawn rate:** 2 users/sec
- **Duration:** 30 seconds
- **Purpose:** Assess kernel L4 iptables connection balancing and latency percentiles under concurrent ingress.

```powershell
python -m locust -f benchmarks/locustfile.py --headless -u 5 -r 2 -t 30s --host http://localhost:8000 --csv benchmarks/results/moderate_load
```

---

## 5. Interpreting Results

### Client vs. Server Latency
- **Client Latency (Locust):** Measures full HTTP roundtrip time including TCP handshake, OS network stack, proxy/port-forward socket overhead, and client-side deserialization.
- **Server-Side Latency (`latency_ms`):** Returned in the response payload; measures the exact model prediction time inside `time.perf_counter()` on the serving container.

### Kubernetes ClusterIP Routing Characteristics
- Native Kubernetes ClusterIP utilizes in-kernel Netfilter iptables (or IPVS) connection tracking.
- Because HTTP client connections may be reused (keep-alive), requests through a single TCP stream may pin to one replica.
- The `locustfile.py` captures actual serving replica IDs (`replica_id`) from each response to accurately quantify routing uniformity.
