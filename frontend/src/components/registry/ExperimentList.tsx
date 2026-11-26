import React, { useState } from 'react';
import { Box, Plus } from 'lucide-react';
import Card from '../common/Card';
import Input from '../common/Input';
import Button from '../common/Button';
import type { Experiment, ModelRegisterRequest } from '../../types/model';
import { getPrimaryMetric } from '../../utils/formatters';

export interface ExperimentListProps {
  experiments: Experiment[];
  onRegister: (data: ModelRegisterRequest) => Promise<boolean>;
  loading?: boolean;
}

export const ExperimentList: React.FC<ExperimentListProps> = ({
  experiments,
  onRegister,
  loading = false,
}) => {
  const [modelName, setModelName] = useState('');
  const [experimentId, setExperimentId] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modelName.trim() || !experimentId) return;

    const success = await onRegister({
      name: modelName.trim(),
      experiment_id: Number(experimentId),
    });

    if (success) {
      setModelName('');
      setExperimentId('');
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-100 dark:border-[#262626]">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400">
            <Box size={20} />
          </div>
          <div>
            <h2 className="font-bold text-slate-900 dark:text-white text-base">Register Model</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Promote a verified training experiment into the versioned model registry.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
              Model Name <span className="text-red-500">*</span>
            </label>
            <Input
              value={modelName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setModelName(e.target.value)}
              required
              placeholder="e.g. churn_classifier_v1"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
              Source Experiment <span className="text-red-500">*</span>
            </label>
            <select
              value={experimentId}
              onChange={(e) => setExperimentId(e.target.value)}
              required
              className="w-full rounded-xl border border-slate-200 dark:border-[#262626] bg-white dark:bg-[#151515] px-3.5 py-2.5 text-xs text-slate-800 dark:text-slate-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 transition-all"
            >
              <option value="">-- Select experiment --</option>
              {experiments.map((experiment) => {
                const metricInfo = getPrimaryMetric(experiment);
                const metricLabel = !metricInfo.isUnavailable
                  ? ` • ${metricInfo.name}: ${metricInfo.value}`
                  : '';
                return (
                  <option key={experiment.id} value={experiment.id}>
                    {experiment.name ||
                      experiment.experiment_name ||
                      `Experiment #${experiment.id}`}
                    {experiment.algorithm
                      ? ` (${experiment.algorithm}${metricLabel})`
                      : metricLabel
                      ? ` (${metricLabel.slice(3)})`
                      : ''}
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        <div className="flex justify-end mt-6">
          <Button
            type="submit"
            loading={loading}
            disabled={!modelName.trim() || !experimentId || experiments.length === 0}
          >
            <Plus size={16} className="mr-1.5" />
            {loading ? 'Registering...' : 'Register Model'}
          </Button>
        </div>
      </form>
    </Card>
  );
};

export default ExperimentList;
