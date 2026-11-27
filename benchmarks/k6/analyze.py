"""Validate immutable k6 evidence and generate Chapter 5 CSV tables and SVG figures."""
import argparse
from collections import Counter, defaultdict
import csv
from datetime import datetime, timezone
from html import escape
import json
import math
import re
from pathlib import Path
import statistics


def rows(path):
    with path.open(encoding="utf-8-sig") as source:
        for line in source:
            if line.strip():
                yield json.loads(line)


def read_requests(path):
    result = []
    with path.open(encoding="utf-8-sig") as source:
        for line in source:
            if line.strip():
                # k6 console files can prefix the JSON message with timestamp and level.
                start = line.find('{"iteration":')
                if start < 0:
                    raise ValueError(f"Unrecognized k6 console record in {path.name}")
                value, remainder = json.JSONDecoder().raw_decode(line[start:])
                if line[start + remainder:].strip():
                    raise ValueError(f"Trailing data in {path.name}")
                result.append(value)
    return result


def epoch(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def k6_counts(path):
    result = {"dropped": 0, "iterations": 0, "requests": 0, "completed": 0,
              "valid": 0, "timeouts": 0, "invalid": 0, "dropped_points": []}
    names = {"dropped_iterations": "dropped", "iterations": "iterations",
             "http_reqs": "requests", "nexus_completed": "completed"}
    for point in rows(path):
        if point["type"] != "Point" or point["metric"] not in names:
            continue
        kind = names[point["metric"]]
        data = point["data"]
        n = int(data["value"])
        result[kind] += n
        if kind == "dropped":
            result["dropped_points"].append((epoch(data["time"]), n))
        if kind == "completed":
            result["valid" if data["tags"]["valid"] == "true" else "invalid"] += n
            if data["tags"]["timeout"] == "true":
                result["timeouts"] += n
    return result


def percentile(values, p):
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * p
    low, high = math.floor(position), math.ceil(position)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def mean(values):
    values = [v for v in values if v is not None]
    return statistics.mean(values) if values else None


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def series_map(snapshot, name):
    return {tuple(sorted(row["metric"].items())): row["values"] for row in snapshot["series"][name]}


def counter_delta(before, after, name, allow_new=False):
    initial, final = series_map(before, name), series_map(after, name)
    result = []
    if set(initial) - set(final):
        raise ValueError(f"{name}: counter series disappeared")
    for key, values in final.items():
        old = initial.get(key)
        if (not old and not allow_new) or (old and old[-1][0] < before["after"]) or values[-1][0] < after["after"]:
            raise ValueError(f"{name}: missing fresh counter boundary")
        if old and values[-1][0] <= old[-1][0]:
            raise ValueError(f"{name}: scrape timestamps did not advance")
        prior = float(old[-1][1]) if old else 0
        sequence = [prior] + [float(value) for t, value in values if not old or t > old[-1][0]]
        if not all(math.isfinite(v) and v >= 0 for v in sequence):
            raise ValueError(f"{name}: non-finite or negative counter")
        if any(a > b for a, b in zip(sequence, sequence[1:])):
            raise ValueError(f"{name}: counter reset")
        result.append((dict(key), sequence[-1] - sequence[0]))
    return result


def cadvisor_windows(observations, identity, start, end):
    metrics = ("container_cpu_usage_seconds_total", "container_memory_working_set_bytes")
    result = {}
    for name, pod in identity.items():
        # The benchmark deployments have one regular container. Refuse partial pod sums.
        if len(pod["containers"]) != 1:
            continue
        container, spec = next(iter(pod["containers"].items()))
        values = defaultdict(dict)
        for row in observations:
            if (row["pod"], row["uid"], row["container"], row["container_id"]) != (
                    name, pod["uid"], container, spec["container_id"]):
                continue
            value = row["value"]
            if not math.isfinite(value) or value < 0:
                raise ValueError("Invalid cAdvisor measurement")
            series = values[row["metric"]]
            timestamp = row["source_ms"]
            if timestamp in series and series[timestamp] != value:
                raise ValueError("Conflicting cAdvisor sample at the same source timestamp")
            series[timestamp] = value
        cpu, memory = (values[key] for key in metrics)
        samples = sorted(cpu)
        raw_limit = spec["resources"].get("limits", {}).get("cpu")
        from sample_resources import cpu_millicores
        limit = cpu_millicores(raw_limit) if raw_limit else None
        for left, right in zip(samples, samples[1:]):
            if cpu[right] < cpu[left]:
                raise ValueError(f"cAdvisor CPU counter reset for {name}")
            seconds = (right - left) / 1000
            if not (start <= left / 1000 < right / 1000 <= end and seconds <= 30 and right in memory):
                continue
            millicores = (cpu[right] - cpu[left]) * 1000 / seconds
            result[(pod["uid"], str(right))] = {
                "pod": name, "uid": pod["uid"], "app": pod["app"],
                "timestamp": datetime.fromtimestamp(right / 1000, timezone.utc).isoformat(),
                "source_epoch": right / 1000, "seconds": right / 1000 - start,
                "window": f"{seconds}s", "cpu_millicores": millicores, "cpu_limit_millicores": limit,
                "cpu_pct": millicores / limit * 100 if limit else None,
                "memory_bytes": memory[right], "source": "kubelet_cadvisor",
            }
    return result


def resource_results(path, identity, start, end):
    unique = {}
    errors = 0
    churn = False
    observations = []
    for sample in rows(path):
        if "error" in sample:
            errors += 1
            continue
        churn |= sample["identity"] != identity
        observations.extend(sample.get("cadvisor", []))
        for value in sample.get("pods", []):
            source = value["source_epoch"]
            window = value["window"]
            # Include only CPU windows fully inside the arrival interval.
            pieces = re.findall(r"(\d+(?:\.\d+)?)(ms|us|µs|ns|h|m|s)", window)
            if not pieces:
                continue
            seconds = sum(float(n) * {"h": 3600, "m": 60, "s": 1, "ms": .001,
                                      "us": 1e-6, "µs": 1e-6, "ns": 1e-9}[unit] for n, unit in pieces)
            if start <= source - seconds and source <= end:
                unique[(value["uid"], value["timestamp"])] = value | {"seconds": source - start}
    if observations:
        unique.update(cadvisor_windows(observations, identity, start, end))
    series = sorted(unique.values(), key=lambda r: (r["pod"], r["seconds"]))
    summaries = {}
    for pod in identity:
        samples = [r for r in series if r["pod"] == pod]
        summaries[pod] = {"cpu_pct": mean([r["cpu_pct"] for r in samples]),
                          "memory_mb": mean([r["memory_bytes"] / 1_000_000 for r in samples]),
                          "samples": len(samples)}
    return series, summaries, churn, errors


def phase_stats(segments, requests, dropped, start):
    result = []
    offset = 0
    for index, (name, seconds, from_rate, to_rate) in enumerate(segments):
        begin, end = start + offset, start + offset + seconds
        sample = [r for r in requests if begin <= r["started_ms"] / 1000 < end]
        successful = [r for r in sample if r["valid"]]
        result.append({"phase": name, "start_s": offset, "duration_s": seconds,
                       "offered_approx": seconds * (from_rate + to_rate) / 2,
                       "dispatched": len(sample), "successes": len(successful),
                       "successful_rps": len(successful) / seconds,
                       "failures": len(sample) - len(successful),
                       "error_pct": (len(sample) - len(successful)) * 100 / len(sample) if sample else None,
                       "timeouts": sum(r["timeout"] for r in sample),
                       "dropped": sum(n for t, n in dropped if begin <= t < end),
                       "p95_ms": percentile([r["duration_ms"] for r in successful], .95)})
        offset += seconds
    return result


def recovery_lag(requests, phases, start, p95_ceiling_ms, minimum_success):
    recovery = next((phase for phase in phases if phase["phase"] == "recovery"), None)
    if not recovery:
        return None
    start_s = recovery["start_s"]
    for offset in range(start_s, start_s + recovery["duration_s"] - 4, 5):
        sample = [row for row in requests if offset <= row["started_ms"] / 1000 - start < offset + 5]
        successful = [row["duration_ms"] for row in sample if row["valid"]]
        target = recovery["offered_approx"] / recovery["duration_s"] * 5
        if successful and len(successful) / target >= minimum_success and percentile(successful, .95) <= p95_ceiling_ms:
            return offset - start_s
    return None


def observed_contention(meta, start):
    expected, actual = meta["contention"], meta["intervention"]
    start_s = actual["started_epoch"] - start
    end_s = actual["ended_epoch"] - start
    return (actual["pod"] == expected["pod"] and actual["uid"] == expected["uid"] and
            actual["stimulus"] == expected["stimulus"] and actual["exit_code"] == 0 and
            abs(start_s - expected["onset_s"]) <= 3 and
            abs(end_s - start_s - expected["duration_s"]) <= 3 and
            0 < start_s < end_s < meta["measurement"]["duration"])


def summarize(directory):
    meta = read_json(directory / "trial.json")
    trial = meta["trial"]
    row = trial | {"run": str(directory), "model": meta["cluster"]["model"], "status": meta["status"],
                   "valid": False, "flags": []}
    if meta["status"] != "collected":
        row["flags"].append(meta.get("error", "collection incomplete"))
        return row
    requests = read_requests(directory / "measure-requests.jsonl")
    counts = k6_counts(directory / "measure-k6.jsonl")
    config = meta["measurement"]
    duration, offered = config["duration"], config["offered"]
    row.update(offered=offered, duration_s=duration, dropped=counts["dropped"],
               dispatched=counts["requests"], completed=len(requests),
               unfinished=max(0, counts["requests"] - len(requests)),
               successes=counts["valid"], failures=counts["invalid"], timeouts=counts["timeouts"])
    fatal = []
    if not requests:
        row["flags"].append("No completed request records")
        return row
    starts = {r["scenario_start_ms"] for r in requests}
    start = min(starts) / 1000
    end = start + duration
    if (len(starts) != 1 or not meta["measure_process"]["started"] - 1 <= start <=
            meta["measure_process"]["ended"] or
            end > meta["measure_process"]["ended"] + 1 or
            any(not start - .010 <= r["started_ms"] / 1000 < end + .050 or
                r["ended_ms"] < r["started_ms"] or not math.isfinite(r["duration_ms"]) or
                r["duration_ms"] < 0 for r in requests)):
        fatal.append("Invalid arrival clock or request timestamps")
    if (counts["iterations"] != len(requests) or counts["requests"] != len(requests) or
            counts["completed"] != len(requests) or counts["valid"] != sum(r["valid"] for r in requests) or
            counts["timeouts"] != sum(r["timeout"] for r in requests)):
        fatal.append("k6 counters and request records disagree")
    if config.get("stages") is None and counts["requests"] + counts["dropped"] != offered:
        fatal.append("Dispatched plus dropped did not match scheduled plateau arrivals")
    elif config.get("stages") and abs(counts["requests"] + counts["dropped"] - offered) > 1:
        fatal.append("Dispatched plus dropped did not match integrated ramp arrivals")
    corpus = read_json(directory.parent / "inputs" / "corpus.json")
    if (len({r["iteration"] for r in requests}) != len(requests) or
            any(r["row"] != (r["iteration"] + meta["seed"]) % len(corpus) for r in requests)):
        fatal.append("Invalid deterministic payload sequence")
    row["transport_failures"] = sum(r["status"] == 0 for r in requests)
    successful = [r for r in requests if r["valid"]]
    names = meta["cluster"]["replicas"]
    if any(r["status"] != 200 or r["replica_id"] not in names or not r["request_id"] or
           r["prediction_type"] != "string" or
           ((r["gateway_meta"] is not None) if trial["strategy"] == "native" else
            (not r["gateway_meta"] or r["gateway_meta"]["routing_strategy"] != trial["strategy"] or
             r["gateway_meta"]["model_run_id"] != meta["cluster"]["model"] or
             r["gateway_meta"]["target_endpoint"] != meta["cluster"]["endpoints"][r["replica_id"]]))
           for r in successful):
        fatal.append("Successful records lack consistent response metadata")
    replica_counts = Counter(r["replica_id"] for r in successful)
    latencies = [r["duration_ms"] for r in successful]
    row.update({f"p{p}_ms": percentile(latencies, p / 100) for p in (50, 95, 99)})
    row.update(successful_rps=len(successful) / duration,
               error_pct=counts["invalid"] / len(requests) * 100,
               success_fraction=len(successful) / offered,
               request_id_collisions=len(successful) - len({r["request_id"] for r in successful}),
               measurement_start_epoch=start)
    initial_p95 = percentile([r["duration_ms"] for r in successful if r["started_ms"] / 1000 < start + duration / 2], .95)
    final_p95 = percentile([r["duration_ms"] for r in successful if r["started_ms"] / 1000 >= start + duration / 2], .95)
    row["first_half_p95_ms"], row["second_half_p95_ms"] = initial_p95, final_p95
    row["replica_shares"] = [
        {"slot": index + 1, "pod": name, "uid": meta["cluster"]["pods"][name]["uid"],
         "successes": replica_counts[name], "share_pct": replica_counts[name] / len(successful) * 100 if successful else None}
        for index, name in enumerate(names)
    ]
    row["phases"] = phase_stats(config["segments"], requests, counts["dropped_points"], start)
    row["recovery_lag_s"] = recovery_lag(requests, row["phases"], start,
                                        meta["suite"]["settings"]["p95_ceiling_ms"],
                                        meta["suite"]["settings"]["minimum_success"])
    if trial["level"] == "matched_control" or trial["scenario"] == "contention":
        if trial["scenario"] == "contention" and not observed_contention(meta, start):
            fatal.append("Contention timing, stimulus, exit status or target diverged from protocol")
        else:
            if trial["scenario"] == "contention":
                intervention = meta["intervention"]
                onset = intervention["started_epoch"] - start
                stop = intervention["ended_epoch"] - start
            else:
                onset, stop = duration // 3, 2 * (duration // 3)
            indexes = [0, onset, stop, duration]
            for phase, lo, hi in zip(("before", "stimulus", "recovery"), indexes, indexes[1:]):
                phase_counts = Counter(r["replica_id"] for r in successful if lo <= r["started_ms"] / 1000 - start < hi)
                total = sum(phase_counts.values())
                for replica in row["replica_shares"]:
                    replica[f"{phase}_share_pct"] = 100 * phase_counts[replica["pod"]] / total if total else None

    before, after = (read_json(directory / f"prom-{boundary}.json") for boundary in ("before", "after"))
    if not before["evaluation"] <= start + .05 or after["after"] < end - .1:
        fatal.append("Prometheus boundaries do not bracket measurement")
    up_before, up_after = series_map(before, "up"), series_map(after, "up")
    if (len(up_before) != 4 or set(up_before) != set(up_after) or
            any(any(float(v) != 1 for _, v in data[-2:]) for snapshot in (up_before, up_after)
                for data in snapshot.values())):
        fatal.append("Scrape target coverage or health changed at the boundaries")
    spans = {}
    try:
        for labels, delta in counter_delta(before, after, "inference"):
            name = labels["pod_name"]
            replica = next(r for r in row["replica_shares"] if r["pod"] == name)
            replica["prom_successes" if labels["status"] == "200" else "prom_errors"] = delta
        if not all("prom_successes" in r and "prom_errors" in r for r in row["replica_shares"]):
            raise ValueError("Incomplete inference counter coverage")
        row["counter_difference"] = sum(abs(r["successes"] - r["prom_successes"]) for r in row["replica_shares"])
        if row["counter_difference"]:
            row["flags"].append("Inference success counters differ from validated clients; inspect timeouts and other traffic")
        counters = [counter_delta(before, after, key, allow_new=True) for key in ("gateway_count", "gateway_sum")]
        merged = defaultdict(lambda: [0, 0])
        for index, metrics in enumerate(counters):
            for labels, delta in metrics:
                if labels["strategy"] in (trial["strategy"], "background"):
                    merged[(labels["span"], labels["outcome"])][index] += delta
                elif delta:
                    row["flags"].append("Gateway recorded requests for another strategy")
        for (span, outcome), (count, elapsed) in sorted(merged.items()):
            if not count and elapsed:
                raise ValueError("Gateway duration changed without a count")
            if count:
                spans[f"{span}_{outcome}"] = {"count": count, "mean_ms": elapsed * 1000 / count}
        if successful and trial["strategy"] != "native" and not spans.get("handler_processing_ok"):
            raise ValueError("Gateway handler measurements are missing")
        handlers = sum(value["count"] for key, value in spans.items() if key.startswith("handler_processing_"))
        if trial["strategy"] != "native" and handlers != counts["requests"]:
            row["flags"].append("Gateway handler count differs from dispatched client requests")
    except (ValueError, StopIteration) as exc:
        fatal.append(str(exc))
    row["gateway_spans"] = spans
    series, summary, churn, errors = resource_results(directory / "resources.jsonl", meta["cluster"]["pods"], start, end)
    if churn:
        fatal.append("Pod readiness, identity, resources or container restart changed")
    if errors:
        row["flags"].append(f"{errors} resource collections failed")
    if trial["strategy"] != "native" and not any(r["app"] == "inference-gateway" for r in series):
        row["flags"].append("Gateway lacks a complete resource window")
    if not all(summary[name]["samples"] for name in names):
        row["flags"].append("At least one inference replica lacks a complete resource window")
    row["resource_summary"] = summary
    row["resources"] = series
    row["valid"] = not fatal
    row["flags"].extend(fatal)
    return row


def qualify(row, minimum, ceiling):
    return (row["valid"] and row["scenario"] == "capacity" and not row["dropped"] and
            not row["unfinished"] and not row["timeouts"] and not row.get("transport_failures", 0) and not row.get("flags") and
            row["counter_difference"] == 0 and row["success_fraction"] >= minimum and
            row["p95_ms"] is not None and row["p95_ms"] <= ceiling and
            row["first_half_p95_ms"] is not None and row["second_half_p95_ms"] is not None and
            row["second_half_p95_ms"] <= row["first_half_p95_ms"] * 1.25 + 20)


def discover(root):
    return sorted(root.rglob("trial.json"))


def verify_capacity(root, rates, signature, minimum, ceiling):
    from run import POLICIES
    accepted = set()
    for metadata in discover(root):
        meta = read_json(metadata)
        if meta["suite"]["capacity_signature"] != signature or meta["trial"]["scenario"] != "capacity":
            continue
        verify_inputs(metadata.parent.parent)
        row = summarize(metadata.parent)
        if qualify(row, minimum, ceiling):
            accepted.add((row["rate"], row["strategy"]))
    missing = [(rate, strategy) for rate in rates for strategy in POLICIES if (rate, strategy) not in accepted]
    if missing:
        raise ValueError(f"No qualifying matching capacity evidence for {missing}")


def verify_inputs(root):
    import hashlib
    suite = read_json(root / "suite.json")
    for name, digest in suite["sha256"].items():
        if hashlib.sha256((root / "inputs" / name).read_bytes()).hexdigest() != digest:
            raise ValueError(f"Frozen input hash mismatch: {name}")
    return suite


def validate_trial_files(paths, diagnostics):
    checked = {}
    result = []
    for path in paths:
        try:
            root = path.parent.parent
            if root not in checked:
                checked[root] = verify_inputs(root)
            meta = read_json(path)
            suite = checked[root]
            index = int(path.parent.name) - 1
            if not 0 <= index < len(suite["order"]) or suite["order"][index] != meta["trial"] or suite != meta["suite"]:
                raise ValueError("Trial metadata does not match the frozen suite")
            result.append(summarize(path.parent))
        except (OSError, ValueError, KeyError, TypeError, IndexError) as exc:
            diagnostics.append({"run": str(path.parent), "status": "unreadable",
                                "valid": False, "flags": [str(exc)]})
    return result


def write_csv(path, records, columns):
    with path.open("x", newline="", encoding="utf-8") as output:
        writer = csv.DictWriter(output, columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(records)


def aggregate(records, group_keys, metrics):
    groups = defaultdict(list)
    for row in records:
        groups[tuple(row[k] for k in group_keys)].append(row)
    result = []
    for key, group in sorted(groups.items()):
        row = dict(zip(group_keys, key)) | {"repetitions": len(group)}
        for metric in metrics:
            available = [r[metric] for r in group if r.get(metric) is not None]
            row[metric + "_n"] = len(available)
            row[metric + "_mean"] = mean(available)
            row[metric + "_sd"] = statistics.stdev(available) if len(available) > 1 else None
        result.append(row)
    return result


CONDITION = ["scenario", "level", "rate"]
GROUP = CONDITION + ["strategy"]
RUN = GROUP + ["repetition", "run", "model"]
PERFORMANCE = ["p50_ms", "p95_ms", "p99_ms", "successful_rps", "error_pct"]
RESOURCE = ["inference_cpu_pct", "inference_memory_mb", "gateway_cpu_pct"]
SHARES = ["share_pct", "before_share_pct", "stimulus_share_pct", "recovery_share_pct"]


def export_table(output, name, records, keys, metrics, details=()):
    write_csv(output / f"{name}-runs.csv", records, RUN + list(details) + metrics)
    grouped = aggregate(records, keys, metrics)
    write_csv(output / f"{name}.csv", grouped,
              keys + ["repetitions"] + [m + suffix for m in metrics for suffix in ("_mean", "_sd", "_n")])
    return grouped


def figure(path, title, x_label, y_label, points, lines=False):
    """Draw one panel per condition, or a single scatter plot for common steady loads."""
    from itertools import groupby
    colors = ("#275987", "#c34a2c", "#2a755a", "#7d58ac", "#b07c17")
    panels = defaultdict(list)
    for panel, series, x, y, sd in points:
        if y is not None:
            panels[panel].append((series, x, y, sd))
    if not panels:
        return False
    width, panel_height = 880, 350
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{55 + panel_height * len(panels)}" font-family="Arial,sans-serif" font-size="13">',
           '<rect width="100%" height="100%" fill="white"/>',
           f'<text x="30" y="32" font-size="21" font-weight="bold">{escape(title)}</text>']
    for i, (panel, values) in enumerate(sorted(panels.items())):
        top = 75 + panel_height * i
        bottom = top + 210
        xmin, xmax = min(v[1] for v in values), max(v[1] for v in values)
        ymin, ymax = 0, max(v[2] + (v[3] or 0) for v in values) * 1.08 or 1
        xcoord = lambda x: 95 + 555 * ((x - xmin) / (xmax - xmin) if xmax > xmin else .5)
        ycoord = lambda y: bottom - 195 * (y - ymin) / (ymax - ymin)
        svg.append(f'<text x="95" y="{top}" font-weight="bold">{escape(panel)}</text>')
        for j in range(5):
            y = j * ymax / 4
            yy = ycoord(y)
            svg.append(f'<path d="M95 {yy}H650" stroke="#d7dce2"/><text x="87" y="{yy + 4}" text-anchor="end">{y:.3g}</text>')
        svg.append(f'<path d="M95 {top + 14}V{bottom}H650" fill="none" stroke="#54616e"/>')
        ticks = sorted({v[1] for v in values})
        if len(ticks) > 10:
            ticks = [xmin + (xmax - xmin) * j / 5 for j in range(6)]
        for tick in ticks:
            svg.append(f'<text x="{xcoord(tick)}" y="{bottom + 21}" text-anchor="middle">{tick:.4g}</text>')
        svg.append(f'<text x="370" y="{bottom + 44}" text-anchor="middle">{escape(x_label)}</text>')
        svg.append(f'<text transform="translate(25 {top + 120}) rotate(-90)" text-anchor="middle">{escape(y_label)}</text>')
        for j, (label, group) in enumerate(groupby(sorted(values), key=lambda v: v[0])):
            color = colors[j % len(colors)]
            ordered = list(group)
            if lines and len(ordered) > 1:
                segments = []
                previous = None
                for _, x, y, _ in ordered:
                    if previous is None or x - previous > 22:
                        segments.append([])
                    segments[-1].append(f"{xcoord(x)},{ycoord(y)}")
                    previous = x
                for segment in segments:
                    svg.append(f'<polyline points="{" ".join(segment)}" fill="none" stroke="{color}"/>')
            for _, x, y, sd in ordered:
                xx, yy = xcoord(x), ycoord(y)
                if sd is not None:
                    a, b = ycoord(y + sd), ycoord(max(0, y - sd))
                    svg.append(f'<path d="M{xx} {a}V{b} M{xx - 3} {a}h6 M{xx - 3} {b}h6" stroke="{color}"/>')
                svg.append(f'<circle cx="{xx}" cy="{yy}" r="3.4" fill="{color}"/>')
            ly = top + 25 + j * 20
            svg.append(f'<circle cx="673" cy="{ly - 4}" r="3.4" fill="{color}"/><text x="683" y="{ly}">{escape(label)}</text>')
    svg.append("</svg>")
    with path.open("x", encoding="utf-8") as file:
        file.write("\n".join(svg))
    return True


def make_reports(output, trials):
    accepted = [r for r in trials if r["valid"]]
    if not accepted:
        return []
    representative = [r for r in accepted if r["scenario"] in ("steady", "burst", "contention")]
    report = representative or accepted
    performance = export_table(output, "Table-5.3", report, GROUP, PERFORMANCE,
                               ("offered", "dispatched", "completed", "successes", "failures", "timeouts",
                                "dropped", "unfinished", "duration_s", "recovery_lag_s"))
    resource_rows, replica_rows, span_rows, phases, time_series = [], [], [], [], []
    for r in report:
        run = {key: r[key] for key in RUN}
        replica = [r["resource_summary"][p["pod"]] for p in r["replica_shares"]]
        summary = r["resource_summary"]
        gateway = next((summary[x["pod"]] for x in r["resources"] if x["app"] == "inference-gateway"), {})
        resource_rows.append(run | {
            "inference_cpu_pct": mean([x["cpu_pct"] for x in replica]) if all(x["samples"] for x in replica) else None,
            "inference_memory_mb": mean([x["memory_mb"] for x in replica]) if all(x["samples"] for x in replica) else None,
            "minimum_inference_samples": min(x["samples"] for x in replica),
            "gateway_samples": gateway.get("samples") if r["strategy"] != "native" else None,
            "gateway_cpu_pct": gateway.get("cpu_pct") if r["strategy"] != "native" else None,
        })
        replica_rows.extend(run | item for item in r["replica_shares"])
        span_rows.extend(run | {"span": span} | result for span, result in r["gateway_spans"].items())
        phases.extend(run | phase for phase in r["phases"])
        time_series.extend(run | {"slot": p["slot"]} | sample for p in r["replica_shares"]
                           for sample in r["resources"] if sample["pod"] == p["pod"])
    export_table(output, "Table-5.4", resource_rows, GROUP, RESOURCE,
                 ("minimum_inference_samples", "gateway_samples"))
    shares = export_table(output, "Table-5.5", replica_rows, GROUP + ["slot"], SHARES,
                          ("slot", "pod", "uid", "successes", "prom_successes", "prom_errors"))
    rr = {tuple(r[k] for k in CONDITION + ["repetition"]): r["gateway_cpu_pct"]
          for r in resource_rows if r["strategy"] == "round_robin"}
    for r in resource_rows:
        if r["strategy"] != "adaptive" or r["gateway_cpu_pct"] is None:
            continue
        base = rr.get(tuple(r[k] for k in CONDITION + ["repetition"]))
        if base is not None:
            difference = r["gateway_cpu_pct"] - base
            span_rows.append({k: r[k] for k in RUN} | {"span": "adaptive_minus_rr_gateway_cpu",
                             "additional_cpu_pp": difference,
                             "additional_cpu_relative_pct": 100 * difference / base if base > 0 else None})
    export_table(output, "Table-5.6", span_rows, GROUP + ["span"],
                 ["mean_ms", "additional_cpu_pp", "additional_cpu_relative_pct"], ("span", "count"))
    write_csv(output / "measurement-phases.csv", phases, RUN + [
        "phase", "start_s", "duration_s", "offered_approx", "dispatched", "successes", "successful_rps",
        "failures", "error_pct", "timeouts", "dropped", "p95_ms"])
    write_csv(output / "inference-resource-series.csv", time_series, RUN + [
        "slot", "pod", "uid", "timestamp", "seconds", "window", "cpu_millicores", "cpu_limit_millicores", "cpu_pct", "memory_bytes"])
    made = []
    steady = [r for r in performance if r["scenario"] == "steady" and r["level"] in ("low", "moderate", "high")]
    for number, title, metric, unit in (
        (1, "P95 prediction latency", "p95_ms", "Latency (ms)"),
        (2, "Successful prediction throughput", "successful_rps", "Successful requests/s"),
    ):
        name = f"Figure-5.{number}.svg"
        if figure(output / name, title, "Offered requests/s", unit,
                  [("Steady trials", r["strategy"], r["rate"], r[metric + "_mean"], r[metric + "_sd"]) for r in steady]):
            made.append(name)
    name = "Figure-5.3.svg"
    if figure(output / name, "Inference replica CPU during measurement", "Seconds from first scheduled arrival",
              "CPU (% of limit)", [(f"{r['strategy']} / {r['scenario']} / {r['rate']} RPS / run {r['repetition']}",
                                    f"Replica {r['slot']}", r["seconds"], r["cpu_pct"], None)
                                   for r in time_series], lines=True):
        made.append(name)
    name = "Figure-5.4.svg"
    if figure(output / name, "Share of successful predictions by replica", "Replica slot", "Successful requests (%)",
              [(f"{r['scenario']} / {r['level']} / {r['rate']} RPS", r["strategy"], r["slot"],
                r["share_pct_mean"], r["share_pct_sd"]) for r in shares]):
        made.append(name)
    return made


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--capacity-only", action="store_true")
    parser.add_argument("--minimum-success", default=.99, type=float)
    parser.add_argument("--p95-ceiling-ms", default=500, type=float)
    args = parser.parse_args()
    items = discover(args.input)
    if not items:
        parser.error("No trial evidence found")
    output = args.output or args.input / "analysis"
    output.mkdir(parents=True)
    diagnostics = []
    trials = validate_trial_files(items, diagnostics)
    capacity = [
        {key: row.get(key) for key in RUN + PERFORMANCE + ["offered", "successes", "dropped", "timeouts"]}
        | {"qualified": qualify(row, args.minimum_success, args.p95_ceiling_ms), "flags": row["flags"],
           "first_half_p95_ms": row.get("first_half_p95_ms"), "second_half_p95_ms": row.get("second_half_p95_ms")}
        for row in trials if row["scenario"] == "capacity"
    ]
    if capacity:
        write_csv(output / "capacity.csv", capacity, RUN + PERFORMANCE + [
            "offered", "successes", "dropped", "timeouts", "first_half_p95_ms", "second_half_p95_ms", "qualified", "flags"])
    signatures = set()
    for path in sorted(args.input.rglob("suite.json")):
        try:
            suite = read_json(path)
            if suite.get("plan") in ("steady", "chapter5", "contention"):
                protocol = {key: suite["settings"][key] for key in
                            ("warmup", "measurement", "cooldown", "repetitions", "idle_seconds",
                             "sample_seconds", "seed", "p95_ceiling_ms", "minimum_success")}
                signatures.add(json.dumps([suite["capacity_signature"], protocol], sort_keys=True))
            missing = [f"{index:03d}" for index in range(1, len(suite["order"]) + 1)
                       if not (path.parent / f"{index:03d}" / "trial.json").is_file()]
            if missing:
                diagnostics.append({"run": str(path.parent), "status": "incomplete", "valid": False,
                                    "flags": [f"Missing planned trials: {', '.join(missing)}"]})
        except (OSError, ValueError, KeyError, TypeError) as exc:
            diagnostics.append({"run": str(path.parent), "status": "unreadable", "valid": False,
                                "flags": [str(exc)]})
    duplicate = Counter(tuple(r[k] for k in GROUP + ["repetition"]) for r in trials
                        if r["valid"] and r["scenario"] in ("steady", "burst", "contention"))
    ambiguous = len(signatures) > 1 or any(count > 1 for count in duplicate.values())
    if ambiguous:
        diagnostics.append({"status": "incompatible", "valid": False,
                            "flags": ["Formal suites have different frozen settings or duplicate trial keys"]})
    figures = [] if args.capacity_only or ambiguous else make_reports(output, trials)
    result = {"figures_created": figures, "capacity": capacity, "trials": trials, "unreadable": diagnostics,
              "valid_trials": sum(r["valid"] for r in trials)}
    (output / "validation.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(f"Validated {result['valid_trials']}/{len(items)} trials; generated {len(figures)} figures in {output}")
    if diagnostics or result["valid_trials"] != len(items):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
