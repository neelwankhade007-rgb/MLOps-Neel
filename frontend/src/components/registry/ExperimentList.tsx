import React, { useState } from 'react';
import { Box, CheckCircle2, Plus } from 'lucide-react';
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
    const success = await onRegister({
      name: modelName,
      experiment_id: Number(experimentId),
    });

    if (success) {
      setModelName('');
      setExperimentId('');
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-violet-50 text-violet-600">
            <Box size={22} />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900">Register Model</h2>
            <p className="text-sm text-slate-500">
              Add a trained experiment result to the model registry.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Model Name
            </label>
            <Input
              value={modelName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setModelName(e.target.value)}
              required
              placeholder="e.g. customer_churn_model"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Source Experiment
            </label>
            <select
              value={experimentId}
              onChange={e => setExperimentId(e.target.value)}
              required
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              <option value="">Select experiment</option>
              {experiments.map(experiment => {
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

        <div className="mt-5 rounded-xl border border-violet-100 bg-violet-50 p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={20} className="text-violet-600 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-violet-900">
                Model lifecycle
              </p>
              <p className="text-xs text-violet-700 mt-1">
                A trained experiment can be registered as a model and then selected
                for deployment.
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-end mt-6">
          <Button type="submit" disabled={loading}>
            <Plus size={18} className="mr-2" />
            {loading ? 'Registering...' : 'Register Model'}
          </Button>
        </div>
      </form>
    </Card>
  );
};

export default ExperimentList;
