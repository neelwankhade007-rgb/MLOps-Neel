import React from 'react';
import {
  Cpu,
  Layers,
  ShieldCheck,
  Zap,
  Activity,
} from 'lucide-react';
import type { ReplicaTelemetry, RoutingStrategy } from '../../api/inferenceApi';

export interface AnimatedPacket {
  id: string;
  requestId: string;
  targetReplicaId: string;
  targetPodIndex: number;
  status: number;
  latencyMs: number;
  progress: number; // 0 (start) to 1 (arrived)
  strategy: string;
  timestamp: number;
}

interface LiveRoutingVisualizerProps {
  replicas: ReplicaTelemetry[];
  activeStrategy: RoutingStrategy;
  activeStrategyTitle: string;
  isGatewayActive: boolean;
  activePackets: AnimatedPacket[];
  recentlyHitPod: string | null;
  onSelectReplica?: (replica: ReplicaTelemetry) => void;
  throughputRps: number;
  isGeneratingTraffic: boolean;
}

export const LiveRoutingVisualizer: React.FC<LiveRoutingVisualizerProps> = ({
  replicas,
  activeStrategy,
  activeStrategyTitle,
  isGatewayActive,
  activePackets,
  recentlyHitPod,
  onSelectReplica,
  throughputRps,
  isGeneratingTraffic,
}) => {
  const hasActiveTraffic = throughputRps > 0 || isGeneratingTraffic || activePackets.length > 0;

  return (
    <div className="w-full rounded-2xl bg-white border border-slate-200/80 shadow-sm p-5 sm:p-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 mb-6 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-50 text-blue-600 border border-blue-100">
            <Layers size={20} />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
              Live Request-Routing Topology
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                hasActiveTraffic
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-slate-100 text-slate-600 border-slate-200'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${hasActiveTraffic ? 'bg-emerald-500 animate-ping' : 'bg-slate-400'}`} />
                {hasActiveTraffic ? 'TRAFFIC FLOWING' : 'IDLE / AWAITING TRAFFIC'}
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Real-time animated visualization of actual prediction dispatch from ingress through routing layer to serving replica pods.
            </p>
          </div>
        </div>

        {/* Status badges */}
        <div className="flex items-center gap-2 text-xs">
          <span className="font-mono text-slate-500">Active Routing:</span>
          <span className={`px-2.5 py-1 rounded-lg font-mono text-xs font-bold border ${
            isGatewayActive
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-blue-50 text-blue-800 border-blue-200'
          }`}>
            {activeStrategyTitle}
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-mono text-xs border border-slate-200">
            {replicas.filter((r) => r.is_ready).length}/{replicas.length} Pods Healthy
          </span>
        </div>
      </div>

      {/* Main Visual Canvas Area */}
      <div className="relative w-full rounded-xl bg-slate-50/70 p-4 sm:p-6 border border-slate-200/80 overflow-hidden">
        {/* Animated Packets Overlay */}
        <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden">
          {activePackets.map((pkt) => {
            // Find target replica index
            const repIndex = replicas.findIndex(
              (r) => r.replica_id === pkt.targetReplicaId || r.name === pkt.targetReplicaId
            );
            const targetIdx = repIndex >= 0 ? repIndex : pkt.targetPodIndex;
            const totalReps = Math.max(1, replicas.length);
            // Y position relative to number of replica cards
            const yStart = 50; // center router Y %
            const yEnd = totalReps === 1 ? 50 : 20 + (targetIdx / (totalReps - 1)) * 60;
            // X position: from router (40%) to pod (75%)
            const currentX = 40 + pkt.progress * 35;
            const currentY = yStart + (yEnd - yStart) * pkt.progress;

            return (
              <div
                key={pkt.id}
                className="absolute transform -translate-x-1/2 -translate-y-1/2 transition-all duration-75"
                style={{
                  left: `${currentX}%`,
                  top: `${currentY}%`,
                  opacity: pkt.progress > 0.95 ? 1 - (pkt.progress - 0.95) * 20 : 1,
                }}
              >
                <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold shadow-md animate-bounce ${
                  pkt.status === 200
                    ? 'bg-emerald-500 text-white shadow-emerald-500/40 ring-2 ring-emerald-300'
                    : 'bg-rose-500 text-white shadow-rose-500/40 ring-2 ring-rose-300'
                }`}>
                  <Zap size={10} className="fill-current" />
                  <span>{pkt.requestId.slice(-5)}</span>
                  <span className="text-[9px] opacity-80">{pkt.latencyMs}ms</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-12 gap-4 sm:gap-6 items-center min-w-[850px]">
          {/* STEP 1: Traffic Generator & Client Ingress (3 Columns) */}
          <div className="col-span-3 flex flex-col gap-3">
            <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm relative">
              <div className="absolute -top-2.5 left-3 px-2 py-0.5 rounded bg-slate-900 text-white font-mono text-[9px] font-bold uppercase tracking-wider">
                Source 1 · Ingress
              </div>

              <div className="flex items-center justify-between mb-2 pt-1">
                <span className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                  <Activity size={15} className="text-blue-600" />
                  Client Requests
                </span>
                <span className={`px-2 py-0.5 rounded font-mono text-xs font-bold border ${
                  hasActiveTraffic
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-slate-100 text-slate-600 border-slate-200'
                }`}>
                  {throughputRps.toFixed(1)} rps
                </span>
              </div>

              <p className="text-xs text-slate-500 mb-3">
                Incoming inference prediction requests dispatched via cluster mesh or test generator.
              </p>

              <div className="space-y-1.5 font-mono text-xs">
                <div className="flex justify-between items-center p-2 rounded bg-slate-50 border border-slate-100">
                  <span className="text-slate-500">Payload</span>
                  <span className="font-semibold text-slate-900">Titanic Features (JSON)</span>
                </div>
                <div className="flex justify-between items-center p-2 rounded bg-slate-50 border border-slate-100">
                  <span className="text-slate-500">Transport</span>
                  <span className="font-semibold text-slate-900">HTTP/1.1 REST</span>
                </div>
                <div className="flex justify-between items-center p-2 rounded bg-slate-50 border border-slate-100">
                  <span className="text-slate-500">Target</span>
                  <span className="font-semibold text-blue-600 truncate max-w-[140px]">
                    {isGatewayActive ? 'gateway:8080/predict' : 'service:8000/predict'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* CONNECTOR 1: Flow to Router (1 Column) */}
          <div className="col-span-1 flex flex-col items-center justify-center">
            <div className="flex flex-col items-center gap-1 text-center">
              <span className={`font-mono text-[10px] font-bold ${
                hasActiveTraffic ? 'text-blue-600 animate-pulse' : 'text-slate-400'
              }`}>
                {hasActiveTraffic ? `${throughputRps.toFixed(1)} rps` : 'idle'}
              </span>
              <div className="w-full flex items-center justify-center text-slate-400">
                <svg fill="none" height="24" viewBox="0 0 48 24" width="48">
                  <path
                    d="M0,12 L38,12 M32,6 L40,12 L32,18"
                    stroke={hasActiveTraffic ? '#2563EB' : '#94A3B8'}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.5"
                  />
                  {hasActiveTraffic && (
                    <circle cx="20" cy="12" r="3.5" fill="#2563EB" className="animate-ping" />
                  )}
                </svg>
              </div>
              <span className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">
                DISPATCH
              </span>
            </div>
          </div>

          {/* STEP 2: Central Routing Strategy Node (4 Columns) */}
          <div className="col-span-4 flex flex-col">
            <div className={`p-4 rounded-xl bg-white border shadow-md relative transition-all ${
              isGatewayActive
                ? 'border-emerald-300 ring-2 ring-emerald-500/10'
                : 'border-blue-300 ring-2 ring-blue-500/10'
            }`}>
              <div className={`absolute -top-2.5 left-3 px-2 py-0.5 rounded text-white font-mono text-[9px] font-bold uppercase tracking-wider ${
                isGatewayActive ? 'bg-emerald-700' : 'bg-blue-700'
              }`}>
                {isGatewayActive ? 'L7 User-Space Gateway' : 'Kernel L4 K8s Service'}
              </div>

              <div className="flex items-center justify-between mb-2 pt-1">
                <span className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                  <Cpu size={16} className={isGatewayActive ? "text-emerald-600" : "text-blue-600"} />
                  {isGatewayActive ? 'Inference Gateway Router' : 'Kubernetes ClusterIP'}
                </span>
                <span className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold border ${
                  isGatewayActive
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-blue-50 text-blue-700 border-blue-200'
                }`}>
                  {isGatewayActive ? 'L7 PROXY' : 'L4 IPTABLES'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 border border-slate-100 mb-3 text-xs space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Policy Engine:</span>
                  <span className="font-bold font-mono text-slate-900">{activeStrategyTitle}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Target Mode:</span>
                  <span className="font-mono text-slate-700">
                    {activeStrategy === 'native'
                      ? 'ClusterIP (Kernel L4 Load Balancer)'
                      : activeStrategy === 'round_robin'
                      ? 'Strict Equal Sequential (1:1:1)'
                      : activeStrategy === 'weighted_round_robin'
                      ? 'Smooth Weighted Interleaving'
                      : 'Multi-Signal Health Score'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Replicas Discovered:</span>
                  <span className="font-mono font-semibold text-emerald-700">
                    {replicas.length} healthy endpoints
                  </span>
                </div>
              </div>

              {/* Strategy Details Indicator */}
              <div className="text-[11px] text-slate-600 bg-slate-100/70 p-2 rounded border border-slate-200 flex items-center gap-1.5">
                <ShieldCheck size={14} className={isGatewayActive ? "text-emerald-600 shrink-0" : "text-blue-600 shrink-0"} />
                <span className="truncate">
                  {isGatewayActive
                    ? `Gateway distributes traffic across ${replicas.length} live pods.`
                    : 'Kernel iptables hashes TCP connection; serving pod resolved dynamically.'}
                </span>
              </div>
            </div>
          </div>

          {/* STEP 3: Discovered Replica Pods (4 Columns) */}
          <div className="col-span-4 flex flex-col gap-2.5">
            {replicas.map((rep, idx) => {
              const isHitRecently =
                recentlyHitPod === rep.replica_id ||
                recentlyHitPod === rep.name ||
                activePackets.some((p) => p.targetReplicaId === rep.replica_id);

              return (
                <div
                  key={rep.replica_id || idx}
                  onClick={() => onSelectReplica?.(rep)}
                  className={`p-3 rounded-xl bg-white border cursor-pointer transition-all duration-300 relative ${
                    isHitRecently
                      ? 'ring-4 ring-emerald-400 border-emerald-500 bg-emerald-50/40 shadow-lg shadow-emerald-500/10 scale-[1.01]'
                      : 'border-slate-200 hover:border-slate-300 shadow-sm'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: rep.color || '#2563EB' }}
                      />
                      <span className="font-bold text-slate-900 text-xs font-mono">
                        {rep.name}
                      </span>
                      <span className={`px-1.5 py-0.2 rounded font-mono text-[9px] font-bold ${
                        rep.is_ready ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                      }`}>
                        {rep.is_ready ? 'READY' : 'OFFLINE'}
                      </span>
                    </div>

                    <span className="font-mono text-xs font-bold text-slate-900">
                      {rep.requests_served} reqs
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono text-slate-600 pt-1 border-t border-slate-100">
                    <div>
                      <span className="text-slate-400 block text-[9px]">IP</span>
                      <span className="font-semibold truncate block">{rep.pod_ip || '10.244.0.x'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[9px]">LATENCY</span>
                      <span className="font-semibold text-slate-800">
                        {rep.avg_latency_ms ? `${rep.avg_latency_ms}ms` : '<1ms'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[9px]">SHARE</span>
                      <span className="font-bold text-blue-600">
                        {rep.traffic_share_pct ? `${rep.traffic_share_pct}%` : '0%'}
                      </span>
                    </div>
                  </div>

                  {/* Arrival indicator pulse */}
                  {isHitRecently && (
                    <span className="absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500" />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveRoutingVisualizer;
