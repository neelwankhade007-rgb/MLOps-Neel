import os
import socket
import json
import ssl
import time
import uuid
import urllib.request
import urllib.error
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
from collections import deque
from typing import Dict, Any, List, Optional
from routing import routing_config, STRATEGY_NATIVE, STRATEGY_WEIGHTED_ROUND_ROBIN, STRATEGY_ADAPTIVE

# Constants
K8S_TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token"
K8S_CA_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
K8S_API_URL = "https://kubernetes.default.svc"
HEADLESS_DNS = "inference-service-headless.mlops.svc.cluster.local"
CLUSTERIP_HOST = "inference-service"

# Dynamic replica palette for UI display (supports any number of replicas)
PALETTE = [
    {"color": "#2563EB", "badge_class": "bg-primary-container text-on-primary"},
    {"color": "#0D9488", "badge_class": "bg-tertiary text-on-tertiary"},
    {"color": "#7C3AED", "badge_class": "bg-secondary text-on-secondary"},
    {"color": "#EA580C", "badge_class": "bg-amber-100 text-amber-800"},
    {"color": "#059669", "badge_class": "bg-emerald-100 text-emerald-800"},
    {"color": "#DB2777", "badge_class": "bg-pink-100 text-pink-800"},
]

def get_replica_meta(idx: int) -> Dict[str, str]:
    item = PALETTE[idx % len(PALETTE)]
    return {
        "name": f"inference-{idx + 1}",
        "color": item["color"],
        "badge_class": item["badge_class"]
    }

