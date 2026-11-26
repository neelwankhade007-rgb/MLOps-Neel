import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import toast from 'react-hot-toast';
import {
  Play,
  RotateCw,
  Download,
  AlertTriangle,
  Server,
  Cpu,
  Clock,
  Search,
  ShieldCheck,
  Sliders,
  Terminal,
  Zap,
} from 'lucide-react';
import { inferenceApi } from '../api/inferenceApi';
import type { TelemetrySnapshot, ReplicaTelemetry, RecentEvent, RoutingStrategy, TestTrafficResult } from '../api/inferenceApi';
import Header from '../components/layout/Header';
import LiveRoutingVisualizer from '../components/monitoring/LiveRoutingVisualizer';
import type { AnimatedPacket } from '../components/monitoring/LiveRoutingVisualizer';
import GanttRequestTimeline from '../components/monitoring/GanttRequestTimeline';
import AutoTrafficGenerator from '../components/monitoring/AutoTrafficGenerator';
import ConfigurableWeightsPanel from '../components/monitoring/ConfigurableWeightsPanel';


// Build a softly smoothed SVG line from observed samples.
function generateSparkline(data: number[], width = 100, height = 24, pad = 2): string {
  if (!data || data.length === 0) {
    return `M 0,${height - pad} L ${width},${height - pad}`;
  }
  const max = Math.max(0.1, ...data);
  const step = width / Math.max(1, data.length - 1);
  const points = data.map((value, index) => ({
    x: index * step,
    y: height - pad - (Math.max(0, value) / max) * (height - 2 * pad),
  }));
  if (points.length === 1) return `M 0,${points[0].y.toFixed(1)} L ${width},${points[0].y.toFixed(1)}`;

  let path = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const current = points[index];
    const next = points[index + 1];
    const afterNext = points[Math.min(points.length - 1, index + 2)];
    const control1X = current.x + (next.x - previous.x) / 6;
    const control1Y = current.y + (next.y - previous.y) / 6;
    const control2X = next.x - (afterNext.x - current.x) / 6;
    const control2Y = next.y - (afterNext.y - current.y) / 6;
    path += ` C ${control1X.toFixed(1)},${control1Y.toFixed(1)} ${control2X.toFixed(1)},${control2Y.toFixed(1)} ${next.x.toFixed(1)},${next.y.toFixed(1)}`;
  }
  return path;
}

// Helper: Generate closed area sparkline path
function generateSparklineArea(data: number[], width = 100, height = 24, pad = 2): string {
  const line = generateSparkline(data, width, height, pad);
  return `${line} L ${width},${height} L 0,${height} Z`;
}

