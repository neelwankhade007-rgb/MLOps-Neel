"""Export Chapter 5 from complete, qualified four-policy blocks on one matched workload."""
import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path
from statistics import mean, stdev

from analyze import qualify
from run import POLICIES

LABEL = dict(zip(POLICIES, ("Native", "Round Robin", "Weighted RR", "Adaptive")))
COLOR = dict(zip(POLICIES, ("#275A91", "#00806D", "#BC5626", "#7658A7")))
METRICS = {
    "5.3": ("p50_ms", "p95_ms", "p99_ms", "successful_rps", "error_pct"),
    "5.4": ("inference_cpu_pct", "inference_memory_mb", "gateway_cpu_pct"),
    "5.5": ("replica_1_pct", "replica_2_pct", "replica_3_pct"),
    "5.6": ("processing_ms", "cache_ms", "score_ms", "cpu_difference_pp",
            "cpu_difference_relative_pct", "refresh_ms"),
}


def load_blocks(root):
    blocks, exclusions = {}, []
    for path in sorted(root.glob("*/analysis/validation.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        suite = json.loads((path.parents[1] / "suite.json").read_text(encoding="utf-8"))
        settings = suite["settings"]
        rows = defaultdict(list)
        for row in data["trials"]:
            rows[(row["rate"], row["repetition"])].append(row)
        for (rate, repeat), trials in rows.items():
            name = f"{path.parents[1].name}/{repeat}"
            if ({r["strategy"] for r in trials} != set(POLICIES) or len(trials) != 4 or
                    not all(qualify(r, settings["minimum_success"], settings["p95_ceiling_ms"]) for r in trials)):
                exclusions.append({"block": name, "rate": rate, "validation": str(path), "trials": trials})
                continue
            signature = json.dumps(suite["capacity_signature"], sort_keys=True)
            blocks.setdefault((rate, signature), []).append((name, trials))
    return blocks, exclusions


def measurements(blocks):
    result = []
    for block, trials in blocks:
        records = {}
        for r in trials:
            policy = r["strategy"]
            summary = r["resource_summary"]
            inference = [summary[x["pod"]] for x in r["replica_shares"]]
            gateway = next((item for name, item in summary.items() if name.startswith("inference-gateway-")), {})
            row = {key: r[key] for key in METRICS["5.3"]} | {
                "block": block, "strategy": policy, "offered_rps": r["rate"], "raw": r["run"],
                "inference_cpu_pct": mean(x["cpu_pct"] for x in inference),
                "inference_memory_mb": mean(x["memory_mb"] for x in inference),
                "gateway_cpu_pct": gateway.get("cpu_pct") if policy != "native" else None,
            }
            for item in r["replica_shares"]:
                row[f'replica_{item["slot"]}_pct'] = item["share_pct"]
            if policy == "adaptive":
                spans = r["gateway_spans"]
                for key, span in (("processing_ms", "handler_processing_ok"), ("cache_ms", "cache_access_ok"),
                                  ("score_ms", "score_computation_ok"), ("refresh_ms", "refresh_interval_ok")):
                    row[key] = spans.get(span, {}).get("mean_ms")
            records[policy] = row
        adaptive, rr = records["adaptive"], records["round_robin"]
        baseline = rr["gateway_cpu_pct"]
        if baseline is not None and adaptive["gateway_cpu_pct"] is not None:
            delta = adaptive["gateway_cpu_pct"] - baseline
            adaptive.update(cpu_difference_pp=delta, cpu_difference_relative_pct=100 * delta / baseline if baseline else None)
        result.extend(records[p] for p in POLICIES)
    return result


def save_csv(path, fields, records):
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(records)


def figures(output, rate, records, block, native):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.rcParams.update({"font.size": 10, "figure.facecolor": "white", "axes.facecolor": "white",
                         "savefig.facecolor": "white", "svg.fonttype": "none"})
    urls = []

    def save(fig, number, caption):
        for ext in ("png", "svg"):
            fig.savefig(output / f"figure-{number}.{ext}", dpi=300, bbox_inches="tight")
        plt.close(fig)
        urls.append(f"Figure {number}. {caption} Offered load {rate:g} RPS; 30/60/20 s phases; direct backend Service.")

    for number, metric, ylabel in (("5.1", "p95_ms", "P95 latency (ms)"),
                                   ("5.2", "successful_rps", "Successful throughput (requests/s)")):
        fig, ax = plt.subplots(figsize=(6.3, 3.5))
        for pos, policy in enumerate(POLICIES):
            samples = [r[metric] for r in records if r["strategy"] == policy]
            ax.bar(pos, mean(samples), yerr=stdev(samples) if len(samples) > 1 else None,
                   capsize=4, color=COLOR[policy], width=.65)
        ax.set_xticks(range(4), [LABEL[p] for p in POLICIES])
        ax.set_ylabel(ylabel)
        ax.set_ylim(bottom=0)
        ax.grid(axis="y", alpha=.25)
        save(fig, number, f"{ylabel} by strategy. Error bars show sample SD when available.")

    fig, ax = plt.subplots(figsize=(6.3, 3.5))
    for item in native["replica_shares"]:
        observations = [r for r in native["resources"] if r["pod"] == item["pod"]]
        ax.plot([r["seconds"] for r in observations], [r["cpu_pct"] for r in observations],
                marker="o", label=f'Replica {item["slot"]}')
    ax.set(xlabel="Seconds from measurement start", ylabel="CPU (% of limit)", xlim=(0, 60), ylim=(0, None))
    ax.legend(frameon=False)
    ax.grid(alpha=.25)
    save(fig, "5.3", f"Source-timestamped inference CPU in the first qualified Native trial ({block}).")

    fig, ax = plt.subplots(figsize=(6.3, 3.5))
    for index, policy in enumerate(POLICIES):
        samples = [[r[f"replica_{slot}_pct"] for r in records if r["strategy"] == policy] for slot in (1, 2, 3)]
        ax.bar([j + (index - 1.5) * .19 for j in range(3)], [mean(v) for v in samples], width=.18,
               label=LABEL[policy], color=COLOR[policy],
               yerr=[stdev(v) if len(v) > 1 else 0 for v in samples], capsize=2)
    ax.set(xticks=range(3), xticklabels=("Replica 1", "Replica 2", "Replica 3"),
           ylabel="Successful request share (%)", ylim=(0, None))
    ax.legend(frameon=False)
    ax.grid(axis="y", alpha=.25)
    save(fig, "5.4", "Replica share by strategy and stable gateway IP-order slot.")
    return urls


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    output = args.output
    inputs = {str(path): path.stat().st_mtime_ns
              for path in sorted((output / "raw").glob("*/analysis/validation.json"))}
    validation = output / "validation-summary.json"
    if validation.is_file() and json.loads(validation.read_text(encoding="utf-8")).get("inputs") == inputs:
        return
    blocks, exclusions = load_blocks(output / "raw")
    report = ["# Chapter 5 experimental results", ""]
    settings = ["# Experiment settings", "", "Authenticated backend Service, direct from the Minikube node network.",
                "k6 2.4.0, seed 42, 32 VUs, six synthetic inputs, fresh gateway per trial, 30/60/20 s phases.",
                "Resource data use measurement-aligned cAdvisor counter deltas and working-set samples."]
    chosen = max(blocks, key=lambda key: (len(blocks[key]), key[0]), default=None)
    counts = defaultdict(int)
    for (rate, _), value in blocks.items():
        counts[rate] += len(value)
    summary = {"complete_qualified_blocks": dict(counts),
               "inputs": inputs,
               "selected_rate": chosen[0] if chosen else None,
               "excluded": [{"block": x["block"], "rate": x["rate"], "validation": x["validation"]} for x in exclusions]}
    diagnostics = [{"block": x["block"], "offered_rps": x["rate"], "validation": x["validation"]} for x in exclusions]
    save_csv(output / "excluded-blocks.csv", ("block", "offered_rps", "validation"), diagnostics)
    if chosen:
        rate, signature = chosen
        selected = blocks[chosen]
        records = measurements(selected)
        settings += ["", f"Selected {rate} RPS. Frozen capacity signature follows.", "", "```json",
                     json.dumps(json.loads(signature), indent=2), "```"]
        report.append(f"Offered load {rate} RPS. Qualified repetitions per strategy = {len(selected)}.")
        if len(selected) < 2:
            report.append("Single-repetition baseline. Between-run variability is unavailable and formal evaluation remains incomplete.")
        for number, columns in METRICS.items():
            targets = ("adaptive",) if number == "5.6" else POLICIES
            bounds = [r for r in records if r["strategy"] in targets]
            save_csv(output / f"table-{number}-runs.csv",
                     ("strategy", "block", "offered_rps", "raw", *columns), bounds)
            summary_rows = []
            report += ["", f"## Table {number}", "", "| Strategy | " + " | ".join(columns) + " |",
                       "|---|" + "---:|" * len(columns)]
            for policy in targets:
                values = {}
                cells = []
                for key in columns:
                    available = [r[key] for r in bounds if r["strategy"] == policy and r.get(key) is not None]
                    avg = mean(available) if available else None
                    sd = stdev(available) if len(available) > 1 else None
                    values.update({key + "_mean": avg, key + "_sd": sd, key + "_n": len(available)})
                    cells.append("—" if avg is None else f"{avg:.3f}" + (f" ± {sd:.3f}" if sd is not None else ""))
                summary_rows.append({"strategy": policy} | values)
                report.append(f"| {LABEL[policy]} | " + " | ".join(cells) + " |")
            save_csv(output / f"table-{number}.csv", tuple(summary_rows[0]), summary_rows)
        name, trials = selected[0]
        p95s = {p: mean(r["p95_ms"] for r in records if r["strategy"] == p) for p in POLICIES}
        fastest = min(p95s, key=p95s.get)
        slowest = max(p95s, key=p95s.get)
        report += ["", "## Observations", "",
                   f"Mean trial P95 ranged from {p95s[fastest]:.2f} ms ({LABEL[fastest]}) to "
                   f"{p95s[slowest]:.2f} ms ({LABEL[slowest]}).",
                   "These measurements describe the selected workload and generator placement. "
                   "They do not establish latency rankings at other loads."]
        report += ["", "## Figure captions", ""] + figures(
            output, rate, records, name, next(r for r in trials if r["strategy"] == "native"))
    else:
        report.append("No complete qualified four-policy block is available. Exclusions are indexed in excluded-blocks.csv. Chapter 5 tables and figures require qualified data.")
    (output / "chapter5-results.md").write_text("\n".join(report) + "\n", encoding="utf-8")
    (output / "experiment-settings.md").write_text("\n".join(settings) + "\n", encoding="utf-8")
    validation.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
