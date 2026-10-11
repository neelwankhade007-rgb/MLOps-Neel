import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Loader2,
  X,
  ExternalLink,
  CheckCheck,
  BrainCircuit,
  Info,
} from 'lucide-react';
import { useTraining } from '../../hooks/useTraining';
import type { TrainingJob } from '../../types/training';
import { getPrimaryMetric } from '../../utils/formatters';

export const NotificationCenter: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const {
    jobs,
    activeJob,
    unreadCount,
    readJobIds,
    dismissedJobIds,
    markAsRead,
    markAllAsRead,
    dismissNotification,
    setSearch,
  } = useTraining();

  // Timer tick for active synchronous training
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!activeJob) return;
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [activeJob]);

  const elapsedSeconds = activeJob
    ? Math.max(0, Math.floor((now - activeJob.started_at) / 1000))
    : 0;

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleNavigateToJob = (job: TrainingJob) => {
    if (job.id != null) {
      markAsRead(job.id);
      setSearch(String(job.id));
    }
    setIsOpen(false);
    navigate('/training');
  };

  const visibleJobs = jobs
    .filter(job => job.id == null || !dismissedJobIds.includes(job.id))
    .slice(0, 15);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        aria-label="Training Notifications"
        className="relative p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-indigo-600 rounded-full shadow-sm animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Popover Dropdown */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-96 sm:w-[440px] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-150">
          {/* Header */}
          <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400">
                <BrainCircuit size={18} />
              </div>
              <div>
                <h3 className="font-semibold text-sm text-slate-100">Training Activity</h3>
                <p className="text-xs text-slate-400">Operational status & confirmed metrics</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllAsRead}
                  title="Mark all as read"
                  className="flex items-center gap-1 text-xs text-indigo-300 hover:text-white px-2 py-1 rounded-md hover:bg-slate-800 transition"
                >
                  <CheckCheck size={14} />
                  <span>Mark read</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-md hover:bg-slate-800 transition"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="max-h-[480px] overflow-y-auto divide-y divide-slate-100">
            {/* Active Training Request Banner */}
            {activeJob && (
              <div className="p-4 bg-indigo-50/70 border-b border-indigo-100">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 text-indigo-700 font-semibold text-xs uppercase tracking-wider">
                    <Loader2 size={14} className="animate-spin text-indigo-600" />
                    <span>Synchronous Training Active</span>
                  </div>
                  <span className="text-[11px] font-mono font-medium text-indigo-600 bg-indigo-100/80 px-2 py-0.5 rounded-full">
                    {elapsedSeconds}s elapsed
                  </span>
                </div>

                <div className="mt-2.5 space-y-1">
                  <p className="text-sm font-bold text-slate-900">
                    {activeJob.algorithm}
                  </p>
                  <p className="text-xs text-slate-600">
                    Dataset: <span className="font-medium text-slate-800">{activeJob.dataset_name || `#${activeJob.dataset_id}`}</span> • Target: <span className="font-medium text-slate-800">{activeJob.target_column}</span>
                  </p>
                  <p className="text-[11px] text-indigo-700/80 italic mt-1">
                    Waiting for backend model execution & artifact logging...
                  </p>
                </div>
              </div>
            )}

            {/* Recent Notifications List */}
            {visibleJobs.length > 0 ? (
              <div className="divide-y divide-slate-100">
                {visibleJobs.map((job, idx) => {
                  const isRead = job.id != null && readJobIds.includes(job.id);
                  const isCompleted = String(job.status ?? '').toLowerCase() === 'completed';
                  const isFailed = String(job.status ?? '').toLowerCase() === 'failed';
                  const isRunning = String(job.status ?? '').toLowerCase() === 'running';
                  const isLegacy = job.status == null || job.status === '' || job.status === 'unknown';

                  const { name: primaryMetricName, value: primaryMetricDisplay, isUnavailable } =
                    getPrimaryMetric(job);

                  return (
                    <div
                      key={job.id ?? `job-${idx}`}
                      className={`p-4 transition-colors hover:bg-slate-50 relative ${
                        !isRead ? 'bg-indigo-50/20' : ''
                      }`}
                    >
                      {/* Unread indicator dot */}
                      {!isRead && (
                        <div className="absolute top-4 right-3 w-2 h-2 rounded-full bg-indigo-600" />
                      )}

                      <div className="flex items-start gap-3">
                        {/* Status Icon */}
                        <div className="mt-0.5 shrink-0">
                          {isCompleted ? (
                            <div className="p-1.5 rounded-lg bg-emerald-100 text-emerald-700">
                              <CheckCircle2 size={16} />
                            </div>
                          ) : isFailed ? (
                            <div className="p-1.5 rounded-lg bg-red-100 text-red-700">
                              <AlertTriangle size={16} />
                            </div>
                          ) : isRunning ? (
                            <div className="p-1.5 rounded-lg bg-blue-100 text-blue-700">
                              <Loader2 size={16} className="animate-spin" />
                            </div>
                          ) : (
                            <div className="p-1.5 rounded-lg bg-slate-100 text-slate-600">
                              <Info size={16} />
                            </div>
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0 pr-4">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md ${
                                isCompleted
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : isFailed
                                  ? 'bg-red-100 text-red-800'
                                  : isRunning
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {isCompleted
                                ? 'Completed'
                                : isFailed
                                ? 'Failed'
                                : isRunning
                                ? 'Running'
                                : 'Legacy'}
                            </span>

                            <span className="text-xs font-semibold text-slate-900 truncate">
                              {job.name || `Job #${job.id}`}
                            </span>
                          </div>

                          {/* Primary Metric / Error Message */}
                          {isCompleted && (
                            <div className="mt-2 text-xs bg-slate-50 border border-slate-200/80 rounded-lg p-2.5">
                              <div className="flex items-center justify-between">
                                <span className="font-medium text-slate-700">
                                  {primaryMetricName}:
                                </span>
                                <span className="font-bold text-slate-900 font-mono">
                                  {primaryMetricDisplay}
                                </span>
                              </div>
                            </div>
                          )}

                          {isFailed && (
                            <div className="mt-2 text-xs bg-red-50 border border-red-200 rounded-lg p-2.5 text-red-700">
                              <p className="font-medium">Error details:</p>
                              <p className="text-[11px] font-mono mt-0.5 break-words">
                                {job.error_message || 'Training failed without specific details.'}
                              </p>
                            </div>
                          )}

                          {isLegacy && (
                            <p className="mt-1 text-xs text-slate-500">
                              Historical record without recorded status lifecycle.
                              {!isUnavailable ? ` ${primaryMetricName}: ${primaryMetricDisplay}` : ''}
                            </p>
                          )}

                          {/* Footer details & Action */}
                          <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-400">
                            <span className="flex items-center gap-1">
                              <Clock size={12} />
                              {job.created_at
                                ? new Date(job.created_at).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    month: 'short',
                                    day: 'numeric',
                                  })
                                : 'Recent'}
                            </span>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleNavigateToJob(job)}
                                className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-medium hover:underline"
                              >
                                <span>View</span>
                                <ExternalLink size={11} />
                              </button>

                              {job.id != null && (
                                <button
                                  type="button"
                                  onClick={() => dismissNotification(job.id!)}
                                  title="Dismiss notification"
                                  className="text-slate-400 hover:text-slate-600 p-0.5 rounded"
                                >
                                  <X size={12} />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : !activeJob ? (
              <div className="p-8 text-center text-slate-400">
                <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3 text-slate-400">
                  <Bell size={20} />
                </div>
                <p className="text-sm font-medium text-slate-700">No training activity</p>
                <p className="text-xs text-slate-400 mt-1">
                  When you execute training jobs, operational state and evaluation metrics will appear here.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationCenter;