// Helper: Generate multi-point chart path
function generateChartPath(
  values: number[],
  width = 500,
  height = 180,
  paddingLeft = 40,
  paddingRight = 20,
  paddingTop = 20,
  paddingBottom = 40,
  maxY = 120
): string {
  if (!values || values.length === 0) {
    return `M ${paddingLeft},${height - paddingBottom} L ${width - paddingRight},${height - paddingBottom}`;
  }
  const chartW = width - paddingLeft - paddingRight;
  const chartH = height - paddingTop - paddingBottom;
  const step = chartW / Math.max(1, values.length - 1);
  const points = values.map((value, index) => ({
    x: paddingLeft + index * step,
    y: height - paddingBottom - Math.min(1, Math.max(0, value / maxY)) * chartH,
  }));
  if (points.length === 1) return `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;

  let path = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const current = points[index];
    const next = points[index + 1];
    const afterNext = points[Math.min(points.length - 1, index + 2)];
    const control1X = current.x + (next.x - previous.x) / 6;
    const control1Y = current.y + (next.y - previous.y) / 6;
    const control2X = next.x - (afterNext.x - current.x) / 6;
    const control2Y = next.y - (afterNext.y - current.y) / 6;
    path += ` C ${control1X.toFixed(1)},${control1Y.toFixed(1)} ${control2X.toFixed(1)},${control2Y.toFixed(1)} ${next.x.toFixed(1)},${next.y.toFixed(1)}`;
  }
  return path;
}

const EMPTY_REPLICAS: ReplicaTelemetry[] = [];
const EMPTY_EVENTS: RecentEvent[] = [];

export const InferenceMonitoringPage: React.FC = () => {
  // Telemetry state
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot | null>(null);
  const [activeStrategy, setActiveStrategy] = useState<RoutingStrategy>('round_robin');
  const [wrrWeights, setWrrWeights] = useState<number[]>([5, 3, 2]);
  const [changingStrategy, setChangingStrategy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState<number>(5000); // 5s default
  const [syncStatus, setSyncStatus] = useState<'synced' | 'fetching' | 'stale'>('synced');
  const [lastUpdated, setLastUpdated] = useState<string>('--:--:-- UTC');
  const isFetchingRef = useRef<boolean>(false);
  const autoRefreshTimerRef = useRef<any>(null);

  // Objective weights state (for prospective simulation preview only)
  const [weightLat, setWeightLat] = useState(0.40);
  const [weightReq, setWeightReq] = useState(0.30);
  const [weightCpu, setWeightCpu] = useState(0.20);
  const [weightErr, setWeightErr] = useState(0.10);

  // Test traffic runner state
  const [testCount, setTestCount] = useState(5);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testResults, setTestResults] = useState<TestTrafficResult[]>([]);

  // Live Visualizer & Gantt Timeline State
  const [activePackets, setActivePackets] = useState<AnimatedPacket[]>([]);
  const [recentlyHitPod, setRecentlyHitPod] = useState<string | null>(null);
  const [isGeneratingTraffic, setIsGeneratingTraffic] = useState<boolean>(false);
  const [ganttWindowSize, setGanttWindowSize] = useState<number>(30);
  const [clearedEventIds, setClearedEventIds] = useState<Set<string>>(new Set());

  // Log filter & search
  const [searchFilter, setSearchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Modal inspection
  const [selectedReplicaModal, setSelectedReplicaModal] = useState<ReplicaTelemetry | null>(null);


  // Time window for charts (5m, 15m, 1h)
  const [chartTimeWindow, setChartTimeWindow] = useState<'5m' | '15m' | '1h'>('5m');


  // Load telemetry from backend with concurrency protection
  const loadTelemetry = useCallback(async (isManual = false) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    if (isManual) setRefreshing(true);
    setSyncStatus('fetching');

    try {
      const data = await inferenceApi.getTelemetry({
        lat: weightLat,
        req: weightReq,
        cpu: weightCpu,
        err: weightErr
      });
      try {
        const strategy = await inferenceApi.getRoutingStrategy();
        setActiveStrategy(strategy.strategy);
        setWrrWeights(strategy.wrr_weights);
      } catch (strategyError) {
        console.error('Failed to load routing strategy', strategyError);
      }
      setTelemetry(data);
      setSyncStatus('synced');
      setLastUpdated(data.summary?.last_sync_utc || new Date().toISOString().slice(11, 19) + ' UTC');
      if (isManual) toast.success('Telemetry synchronized');
    } catch (err) {
      console.error('Failed to load telemetry', err);
      setSyncStatus('stale');
      if (isManual) toast.error('Failed to sync telemetry from cluster');
    } finally {
      isFetchingRef.current = false;
      if (isManual) setRefreshing(false);
    }
  }, [weightLat, weightReq, weightCpu, weightErr]);

  // Initial load
  useEffect(() => {
    loadTelemetry();
  }, [loadTelemetry]);

  // Auto-refresh timer with proper cleanup
  useEffect(() => {
    if (refreshInterval > 0) {
      autoRefreshTimerRef.current = setInterval(() => {
        loadTelemetry(false);
      }, refreshInterval);
    }
    return () => {
      if (autoRefreshTimerRef.current) {
        clearInterval(autoRefreshTimerRef.current);
      }
    };
  }, [refreshInterval, loadTelemetry]);

  // Trigger packet animations flowing from client -> router -> serving replica
  const triggerPacketAnimations = useCallback((results: TestTrafficResult[]) => {
    if (!results || results.length === 0) return;

    results.forEach((res, index) => {
      setTimeout(() => {
        const packetId = `pkt-${res.request_id}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
        const newPacket: AnimatedPacket = {
          id: packetId,
          requestId: res.request_id,
          targetReplicaId: res.replica_id,
          targetPodIndex: 0,
          status: res.status,
          latencyMs: res.latency_ms,
          progress: 0,
          strategy: res.routing_strategy || activeStrategy,
          timestamp: Date.now(),
        };

        setActivePackets((prev) => [...prev.slice(-12), newPacket]);

        const startTime = performance.now();
        const duration = 800; // Smooth physical travel duration

        const step = (currentTime: number) => {
          const elapsed = currentTime - startTime;
          const linearProgress = Math.min(1.0, elapsed / duration);
          // Cubic ease-in-out curve for smooth physical acceleration & deceleration
          const progress =
            linearProgress < 0.5
              ? 4 * linearProgress * linearProgress * linearProgress
              : 1 - Math.pow(-2 * linearProgress + 2, 3) / 2;

          setActivePackets((prev) =>
            prev.map((p) => (p.id === packetId ? { ...p, progress } : p))
          );

          if (linearProgress < 1.0) {
            requestAnimationFrame(step);
          } else {
            setRecentlyHitPod(res.replica_id);
            setTimeout(() => {
              setRecentlyHitPod(null);
              setActivePackets((prev) => prev.filter((p) => p.id !== packetId));
            }, 500);
          }
        };

        requestAnimationFrame(step);
      }, index * 90);
    });
  }, [activeStrategy]);

  // Handle trigger real test traffic
  const handleSendTestTraffic = async () => {
    setIsSendingTest(true);
    try {
      toast.loading(`Injecting ${testCount} requests through selected routing...`, { id: 'test-traffic' });
      const res = await inferenceApi.sendTestTraffic(testCount, activeStrategy);
      const dispatched = res.requests || [];
      setTestResults(dispatched);
      triggerPacketAnimations(dispatched);
      toast.success(`Successfully dispatched ${res.count} requests across replicas!`, { id: 'test-traffic' });
      await loadTelemetry(false);
    } catch (err: any) {
      toast.error(`Traffic injection failed: ${err?.message || 'Error'}`, { id: 'test-traffic' });
    } finally {
      setIsSendingTest(false);
    }
  };

  // Callback from AutoTrafficGenerator
  const handleAutoTrafficDispatched = useCallback((results: TestTrafficResult[]) => {
    setTestResults((previous) => {
      const byRequestId = new Map(previous.map((result) => [result.request_id, result]));
      results.forEach((result) => byRequestId.set(result.request_id, result));
      return Array.from(byRequestId.values()).slice(-100);
    });
    triggerPacketAnimations(results);
    loadTelemetry(false);
  }, [triggerPacketAnimations, loadTelemetry]);

  // Save WRR weights to backend and cluster
  const handleSaveWrrWeights = async (newWeights: number[]) => {
    const updated = await inferenceApi.setRoutingStrategy(undefined, newWeights);
    setWrrWeights(updated.wrr_weights);
    await loadTelemetry(false);
  };

  // Save adaptive multi-objective weights to backend and cluster
  const handleSaveAdaptiveWeights = async (weights: { lat: number; req: number; cpu: number; err: number }) => {
    await inferenceApi.setRoutingStrategy(undefined, undefined, weights);
    setWeightLat(weights.lat);
    setWeightReq(weights.req);
    setWeightCpu(weights.cpu);
    setWeightErr(weights.err);
    await loadTelemetry(false);
  };

  const handleRoutingStrategyChange = async (strategy: RoutingStrategy) => {
    setChangingStrategy(true);
    try {
      const updated = await inferenceApi.setRoutingStrategy(strategy);
      setActiveStrategy(updated.strategy);
      setWrrWeights(updated.wrr_weights);
      toast.success(`Routing strategy set to ${updated.strategy_label}`);
      await loadTelemetry(true);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to change routing strategy');
    } finally {
      setChangingStrategy(false);
    }
  };


  // Export JSON metrics
  const handleExportJson = () => {
    if (!telemetry) return;
    const blob = new Blob([JSON.stringify(telemetry, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexus-inference-telemetry-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Telemetry exported to JSON');
  };

  // Honest summary data without fake fallbacks
  const summary = telemetry?.summary || {
    throughput_rps: 0.0,
    throughput_window_s: 5.0,
    p95_latency_ms: null,
    p50_latency_ms: null,
    p99_latency_ms: null,
    error_rate_pct: 0.0,
    healthy_replicas: 0,
    total_replicas: 0,
    total_requests: 0,
    total_success: 0,
    total_errors: 0,
    active_requests: 0,
    gateway_decision_ms: null,
    gateway_decision_desc: 'N/A (In-kernel L4 iptables routing, <0.1ms overhead)',
    active_policy: 'Native Kubernetes Service',
    active_policy_desc: 'L4 iptables round-robin without worker queue awareness',
    gateway_active: false,
    gateway_url: null,
    model_name: 'titanic-classifier:b0ca6d39',
    namespace: 'mlops',
    cluster_name: 'Minikube Local Cluster (v1.37)',
    last_sync_utc: lastUpdated
  };

  const isGatewayActive = activeStrategy !== 'native';
  const isWeightedRoundRobin = activeStrategy === 'weighted_round_robin';
  const isAdaptiveRouting = activeStrategy === 'adaptive';
  const activeStrategyTitle = isWeightedRoundRobin
    ? 'Weighted Round Robin'
    : isAdaptiveRouting ? 'Adaptive Dynamic Routing'
    : activeStrategy === 'round_robin' ? 'Round Robin' : 'Native Kubernetes Service';
  const replicas: ReplicaTelemetry[] = telemetry?.replicas || EMPTY_REPLICAS;
  const telemetryEvents: RecentEvent[] = telemetry?.recent_events || EMPTY_EVENTS;

  // Merge recent events from telemetry with local dispatched results for Gantt and table
  const allTimelineEvents: RecentEvent[] = useMemo(() => {
    const map = new Map<string, RecentEvent>();
    // 1. Add from local testResults
    testResults.forEach((r) => {
      if (clearedEventIds.has(r.request_id)) return;
      map.set(r.request_id, {
        timestamp: r.timestamp || new Date().toISOString().slice(11, 19),
        request_id: r.request_id,
        assigned_pod: r.replica_id?.split('-')?.pop() || r.replica_id,
        replica_id: r.replica_id,
        routing_mechanism: r.routing_strategy || activeStrategy,
        observed_latency_ms: r.latency_ms,
        duration_ms: r.duration_ms || r.latency_ms,
        start_epoch_ms: r.start_epoch_ms || (r.timestamp ? Date.parse(r.timestamp) || 0 : 0),
        gateway_latency_ms: r.gateway_latency_ms,
        upstream_latency_ms: r.upstream_latency_ms,
        http_status: r.status_text || `${r.status} OK`,
        status_code: r.status,
        traffic_type: r.traffic_type || 'test',
      });
    });
    // 2. Add from telemetry recent_events
    telemetryEvents.forEach((ev) => {
      if (clearedEventIds.has(ev.request_id)) return;
      if (!map.has(ev.request_id)) {
        map.set(ev.request_id, ev);
      }
    });

    return Array.from(map.values()).sort((a, b) => {
      const epochA = a.start_epoch_ms || 0;
      const epochB = b.start_epoch_ms || 0;
      if (epochA !== epochB) return epochB - epochA;
      return b.timestamp.localeCompare(a.timestamp);
    });
  }, [testResults, telemetryEvents, activeStrategy, clearedEventIds]);

  const recentEvents: RecentEvent[] = allTimelineEvents;

  // Filtered recent events for table
  const filteredEvents = recentEvents.filter((ev) => {
    const matchesSearch =
      !searchFilter ||
      ev.request_id.toLowerCase().includes(searchFilter.toLowerCase()) ||
      ev.assigned_pod.toLowerCase().includes(searchFilter.toLowerCase()) ||
      ev.replica_id.toLowerCase().includes(searchFilter.toLowerCase());

    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === '200' && ev.http_status.includes('200')) ||
      (statusFilter === 'ERR' && !ev.http_status.includes('200'));

    return matchesSearch && matchesStatus;
  });


  // Extract real history series for sparklines & charts
  const historyThroughput = telemetry?.history?.throughput_trend?.map(t => t.rps) || [];
  const historyErrors = telemetry?.history?.throughput_trend?.map(t => t.errors) || [];
  const historyLatencyP50 = telemetry?.history?.latency_trend?.map(t => t.p50) || [];
  const historyLatencyP95 = telemetry?.history?.latency_trend?.map(t => t.p95) || [];
  const historyLatencyP99 = telemetry?.history?.latency_trend?.map(t => t.p99) || [];

  // Check if active traffic is genuinely observed
  const hasActiveTraffic = summary.throughput_rps > 0;

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-5">
      <Header
        category="Inference"
        title="Adaptive Load Balancing"
        subtitle="Monitor inference traffic, replica health, and routing performance across your cluster."
        action={(
          <div className="flex flex-wrap items-center gap-2.5">
            <span className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-medium ${
              syncStatus === 'stale'
                ? 'bg-amber-50 text-amber-700 border-amber-200'
                : 'bg-white text-slate-600 border-slate-200'
            }`}>
              <span className={`h-2 w-2 rounded-full ${syncStatus === 'stale' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
              {syncStatus === 'stale' ? 'Telemetry stale' : 'Live telemetry'}
            </span>
            <span className="hidden xl:inline text-xs text-slate-500">
              Updated {summary.last_sync_utc}
            </span>
            <button
              onClick={() => loadTelemetry(true)}
              disabled={refreshing}
              className={`inline-flex items-center justify-center p-2 rounded-lg border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-800 text-slate-600 dark:text-neutral-300 hover:bg-slate-50 dark:hover:bg-neutral-700 disabled:opacity-60 ${refreshing ? 'animate-spin text-indigo-600 dark:text-indigo-400' : ''}`}
              title="Refresh telemetry"
              aria-label="Refresh telemetry"
              type="button"
            >
              <RotateCw size={16} />
            </button>
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              className="px-2.5 py-2 rounded-lg text-xs font-medium bg-white dark:bg-neutral-800 text-slate-700 dark:text-neutral-200 border border-slate-200 dark:border-neutral-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              title="Auto-refresh interval"
              aria-label="Auto-refresh interval"
            >
              <option value={2000}>Every 2 seconds</option>
              <option value={5000}>Every 5 seconds</option>
              <option value={10000}>Every 10 seconds</option>
              <option value={0}>Paused</option>
            </select>
          </div>
        )}
      />
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-end gap-2.5">
          <div className="flex items-center bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-lg p-0.5 shadow-sm">
            <button
              onClick={handleSendTestTraffic}
              disabled={isSendingTest}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors disabled:opacity-60"
            >
              {isSendingTest ? (
                <RotateCw size={15} className="animate-spin" />
              ) : (
                <Play size={15} fill="currentColor" />
              )}
              <span>Send test traffic</span>
            </button>
            <select
              value={testCount}
              onChange={(e) => setTestCount(Number(e.target.value))}
              className="text-sm bg-transparent border-0 px-2 py-2 text-slate-700 focus:ring-0 cursor-pointer"
              title="Number of requests"
              aria-label="Number of test requests"
            >
              <option value={1}>1 request</option>
              <option value={5}>5 requests</option>
              <option value={10}>10 requests</option>
              <option value={20}>20 requests</option>
            </select>
          </div>

          <button
            onClick={() => {
              document.getElementById('objective-tuning-panel')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm font-medium shadow-sm transition-colors"
          >
            <Sliders size={15} className="text-slate-400" />
            <span>Configure weights</span>
          </button>

          <button
            onClick={handleExportJson}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 text-slate-700 dark:text-neutral-200 hover:bg-slate-50 dark:hover:bg-neutral-700 text-sm font-medium shadow-sm transition-colors cursor-pointer"
            title="Export telemetry JSON"
          >
            <Download size={15} className="text-slate-400" />
            <span>Export Logs</span>
          </button>
        </div>

        {/* ==================== SECTION 1: 5 KPI SUMMARY CARDS ==================== */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          {/* KPI 1: Throughput */}
          <div className="group flex min-h-[168px] flex-col justify-between rounded-2xl border border-slate-200/70 dark:border-neutral-800 bg-white dark:bg-[#151515] p-4 shadow-[0_10px_28px_rgba(15,23,42,0.04)] transition-shadow hover:shadow-[0_16px_32px_rgba(15,23,42,0.07)] sm:p-5">
            <div className="flex items-center justify-between text-slate-500 dark:text-neutral-400">
              <span className="text-xs font-semibold">Throughput</span>
              <Zap size={16} className="text-slate-400 dark:text-neutral-500" />
            </div>
            <div className="my-2">
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-neutral-100 font-mono">
                  {summary.throughput_rps.toFixed(1)}
                </span>
                <span className="text-xs text-slate-500 dark:text-neutral-400 font-mono">req/s</span>
              </div>
              <div className="flex items-center gap-1 mt-1 text-xs font-medium">
                {hasActiveTraffic ? (
                  <span className="text-emerald-600 dark:text-emerald-400">↑ Active stream</span>
                ) : (
                  <span className="text-slate-400 dark:text-neutral-500">● Idle (0.0 req/s)</span>
                )}
                <span className="text-slate-400 dark:text-neutral-500">· {summary.total_requests} total</span>
              </div>
            </div>
            {/* Real Dynamic Sparkline */}
            <div className="w-full h-7 pt-1">
              <svg className="w-full h-full" fill="none" preserveAspectRatio="none" viewBox="0 0 100 24" aria-label="Throughput trend">
                <defs><linearGradient id="throughput-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#5DBEAA" stopOpacity="0.2" /><stop offset="100%" stopColor="#5DBEAA" stopOpacity="0" /></linearGradient></defs>
                <path d={generateSparklineArea(historyThroughput, 100, 24)} fill="url(#throughput-fill)" />
                <path d={generateSparkline(historyThroughput, 100, 24)} fill="none" stroke="#52A995" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
              </svg>
            </div>
          </div>

          {/* KPI 2: P95 Latency */}
          <div className="group flex min-h-[168px] flex-col justify-between rounded-2xl border border-slate-200/70 dark:border-neutral-800 bg-white dark:bg-[#151515] p-4 shadow-[0_10px_28px_rgba(15,23,42,0.04)] transition-shadow hover:shadow-[0_16px_32px_rgba(15,23,42,0.07)] sm:p-5">
            <div className="flex items-center justify-between text-slate-500 dark:text-neutral-400">
              <span className="text-xs font-semibold">P95 latency</span>
              <Clock size={16} className="text-slate-400 dark:text-neutral-500" />
            </div>
            <div className="my-2">
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-neutral-100 font-mono">
                  {summary.p95_latency_ms != null ? summary.p95_latency_ms.toFixed(1) : 'N/A'}
                </span>
                <span className="text-xs text-slate-500 dark:text-neutral-400 font-mono">ms</span>
              </div>
              <div className="flex items-center gap-1 mt-1 text-xs text-indigo-600 dark:text-indigo-400 font-medium">
                {summary.p50_latency_ms != null ? (
                  <span>P50: {summary.p50_latency_ms.toFixed(1)}ms</span>
                ) : (
                  <span className="text-slate-400 dark:text-neutral-500">
                    {summary.total_requests < 5 ? `Samples: n=${summary.total_requests} (need ≥5 for P95)` : 'Awaiting data'}
                  </span>
                )}
                <span className="text-slate-400 dark:text-neutral-500">· Target &lt; 100ms</span>
              </div>
            </div>
            {/* Real Dynamic Latency Sparkline */}
            <div className="w-full h-7 pt-1">
              <svg className="w-full h-full" fill="none" preserveAspectRatio="none" viewBox="0 0 100 24" aria-label="P95 latency trend">
                <defs><linearGradient id="latency-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#818cf8" stopOpacity="0.2" /><stop offset="100%" stopColor="#818cf8" stopOpacity="0" /></linearGradient></defs>
                <path d={generateSparklineArea(historyLatencyP95, 100, 24)} fill="url(#latency-fill)" />
                <path d={generateSparkline(historyLatencyP95, 100, 24)} fill="none" stroke="#4f46e5" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
              </svg>
            </div>
          </div>

          {/* KPI 3: Error Rate */}
          <div className="group flex min-h-[160px] flex-col justify-between rounded-2xl border border-slate-200/80 dark:border-neutral-800 bg-white dark:bg-[#151515] p-4.5 shadow-xs transition-shadow hover:shadow-md sm:p-5">
            <div className="flex items-center justify-between text-slate-500 dark:text-neutral-400">
              <span className="text-xs font-semibold">Error rate</span>
              <AlertTriangle size={16} className="text-slate-400 dark:text-neutral-500" />
            </div>
            <div className="my-2">
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-neutral-100 font-mono">
                  {summary.error_rate_pct.toFixed(2)}%
                </span>
              </div>
              <div className="flex items-center gap-1.5 mt-1 text-xs">
                <span className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${
                  summary.total_errors === 0
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                    : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
                }`}>
                  {summary.total_errors === 0 ? 'HEALTHY' : 'WARNING'}
                </span>
                <span className="text-slate-500 dark:text-neutral-400 font-mono text-[11px]">
                  {summary.total_errors} err / {summary.total_requests} req
                </span>
              </div>
            </div>
            {/* Real Error Sparkline */}
            <div className="w-full h-7 pt-1">
              <svg className="w-full h-full" fill="none" preserveAspectRatio="none" viewBox="0 0 100 24" aria-label="Error rate trend">
                <defs><linearGradient id="error-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={summary.total_errors > 0 ? '#E99A9A' : '#72BEAA'} stopOpacity="0.18" /><stop offset="100%" stopColor={summary.total_errors > 0 ? '#E99A9A' : '#72BEAA'} stopOpacity="0" /></linearGradient></defs>
                <path d={generateSparklineArea(historyErrors, 100, 24)} fill="url(#error-fill)" />
                <path d={generateSparkline(historyErrors, 100, 24)} fill="none" stroke={summary.total_errors > 0 ? '#D98787' : '#62AA97'} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
              </svg>
            </div>
          </div>

          {/* KPI 4: Active Replicas */}
          <div className="group flex min-h-[160px] flex-col justify-between rounded-2xl border border-slate-200/80 dark:border-neutral-800 bg-white dark:bg-[#151515] p-4.5 shadow-xs transition-shadow hover:shadow-md sm:p-5">
            <div className="flex items-center justify-between text-slate-500 dark:text-neutral-400">
              <span className="text-xs font-semibold">Active replicas</span>
              <Server size={16} className="text-slate-400 dark:text-neutral-500" />
            </div>
            <div className="my-2">
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-neutral-100 font-mono">
                  {summary.healthy_replicas} / {summary.total_replicas || 3}
                </span>
              </div>
              <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-500 dark:text-neutral-400">
                <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                <span>All 3 Pods Ready & Scraped</span>
              </div>
            </div>
            {/* Proportional Load Bar */}
            <div className="w-full pt-1">
              <div className="w-full bg-slate-100 dark:bg-neutral-800 h-2 rounded-full flex overflow-hidden">
                {replicas.map((rep) => (
                  <div
                    key={rep.name}
                    style={{
                      width: `${rep.traffic_share_pct || 0}%`,
                      backgroundColor: rep.color
                    }}
                    title={`${rep.name}: ${rep.traffic_share_pct}%`}
                  />
                ))}
              </div>
              <div className="flex justify-between items-center text-[10px] text-slate-500 dark:text-neutral-400 font-mono mt-1">
                <span>Pod 1 (50%)</span>
                <span>Pod 2 (30%)</span>
                <span>Pod 3 (20%)</span>
              </div>
            </div>
          </div>

          {/* KPI 5: Gateway Dispatch Overhead */}
          <div className="group flex min-h-[160px] flex-col justify-between rounded-2xl border border-slate-200/80 dark:border-neutral-800 bg-white dark:bg-[#151515] p-4.5 shadow-xs transition-shadow hover:shadow-md sm:p-5">
            <div className="flex items-center justify-between text-slate-500 dark:text-neutral-400">
              <span className="text-xs font-semibold">Gateway dispatch</span>
              <Cpu size={16} className="text-slate-400 dark:text-neutral-500" />
            </div>
            <div className="my-2">
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-neutral-100 font-mono">
                  {summary.gateway_decision_ms != null ? `${summary.gateway_decision_ms} ms` : (isGatewayActive ? '<1 ms' : 'N/A')}
                </span>
                <span className="text-xs text-slate-500 dark:text-neutral-400 font-mono">
                  {isGatewayActive ? 'L7 Gateway' : 'L4 iptables'}
                </span>
              </div>
              <div className="flex items-center gap-1 mt-1 text-xs text-slate-500 dark:text-neutral-400">
                <span className={isGatewayActive ? "text-emerald-600 dark:text-emerald-400 font-semibold" : "text-indigo-600 dark:text-indigo-400 font-semibold"}>
                  {isGatewayActive ? `${activeStrategyTitle} Proxy` : 'Zero-Hop Gateway'}
                </span>
                <span>·</span>
                <span className="font-mono text-[10px]">
                  {summary.gateway_decision_desc || (isGatewayActive ? `${activeStrategyTitle} Dispatch` : '<0.1ms overhead')}
                </span>
              </div>
            </div>
            {/* Routing Status Badge */}
            <div className="w-full h-7 pt-1 flex items-center">
              <div className={`w-full py-1 px-2 rounded-lg border text-center text-[10px] font-mono font-medium truncate ${
                isGatewayActive
                  ? 'bg-emerald-50/70 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200/80 dark:border-emerald-800'
                  : 'bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 border-indigo-200/80 dark:border-indigo-800'
              }`}>
                {isGatewayActive ? `USER-SPACE L7 • ${activeStrategyTitle.toUpperCase()}` : 'KERNEL L4 • WIRE-SPEED'}
              </div>
            </div>
          </div>
        </div>

        {/* ==================== SECTION 2: 3-COLUMN BALANCING & TUNING MATRIX ==================== */}
        <div id="objective-tuning-panel" className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          {/* Strategy Selection (Column 1) */}
          <div className="rounded-2xl border border-slate-200/80 dark:border-neutral-800 bg-white dark:bg-[#151515] p-5 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100 dark:border-neutral-800">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/50 shrink-0">
                    <Zap size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-neutral-100">Routing Engine</h3>
                    <p className="text-[11px] text-slate-500 dark:text-neutral-400">Load distribution strategy</p>
                  </div>
                </div>
                <span className="text-[10px] font-mono uppercase bg-slate-100 dark:bg-neutral-800 text-slate-600 dark:text-neutral-400 px-2 py-0.5 rounded font-semibold border border-slate-200 dark:border-neutral-700 shrink-0">
                  K8S INGRESS
                </span>
              </div>

              {/* Strategy Options Radio Grid */}
              <div className="space-y-2">
                {/* 1. Round Robin Gateway */}
                <label className={`flex items-start gap-2.5 p-2.5 rounded-xl cursor-pointer border transition-all ${
                  activeStrategy === 'round_robin'
                    ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-500 ring-1 ring-emerald-500/20'
                    : 'bg-slate-50/70 dark:bg-neutral-900/60 border-slate-200/80 dark:border-neutral-800 hover:border-slate-300 dark:hover:border-neutral-700'
                }`}>
                  <input
                    type="radio"
                    name="strategy"
                    checked={activeStrategy === 'round_robin'}
                    onChange={() => handleRoutingStrategyChange('round_robin')}
                    disabled={changingStrategy || isGeneratingTraffic}
                    className="mt-0.5 text-emerald-600 focus:ring-0 shrink-0 cursor-pointer"
                  />
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${activeStrategy === 'round_robin' ? 'text-emerald-900 dark:text-emerald-300' : 'text-slate-800 dark:text-neutral-200'}`}>
                        Round Robin Gateway
                      </span>
                      <span className={`px-1.5 py-0.2 rounded font-mono text-[9px] font-bold ${
                        activeStrategy === 'round_robin' ? 'bg-emerald-600 text-white' : 'bg-slate-200 dark:bg-neutral-800 text-slate-600 dark:text-neutral-400'
                      }`}>
                        {activeStrategy === 'round_robin' ? 'ACTIVE' : 'AVAILABLE'}
                      </span>
                    </div>
                    <span className={`text-[11px] mt-0.5 leading-snug ${activeStrategy === 'round_robin' ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-neutral-400'}`}>
                      L7 user-space proxy rotates requests evenly across healthy pods.
                    </span>
                  </div>
                </label>

                {/* 2. Native Kubernetes Service */}
                <label className={`flex items-start gap-2.5 p-2.5 rounded-xl cursor-pointer border transition-all ${
                  activeStrategy === 'native'
                    ? 'bg-indigo-50/70 dark:bg-indigo-950/30 border-indigo-500 ring-1 ring-indigo-500/20'
                    : 'bg-slate-50/70 dark:bg-neutral-900/60 border-slate-200/80 dark:border-neutral-800 hover:border-slate-300 dark:hover:border-neutral-700'
                }`}>
                  <input
                    type="radio"
                    name="strategy"
                    checked={activeStrategy === 'native'}
                    onChange={() => handleRoutingStrategyChange('native')}
                    disabled={changingStrategy || isGeneratingTraffic}
                    className="mt-0.5 text-indigo-600 focus:ring-0 shrink-0 cursor-pointer"
                  />
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${activeStrategy === 'native' ? 'text-indigo-900 dark:text-indigo-300' : 'text-slate-800 dark:text-neutral-200'}`}>
                        Native Kubernetes Service
                      </span>
                      <span className={`px-1.5 py-0.2 rounded font-mono text-[9px] font-bold ${
                        activeStrategy === 'native' ? 'bg-indigo-600 text-white' : 'bg-slate-200 dark:bg-neutral-800 text-slate-600 dark:text-neutral-400'
                      }`}>
                        {activeStrategy === 'native' ? 'BASELINE' : 'BASELINE'}
                      </span>
                    </div>
                    <span className={`text-[11px] mt-0.5 leading-snug ${activeStrategy === 'native' ? 'text-indigo-700 dark:text-indigo-400' : 'text-slate-500 dark:text-neutral-400'}`}>
                      L4 iptables/IPVS connection tracking without worker queue awareness.
                    </span>
                  </div>
                </label>

                {/* 3. Weighted Round Robin */}
                <label className={`flex items-start gap-2.5 p-2.5 rounded-xl cursor-pointer border transition-all ${
                  activeStrategy === 'weighted_round_robin'
                    ? 'bg-indigo-50/70 dark:bg-indigo-950/30 border-indigo-500 ring-1 ring-indigo-500/20'
                    : 'bg-slate-50/70 dark:bg-neutral-900/60 border-slate-200/80 dark:border-neutral-800 hover:border-slate-300 dark:hover:border-neutral-700'
                }`}>
                  <input
                    type="radio"
                    name="strategy"
                    checked={activeStrategy === 'weighted_round_robin'}
                    onChange={() => handleRoutingStrategyChange('weighted_round_robin')}
                    disabled={changingStrategy || isGeneratingTraffic}
                    className="mt-0.5 text-indigo-600 focus:ring-0 shrink-0 cursor-pointer"
                  />
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${activeStrategy === 'weighted_round_robin' ? 'text-indigo-900 dark:text-indigo-300' : 'text-slate-800 dark:text-neutral-200'}`}>
                        Weighted Round Robin
                      </span>
                      <span className={`px-1.5 py-0.2 rounded font-mono text-[9px] font-bold ${
                        activeStrategy === 'weighted_round_robin' ? 'bg-indigo-600 text-white' : 'bg-slate-200 dark:bg-neutral-800 text-slate-600 dark:text-neutral-400'
                      }`}>
                        {activeStrategy === 'weighted_round_robin' ? 'ACTIVE' : 'AVAILABLE'}
                      </span>
                    </div>
                    <span className={`text-[11px] mt-0.5 leading-snug ${activeStrategy === 'weighted_round_robin' ? 'text-indigo-700 dark:text-indigo-400' : 'text-slate-500 dark:text-neutral-400'}`}>
                      Smooth weighted rotation. Configured weights: {wrrWeights.join(':')}.
                    </span>
                  </div>
                </label>

                {/* 4. Adaptive Dynamic Routing */}
                <label className={`flex items-start gap-2.5 p-2.5 rounded-xl cursor-pointer border transition-all ${
                  activeStrategy === 'adaptive'
                    ? 'bg-indigo-50/70 dark:bg-indigo-950/30 border-indigo-500 ring-1 ring-indigo-500/20'
                    : 'bg-slate-50/70 dark:bg-neutral-900/60 border-slate-200/80 dark:border-neutral-800 hover:border-slate-300 dark:hover:border-neutral-700'
                }`}>
                  <input
                    type="radio"
                    name="strategy"
                    checked={activeStrategy === 'adaptive'}
                    onChange={() => handleRoutingStrategyChange('adaptive')}
                    disabled={changingStrategy || isGeneratingTraffic}
                    className="mt-0.5 text-indigo-600 focus:ring-0 shrink-0 cursor-pointer"
                  />
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${activeStrategy === 'adaptive' ? 'text-indigo-900 dark:text-indigo-300' : 'text-slate-800 dark:text-neutral-200'}`}>
                        Adaptive Dynamic Routing
                      </span>
                      <span className={`px-1.5 py-0.2 rounded font-mono text-[9px] font-bold ${
                        activeStrategy === 'adaptive' ? 'bg-indigo-600 text-white' : 'bg-slate-200 dark:bg-neutral-800 text-slate-600 dark:text-neutral-400'
                      }`}>
                        {activeStrategy === 'adaptive' ? 'ACTIVE' : 'AVAILABLE'}
                      </span>
                    </div>
                    <span className={`text-[11px] mt-0.5 leading-snug ${activeStrategy === 'adaptive' ? 'text-indigo-700 dark:text-indigo-400' : 'text-slate-500 dark:text-neutral-400'}`}>
                      Dispatches to lowest composite penalty replica (latency/queue/CPU/error).
                    </span>
                  </div>
                </label>
              </div>
            </div>

            {/* Active Status Banner */}
            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-neutral-800">
              <div className={`p-2.5 rounded-xl border text-[11px] flex items-start gap-2 ${
                isGatewayActive
                  ? 'bg-emerald-50/70 dark:bg-emerald-950/40 border-emerald-200/80 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                  : 'bg-indigo-50/70 dark:bg-indigo-950/40 border-indigo-200/80 dark:border-indigo-800 text-indigo-800 dark:text-indigo-300'
              }`}>
                <ShieldCheck size={16} className={isGatewayActive ? "text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" : "text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5"} />
                <span>
                  <strong>{isGatewayActive ? 'Custom Gateway Active:' : 'Native Baseline Active:'}</strong>{' '}
                  {isGatewayActive
                    ? `Dispatched via L7 ${activeStrategyTitle} proxy.`
                    : 'In-kernel ClusterIP iptables dispatch.'}
                </span>
              </div>
            </div>
          </div>

          {/* Configurable Live Weights & Adaptive Objective Tuning (Columns 2 & 3) */}
          <ConfigurableWeightsPanel
            replicas={replicas}
            activeStrategy={activeStrategy}
            confirmedWrrWeights={wrrWeights}
            confirmedAdaptiveWeights={{ lat: weightLat, req: weightReq, cpu: weightCpu, err: weightErr }}
            onSaveWrrWeights={handleSaveWrrWeights}
            onSaveAdaptiveWeights={handleSaveAdaptiveWeights}
          />
        </div>

        <section aria-label="Locust load generation" className="w-full">
          <AutoTrafficGenerator
            activeStrategy={activeStrategy}
            activeStrategyTitle={activeStrategyTitle}
            isGatewayActive={isGatewayActive}
            onTrafficDispatched={handleAutoTrafficDispatched}
            onActiveTrafficChange={setIsGeneratingTraffic}
          />
        </section>
        {/* Live request-routing topology */}
        <LiveRoutingVisualizer
          replicas={replicas}
          activeStrategy={activeStrategy}
          activeStrategyTitle={activeStrategyTitle}
          isGatewayActive={isGatewayActive}
          activePackets={activePackets}
          recentlyHitPod={recentlyHitPod}
          onSelectReplica={(r) => setSelectedReplicaModal(r)}
          throughputRps={summary.throughput_rps}
          isGeneratingTraffic={isGeneratingTraffic}
        />

        <section aria-label="Inference replica diagnostics" className="w-full">
          {/* Replica diagnostics table */}
          <div className="min-w-0 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_10px_28px_rgba(15,23,42,0.04)] sm:p-6 flex flex-col justify-between">
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900">Inference Pods Diagnostics</h3>
                  <span className="text-xs text-slate-500">
                    Direct metrics gathered independently from each replica pod
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded font-semibold">
                    ● {summary.healthy_replicas} Pods In Quorum
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-xs font-semibold text-slate-500 bg-slate-50 border-b border-slate-200">
                      <th className="py-2.5 px-3">Pod replica</th>
                      <th className="py-2.5 px-3">Pod IP</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Served</th>
                      <th className="py-2.5 px-3">Active</th>
                      <th className="py-2.5 px-3">P95</th>
                      <th className="py-2.5 px-3">CPU</th>
                      <th className="py-2.5 px-3">Memory</th>
                      <th className="py-2.5 px-3" title="Score used by the gateway in its latest Adaptive decision. Lower is better.">
                        <span className="block">GATEWAY SCORE</span>
                        <span className="text-[9px] font-normal text-slate-400">latest decision · lower is better</span>
                      </th>
                      <th className="py-2.5 px-3">PREVIEW SCORE</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono divide-y divide-slate-100">
                    {replicas.map((rep) => (
                      <tr
                        key={rep.replica_id}
                        className="hover:bg-slate-50 transition-colors"
                      >
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            <span className="w-1.5 h-6 rounded-full" style={{ backgroundColor: rep.color }} />
                            <div>
                              <span className="font-bold text-slate-900 block">{rep.name}</span>
                              <span className="text-[10px] text-slate-400 truncate max-w-[120px] block">
                                {rep.replica_id}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">{rep.pod_ip}</td>
                        <td className="py-2.5 px-3">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            rep.is_ready ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${rep.is_ready ? 'bg-emerald-500' : 'bg-red-500'}`} />
                            {rep.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-900">{rep.requests_served} req</td>
                        <td className="py-2.5 px-3 text-slate-700">{rep.active_requests}</td>
                        <td className="py-2.5 px-3 font-semibold" style={{ color: rep.color }}>
                          {rep.p95_latency_ms != null ? `${rep.p95_latency_ms} ms` : (rep.requests_served < 5 ? `n=${rep.requests_served}` : 'N/A')}
                        </td>
                        <td className="py-2.5 px-3 text-slate-800">
                          {rep.cpu_pct != null ? `${rep.cpu_raw} (${rep.cpu_pct.toFixed(0)}%)` : 'N/A'}
                        </td>
                        <td className="py-2.5 px-3 text-slate-800">
                          {rep.mem_pct != null ? `${rep.mem_raw} (${rep.mem_pct.toFixed(0)}%)` : 'N/A'}
                        </td>
                        <td
                          className="py-2.5 px-3 font-bold text-violet-700"
                          title={rep.gateway_score_at ? `Latest Adaptive decision at ${new Date(rep.gateway_score_at * 1000).toLocaleTimeString()}` : 'No Adaptive decision has been recorded yet'}
                        >
                          {rep.gateway_score != null ? (
                            <span className="inline-flex items-center gap-1.5">
                              {rep.gateway_score.toFixed(3)}
                              {rep.gateway_selected && <span className="rounded bg-violet-100 px-1 py-0.5 text-[9px]">LAST SELECTED</span>}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-slate-800">
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                            {rep.score.toFixed(3)}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            onClick={() => setSelectedReplicaModal(rep)}
                            className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors"
                            title="Inspect Replica"
                          >
                            <Terminal size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-neutral-800 flex items-center justify-between text-xs text-slate-500 dark:text-neutral-400">
              <span>Showing 3 replica workers with independent Prometheus scrapers and warm caches.</span>
              <span className="font-mono text-indigo-600 dark:text-indigo-400 font-medium">HPA Scale Target: 3 Min / 10 Max</span>
            </div>
          </div>

        </section>

        {/* Performance and resource charts */}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {/* CHART A: Latency Over Time - REAL OBSERVATIONS */}
          <div className="min-w-0 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_10px_28px_rgba(15,23,42,0.04)] sm:p-6 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-slate-900 text-sm">Latency Distribution Over Time</h3>
                  <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-mono text-[10px] font-bold border border-emerald-200">
                    REAL OBSERVATIONS
                  </span>
                </div>
                <span className="text-xs text-slate-500">P50 vs P95 vs P99 response time in milliseconds</span>
              </div>
              <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-xs">
                {(['5m', '15m', '1h'] as const).map((w) => (
                  <button
                    key={w}
                    onClick={() => setChartTimeWindow(w)}
                    className={`px-2 py-0.5 rounded font-medium transition-all ${
                      chartTimeWindow === w ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {w}
                  </button>
                ))}
              </div>
            </div>

            {/* Dynamic Latency SVG Chart */}
            <div className="relative w-full h-52 pt-2">
              <svg className="w-full h-full" fill="none" viewBox="0 0 500 180">
                {/* Horizontal Grid */}
                <line stroke="#E9EEF5" strokeDasharray="3 3" x1="40" x2="480" y1="20" y2="20" />
                <line stroke="#E9EEF5" strokeDasharray="3 3" x1="40" x2="480" y1="60" y2="60" />
                <line stroke="#E9EEF5" strokeDasharray="3 3" x1="40" x2="480" y1="100" y2="100" />
                <line stroke="#E9EEF5" strokeDasharray="3 3" x1="40" x2="480" y1="140" y2="140" />

                {/* Y-Axis Labels */}
                <text fill="#737686" fontFamily="JetBrains Mono" fontSize="10" textAnchor="end" x="35" y="24">500ms</text>
                <text fill="#737686" fontFamily="JetBrains Mono" fontSize="10" textAnchor="end" x="35" y="64">350ms</text>
                <text fill="#737686" fontFamily="JetBrains Mono" fontSize="10" textAnchor="end" x="35" y="104">200ms</text>
                <text fill="#737686" fontFamily="JetBrains Mono" fontSize="10" textAnchor="end" x="35" y="144">50ms</text>

                {/* Real Dynamic P99 Line (Red, Dashed) */}
                <path
                  d={generateChartPath(historyLatencyP99, 500, 180, 40, 20, 20, 40, 500)}
                  fill="none"
                  stroke="#D99A9A"
                  strokeDasharray="4 4"
                  strokeLinecap="round"
                  strokeWidth="1.5"
                />

                {/* Real Dynamic P95 Line (Indigo) */}
                <path
                  d={generateChartPath(historyLatencyP95, 500, 180, 40, 20, 20, 40, 500)}
                  fill="none"
                  stroke="#4f46e5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                />

                {/* Real Dynamic P50 Line (Green) */}
                <path
                  d={generateChartPath(historyLatencyP50, 500, 180, 40, 20, 20, 40, 500)}
                  fill="none"
                  stroke="#62AA97"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
              </svg>

              {/* Tooltip Overlay displaying real measured values */}
              <div className="absolute right-4 top-3 rounded-xl border border-slate-200 dark:border-neutral-800 bg-white/95 dark:bg-[#151515]/95 p-2.5 font-mono text-[11px] text-slate-700 dark:text-neutral-300 shadow-sm sm:right-8">
                <div className="text-teal-700 dark:text-teal-400 font-semibold mb-1">
                  Active Latency Observation
                </div>
                <div className="flex justify-between gap-4 text-slate-600 dark:text-neutral-400">
                  <span>P99:</span>
                  <span className="font-bold text-slate-900 dark:text-neutral-100">
                    {summary.p99_latency_ms != null ? `${summary.p99_latency_ms.toFixed(1)} ms` : 'N/A (n<10)'}
                  </span>
                </div>
                <div className="flex justify-between gap-4 text-indigo-700 dark:text-indigo-400">
                  <span>P95:</span>
                  <span className="font-bold text-slate-900 dark:text-neutral-100">
                    {summary.p95_latency_ms != null ? `${summary.p95_latency_ms.toFixed(1)} ms` : 'N/A (n<5)'}
                  </span>
                </div>
                <div className="flex justify-between gap-4 text-teal-700 dark:text-teal-400">
                  <span>P50:</span>
                  <span className="font-bold text-slate-900 dark:text-neutral-100">
                    {summary.p50_latency_ms != null ? `${summary.p50_latency_ms.toFixed(1)} ms` : 'N/A'}
                  </span>
                </div>
              </div>
            </div>

            {/* Legend */}
            <div className="flex items-center justify-center gap-6 pt-2 font-mono text-xs text-slate-500 dark:text-neutral-400">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-red-500" />
                <span>P99 (Max Jitter)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-1 bg-indigo-600 rounded" />
                <span className="font-semibold text-slate-900 dark:text-neutral-100">P95</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-emerald-500" />
                <span>P50 (Median)</span>
              </div>
            </div>
          </div>

          {/* CHART B: Request Distribution by Replica - OBSERVED DATA */}
          <div className="min-w-0 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_10px_28px_rgba(15,23,42,0.04)] sm:p-6 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Request Distribution by Replica</h3>
                <span className="text-xs text-slate-500">Observed traffic share across backend pod replicas</span>
              </div>
              <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-700 font-medium">
                Normalized %
              </span>
            </div>

            {/* Stacked Proportional Visualization */}
            <div className="w-full h-52 flex flex-col justify-center px-4">
              {summary.total_requests > 0 ? (
                <div className="space-y-4">
                  <div className="w-full bg-slate-100 h-8 rounded-lg flex overflow-hidden shadow-inner">
                    {replicas.map((rep) => (
                      <div
                        key={rep.name}
                        style={{
                          width: `${rep.traffic_share_pct}%`,
                          backgroundColor: rep.color
                        }}
                        className="h-full flex items-center justify-center text-white font-mono text-xs font-bold transition-all"
                        title={`${rep.name}: ${rep.traffic_share_pct}% (${rep.requests_served} reqs)`}
                      >
                        {rep.traffic_share_pct > 15 ? `${rep.traffic_share_pct}%` : ''}
                      </div>
                    ))}
                  </div>

                  {/* Per-replica breakdown bars */}
                  <div className="space-y-2 font-mono text-xs">
                    {replicas.map((rep) => (
                      <div key={rep.name} className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-100">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: rep.color }} />
                          <span className="font-bold text-slate-900">{rep.name}</span>
                          <span className="text-slate-400 text-[11px]">({rep.pod_ip})</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-slate-600">{rep.requests_served} requests</span>
                          <span className="font-bold" style={{ color: rep.color }}>{rep.traffic_share_pct}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-slate-400 font-mono text-xs">
                  No requests recorded yet. Dispatch test requests to view distribution.
                </div>
              )}
            </div>

            {/* Legend with Live Shares */}
            <div className="flex items-center justify-center gap-6 pt-2 font-mono text-xs">
              {replicas.map((rep) => (
                <div key={rep.name} className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded" style={{ backgroundColor: rep.color }} />
                  <span className="text-slate-900 font-medium">
                    {rep.name} ({rep.traffic_share_pct}%)
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* CHART C: Pod Compute Saturation - REAL METRICS SERVER DATA */}
          <div className="min-w-0 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_10px_28px_rgba(15,23,42,0.04)] sm:p-6 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Pod Compute Saturation</h3>
                <span className="text-xs text-slate-500">
                  Real CPU Core Load % vs Memory Resident Set (RSS) % from K8s Metrics Server
                </span>
              </div>
              <Cpu size={18} className="text-slate-400" />
            </div>

            {/* Resource Bars */}
            <div className="w-full h-52 flex items-end justify-around px-8 pt-4 pb-2 bg-gradient-to-b from-slate-50/40 to-white rounded-2xl border border-slate-100/80">
              {replicas.map((rep) => (
                <div key={rep.name} className="flex flex-col items-center gap-2">
                  <div className="flex items-end gap-2 h-32">
                    {/* CPU Bar */}
                    {rep.cpu_pct != null ? (
                      <div
                        className="w-8 rounded-t-lg flex items-center justify-center text-white/95 font-mono text-[10px] font-semibold transition-all"
                        style={{
                          height: `${Math.max(12, Math.min(100, rep.cpu_pct))}%`,
                          backgroundColor: rep.color
                        }}
                        title={`CPU: ${rep.cpu_pct}% (${rep.cpu_raw})`}
                      >
                        {rep.cpu_pct > 5 ? `${rep.cpu_pct.toFixed(0)}%` : rep.cpu_raw}
                      </div>
                    ) : (
                      <div className="w-7 bg-slate-200 rounded-t h-4 flex items-center justify-center text-[9px] font-mono text-slate-500">
                        N/A
                      </div>
                    )}
                    {/* Memory Bar */}
                    {rep.mem_pct != null ? (
                      <div
                        className="w-8 bg-slate-300/75 rounded-t-lg flex items-center justify-center text-slate-700 font-mono text-[10px] font-semibold transition-all"
                        style={{
                          height: `${Math.max(12, Math.min(100, rep.mem_pct))}%`
                        }}
                        title={`Memory: ${rep.mem_pct}% (${rep.mem_raw})`}
                      >
                        {rep.mem_pct.toFixed(0)}%
                      </div>
                    ) : (
                      <div className="w-7 bg-slate-200 rounded-t h-4 flex items-center justify-center text-[9px] font-mono text-slate-500">
                        N/A
                      </div>
                    )}
                  </div>
                  <span className="font-mono text-xs font-semibold text-slate-800">
                    {rep.name}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-center gap-6 pt-2 font-mono text-xs text-slate-500 dark:text-neutral-400">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-indigo-600" />
                <span>CPU Compute Load</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-slate-300 dark:bg-neutral-700" />
                <span>Memory Allocated (RSS)</span>
              </div>
            </div>
          </div>

          {/* CHART D: Throughput & Error Dual-Axis - DYNAMICALLY PLOTTED */}
          <div className="min-w-0 rounded-2xl border border-slate-200/70 dark:border-neutral-800 bg-white dark:bg-[#151515] p-5 shadow-[0_10px_28px_rgba(15,23,42,0.04)] sm:p-6 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-neutral-100 text-sm">Throughput vs Transient Errors</h3>
                <span className="text-xs text-slate-500 dark:text-neutral-400">System stability and error occurrence verification</span>
              </div>
              <span className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-mono text-xs font-bold border border-emerald-200 dark:border-emerald-800">
                SLO: 99.9% TARGET
              </span>
            </div>

            <div className="w-full h-52 pt-2">
              <svg className="w-full h-full" fill="none" viewBox="0 0 500 180">
                <line stroke="#E9EEF5" strokeDasharray="2 2" x1="40" x2="460" y1="30" y2="30" />
                <line stroke="#E9EEF5" strokeDasharray="2 2" x1="40" x2="460" y1="80" y2="80" />
                <line stroke="#E9EEF5" strokeDasharray="2 2" x1="40" x2="460" y1="130" y2="130" />
                <text fill="#737686" fontFamily="JetBrains Mono" fontSize="10" textAnchor="end" x="35" y="34">20 rps</text>
                <text fill="#737686" fontFamily="JetBrains Mono" fontSize="10" textAnchor="end" x="35" y="84">10 rps</text>
                <text fill="#737686" fontFamily="JetBrains Mono" fontSize="10" textAnchor="end" x="35" y="134">0 rps</text>
                <text fill="#EF4444" fontFamily="JetBrains Mono" fontSize="10" x="465" y="34">1.0%</text>
                <text fill="#EF4444" fontFamily="JetBrains Mono" fontSize="10" x="465" y="84">0.5%</text>
                <text fill="#EF4444" fontFamily="JetBrains Mono" fontSize="10" x="465" y="134">0.0%</text>

                {/* Real Dynamic Throughput Line */}
                <path
                  d={generateChartPath(historyThroughput, 500, 180, 40, 40, 30, 40, 20)}
                  fill="none"
                  stroke="#4f46e5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                />

                {/* Real Error occurrences only if error count > 0 */}
                {summary.total_errors > 0 ? (
                  <rect fill="#EF4444" height="20" rx="1" width="8" x="280" y="140" />
                ) : (
                  <circle cx="280" cy="155" r="2" fill="#10B981" />
                )}
              </svg>
            </div>

            <div className="flex items-center justify-center gap-6 pt-2 font-mono text-xs text-slate-500 dark:text-neutral-400">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-indigo-600" />
                <span>Throughput (req/s)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded bg-red-500" />
                <span>Transient 5xx Errors ({summary.error_rate_pct}%)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Request execution timeline */}
        <GanttRequestTimeline
          events={allTimelineEvents}
          replicas={replicas}
          windowSize={ganttWindowSize}
          onWindowSizeChange={setGanttWindowSize}
          onClearEvents={() => setClearedEventIds(new Set(allTimelineEvents.map(e => e.request_id)))}
        />

        {/* Request activity log */}
        <div className="w-full p-5 sm:p-6 rounded-xl bg-white border border-slate-200 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">Real-Time Request Activity & Ingress Log</h3>
              <span className="text-xs text-slate-500">
                Instantaneous audit trail of requests observed and served across backend replicas via {isGatewayActive ? `Custom ${activeStrategyTitle} Gateway` : 'Native Kubernetes Service'}
              </span>
            </div>

            {/* Filter and Search */}
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg text-xs">
                <Search size={14} className="text-slate-400 mr-2" />
                <input
                  type="text"
                  placeholder="Filter request ID or pod..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  className="bg-transparent border-0 text-slate-800 placeholder-slate-400 focus:outline-none text-xs w-48"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 text-slate-700 font-mono text-xs px-2.5 py-1.5 rounded-lg focus:outline-none cursor-pointer"
              >
                <option value="ALL">Status: All</option>
                <option value="200">Status: 200 OK</option>
                <option value="ERR">Status: Non-200</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-xs font-semibold text-slate-500 bg-slate-50 border-b border-slate-200">
                  <th className="py-2 px-3">Timestamp</th>
                  <th className="py-2 px-3">Request ID</th>
                  <th className="py-2 px-3">Served by pod</th>
                  <th className="py-2 px-3">Pod IP / hostname</th>
                  <th className="py-2 px-3">Traffic source</th>
                  <th className="py-2 px-3">Routing mechanism</th>
                  <th className="py-2 px-3">Observed latency</th>
                  <th className="py-2 px-3 text-right">HTTP status</th>
                </tr>
              </thead>
              <tbody className="font-mono divide-y divide-slate-100">
                {filteredEvents.length > 0 ? (
                  filteredEvents.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-neutral-800/50 transition-colors">
                      <td className="py-2 px-3 text-slate-500 dark:text-neutral-400">{row.timestamp}</td>
                      <td className="py-2 px-3 font-semibold text-indigo-600 dark:text-indigo-400">{row.request_id}</td>
                      <td className="py-2 px-3">
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-neutral-800 text-slate-800 dark:text-neutral-200 font-bold">
                          {row.assigned_pod}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-slate-500 dark:text-neutral-400 text-[11px]">
                        {row.replica_id}
                      </td>
                      <td className="py-2 px-3 text-slate-600 dark:text-neutral-300 font-sans text-xs">
                        {row.traffic_type === 'locust_dashboard'
                          ? 'Dashboard Locust'
                          : row.traffic_type === 'test'
                            ? 'Manual test'
                            : row.traffic_type || 'Pod telemetry'}
                      </td>
                      <td className="py-2 px-3 text-slate-600 dark:text-neutral-300 font-sans text-xs">
                        {row.routing_mechanism || 'Native K8s Service (L4 iptables)'}
                      </td>
                      <td className="py-2 px-3 text-slate-900 dark:text-neutral-100 font-semibold">
                        {row.observed_latency_ms} ms
                      </td>
                      <td className="py-2 px-3 text-right">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          row.http_status.includes('200')
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                            : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                        }`}>
                          {row.http_status}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400 dark:text-neutral-500 font-sans">
                      {searchFilter || statusFilter !== 'ALL'
                        ? 'No events match your filter criteria.'
                        : 'No requests observed in current window. Click "Send Test Traffic" above to generate live inference activity.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Footer of log table */}
          <div className="flex flex-wrap items-center justify-between pt-3 mt-3 border-t border-slate-100 dark:border-neutral-800 text-xs text-slate-500 dark:text-neutral-400">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                {hasActiveTraffic && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-500 opacity-75" />
                )}
                <span className={`relative inline-flex rounded-full h-2 w-2 ${hasActiveTraffic ? 'bg-indigo-600' : 'bg-slate-400 dark:bg-neutral-600'}`} />
              </span>
              <span className="font-mono">
                Showing {filteredEvents.length} events • Rate: {summary.throughput_rps} events/sec
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-neutral-400 font-mono">
              <span className="hidden sm:inline">Forwarding:</span>
              <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-neutral-800 text-slate-700 dark:text-neutral-300">
                prometheus:9090
              </span>
              <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-neutral-800 text-slate-700 dark:text-neutral-300">
                grafana:3000
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ==================== INSPECT REPLICA MODAL ==================== */}
      {selectedReplicaModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-[#151515] rounded-xl shadow-xl max-w-lg w-full border border-slate-200 dark:border-neutral-800 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-neutral-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Server size={18} className="text-indigo-600 dark:text-indigo-400" />
                <h3 className="font-bold text-sm text-slate-900 dark:text-neutral-100">
                  Pod Diagnostics: {selectedReplicaModal.name}
                </h3>
              </div>
              <button
                onClick={() => setSelectedReplicaModal(null)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-neutral-200 font-bold"
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-3 font-mono text-xs">
              <div className="flex justify-between p-2 rounded bg-slate-50 dark:bg-neutral-900 border border-slate-100 dark:border-neutral-800">
                <span className="text-slate-500 dark:text-neutral-400">Replica Hostname</span>
                <span className="font-bold text-slate-900 dark:text-neutral-100">{selectedReplicaModal.replica_id}</span>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-50 dark:bg-neutral-900 border border-slate-100 dark:border-neutral-800">
                <span className="text-slate-500 dark:text-neutral-400">Pod IP Address</span>
                <span className="font-bold text-slate-900 dark:text-neutral-100">{selectedReplicaModal.pod_ip}:8000</span>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-50 dark:bg-neutral-900 border border-slate-100 dark:border-neutral-800">
                <span className="text-slate-500 dark:text-neutral-400">Health Readiness Probe</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-bold">HTTP 200 OK (/ready)</span>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-50 dark:bg-neutral-900 border border-slate-100 dark:border-neutral-800">
                <span className="text-slate-500 dark:text-neutral-400">Requests Served</span>
                <span className="font-bold text-slate-900 dark:text-neutral-100">{selectedReplicaModal.requests_served} total</span>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-50 dark:bg-neutral-900 border border-slate-100 dark:border-neutral-800">
                <span className="text-slate-500 dark:text-neutral-400">CPU Core Usage (K8s Metrics Server)</span>
                <span className="font-bold text-slate-900 dark:text-neutral-100">
                  {selectedReplicaModal.cpu_pct != null ? `${selectedReplicaModal.cpu_raw} (${selectedReplicaModal.cpu_pct.toFixed(1)}%)` : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-50 dark:bg-neutral-900 border border-slate-100 dark:border-neutral-800">
                <span className="text-slate-500 dark:text-neutral-400">Memory RSS Usage (K8s Metrics Server)</span>
                <span className="font-bold text-slate-900 dark:text-neutral-100">
                  {selectedReplicaModal.mem_pct != null ? `${selectedReplicaModal.mem_raw} (${selectedReplicaModal.mem_pct.toFixed(1)}%)` : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-50 dark:bg-neutral-900 border border-slate-100 dark:border-neutral-800">
                <span className="text-slate-500 dark:text-neutral-400">Gateway Adaptive Score (latest decision)</span>
                <span className="font-bold text-violet-700 dark:text-violet-400">
                  {selectedReplicaModal.gateway_score != null ? selectedReplicaModal.gateway_score.toFixed(3) : 'No Adaptive decision yet'}
                  {selectedReplicaModal.gateway_selected ? ' · LAST SELECTED' : ''}
                </span>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-50 dark:bg-neutral-900 border border-slate-100 dark:border-neutral-800">
                <span className="text-slate-500 dark:text-neutral-400">Benchmark Score (Preview)</span>
                <span className="font-bold text-indigo-600 dark:text-indigo-400">{selectedReplicaModal.score.toFixed(3)}</span>
              </div>
            </div>
            <div className="px-5 py-3 bg-slate-50 dark:bg-neutral-900 border-t border-slate-200 dark:border-neutral-800 flex justify-end">
              <button
                onClick={() => setSelectedReplicaModal(null)}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InferenceMonitoringPage;
