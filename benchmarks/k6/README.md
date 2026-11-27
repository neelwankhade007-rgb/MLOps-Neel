# Nexus k6 benchmarking

Run from the repository root in PowerShell with Python 3.10+, Docker, Minikube, kubectl and k6 on the Windows host. The runner uses Python's standard library. Its Kubernetes context must be Minikube with read access to Pods, Pod proxy endpoints, Metrics Server, and the ConfigMap. Node proxy access is required for timestamped kubelet cAdvisor resource collection. Use an owned deployment whose model is already served by the three inference replicas. Read its name from the Deployments page. Reserve the test environment for the trial because routing strategy is shared across requests.

## Install and validate

```powershell
# Extract the checksum-verified official Windows AMD64 ZIP into D:/DevTools/k6.
$k6 = 'D:\DevTools\k6\k6.exe'
& $k6 version
& $k6 inspect benchmarks/k6/predict.js
python benchmarks/k6/run.py --validate-only
python benchmarks/k6/run.py --validate-only --plan chapter5 --restart-gateway --rates 1 2 3
python -m pytest gateway/test_gateway.py backend/test_routing.py benchmarks/k6/test_benchmark.py -q
```

The 1/2/3 RPS values above exercise the schedule validator offline. The synthetic rows match the required names, types and categorical values of the served MLflow artifact. Live preflight validates every row against the selected deployment's actual schema, and a smoke prediction per trial verifies the authenticated deployment, routing path and response metadata. Credentials are entered interactively by default. On Windows, pass `--credential-file D:/DevTools/Nexus/benchmark-credentials.dpapi.json` to use the dedicated account's Windows CurrentUser DPAPI record. This file must remain outside the repository and can be unlocked only by the Windows user who created it on this machine. The runner gives each k6 child a fresh bearer token through its environment.

## Deploy instrumentation when authorized

```powershell
kubectl config use-context minikube
minikube image build -t mlops-gateway:latest ./gateway
kubectl -n mlops rollout restart deployment/inference-gateway
kubectl -n mlops rollout status deployment/inference-gateway --timeout=180s
kubectl apply -f kubernetes/monitoring/01-prometheus.yaml
```

Run these in separate terminals and keep them open.

```powershell
kubectl -n mlops port-forward service/backend 8000:8000
kubectl -n mlops port-forward service/prometheus 9090:9090
```

Check that Kubernetes projected the new ConfigMap before reloading Prometheus. If the output has no match, wait for the volume update and rerun the check. Reloading preserves the monitoring process and its current data.

```powershell
kubectl -n mlops exec deployment/prometheus -- cat /etc/prometheus/prometheus.yml | Select-String 'job_name:.*inference-gateway'
kubectl -n mlops exec deployment/prometheus -- promtool check config /etc/prometheus/prometheus.yml
Invoke-WebRequest -UseBasicParsing -Method Post http://127.0.0.1:9090/-/reload
```

## Capacity discovery

Start at 5 scheduled arrivals/s per policy. Keep the terminal, path, corpus, concurrency and resource allocations fixed across candidates. Review host free memory before starting and monitor host CPU, pod readiness, throttling, timeout counts and generator drops. Stop with Ctrl+C on sustained pressure or instability and review partial artifacts before retrying. The runner restores the original backend policy after each trial and records restoration failures.

```powershell
$deployment = Read-Host 'Owned benchmark deployment name'
$k6 = 'D:\DevTools\k6\k6.exe'
python benchmarks/k6/run.py --plan pilot --rate 5 --restart-gateway --deployment $deployment --k6 $k6
python benchmarks/k6/analyze.py --input benchmarks/reports/pilot --capacity-only --output benchmarks/reports/pilot-review-5
```

The pilot defaults to 30 s warm-up, 60 s of measured arrivals and 20 s cooldown. Warm-up runs at the lower of 5 RPS and the trial rate. With `--restart-gateway`, each trial verifies a fresh gateway Pod, restores weights, and waits for telemetry before smoke and warm-up. A scrape boundary follows warm-up drain. Use plateaus at 10, 20, 40, 80, 160 and 320 RPS only as preceding evidence and headroom permit. Intermediate positive rates are accepted. Begin with the same 32 preallocated VUs throughout. If VUs need changing, rerun the accepted pilot rates at the new allocation. A ramp scout accepts explicit increasing rates through `--plan ramp --rates` and uses equally spaced segments. Qualifying capacity evidence comes from plateaus.

Capacity qualification requires a complete interval, zero drops and timeouts, a matched inference count by replica, at least 99% of offered requests successful, P95 at or below the preregistered ceiling (default 500 ms), and second-half P95 no higher than 125% of first-half P95 plus 20 ms. Review cAdvisor counters, sampled host/Tunnel pressure and errors before advancing even if the automated gate passes. Select three common rates that passed with all four policies. The formal runner verifies matching pilot evidence and the frozen environment signature for those rates. If the environment signature changes, collect new pilot evidence.

## Formal steady and burst trials

```powershell
$low = [int](Read-Host 'Validated low RPS')
$moderate = [int](Read-Host 'Validated moderate RPS')
$high = [int](Read-Host 'Validated high RPS')
python benchmarks/k6/run.py --plan chapter5 --restart-gateway --rates $low $moderate $high --capacity-input benchmarks/reports/pilot --deployment $deployment --k6 $k6
python benchmarks/k6/analyze.py --input benchmarks/reports/chapter5 --output benchmarks/reports/chapter5-analysis
```

