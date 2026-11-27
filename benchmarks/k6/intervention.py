"""Bounded single-replica interventions used by the Phase 3 runner."""
import json
import time
from subprocess import TimeoutExpired

import sample_resources as resources

# The remote process uses monotonic deadlines and is its own recovery watchdog.
WORKER = """
import json, sys, time
kind, duration = sys.argv[1], float(sys.argv[2])
if not 0 < duration <= 20:
    raise ValueError("intervention duration exceeds safety limit")
if kind != "cpu-250m":
    raise ValueError("unknown intervention")
start = time.time()
begin = time.monotonic()
cpu = time.process_time()
while time.monotonic() < begin + duration:
    tick = time.monotonic()
    deadline = time.process_time() + .025
    while time.process_time() < deadline and time.monotonic() < tick + .1:
        pass
    time.sleep(max(0, tick + .1 - time.monotonic()))
print(json.dumps({"started_epoch": start, "ended_epoch": time.time(),
                  "worker_cpu_seconds": time.process_time() - cpu, "exit_code": 0}))
"""


# Run in the node PID namespace; container PID 1 ignores SIGSTOP from its own namespace.
PAUSE_WORKER = r"""
set -eu
pid="$1"
id="$2"
duration="$3"
test "$pid" -gt 1
test "$duration" -eq 18
belongs() { grep -Fq "$id" "/proc/$pid/cgroup"; }
belongs
tr '\000' ' ' < "/proc/$pid/cmdline" | grep -q 'uvicorn'
resume() { if belongs; then kill -CONT "$pid"; fi; }
trap resume EXIT
trap 'exit 1' HUP INT TERM
start=$(date +%s.%N)
kill -STOP "$pid"
for attempt in 1 2 3 4 5; do
    if grep -Eq '^State:[[:space:]]+T' "/proc/$pid/status"; then break; fi
    sleep .05
done
grep -Eq '^State:[[:space:]]+T' "/proc/$pid/status"
sleep "$duration"
resume
trap - EXIT
end=$(date +%s.%N)
printf '{"started_epoch":%s,"ended_epoch":%s,"exit_code":0}\n' "$start" "$end"
"""


def execute(namespace, directory, expected, stop):
    output = directory / "intervention.json"
    try:
        requests = directory / "measure-requests.jsonl"
        deadline = time.monotonic() + 45
        start = None
        while not stop.is_set() and time.monotonic() < deadline:
            if requests.is_file():
                try:
                    with requests.open(encoding="utf-8-sig") as stream:
                        start = json.loads(stream.readline())["scenario_start_ms"] / 1000
                except (ValueError, KeyError):
                    pass
                if start is not None:
                    break
            stop.wait(.25)
        if start is None or stop.is_set():
            raise RuntimeError("No observed measurement start")
        scheduled = start + expected["onset_s"]
        if stop.wait(max(0, scheduled - time.time() - .25)):
            return
        current = resources.pods(namespace).get(expected["pod"])
        if not current or current["uid"] != expected["uid"] or not current["ready"]:
            raise RuntimeError("Intervention target is no longer the ready planned replica")
        if stop.is_set() or time.time() > scheduled + 2:
            raise RuntimeError("Intervention cannot fit the planned time tolerance")
        duration = str(expected["duration_s"])
        if expected["stimulus"] == "process-pause":
            container_id = current["containers"]["inference-service"]["container_id"].split("://", 1)[-1]
            info = json.loads(resources.run_command("docker", "exec", current["node"], "crictl",
                                                    "inspect", container_id, timeout=4))
            pid = str(int(info["info"]["pid"]))
            raw = resources.run_command("docker", "exec", current["node"], "sh", "-c", PAUSE_WORKER,
                                        "nexus-pause", pid, container_id, duration,
                                        timeout=expected["duration_s"] + 12)
        else:
            raw = resources.run_command(
                "kubectl", "-n", namespace, "exec", expected["pod"], "-c", "inference-service",
                "--", "python", "-c", WORKER, expected["stimulus"], duration,
                timeout=expected["duration_s"] + 12,
            )
        result = json.loads(raw)
    except (ValueError, KeyError, OSError, RuntimeError, TimeoutExpired) as exc:
        result = {"error": str(exc), "exit_code": 1}
    output.write_text(json.dumps(expected | result, indent=2) + "\n", encoding="utf-8")
