from argparse import Namespace
import hashlib
import json
import xml.etree.ElementTree as ET

import pytest

import analyze
import run
import sample_resources as resources


def save(path, payload):
    path.write_text(json.dumps(payload), encoding="utf-8")


def save_lines(path, payloads):
    path.write_text("\n".join(map(json.dumps, payloads)), encoding="utf-8")


def test_corpus_validation_rejects_unknown_missing_and_bad_types():
    corpus = run.read(run.HERE / "corpus.json")
    schema = run.read(run.HERE / "corpus-schema.json")
    run.validate_corpus(corpus, schema)
    for row in (corpus[0] | {"Age": True}, corpus[0] | {"Cabin": "unknown"},
                corpus[0] | {"unexpected": 1}, {k: v for k, v in corpus[0].items() if k != "Age"}):
        with pytest.raises(ValueError):
            run.validate_corpus([row], schema)


def test_arrival_profiles_and_balanced_repetition():
    args = Namespace(plan="chapter5", seed=42, repetitions=3, rates=[5, 10, 20], measurement=180)
    trials = run.generate_trials(args)
    assert len(trials) == 48 and trials == run.generate_trials(args)
    for policy in run.POLICIES:
        positions = []
        for repetition in range(1, 4):
            block = [r["strategy"] for r in trials if r["level"] == "high" and r["repetition"] == repetition]
            positions.append(block.index(policy))
        assert len(set(positions)) == 3
    burst = run.measurement(args, next(r for r in trials if r["scenario"] == "burst"))
    assert sum(n for n, _ in burst["stages"]) == 180
    assert burst["segments"][1][2:] == [5, 20]
    assert burst["segments"][-1][2:] == [5, 5]
    args.plan, args.rates, args.measurement = "ramp", [5, 10, 20], 61
    ramp = run.measurement(args, run.generate_trials(args)[0])
    assert sum(s[0] for s in ramp["stages"]) == 61


def test_resource_quantities_and_strategy_aliases():
    assert resources.cpu_millicores("200000n") == pytest.approx(.2)
    assert resources.cpu_millicores("350m") == 350
    assert resources.memory_bytes("1Mi") == 1048576
    weights = {"wrr_weights": [5, 3, 2],
               "adaptive_weights": {"latency": .4, "active": .3, "cpu": .2, "error": .1}}
    run.verify_strategy({"strategy": "adaptive", "wrr_weights": [5, 3, 2],
                         "adaptive_weights": {"lat": .4, "req": .3, "cpu": .2, "err": .1}}, "adaptive", weights)


def test_counter_resets_and_missing_freshness_are_rejected():
    def snapshot(t, value):
        return {"after": t - .1, "series": {"key": [{"metric": {"id": "pod"}, "values": [[t, str(value)]]}]}}
    assert analyze.counter_delta(snapshot(1, 5), snapshot(2, 7), "key")[0][1] == 2
    with pytest.raises(ValueError, match="reset"):
        analyze.counter_delta(snapshot(1, 5), snapshot(2, 4), "key")
    with pytest.raises(ValueError, match="fresh"):
        analyze.counter_delta(snapshot(1, 5), snapshot(2, 7) | {"after": 3}, "key")


