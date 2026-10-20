import React, { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import {
  Sliders,
  Save,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Activity,
  Cpu,
  ShieldCheck,
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
  const [draftWeights, setDraftWeights] = useState<number[]>([]);
  const [isSavingWrr, setIsSavingWrr] = useState<boolean>(false);

  // Local Draft State for Adaptive weights
  const [adaptiveLat, setAdaptiveLat] = useState<number>(confirmedAdaptiveWeights.lat);
  const [adaptiveReq, setAdaptiveReq] = useState<number>(confirmedAdaptiveWeights.req);
  const [adaptiveCpu, setAdaptiveCpu] = useState<number>(confirmedAdaptiveWeights.cpu);
  const [adaptiveErr, setAdaptiveErr] = useState<number>(confirmedAdaptiveWeights.err);
  const [isSavingAdaptive, setIsSavingAdaptive] = useState<boolean>(false);

  // Synchronize draft WRR weights whenever confirmed weights or replicas change
  useEffect(() => {
    const targetCount = Math.max(1, replicas.length);
    const initial = Array.from({ length: targetCount }, (_, i) => {
      if (i < confirmedWrrWeights.length) {
        return confirmedWrrWeights[i];
      }
      return 1;
    });
    setDraftWeights(initial);
  }, [confirmedWrrWeights, replicas]);

  // Synchronize adaptive weights when confirmed change
  useEffect(() => {
    setAdaptiveLat(confirmedAdaptiveWeights.lat);
    setAdaptiveReq(confirmedAdaptiveWeights.req);
    setAdaptiveCpu(confirmedAdaptiveWeights.cpu);
    setAdaptiveErr(confirmedAdaptiveWeights.err);
  }, [confirmedAdaptiveWeights]);

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
    return draftWeights.reduce((sum, w) => sum + Math.max(1, w), 0);
  }, [draftWeights]);

  // Compute Adaptive sum
  const adaptiveSum = (adaptiveLat + adaptiveReq + adaptiveCpu + adaptiveErr).toFixed(2);
  const isAdaptiveNormalized = Math.abs(parseFloat(adaptiveSum) - 1.0) < 0.02;

  // Handle individual replica weight change
  const handleWeightChange = (index: number, val: number) => {
    const clamped = Math.max(1, Math.min(100, Math.floor(val) || 1));
    setDraftWeights((prev) => {
      const next = [...prev];
      next[index] = clamped;
      return next;
    });
  };

  // Handle Save WRR Weights
  const handleApplyWrr = async () => {
    // Validation: All weights must be positive integers
    if (draftWeights.some((w) => isNaN(w) || w <= 0)) {
      toast.error('All replica weights must be positive integers (> 0)');
      return;
    }

    setIsSavingWrr(true);
    try {
      await onSaveWrrWeights(draftWeights);
      toast.success(`Weighted Round Robin weights saved & applied: ${draftWeights.join(':')}`);
    } catch (err: any) {
      toast.error(`Failed to apply weights: ${err?.message || 'Error'}`);
    } finally {
      setIsSavingWrr(false);
    }
  };

  // Revert WRR to confirmed
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
      toast.success('Adaptive objective weights saved & applied to cluster');
    } catch (err: any) {
      toast.error(`Failed to apply adaptive weights: ${err?.message || 'Error'}`);
    } finally {
      setIsSavingAdaptive(false);
    }
  };

  // Reset Adaptive to defaults
  const handleResetAdaptiveDefaults = () => {
    setAdaptiveLat(0.4);
    setAdaptiveReq(0.3);
    setAdaptiveCpu(0.2);
    setAdaptiveErr(0.1);
  };

  return (
    <div className="w-full rounded-2xl bg-white border border-slate-200/80 shadow-sm p-5 sm:p-6 mt-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 mb-5 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-violet-50 text-violet-600 border border-violet-100">
            <Sliders size={20} />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
              Configurable Replica Weights & Strategy Parameters
              {hasUnsavedWrr && (
                <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-xs font-mono font-bold border border-amber-200 animate-pulse">
                  UNSAVED WRR CHANGES
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Dynamically discovered from live replica pods. Customize and persist routing coefficients without hardcoded assumptions.
            </p>
          </div>
        </div>

        {/* Backend Confirmed Badge */}
        <div className="flex items-center gap-2 text-xs">
          <span className="font-mono text-slate-500">Backend Confirmed WRR:</span>
          <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 font-mono text-xs font-bold border border-slate-200">
            {confirmedWrrWeights.join(' : ')}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ================= SECTION A: WEIGHTED ROUND ROBIN CONFIG (7 Cols) ================= */}
        <div className="lg:col-span-6 flex flex-col justify-between p-4 rounded-xl bg-slate-50/70 border border-slate-200/80">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <ShieldCheck size={16} className="text-violet-600" />
                Weighted Round Robin (WRR) Weights
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                activeStrategy === 'weighted_round_robin'
                  ? 'bg-violet-50 text-violet-700 border-violet-200'
                  : 'bg-slate-200 text-slate-600 border-slate-300'
              }`}>
                {activeStrategy === 'weighted_round_robin' ? 'ACTIVE STRATEGY' : 'AVAILABLE'}
              </span>
            </div>

            <p className="text-xs text-slate-500 mb-4">
              Set positive integer weights for each discovered replica. Traffic will be smoothly interleaved in this exact ratio.
            </p>

            {/* Replicas Weight Inputs */}
            <div className="space-y-3">
              {replicas.map((rep, idx) => {
                const currentWeight = draftWeights[idx] !== undefined ? draftWeights[idx] : 1;
                const sharePct = wrrTotal > 0 ? ((currentWeight / wrrTotal) * 100).toFixed(1) : '0.0';

                return (
                  <div
                    key={rep.replica_id || idx}
                    className="p-3 rounded-lg bg-white border border-slate-200 shadow-xs flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-[140px]">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: rep.color || '#2563EB' }}
                      />
                      <div>
                        <span className="font-bold text-slate-900 text-xs block font-mono">
                          {rep.name}
                        </span>
                        <span className="text-[10px] text-slate-400 block truncate max-w-[110px]">
                          {rep.replica_id}
                        </span>
                      </div>
                    </div>

                    {/* Numeric Input */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 font-mono">Weight:</span>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        step="1"
                        value={currentWeight}
                        onChange={(e) => handleWeightChange(idx, parseInt(e.target.value, 10))}
                        className={`w-16 px-2 py-1 rounded font-mono text-xs font-bold text-center border focus:outline-none ${
                          hasUnsavedWrr && currentWeight !== confirmedWrrWeights[idx]
                            ? 'border-amber-400 bg-amber-50/50 text-amber-900 ring-2 ring-amber-400/20'
                            : 'border-slate-300 bg-white text-slate-900'
                        }`}
                      />
                    </div>

                    {/* Ratio Share Bar & Pct */}
                    <div className="w-24 text-right">
                      <span className="font-mono text-xs font-bold text-violet-700 block">
                        {sharePct}%
                      </span>
                      <div className="w-full bg-slate-100 rounded-full h-1.5 mt-1 overflow-hidden">
                        <div
                          className="bg-violet-600 h-1.5 rounded-full transition-all duration-300"
                          style={{ width: `${sharePct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Action Footer for WRR */}
          <div className="mt-5 pt-3 border-t border-slate-200 flex items-center justify-between gap-3">
            <span className="text-[11px] text-slate-500 font-mono">
              Total Weight: <strong>{wrrTotal}</strong> ({draftWeights.join(':')})
            </span>

            <div className="flex items-center gap-2">
              {hasUnsavedWrr && (
                <button
                  onClick={handleRevertWrr}
                  disabled={isSavingWrr}
                  className="px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-medium transition-colors"
                >
                  Cancel
                </button>
              )}
              <button
                onClick={handleApplyWrr}
                disabled={isSavingWrr || !hasUnsavedWrr}
                className="px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-semibold text-xs flex items-center gap-1.5 shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save size={14} />
                <span>{isSavingWrr ? 'Saving to Cluster...' : 'Save & Apply Weights'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* ================= SECTION B: ADAPTIVE MULTI-OBJECTIVE WEIGHTS (6 Cols) ================= */}
        <div className="lg:col-span-6 flex flex-col justify-between p-4 rounded-xl bg-slate-50/70 border border-slate-200/80">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <Sliders size={16} className="text-blue-600" />
                Adaptive Multi-Signal Objective Tuning
              </span>
              <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                isAdaptiveNormalized
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200'
              }`}>
                <CheckCircle2 size={12} />
                <span>Sum: {adaptiveSum}</span>
              </div>
            </div>

            <p className="text-xs text-slate-500 mb-4">
              Configurable penalty weights used by the router to dynamically select the healthiest replica with lowest score.
            </p>

            <div className="space-y-3">
              {/* Latency */}
              <div className="p-2.5 rounded-lg bg-white border border-slate-200">
                <div className="flex justify-between items-center mb-1 text-xs">
                  <label className="font-bold text-slate-800 flex items-center gap-1">
                    <Clock size={13} className="text-blue-600" />
                    Latency Penalty (w_lat)
                  </label>
                  <span className="font-mono font-bold text-blue-600 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
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
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>

              {/* Active Reqs */}
              <div className="p-2.5 rounded-lg bg-white border border-slate-200">
                <div className="flex justify-between items-center mb-1 text-xs">
                  <label className="font-bold text-slate-800 flex items-center gap-1">
                    <Activity size={13} className="text-blue-600" />
                    In-Flight Queue Pressure (w_req)
                  </label>
                  <span className="font-mono font-bold text-blue-600 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
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
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>

              {/* CPU Compute */}
              <div className="p-2.5 rounded-lg bg-white border border-slate-200">
                <div className="flex justify-between items-center mb-1 text-xs">
                  <label className="font-bold text-slate-800 flex items-center gap-1">
                    <Cpu size={13} className="text-blue-600" />
                    Host CPU Saturation (w_cpu)
                  </label>
                  <span className="font-mono font-bold text-blue-600 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
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
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>

              {/* Error Rate */}
              <div className="p-2.5 rounded-lg bg-white border border-slate-200">
                <div className="flex justify-between items-center mb-1 text-xs">
                  <label className="font-bold text-slate-800 flex items-center gap-1">
                    <AlertTriangle size={13} className="text-blue-600" />
                    Error Penalty Multiplier (w_err)
                  </label>
                  <span className="font-mono font-bold text-blue-600 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
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
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>
            </div>
          </div>

          {/* Action Footer for Adaptive */}
          <div className="mt-5 pt-3 border-t border-slate-200 flex items-center justify-between gap-3">
            <button
              onClick={handleResetAdaptiveDefaults}
              className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 transition-colors"
            >
              <RotateCcw size={12} />
              <span>Reset 40/30/20/10</span>
            </button>

            <button
              onClick={handleApplyAdaptive}
              disabled={isSavingAdaptive || !hasUnsavedAdaptive}
              className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs flex items-center gap-1.5 shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save size={14} />
              <span>{isSavingAdaptive ? 'Saving...' : 'Save Adaptive Weights'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfigurableWeightsPanel;