Defaults are 60 s warm-up, 180 s measurement, 45 s cooldown and three repetitions. Override with `--warmup`, `--measurement`, `--cooldown` and `--repetitions`. The seed determines condition shuffling, policy rotation and payload offsets. The burst starts at the common low rate, ramps to the common high rate, then returns to low for recovery. Its segments are fixed in workloads.json. `--plan steady` restricts the suite to the 36 constant-rate trials. `chapter5` adds 12 burst trials. Use a fresh analysis directory when rebuilding reports.

Use `--restart-gateway` for the approved cold-state protocol and apply the same flag in follow-on formal plans that rely on that pilot evidence. Without the flag, the 120 s idle interval expires request freshness while rolling observations and EMA can carry over.

## Essential one-replica contention protocol

Run only after the intervention is authorized and calibrated. Keep the same three ready replicas, CPU limits, model, seed, request path and moderate arrival rate. Select a fixed replica slot and record its deployment Pod name and UID. Use a short-lived bounded CPU worker in that inference container so the worker shares its existing cgroup. Use one process with a fixed busy/sleep duty cycle and a monotonic deadline. Calibrate a fixed duty cycle for visible CPU/throttling separation while keeping the replica ready and preserving service. Record the duty cycle, process count, planned duration and the exact command or script hash. Confirm automatic exit and be prepared to terminate that specific process. Abort on Pod churn, readiness loss or sustained service degradation. Collect a matched undisturbed trial per policy and repetition.

The runner manages load and evidence while the operator or an approved controller manages the stimulus. For each contended trial, wait for `contention-signal.json` and the first request record's `scenario_start_ms`. Start the worker one third into measurement and stop it after one third of the interval. Write `intervention.json` in that trial folder before cooldown finishes with `pod`, `uid`, `stimulus`, `started_epoch`, `ended_epoch` and integer `exit_code`. Use the Windows runner clock for actual epoch timestamps. Analysis checks identity, exit and a three-second timing tolerance, and compares share before, during and after against the same windows of the matched controls.

```powershell
$pod = Read-Host 'Fixed target inference Pod'
$stimulus = Read-Host 'Approved fixed stimulus identifier'
python benchmarks/k6/run.py --plan contention --restart-gateway --rates $low $moderate $high --capacity-input benchmarks/reports/pilot --contention-pod $pod --stimulus $stimulus --output benchmarks/reports/chapter5/contention --deployment $deployment --k6 $k6
python benchmarks/k6/analyze.py --input benchmarks/reports/chapter5 --output benchmarks/reports/chapter5-with-contention
```

## Evidence and Chapter 5 outputs

Each suite contains frozen inputs and hashes, script and k6 versions, deployment/model/version, effective Minikube limits, replica slot/name/UID/IP, image IDs, resources, weights, strategy order, adaptive settings and archive provenance. Each trial contains raw warm-up and measurement k6 NDJSON and sanitized request JSONL, kubelet cAdvisor CPU counters and working-set memory gauges with source timestamps and container identities, host memory and CPU ticks, plus cAdvisor throttling boundary counters, and actual scrape-time Prometheus range vectors on both sides of measurement. The warm-up process drains before the first boundary. The measurement process finishes in-flight requests before the second boundary. Allow two scrape intervals and verify the actual sample timestamps. Keep other prediction traffic off the cluster and check counter reconciliation. Three-second scrapes bracket arrivals plus draining/idle padding. Background spans reflect the scrape interval, and their scope includes that padding. Clock skew can invalidate a boundary.

| Output | Definition |
|---|---|
| Table 5.3 | P50/P95/P99 of successful k6 HTTP durations in ms (sending, waiting and receiving), successful responses divided by scheduled arrival seconds, and errors divided by dispatched requests with outcomes. Offered, dispatched, complete, drops, timeouts and unfinished counts are available per run. |
| Table 5.4 | Equal-weight inference-replica means of available unique in-window CPU and memory samples. CPU is actual usage divided by the deployed CPU limit. Memory is decimal MB. Gateway CPU is applicable to gateway policies. |
| Table 5.5 | Successful responses by replica divided by all successful responses, reconciled with Prometheus inference counters. Replica slots follow the gateway's IP order and remain tied to a Pod UID. |
| Table 5.6 | Mean in-handler processing excluding all HTTP attempt spans, upstream time by outcome, routing lock waits, adaptive cache and scoring, background retrieval and cache installation, successful refresh interval, telemetry source age, and Adaptive minus matched RR gateway CPU in percentage points and relative percent. |
| Figures 5.1–5.4 | P95 and successful throughput versus common steady offered load, measurement-aligned per-replica CPU series, and grouped success shares. Across-repetition sample standard deviation appears when at least two results exist. |

Analysis also exports burst phase counts, P95 and the lag to the first five-second recovery window meeting the success and latency gates. Means and sample standard deviations use run-level statistics with measurement counts. cAdvisor CPU intervals must lie wholly inside measurement, span at most 30 seconds, and share their right-hand source timestamp with a memory sample. Duplicate source timestamps are deduplicated and resets rejected. Adaptive keeps its original Metrics Server inputs. Missing values remain blank and figures with no observations are omitted. Validation records discrepancies, invalid trials and request ID collisions. Inference uses abbreviated request IDs, so the runner uses the k6 iteration index as the per-scenario record key.
