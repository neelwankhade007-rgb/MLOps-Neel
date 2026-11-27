# Adaptive observation improvement — Phase 2

## Acceptance criteria declared before live evaluation

Use two independent full trials per policy at 5 RPS, ordered original / observed / observed / original, with seed 42 for the first matched pair and the existing repetition-derived seed 43 for the second matched pair. Timed k6 requests use the authenticated backend ClusterIP from Minikube's node network. Keep 30/60/20-second phases, 32 preallocated VUs, the serving run, existing weights and limits, connection policy, and host guard. Apply the existing capacity qualification gate plus exactly 150 clean warm-up responses and 300 measured successes. Require no timeouts, unexplained transports, drops, workload churn or reconciliation discrepancies, and valid cAdvisor and gateway evidence.

The observed policy must have at least three completed observations per ready replica by the warm-up boundary, no more than nine initial probes for the stable three-replica cluster, no new bootstrap probes during measurement, at least one measured success per replica, all post-measure observation ages below 25 seconds, and at most 30 refresh probes during nominal measurement plus one for boundary padding. Median and tail latency are reported without a requirement to improve on the control. Retain original policy by configuration. Promote observed only after all four trials and its coverage gates pass.

## Mechanism

For a ready endpoint with observations O, bootstrap while |O| has fewer than three completed attempts. Prefer the smallest sample count among idle eligible endpoints. After bootstrap, explore the oldest idle eligible endpoint whose latest latency observation is at least 15 seconds old (or the configured freshness ceiling if lower). Space periodic probes at least two seconds apart globally. With an interval [t, t+60), at most 30 periodic assignments fit; at 5 RPS this limits the steady exploration allowance to about 10% of scheduled requests. A single reserved endpoint bounds exploratory concurrency. Normal traffic continues through the existing minimum-score policy when no probe is available. Normal traffic may already refresh any endpoint. The reserved endpoint is released when its in-flight count drains, including failed or cancelled attempts. No synthetic predictions are added.

Discovery removes observations and EMA for disappeared endpoints, so a recovered endpoint is eligible for bootstrap. Failed attempts count toward bootstrap and feed the existing error metric. The test with changing service time observes a move to an initially slower replica when enough real observations support it. This does not bound adaptation time for a previously busy replica with a full 50-attempt history. At lower traffic or with in-flight pressure the freshness target cannot be guaranteed. Narrow CPU differences may still expand under min-max normalization. None of these limits requires changing the original weighting or normalization in this phase.

## Validation outcome and deployment

65 automated tests passed. Four skipped (three opt-in k6 fixture tests and one pandas-dependent test). Deterministic tests cover homogeneous and heterogeneous inputs, a slower replica becoming faster, missing CPU, the refresh age/cooldown, concurrent selection, recovered endpoints and cancellation. The four real authenticated Linux k6 trials also validate the revised constant scheduler at 300 arrivals per trial.

| Trial | Warm-up boundary observations by slot* | Measured successes by slot | Refresh probes | Oldest observed sample at end | P50 / P95 / P99 (ms) |
|---|---|---|---:|---|---|
| Original 1 | 151 / 0 / 0 | 300 / 0 / 0 | 0 | 6.60 s, two absent | 25.434 / 32.556 / 52.521 |
| Observed 1 | 76 / 4 / 71 | 4 / 4 / 292 | 8 | 20.76 s, all present | 25.447 / 31.755 / 35.002 |
| Observed 2 | 105 / 40 / 6 | 162 / 134 / 4 | 8 | 20.76 s, all present | 26.267 / 34.432 / 81.929 |
| Original 2 | 0 / 0 / 151 | 0 / 0 / 300 | 0 | 6.56 s, two absent | 25.830 / 31.875 / 46.337 |

*Boundary observations include the single smoke prediction plus 150 warm-up requests. Slots follow measured gateway IP order. End ages include counter scrape padding.

All four trials passed the frozen capacity gates. Each achieved 300/300 successes at 5.00 RPS, zero errors, timeouts or drops, exact per-replica counters, valid cAdvisor resource windows and valid gateway timings. All four signatures match after removing the policy field. Both observed runs covered all ready replicas and passed the bootstrap, age and refresh budgets. Eight refresh probes per trial were 2.67% of measured arrivals. Mean P95 was 32.216 ms original and 33.094 ms observed. These two low-load repetitions establish better observation coverage. They do not support a latency improvement claim.

Artifacts: benchmarks/reports/adaptive-phase2/{original-1,observed-1,observed-2,original-2}/analysis/validation.json, adaptive-warmup.json and adaptive-measure.json, plus per-request NDJSON and cAdvisor samples. Image mlops-gateway:adaptive-observation-v1, deployed image ID sha256:1aa487f690d1104f66dfe7a8f45b4b45a129e56b7136ba859130d2ebef3136ab. Promoted ADAPTIVE_POLICY=observed and recorded it in the Kubernetes gateway manifest. ADAPTIVE_POLICY=original remains available for repeatable controls. Independently verified restored backend Round Robin and unchanged WRR 5/3/2 and Adaptive 0.4/0.3/0.2/0.1 weights. Benchmark tunnels and generator containers were closed; the dashboard remains on 8080.

Report correction: the earlier Chapter 5 figures and CSVs remain the qualified historical original-policy baseline. Keep this diagnostic comparison in a separate subsection with the new image and schedule signature. Do not retroactively replace Adaptive values or infer behavior at higher load, under contention or during failover.
