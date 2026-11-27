import React, { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import {
  Sliders,
  Save,
  RotateCcw,
  CheckCircle2,
  Clock,
  Activity,
  Cpu,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import type { ReplicaTelemetry, RoutingStrategy } from '../../api/inferenceApi';

interface ConfigurableWeightsPanelProps {
  replicas: ReplicaTelemetry[];
  activeStrategy: RoutingStrategy;
  confirmedWrrWeights: number[];
  confirmedAdaptiveWeights?: { lat: number; req: number; cpu: number; err: number };
  onSaveWrrWeights: (weights: number[]) => Promise<void>;
  onSaveAdaptiveWeights: (weights: { lat: number; req: number; cpu: number; err: number }) => Promise<void>;
}

export const ConfigurableWeightsPanel: React.FC<ConfigurableWeightsPanelProps> = ({
  replicas,
  activeStrategy,
  confirmedWrrWeights,
  confirmedAdaptiveWeights = { lat: 0.4, req: 0.3, cpu: 0.2, err: 0.1 },
  onSaveWrrWeights,
  onSaveAdaptiveWeights,
}) => {
  // Local Draft State for WRR weights - sized dynamically to discovered replicas
  const [draftWeights, setDraftWeights] = useState<Array<number | ''>>([]);
  const [isSavingWrr, setIsSavingWrr] = useState<boolean>(false);

  // Local Draft State for Adaptive weights
  const [adaptiveLat, setAdaptiveLat] = useState<number>(confirmedAdaptiveWeights.lat);
  const [adaptiveReq, setAdaptiveReq] = useState<number>(confirmedAdaptiveWeights.req);
  const [adaptiveCpu, setAdaptiveCpu] = useState<number>(confirmedAdaptiveWeights.cpu);
  const [adaptiveErr, setAdaptiveErr] = useState<number>(confirmedAdaptiveWeights.err);
  const [isSavingAdaptive, setIsSavingAdaptive] = useState<boolean>(false);

  const confirmedWrrKey = confirmedWrrWeights.join(':');
  const confirmedWrrValues = useMemo(
    () => confirmedWrrKey ? confirmedWrrKey.split(':').map(Number) : [5, 3, 2],
    [confirmedWrrKey],
  );

  // Ensure 3 pods are represented in the topology to match the 5:3:2 cluster specification
  const displayReplicas = useMemo(() => {
    const targetCount = Math.max(3, confirmedWrrValues.length, replicas.length);
    const defaultNames = ['inference-1', 'inference-2', 'inference-3'];
    const defaultColors = ['#4f46e5', '#06b6d4', '#10b981'];

    return Array.from({ length: targetCount }, (_, i) => {
      const live = replicas[i];
      if (live) {
        return {
          ...live,
          name: live.name || defaultNames[i] || `inference-${i + 1}`,
          color: live.color || defaultColors[i % defaultColors.length],
        };
      }
      return {
        replica_id: `inference-service-${i + 1}:8000`,
        name: defaultNames[i] || `inference-${i + 1}`,
        endpoint_ip: `10.244.${i + 1}.2`,
        pod_ip: `10.244.${i + 1}.2`,
        is_ready: true,
        reachable: true,
        requests_served: 0,
        requests_success: 0,
        requests_error: 0,
        active_requests: 0,
        avg_latency_ms: 0,
        p50_latency_ms: 0,
        p95_latency_ms: 0,
        p99_latency_ms: 0,
        recent_requests: [],
        network_ping_ms: 0.5,
        color: defaultColors[i % defaultColors.length],
        status: 'READY' as const,
      };
    });
  }, [replicas, confirmedWrrValues]);

  useEffect(() => {
    const targetCount = Math.max(3, displayReplicas.length, confirmedWrrValues.length);
    const initial = Array.from({ length: targetCount }, (_, i) => {
      if (i < confirmedWrrValues.length) {
        return confirmedWrrValues[i];
      }
      if (i === 0) return 5;
      if (i === 1) return 3;
      if (i === 2) return 2;
      return 1;
    });
    setDraftWeights(initial);
  }, [confirmedWrrValues, displayReplicas.length]);

  // Synchronize adaptive weights when confirmed change
  useEffect(() => {
    setAdaptiveLat(confirmedAdaptiveWeights.lat);
    setAdaptiveReq(confirmedAdaptiveWeights.req);
    setAdaptiveCpu(confirmedAdaptiveWeights.cpu);
    setAdaptiveErr(confirmedAdaptiveWeights.err);
  }, [
    confirmedAdaptiveWeights.lat,
    confirmedAdaptiveWeights.req,
    confirmedAdaptiveWeights.cpu,
    confirmedAdaptiveWeights.err,
  ]);

  // Check for unsaved WRR changes
  const hasUnsavedWrr = useMemo(() => {
    if (draftWeights.length !== confirmedWrrWeights.length) return true;
    return draftWeights.some((w, i) => w !== confirmedWrrWeights[i]);
  }, [draftWeights, confirmedWrrWeights]);

  // Check for unsaved Adaptive changes
  const hasUnsavedAdaptive = useMemo(() => {
    return (
      Math.abs(adaptiveLat - confirmedAdaptiveWeights.lat) > 0.001 ||
      Math.abs(adaptiveReq - confirmedAdaptiveWeights.req) > 0.001 ||
      Math.abs(adaptiveCpu - confirmedAdaptiveWeights.cpu) > 0.001 ||
      Math.abs(adaptiveErr - confirmedAdaptiveWeights.err) > 0.001
    );
  }, [adaptiveLat, adaptiveReq, adaptiveCpu, adaptiveErr, confirmedAdaptiveWeights]);

  // Compute WRR total and percentages
  const wrrTotal = useMemo(() => {
    return draftWeights.reduce<number>((sum, w) => sum + Math.max(1, typeof w === 'number' ? w : 1), 0);
  }, [draftWeights]);

  // Compute Adaptive sum
  const adaptiveSum = (adaptiveLat + adaptiveReq + adaptiveCpu + adaptiveErr).toFixed(2);
  const isAdaptiveNormalized = Math.abs(parseFloat(adaptiveSum) - 1.0) < 0.02;

  // Handle individual replica weight change
  const handleWeightChange = (index: number, rawValue: string) => {
    const parsed = rawValue === '' ? '' : Math.floor(Number(rawValue));
    const nextValue = parsed === '' ? '' : Math.max(1, Math.min(100, parsed || 1));
    setDraftWeights((prev) => {
      const next = [...prev];
      next[index] = nextValue;
      return next;
    });
  };

  const handleWeightBlur = (index: number) => {
    setDraftWeights((prev) => {
      if (prev[index] !== '') return prev;
      const next = [...prev];
      next[index] = confirmedWrrWeights[index] ?? 1;
      return next;
    });
  };

  // Handle Save WRR Weights
  const handleApplyWrr = async () => {
    if (draftWeights.some((w) => w === '' || !Number.isInteger(w) || w <= 0)) {
      toast.error('All replica weights must be positive integers (> 0)');
      return;
    }

    setIsSavingWrr(true);
    try {
      await onSaveWrrWeights(draftWeights as number[]);
      toast.success(`Weighted Round Robin weights applied: ${draftWeights.join(':')}`);
    } catch (err: any) {
      toast.error(`Failed to apply weights: ${err?.message || 'Error'}`);
    } finally {
      setIsSavingWrr(false);
    }
  };

  const handleRevertWrr = () => {
    setDraftWeights([...confirmedWrrWeights]);
  };

  // Handle Save Adaptive Weights
  const handleApplyAdaptive = async () => {
    setIsSavingAdaptive(true);
    try {
      await onSaveAdaptiveWeights({
        lat: adaptiveLat,
        req: adaptiveReq,
        cpu: adaptiveCpu,
        err: adaptiveErr,
      });
      toast.success('Adaptive objective weights applied to cluster');
    } catch (err: any) {
      toast.error(`Failed to apply adaptive weights: ${err?.message || 'Error'}`);
    } finally {
      setIsSavingAdaptive(false);
    }
  };

  const handleResetAdaptiveDefaults = () => {
    setAdaptiveLat(0.4);
    setAdaptiveReq(0.3);
    setAdaptiveCpu(0.2);
    setAdaptiveErr(0.1);
  };

  return (
    <>
      {/* ================= COLUMN 2: WEIGHTED ROUND ROBIN CONFIG ================= */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-neutral-800 bg-white dark:bg-[#151515] p-5 shadow-xs flex flex-col justify-between">
        <div>
          {/* Card Header */}
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100 dark:border-neutral-800">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/50 shrink-0">
                <ShieldCheck size={18} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-neutral-100 flex items-center gap-2">
                  WRR Weights
                  {hasUnsavedWrr && (
                    <span className="px-1.5 py-0.2 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 text-[10px] font-mono font-bold border border-amber-200 dark:border-amber-900/50 animate-pulse">
                      UNSAVED
                    </span>
                  )}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-neutral-400">
                  Ratio interleaved across pods
                </p>
              </div>
            </div>

            <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border shrink-0 ${
              activeStrategy === 'weighted_round_robin'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
                : 'bg-slate-100 dark:bg-neutral-800 text-slate-600 dark:text-neutral-400 border-slate-200 dark:border-neutral-700'
            }`}>
              {activeStrategy === 'weighted_round_robin' ? 'ACTIVE' : `WRR: ${confirmedWrrWeights.join(':')}`}
            </span>
          </div>

          {/* Replicas Weight Inputs */}
          <div className="space-y-2.5">
            {displayReplicas.map((rep, idx) => {
              const currentWeight = draftWeights[idx] !== undefined ? draftWeights[idx] : (confirmedWrrWeights[idx] ?? 1);
              const weightForShare = currentWeight === '' ? 1 : currentWeight;
              const sharePct = wrrTotal > 0 ? ((weightForShare / wrrTotal) * 100).toFixed(1) : '0.0';

              return (
                <div
                  key={rep.replica_id || idx}
                  className="p-2.5 rounded-xl bg-slate-50/70 dark:bg-neutral-900/60 border border-slate-200/80 dark:border-neutral-800 flex items-center justify-between gap-2.5 transition-all"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: rep.color || '#4f46e5' }}
                    />
                    <div className="min-w-0">
                      <span className="font-bold text-slate-900 dark:text-neutral-100 text-xs block font-mono truncate">
                        {rep.name}
                      </span>
                      <span className="text-[10px] text-slate-400 dark:text-neutral-500 block truncate font-mono">
                        {rep.pod_ip || rep.endpoint_ip || 'ClusterIP'}
                      </span>
                    </div>
                  </div>

                  {/* Numeric Input & Ratio Bar */}
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-500 dark:text-neutral-400 font-mono">Wt:</span>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        step="1"
                        value={currentWeight}
                        onChange={(e) => handleWeightChange(idx, e.target.value)}
                        onBlur={() => handleWeightBlur(idx)}
                        className={`w-14 px-2 py-1 rounded-lg font-mono text-xs font-bold text-center border outline-none transition-all ${
                          hasUnsavedWrr && currentWeight !== confirmedWrrWeights[idx]
                            ? 'border-amber-400 bg-amber-50/50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 ring-2 ring-amber-400/20'
                            : 'border-slate-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-slate-900 dark:text-neutral-100 focus:border-indigo-500'
                        }`}
                      />
                    </div>

                    <div className="w-16 text-right">
                      <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400 block">
                        {sharePct}%
                      </span>
                      <div className="w-full bg-slate-200 dark:bg-neutral-800 rounded-full h-1.5 mt-1 overflow-hidden">
                        <div
                          className="bg-indigo-600 dark:bg-indigo-500 h-1.5 rounded-full transition-all duration-300"
                          style={{ width: `${sharePct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Action Footer for WRR */}
        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-neutral-800 flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-500 dark:text-neutral-400 font-mono">
            Total: <strong className="text-slate-800 dark:text-neutral-200">{wrrTotal}</strong> ({draftWeights.join(':')})
          </span>

          <div className="flex items-center gap-2 shrink-0">
            {hasUnsavedWrr && (
              <button
                onClick={handleRevertWrr}
                disabled={isSavingWrr}
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-neutral-800 hover:bg-slate-200 dark:hover:bg-neutral-700 text-slate-700 dark:text-neutral-300 text-xs font-medium border border-slate-200 dark:border-neutral-700 transition-colors active:scale-[0.96] cursor-pointer"
              >
                Cancel
              </button>
            )}
            <button
              onClick={handleApplyWrr}
              disabled={isSavingWrr || !hasUnsavedWrr}
              className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold text-xs flex items-center gap-1.5 shadow-sm transition-all active:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <Save size={13} className="shrink-0" />
              <span>{isSavingWrr ? 'Saving...' : 'Save & Apply'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ================= COLUMN 3: ADAPTIVE MULTI-OBJECTIVE WEIGHTS ================= */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-neutral-800 bg-white dark:bg-[#151515] p-5 shadow-xs flex flex-col justify-between">
        <div>
          {/* Card Header */}
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100 dark:border-neutral-800">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/50 shrink-0">
                <Sliders size={18} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-neutral-100 flex items-center gap-2">
                  Adaptive Tuning
                  {hasUnsavedAdaptive && (
                    <span className="px-1.5 py-0.2 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 text-[10px] font-mono font-bold border border-amber-200 dark:border-amber-900/50 animate-pulse">
                      UNSAVED
                    </span>
                  )}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-neutral-400">
                  Dynamic routing penalty weights
                </p>
              </div>
            </div>

            <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold border shrink-0 ${
              isAdaptiveNormalized
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
                : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800'
            }`}>
              <CheckCircle2 size={11} className="shrink-0" />
              <span>Sum: {adaptiveSum}</span>
            </div>
          </div>

          {/* 4 Sliders */}
          <div className="space-y-2">
            {/* Latency */}
            <div className="p-2 rounded-xl bg-slate-50/70 dark:bg-neutral-900/60 border border-slate-200/80 dark:border-neutral-800">
              <div className="flex justify-between items-center mb-1 text-xs">
                <label className="font-bold text-slate-800 dark:text-neutral-200 flex items-center gap-1 text-[11px]">
                  <Clock size={12} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                  Latency (w_lat)
                </label>
                <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400 bg-white dark:bg-neutral-800 px-1.5 py-0.2 rounded text-[10px] border border-slate-200 dark:border-neutral-700">
                  {adaptiveLat.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={adaptiveLat}
                onChange={(e) => setAdaptiveLat(parseFloat(e.target.value))}
                className="w-full h-1 bg-slate-200 dark:bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
            </div>

            {/* In-Flight Queue Pressure */}
            <div className="p-2 rounded-xl bg-slate-50/70 dark:bg-neutral-900/60 border border-slate-200/80 dark:border-neutral-800">
              <div className="flex justify-between items-center mb-1 text-xs">
                <label className="font-bold text-slate-800 dark:text-neutral-200 flex items-center gap-1 text-[11px]">
                  <Activity size={12} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                  Queue Pressure (w_req)
                </label>
                <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400 bg-white dark:bg-neutral-800 px-1.5 py-0.2 rounded text-[10px] border border-slate-200 dark:border-neutral-700">
                  {adaptiveReq.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={adaptiveReq}
                onChange={(e) => setAdaptiveReq(parseFloat(e.target.value))}
                className="w-full h-1 bg-slate-200 dark:bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
            </div>

            {/* Host CPU Saturation */}
            <div className="p-2 rounded-xl bg-slate-50/70 dark:bg-neutral-900/60 border border-slate-200/80 dark:border-neutral-800">
              <div className="flex justify-between items-center mb-1 text-xs">
                <label className="font-bold text-slate-800 dark:text-neutral-200 flex items-center gap-1 text-[11px]">
                  <Cpu size={12} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                  CPU Saturation (w_cpu)
                </label>
                <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400 bg-white dark:bg-neutral-800 px-1.5 py-0.2 rounded text-[10px] border border-slate-200 dark:border-neutral-700">
                  {adaptiveCpu.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={adaptiveCpu}
                onChange={(e) => setAdaptiveCpu(parseFloat(e.target.value))}
                className="w-full h-1 bg-slate-200 dark:bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
            </div>

            {/* Error Penalty */}
            <div className="p-2 rounded-xl bg-slate-50/70 dark:bg-neutral-900/60 border border-slate-200/80 dark:border-neutral-800">
              <div className="flex justify-between items-center mb-1 text-xs">
                <label className="font-bold text-slate-800 dark:text-neutral-200 flex items-center gap-1 text-[11px]">
                  <AlertTriangle size={12} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                  Error Penalty (w_err)
                </label>
                <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400 bg-white dark:bg-neutral-800 px-1.5 py-0.2 rounded text-[10px] border border-slate-200 dark:border-neutral-700">
                  {adaptiveErr.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={adaptiveErr}
                onChange={(e) => setAdaptiveErr(parseFloat(e.target.value))}
                className="w-full h-1 bg-slate-200 dark:bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
            </div>
          </div>
        </div>

        {/* Action Footer for Adaptive */}
        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-neutral-800 flex items-center justify-between gap-2">
          <button
            onClick={handleResetAdaptiveDefaults}
            className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-neutral-800 hover:bg-slate-200 dark:hover:bg-neutral-700 text-slate-700 dark:text-neutral-300 text-xs font-medium border border-slate-200 dark:border-neutral-700 flex items-center gap-1.5 transition-colors active:scale-[0.96] cursor-pointer"
          >
            <RotateCcw size={12} className="shrink-0" />
            <span>Reset 40/30/20/10</span>
          </button>

          <button
            onClick={handleApplyAdaptive}
            disabled={isSavingAdaptive || !hasUnsavedAdaptive}
            className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold text-xs flex items-center gap-1.5 shadow-sm transition-all active:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <Save size={13} className="shrink-0" />
            <span>{isSavingAdaptive ? 'Saving...' : 'Save Adaptive'}</span>
          </button>
        </div>
      </div>
    </>
  );
};

export default ConfigurableWeightsPanel;
