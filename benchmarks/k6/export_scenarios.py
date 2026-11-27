"""Publish scenario plots only when a complete matched four-policy block exists."""
import argparse
from collections import defaultdict
import json
from pathlib import Path
from statistics import mean, stdev

from analyze import percentile, read_requests
from export_evaluation import COLOR, LABEL, save_csv
from run import POLICIES


def matched_rows(suites, scenario):
    for suite in suites:
        validation = suite / "analysis" / "validation.json"
        if not validation.is_file():
            continue
        trials = json.loads(validation.read_text(encoding="utf-8"))["trials"]
        repeats = defaultdict(list)
        for row in trials:
            if row["scenario"] == scenario and row.get("valid") and not row["flags"] and not row["dropped"]:
                if scenario == "failure":
                    readiness = row.get("target_readiness", [])
                    if not readiness or not readiness[-1]["ready"] or (
                            all(s["ready"] for s in readiness) and not row.get("failures")):
                        continue
                repeats[row["repetition"]].append(row)
        for repetition, group in repeats.items():
            if len(group) != len(POLICIES) or {r["strategy"] for r in group} != set(POLICIES):
                continue
            if scenario in ("contention", "failure"):
                controls = [r for r in trials if r["repetition"] == repetition
                            and r["level"] == "matched_control" and r.get("valid") and not r["flags"]]
                if len(controls) != len(POLICIES) or {r["strategy"] for r in controls} != set(POLICIES):
                    continue
                group += controls
            yield suite.name, group


def bins(row):
    requests = read_requests(Path(row["run"]) / "measure-requests.jsonl")
    start = row["measurement_start_epoch"]
    for offset in range(0, row["duration_s"], 5):
        length = min(5, row["duration_s"] - offset)
        bucket = [r for r in requests if offset <= r["started_ms"] / 1000 - start < offset + length]
        good = [r["duration_ms"] for r in bucket if r["valid"]]
        yield {"seconds": offset, "window_s": length, "attempts": len(bucket),
               "success_rps": len(good) / length, "errors": len(bucket) - len(good),
               "p95_ms": percentile(good, .95)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    suites = sorted((args.output / "raw").iterdir())
    counts = {}
    for scenario in ("burst", "contention", "failure"):
        blocks = list(matched_rows(suites, scenario))
        counts[scenario] = len(blocks)
        if not blocks:
            continue
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        data, shares = [], []
        for suite, group in blocks:
            for row in group:
                fields = {"suite": suite, "strategy": row["strategy"], "repetition": row["repetition"],
                          "offered_rps": row["rate"], "condition": row["level"], "raw": row["run"]}
                data.extend(fields | sample for sample in bins(row))
                shares.extend(fields | item for item in row.get("replica_shares", []))
        save_csv(args.output / f"{scenario}-time-series.csv", tuple(data[0]), data)
        if scenario == "contention":
            save_csv(args.output / "contention-replica-shares.csv", tuple(shares[0]), shares)
            fig, axes = plt.subplots(2, 2, figsize=(8, 5), facecolor="white")
            for policy, ax in zip(POLICIES, axes.flat):
                for slot in (1, 2, 3):
                    for condition, linestyle in (("matched_control", "--"), ("intervention", "-")):
                        values = [r for r in shares if r["strategy"] == policy and r["slot"] == slot
                                  and r["condition"] == condition]
                        points = [[r[f"{phase}_share_pct"] for r in values
                                   if r.get(f"{phase}_share_pct") is not None]
                                  for phase in ("before", "stimulus", "recovery")]
                        ax.errorbar(range(3), [mean(p) if p else float("nan") for p in points],
                                    yerr=[stdev(p) if len(p) > 1 else 0 for p in points],
                                    marker="o", linestyle=linestyle, label=f"Replica {slot} {condition}")
                ax.set(title=LABEL[policy], ylabel="Successful share (%)", ylim=(0, 100))
                ax.set_xticks(range(3), ["Before", "Stimulus", "Recovery"])
            axes[0, 0].legend(fontsize=6)
        else:
            fig, axes = plt.subplots(3, 1, figsize=(7, 7), sharex=True, facecolor="white")
            for ax, metric, label in zip(axes, ("success_rps", "p95_ms", "errors"),
                                         ("Successes/s", "P95 (ms)", "Errors / 5 s")):
                for policy in POLICIES:
                    selected = [r for r in data if r["strategy"] == policy and r["condition"] != "matched_control"]
                    times = sorted({r["seconds"] for r in selected})
                    points = [[r[metric] for r in selected if r["seconds"] == t and r[metric] is not None]
                              for t in times]
                    ax.errorbar(times, [mean(p) if p else float("nan") for p in points],
                                yerr=[stdev(p) if len(p) > 1 else 0 for p in points],
                                color=COLOR[policy], marker=".", label=LABEL[policy])
                ax.set_ylabel(label)
                ax.grid(alpha=.2)
            axes[0].legend(ncol=2, frameon=False)
            axes[-1].set_xlabel("Seconds from measurement start")
        fig.suptitle(f"{scenario.title()} · {len(blocks)} matched repetitions\nFive-second bins; error bars show sample SD")
        fig.tight_layout()
        for extension in ("png", "svg"):
            fig.savefig(args.output / f"{scenario}-response.{extension}", dpi=300, facecolor="white")
        plt.close(fig)
    (args.output / "scenario-validation.json").write_text(json.dumps(counts, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