class TelemetryAggregator:
    def __init__(self):
        self.history_latency = deque(maxlen=30)
        self.history_distribution = deque(maxlen=30)
        self.history_throughput = deque(maxlen=30)
        self.recent_events = deque(maxlen=60)
        self.last_sample_time: Optional[float] = None
        self.last_request_count: Optional[int] = None


    def _get_k8s_client_headers(self) -> Optional[Dict[str, str]]:
        if os.path.exists(K8S_TOKEN_PATH):
            try:
                with open(K8S_TOKEN_PATH, "r") as f:
                    token = f.read().strip()
                return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
            except Exception:
                pass
        return None

    def _get_ssl_context(self) -> ssl.SSLContext:
        ctx = ssl.create_default_context()
        if os.path.exists(K8S_CA_PATH):
            ctx.load_verify_locations(cafile=K8S_CA_PATH)
        else:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        return ctx

    def get_pod_metrics(self) -> Dict[str, Dict[str, Any]]:
        """Fetch real CPU and memory usage from Kubernetes Metrics Server API."""
        metrics_by_pod = {}
        headers = self._get_k8s_client_headers()
        if not headers:
            return metrics_by_pod

        try:
            req = urllib.request.Request(
                f"{K8S_API_URL}/apis/metrics.k8s.io/v1beta1/namespaces/mlops/pods",
                headers=headers
            )
            ctx = self._get_ssl_context()
            with urllib.request.urlopen(req, context=ctx, timeout=2.0) as resp:
                data = json.loads(resp.read().decode())
                for item in data.get("items", []):
                    pod_name = item.get("metadata", {}).get("name", "")
                    if "inference-service" in pod_name:
                        containers = item.get("containers", [])
                        total_cpu_nanocores = 0
                        total_mem_kib = 0
                        for c in containers:
                            cpu_str = c.get("usage", {}).get("cpu", "0n")
                            mem_str = c.get("usage", {}).get("memory", "0Ki")
                            if cpu_str.endswith("n"):
                                total_cpu_nanocores += int(cpu_str[:-1])
                            elif cpu_str.endswith("u"):
                                total_cpu_nanocores += int(cpu_str[:-1]) * 1000
                            elif cpu_str.endswith("m"):
                                total_cpu_nanocores += int(cpu_str[:-1]) * 1000000

                            if mem_str.endswith("Ki"):
                                total_mem_kib += int(mem_str[:-2])
                            elif mem_str.endswith("Mi"):
                                total_mem_kib += int(mem_str[:-2]) * 1024
                            elif mem_str.endswith("Gi"):
                                total_mem_kib += int(mem_str[:-2]) * 1024 * 1024

                        # Pod limits from workload spec: 500m CPU limit, 512Mi memory limit
                        cpu_millicores = round(total_cpu_nanocores / 1000000.0, 1)
                        mem_mib = round(total_mem_kib / 1024.0, 1)
                        cpu_pct = min(100.0, round((cpu_millicores / 500.0) * 100.0, 1))
                        mem_pct = min(100.0, round((mem_mib / 512.0) * 100.0, 1))

                        metrics_by_pod[pod_name] = {
                            "cpu_millicores": cpu_millicores,
                            "cpu_pct": cpu_pct,
                            "mem_mib": mem_mib,
                            "mem_pct": mem_pct,
                            "raw_cpu": f"{cpu_millicores}m",
                            "raw_mem": f"{mem_mib}Mi"
                        }
        except Exception as e:
            # Metrics server might still be collecting initial samples or RBAC fallback
            pass

        return metrics_by_pod

    def discover_replicas(self) -> List[str]:
        """Discover IP addresses of all inference replica pods."""
        ips = []
        # Method 1: Headless Service DNS resolution
        try:
            _, _, resolved_ips = socket.gethostbyname_ex(HEADLESS_DNS)
            if resolved_ips:
                ips = sorted(resolved_ips)
        except Exception:
            pass

        # Method 2: Kubernetes Endpoints API
        if not ips:
            headers = self._get_k8s_client_headers()
            if headers:
                try:
                    req = urllib.request.Request(
                        f"{K8S_API_URL}/api/v1/namespaces/mlops/endpoints/{CLUSTERIP_HOST}",
                        headers=headers
                    )
                    ctx = self._get_ssl_context()
                    with urllib.request.urlopen(req, context=ctx, timeout=2.0) as resp:
                        ep = json.loads(resp.read().decode())
                        for subset in ep.get("subsets", []):
                            for addr in subset.get("addresses", []):
                                ip = addr.get("ip")
                                if ip and ip not in ips:
                                    ips.append(ip)
                        ips.sort()
                except Exception:
                    pass

        # Fallback to ClusterIP if discovery hasn't resolved
        if not ips:
            ips = [f"{CLUSTERIP_HOST}:8000"]

        return ips

    def fetch_replica_stats(self, target: str) -> Dict[str, Any]:
        """Fetch runtime statistics directly from one inference replica."""
        url = target if target.startswith("http") else (f"http://{target}:8000/stats" if ":" not in target else f"http://{target}/stats")
        t0 = time.perf_counter()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Nexus-Telemetry-Aggregator"})
            with urllib.request.urlopen(req, timeout=1.5) as resp:
                elapsed_ms = (time.perf_counter() - t0) * 1000.0
                data = json.loads(resp.read().decode())
                data["network_ping_ms"] = round(elapsed_ms, 2)
                data["reachable"] = True
                return data
        except Exception as e:
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            return {
                "replica_id": target,
                "is_ready": False,
                "reachable": False,
                "requests_served": 0,
                "requests_success": 0,
                "requests_error": 0,
                "active_requests": 0,
                "avg_latency_ms": 0.0,
                "p50_latency_ms": 0.0,
                "p95_latency_ms": 0.0,
                "p99_latency_ms": 0.0,
                "recent_requests": [],
                "network_ping_ms": round(elapsed_ms, 2),
                "error": str(e)
            }

    def get_gateway_runtime_status(self) -> Dict[str, Any]:
        """Query gateway /ready to determine actual active routing mechanism from runtime evidence."""
        active_strategy = routing_config.get_strategy()
        gateway_host = os.environ.get("GATEWAY_URL", "http://inference-gateway:8080")
        url = f"{gateway_host}/ready"
        t0 = time.perf_counter()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Nexus-Telemetry-Aggregator"})
            with urllib.request.urlopen(req, timeout=1.2) as resp:
                elapsed_ms = (time.perf_counter() - t0) * 1000.0
                if resp.status == 200:
                    data = json.loads(resp.read().decode())
                    if data.get("status") == "ready" and active_strategy != STRATEGY_NATIVE:
                        label = routing_config.get_strategy_label()
                        wrr_weights = data.get("wrr_weights", routing_config.to_dict()["wrr_weights"])
                        if active_strategy == STRATEGY_WEIGHTED_ROUND_ROBIN:
                            strategy_detail = f"weighted distribution ({':'.join(map(str, wrr_weights))})"
                        elif active_strategy == STRATEGY_ADAPTIVE:
                            strategy_detail = "lowest composite penalty using latency, active requests, CPU, and errors"
                        else:
                            strategy_detail = "equal distribution"
                        return {
                            "is_active": True,
                            "strategy": label,
                            "strategy_desc": f"Custom L7 Gateway ({strategy_detail} across {data.get('available_replicas', 3)} ready replicas)",
                            "gateway_url": gateway_host,
                            "decision_ms": round(elapsed_ms, 2),
                            "decision_desc": f"L7 User-Space Reverse Proxy (~{round(elapsed_ms, 1)}ms gateway overhead)",
                            "model_run_id": data.get("model_run_id"),
                            "available_replicas": data.get("available_replicas", 3)
                        }
        except Exception:
            pass
        if active_strategy != STRATEGY_NATIVE:
            return {
                "is_active": False,
                "strategy": routing_config.get_strategy_label(),
                "strategy_desc": "Gateway strategy selected, but no ready gateway is available",
                "gateway_url": gateway_host,
                "decision_ms": None,
                "decision_desc": "Gateway unavailable",
                "model_run_id": None,
                "available_replicas": 0
            }
        return {
            "is_active": False,
            "strategy": "Native Kubernetes Service",
            "strategy_desc": "L4 iptables round-robin without worker queue awareness",
            "gateway_url": None,
            "decision_ms": None,
            "decision_desc": "N/A (In-kernel L4 iptables routing, <0.1ms overhead)",
            "model_run_id": None,
            "available_replicas": 0
        }

    def get_telemetry_snapshot(self, weights: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
        """Produce full live telemetry matching the Stitch dashboard specification."""
        if weights is None:
            weights = {"lat": 0.40, "req": 0.30, "cpu": 0.20, "err": 0.10}

        w_lat = weights.get("lat", 0.40)
        w_req = weights.get("req", 0.30)
        w_cpu = weights.get("cpu", 0.20)
        w_err = weights.get("err", 0.10)

        # 1. Discover pods and fetch stats concurrently
        replica_ips = self.discover_replicas()
        pod_metrics = self.get_pod_metrics()
        gw_status = self.get_gateway_runtime_status()
        is_gw = gw_status["is_active"]

        with ThreadPoolExecutor(max_workers=max(3, len(replica_ips))) as executor:
            raw_stats = list(executor.map(self.fetch_replica_stats, replica_ips))

        # Sort replicas deterministically by replica_id
        raw_stats.sort(key=lambda x: str(x.get("replica_id", "")))

        # 2. Process each replica
        total_requests = 0
        total_success = 0
        total_errors = 0
        total_active = 0
        healthy_count = 0
        all_recent_requests = []
        p95_values = []
        p50_values = []
        p99_values = []
        latencies_for_avg = []

        processed_replicas = []
        for idx, stat in enumerate(raw_stats):
            rep_id = stat.get("replica_id", f"inference-{idx+1}")
            is_ready = bool(stat.get("is_ready", False))
            reachable = bool(stat.get("reachable", False))

            if is_ready and reachable:
                healthy_count += 1
                status_str = "HEALTHY"
            elif reachable:
                status_str = "DEGRADED"
            else:
                status_str = "UNAVAILABLE"

            req_served = stat.get("requests_served", 0)
            req_success = stat.get("requests_success", req_served)
            req_error = stat.get("requests_error", 0)
            active_req = stat.get("active_requests", 0)
            avg_lat = stat.get("avg_latency_ms", 0.0)
            p50 = stat.get("p50_latency_ms", avg_lat)
            p95 = stat.get("p95_latency_ms", avg_lat)
            p99 = stat.get("p99_latency_ms", avg_lat)

            total_requests += req_served
            total_success += req_success
            total_errors += req_error
            total_active += active_req

            if p95 > 0:
                p95_values.append(p95)
            if p50 > 0:
                p50_values.append(p50)
            if p99 > 0:
                p99_values.append(p99)
            if avg_lat > 0:
                latencies_for_avg.append(avg_lat)

            # Match with Metrics Server pod usage - NO FAKE FALLBACKS
            pod_metric = pod_metrics.get(rep_id)
            if pod_metric:
                cpu_pct = pod_metric.get("cpu_pct", 0.0)
                mem_pct = pod_metric.get("mem_pct", 0.0)
                cpu_raw = pod_metric.get("raw_cpu", "0m")
                mem_raw = pod_metric.get("raw_mem", "0Mi")
                metrics_available = True
            else:
                cpu_pct = None
                mem_pct = None
                cpu_raw = "N/A"
                mem_raw = "N/A"
                metrics_available = False

            err_rate = (req_error / req_served * 100.0) if req_served > 0 else 0.0

            # Collect recent request logs
            for r in stat.get("recent_requests", []):
                all_recent_requests.append(r)

            meta = get_replica_meta(idx)

            processed_replicas.append({
                "index": idx + 1,
                "name": meta["name"],
                "replica_id": rep_id,
                "color": meta["color"],
                "badge_class": meta["badge_class"],

                "node_name": "minikube",
                "pod_ip": replica_ips[idx] if idx < len(replica_ips) else "10.244.0.x",
                "status": status_str,
                "is_ready": is_ready,
                "reachable": reachable,
                "requests_served": req_served,
                "requests_success": req_success,
                "requests_error": req_error,
                "error_rate_pct": round(err_rate, 2),
                "active_requests": active_req,
                "avg_latency_ms": round(avg_lat, 2),
                "p50_latency_ms": round(p50, 2) if req_served >= 3 else round(avg_lat, 2),
                "p95_latency_ms": round(p95, 2) if req_served >= 5 else None,
                "p99_latency_ms": round(p99, 2) if req_served >= 10 else None,
                "sample_count": req_served,
                "cpu_pct": cpu_pct,
                "mem_pct": mem_pct,
                "cpu_raw": cpu_raw,
                "mem_raw": mem_raw,
                "metrics_available": metrics_available,
                "traffic_share_pct": 0.0, # calculated below
                "score": 0.0, # calculated below (benchmark preview)
                "is_optimal": False
            })

        # Calculate traffic shares & composite penalty score
        if total_requests > 0:
            for r in processed_replicas:
                r["traffic_share_pct"] = round((r["requests_served"] / total_requests) * 100.0, 1)
        else:
            share = round(100.0 / max(1, len(processed_replicas)), 1)
            for r in processed_replicas:
                r["traffic_share_pct"] = share

        # Compute normalized penalty score (Benchmark Preview):
        # S_i = w_lat * L_norm + w_req * R_norm + w_cpu * C_norm + w_err * E_norm
        valid_lats = [r["avg_latency_ms"] for r in processed_replicas if r["avg_latency_ms"] > 0]
        max_lat = max(valid_lats or [1.0])
        max_req = max([r["active_requests"] for r in processed_replicas] or [1.0]) or 10.0
        max_cpu = 100.0
        max_err = max([r["error_rate_pct"] for r in processed_replicas] or [1.0]) or 5.0

        lowest_score = 9999.0
        optimal_idx = 0
        for i, r in enumerate(processed_replicas):
            if not r["is_ready"]:
                score = 1.000
            else:
                lat_val = r["avg_latency_ms"]
                l_norm = min(1.0, lat_val / max(1.0, max_lat))
                r_norm = min(1.0, r["active_requests"] / max(1.0, max_req))
                cpu_val = r["cpu_pct"] if r["cpu_pct"] is not None else 0.0
                c_norm = min(1.0, cpu_val / max_cpu)
                e_norm = min(1.0, r["error_rate_pct"] / max_err)
                score = round(w_lat * l_norm + w_req * r_norm + w_cpu * c_norm + w_err * e_norm, 3)

            r["score"] = score
            if score < lowest_score and r["is_ready"]:
                lowest_score = score
                optimal_idx = i

        if processed_replicas:
            processed_replicas[optimal_idx]["is_optimal"] = True

        # Calculate throughput (req/s) from requests delta over actual elapsed time
        now = time.time()
        has_reachable_replicas = any(r.get("reachable", False) for r in processed_replicas)

        if self.last_sample_time is None or self.last_request_count is None:
            # Baseline initialization on first sample: establish count baseline without false spike
            time_delta = 5.0
            throughput_rps = 0.0
            if has_reachable_replicas:
                self.last_sample_time = now
                self.last_request_count = total_requests
        elif not has_reachable_replicas:
            # If replicas are temporarily unreachable, settle to 0.0 without corrupting baseline count
            time_delta = max(0.5, now - self.last_sample_time)
            throughput_rps = 0.0
            self.last_sample_time = now
        else:
            time_delta = max(0.5, now - self.last_sample_time)
            req_delta = max(0, total_requests - self.last_request_count)
            throughput_rps = round(req_delta / time_delta, 1) if req_delta > 0 else 0.0
            self.last_sample_time = now
            self.last_request_count = total_requests

        # Aggregate summary numbers
        valid_p95 = [v for v in p95_values if v > 0]
        overall_p95 = round(max(valid_p95), 1) if (valid_p95 and total_requests >= 5) else None
        valid_p50 = [v for v in p50_values if v > 0]
        overall_p50 = round(sum(valid_p50) / len(valid_p50), 1) if (valid_p50 and total_requests >= 3) else None
        valid_p99 = [v for v in p99_values if v > 0]
        overall_p99 = round(max(valid_p99), 1) if (valid_p99 and total_requests >= 10) else None
        overall_err_rate = round((total_errors / total_requests * 100.0), 2) if total_requests > 0 else 0.0

        # Sort recent requests by authentic timestamp and merge with recorded events
        routing_label = "Custom Gateway (Round Robin)" if is_gw else "Native K8s Service (L4 iptables)"
        seen_req_ids = set()
        merged_events = []

        # First add recorded events from test / automatic traffic
        for ev in list(self.recent_events):
            req_id = ev.get("request_id")
            if req_id and req_id not in seen_req_ids:
                seen_req_ids.add(req_id)
                matched_rep = next((r for r in processed_replicas if r["replica_id"] == ev.get("replica_id")), None)
                if matched_rep:
                    ev["assigned_pod"] = matched_rep["name"]
                merged_events.append(ev)

        # Next add events reported directly by replicas
        for ev in all_recent_requests:
            req_id = ev.get("id") or ev.get("request_id")
            if req_id and req_id not in seen_req_ids:
                seen_req_ids.add(req_id)
                matched_rep = next((r for r in processed_replicas if r["replica_id"] == ev.get("replica_id")), None)
                rep_name = matched_rep["name"] if matched_rep else ev.get("replica_id", "inference-node")
                lat = ev.get("latency_ms", 0.0)
                merged_events.append({
                    "timestamp": ev.get("timestamp", datetime.utcnow().strftime("%H:%M:%S.%f")[:-3]),
                    "request_id": req_id,
                    "assigned_pod": rep_name,
                    "replica_id": ev.get("replica_id"),
                    "routing_mechanism": ev.get("routing_strategy", routing_label),
                    "observed_latency_ms": lat,
                    "duration_ms": lat,
                    "start_epoch_ms": ev.get("start_epoch_ms", int(time.time() * 1000)),
                    "http_status": ev.get("status_text", "200 OK"),
                    "status_code": 200,
                    "traffic_type": "in_cluster"
                })

        merged_events.sort(key=lambda x: str(x.get("timestamp", "")), reverse=True)
        recent_log = merged_events[:50]

        # Record point in time-series history
        current_time_str = datetime.utcnow().strftime("%H:%M:%S")
        self.history_latency.append({
            "timestamp": current_time_str,
            "p50": overall_p50 or (latencies_for_avg[0] if latencies_for_avg else 0.0),
            "p95": overall_p95 or 0.0,
            "p99": overall_p99 or 0.0
        })

        dist_point = {"timestamp": current_time_str}
        for r in processed_replicas:
            dist_point[r["name"]] = r["traffic_share_pct"]
        self.history_distribution.append(dist_point)

        self.history_throughput.append({
            "timestamp": current_time_str,
            "rps": throughput_rps,
            "errors": total_errors,
            "error_rate": overall_err_rate
        })

        return {
            "summary": {
                "throughput_rps": throughput_rps,
                "throughput_window_s": round(time_delta, 1),
                "p95_latency_ms": overall_p95,
                "p50_latency_ms": overall_p50,
                "p99_latency_ms": overall_p99,
                "error_rate_pct": overall_err_rate,
                "healthy_replicas": healthy_count,
                "total_replicas": len(processed_replicas),
                "total_requests": total_requests,
                "total_success": total_success,
                "total_errors": total_errors,
                "active_requests": total_active,
                "gateway_decision_ms": gw_status["decision_ms"],
                "gateway_decision_desc": gw_status["decision_desc"],
                "active_policy": gw_status["strategy"],
                "active_policy_desc": gw_status["strategy_desc"],
                "gateway_active": is_gw,
                "gateway_url": gw_status["gateway_url"],
                "model_name": "titanic-classifier:b0ca6d39",
                "namespace": "mlops",
                "cluster_name": "Minikube Local Cluster (v1.37)",
                "last_sync_utc": datetime.utcnow().strftime("%H:%M:%S UTC")
            },
            "replicas": processed_replicas,
            "recent_events": recent_log,
            "history": {
                "latency_trend": list(self.history_latency),
                "distribution_trend": list(self.history_distribution),
                "throughput_trend": list(self.history_throughput)
            }
        }

    def send_test_traffic(
        self,
        count: int = 1,
        strategy_override: Optional[str] = None,
        traffic_type: str = "test"
    ) -> List[Dict[str, Any]]:
        """Send test predictions through the active or overridden routing strategy."""
        count = max(1, min(25, count))
        results = []
        target_url, default_strategy = routing_config.get_target_url()
        strategy = strategy_override or default_strategy
        if strategy_override and strategy_override != default_strategy:
            if strategy_override == STRATEGY_NATIVE:
                target_url = f"{routing_config.native_url}/predict"
            else:
                target_url = f"{routing_config.gateway_url}/predict"

        primary_url = target_url
        fallback_url = f"http://{CLUSTERIP_HOST}:8000/predict"

        # Titanic sample payload
        sample_payload = {
            "features": {
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
            }
        }
        data_bytes = json.dumps(sample_payload).encode("utf-8")

        for _ in range(count):
            t0 = time.perf_counter()
            start_epoch_ms = int(time.time() * 1000)
            t_start_iso = datetime.utcnow().strftime("%H:%M:%S.%f")[:-3]
            used_url = primary_url
            try:
                headers = {"Content-Type": "application/json"}
                if strategy != STRATEGY_NATIVE:
                    headers["X-Routing-Strategy"] = strategy
                headers["X-Traffic-Type"] = traffic_type

                req = urllib.request.Request(
                    primary_url,
                    data=data_bytes,
                    headers=headers
                )
                try:
                    resp_ctx = urllib.request.urlopen(req, timeout=3.0)
                except urllib.error.URLError:
                    # Fallback to ClusterIP if gateway not reachable
                    used_url = fallback_url
                    req_fb = urllib.request.Request(
                        fallback_url,
                        data=data_bytes,
                        headers={"Content-Type": "application/json"}
                    )
                    resp_ctx = urllib.request.urlopen(req_fb, timeout=3.0)

                with resp_ctx as resp:
                    elapsed = round((time.perf_counter() - t0) * 1000.0, 2)
                    t_end_iso = datetime.utcnow().strftime("%H:%M:%S.%f")[:-3]
                    body = json.loads(resp.read().decode())
                    gw_meta = body.get("gateway_meta", {})
                    rep_id = body.get("replica_id") or gw_meta.get("selected_replica", "unknown")
                    gw_lat = gw_meta.get("gateway_latency_ms")
                    upstream_lat = gw_meta.get("upstream_latency_ms", body.get("latency_ms", elapsed))
                    used_strategy = gw_meta.get("routing_strategy", strategy)

                    record = {
                        "request_id": body.get("request_id", f"req-{uuid.uuid4().hex[:6]}"),
                        "replica_id": rep_id,
                        "prediction": body.get("prediction", "1"),
                        "latency_ms": body.get("latency_ms", elapsed),
                        "roundtrip_ms": elapsed,
                        "duration_ms": elapsed,
                        "start_time": t_start_iso,
                        "start_epoch_ms": start_epoch_ms,
                        "end_time": t_end_iso,
                        "gateway_latency_ms": gw_lat,
                        "upstream_latency_ms": upstream_lat,
                        "routing_strategy": used_strategy,
                        "traffic_type": traffic_type,
                        "status": 200,
                        "status_text": "200 OK",
                        "timestamp": t_start_iso
                    }
                    results.append(record)
                    self.recent_events.appendleft({
                        "timestamp": t_start_iso,
                        "request_id": record["request_id"],
                        "assigned_pod": rep_id.split("-")[-1] if "-" in rep_id else rep_id,
                        "replica_id": rep_id,
                        "routing_mechanism": used_strategy,
                        "observed_latency_ms": record["latency_ms"],
                        "duration_ms": elapsed,
                        "start_epoch_ms": start_epoch_ms,
                        "gateway_latency_ms": gw_lat,
                        "upstream_latency_ms": upstream_lat,
                        "http_status": "200 OK",
                        "status_code": 200,
                        "traffic_type": traffic_type
                    })
            except urllib.error.HTTPError as he:
                elapsed = round((time.perf_counter() - t0) * 1000.0, 2)
                t_end_iso = datetime.utcnow().strftime("%H:%M:%S.%f")[:-3]
                record = {
                    "request_id": f"req-{uuid.uuid4().hex[:6]}",
                    "replica_id": "error",
                    "latency_ms": elapsed,
                    "duration_ms": elapsed,
                    "start_time": t_start_iso,
                    "start_epoch_ms": start_epoch_ms,
                    "end_time": t_end_iso,
                    "routing_strategy": strategy,
                    "traffic_type": traffic_type,
                    "status": he.code,
                    "status_text": f"{he.code} Error",
                    "timestamp": t_start_iso
                }
                results.append(record)
                self.recent_events.appendleft({
                    "timestamp": t_start_iso,
                    "request_id": record["request_id"],
                    "assigned_pod": "error",
                    "replica_id": "error",
                    "routing_mechanism": strategy,
                    "observed_latency_ms": elapsed,
                    "duration_ms": elapsed,
                    "start_epoch_ms": start_epoch_ms,
                    "http_status": f"{he.code} Error",
                    "status_code": he.code,
                    "traffic_type": traffic_type
                })
            except Exception as e:
                elapsed = round((time.perf_counter() - t0) * 1000.0, 2)
                t_end_iso = datetime.utcnow().strftime("%H:%M:%S.%f")[:-3]
                record = {
                    "request_id": f"req-{uuid.uuid4().hex[:6]}",
                    "replica_id": "unavailable",
                    "latency_ms": elapsed,
                    "duration_ms": elapsed,
                    "start_time": t_start_iso,
                    "start_epoch_ms": start_epoch_ms,
                    "end_time": t_end_iso,
                    "routing_strategy": strategy,
                    "traffic_type": traffic_type,
                    "status": 500,
                    "status_text": f"Error: {str(e)[:30]}",
                    "timestamp": t_start_iso
                }
                results.append(record)
                self.recent_events.appendleft({
                    "timestamp": t_start_iso,
                    "request_id": record["request_id"],
                    "assigned_pod": "unavailable",
                    "replica_id": "unavailable",
                    "routing_mechanism": strategy,
                    "observed_latency_ms": elapsed,
                    "duration_ms": elapsed,
                    "start_epoch_ms": start_epoch_ms,
                    "http_status": "500 Error",
                    "status_code": 500,
                    "traffic_type": traffic_type
                })

        return results

# Singleton instance
telemetry_aggregator = TelemetryAggregator()

