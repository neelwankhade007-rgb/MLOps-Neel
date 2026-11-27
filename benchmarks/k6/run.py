"""Run the authenticated Nexus capacity discovery and Chapter 5 trials."""
import argparse
import base64
import getpass
import hashlib
import json
import math
import os
import random
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import Request, urlopen

import sample_resources as resources

HERE = Path(__file__).resolve().parent
STRATEGY = "/api/v1/inference-monitoring/routing-strategy"
WORKLOADS = json.loads((HERE / "workloads.json").read_text())
POLICIES = WORKLOADS["strategies"]


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write(path, data):
    path.write_text(json.dumps(data, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def api(base, route, token=None, method="GET", data=None, form=False):
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded" if form else "application/json"
        data = (urlencode(data) if form else json.dumps(data)).encode()
    try:
        with urlopen(Request(base.rstrip("/") + route, data, headers, method=method), timeout=25) as response:
            return json.load(response)
    except HTTPError as exc:
        raise RuntimeError(f"{method} {route} returned HTTP {exc.code}") from None


def read_credentials(path):
    """Decrypt a Windows CurrentUser DPAPI password through a private child-process pipe."""
    if path is None:
        return input("Benchmark username: "), getpass.getpass("Benchmark password: ")
    if os.name != "nt":
        raise RuntimeError("Windows is required for the DPAPI credential file")
    record = read(path)
    script = ("$ErrorActionPreference='Stop'; "
              "$secure=ConvertTo-SecureString -String ([Console]::In.ReadToEnd().Trim()); "
              "[Console]::Write(([pscredential]::new('benchmark',$secure)).GetNetworkCredential().Password)")
    result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
                            input=record["protected_password"], capture_output=True, text=True, timeout=15)
    if result.returncode or not result.stdout:
        raise RuntimeError("Could not unlock benchmark credentials as the current Windows user")
    return record["username"], result.stdout


def login(base, username, password, minimum_seconds):
    response = api(base, "/api/v1/auth/login", method="POST",
                   data={"username": username, "password": password}, form=True)
    token = response["access_token"]
    claims = token.split(".")[1]
    expiration = json.loads(base64.urlsafe_b64decode(claims + "=" * (-len(claims) % 4)))["exp"]
    if expiration <= time.time() + minimum_seconds:
        raise ValueError("JWT expires before the trial can complete")
    return token, response.get("backend_session_id")


def validate_corpus(rows, schema):
    features = {item["name"]: item for item in schema["features"]}
    required = {name for name, item in features.items() if item.get("required")}
    if not features or not isinstance(rows, list) or not rows:
        raise ValueError("Corpus and model schema must contain entries")
    for index, row in enumerate(rows):
        if not isinstance(row, dict) or not row or required - row.keys() or row.keys() - features.keys():
            raise ValueError(f"Corpus row {index} has missing or unknown features")
        for name, value in row.items():
            feature = features[name]
            kind = feature.get("type", "string")
            if kind == "number":
                valid = type(value) in (int, float) and math.isfinite(value)
            elif kind == "boolean":
                valid = type(value) is bool
            elif kind in ("categorical", "string"):
                options = feature.get("options")
                valid = isinstance(value, str) and (not options or value in options)
            else:
                raise ValueError(f"Unsupported feature type {kind}")
            if not valid:
                raise ValueError(f"Corpus row {index} has invalid feature {name}")


def current_cluster(args):
    identities = resources.pods(args.namespace)
    groups = {app: sorted(name for name, pod in identities.items() if pod["app"] == app)
              for app in ("inference-service", "inference-gateway", "backend", "prometheus")}
    if ([len(x) for x in groups.values()] != [3, 1, 1, 1] or
            not all(p["ready"] and p["ip"] and all(c["image_id"] and c["container_id"]
                    for c in p["containers"].values()) for p in identities.values())):
        raise RuntimeError("Expected 3 ready inference replicas and one ready gateway, backend and Prometheus")
    gateway = groups["inference-gateway"][0]
    replica_readiness = {name: resources.pod_readiness(args.namespace, name, 8000)
                         for name in groups["inference-service"]}
    gateway_readiness = resources.pod_readiness(args.namespace, gateway, 8080)
    gateway_replicas = resources.pod_readiness(args.namespace, gateway, 8080, "replicas")
    weights = resources.pod_readiness(args.namespace, gateway, 8080, "weights")
    endpoints = {name: f"http://{identities[name]['ip']}:8000" for name in replica_readiness}
    discovery = sorted(endpoint.removeprefix("http://").rsplit(":", 1)[0]
                       for endpoint in endpoints.values())
    advertised = gateway_replicas["endpoints"]
    if discovery != sorted(advertised) or gateway_readiness["available_replicas"] != 3:
        raise RuntimeError("Gateway discovery differs from the ready replica pool")
    model = gateway_readiness["model_run_id"]
    if (not model or gateway_readiness["status"] != "ready" or
            any(r["status"] != "ready" or r["replica_id"] != name or r["run_id"] != model
                for name, r in replica_readiness.items())):
        raise RuntimeError("Replica and gateway model/readiness mismatch")
    by_ip = {pod["ip"]: name for name, pod in identities.items()}
    return {
        "pods": identities, "model": model, "endpoints": endpoints,
        "replicas": [by_ip[ip] for ip in sorted(advertised)],
        "weights": {"wrr_weights": weights["wrr_weights"], "adaptive_weights": weights["adaptive_weights"]},
    }


def verify_strategy(actual, expected, weights):
    backend_weights = actual["adaptive_weights"]
    gateway_weights = {
        full: backend_weights[short] for full, short in
        (("latency", "lat"), ("active", "req"), ("cpu", "cpu"), ("error", "err"))
    }
    if (actual["strategy"] != expected or actual["wrr_weights"] != weights["wrr_weights"] or
            gateway_weights != weights["adaptive_weights"]):
        raise RuntimeError("Backend strategy or gateway weights do not match intended configuration")


def generate_trials(args):
    rng = random.Random(args.seed)
    trials = []
    if args.plan == "pilot":
        conditions = [("capacity", "candidate", args.rate)]
    elif args.plan == "ramp":
        conditions = [("ramp", "scout", args.rates[0])]
    else:
        conditions = [("steady", level, rate) for level, rate in zip(("low", "moderate", "high"), args.rates)]
        if args.plan == "chapter5":
            conditions += [("burst", "burst", args.rates[0])]
        if args.plan == "contention":
            conditions = [("steady", "matched_control", args.rates[1]),
                          ("contention", "contended", args.rates[1])]
    rotations = {condition: rng.sample(POLICIES, len(POLICIES)) for condition in conditions}
    first_repeat = 1 + getattr(args, "repetition_offset", 0)
    for repeat in range(first_repeat, first_repeat + args.repetitions):
        shuffled = conditions[:]
        rng.shuffle(shuffled)
        for condition in shuffled:
            scenario, level, rate = condition
            base_order = rotations[condition]
            offset = (repeat - 1) % len(base_order)
            order = base_order[offset:] + base_order[:offset]
            for strategy in order:
                trials.append({"scenario": scenario, "level": level, "rate": rate,
                               "strategy": strategy, "repetition": repeat})
    return trials


def measurement(args, trial):
    duration = args.measurement
    rate = trial["rate"]
    settings = {"rate": rate, "duration": duration, "scenario": trial["scenario"],
                "segments": [["plateau", duration, rate, rate]], "offered": duration * rate}
    if trial["scenario"] == "burst":
        segments = []
        previous = rate
        peak = args.rates[2]
        for name, fraction in WORKLOADS["burst"]["segments"]:
            seconds = round(duration * fraction) if name != "recovery" else duration - sum(s[1] for s in segments)
            target = peak if name in ("rise", "peak") else rate
            segments.append([name, seconds, previous, target])
            previous = target
    elif trial["scenario"] == "ramp":
        segments = []
        previous = rate
        for index, target in enumerate(args.rates):
            seconds = (index + 1) * duration // len(args.rates) - index * duration // len(args.rates)
            segments.append([f"stage_{index + 1}", seconds, previous, target])
            previous = target
    else:
        return settings
    if any(s[1] <= 0 for s in segments):
        raise ValueError("Measurement duration is too short for the selected schedule")
    return settings | {"segments": segments, "stages": [[s[1], s[3]] for s in segments],
                       "offered": sum(s[1] * (s[2] + s[3]) / 2 for s in segments)}


def health_snapshot(snapshot, cluster):
    up = snapshot["series"]["up"]
    expected = {(data["app"], name) for name, data in cluster["pods"].items()
                if data["app"] in ("inference-service", "inference-gateway")}
    actual = {("inference-service" if row["metric"]["job"] == "inference-replicas" else "inference-gateway",
               row["metric"].get("pod_name")) for row in up
              if float(row["values"][-1][1]) == 1 and row["values"][-1][0] >= snapshot["after"]}
    if actual != expected or len(up) != len(expected):
        raise RuntimeError("Prometheus does not have four fresh, healthy scrape targets")
    for status in ("200", "500"):
        counters = [row for row in snapshot["series"]["inference"] if row["metric"].get("status") == status]
        if ({row["metric"].get("pod_name") for row in counters
             if row["values"][-1][0] >= snapshot["after"]} != set(cluster["replicas"]) or len(counters) != 3):
            raise RuntimeError("Prometheus inference counter coverage is incomplete")


def counter_boundary(args, directory, name, cluster):
    write(directory / f"throttle-{name}.json", resources.throttle_snapshot(args.namespace, cluster["pods"]))
    result = resources.snapshot(args.prom_url, time.time(), WORKLOADS["measurement"]["scrape_seconds"])
    write(directory / f"prom-{name}.json", result)
    health_snapshot(result, cluster)
    return result


def k6_phase(executable, script, directory, name, config, token):
    env = {key: value for key, value in os.environ.items() if not key.upper().startswith(("K6_", "NEXUS_"))}
    env.update(NEXUS_CONFIG=json.dumps(config), NEXUS_TOKEN=token, K6_NO_USAGE_REPORT="true")
    scratch = Path("D:/DevTools/Nexus/tmp")
    if os.name == "nt" and scratch.is_dir():
        env.update(TEMP=str(scratch), TMP=str(scratch))
    command = [executable, "run", "--quiet", "--log-format", "raw",
               "--console-output", str(directory / f"{name}-requests.jsonl"),
               "--out", f"json={directory / (name + '-k6.jsonl')}", str(script)]
    container = None
    if config.get("node_network"):
        env["NEXUS_CONFIG"] = json.dumps(config | {"url": config["node_target"]})
        env.pop("NEXUS_TOKEN")
        container = f"nexus-k6-{os.getpid()}-{name}"
        command = ["docker", "run", "--rm", "-i", "--name", container, "--network",
                   f'container:{config["node_network"]}', "--env", "NEXUS_CONFIG", "--env", "K6_NO_USAGE_REPORT",
                   "--mount", f"type=bind,source={script.parent.resolve()},target=/inputs,readonly",
                   "--mount", f"type=bind,source={directory.resolve()},target=/evidence",
                   "--entrypoint", "sh", config["node_image"], "-c",
                   'read -r NEXUS_TOKEN; export NEXUS_TOKEN; exec k6 "$@"', "k6",
                   "run", "--quiet", "--log-format", "raw", "--console-output",
                   f"/evidence/{name}-requests.jsonl", "--out", f"json=/evidence/{name}-k6.jsonl",
                   "/inputs/predict.js"]
    started = time.time()
    with (directory / f"{name}-k6.log").open("xb") as log:
        with subprocess.Popen(command, env=env, stdin=subprocess.PIPE if container else subprocess.DEVNULL,
                              stdout=log, stderr=log) as process:
            if container:
                process.stdin.write((token + "\n").encode())
                process.stdin.close()
            deadline = time.monotonic() + config["duration"] + 90
            low_memory = 0
            try:
                while process.poll() is None:
                    memory = resources.host_memory()
                    low_memory = low_memory + 1 if memory and memory["free_bytes"] < 768 * 1024**2 else 0
                    if low_memory >= 2:
                        raise RuntimeError("Unsafe host memory pressure during k6 phase (below 768 MiB)")
                    if time.monotonic() >= deadline:
                        raise subprocess.TimeoutExpired(command, config["duration"] + 90)
                    try:
                        process.wait(timeout=1)
                    except subprocess.TimeoutExpired:
                        continue
            finally:
                if process.poll() is None:
                    process.kill()
                    if container:
                        subprocess.run(["docker", "rm", "-f", container], capture_output=True, timeout=15)
    return {"started": started, "ended": time.time(), "return_code": process.returncode}


def restart_gateway(args, cluster, original, token):
    prefix = ("kubectl", "-n", args.namespace)
    prior = resources.pods(args.namespace)
    resources.run_command(*prefix, "rollout", "restart", "deployment/inference-gateway")
    resources.run_command(*prefix, "rollout", "status", "deployment/inference-gateway",
                          "--timeout=180s", timeout=190)
    deadline = time.monotonic() + 75
    while True:
        try:
            current = current_cluster(args)
            break
        except RuntimeError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(2)
    old_gateway = next(name for name, pod in prior.items() if pod["app"] == "inference-gateway")
    new_gateway = next(name for name, pod in current["pods"].items() if pod["app"] == "inference-gateway")
    previous = prior[old_gateway]
    replacement = current["pods"][new_gateway]
    if (previous["uid"] == replacement["uid"] or
            {name: (item["image_id"], item["resources"]) for name, item in previous["containers"].items()} !=
            {name: (item["image_id"], item["resources"]) for name, item in replacement["containers"].items()} or
            {name: pod for name, pod in current["pods"].items() if pod["app"] != "inference-gateway"} !=
            {name: pod for name, pod in cluster["pods"].items() if pod["app"] != "inference-gateway"}):
        raise RuntimeError("Gateway restart did not preserve deployment and serving identities")
    api(args.base_url, STRATEGY, token, "PUT",
        {key: original[key] for key in ("strategy", "wrr_weights", "adaptive_weights")})
    current = current_cluster(args)
    baseline = cluster | {"pods": {name: pod for name, pod in cluster["pods"].items()
                                   if pod["app"] != "inference-gateway"} | {new_gateway: replacement}}
    if current != baseline:
        raise RuntimeError("Serving configuration or weights changed after gateway reset")
    verify_strategy(api(args.base_url, STRATEGY, token), original["strategy"], current["weights"])
    return current


def run_trial(args, directory, trial, cluster, original, username, password, k6, inputs, suite_meta):
    directory.mkdir()
    settings = measurement(args, trial)
    meta = {"trial": trial, "measurement": settings, "cluster": cluster,
            "seed": args.seed + trial["repetition"] - 1, "status": "incomplete",
            "suite": suite_meta, "original_strategy": original["strategy"]}
    token = None
    stop = threading.Event()
    sampler = None
    signal_path = directory / "contention-signal.json"
    try:
        token, session = login(args.base_url, username, password,
                               args.warmup + args.measurement + args.cooldown + 500)
        meta["backend_session"] = session
        if session != suite_meta["backend_session"]:
            raise RuntimeError("Backend session changed before trial")
        if args.restart_gateway:
            cluster = restart_gateway(args, cluster, original, token)
            meta["cluster"] = cluster
            meta["gateway_reset"] = "rollout restart verified before smoke and fresh counters"
            # Old target range samples age out and the background cache gets several refreshes.
            time.sleep(3 * WORKLOADS["measurement"]["scrape_seconds"])
            preflight = resources.snapshot(args.prom_url, time.time(), WORKLOADS["measurement"]["scrape_seconds"])
            write(directory / "prom-reset.json", preflight)
            health_snapshot(preflight, cluster)
        elif current_cluster(args) != cluster:
            raise RuntimeError("Serving identity or weights changed before trial")
        verify_strategy(api(args.base_url, STRATEGY, token), original["strategy"], cluster["weights"])
        # Restore on any later exception, including a lost reply to the PUT.
        meta["switch_attempted"] = True
        api(args.base_url, STRATEGY, token, "PUT", {"strategy": trial["strategy"]})
        verify_strategy(api(args.base_url, STRATEGY, token), trial["strategy"], cluster["weights"])
        path = "/api/v1/predict/" + quote(args.deployment, safe="")
        config = {"url": args.base_url.rstrip("/") + path, "deployment": args.deployment,
                  "strategy": trial["strategy"], "model": cluster["model"], "seed": meta["seed"],
                  "endpoints": cluster["endpoints"], "vus": args.vus}
        if args.node_k6_image:
            config.update(node_network=args.context, node_image=args.node_k6_image,
                          node_target=args.node_service_base + path)
        smoke = api(args.base_url, path, token, "POST", {"features": read(inputs / "corpus.json")[0]})
        gateway = smoke.get("gateway_meta")
        replica = smoke.get("replica_id")
        if (replica not in cluster["replicas"] or not smoke.get("request_id") or
                not isinstance(smoke.get("prediction"), str) or not smoke["prediction"] or
                (trial["strategy"] == "native" and gateway is not None) or
                (trial["strategy"] != "native" and (not isinstance(gateway, dict) or
                 gateway.get("model_run_id") != cluster["model"] or gateway.get("routing_strategy") != trial["strategy"]
                 or gateway.get("target_endpoint") != cluster["endpoints"][replica]))):
            raise RuntimeError("Authenticated smoke response is inconsistent with strategy or serving model")
        meta["smoke"] = {key: smoke.get(key) for key in ("request_id", "replica_id", "gateway_meta", "latency_ms")}

        sampler = threading.Thread(target=resources.collect, args=(
            args.namespace, directory / "resources.jsonl", stop, args.sample_seconds))
        sampler.start()
        warmup_rate = min(trial["rate"], suite_meta["warmup_rate_max"])
        meta["warmup_settings"] = {"duration": args.warmup, "rate": warmup_rate}
        meta["warmup"] = k6_phase(k6, inputs / "predict.js", directory, "warmup",
                                  config | {"scenario": "warmup", "duration": args.warmup, "rate": warmup_rate}, token)
        from analyze import read_requests, k6_counts
        warmup_rows = read_requests(directory / "warmup-requests.jsonl")
        warmup_counts = k6_counts(directory / "warmup-k6.jsonl")
        if (meta["warmup"]["return_code"] or not warmup_rows or any(not row["valid"] for row in warmup_rows)
                or warmup_counts["dropped"] or len(warmup_rows) != warmup_rate * args.warmup):
            raise RuntimeError("Warm-up failed validation or did not deliver scheduled traffic")
        if trial["strategy"] == "adaptive":
            gateway_pod = next(p for p, spec in cluster["pods"].items() if spec["app"] == "inference-gateway")
            write(directory / "adaptive-warmup.json",
                  resources.pod_readiness(args.namespace, gateway_pod, 8080, "adaptive-scores"))
        counter_boundary(args, directory, "before", cluster)
        if trial["scenario"] == "contention":
            target = args.contention_pod
            duration = args.measurement
            meta["contention"] = {"pod": target, "uid": cluster["pods"][target]["uid"],
                                  "onset_s": duration // 3, "duration_s": duration // 3,
                                  "stimulus": args.stimulus}
            write(signal_path, meta["contention"] | {"measurement_dispatch_pending": True})
            print(f"Contention marker: {signal_path}", flush=True)
        meta["measure_process"] = k6_phase(k6, inputs / "predict.js", directory, "measure", config | settings, token)
        meta["cooldown_started"] = time.time()
        write(directory / "trial.json", meta)
        counter_boundary(args, directory, "after", cluster)
        if trial["strategy"] == "adaptive":
            write(directory / "adaptive-measure.json",
                  resources.pod_readiness(args.namespace, gateway_pod, 8080, "adaptive-scores"))
        if meta["measure_process"]["return_code"]:
            raise RuntimeError("k6 measurement exited unsuccessfully")
        time.sleep(max(0, meta["cooldown_started"] + args.cooldown - time.time()))
        if current_cluster(args) != cluster:
            raise RuntimeError("Serving identity or weights changed during trial")
        verify_strategy(api(args.base_url, STRATEGY, token), trial["strategy"], cluster["weights"])
        if trial["scenario"] == "contention":
            meta["intervention"] = read(directory / "intervention.json")
        meta["status"] = "collected"
    except (ValueError, RuntimeError, OSError, KeyError, subprocess.TimeoutExpired) as exc:
        meta["error"] = str(exc)
        raise
    finally:
        stop.set()
        if sampler is not None:
            sampler.join()
        try:
            if token and meta.get("switch_attempted"):
                api(args.base_url, STRATEGY, token, "PUT", {"strategy": original["strategy"]})
                verify_strategy(api(args.base_url, STRATEGY, token), original["strategy"], cluster["weights"])
        except (RuntimeError, OSError, ValueError, KeyError):
            meta["status"] = "incomplete"
            meta["restore_error"] = "Could not verify restoration of the original backend strategy"
            raise
        finally:
            write(directory / "trial.json", meta)


def loopback_url(value):
    url = urlsplit(value)
    if (url.scheme != "http" or url.hostname not in ("127.0.0.1", "localhost", "::1")
            or url.username or url.password or url.path not in ("", "/") or url.query or url.fragment):
        raise argparse.ArgumentTypeError("Use a local Service port-forward URL")
    return value


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", choices=("pilot", "ramp", "steady", "chapter5", "contention"), default="pilot")
    parser.add_argument("--base-url", type=loopback_url, default="http://127.0.0.1:8000")
    parser.add_argument("--prom-url", type=loopback_url, default="http://127.0.0.1:9090")
    parser.add_argument("--context", default="minikube")
    parser.add_argument("--namespace", default="mlops")
    parser.add_argument("--deployment")
    parser.add_argument("--credential-file", type=Path)
    parser.add_argument("--rate", type=int, default=5)
    parser.add_argument("--rates", type=int, nargs="+")
    parser.add_argument("--capacity-input", type=Path)
    parser.add_argument("--p95-ceiling-ms", type=float, default=500)
    parser.add_argument("--minimum-success", type=float, default=.99)
    parser.add_argument("--warmup", type=int)
    parser.add_argument("--measurement", type=int)
    parser.add_argument("--cooldown", type=int)
    parser.add_argument("--repetitions", type=int)
    parser.add_argument("--repetition-offset", type=int, default=0,
                        help="Continue the policy rotation in a separate pilot suite")
    parser.add_argument("--resume-trial", type=int, help="Fill a missing trial in a frozen pilot suite")
    parser.add_argument("--idle-seconds", type=int)
    parser.add_argument("--restart-gateway", action="store_true")
    parser.add_argument("--sample-seconds", type=int, default=5)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--vus", type=int, default=32)
    parser.add_argument("--contention-pod")
    parser.add_argument("--stimulus")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--k6", default="k6")
    parser.add_argument("--node-k6-image", help="Run timed k6 phases in the Minikube node network")
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--schema", type=Path, default=HERE / "corpus-schema.json")
    args = parser.parse_args()
    if args.repetition_offset < 0 or (args.repetition_offset and args.plan != "pilot"):
        parser.error("--repetition-offset requires the pilot plan and a nonnegative value")
    if args.resume_trial is not None and (args.plan != "pilot" or not args.output or args.resume_trial < 1):
        parser.error("--resume-trial requires a pilot output directory and a positive trial number")
    if args.idle_seconds is None:
        args.idle_seconds = 0 if args.restart_gateway else 120
    defaults = WORKLOADS["pilot" if args.plan in ("pilot", "ramp") else "formal"]
    for key in ("warmup", "measurement", "cooldown", "repetitions"):
        if getattr(args, key) is None:
            setattr(args, key, defaults[key])
    if (min(args.warmup, args.measurement, args.cooldown, args.repetitions, args.vus,
            args.sample_seconds, args.rate) <= 0 or args.seed < 0 or args.idle_seconds < 0
            or not math.isfinite(args.p95_ceiling_ms) or args.p95_ceiling_ms <= 0
            or not .99 <= args.minimum_success <= 1):
        parser.error("Invalid rate, phase duration, seed, user count or capacity gate")
    if args.plan == "pilot" and args.rates:
        parser.error("Use --rate for the pilot plateau")
    if args.plan != "pilot":
        if not args.rates or sorted(set(args.rates)) != args.rates or args.rates[0] <= 0:
            parser.error("Provide increasing positive --rates")
        if args.plan != "ramp" and len(args.rates) != 3:
            parser.error("Formal plans require three common rates")
    if args.plan == "contention" and not (args.contention_pod and args.stimulus):
        parser.error("Contention needs a fixed --contention-pod and --stimulus")
    if args.plan in ("chapter5", "contention") and args.measurement < 30:
        parser.error("Burst and contention schedules need at least 30 s of measurement")
    if args.contention_pod and args.plan != "contention":
        parser.error("--contention-pod requires the contention plan")
    if not args.validate_only and args.plan in ("steady", "chapter5", "contention") and not args.capacity_input:
        parser.error("Formal runs need --capacity-input")
    return args


def main():
    args = arguments()
    corpus = read(HERE / "corpus.json")
    validate_corpus(corpus, read(args.schema))
    trials = generate_trials(args)
    for trial in trials:
        measurement(args, trial)
    if args.validate_only:
        print(f"Validated {len(corpus)} corpus rows and {len(trials)} trial definitions offline")
        return

    executable = shutil.which(args.k6)
    if not executable:
        raise RuntimeError("k6 was not found. Install it or pass --k6 with its absolute path")
    if resources.run_command("kubectl", "config", "current-context") != args.context:
        raise RuntimeError(f"Select Kubernetes context {args.context} before running")
    version = resources.run_command(executable, "version")
    if args.node_k6_image:
        service = resources.kubectl("-n", args.namespace, "get", "service", "backend", "-o", "json")
        port = next(p["port"] for p in service["spec"]["ports"] if p["port"] == 8000)
        args.node_service_base = f'http://{service["spec"]["clusterIP"]}:{port}'
        version = resources.run_command("docker", "run", "--rm", args.node_k6_image, "version")
        health = resources.run_command("docker", "run", "--rm", "--network", f"container:{args.context}",
                                       "--entrypoint", "wget", args.node_k6_image,
                                       "-qO-", args.node_service_base + "/health")
        if json.loads(health)["status"] != "healthy":
            raise RuntimeError("Backend Service health check from node network failed")
    config_map = resources.kubectl("-n", args.namespace, "get", "configmap", "mlops-config", "-o", "json")["data"]
    freshness = float(config_map["ADAPTIVE_METRIC_MAX_AGE_S"])
    if not args.restart_gateway and args.idle_seconds < freshness:
        raise RuntimeError(f"Use --idle-seconds >= {freshness:g} to expire request observations")
    cluster = current_cluster(args)
    if args.plan == "contention" and args.contention_pod not in cluster["replicas"]:
        raise ValueError("Contention target is not a ready inference replica")
    if any(row["app"] in ("inference-service", "inference-gateway") and
           not all(c["resources"].get("limits", {}).get("cpu") for c in row["containers"].values())
           for row in cluster["pods"].values()):
        raise RuntimeError("Inference and gateway CPU limits must be available for analysis")
    sample = resources.sample(args.namespace)
    if sample["host_memory"] and sample["host_memory"]["free_bytes"] < 768 * 1024**2:
        raise RuntimeError("Host free memory below 768 MiB at preflight")
    if set(cluster["pods"]) - {row["pod"] for row in sample["pods"]}:
        raise RuntimeError("Metrics Server samples are missing for required workloads")
    prometheus_config = resources.prometheus(args.prom_url, "status/config")["yaml"]
    if "job_name: inference-gateway" not in prometheus_config and 'job_name: "inference-gateway"' not in prometheus_config:
        raise RuntimeError("Prometheus gateway scrape configuration is not loaded")
    preflight_prom = resources.snapshot(args.prom_url, time.time(), WORKLOADS["measurement"]["scrape_seconds"])
    health_snapshot(preflight_prom, cluster)
    if not any(row["metric"].get("span") == "telemetry_retrieval"
               for row in preflight_prom["series"]["gateway_count"]):
        raise RuntimeError("Gateway timing series are unavailable")
    username, password = read_credentials(args.credential_file)
    token, backend_session = login(args.base_url, username, password, 60)
    original = api(args.base_url, STRATEGY, token)
    verify_strategy(original, original["strategy"], cluster["weights"])
    deployments = api(args.base_url, "/api/v1/deployments", token)
    if not args.deployment:
        args.deployment = (deployments[0]["name"] if len(deployments) == 1 else
                           input("Owned benchmark deployment name: "))
    deployment = next((item for item in deployments if item["name"] == args.deployment), None)
    if not deployment:
        raise RuntimeError("Deployment missing from authenticated deployment list")
    schema = api(args.base_url, "/api/v1/deployments/" + quote(args.deployment, safe="") + "/schema", token)
    validate_corpus(corpus, schema)
    capacity_signature = {
        "model": cluster["model"], "deployment": deployment["id"], "model_version": schema["model_version"],
        "weights": cluster["weights"], "corpus_sha256": digest(HERE / "corpus.json"), "vus": args.vus,
        "images": {app: sorted({c["image_id"] for p in cluster["pods"].values() if p["app"] == app
                                for c in p["containers"].values()})
                   for app in {p["app"] for p in cluster["pods"].values()}},
    }
    capacity_signature["limits"] = {
        app: sorted({json.dumps(c["resources"], sort_keys=True) for p in cluster["pods"].values()
                     if p["app"] == app for c in p["containers"].values()})
        for app in capacity_signature["images"]
    }
    capacity_signature.update(
        schema_sha256=hashlib.sha256(json.dumps(schema, sort_keys=True).encode()).hexdigest(),
        prometheus_sha256=hashlib.sha256(prometheus_config.encode()).hexdigest(),
        k6_version=version, script_sha256=digest(HERE / "predict.js"),
        resource_sampler_sha256=digest(HERE / "sample_resources.py"),
        adaptive_settings={k: v for k, v in config_map.items() if k.startswith(("ADAPTIVE_", "WRR_"))},
        replica_order=cluster["replicas"], endpoint_ips=cluster["endpoints"],
        replica_uids=[cluster["pods"][name]["uid"] for name in cluster["replicas"]],
        namespace=args.namespace, context=args.context, base_url=args.base_url,
        minikube_limits=resources.minikube_limits(args.context), gateway_reset=args.restart_gateway,
        generator={"placement": "node network" if args.node_k6_image else "Windows host",
                   "image": args.node_k6_image,
                   "prediction_base": getattr(args, "node_service_base", args.base_url)},
    )
    if args.capacity_input and args.rates:
        from analyze import verify_capacity
        verify_capacity(args.capacity_input, args.rates, capacity_signature, args.minimum_success,
                        args.p95_ceiling_ms)
    root = args.output or HERE.parent / "reports" / args.plan / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    root = root.resolve()
    if args.resume_trial is not None:
        from analyze import verify_inputs
        suite = verify_inputs(root)
        if (suite["capacity_signature"] != capacity_signature or suite["backend_session"] != backend_session
                or suite["order"] != trials or suite["deployment"] != args.deployment
                or any(getattr(args, key) != value for key, value in suite["settings"].items())):
            raise RuntimeError("Resume settings, serving identity or workload differ from the frozen suite")
        index = args.resume_trial
        if index > len(trials):
            raise ValueError("Resume trial number is outside the frozen suite")
        directory = root / f"{index:03d}"
        if directory.exists():
            raise RuntimeError("Resume trial directory already exists; preserve it in the original suite")
        print(f"Resuming {index}/{len(trials)} {trials[index - 1]['strategy']}", flush=True)
        time.sleep(args.idle_seconds)
        run_trial(args, directory, trials[index - 1], cluster, original, username, password,
                  executable, root / "inputs", suite)
        return
    root.mkdir(parents=True)
    inputs = root / "inputs"
    inputs.mkdir()
    for name in ("predict.js", "corpus.json", "workloads.json", "run.py", "sample_resources.py", "analyze.py"):
        shutil.copy2(HERE / name, inputs / name)
    write(inputs / "schema.json", schema)
    (inputs / "prometheus.yaml").write_text(prometheus_config, encoding="utf-8")
    suite_meta = {
        "plan": args.plan, "settings": {key: getattr(args, key) for key in (
            "warmup", "measurement", "cooldown", "repetitions", "idle_seconds", "sample_seconds", "vus",
            "p95_ceiling_ms", "minimum_success", "seed", "context", "namespace", "base_url", "prom_url")},
        "capacity_signature": capacity_signature, "backend_session": backend_session, "deployment": args.deployment, "model_name": schema["model_name"],
        "sha256": {file.name: digest(file) for file in sorted(inputs.iterdir())},
        "git_commit": resources.run_command("git", "-C", str(HERE), "rev-parse", "HEAD"),
        "k6_version": version, "connection_reuse": "k6 default; backend and gateway unchanged",
        "adaptive_settings": {k: v for k, v in config_map.items() if k.startswith(("ADAPTIVE_", "WRR_"))},
        "isolation": ("gateway rollout restart before each trial" if args.restart_gateway else
                      "idle expires request freshness; rolling samples and EMA can carry over"),
        "warmup_rate_max": 5, "order": trials, "preflight_host_memory": sample["host_memory"],
    }
    write(root / "suite.json", suite_meta)
    write(root / "prom-preflight.json", preflight_prom)
    write(root / "resources-preflight.json", sample)
    for index, trial in enumerate(trials, 1):
        print(f"{index}/{len(trials)} {trial['strategy']} {trial['scenario']} {trial['rate']} RPS", flush=True)
        time.sleep(args.idle_seconds)
        run_trial(args, root / f"{index:03d}", trial, cluster, original, username, password,
                  executable, inputs, suite_meta)
    print(f"Evidence saved to {root}")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, KeyError, subprocess.TimeoutExpired) as exc:
        print(f"Benchmark stopped: {exc}", file=sys.stderr)
        sys.exit(1)
