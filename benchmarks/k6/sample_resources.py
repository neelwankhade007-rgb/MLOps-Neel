"""Read-only Kubernetes and Prometheus collection for benchmark trials."""
import ctypes
import json
import re
import subprocess
import time
from datetime import datetime
from urllib.parse import urlencode, quote
from urllib.request import urlopen

SELECTOR = "app in (backend,inference-gateway,inference-service,prometheus)"
INFERENCE = 'inference_requests_total{job="inference-replicas"}'
GATEWAY = 'gateway_span_duration_seconds_{kind}{job="inference-gateway"}'
QUERIES = {
    "inference": INFERENCE,
    "gateway_count": GATEWAY.replace("{kind}", "count"),
    "gateway_sum": GATEWAY.replace("{kind}", "sum"),
    "up": 'up{job=~"inference-replicas|inference-gateway"}',
}


def run_command(*args, timeout=20):
    result = subprocess.run(args, capture_output=True, text=True, encoding="utf-8",
                            errors="replace", timeout=timeout)
    if result.returncode:
        raise RuntimeError(f"{args[0]} {args[1]} exited {result.returncode}")
    return result.stdout.strip()


def kubectl(*args):
    return json.loads(run_command("kubectl", *args))


def pods(namespace):
    result = {}
    for pod in kubectl("-n", namespace, "get", "pods", "-l", SELECTOR, "-o", "json")["items"]:
        meta, status, spec = pod["metadata"], pod["status"], pod["spec"]
        containers = {c["name"]: c for c in status.get("containerStatuses", [])}
        result[meta["name"]] = {
            "uid": meta["uid"], "app": meta["labels"]["app"], "ip": status.get("podIP"),
            "node": spec["nodeName"], "ready": not meta.get("deletionTimestamp") and
            any(c["type"] == "Ready" and c["status"] == "True" for c in status.get("conditions", [])),
            "containers": {
                c["name"]: {
                    "image": c["image"],
                    "image_id": containers.get(c["name"], {}).get("imageID"),
                    "restarts": containers.get(c["name"], {}).get("restartCount"),
                    "container_id": containers.get(c["name"], {}).get("containerID"),
                    "resources": c.get("resources", {}),
                } for c in spec["containers"]
            },
        }
    return result


def pod_readiness(namespace, pod, port, route="ready"):
    return kubectl("get", "--raw", f"/api/v1/namespaces/{namespace}/pods/{quote(pod)}:{port}/proxy/{route}")


def cpu_millicores(value):
    for suffix, scale in (("n", .000001), ("u", .001), ("m", 1)):
        if value.endswith(suffix):
            return float(value[:-1]) * scale
    return float(value) * 1000


def memory_bytes(value):
    for i, prefix in enumerate("KMGTPE", 1):
        if value.endswith(prefix + "i"):
            return float(value[:-2]) * 1024**i
        if value.endswith(prefix):
            return float(value[:-1]) * 1000**i
    if value.endswith("k"):
        return float(value[:-1]) * 1000
    return float(value)


def host_memory():
    try:
        class MemoryStatus(ctypes.Structure):
            _fields_ = [("length", ctypes.c_uint32), ("load", ctypes.c_uint32)] + [
                (key, ctypes.c_uint64) for key in (
                    "total", "free", "page_total", "page_free", "virtual", "virtual_free", "extended"
                )
            ]

        status = MemoryStatus()
        status.length = ctypes.sizeof(status)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return {"total_bytes": status.total, "free_bytes": status.free, "load_pct": status.load}
    except AttributeError:
        pass
    return None


def host_cpu_ticks():
    """Windows cumulative 100 ns ticks. Kernel includes idle time."""
    try:
        idle, kernel, user = (ctypes.c_uint64() for _ in range(3))
        if ctypes.windll.kernel32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):
            return {"idle": idle.value, "kernel": kernel.value, "user": user.value}
    except AttributeError:
        pass
    return None


CADVISOR_METRICS = {
    "container_cpu_usage_seconds_total", "container_memory_working_set_bytes",
    "container_cpu_cfs_periods_total", "container_cpu_cfs_throttled_periods_total",
    "container_cpu_cfs_throttled_seconds_total",
}


def cadvisor_samples(namespace, identities):
    result = []
    for node in sorted({pod["node"] for pod in identities.values()}):
        raw = run_command("kubectl", "get", "--raw", f"/api/v1/nodes/{quote(node)}/proxy/metrics/cadvisor")
        for line in raw.splitlines():
            name, _, body = line.partition("{")
            if name not in CADVISOR_METRICS:
                continue
            labels, _, observation = body.rpartition("} ")
            fields = dict(re.findall(r'(\w+)="([^"]*)"', labels))
            pod_name = fields.get("pod")
            pod = identities.get(pod_name)
            if not pod or pod["node"] != node or fields.get("namespace") != namespace:
                continue
            container = pod["containers"].get(fields.get("container"))
            if not container or not container["container_id"] or fields.get("name") != container["container_id"].split("://", 1)[-1]:
                continue
            if name == "container_cpu_usage_seconds_total" and fields.get("cpu") != "total":
                continue
            value, source_ms = observation.split()
            result.append({"metric": name, "pod": pod_name, "uid": pod["uid"],
                           "container": fields["container"], "container_id": container["container_id"],
                           "source_ms": int(source_ms), "value": float(value)})
    return result


