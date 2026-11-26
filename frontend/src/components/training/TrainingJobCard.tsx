import React, { useState } from 'react';
import {
  BrainCircuit,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Clock,
  HelpCircle,
  ChevronDown,
  Trash2,
} from 'lucide-react';
import Card from '../common/Card';
import ConfirmDialog from '../common/ConfirmDialog';
import type { TrainingJob } from '../../types/training';
import type { Dataset } from '../../types/dataset';
import {
  getStatusStyle,
  getStatusLabel,
  getPrimaryMetric,
  formatSecondaryMetric,
} from '../../utils/formatters';

export interface TrainingJobCardProps {
  job: TrainingJob;
  index: number;
  datasets: Dataset[];
  onDelete?: (id: number) => void;
}

export const TrainingJobCard: React.FC<TrainingJobCardProps> = ({
  job,
  index,
  datasets,
  onDelete,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const status = job.status;
  const dataset = datasets.find((d) => String(d.id) === String(job.dataset_id));

  const isCompleted = String(status ?? '').toLowerCase() === 'completed';
  const isFailed = String(status ?? '').toLowerCase() === 'failed';
  const isRunning = String(status ?? '').toLowerCase() === 'running';

  const { name: primaryMetricName, value: primaryMetricDisplay, isRegression } =
    getPrimaryMetric(job);

  const metrics = job.metrics;
  const isClassification = job.task_type?.toLowerCase() === 'classification';

  const hasRegressionSecondary =
    isRegression &&
    metrics != null &&
    (metrics.mae != null || metrics.rmse != null || metrics.mse != null);

  const hasClassificationSecondary =
    isClassification &&
    metrics != null &&
    (metrics.precision != null ||
      metrics.recall != null ||
      metrics.f1 != null ||
      metrics.roc_auc != null);

  const hasLegacySecondary =
    !isRegression &&
    !isClassification &&
    metrics != null &&
    Object.keys(metrics).length > 0;

  const hasSecondaryMetrics =
    isCompleted &&
    (hasRegressionSecondary || hasClassificationSecondary || hasLegacySecondary);

  return (
    <>
      <Card className="p-5 hover:shadow-md transition-shadow">
        <div className="flex flex-col gap-4">
          {/* Top Header & Core Properties Row */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            {/* Job Identity */}
            <div className="flex items-start gap-4">
              <div
                className={`p-3 rounded-2xl shrink-0 ${
                  isCompleted
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400'
                    : isFailed
                    ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400'
                    : isRunning
                    ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                }`}
              >
                {isRunning ? (
                  <Loader2 size={22} className="animate-spin" />
                ) : isFailed ? (
                  <AlertTriangle size={22} />
                ) : isCompleted ? (
                  <CheckCircle2 size={22} />
                ) : (
                  <BrainCircuit size={22} />
                )}
              </div>

              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold text-slate-900 dark:text-white text-base">
                    {job.name || `Training Job #${job.id ?? index + 1}`}
                  </h3>
                  {status ? (
                    <span
                      className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${getStatusStyle(
                        status
                      )}`}
                    >
                      {getStatusLabel(status)}
                    </span>
                  ) : (
                    <span
                      className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 flex items-center gap-1"
                      title="Historical record prior to status tracking"
                    >
                      <HelpCircle size={12} />
                      Legacy
                    </span>
                  )}

                  {job.task_type && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 capitalize">
                      {job.task_type}
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5 flex-wrap">
                  <span>
                    {dataset?.name
                      ? dataset.name
                      : job.dataset_id
                      ? `Dataset #${job.dataset_id}`
                      : 'Dataset not specified'}
                  </span>
                  {job.created_at && (
                    <>
                      <span>•</span>
                      <span className="flex items-center gap-1 text-[11px] font-mono text-slate-400">
                        <Clock size={11} />
                        {new Date(job.created_at).toLocaleString()}
                      </span>
                    </>
                  )}
                </p>
              </div>
            </div>

            {/* Core Properties & Delete Action */}
            <div className="flex items-center justify-between lg:justify-end gap-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-xs flex-1 lg:flex-initial">
                <div>
                  <p className="text-slate-400 uppercase tracking-wider text-[10px]">Algorithm</p>
                  <p className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5 truncate max-w-[130px]">
                    {job.algorithm || '—'}
                  </p>
                </div>

                <div>
                  <p className="text-slate-400 uppercase tracking-wider text-[10px]">{primaryMetricName}</p>
                  <p className="font-bold text-slate-900 dark:text-white mt-0.5 font-mono text-sm">
                    {primaryMetricDisplay}
                  </p>
                </div>

                <div>
                  <p className="text-slate-400 uppercase tracking-wider text-[10px]">Target</p>
                  <p className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5 truncate max-w-[110px]">
                    {job.target_column || '—'}
                  </p>
                </div>

                <div>
                  <p className="text-slate-400 uppercase tracking-wider text-[10px]">MLflow Run</p>
                  <p
                    className="font-mono text-slate-700 dark:text-slate-300 mt-0.5 text-xs truncate max-w-[100px]"
                    title={job.run_id || undefined}
                  >
                    {job.run_id ? (job.run_id.length > 8 ? `${job.run_id.slice(0, 8)}...` : job.run_id) : '—'}
                  </p>
                </div>
              </div>

              {onDelete && job.id != null && (
                <button
                  type="button"
                  onClick={() => setShowConfirmDelete(true)}
                  title="Delete training job"
                  className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-xl transition-colors shrink-0"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </div>

          {/* Failed Error Message Alert */}
          {isFailed && (
            <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-red-800 dark:text-red-300 text-xs flex items-start gap-2.5">
              <AlertTriangle size={16} className="shrink-0 text-red-600 dark:text-red-400 mt-0.5" />
              <div className="min-w-0">
                <span className="font-bold">Training Failed: </span>
                <span className="font-mono break-words">
                  {job.error_message || 'Training failed without specific error details.'}
                </span>
              </div>
            </div>
          )}

          {/* Expandable Secondary Metrics Panel */}
          {hasSecondaryMetrics && metrics && (
            <div className="pt-2 border-t border-slate-100 dark:border-[#262626] flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setIsExpanded((prev) => !prev)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors w-fit focus:outline-none rounded"
              >
                <span>{isExpanded ? 'Hide detailed metrics' : 'View detailed metrics'}</span>
                <ChevronDown
                  size={14}
                  className={`transition-transform duration-200 ${
                    isExpanded ? 'rotate-180 text-indigo-600 dark:text-indigo-400' : ''
                  }`}
                />
              </button>

              {isExpanded && (
                <div className="p-4 bg-slate-50/80 dark:bg-[#151515] rounded-xl border border-slate-200/70 dark:border-[#262626] space-y-3 animate-in fade-in duration-150">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
                    <span>
                      {isRegression
                        ? 'Additional Regression Metrics'
                        : isClassification
                        ? 'Additional Classification Metrics'
                        : 'Additional Metrics'}
                    </span>
                    <span className="text-[11px] text-slate-400 font-normal">Held-out evaluation split</span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 text-xs">
                    {isRegression ? (
                      <>
                        {metrics.mae != null && (
                          <div className="bg-white dark:bg-[#1c1c1c] p-3 rounded-lg border border-slate-200/60 dark:border-[#2e2e2e] shadow-xs">
                            <p className="text-[10px] uppercase font-bold text-slate-400">MAE</p>
                            <p className="font-mono font-bold text-slate-900 dark:text-white mt-0.5 text-sm">
                              {formatSecondaryMetric('mae', metrics.mae)}
                            </p>
                            <p className="text-[10px] text-slate-400 mt-0.5">Mean Absolute Error</p>
                          </div>
                        )}
                        {metrics.rmse != null && (
                          <div className="bg-white dark:bg-[#1c1c1c] p-3 rounded-lg border border-slate-200/60 dark:border-[#2e2e2e] shadow-xs">
                            <p className="text-[10px] uppercase font-bold text-slate-400">RMSE</p>
                            <p className="font-mono font-bold text-slate-900 dark:text-white mt-0.5 text-sm">
                              {formatSecondaryMetric('rmse', metrics.rmse)}
                            </p>
                            <p className="text-[10px] text-slate-400 mt-0.5">Root Mean Sq Error</p>
                          </div>
                        )}
                        {metrics.mse != null && (
                          <div className="bg-white dark:bg-[#1c1c1c] p-3 rounded-lg border border-slate-200/60 dark:border-[#2e2e2e] shadow-xs">
                            <p className="text-[10px] uppercase font-bold text-slate-400">MSE</p>
                            <p className="font-mono font-bold text-slate-900 dark:text-white mt-0.5 text-sm">
                              {formatSecondaryMetric('mse', metrics.mse)}
                            </p>
                            <p className="text-[10px] text-slate-400 mt-0.5">Mean Squared Error</p>
                          </div>
                        )}
                      </>
                    ) : isClassification ? (
                      <>
                        {metrics.precision != null && (
                          <div className="bg-white dark:bg-[#1c1c1c] p-3 rounded-lg border border-slate-200/60 dark:border-[#2e2e2e] shadow-xs">
                            <p className="text-[10px] uppercase font-bold text-slate-400">Precision</p>
                            <p className="font-mono font-bold text-slate-900 dark:text-white mt-0.5 text-sm">
                              {formatSecondaryMetric('precision', metrics.precision)}
                            </p>
                            <p className="text-[10px] text-slate-400 mt-0.5">Weighted average</p>
                          </div>
                        )}
                        {metrics.recall != null && (
                          <div className="bg-white dark:bg-[#1c1c1c] p-3 rounded-lg border border-slate-200/60 dark:border-[#2e2e2e] shadow-xs">
                            <p className="text-[10px] uppercase font-bold text-slate-400">Recall</p>
                            <p className="font-mono font-bold text-slate-900 dark:text-white mt-0.5 text-sm">
                              {formatSecondaryMetric('recall', metrics.recall)}
                            </p>
                            <p className="text-[10px] text-slate-400 mt-0.5">Weighted average</p>
                          </div>
                        )}
                        {metrics.f1 != null && (
                          <div className="bg-white dark:bg-[#1c1c1c] p-3 rounded-lg border border-slate-200/60 dark:border-[#2e2e2e] shadow-xs">
                            <p className="text-[10px] uppercase font-bold text-slate-400">F1 Score</p>
                            <p className="font-mono font-bold text-slate-900 dark:text-white mt-0.5 text-sm">
                              {formatSecondaryMetric('f1', metrics.f1)}
                            </p>
                            <p className="text-[10px] text-slate-400 mt-0.5">Harmonic mean</p>
                          </div>
                        )}
                        {metrics.roc_auc != null && (
                          <div className="bg-white dark:bg-[#1c1c1c] p-3 rounded-lg border border-slate-200/60 dark:border-[#2e2e2e] shadow-xs">
                            <p className="text-[10px] uppercase font-bold text-slate-400">ROC-AUC</p>
                            <p className="font-mono font-bold text-slate-900 dark:text-white mt-0.5 text-sm">
                              {formatSecondaryMetric('roc_auc', metrics.roc_auc)}
                            </p>
                            <p className="text-[10px] text-slate-400 mt-0.5">Area under curve</p>
                          </div>
                        )}
                      </>
                    ) : (
                      Object.entries(metrics)
                        .filter(([k, v]) => v != null && k !== 'accuracy' && k !== 'r2_score')
                        .map(([key, val]) => (
                          <div key={key} className="bg-white dark:bg-[#1c1c1c] p-3 rounded-lg border border-slate-200/60 dark:border-[#2e2e2e] shadow-xs">
                            <p className="text-[10px] uppercase font-bold text-slate-400">
                              {key.replace(/[_-]+/g, ' ')}
                            </p>
                            <p className="font-mono font-bold text-slate-900 dark:text-white mt-0.5 text-sm">
                              {formatSecondaryMetric(key, val)}
                            </p>
                          </div>
                        ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      <ConfirmDialog
        isOpen={showConfirmDelete}
        onClose={() => setShowConfirmDelete(false)}
        onConfirm={() => {
          setShowConfirmDelete(false);
          if (job.id != null) onDelete?.(job.id);
        }}
        title="Delete Training Experiment"
        message={`Are you sure you want to delete training job "${job.name || `#${job.id}`}"? This will remove the experiment record, MLflow run, and registered artifacts.`}
        confirmLabel="Delete Experiment"
        variant="danger"
      />
    </>
  );
};

export default TrainingJobCard;
