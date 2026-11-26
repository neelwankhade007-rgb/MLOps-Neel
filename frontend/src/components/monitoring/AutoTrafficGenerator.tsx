import React, { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import {
  Play,
  Square,
  Activity,
  Zap,
  Clock,
  Sliders,
  ShieldCheck,
} from 'lucide-react';
import { inferenceApi } from '../../api/inferenceApi';
import type { TestTrafficResult, RoutingStrategy } from '../../api/inferenceApi';

interface AutoTrafficGeneratorProps {
  activeStrategy: RoutingStrategy;
  activeStrategyTitle: string;
  isGatewayActive: boolean;
  onTrafficDispatched: (results: TestTrafficResult[]) => void;
  onActiveTrafficChange?: (isGenerating: boolean) => void;
}

export const AutoTrafficGenerator: React.FC<AutoTrafficGeneratorProps> = ({
  activeStrategyTitle,
  isGatewayActive,
  onTrafficDispatched,
  onActiveTrafficChange,
}) => {
  const [isRunning, setIsRunning] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [users, setUsers] = useState(3);
  const [targetRps, setTargetRps] = useState(1);
  const [durationSec, setDurationSec] = useState(10);
  const [requestCap, setRequestCap] = useState(50);
  const [deploymentName, setDeploymentName] = useState('');
  const [deployments, setDeployments] = useState<Array<{ name: string }>>([]);
  const [stats, setStats] = useState({ sent: 0, success: 0, failed: 0, pending: 0, rps: 0.0 });
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle');
  const isMountedRef = useRef(true);
  const seenRequestIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    isMountedRef.current = true;
    onActiveTrafficChange?.(isRunning);
    return () => { isMountedRef.current = false; };
  }, [isRunning, onActiveTrafficChange]);

  useEffect(() => {
    let mounted = true;
    inferenceApi.getLocustDeployments().then((items) => {
      if (!mounted) return;
      setDeployments(items);
      if (items.length) setDeploymentName(items[0].name);
    }).catch((err: any) => {
      if (mounted) toast.error(err?.response?.data?.detail || 'Could not load deployments for Locust');
    });
    inferenceApi.getLocustRunStatus().then((snapshot) => {
      if (!mounted) return;
      setRunStatus(snapshot.status);
      setIsRunning(snapshot.status === 'running');
      if (snapshot.run) setDeploymentName(snapshot.run.deployment_name);
    }).catch(() => undefined);
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!isRunning) return;
    let active = true;
    const poll = async () => {
      try {
        const snapshot = await inferenceApi.getLocustRunStatus();
        if (!active || !isMountedRef.current) return;
        setRunStatus(snapshot.status);
        setIsRunning(snapshot.status === 'running');
        const metrics = snapshot.run?.metrics;
        if (metrics) {
          setStats({
            sent: metrics.sent || 0,
            success: metrics.success || 0,
            failed: metrics.failed || 0,
            pending: 0,
            rps: metrics.observed_rps || 0,
          });
          const fresh = (metrics.events || []).filter((event) => {
            if (seenRequestIdsRef.current.has(event.request_id)) return false;
            seenRequestIdsRef.current.add(event.request_id);
            return true;
          }).reverse();
          if (fresh.length) onTrafficDispatched(fresh);
        }
      } catch (err: any) {
        if (active) toast.error(err?.response?.data?.detail || 'Could not read Locust run status');
      }
    };
    poll();
    const timer = window.setInterval(poll, 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [isRunning, onTrafficDispatched]);

  const handleStart = async () => {
    if (isRunning || !deploymentName) return;
    seenRequestIdsRef.current.clear();
    setStats({ sent: 0, success: 0, failed: 0, pending: 0, rps: 0 });
    try {
      const snapshot = await inferenceApi.startLocustRun({
        deployment_name: deploymentName,
        users,
        target_rps: targetRps,
        duration_seconds: durationSec,
        request_limit: requestCap,
      });
      setRunStatus(snapshot.status);
      setIsRunning(snapshot.status === 'running');
      toast.success(`Locust started: ${users} users, up to ${targetRps} req/s for ${durationSec}s`);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Could not start the Locust run');
    }
  };

  const handleStop = async () => {
    setIsStopping(true);
    try {
      const snapshot = await inferenceApi.stopLocustRun();
      setRunStatus(snapshot.status);
      setIsRunning(snapshot.status === 'running');
      toast.success('Locust traffic stopped');
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Could not stop Locust');
    } finally {
      setIsStopping(false);
    }
  };

  const handleResetStats = () => {
    if (isRunning) return;
    setStats({ sent: 0, success: 0, failed: 0, pending: 0, rps: 0 });
    seenRequestIdsRef.current.clear();
  };

  return (
    <div className="w-full rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs sm:p-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 mb-5 border-b border-slate-100 dark:border-[#262626]">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-xl border ${
            isRunning
              ? 'bg-emerald-50 text-emerald-600 border-emerald-200 animate-pulse'
              : 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-900/50'
          }`}>
            <Activity size={20} />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
              Locust Load Generator
              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-mono font-bold border ${
                isRunning
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : isStopping
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-[#262626]'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                {isRunning ? 'RUNNING' : isStopping ? 'STOPPING...' : runStatus.toUpperCase()}
              </span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Generate authenticated live inference requests through the active cluster routing layer.
            </p>
          </div>
        </div>

        {/* Start / Stop Action Buttons */}
        <div className="flex items-center gap-2.5 shrink-0">
          {!isRunning ? (
            <button
              onClick={handleStart}
              disabled={!deploymentName || deployments.length === 0}
              className="py-2 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-semibold text-xs inline-flex items-center gap-2 shadow-xs transition-all active:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <Play size={13} fill="currentColor" className="shrink-0" />
              <span className="whitespace-nowrap">Start Locust Traffic</span>
            </button>
          ) : (
            <button
              onClick={() => handleStop()}
              disabled={isStopping}
              className="py-2 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-semibold text-xs inline-flex items-center gap-2 shadow-xs transition-all active:scale-[0.96] cursor-pointer"
            >
              <Square size={13} fill="currentColor" className="shrink-0" />
              <span className="whitespace-nowrap">{isStopping ? 'Stopping...' : 'Stop Traffic'}</span>
            </button>
          )}

          <button
            onClick={handleResetStats}
            disabled={isRunning}
            className="py-2 px-3 rounded-xl bg-slate-100 dark:bg-neutral-800 hover:bg-slate-200 dark:hover:bg-neutral-700 text-slate-700 dark:text-neutral-300 text-xs font-medium border border-slate-200/80 dark:border-neutral-700 transition-all active:scale-[0.96] disabled:opacity-50 cursor-pointer"
            title="Reset generator counters"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Locust run configuration */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <div className="rounded-xl border border-slate-200/70 dark:border-[#262626] bg-slate-50/60 dark:bg-[#1a1a1a] p-3.5">
          <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 mb-2">
            <ShieldCheck size={14} className="text-indigo-600" /> Target Deployment
          </label>
          <select
            value={deploymentName}
            disabled={isRunning}
            onChange={(e) => setDeploymentName(e.target.value)}
            className="w-full rounded-lg border border-slate-200 dark:border-[#333] bg-white dark:bg-[#151515] p-2 text-xs text-slate-800 dark:text-slate-100 disabled:opacity-50"
          >
            {deployments.length === 0 && <option value="">No active deployment</option>}
            {deployments.map((deployment) => (
              <option key={deployment.name} value={deployment.name}>
                {deployment.name}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-xl border border-slate-200/70 dark:border-[#262626] bg-slate-50/60 dark:bg-[#1a1a1a] p-3.5">
          <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 mb-2">
            <Activity size={14} className="text-indigo-600" /> Concurrent Users
          </label>
          <input
            type="number"
            min="1"
            max="50"
            step="1"
            value={users}
            disabled={isRunning}
            onChange={(e) => setUsers(Math.max(1, Math.min(50, Number(e.target.value))))}
            className="w-full rounded-lg border border-slate-200 dark:border-[#333] bg-white dark:bg-[#151515] p-2 font-mono text-xs text-slate-800 dark:text-slate-100 disabled:opacity-50"
          />
          <span className="text-[10px] text-slate-400 mt-1 block">Parallel client workers (1–50)</span>
        </div>

        <div className="rounded-xl border border-slate-200/70 dark:border-[#262626] bg-slate-50/60 dark:bg-[#1a1a1a] p-3.5">
          <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 mb-2">
            <Zap size={14} className="text-indigo-600" /> Target Rate
          </label>
          <input
            type="number"
            min="0.1"
            max="50"
            step="0.5"
            value={targetRps}
            disabled={isRunning}
            onChange={(e) => setTargetRps(Math.max(0.1, Math.min(50, Number(e.target.value))))}
            className="w-full rounded-lg border border-slate-200 dark:border-[#333] bg-white dark:bg-[#151515] p-2 font-mono text-xs text-slate-800 dark:text-slate-100 disabled:opacity-50"
          />
          <span className="text-[10px] text-slate-400 mt-1 block">Maximum aggregate rate (req/s)</span>
        </div>

        <div className="rounded-xl border border-slate-200/70 dark:border-[#262626] bg-slate-50/60 dark:bg-[#1a1a1a] p-3.5">
          <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 mb-2">
            <Clock size={14} className="text-indigo-600" /> Duration
          </label>
          <input
            type="number"
            min="1"
            max="300"
            step="1"
            value={durationSec}
            disabled={isRunning}
            onChange={(e) => setDurationSec(Math.max(1, Math.min(300, Number(e.target.value))))}
            className="w-full rounded-lg border border-slate-200 dark:border-[#333] bg-white dark:bg-[#151515] p-2 font-mono text-xs text-slate-800 dark:text-slate-100 disabled:opacity-50"
          />
          <span className="text-[10px] text-slate-400 mt-1 block">Run window in seconds (1–300)</span>
        </div>

        <div className="rounded-xl border border-slate-200/70 dark:border-[#262626] bg-slate-50/60 dark:bg-[#1a1a1a] p-3.5">
          <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 mb-2">
            <Sliders size={14} className="text-indigo-600" /> Request Cap
          </label>
          <input
            type="number"
            min="1"
            max="10000"
            step="1"
            value={requestCap}
            disabled={isRunning}
            onChange={(e) => setRequestCap(Math.max(1, Math.min(10000, Number(e.target.value))))}
            className="w-full rounded-lg border border-slate-200 dark:border-[#333] bg-white dark:bg-[#151515] p-2 font-mono text-xs text-slate-800 dark:text-slate-100 disabled:opacity-50"
          />
          <span className="text-[10px] text-slate-400 mt-1 block">Maximum total queries allowed</span>
        </div>

        {/* Active policy echo */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-200/70 dark:border-[#262626] bg-slate-50/60 dark:bg-[#1a1a1a] p-3.5">
          <div>
            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 mb-1">
              <ShieldCheck size={14} className={isGatewayActive ? "text-emerald-600" : "text-indigo-600"} />
              Selected Strategy
            </span>
            <span className="font-mono text-xs font-bold text-slate-900 dark:text-white block truncate">
              {activeStrategyTitle}
            </span>
          </div>
          <span className="text-[10px] text-slate-400 block mt-1">
            {isGatewayActive
              ? 'Requests are routed through the custom L7 gateway proxy.'
              : 'Requests are routed via native Kubernetes ClusterIP service.'}
          </span>
        </div>
      </div>

      {/* Live Generator Metrics Cards */}
      <div className="grid grid-cols-2 gap-3 border-t border-slate-100 dark:border-[#262626] pt-4 sm:grid-cols-3 xl:grid-cols-5">
        <div className="rounded-xl border border-slate-200/60 dark:border-[#262626] bg-slate-50/60 dark:bg-[#1a1a1a] p-3">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
            Completed Requests
          </span>
          <span className="text-xl font-bold font-mono text-slate-900 dark:text-white mt-1 block">
            {stats.sent}
          </span>
        </div>

        <div className="rounded-xl border border-emerald-100 dark:border-emerald-900/40 bg-emerald-50/50 dark:bg-emerald-950/20 p-3">
          <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider block">
            Succeeded (200)
          </span>
          <span className="text-xl font-bold font-mono text-emerald-800 dark:text-emerald-200 mt-1 block">
            {stats.success}
          </span>
        </div>

        <div className="rounded-xl border border-rose-100 dark:border-rose-900/40 bg-rose-50/50 dark:bg-rose-950/20 p-3">
          <span className="text-[10px] font-bold text-rose-700 dark:text-rose-300 uppercase tracking-wider block">
            Failed / Errors
          </span>
          <span className="text-xl font-bold font-mono text-rose-800 dark:text-rose-200 mt-1 block">
            {stats.failed}
          </span>
        </div>

        <div className="rounded-xl border border-amber-100 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/20 p-3">
          <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wider block">
            Active Workers
          </span>
          <span className="text-xl font-bold font-mono text-amber-800 dark:text-amber-200 mt-1 block">
            {isRunning ? users : 0}
          </span>
        </div>

        <div className="rounded-xl border border-indigo-100 dark:border-indigo-900/40 bg-indigo-50/50 dark:bg-indigo-950/20 p-3">
          <span className="text-[10px] font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider block">
            Observed Throughput
          </span>
          <span className="text-xl font-bold font-mono text-indigo-800 dark:text-indigo-200 mt-1 block">
            {stats.rps} req/s
          </span>
        </div>
      </div>
    </div>
  );
};

export default AutoTrafficGenerator;
