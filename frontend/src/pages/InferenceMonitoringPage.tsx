import React, { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import {
  Activity,
  Play,
  RotateCw,
  Download,
  CheckCircle2,
  AlertTriangle,
  Server,
  Cpu,
  Clock,
  Layers,
  Search,
  ShieldCheck,
  Pause,
  Sliders,
  Terminal,
  Zap,
} from 'lucide-react';
import { inferenceApi } from '../api/inferenceApi';
import type { TelemetrySnapshot, ReplicaTelemetry, RecentEvent } from '../api/inferenceApi';

// Helper: Generate SVG sparkline path from numeric array
function generateSparkline(data: number[], width = 100, height = 24, pad = 2): string {
  if (!data || data.length === 0) {
    return `M 0,${height - pad} L ${width},${height - pad}`;
  }
  const max = Math.max(0.1, ...data);
  const min = 0;
  const step = width / Math.max(1, data.length - 1);
  return data
    .map((v, i) => {
      const x = (i * step).toFixed(1);
      const y = (height - pad - (Math.max(0, v - min) / (max - min)) * (height - 2 * pad)).toFixed(1);
      return `${i === 0 ? 'M' : 'L'} ${x},${y}`;
    })
    .join(' ');
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

  return values
    .map((v, i) => {
      const x = paddingLeft + i * step;
      const normalizedY = Math.min(1.0, Math.max(0, v / maxY));
      const y = height - paddingBottom - normalizedY * chartH;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export const InferenceMonitoringPage: React.FC = () => {
  // Telemetry state
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot | null>(null);
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
  const [testResults, setTestResults] = useState<any[]>([]);

  // Log filter & search
  const [searchFilter, setSearchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Modal inspection
  const [selectedReplicaModal, setSelectedReplicaModal] = useState<ReplicaTelemetry | null>(null);

  // Time window for charts (5m, 15m, 1h)
  const [chartTimeWindow, setChartTimeWindow] = useState<'5m' | '15m' | '1h'>('5m');

  // Normalized weights sum
  const weightSum = (weightLat + weightReq + weightCpu + weightErr).toFixed(2);
  const isNormalized = Math.abs(parseFloat(weightSum) - 1.0) < 0.02;

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

  // Handle trigger real test traffic
  const handleSendTestTraffic = async () => {
    setIsSendingTest(true);
    try {
      toast.loading(`Injecting ${testCount} requests through K8s Service...`, { id: 'test-traffic' });
      const res = await inferenceApi.sendTestTraffic(testCount);
      setTestResults(res.requests || []);
      toast.success(`Successfully dispatched ${res.count} requests across replicas!`, { id: 'test-traffic' });
      // Refresh telemetry immediately
      await loadTelemetry(false);
    } catch (err: any) {
      toast.error(`Traffic injection failed: ${err?.message || 'Error'}`, { id: 'test-traffic' });
    } finally {
      setIsSendingTest(false);
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
    model_name: 'titanic-classifier:b0ca6d39',
    namespace: 'mlops',
    cluster_name: 'Minikube Local Cluster (v1.37)',
    last_sync_utc: lastUpdated
  };

  const replicas: ReplicaTelemetry[] = telemetry?.replicas || [];
  const recentEvents: RecentEvent[] = telemetry?.recent_events || [];

  // Filtered recent events
  const filteredEvents = recentEvents.filter(ev => {
    const matchesSearch = !searchFilter ||
      ev.request_id.toLowerCase().includes(searchFilter.toLowerCase()) ||
      ev.assigned_pod.toLowerCase().includes(searchFilter.toLowerCase()) ||
      ev.replica_id.toLowerCase().includes(searchFilter.toLowerCase());

    const matchesStatus = statusFilter === 'ALL' ||
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
    <div className="w-full min-h-screen bg-[#F8FAFC] text-[#0B1C30] font-['Geist',system-ui,sans-serif] -m-8 md:-m-12 pb-24">
      {/* ==================== SUB-HEADER / ENVIRONMENT BAR ==================== */}
      <div className="h-12 bg-white border-b border-slate-200/80 px-6 sm:px-8 flex items-center justify-between shadow-xs sticky top-0 z-20">
        {/* Breadcrumbs */}
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="hover:text-slate-900 cursor-pointer">Nexus MLOps</span>
          <span className="text-slate-300">/</span>
          <span className="hover:text-slate-900 cursor-pointer">Inference</span>
          <span className="text-slate-300">/</span>
          <span className="text-slate-900 font-semibold">Adaptive Load Balancing</span>
        </div>

        {/* Cluster Context & Controls */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 text-xs font-mono border border-slate-200">
            <Server size={13} className="text-blue-600" />
            <span>Minikube Cluster (local)</span>
            <span className="text-slate-300">|</span>
            <span className="text-slate-500">ns/mlops</span>
          </div>

          <div className="px-2 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-700 text-[10px] font-mono font-bold tracking-wider uppercase">
            REAL TELEMETRY • K8S BASELINE
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="font-mono text-[11px] hidden md:inline">
              Sync: {summary.last_sync_utc}
            </span>

            {syncStatus === 'stale' && (
              <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-mono font-semibold">
                Stale
              </span>
            )}

            <button
              onClick={() => loadTelemetry(true)}
              disabled={refreshing}
              className={`p-1.5 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors ${
                refreshing ? 'animate-spin text-blue-600' : ''
              }`}
              title="Manual Sync"
              type="button"
            >
              <RotateCw size={15} />
            </button>

            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              className="px-2 py-1 rounded text-[11px] font-mono font-medium bg-slate-100 text-slate-700 border border-slate-200 cursor-pointer focus:outline-none"
              title="Auto-refresh interval"
            >
              <option value={2000}>Auto 2s</option>
              <option value={5000}>Auto 5s</option>
              <option value={10000}>Auto 10s</option>
              <option value={0}>Paused</option>
            </select>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 sm:px-8 py-6 space-y-6">
        {/* ==================== ACTION BAR & TITLE ==================== */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                Adaptive Load Balancing
              </h1>
              <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-mono text-xs font-semibold uppercase tracking-wider">
                K8S-BASELINE-v1.0
              </span>
            </div>
            <p className="text-sm text-slate-600 max-w-3xl">
              Monitor real-time client inference traffic, inspect Kubernetes serving pod telemetry, and dynamically benchmark composite penalty scores across heterogenous backends.
            </p>
          </div>

          {/* Action Group */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center bg-white border border-slate-200 rounded-lg p-0.5 shadow-xs">
              <button
                onClick={handleSendTestTraffic}
                disabled={isSendingTest}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors shadow-xs"
              >
                {isSendingTest ? (
                  <RotateCw size={14} className="animate-spin" />
                ) : (
                  <Play size={14} fill="currentColor" />
                )}
                <span>Send Test Traffic</span>
              </button>
              <select
                value={testCount}
                onChange={(e) => setTestCount(Number(e.target.value))}
                className="text-xs font-mono bg-transparent border-0 px-2 py-1 text-slate-700 focus:ring-0 cursor-pointer"
                title="Number of requests"
              >
                <option value={1}>1 req</option>
                <option value={5}>5 reqs</option>
                <option value={10}>10 reqs</option>
                <option value={20}>20 reqs</option>
              </select>
            </div>

            <button
              onClick={() => {
                document.getElementById('objective-tuning-panel')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-medium shadow-xs transition-colors"
            >
              <Sliders size={14} className="text-slate-400" />
              <span>Configure Weights</span>
            </button>

            <button
              onClick={handleExportJson}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-medium shadow-xs transition-colors"
              title="Export Telemetry JSON"
            >
              <Download size={14} className="text-slate-400" />
              <span>Export</span>
            </button>
          </div>
        </div>

        {/* ==================== SLIM INFRASTRUCTURE STATUS RIBBON ==================== */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-lg bg-white border border-slate-200 shadow-xs text-xs">
          <div className="flex flex-wrap items-center gap-6 text-slate-600">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                {hasActiveTraffic && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                )}
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="font-semibold text-slate-900">Gateway:</span>
              <span className="text-emerald-600 font-semibold">Healthy</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-900">Replicas:</span>
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                {summary.healthy_replicas} / {summary.total_replicas || 3} Online
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-900">Model:</span>
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                {summary.model_name}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-900">Namespace:</span>
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                {summary.namespace}
              </span>
            </div>

            <div className="hidden xl:flex items-center gap-1.5">
              <span className="font-semibold text-slate-900">Active Policy:</span>
              <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-mono text-[11px] font-semibold border border-blue-200">
                {summary.active_policy}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded bg-slate-100 text-slate-700 font-mono text-[11px] font-medium flex items-center gap-1.5 border border-slate-200">
              <ShieldCheck size={13} className="text-blue-600" />
              Routing: Native K8s IPTables / IPVS
            </span>
          </div>
        </div>

        {/* ==================== SECTION 1: 5 KPI SUMMARY CARDS ==================== */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* KPI 1: Throughput */}
          <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-[11px] font-bold uppercase tracking-wider">THROUGHPUT</span>
              <Zap size={16} className="text-slate-400" />
            </div>
            <div className="my-2">
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold tracking-tight text-slate-900 font-mono">
                  {summary.throughput_rps.toFixed(1)}
                </span>
                <span className="text-xs text-slate-500 font-mono">req/s</span>
              </div>
              <div className="flex items-center gap-1 mt-1 text-xs font-medium">
                {hasActiveTraffic ? (
                  <span className="text-emerald-600">↑ Active stream</span>
                ) : (
                  <span className="text-slate-400">● Idle (0.0 req/s)</span>
                )}
                <span className="text-slate-400">· {summary.total_requests} total</span>
              </div>
            </div>
            {/* Real Dynamic Sparkline */}
            <div className="w-full h-7 pt-1">
              <svg className="w-full h-full text-emerald-500" fill="none" preserveAspectRatio="none" viewBox="0 0 100 24">
                <path
                  d={generateSparkline(historyThroughput, 100, 24)}
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="2"
                />
                <path
                  d={generateSparklineArea(historyThroughput, 100, 24)}
                  fill="currentColor"
                  fillOpacity="0.1"
                />
              </svg>
            </div>
          </div>

          {/* KPI 2: P95 Latency */}
          <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-[11px] font-bold uppercase tracking-wider">P95 LATENCY</span>
              <Clock size={16} className="text-slate-400" />
            </div>
            <div className="my-2">
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold tracking-tight text-slate-900 font-mono">
                  {summary.p95_latency_ms != null ? summary.p95_latency_ms.toFixed(1) : 'N/A'}
                </span>
                <span className="text-xs text-slate-500 font-mono">ms</span>
              </div>
              <div className="flex items-center gap-1 mt-1 text-xs text-blue-600 font-medium">
                {summary.p50_latency_ms != null ? (
                  <span>P50: {summary.p50_latency_ms.toFixed(1)}ms</span>
                ) : (
                  <span className="text-slate-400">
                    {summary.total_requests < 5 ? `Samples: n=${summary.total_requests} (need ≥5 for P95)` : 'Awaiting data'}
                  </span>
                )}
                <span className="text-slate-400">· Target &lt; 100ms</span>
              </div>
            </div>
            {/* Real Dynamic Latency Sparkline */}
            <div className="w-full h-7 pt-1">
              <svg className="w-full h-full text-blue-600" fill="none" preserveAspectRatio="none" viewBox="0 0 100 24">
                <path
                  d={generateSparkline(historyLatencyP95, 100, 24)}
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="2"
                />
                <path
                  d={generateSparklineArea(historyLatencyP95, 100, 24)}
                  fill="currentColor"
                  fillOpacity="0.1"
                />
              </svg>
            </div>
          </div>

          {/* KPI 3: Error Rate */}
          <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-[11px] font-bold uppercase tracking-wider">ERROR RATE</span>
              <AlertTriangle size={16} className="text-slate-400" />
            </div>
            <div className="my-2">
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold tracking-tight text-slate-900 font-mono">
                  {summary.error_rate_pct.toFixed(2)}%
                </span>
              </div>
              <div className="flex items-center gap-1.5 mt-1 text-xs">
                <span className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${
                  summary.total_errors === 0
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-red-50 text-red-700'
                }`}>
                  {summary.total_errors === 0 ? 'HEALTHY' : 'WARNING'}
                </span>
                <span className="text-slate-500 font-mono text-[11px]">
                  {summary.total_errors} err / {summary.total_requests} req
                </span>
              </div>
            </div>
            {/* Real Error Sparkline */}
            <div className="w-full h-7 pt-1">
              <svg className="w-full h-full text-slate-400" fill="none" preserveAspectRatio="none" viewBox="0 0 100 24">
                <path
                  d={generateSparkline(historyErrors, 100, 24)}
                  fill="none"
                  stroke={summary.total_errors > 0 ? '#EF4444' : '#10B981'}
                  strokeLinecap="round"
                  strokeWidth="2"
                />
              </svg>
            </div>
          </div>

          {/* KPI 4: Active Replicas */}
          <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-[11px] font-bold uppercase tracking-wider">ACTIVE REPLICAS</span>
              <Server size={16} className="text-slate-400" />
            </div>
            <div className="my-2">
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold tracking-tight text-slate-900 font-mono">
                  {summary.healthy_replicas} / {summary.total_replicas || 3}
                </span>
              </div>
              <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-500">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span>All 3 Pods Ready & Scraped</span>
              </div>
            </div>
            {/* Proportional Load Bar */}
            <div className="w-full pt-1">
              <div className="w-full bg-slate-100 h-2 rounded-full flex overflow-hidden">
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
              <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono mt-1">
                {replicas.map((rep) => (
                  <span key={rep.name} style={{ color: rep.color }} className="font-semibold">
                    {rep.name.replace('inference-', 'i')}: {rep.traffic_share_pct}%
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* KPI 5: Gateway Dispatch Overhead - HONEST L4 KERNEL REPRESENTATION */}
          <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-[11px] font-bold uppercase tracking-wider">GATEWAY DISPATCH</span>
              <Cpu size={16} className="text-slate-400" />
            </div>
            <div className="my-2">
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold tracking-tight text-slate-900 font-mono">
                  {summary.gateway_decision_ms != null ? `${summary.gateway_decision_ms} ms` : 'N/A'}
                </span>
                <span className="text-xs text-slate-500 font-mono">L4 iptables</span>
              </div>
              <div className="flex items-center gap-1 mt-1 text-xs text-slate-500">
                <span className="text-emerald-600 font-semibold">Zero-Hop Gateway</span>
                <span>·</span>
                <span className="font-mono text-[10px]">&lt;0.1ms overhead</span>
              </div>
            </div>
            {/* Honest Kernel Routing Status Badge */}
            <div className="w-full h-7 pt-1 flex items-center">
              <div className="w-full py-1 px-2 rounded bg-slate-100 border border-slate-200 text-center text-[9px] font-mono text-slate-600 font-semibold truncate">
                KERNEL L4 NETWORKING • WIRE-SPEED
              </div>
            </div>
          </div>
        </div>

        {/* ==================== SECTION 2: LIVE INFERENCE ROUTING TOPOLOGY ==================== */}
        <div className="w-full p-5 sm:p-6 rounded-xl bg-white border border-slate-200 shadow-xs">
          {/* Topology Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 mb-5 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
                  <Layers size={18} />
                </div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900">
                  Live Inference Routing Topology
                </h2>
              </div>
              <div className="flex items-center p-0.5 rounded-lg bg-slate-100 text-xs">
                <button className="px-2.5 py-1 rounded bg-white shadow-xs text-slate-900 font-semibold">
                  Live Node Topology
                </button>
                <button
                  onClick={() => toast('Graph Matrix view available in cluster monitoring expansion.')}
                  className="px-2.5 py-1 rounded text-slate-500 hover:text-slate-900"
                >
                  Graph Matrix
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="font-mono text-slate-500">Scope:</span>
              <span className="px-2.5 py-1 rounded bg-slate-100 font-mono font-medium text-slate-800 border border-slate-200">
                All Pods ({summary.healthy_replicas} Active)
              </span>
              <button
                onClick={() => setRefreshInterval(refreshInterval === 0 ? 5000 : 0)}
                className="p-1 rounded text-slate-500 hover:bg-slate-100 transition-colors"
                title={refreshInterval > 0 ? 'Pause Live Stream' : 'Resume Live Stream'}
              >
                {refreshInterval > 0 ? <Pause size={16} /> : <Play size={16} />}
              </button>
            </div>
          </div>

          {/* Interactive Topology Graphic */}
          <div className="relative w-full rounded-xl bg-slate-50/70 p-5 sm:p-6 overflow-x-auto border border-slate-200/80">
            <div className="min-w-[940px] grid grid-cols-12 gap-5 items-center">
              {/* STEP 1: Incoming Traffic Column (3 Cols) */}
              <div className="col-span-3 flex flex-col gap-3">
                <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs relative">
                  <div className="absolute -top-2.5 left-3 px-2 py-0.5 rounded bg-slate-900 text-white font-mono text-[10px] font-semibold uppercase">
                    INGRESS PIPELINE
                  </div>
                  <div className="flex items-center justify-between mb-2 pt-1">
                    <span className="font-bold text-slate-900 text-sm">Client Traffic</span>
                    <span className={`px-2 py-0.5 rounded font-mono text-xs font-bold border ${
                      hasActiveTraffic
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-slate-100 text-slate-600 border-slate-200'
                    }`}>
                      {summary.throughput_rps.toFixed(1)} rps
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mb-3">
                    Concurrent model requests dispatched via cluster ingress mesh.
                  </p>
                  <div className="space-y-1.5 font-mono text-xs">
                    <div className="flex justify-between items-center p-2 rounded bg-slate-50 border border-slate-100">
                      <span className="text-slate-500">Protocols</span>
                      <span className="font-semibold text-slate-900">HTTP/1.1 & HTTP/2</span>
                    </div>
                    <div className="flex justify-between items-center p-2 rounded bg-slate-50 border border-slate-100">
                      <span className="text-slate-500">Payload Format</span>
                      <span className="font-semibold text-slate-900">JSON Features (Titanic)</span>
                    </div>
                    <div className="flex justify-between items-center p-2 rounded bg-slate-50 border border-slate-100">
                      <span className="text-slate-500">Target Service</span>
                      <span className="font-semibold text-slate-900">inference-service:8000</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* DIRECTIONAL ARROW 1 (1 Col) - ONLY ANIMATES ON ACTIVE TRAFFIC */}
              <div className="col-span-1 flex flex-col items-center justify-center">
                <div className="flex flex-col items-center gap-1 text-center">
                  <span className={`font-mono text-[11px] font-semibold ${
                    hasActiveTraffic ? 'text-blue-600 animate-pulse' : 'text-slate-400'
                  }`}>
                    {hasActiveTraffic ? `${summary.throughput_rps} rps` : 'idle'}
                  </span>
                  <div className={`w-full flex items-center justify-center ${hasActiveTraffic ? 'text-blue-600' : 'text-slate-400'}`}>
                    <svg fill="none" height="24" viewBox="0 0 48 24" width="48">
                      <path
                        d="M0,12 L38,12 M32,6 L40,12 L32,18"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2.5"
                      />
                      {/* Animated packet dot only during live traffic */}
                      {hasActiveTraffic ? (
                        <circle cx="20" cy="12" r="3" fill="#2563EB" className="animate-ping" />
                      ) : (
                        <circle cx="20" cy="12" r="2.5" fill="#94A3B8" />
                      )}
                    </svg>
                  </div>
                  <span className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">
                    ClusterIP
                  </span>
                </div>
              </div>

              {/* STEP 2: Central Gateway Node (4 Cols) */}
              <div className="col-span-4 flex flex-col">
                <div className="p-4 rounded-xl bg-white border border-blue-200/80 shadow-md ring-2 ring-blue-500/10 relative">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${hasActiveTraffic ? 'bg-blue-600 animate-ping' : 'bg-slate-400'}`} />
                      <span className="font-bold text-slate-900 text-sm">Native K8s Service Router</span>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-blue-600 text-white font-mono text-[10px] font-semibold">
                      L4 IPTABLES
                    </span>
                  </div>

                  {/* Mathematical Formula Representation */}
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 mb-3">
                    <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block mb-1">
                      OBJECTIVE PENALTY SCORE (BENCHMARK PREVIEW SIMULATION)
                    </span>
                    <code className="font-mono text-[11px] text-slate-800 block leading-tight font-medium bg-white p-2 rounded border border-slate-200">
                      S<sub>i</sub> = {weightLat.toFixed(2)}·L<sub>norm</sub> + {weightReq.toFixed(2)}·R<sub>norm</sub> + {weightCpu.toFixed(2)}·C<sub>norm</sub> + {weightErr.toFixed(2)}·E<sub>norm</sub>
                    </code>
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      *Preview calculation only; actual traffic routed via native K8s L4 iptables.
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                    <div className="p-2 rounded bg-slate-50 border border-slate-100">
                      <span className="text-slate-500 block text-[11px]">Routing Mechanism</span>
                      <span className="text-xs font-bold text-slate-900">K8s L4 iptables</span>
                    </div>
                    <div className="p-2 rounded bg-slate-50 border border-slate-100">
                      <span className="text-slate-500 block text-[11px]">Total Routed</span>
                      <span className="text-sm font-bold text-slate-900">{summary.total_requests.toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Live Dispatch Breakdown */}
                  <div className="mt-3 pt-2 border-t border-slate-100 flex flex-col gap-1.5 font-mono text-xs">
                    {replicas.map((rep) => (
                      <div
                        key={rep.name}
                        className="flex items-center justify-between px-2.5 py-1 rounded bg-slate-50 text-slate-700"
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: rep.color }} />
                          <span>To {rep.name}</span>
                          {rep.is_optimal && (
                            <span className="text-[9px] bg-slate-200 text-slate-700 px-1.5 py-0.2 rounded font-semibold uppercase">
                              PREVIEW: LOWEST PENALTY
                            </span>
                          )}
                        </span>
                        <span style={{ color: rep.color }} className="font-bold">
                          {rep.traffic_share_pct}% ({rep.requests_served} reqs)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* STEP 3: Distributed Replicas (4 Cols) */}
              <div className="col-span-4 flex flex-col gap-2.5">
                {replicas.map((rep) => (
                  <div
                    key={rep.name}
                    className="p-3 rounded-xl bg-white border border-slate-200 shadow-xs hover:border-slate-300 transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: rep.is_ready ? '#10B981' : '#EF4444' }}
                        />
                        <span className="font-bold text-slate-900 text-xs font-mono">{rep.name}</span>
                        <span className="font-mono text-[11px] text-slate-400">{rep.pod_ip}</span>
                      </div>
                      <span className="font-mono text-xs px-2 py-0.5 rounded font-bold bg-slate-100 text-slate-700">
                        Score (Preview): {rep.score.toFixed(3)}
                      </span>
                    </div>

                    <div className="grid grid-cols-4 gap-1.5 mt-2 text-center font-mono text-xs">
                      <div className="bg-slate-50 p-1 rounded border border-slate-100">
                        <span className="text-slate-400 block text-[9px]">P95</span>
                        <span className="font-bold text-slate-800">
                          {rep.p95_latency_ms != null ? `${rep.p95_latency_ms}ms` : (rep.requests_served < 5 ? `n=${rep.requests_served}` : 'N/A')}
                        </span>
                      </div>
                      <div className="bg-slate-50 p-1 rounded border border-slate-100">
                        <span className="text-slate-400 block text-[9px]">Active</span>
                        <span className="font-bold text-slate-800">{rep.active_requests} req</span>
                      </div>
                      <div className="bg-slate-50 p-1 rounded border border-slate-100">
                        <span className="text-slate-400 block text-[9px]">CPU</span>
                        <span className="font-bold text-slate-800">
                          {rep.cpu_pct != null ? `${rep.cpu_pct.toFixed(0)}%` : 'N/A'}
                        </span>
                      </div>
                      <div className="bg-slate-50 p-1 rounded border border-slate-100">
                        <span className="text-slate-400 block text-[9px]">Share</span>
                        <span className="font-bold" style={{ color: rep.color }}>
                          {rep.traffic_share_pct}%
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Live Decision Rationale Callout */}
          <div className="mt-4 p-3 rounded-lg bg-slate-50 border border-slate-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="p-1 rounded bg-blue-600 text-white">
                <Terminal size={14} />
              </span>
              <div className="flex flex-wrap items-center gap-1.5 text-slate-700">
                <span className="font-bold text-slate-900">Latest Dispatched Event:</span>
                {recentEvents.length > 0 ? (
                  <>
                    <span>Request</span>
                    <span className="font-mono font-semibold bg-white px-1.5 py-0.5 rounded border border-slate-200 text-blue-600">
                      {recentEvents[0].request_id}
                    </span>
                    <span>routed to</span>
                    <span className="font-bold text-emerald-700">
                      {recentEvents[0].assigned_pod}
                    </span>
                    <span className="text-slate-500">
                      (Observed latency {recentEvents[0].observed_latency_ms} ms with status {recentEvents[0].http_status}).
                    </span>
                  </>
                ) : (
                  <span className="text-slate-500">
                    Ready for traffic. Click "Send Test Traffic" above to generate live inference dispatches.
                  </span>
                )}
              </div>
            </div>
            <span className="font-mono text-slate-400 text-[11px]">
              Sync: {summary.last_sync_utc}
            </span>
          </div>
        </div>

        {/* ==================== SECTION 3: ROUTING STRATEGIES & OBJECTIVE WEIGHT TUNING ==================== */}
        <div id="objective-tuning-panel" className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          {/* Strategy Selection (5 Cols) */}
          <div className="xl:col-span-5 p-5 rounded-xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-base font-bold text-slate-900">Routing Strategies</h3>
                <span className="text-[10px] font-mono uppercase bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-semibold">
                  K8S INGRESS
                </span>
              </div>
              <p className="text-xs text-slate-500 mb-4">
                Comparison of load distribution strategies across identical backend replicas.
              </p>

              {/* Strategy Options Radio Grid */}
              <div className="space-y-2.5">
                {/* 1. Native Kubernetes Service - ACTIVE BASELINE */}
                <label className="flex items-start gap-3 p-3 rounded-lg bg-blue-50/60 border-2 border-blue-600 cursor-default">
                  <input
                    type="radio"
                    name="strategy"
                    checked
                    readOnly
                    className="mt-0.5 text-blue-600 focus:ring-0"
                  />
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-blue-900">Native Kubernetes Service</span>
                      <span className="px-1.5 py-0.2 rounded bg-blue-600 text-white font-mono text-[9px] font-bold">
                        ACTIVE BASELINE
                      </span>
                    </div>
                    <span className="text-[11px] text-blue-700 mt-0.5">
                      L4 iptables/IPVS connection tracking without worker application queue awareness.
                    </span>
                  </div>
                </label>

                {/* 2. Round Robin - PLANNED */}
                <label className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200 opacity-60 cursor-not-allowed">
                  <input
                    type="radio"
                    name="strategy"
                    disabled
                    className="mt-0.5 text-slate-400 focus:ring-0"
                  />
                  <div className="flex flex-col">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-slate-700">Round Robin</span>
                      <span className="px-1.5 py-0.2 rounded bg-slate-200 text-slate-600 font-mono text-[9px] font-semibold">
                        PLANNED
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500 mt-0.5">
                      Deterministic 1:1:1 dispatch ignoring pod hardware or pipeline queue depth.
                    </span>
                  </div>
                </label>

                {/* 3. Weighted Round Robin - PLANNED */}
                <label className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200 opacity-60 cursor-not-allowed">
                  <input
                    type="radio"
                    name="strategy"
                    disabled
                    className="mt-0.5 text-slate-400 focus:ring-0"
                  />
                  <div className="flex flex-col">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-slate-700">Weighted Round Robin</span>
                      <span className="px-1.5 py-0.2 rounded bg-slate-200 text-slate-600 font-mono text-[9px] font-semibold">
                        PLANNED
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500 mt-0.5">
                      Static predefined allocation ratios (e.g. 40 : 30 : 30 based on node specs).
                    </span>
                  </div>
                </label>

                {/* 4. Adaptive Multi-Signal - RESEARCH PREVIEW */}
                <label className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200 opacity-60 cursor-not-allowed">
                  <input
                    type="radio"
                    name="strategy"
                    disabled
                    className="mt-0.5 text-slate-400 focus:ring-0"
                  />
                  <div className="flex flex-col">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-slate-700">Adaptive Dynamic Routing</span>
                      <span className="px-1.5 py-0.2 rounded bg-slate-200 text-slate-600 font-mono text-[9px] font-semibold">
                        RESEARCH PREVIEW
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500 mt-0.5">
                      Prospective multi-signal cost optimization balancing latency, CPU load, and queue depth.
                    </span>
                  </div>
                </label>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100">
              <div className="p-2.5 rounded-lg bg-blue-50/60 border border-blue-200 text-[11px] text-blue-800 flex items-start gap-2">
                <ShieldCheck size={16} className="text-blue-600 shrink-0 mt-0.5" />
                <span>
                  <strong>Native Baseline Protected:</strong> Routing decisions are made solely by native Kubernetes ClusterIP iptables. Alternative strategies are displayed for evaluation comparison.
                </span>
              </div>
            </div>
          </div>

          {/* Weight Tuning & Safety Parameters (7 Cols) - LABELED AS SIMULATION PREVIEW */}
          <div className="xl:col-span-7 p-5 rounded-xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="text-base font-bold text-slate-900">Objective Weight Tuning (Simulation Preview)</h3>
                  <span className="text-xs text-slate-500">
                    Adjust prospective penalty coefficients for benchmark ranking without changing native K8s routing.
                  </span>
                </div>
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded font-mono text-xs font-bold ${
                  isNormalized
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                }`}>
                  <CheckCircle2 size={13} />
                  <span>Sum: {weightSum} ({isNormalized ? 'Normalized' : 'Unnormalized'})</span>
                </div>
              </div>

              {/* Sliders Matrix */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                {/* Weight 1: Latency */}
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <Clock size={14} className="text-blue-600" />
                      Latency (L<sub>norm</sub>)
                    </label>
                    <span className="font-mono text-xs font-bold text-blue-600 bg-white px-2 py-0.5 rounded border border-slate-200">
                      {weightLat.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={weightLat}
                    onChange={(e) => setWeightLat(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">Impact of recent P95 latency measurements.</p>
                </div>

                {/* Weight 2: Active Reqs */}
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <Activity size={14} className="text-blue-600" />
                      Active Requests (R<sub>norm</sub>)
                    </label>
                    <span className="font-mono text-xs font-bold text-blue-600 bg-white px-2 py-0.5 rounded border border-slate-200">
                      {weightReq.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={weightReq}
                    onChange={(e) => setWeightReq(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">Queue pressure and in-flight inference count.</p>
                </div>

                {/* Weight 3: CPU Load */}
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <Cpu size={14} className="text-blue-600" />
                      CPU Compute (C<sub>norm</sub>)
                    </label>
                    <span className="font-mono text-xs font-bold text-blue-600 bg-white px-2 py-0.5 rounded border border-slate-200">
                      {weightCpu.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={weightCpu}
                    onChange={(e) => setWeightCpu(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">Host CPU saturation from Metrics Server.</p>
                </div>

                {/* Weight 4: Error Rate */}
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <AlertTriangle size={14} className="text-blue-600" />
                      Error Rate (E<sub>norm</sub>)
                    </label>
                    <span className="font-mono text-xs font-bold text-blue-600 bg-white px-2 py-0.5 rounded border border-slate-200">
                      {weightErr.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={weightErr}
                    onChange={(e) => setWeightErr(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">Penalty multiplier for non-2xx responses.</p>
                </div>
              </div>
            </div>

            {/* Controls & Presets */}
            <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-500 font-mono text-[11px]">Presets:</span>
                <button
                  onClick={() => {
                    setWeightLat(0.40);
                    setWeightReq(0.30);
                    setWeightCpu(0.20);
                    setWeightErr(0.10);
                    toast('Reset to default weights (40 / 30 / 20 / 10)');
                  }}
                  className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition-colors"
                >
                  Standard
                </button>
                <button
                  onClick={() => {
                    setWeightLat(0.70);
                    setWeightReq(0.10);
                    setWeightCpu(0.10);
                    setWeightErr(0.10);
                    toast('Applied Latency Sensitive preset');
                  }}
                  className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition-colors"
                >
                  Latency Sensitive
                </button>
                <button
                  onClick={() => {
                    setWeightLat(0.20);
                    setWeightReq(0.50);
                    setWeightCpu(0.20);
                    setWeightErr(0.10);
                    toast('Applied Queue Heavy preset');
                  }}
                  className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition-colors"
                >
                  Queue Heavy
                </button>
              </div>

              <span className="text-slate-400 font-mono text-[10px]">
                Simulation preview only • Native K8s routing active
              </span>
            </div>
          </div>
        </div>

        {/* ==================== SECTION 4: REAL-TIME OBSERVABILITY GRID (2x2) ==================== */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* CHART A: Latency Over Time - REAL OBSERVATIONS */}
          <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
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
                      chartTimeWindow === w ? 'bg-white shadow-xs text-slate-900' : 'text-slate-500 hover:text-slate-800'
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
                <line stroke="#E2E8F0" strokeDasharray="3 3" x1="40" x2="480" y1="20" y2="20" />
                <line stroke="#E2E8F0" strokeDasharray="3 3" x1="40" x2="480" y1="60" y2="60" />
                <line stroke="#E2E8F0" strokeDasharray="3 3" x1="40" x2="480" y1="100" y2="100" />
                <line stroke="#E2E8F0" strokeDasharray="3 3" x1="40" x2="480" y1="140" y2="140" />

                {/* Y-Axis Labels */}
                <text fill="#737686" fontFamily="JetBrains Mono" fontSize="10" textAnchor="end" x="35" y="24">500ms</text>
                <text fill="#737686" fontFamily="JetBrains Mono" fontSize="10" textAnchor="end" x="35" y="64">350ms</text>
                <text fill="#737686" fontFamily="JetBrains Mono" fontSize="10" textAnchor="end" x="35" y="104">200ms</text>
                <text fill="#737686" fontFamily="JetBrains Mono" fontSize="10" textAnchor="end" x="35" y="144">50ms</text>

                {/* Real Dynamic P99 Line (Red, Dashed) */}
                <path
                  d={generateChartPath(historyLatencyP99, 500, 180, 40, 20, 20, 40, 500)}
                  fill="none"
                  stroke="#EF4444"
                  strokeDasharray="3 3"
                  strokeWidth="1.5"
                />

                {/* Real Dynamic P95 Line (Blue) */}
                <path
                  d={generateChartPath(historyLatencyP95, 500, 180, 40, 20, 20, 40, 500)}
                  fill="none"
                  stroke="#2563EB"
                  strokeWidth="2.5"
                />

                {/* Real Dynamic P50 Line (Green) */}
                <path
                  d={generateChartPath(historyLatencyP50, 500, 180, 40, 20, 20, 40, 500)}
                  fill="none"
                  stroke="#10B981"
                  strokeWidth="2"
                />
              </svg>

              {/* Tooltip Overlay displaying real measured values */}
              <div className="absolute top-4 right-10 p-2.5 rounded-lg bg-slate-900 text-white shadow-xl font-mono text-[11px]">
                <div className="text-emerald-400 font-semibold mb-1">
                  Active Latency Observation
                </div>
                <div className="flex justify-between gap-4 text-slate-300">
                  <span>P99:</span>
                  <span className="font-bold text-white">
                    {summary.p99_latency_ms != null ? `${summary.p99_latency_ms.toFixed(1)} ms` : 'N/A (n<10)'}
                  </span>
                </div>
                <div className="flex justify-between gap-4 text-blue-300">
                  <span>P95:</span>
                  <span className="font-bold text-white">
                    {summary.p95_latency_ms != null ? `${summary.p95_latency_ms.toFixed(1)} ms` : 'N/A (n<5)'}
                  </span>
                </div>
                <div className="flex justify-between gap-4 text-emerald-300">
                  <span>P50:</span>
                  <span className="font-bold text-white">
                    {summary.p50_latency_ms != null ? `${summary.p50_latency_ms.toFixed(1)} ms` : 'N/A'}
                  </span>
                </div>
              </div>
            </div>

            {/* Legend */}
            <div className="flex items-center justify-center gap-6 pt-2 font-mono text-xs text-slate-500">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-red-500" />
                <span>P99 (Max Jitter)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-1 bg-blue-600 rounded" />
                <span className="font-semibold text-slate-900">P95</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-emerald-500" />
                <span>P50 (Median)</span>
              </div>
            </div>
          </div>

          {/* CHART B: Request Distribution by Replica - OBSERVED DATA */}
          <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
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
          <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
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
            <div className="w-full h-52 flex items-end justify-around px-8 pt-4 pb-2 bg-slate-50/60 rounded-lg border border-slate-100">
              {replicas.map((rep) => (
                <div key={rep.name} className="flex flex-col items-center gap-2">
                  <div className="flex items-end gap-2 h-32">
                    {/* CPU Bar */}
                    {rep.cpu_pct != null ? (
                      <div
                        className="w-7 rounded-t flex items-center justify-center text-white font-mono text-[10px] font-bold shadow-xs transition-all"
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
                        className="w-7 bg-slate-300 rounded-t flex items-center justify-center text-slate-800 font-mono text-[10px] font-bold shadow-xs transition-all"
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

            <div className="flex items-center justify-center gap-6 pt-2 font-mono text-xs text-slate-500">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-blue-600" />
                <span>CPU Compute Load</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-slate-300" />
                <span>Memory Allocated (RSS)</span>
              </div>
            </div>
          </div>

          {/* CHART D: Throughput & Error Dual-Axis - DYNAMICALLY PLOTTED */}
          <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Throughput vs Transient Errors</h3>
                <span className="text-xs text-slate-500">System stability and error occurrence verification</span>
              </div>
              <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-mono text-xs font-bold border border-emerald-200">
                SLO: 99.9% TARGET
              </span>
            </div>

            <div className="w-full h-52 pt-2">
              <svg className="w-full h-full" fill="none" viewBox="0 0 500 180">
                <line stroke="#E2E8F0" strokeDasharray="2 2" x1="40" x2="460" y1="30" y2="30" />
                <line stroke="#E2E8F0" strokeDasharray="2 2" x1="40" x2="460" y1="80" y2="80" />
                <line stroke="#E2E8F0" strokeDasharray="2 2" x1="40" x2="460" y1="130" y2="130" />
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
                  stroke="#2563EB"
                  strokeWidth="2.5"
                />

                {/* Real Error occurrences only if error count > 0 */}
                {summary.total_errors > 0 ? (
                  <rect fill="#EF4444" height="20" rx="1" width="8" x="280" y="140" />
                ) : (
                  <circle cx="280" cy="155" r="2" fill="#10B981" />
                )}
              </svg>
            </div>

            <div className="flex items-center justify-center gap-6 pt-2 font-mono text-xs text-slate-500">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-blue-600" />
                <span>Throughput (req/s)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded bg-red-500" />
                <span>Transient 5xx Errors ({summary.error_rate_pct}%)</span>
              </div>
            </div>
          </div>
        </div>

        {/* ==================== SECTION 5: REPLICA DIAGNOSTICS & EXPERIMENT CONTROL ==================== */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          {/* Left Column (8 Cols): Diagnostics Table */}
          <div className="xl:col-span-8 p-5 rounded-xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
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
                    <tr className="text-[11px] font-bold uppercase tracking-wider text-slate-500 bg-slate-50 border-b border-slate-200">
                      <th className="py-2.5 px-3">POD REPLICA</th>
                      <th className="py-2.5 px-3">POD IP</th>
                      <th className="py-2.5 px-3">STATUS</th>
                      <th className="py-2.5 px-3">SERVED</th>
                      <th className="py-2.5 px-3">ACTIVE</th>
                      <th className="py-2.5 px-3">P95</th>
                      <th className="py-2.5 px-3">CPU</th>
                      <th className="py-2.5 px-3">MEMORY</th>
                      <th className="py-2.5 px-3">SCORE (PREVIEW)</th>
                      <th className="py-2.5 px-3 text-right">ACTION</th>
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

            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>Showing 3 replica workers with independent Prometheus scrapers and warm caches.</span>
              <span className="font-mono text-blue-600 font-medium">HPA Scale Target: 3 Min / 10 Max</span>
            </div>
          </div>

          {/* Right Column (4 Cols): Benchmark / Traffic Injection Control */}
          <div className="xl:col-span-4 p-5 rounded-xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Activity size={18} className="text-blue-600" />
                  <h3 className="text-base font-bold text-slate-900">Traffic Generation Harness</h3>
                </div>
                <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-mono text-[10px] font-bold border border-blue-200">
                  REAL K8S DISPATCH
                </span>
              </div>
              <p className="text-xs text-slate-500 mb-4">
                Send actual prediction requests through native Kubernetes Service ClusterIP to verify load distribution.
              </p>

              {/* Traffic details card */}
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 mb-4">
                <div className="flex justify-between items-center text-xs text-slate-600 mb-2">
                  <span className="font-medium">Target Service</span>
                  <span className="font-mono font-bold text-slate-900">inference-service:8000</span>
                </div>
                <div className="flex justify-between items-center text-xs text-slate-600 mb-2">
                  <span className="font-medium">Routing Mechanism</span>
                  <span className="font-mono text-slate-900">IPTables L4 Round-Robin</span>
                </div>
                <div className="flex justify-between items-center text-xs text-slate-600">
                  <span className="font-medium">Observed Replicas</span>
                  <span className="font-mono text-emerald-600 font-semibold">{summary.healthy_replicas} Healthy</span>
                </div>

                {/* Last Run Results */}
                {testResults.length > 0 && (
                  <div className="mt-3 pt-2.5 border-t border-slate-200">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1.5">
                      Last Dispatched Batch ({testResults.length} requests):
                    </span>
                    <div className="space-y-1 max-h-24 overflow-y-auto font-mono text-[11px]">
                      {testResults.slice(0, 4).map((r, i) => (
                        <div key={i} className="flex justify-between items-center text-slate-700 bg-white p-1 rounded border border-slate-100">
                          <span className="text-blue-600 font-semibold truncate max-w-[90px]">{r.request_id}</span>
                          <span className="truncate max-w-[100px] text-slate-600">{r.replica_id?.split('-')?.pop() || 'pod'}</span>
                          <span className="text-emerald-600 font-bold">{r.latency_ms}ms</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Safe environment notice */}
              <div className="p-2.5 rounded bg-blue-50/60 border border-blue-200 text-slate-600 text-xs flex items-start gap-2">
                <ShieldCheck size={16} className="text-blue-600 shrink-0 mt-0.5" />
                <span>Traffic dispatched to native ClusterIP. Real metrics reflect in Prometheus and Grafana.</span>
              </div>
            </div>

            {/* Run Button */}
            <div className="mt-5 pt-3 border-t border-slate-100">
              <button
                onClick={handleSendTestTraffic}
                disabled={isSendingTest}
                className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs flex items-center justify-center gap-2 shadow-xs transition-colors"
              >
                {isSendingTest ? (
                  <>
                    <RotateCw size={14} className="animate-spin" />
                    <span>Dispatching {testCount} Requests...</span>
                  </>
                ) : (
                  <>
                    <Play size={14} fill="currentColor" />
                    <span>Send {testCount} Test Requests Now</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* ==================== SECTION 6: REAL-TIME REQUEST ACTIVITY LOG ==================== */}
        <div className="w-full p-5 sm:p-6 rounded-xl bg-white border border-slate-200 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">Real-Time Request Activity & Ingress Log</h3>
              <span className="text-xs text-slate-500">
                Instantaneous audit trail of requests observed and served across backend replicas via Native Kubernetes Service
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
                <tr className="text-[11px] font-bold uppercase tracking-wider text-slate-500 bg-slate-50 border-b border-slate-200">
                  <th className="py-2 px-3">TIMESTAMP</th>
                  <th className="py-2 px-3">REQUEST ID</th>
                  <th className="py-2 px-3">SERVED BY POD</th>
                  <th className="py-2 px-3">POD IP / HOSTNAME</th>
                  <th className="py-2 px-3">ROUTING MECHANISM</th>
                  <th className="py-2 px-3">OBSERVED LATENCY</th>
                  <th className="py-2 px-3 text-right">HTTP STATUS</th>
                </tr>
              </thead>
              <tbody className="font-mono divide-y divide-slate-100">
                {filteredEvents.length > 0 ? (
                  filteredEvents.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 transition-colors">
                      <td className="py-2 px-3 text-slate-500">{row.timestamp}</td>
                      <td className="py-2 px-3 font-semibold text-blue-600">{row.request_id}</td>
                      <td className="py-2 px-3">
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 font-bold">
                          {row.assigned_pod}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-slate-500 text-[11px]">
                        {row.replica_id}
                      </td>
                      <td className="py-2 px-3 text-slate-600 font-sans text-xs">
                        {row.routing_mechanism || 'Native K8s Service (L4 iptables)'}
                      </td>
                      <td className="py-2 px-3 text-slate-900 font-semibold">
                        {row.observed_latency_ms} ms
                      </td>
                      <td className="py-2 px-3 text-right">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          row.http_status.includes('200')
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-red-50 text-red-700'
                        }`}>
                          {row.http_status}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400 font-sans">
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
          <div className="flex flex-wrap items-center justify-between pt-3 mt-3 border-t border-slate-100 text-xs text-slate-500">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                {hasActiveTraffic && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-500 opacity-75" />
                )}
                <span className={`relative inline-flex rounded-full h-2 w-2 ${hasActiveTraffic ? 'bg-blue-600' : 'bg-slate-400'}`} />
              </span>
              <span className="font-mono">
                Showing {filteredEvents.length} events • Rate: {summary.throughput_rps} events/sec
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleExportJson}
                className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition-colors"
              >
                Download JSON Logs
              </button>
            </div>
          </div>
        </div>

        {/* ==================== SECTION 7: PROMETHEUS & GRAFANA STATUS ==================== */}
        <div className="w-full p-5 rounded-xl bg-slate-900 text-white shadow-xs">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                <h4 className="font-bold text-sm text-white">Cluster Telemetry Engine: Prometheus & Grafana Online</h4>
                <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono text-[10px] font-bold">
                  INTERNAL SERVICE MESH
                </span>
              </div>
              <p className="text-xs text-slate-400 max-w-2xl">
                Prometheus is actively scraping all 3 inference replicas at 3-second intervals using Kubernetes endpoint discovery. Grafana is provisioned with the dedicated MLOps Inference Monitoring dashboard.
              </p>
            </div>

            <div className="flex items-center gap-3 font-mono text-xs">
              <div className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300">
                <span className="text-slate-500 mr-1.5">Grafana Port-Forward:</span>
                <span className="text-emerald-400 font-semibold select-all">kubectl port-forward -n mlops svc/grafana 3000:3000</span>
              </div>
            </div>
          </div>
        </div>

        {/* ==================== FOOTER ==================== */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-2 text-slate-400 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-600">Nexus MLOps Platform</span>
            <span>•</span>
            <span>Academic & Research Edition</span>
          </div>
          <div className="font-mono text-[11px] text-slate-400">
            Engine: Kubernetes v1.37 • Telemetry: Prometheus / Grafana / Metrics Server
          </div>
        </div>
      </div>

      {/* ==================== INSPECT REPLICA MODAL ==================== */}
      {selectedReplicaModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Server size={18} className="text-blue-600" />
                <h3 className="font-bold text-sm text-slate-900">
                  Pod Diagnostics: {selectedReplicaModal.name}
                </h3>
              </div>
              <button
                onClick={() => setSelectedReplicaModal(null)}
                className="text-slate-400 hover:text-slate-700 font-bold"
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-3 font-mono text-xs">
              <div className="flex justify-between p-2 rounded bg-slate-50 border border-slate-100">
                <span className="text-slate-500">Replica Hostname</span>
                <span className="font-bold text-slate-900">{selectedReplicaModal.replica_id}</span>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-50 border border-slate-100">
                <span className="text-slate-500">Pod IP Address</span>
                <span className="font-bold text-slate-900">{selectedReplicaModal.pod_ip}:8000</span>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-50 border border-slate-100">
                <span className="text-slate-500">Health Readiness Probe</span>
                <span className="text-emerald-600 font-bold">HTTP 200 OK (/ready)</span>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-50 border border-slate-100">
                <span className="text-slate-500">Requests Served</span>
                <span className="font-bold text-slate-900">{selectedReplicaModal.requests_served} total</span>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-50 border border-slate-100">
                <span className="text-slate-500">CPU Core Usage (K8s Metrics Server)</span>
                <span className="font-bold text-slate-900">
                  {selectedReplicaModal.cpu_pct != null ? `${selectedReplicaModal.cpu_raw} (${selectedReplicaModal.cpu_pct.toFixed(1)}%)` : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-50 border border-slate-100">
                <span className="text-slate-500">Memory RSS Usage (K8s Metrics Server)</span>
                <span className="font-bold text-slate-900">
                  {selectedReplicaModal.mem_pct != null ? `${selectedReplicaModal.mem_raw} (${selectedReplicaModal.mem_pct.toFixed(1)}%)` : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-50 border border-slate-100">
                <span className="text-slate-500">Benchmark Score (Preview)</span>
                <span className="font-bold text-blue-600">{selectedReplicaModal.score.toFixed(3)}</span>
              </div>
            </div>
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setSelectedReplicaModal(null)}
                className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700"
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
