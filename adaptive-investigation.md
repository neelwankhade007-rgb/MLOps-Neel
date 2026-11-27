# Adaptive routing investigation — Phase 1

## Qualified baseline evidence

The reports under benchmarks/reports/evaluation/raw/node-5-rps/002 and node-5-rps-repeat-2/001 are unchanged. Grouping their raw request logs shows 150/150 warm-up and 300/300 measured requests went to 7r8qz in repetition 1 and vm99c in repetition 2. Both used the same model, input corpus and independent gateway restart. Other policies successfully used all three replicas. The last real Adaptive decisions were captured in adaptive-warmup.json and adaptive-measure.json.

| Repetition | Selected endpoint | Selected warm-up score | Selected final score | Other final scores | Mean CPU source age |
|---|---|---:|---:|---|---:|
| 1 | 10.244.0.14 | 0.000 | 0.200 | 0.500, 0.501 | 41.715 s |
| 2 | 10.244.0.11 | 0.000 | 0.200 | 0.500, 0.500 | 39.453 s |

Successful cache refresh intervals averaged about 5.085 s in both repetitions. Refresh cadence measures cache updates, while age measures the underlying Metrics Server samples. The 120 s freshness ceiling checks individual sample timestamps. Aggregate source-age data and the two boundary decisions cannot recover each request's actual raw, EMA or normalized inputs, or identify the exact first-choice signal.

## Scoring and deterministic diagnostics

gateway/router.py computes latency and error averages over the last 50 completed attempts per replica. Freshness uses the last completion's monotonic timestamp; the entire deque can still contain older attempts. Active is the current in-flight count. CPU comes from the existing pod-metrics cache and uses the source wall-clock timestamp. EMA updates on scoring, alpha 0.3, and retains prior EMA state through gaps. Each usable signal is min-max normalized across replicas. A metric absent everywhere is omitted and the remaining weights renormalize. Missing on only one replica contributes the worst normalized value (1). An observed equal-valued signal contributes zero. Ties rotate; non-tied minima win.

The deterministic test seeds equal CPU at 10% and gives all replicas the same modeled service time. The first request goes to the first tied replica. Its completion supplies fresh latency 5 ms and error fraction 0, initialized directly into the EMA. Idle candidates have zero in-flight, equal fresh CPU and no request observations. Their normalized latency/error values become 1/1, adding 0.40 + 0.10 to their penalties. The observed winner adds zero on those signals. Repeating this loop produces 300/300 selections of the first winner. A 0.001 percentage-point difference in fresh CPU can normalize the middle replica to 0.5 and add 0.10 to its penalty, despite the tiny absolute difference. With both replicas observed and equal other inputs the faster replica wins, which can be desirable under heterogeneous service times.

**Verified mechanism:** the current greedy scoring and missing-value policy can create self-reinforcing starvation, even with healthy homogeneous replicas. The live score snapshots and different winners agree with that mechanism. **Unknown:** the exact initial observation that broke the tie and the relative role of stale CPU in individual live decisions.

## Implemented corrections and remaining design choices

- Every upstream attempt now releases active accounting in a finally block, including cancellation. Known status and retry handling are preserved. The cancelled-attempt regression proves the in-flight count returns to zero and records an unsuccessful attempt. Isolated the dynamic-weight endpoint test so it cannot contaminate later tests.
- No scoring or weight change. For a separately approved experiment, compare cold-start seeding against tightly bounded ready-replica exploration. Seeding reduces first-arrival bias but provides no ongoing refresh. Bounded exploration can refresh observations on idle replicas but costs traffic on slower replicas. Test equal replicas and deliberately heterogeneous service times, comparing switch rate, stale share, latency, failures and recovery as well as distribution.
- Distinguish unobserved/stale signals from measured bad outcomes and evaluate recency within each observation window. Compare current min-max normalization against fixed references based on declared latency objectives and resource saturation. Fixed references avoid amplifying tiny gaps but require defensible reference values and may compress real differences. Keep the existing policy as a control and select criteria before data collection.

## Scheduler and resource diagnostics

k6 v2.4.0's constant executor schedules slot zero and selects between periodic slot and duration timers. Archived iteration 300 began at 59.998 s despite the old 1 ms cutoff, consistent with a right-edge deadline race or clock alignment. Set the executor cutoff halfway between the last intended slot and the next slot while keeping the nominal reporting phase and exact arrival gate. Its ramp executor schedules integer crossings of cumulative area from one and can place the last crossing at the phase end. Allow a zero-rate tail after a 1 ns transition and validate the integral's integer count exactly. Phase attribution uses open-left, closed-right ramp intervals and records unassigned counts explicitly. Historical archives retain their original validation rules. No HTTP requests or evidence are discarded. [Constant executor](https://github.com/grafana/k6/blob/v2.4.0/lib/executor/constant_arrival_rate.go) · [Ramp executor](https://github.com/grafana/k6/blob/v2.4.0/lib/executor/ramping_arrival_rate.go)

The 10 RPS Adaptive attempt archived eight measured responses before the host guard stopped it after two low-memory checks. The distributed five-second resource samples missed the threshold crossing, and the evidence cannot attribute the drop to a particular process. The runner now records the guard's triggering reading, reuses the existing Pod identity inventory with cAdvisor during preflight, and combines Linux k6 version and Service health checks in one temporary container. Adaptive's own Metrics Server inputs, the host floor, Kubernetes allocations and persistent storage are unchanged. Benchmark resource improvements reduce redundant operations; they have not established 10 RPS sustainability.

Scheduler fixtures use the real k6 script against a loopback HTTP stub. They are diagnostics only and are not included in qualified experimental results.

## Phase 1 validation

62 tests passed and 1 was skipped (pandas unavailable). Real k6 v2.4.0 loopback integration recorded exactly 300 constant arrivals, 15 ramp arrivals and 60 burst arrivals, with no drops. Phase boundary and cancellation regressions passed. Read-only Minikube checks verified digest-compatible Linux k6 Service health and timestamped cAdvisor CPU/memory coverage for the gateway and three inference replicas. Python/JavaScript syntax and git diff --check passed. No gateway deployment or additional experimental load run was needed for these checks.
