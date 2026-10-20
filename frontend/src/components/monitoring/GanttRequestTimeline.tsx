import React, { useState, useMemo } from 'react';
import {
  Clock,
  Search,
  Trash2,
  Zap,
  X,
} from 'lucide-react';
import type { RecentEvent, ReplicaTelemetry } from '../../api/inferenceApi';

export interface InFlightRequest {
  requestId: string;
  strategy: string;
  startTime: number;
}

interface GanttRequestTimelineProps {
  events: RecentEvent[];
  replicas: ReplicaTelemetry[];
  inFlightRequests?: InFlightRequest[];
  windowSize: number;
  onWindowSizeChange: (size: number) => void;
  onClearEvents?: () => void;
}

export const GanttRequestTimeline: React.FC<GanttRequestTimelineProps> = ({
  events,
  replicas,
  inFlightRequests = [],
  windowSize,
  onWindowSizeChange,
  onClearEvents,
}) => {
  const [filterPod, setFilterPod] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedEventModal, setSelectedEventModal] = useState<RecentEvent | null>(null);

  // Filtered events bounded by windowSize
  const filteredEvents = useMemo(() => {
    return events
      .filter((ev) => {
        if (filterPod !== 'ALL') {
          if (ev.assigned_pod !== filterPod && ev.replica_id !== filterPod) {
            return false;
          }
        }
        if (filterStatus === '200') {
          if (!ev.http_status?.includes('200') && ev.status_code !== 200) {
            return false;
          }
        } else if (filterStatus === 'ERR') {
          if (ev.http_status?.includes('200') || ev.status_code === 200) {
            return false;
          }
        }
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchId = ev.request_id?.toLowerCase().includes(q);
          const matchPod = ev.assigned_pod?.toLowerCase().includes(q) || ev.replica_id?.toLowerCase().includes(q);
          const matchStrat = ev.routing_mechanism?.toLowerCase().includes(q);
          if (!matchId && !matchPod && !matchStrat) {
            return false;
          }
        }
        return true;
      })
      .slice(0, windowSize);
  }, [events, filterPod, filterStatus, searchQuery, windowSize]);

  // Compute time window boundaries for Gantt projection
  const { minEpoch, timeSpanMs } = useMemo(() => {
    if (filteredEvents.length === 0) {
      const now = Date.now();
      return { minEpoch: now - 10000, timeSpanMs: 10000 };
    }
    const epochs = filteredEvents.map((e) => e.start_epoch_ms || Date.now());
    const durations = filteredEvents.map((e) => e.duration_ms || e.observed_latency_ms || 10);
    const min = Math.min(...epochs);
    const max = Math.max(...epochs.map((ep, i) => ep + durations[i]));
    const span = Math.max(3000, max - min + 500); // at least 3 seconds span
    return { minEpoch: min, timeSpanMs: span };
  }, [filteredEvents]);

  // Swimlanes: Group by known replica pods + Failed/Unassigned track
  const swimlanes = useMemo(() => {
    const lanes: { id: string; label: string; color: string; podIp?: string }[] = replicas.map((r) => ({
      id: r.replica_id,
      label: r.name,
      color: r.color || '#2563EB',
      podIp: r.pod_ip,
    }));
    lanes.push({
      id: 'unassigned',
      label: 'Other / Failed',
      color: '#EF4444',
      podIp: 'N/A',
    });
    return lanes;
  }, [replicas]);

  return (
    <div className="w-full rounded-2xl bg-white border border-slate-200/80 shadow-sm p-5 sm:p-6 mt-6">
      {/* Header and Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 mb-5 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100">
              <Clock size={18} />
            </div>
            <h3 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
              Request Execution Gantt Timeline
              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs font-mono font-medium border border-slate-200">
                {filteredEvents.length} events plotted
              </span>
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Real execution spans per pod replica with start offsets, measured roundtrip durations, and HTTP status.
          </p>
        </div>

        {/* Filter and View Options */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Search */}
          <div className="flex items-center bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg text-xs">
            <Search size={14} className="text-slate-400 mr-2" />
            <input
              type="text"
              placeholder="Search request ID or pod..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent border-0 text-slate-800 placeholder-slate-400 focus:outline-none text-xs w-44"
            />
          </div>

          {/* Pod Filter */}
          <select
            value={filterPod}
            onChange={(e) => setFilterPod(e.target.value)}
            className="bg-slate-50 border border-slate-200 text-slate-700 font-mono text-xs px-2.5 py-1.5 rounded-lg focus:outline-none cursor-pointer"
          >
            <option value="ALL">All Pods</option>
            {replicas.map((r) => (
              <option key={r.replica_id} value={r.replica_id}>
                {r.name} ({r.replica_id.slice(-6)})
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-slate-50 border border-slate-200 text-slate-700 font-mono text-xs px-2.5 py-1.5 rounded-lg focus:outline-none cursor-pointer"
          >
            <option value="ALL">Status: All</option>
            <option value="200">200 OK Only</option>
            <option value="ERR">Errors / Non-200</option>
          </select>

          {/* Window size */}
          <select
            value={windowSize}
            onChange={(e) => onWindowSizeChange(Number(e.target.value))}
            className="bg-slate-50 border border-slate-200 text-slate-700 font-mono text-xs px-2.5 py-1.5 rounded-lg focus:outline-none cursor-pointer"
            title="Max requests retained in timeline view"
          >
            <option value="15">Last 15</option>
            <option value="30">Last 30</option>
            <option value="50">Last 50</option>
            <option value="100">Last 100</option>
          </select>

          {onClearEvents && (
            <button
              onClick={onClearEvents}
              className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors"
              title="Clear event buffer"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Gantt Visual Canvas Area */}
      <div className="w-full rounded-xl bg-slate-900 border border-slate-800 text-white p-4 overflow-x-auto shadow-inner">
        <div className="min-w-[700px]">
          {/* Time scale ruler */}
          <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 pb-2 mb-3 border-b border-slate-800">
            <span>T-0s (Oldest in view)</span>
            <span>Relative Time Axis (Span: {(timeSpanMs / 1000).toFixed(1)}s)</span>
            <span>Now (Latest)</span>
          </div>

          {/* Swimlanes for Each Pod Replica */}
          <div className="space-y-3">
            {swimlanes.map((lane) => {
              // Get events belonging to this lane
              const laneEvents = filteredEvents.filter((ev) => {
                if (lane.id === 'unassigned') {
                  return (
                    ev.replica_id === 'error' ||
                    ev.replica_id === 'unavailable' ||
                    !replicas.some((r) => r.replica_id === ev.replica_id || r.name === ev.assigned_pod)
                  );
                }
                return (
                  ev.replica_id === lane.id ||
                  ev.assigned_pod === lane.label ||
                  (ev.replica_id && ev.replica_id.includes(lane.id))
                );
              });

              return (
                <div key={lane.id} className="flex items-center gap-3">
                  {/* Pod Label */}
                  <div className="w-36 shrink-0 flex items-center justify-between pr-2">
                    <div className="flex items-center gap-1.5 truncate">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: lane.color }}
                      />
                      <span className="font-mono text-xs font-bold text-slate-200 truncate">
                        {lane.label}
                      </span>
                    </div>
                    <span className="font-mono text-[9px] text-slate-400">
                      {laneEvents.length}
                    </span>
                  </div>

                  {/* Track Bar with Plotted Request Spans */}
                  <div className="relative flex-1 h-8 rounded-lg bg-slate-800/80 border border-slate-700/60 overflow-hidden">
                    {/* Grid lines */}
                    <div className="absolute inset-0 grid grid-cols-6 divide-x divide-slate-800/60 pointer-events-none" />

                    {/* Plotted Events in this track */}
                    {laneEvents.map((ev, i) => {
                      const startEpoch = ev.start_epoch_ms || minEpoch;
                      const duration = ev.duration_ms || ev.observed_latency_ms || 10;
                      const leftPct = Math.max(0, Math.min(95, ((startEpoch - minEpoch) / timeSpanMs) * 100));
                      const widthPct = Math.max(3, Math.min(100 - leftPct, (duration / timeSpanMs) * 100));
                      const isSuccess = ev.http_status?.includes('200') || ev.status_code === 200;

                      return (
                        <div
                          key={ev.request_id || i}
                          onClick={() => setSelectedEventModal(ev)}
                          className={`absolute top-1 bottom-1 rounded cursor-pointer transition-all hover:scale-y-110 hover:z-30 flex items-center justify-between px-1.5 text-[9px] font-mono shadow-sm ${
                            isSuccess
                              ? 'bg-emerald-500/90 hover:bg-emerald-400 text-white border border-emerald-400'
                              : 'bg-rose-500/90 hover:bg-rose-400 text-white border border-rose-400'
                          }`}
                          style={{
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                          }}
                          title={`Request: ${ev.request_id}\nPod: ${ev.assigned_pod}\nLatency: ${duration}ms\nStatus: ${ev.http_status}`}
                        >
                          <span className="truncate max-w-[80px] font-semibold">
                            {ev.request_id?.slice(-5) || '#req'}
                          </span>
                          <span className="text-[8px] opacity-90 hidden sm:inline">
                            {Math.round(duration)}ms
                          </span>
                        </div>
                      );
                    })}

                    {/* In flight requests indicator for active pods */}
                    {inFlightRequests.length > 0 && lane.id !== 'unassigned' && (
                      <div className="absolute right-1 top-1 bottom-1 w-6 rounded bg-amber-500/60 animate-pulse border border-amber-400 flex items-center justify-center text-[8px] font-bold text-amber-100">
                        IN
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Legend & Instructions */}
      <div className="flex flex-wrap items-center justify-between pt-3 mt-4 text-xs text-slate-500 border-t border-slate-100">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-emerald-500 border border-emerald-600" />
            <span className="text-slate-700">200 OK (Completed)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-rose-500 border border-rose-600" />
            <span className="text-slate-700">Error / Non-200</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-amber-500 border border-amber-600 animate-pulse" />
            <span className="text-slate-700">In-Flight</span>
          </div>
        </div>
        <span className="text-slate-400 text-[11px]">
          Click any Gantt bar to inspect complete request metadata.
        </span>
      </div>

      {/* Request Inspection Modal */}
      {selectedEventModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
                  <Zap size={18} />
                </div>
                <div>
                  <h4 className="font-bold text-slate-900 text-sm font-mono">
                    {selectedEventModal.request_id}
                  </h4>
                  <span className="text-xs text-slate-500">Recorded Request Telemetry Event</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedEventModal(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 font-mono text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-slate-400 block text-[10px]">SERVING POD</span>
                  <span className="font-bold text-slate-900">{selectedEventModal.assigned_pod}</span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-slate-400 block text-[10px]">POD REPLICA ID</span>
                  <span className="font-semibold text-slate-700 truncate block">
                    {selectedEventModal.replica_id}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-slate-400 block text-[10px]">MEASURED LATENCY</span>
                  <span className="font-bold text-emerald-600">
                    {selectedEventModal.observed_latency_ms} ms
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-slate-400 block text-[10px]">TOTAL DURATION</span>
                  <span className="font-bold text-slate-900">
                    {selectedEventModal.duration_ms || selectedEventModal.observed_latency_ms} ms
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-slate-400 block text-[10px]">HTTP STATUS</span>
                  <span className={`font-bold ${selectedEventModal.http_status.includes('200') ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {selectedEventModal.http_status}
                  </span>
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-slate-400 block text-[10px]">ROUTING MECHANISM</span>
                <span className="font-semibold text-slate-800">
                  {selectedEventModal.routing_mechanism || 'Native Kubernetes Service (ClusterIP)'}
                </span>
              </div>

              {selectedEventModal.gateway_latency_ms != null && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                    <span className="text-slate-400 block text-[10px]">GATEWAY OVERHEAD</span>
                    <span className="font-semibold text-slate-800">
                      {selectedEventModal.gateway_latency_ms} ms
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                    <span className="text-slate-400 block text-[10px]">UPSTREAM REPLICA LATENCY</span>
                    <span className="font-semibold text-slate-800">
                      {selectedEventModal.upstream_latency_ms || selectedEventModal.observed_latency_ms} ms
                    </span>
                  </div>
                </div>
              )}

              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-slate-400 block text-[10px]">TIMESTAMP (UTC)</span>
                <span className="font-semibold text-slate-700">{selectedEventModal.timestamp}</span>
              </div>
            </div>

            <div className="mt-5 pt-3 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setSelectedEventModal(null)}
                className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs transition-colors"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GanttRequestTimeline;