def sample(namespace, use_cadvisor=False):
    observed = time.time()
    identities = pods(namespace)
    if use_cadvisor:
        return {"collected_epoch": observed, "identity": identities,
                "cadvisor": cadvisor_samples(namespace, identities),
                "host_memory": host_memory(), "host_cpu_ticks": host_cpu_ticks()}
    metrics = kubectl("get", "--raw", f"/apis/metrics.k8s.io/v1beta1/namespaces/{namespace}/pods")
    data = []
    for item in metrics["items"]:
        name = item["metadata"]["name"]
        pod = identities.get(name)
        if not pod:
            continue
        usage = item["containers"]
        limits = [c["resources"].get("limits", {}).get("cpu") for c in pod["containers"].values()]
        limit = sum(map(cpu_millicores, limits)) if all(limits) else None
        cpu = sum(cpu_millicores(c["usage"]["cpu"]) for c in usage)
        source = datetime.fromisoformat(item["timestamp"].replace("Z", "+00:00")).timestamp()
        data.append({
            "pod": name, "uid": pod["uid"], "app": pod["app"], "timestamp": item["timestamp"],
            "source_epoch": source, "window": item["window"], "containers": usage,
            "cpu_millicores": cpu, "cpu_limit_millicores": limit,
            "cpu_pct": cpu / limit * 100 if limit else None,
            "memory_bytes": sum(memory_bytes(c["usage"]["memory"]) for c in usage),
        })
    return {"collected_epoch": observed, "completed_epoch": time.time(), "pods": data,
            "identity": identities, "host_memory": host_memory(), "host_cpu_ticks": host_cpu_ticks()}


def collect(namespace, path, stop, interval):
    with path.open("x", encoding="utf-8") as output:
        while not stop.is_set():
            start = time.monotonic()
            try:
                row = sample(namespace, use_cadvisor=True)
            except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as exc:
                row = {"collected_epoch": time.time(), "error": type(exc).__name__}
            output.write(json.dumps(row) + "\n")
            output.flush()
            stop.wait(max(0, interval - (time.monotonic() - start)))


def prometheus(base, route, **params):
    suffix = "?" + urlencode(params) if params else ""
    with urlopen(base.rstrip("/") + "/api/v1/" + route + suffix, timeout=8) as response:
        payload = json.load(response)
    if payload["status"] != "success" or payload.get("warnings"):
        raise RuntimeError("Prometheus query unsuccessful or incomplete")
    return payload["data"]


def snapshot(base, after, scrape_seconds):
    """Capture actual scrape timestamps using range vectors at one evaluation time."""
    time.sleep(max(0, after + 2 * scrape_seconds - time.time()))
    evaluation = time.time()
    return {
        "after": after, "evaluation": evaluation,
        "series": {
            key: prometheus(base, "query", query=f"{query}[{3 * scrape_seconds}s]", time=evaluation)["result"]
            for key, query in QUERIES.items()
        },
    }


def throttle_snapshot(namespace, identities):
    """Best-effort cAdvisor counter capture, and record collection failures."""
    names = {r["node"] for r in identities.values()}
    metrics = ("container_cpu_cfs_periods_total", "container_cpu_cfs_throttled_periods_total",
               "container_cpu_cfs_throttled_seconds_total")
    result = {}
    for node in sorted(names):
        try:
            raw = run_command("kubectl", "get", "--raw", f"/api/v1/nodes/{quote(node)}/proxy/metrics/cadvisor")
            pods_on_node = [name for name, data in identities.items() if data["node"] == node]
            result[node] = [line for line in raw.splitlines()
                            if line.startswith(tuple(metric + "{" for metric in metrics))
                            and f'namespace="{namespace}"' in line
                            and any(f'pod="{name}"' in line for name in pods_on_node)]
        except (RuntimeError, OSError, subprocess.TimeoutExpired) as exc:
            result[node] = {"error": type(exc).__name__}
    return {"time": time.time(), "node_metrics": result}



def minikube_limits(profile):
    config = json.loads(run_command("docker", "inspect", profile, "--format", "{{json .HostConfig}}"))
    # Export only resource settings. The full container configuration can contain sensitive values.
    limits = {key: config[key] for key in ("NanoCpus", "CpuQuota", "CpuPeriod", "Memory", "CpusetCpus")}
    limits["cgroup_v2"] = run_command("docker", "exec", profile, "cat",
                                     "/sys/fs/cgroup/cpu.max", "/sys/fs/cgroup/memory.max",
                                     "/sys/fs/cgroup/cpuset.cpus.effective").splitlines()
    return limits
