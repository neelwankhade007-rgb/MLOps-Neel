import React from 'react';
import { Activity, CheckCircle2, Play, Rocket } from 'lucide-react';
import Card from '../components/common/Card';
import TrainingConfig from '../components/training/TrainingConfig';
import TrainingJobList from '../components/training/TrainingJobList';
import { useTraining } from '../hooks/useTraining';

export const TrainingPage: React.FC = () => {
  const {
    datasets,
    jobs,
    filteredJobs,
    search,
    setSearch,
    loading,
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
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-blue-600 mb-1">
            Machine Learning
          </p>
          <h1 className="text-3xl font-bold text-slate-900">Training Jobs</h1>
          <p className="text-slate-500 mt-1">
            Configure, launch and monitor your model training experiments.
          </p>
        </div>

        <div className="text-sm text-slate-500">
          {jobs.length} training job{jobs.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">Total Jobs</p>
              <p className="text-3xl font-bold text-slate-900 mt-1">
                {jobs.length}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {legacyJobs > 0
                  ? `${legacyJobs} legacy record${legacyJobs > 1 ? 's' : ''}`
                  : 'Total training records'}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-blue-50 text-blue-600">
              <Activity size={24} />
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">Completed</p>
              <p className="text-3xl font-bold text-slate-900 mt-1">
                {completedJobs}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Successful training jobs
              </p>
            </div>
            <div className="p-3 rounded-xl bg-emerald-50 text-emerald-600">
              <CheckCircle2 size={24} />
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">Running</p>
              <p className="text-3xl font-bold text-slate-900 mt-1">
                {runningJobs}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Active or queued jobs
              </p>
            </div>
            <div className="p-3 rounded-xl bg-violet-50 text-violet-600">
              <Play size={24} />
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">Failed</p>
              <p className="text-3xl font-bold text-slate-900 mt-1">
                {failedJobs}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Jobs requiring attention
              </p>
            </div>
            <div className="p-3 rounded-xl bg-red-50 text-red-600">
              <Rocket size={24} />
            </div>
          </div>
        </Card>
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
      />
    </div>
  );
};

export default TrainingPage;
