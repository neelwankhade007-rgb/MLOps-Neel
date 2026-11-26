import React, { useState } from 'react';
import { BrainCircuit, AlertCircle, Trash2, Search } from 'lucide-react';
import Card from '../common/Card';
import ConfirmDialog from '../common/ConfirmDialog';
import TrainingJobCard from './TrainingJobCard';
import { ListCardSkeleton } from '../common/Skeleton';
import type { TrainingJob } from '../../types/training';
import type { Dataset } from '../../types/dataset';

export interface TrainingJobListProps {
  jobs: TrainingJob[];
  datasets: Dataset[];
  search: string;
  onSearchChange: (value: string) => void;
  error?: string | null;
  onRetry?: () => void;
  onDeleteJob?: (id: number) => void;
  onClearJobs?: () => void;
  loading?: boolean;
}

export const TrainingJobList: React.FC<TrainingJobListProps> = ({
  jobs,
  datasets,
  search,
  onSearchChange,
  error,
  onRetry,
  onDeleteJob,
  onClearJobs,
  loading = false,
}) => {
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Training Job History</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Historical records of model training runs, parameters, and evaluations
            </p>
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto">
            <div className="relative w-full md:w-80">
              <Search
                size={15}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search by ID, name, algorithm, status..."
                className="w-full rounded-xl border border-slate-200 dark:border-[#262626] bg-white dark:bg-[#151515] pl-9 pr-4 py-2 text-xs text-slate-800 dark:text-slate-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 transition-all"
              />
            </div>

            {onClearJobs && jobs.length > 0 && (
              <button
                type="button"
                onClick={() => setShowClearConfirm(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-xl border border-red-200 dark:border-red-900/50 transition-colors shrink-0"
                title="Clear all training records"
              >
                <Trash2 size={13} />
                <span>Clear All</span>
              </button>
            )}
          </div>
        </div>

        {error ? (
          <Card className="p-12 text-center border-red-100 dark:border-red-900/40 bg-red-50/30 dark:bg-red-950/20">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-red-100 dark:bg-red-900/50 flex items-center justify-center text-red-600 dark:text-red-300">
              <AlertCircle size={26} />
            </div>
            <h3 className="mt-4 text-base font-bold text-slate-800 dark:text-slate-200">
              Failed to load training history
            </h3>
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              {error}. Please check your backend connection and retry.
            </p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="mt-4 px-4 py-2 bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold transition"
              >
                Retry
              </button>
            )}
          </Card>
        ) : loading ? (
          <div className="space-y-4">
            <ListCardSkeleton />
            <ListCardSkeleton />
          </div>
        ) : jobs.length > 0 ? (
          <div className="space-y-4">
            {jobs.map((job, index) => (
              <TrainingJobCard
                key={job.id ?? index}
                job={job}
                index={index}
                datasets={datasets}
                onDelete={onDeleteJob}
              />
            ))}
          </div>
        ) : (
          <Card className="p-12 text-center">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <BrainCircuit size={26} />
            </div>
            <h3 className="mt-4 text-base font-bold text-slate-800 dark:text-slate-200">
              {search ? 'No matching training jobs' : 'No training jobs executed yet'}
            </h3>
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
              {search
                ? `No job matched filter "${search}". Clear search to view all.`
                : 'Configure a dataset and algorithm above to initiate your first model training experiment.'}
            </p>
          </Card>
        )}
      </div>

      <ConfirmDialog
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={() => {
          setShowClearConfirm(false);
          onClearJobs?.();
        }}
        title="Clear All Training Jobs"
        message="Are you sure you want to delete all training jobs? This will permanently remove all experiment history, MLflow metrics, and artifacts."
        confirmLabel="Clear All Experiments"
        variant="danger"
      />
    </>
  );
};

export default TrainingJobList;
