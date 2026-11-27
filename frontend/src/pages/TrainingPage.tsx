import React from 'react';
import { Activity, CheckCircle2, Play, AlertTriangle } from 'lucide-react';
import Card from '../components/common/Card';
import Header from '../components/layout/Header';
import TrainingConfig from '../components/training/TrainingConfig';
import TrainingJobList from '../components/training/TrainingJobList';
import { StatCardSkeleton } from '../components/common/Skeleton';
import { useTraining } from '../hooks/useTraining';

export const TrainingPage: React.FC = () => {
  const {
    datasets,
    jobs,
    filteredJobs,
    search,
    setSearch,
    loading,
    fetching,
    error,
    completedJobs,
    runningJobs,
    failedJobs,
    legacyJobs,
    startTrainingJob,
    refreshTraining,
    deleteTrainingJob,
    clearTrainingJobs,
  } = useTraining();

  return (
    <div className="max-w-[1520px] mx-auto space-y-7">
      <Header
        category="Model Development"
        title="Training Experiments"
        subtitle="Configure, launch, evaluate, and track model training executions and performance."
        action={
          <span className="text-xs font-mono font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-[#1a1a1a] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#262626]">
            {jobs.length} experiment{jobs.length !== 1 ? 's' : ''} logged
          </span>
        }
      />

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {fetching ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            <Card className="p-5 hoverable">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Total Jobs
                  </p>
                  <p className="text-3xl font-bold font-mono text-slate-900 dark:text-white mt-1">
                    {jobs.length}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    {legacyJobs > 0
                      ? `${legacyJobs} legacy record${legacyJobs > 1 ? 's' : ''}`
                      : 'All recorded runs'}
                  </p>
                </div>
                <div className="p-3 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
                  <Activity size={22} />
                </div>
              </div>
            </Card>

            <Card className="p-5 hoverable">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Completed
                  </p>
                  <p className="text-3xl font-bold font-mono text-slate-900 dark:text-white mt-1">
                    {completedJobs}
                  </p>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                    Evaluated & logged
                  </p>
                </div>
                <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 size={22} />
                </div>
              </div>
            </Card>

            <Card className="p-5 hoverable">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Active / Running
                  </p>
                  <p className="text-3xl font-bold font-mono text-slate-900 dark:text-white mt-1">
                    {runningJobs}
                  </p>
                  <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">
                    In flight or queued
                  </p>
                </div>
                <div className="p-3 rounded-2xl bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400">
                  <Play size={22} />
                </div>
              </div>
            </Card>

            <Card className="p-5 hoverable">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Failed
                  </p>
                  <p className="text-3xl font-bold font-mono text-slate-900 dark:text-white mt-1">
                    {failedJobs}
                  </p>
                  <p className="text-xs text-rose-600 dark:text-rose-400 mt-1">
                    Requires inspection
                  </p>
                </div>
                <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400">
                  <AlertTriangle size={22} />
                </div>
              </div>
            </Card>
          </>
        )}
      </div>

      {/* Training Configuration */}
      <TrainingConfig
        datasets={datasets}
        onSubmit={startTrainingJob}
        loading={loading}
      />

      {/* Training Job History */}
      <TrainingJobList
        jobs={filteredJobs}
        datasets={datasets}
        search={search}
        onSearchChange={setSearch}
        error={error}
        onRetry={refreshTraining}
        onDeleteJob={deleteTrainingJob}
        onClearJobs={clearTrainingJobs}
        loading={fetching}
      />
    </div>
  );
};

export default TrainingPage;
