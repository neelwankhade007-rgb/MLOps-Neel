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

  const getEventEpoch = (event: RecentEvent): number | null => {
    const explicitEpoch = Number(event.start_epoch_ms);
    if (Number.isFinite(explicitEpoch) && explicitEpoch > 0) return explicitEpoch;

    const timestamp = String(event.timestamp || '').trim();
    const parsedTimestamp = Date.parse(timestamp);
    if (Number.isFinite(parsedTimestamp)) return parsedTimestamp;

    // Some pod events contain only a clock time (HH:mm:ss.SSS), not an ISO date.
    const timeOnly = timestamp.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
    if (timeOnly) {
      const date = new Date();
      date.setHours(Number(timeOnly[1]), Number(timeOnly[2]), Number(timeOnly[3]), Number((timeOnly[4] || '0').padEnd(3, '0')));
      let epoch = date.getTime();
      if (epoch > Date.now() + 60_000) epoch -= 24 * 60 * 60 * 1000;
      return epoch;
    }
    return null;
  };

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
  const { minEpoch, timeSpanMs, eventEpochs } = useMemo(() => {
    if (filteredEvents.length === 0) {
      const now = Date.now();
      return { minEpoch: now - 10000, timeSpanMs: 10000, eventEpochs: new Map<RecentEvent, number>() };
    }
    const now = Date.now();
    const eventEpochs = new Map<RecentEvent, number>();
    filteredEvents.forEach((event, index) => {
      // Telemetry is newest-first; this deterministic fallback preserves that order.
      eventEpochs.set(event, getEventEpoch(event) ?? now - index * 100);
    });
    const epochs = filteredEvents.map((event) => eventEpochs.get(event)!);
    const min = Math.min(...epochs);
    const latest = Math.max(...epochs);
    // Fit the axis to the observed request window so the latest events do not bunch at the left.
    const span = Math.max(250, latest - min);
    return { minEpoch: min, timeSpanMs: span, eventEpochs };
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
    <div className="w-full rounded-2xl bg-white border border-slate-200/80 shadow-sm p-5 sm:p-6">
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
      <div className="w-full rounded-xl bg-slate-50 border border-slate-200 text-slate-700 p-4 sm:p-5 overflow-x-auto">
        <div className="min-w-[700px]">
          {/* Time scale ruler */}
          <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 pb-3 mb-3 border-b border-slate-200">
            <span>Oldest request</span>
            <span>Request timeline · {(timeSpanMs / 1000).toFixed(2)}s span</span>
            <span>Latest request</span>
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

              const plottedEvents = laneEvents
                .map((ev, index) => {
                  const epoch = eventEpochs.get(ev) ?? minEpoch;
                  const duration = ev.duration_ms || ev.observed_latency_ms || 10;
                  const leftPct = Math.max(0, Math.min(99.2, ((epoch - minEpoch) / timeSpanMs) * 100));
                  const widthPct = Math.max(0.65, Math.min(100 - leftPct, (duration / timeSpanMs) * 100));
                  return { ev, index, duration, leftPct, widthPct };
                })
                .sort((a, b) => a.leftPct - b.leftPct);
              const blockWidthPct = Math.min(1.2, Math.max(0.5, 55 / Math.max(laneEvents.length, 1)));
              const minGapPct = 0.28;
              let nextAvailablePct = 0;
              const positionedEvents = plottedEvents.map((item) => {
                // Keep every request on one track; nudge only colliding blocks to the next free slot.
                const leftPct = Math.min(100 - blockWidthPct, Math.max(item.leftPct, nextAvailablePct));
                nextAvailablePct = leftPct + blockWidthPct + minGapPct;
                return { ...item, leftPct, widthPct: blockWidthPct };
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
                      <span className="font-mono text-xs font-semibold text-slate-700 truncate">
                        {lane.label}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-slate-500">
                      {laneEvents.length}
                    </span>
                  </div>

                  {/* Track Bar with Plotted Request Spans */}
                  <div className="relative flex-1 h-10 rounded-lg bg-white border border-slate-200 overflow-hidden">
                    {/* Light time guides */}
                    <div className="absolute inset-0 grid grid-cols-6 divide-x divide-slate-100 pointer-events-none" />

                    {/* One compact block per request, aligned along a single horizontal row. */}
                    {positionedEvents.map(({ ev, index, duration, leftPct, widthPct }) => {
                      const isSuccess = ev.http_status?.includes('200') || ev.status_code === 200;
                      return (
                        <button
                          key={ev.request_id || index}
                          type="button"
                          onClick={() => setSelectedEventModal(ev)}
                          className={`absolute h-[14px] rounded-sm border px-1 text-[9px] leading-none font-mono transition-colors hover:z-30 ${
                            isSuccess
                              ? 'bg-emerald-100 hover:bg-emerald-200 text-emerald-800 border-emerald-300'
                              : 'bg-rose-100 hover:bg-rose-200 text-rose-800 border-rose-300'
                          }`}
                          style={{
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                            top: '50%',
                            transform: 'translateY(-50%)',
                          }}
                          title={`Request: ${ev.request_id}\nPod: ${ev.assigned_pod}\nLatency: ${duration}ms\nStatus: ${ev.http_status}`}
                          aria-label={`Inspect request ${ev.request_id}, ${duration} milliseconds, ${ev.http_status}`}
                        >
                          {widthPct > 2.5 ? ev.request_id?.slice(-4) || '#req' : ''}
                        </button>
                      );
                    })}

                    {/* In flight requests indicator for active pods */}
                    {inFlightRequests.length > 0 && lane.id !== 'unassigned' && (
                      <div className="absolute right-1 top-1 w-7 h-5 rounded bg-amber-100 border border-amber-300 flex items-center justify-center text-[8px] font-bold text-amber-800">
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
            <span className="w-3 h-3 rounded bg-emerald-100 border border-emerald-300" />
            <span className="text-slate-700">200 OK (Completed)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-rose-100 border border-rose-300" />
            <span className="text-slate-700">Error / Non-200</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-amber-100 border border-amber-300" />
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
