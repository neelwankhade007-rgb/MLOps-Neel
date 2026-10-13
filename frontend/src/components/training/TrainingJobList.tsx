import React from 'react';
import { BrainCircuit, AlertCircle, Trash2 } from 'lucide-react';
import Card from '../common/Card';
import TrainingJobCard from './TrainingJobCard';
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
}) => {
  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Training Job History</h2>
          <p className="text-sm text-slate-500">
            Track previous model training executions.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <input
            type="text"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search training jobs..."
            className="w-full md:w-80 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          {onClearJobs && jobs.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Are you sure you want to clear all training jobs? This will delete all experiment records, MLflow runs, and their artifacts.')) {
                  onClearJobs();
                }
              }}
              className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-xl border border-red-200 transition-colors shrink-0"
              title="Clear all training jobs"
            >
              <Trash2 size={15} />
              <span>Clear All</span>
            </button>
          )}
        </div>
      </div>

      {error ? (
        <Card className="p-12 text-center border-red-100 bg-red-50/30">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-red-100 flex items-center justify-center text-red-600">
            <AlertCircle size={30} />
          </div>
          <h3 className="mt-5 text-lg font-semibold text-slate-800">
            Failed to load training history
          </h3>
          <p className="mt-2 text-sm text-slate-500 max-w-md mx-auto">
            {error}. Please check your connection or try again.
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition"
            >
              Retry
            </button>
          )}
        </Card>
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
          <div className="mx-auto w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400">
            <BrainCircuit size={30} />
          </div>
          <h3 className="mt-5 text-lg font-semibold text-slate-800">
            {search ? 'No training jobs found' : 'No training jobs yet'}
          </h3>
          <p className="mt-2 text-sm text-slate-500 max-w-md mx-auto">
            {search
              ? 'Try a different search term.'
              : 'Configure a dataset, target column and algorithm above to start your first training job.'}
          </p>
        </Card>
      )}
    </div>
  );
};

export default TrainingJobList;