def fixture_trial(root, strategy="adaptive"):
    folder = root / "001"
    folder.mkdir(parents=True)
    inputs = root / "inputs"
    inputs.mkdir()
    corpus = inputs / "corpus.json"
    save(corpus, [{"row": 1}, {"row": 2}])
    names = ["one", "two", "three"]
    endpoints = {name: f"http://10.0.0.{i}:8000" for i, name in enumerate(names, 1)}
    identity = {name: {"app": "inference-service", "uid": name + "-uid"} for name in names}
    identity["gateway"] = {"app": "inference-gateway", "uid": "gateway-uid"}
    trial = {"strategy": strategy, "level": "low", "scenario": "steady", "rate": 1, "repetition": 1}
    suite = {"settings": {"p95_ceiling_ms": 500, "minimum_success": .99},
             "sha256": {"corpus.json": hashlib.sha256(corpus.read_bytes()).hexdigest()}, "order": [trial]}
    save(root / "suite.json", suite)
    save(folder / "trial.json", {"trial": trial, "status": "collected", "seed": 42, "suite": suite,
          "cluster": {"pods": identity, "replicas": names, "model": "run-id", "endpoints": endpoints},
          "measurement": {"duration": 3, "offered": 3, "segments": [["plateau", 3, 1, 1]]},
          "measure_process": {"started": 99, "ended": 103.1}})
    requests = []
    metrics = []
    for i, name in enumerate(names):
        requests.append({
            "iteration": i, "row": i % 2, "scenario_start_ms": 100000, "started_ms": 100000 + i * 1000,
            "ended_ms": 100010 + i * 1000, "duration_ms": 10 + i, "status": 200, "prediction_type": "string",
            "request_id": str(i), "replica_id": name, "valid": True, "timeout": False,
            "gateway_meta": {"routing_strategy": strategy, "model_run_id": "run-id", "target_endpoint": endpoints[name]},
        })
        metrics.extend({"type": "Point", "metric": metric,
                        "data": {"value": 1, "tags": {"valid": "true", "timeout": "false"}}}
                       for metric in ("iterations", "http_reqs", "nexus_completed"))
    save_lines(folder / "measure-requests.jsonl", requests)
    save_lines(folder / "measure-k6.jsonl", metrics)
    for before in (True, False):
        stamp = 99 if before else 108
        value = int(not before)
        series = {"up": [], "inference": [], "gateway_sum": [], "gateway_count": []}
        for name in [*names, "gateway"]:
            series["up"].append({"metric": {"pod_name": name}, "values": [[stamp, "1"]]})
        for name in names:
            for status in ("200", "500"):
                series["inference"].append({"metric": {"pod_name": name, "status": status},
                                            "values": [[stamp, str(value if status == "200" else 0)]]})
        for key, metric in (("gateway_sum", .006), ("gateway_count", 3)):
            series[key].append({"metric": {"span": "handler_processing", "outcome": "ok", "strategy": strategy},
                                "values": [[stamp, str(metric * value)]]})
        save(folder / ("prom-before.json" if before else "prom-after.json"),
             {"after": 98 if before else 105, "evaluation": stamp, "series": series})
    samples = [{"pod": name, "uid": pod["uid"], "app": pod["app"], "cpu_pct": 10, "timestamp": "sample",
                "cpu_millicores": 50, "cpu_limit_millicores": 500, "source_epoch": 102,
                "window": "1s", "memory_bytes": 2000000} for name, pod in identity.items()]
    save_lines(folder / "resources.jsonl", [{"identity": identity, "pods": samples}] * 2)
    return folder


def test_archive_validation_and_chapter5_report(tmp_path):
    folder = fixture_trial(tmp_path / "suite")
    errors = []
    trial, = analyze.validate_trial_files([folder / "trial.json"], errors)
    assert not errors and trial["valid"] and not trial["flags"]
    assert trial["p95_ms"] == pytest.approx(11.9)
    assert trial["counter_difference"] == 0
    assert trial["gateway_spans"]["handler_processing_ok"] == {"count": 3, "mean_ms": 2}
    assert trial["resource_summary"]["one"]["samples"] == 1
    output = tmp_path / "reports"
    output.mkdir()
    assert len(analyze.make_reports(output, [trial])) == 4
    for index in range(3, 7):
        assert (output / f"Table-5.{index}.csv").is_file()
    for svg in output.glob("*.svg"):
        ET.parse(svg)
    archive = folder / "measure-k6.jsonl"
    archive.write_text(archive.read_text(encoding="utf-8") + '\n{"type":"Point","metric":"iterations","data":{"value":1}}',
                       encoding="utf-8")
    result = analyze.summarize(folder)
    assert not result["valid"] and any("disagree" in warning for warning in result["flags"])


def test_cadvisor_windows_require_matching_identity_and_in_window_samples():
    identity = {"replica": {"uid": "uid", "app": "inference-service", "containers": {
        "inference": {"container_id": "containerd://id", "resources": {"limits": {"cpu": "500m"}}}
    }}}
    cpu = "container_cpu_usage_seconds_total"
    memory = "container_memory_working_set_bytes"
    base = {"pod": "replica", "uid": "uid", "container": "inference", "container_id": "containerd://id"}
    rows = [base | {"metric": key, "source_ms": t, "value": v} for key, t, v in [
        (cpu, 9000, 0), (cpu, 12000, 1), (cpu, 17000, 2), (cpu, 24000, 3),
        (memory, 17000, 200_000_000), (memory, 12000, 201_000_000),
    ]]
    samples = list(analyze.cadvisor_windows(rows + [rows[2]], identity, 10, 20).values())
    assert len(samples) == 1
    assert samples[0]["cpu_millicores"] == pytest.approx(200)
    assert samples[0]["cpu_pct"] == pytest.approx(40)
    assert samples[0]["memory_bytes"] == 200_000_000
    assert samples[0]["window"] == "5.0s"
    with pytest.raises(ValueError, match="counter reset"):
        analyze.cadvisor_windows(rows + [base | {"metric": cpu, "source_ms": 26000, "value": 1}], identity, 10, 20)
