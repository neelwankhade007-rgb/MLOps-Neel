"""Fixed-dimension Prometheus timing summaries for the gateway."""
from collections import defaultdict
from contextlib import contextmanager
from threading import Lock
from time import perf_counter_ns

_lock = Lock()
_totals = defaultdict(lambda: [0, 0])


def observe(span, strategy, outcome, nanoseconds):
    with _lock:
        total = _totals[span, strategy, outcome]
        total[0] += 1
        total[1] += nanoseconds


@contextmanager
def timed(span, strategy="background"):
    start = perf_counter_ns()
    outcome = "ok"
    try:
        yield
    except BaseException:
        outcome = "error"
        raise
    finally:
        observe(span, strategy, outcome, perf_counter_ns() - start)


@contextmanager
def measured_lock(lock, strategy):
    start = perf_counter_ns()
    lock.acquire()
    elapsed = perf_counter_ns() - start
    try:
        yield
    finally:
        lock.release()
        observe("lock_wait", strategy, "ok", elapsed)


def exposition():
    with _lock:
        rows = [(key, *value) for key, value in sorted(_totals.items())]
    lines = [
        "# HELP gateway_span_duration_seconds Duration of fixed gateway spans.",
        "# TYPE gateway_span_duration_seconds summary",
    ]
    for (span, strategy, outcome), count, elapsed in rows:
        labels = f'{{span="{span}",strategy="{strategy}",outcome="{outcome}"}}'
        lines.append(f"gateway_span_duration_seconds_count{labels} {count}")
        lines.append(f"gateway_span_duration_seconds_sum{labels} {elapsed / 1e9}")
    return "\n".join(lines) + "\n"
