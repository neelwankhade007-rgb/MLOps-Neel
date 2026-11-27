import React, { useState } from 'react';
import { BrainCircuit, CheckCircle2, Play, Sparkles } from 'lucide-react';
import Card from '../common/Card';
import Input from '../common/Input';
import Button from '../common/Button';
import type { Dataset } from '../../types/dataset';
import type { TrainingRequest } from '../../types/training';

export interface TrainingConfigProps {
  datasets: Dataset[];
  onSubmit: (config: TrainingRequest) => Promise<boolean>;
  loading?: boolean;
}

export const TrainingConfig: React.FC<TrainingConfigProps> = ({
  datasets,
  onSubmit,
  loading = false,
}) => {
  const [selectedDataset, setSelectedDataset] = useState('');
  const [targetCol, setTargetCol] = useState('');
  const [algorithm, setAlgorithm] = useState('Random Forest');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDataset || !targetCol.trim()) return;

    const success = await onSubmit({
      dataset_id: Number(selectedDataset),
      target_column: targetCol.trim(),
      algorithm,
    });

    if (success) {
      setSelectedDataset('');
      setTargetCol('');
      setAlgorithm('Random Forest');
    }
  };

  const selectedDatasetObj = datasets.find(
    (d) => String(d.id) === String(selectedDataset)
  );

  return (
    <Card className="overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-100 dark:border-[#262626]">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
            <BrainCircuit size={20} />
          </div>
          <div>
            <h2 className="font-bold text-slate-900 dark:text-white text-base">
              Configure & Launch Training
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Select a dataset, specify the ground-truth prediction target, and choose an ML algorithm.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Dataset */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
              Source Dataset <span className="text-red-500">*</span>
            </label>
            <select
              value={selectedDataset}
              onChange={(e) => setSelectedDataset(e.target.value)}
              required
              className="w-full rounded-xl border border-slate-200 dark:border-[#262626] bg-white dark:bg-[#151515] px-3.5 py-2.5 text-xs text-slate-800 dark:text-slate-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 transition-all"
            >
              <option value="">-- Select dataset --</option>
              {datasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.name} (#{dataset.id})
                </option>
              ))}
            </select>
            {datasets.length === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5 flex items-center gap-1">
                <span>Upload a dataset in Datasets before starting training.</span>
              </p>
            )}
          </div>

          {/* Target Column */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
              Target Column <span className="text-red-500">*</span>
            </label>
            <Input
              value={targetCol}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTargetCol(e.target.value)}
              required
              placeholder="e.g. Survived, Churn, Price"
            />
            <p className="text-[11px] text-slate-400 mt-1.5">
              Exact column name the model will predict.
            </p>
          </div>

          {/* Algorithm */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
              Model Algorithm <span className="text-red-500">*</span>
            </label>
            <select
              value={algorithm}
              onChange={(e) => setAlgorithm(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-[#262626] bg-white dark:bg-[#151515] px-3.5 py-2.5 text-xs text-slate-800 dark:text-slate-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 transition-all"
            >
              <option value="Random Forest">Random Forest (Ensemble Trees)</option>
              <option value="Logistic Regression">Logistic Regression (Linear Classifier)</option>
              <option value="XGBoost">XGBoost (Gradient Boosted Trees)</option>
            </select>
          </div>
        </div>

        {/* Selected configuration preview */}
        {selectedDataset && (
          <div className="mt-5 rounded-xl border border-indigo-100 dark:border-indigo-900/40 bg-indigo-50/60 dark:bg-indigo-950/20 p-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">
                  <Sparkles size={16} />
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                    Training Execution Plan
                  </p>
                  <p className="text-xs text-slate-700 dark:text-slate-300 mt-1">
                    Dataset: <strong className="font-semibold text-slate-900 dark:text-white">{selectedDatasetObj?.name || `#${selectedDataset}`}</strong> • Target: <strong className="font-semibold text-slate-900 dark:text-white">{targetCol || '(pending)'}</strong> • Algorithm: <strong className="font-semibold text-slate-900 dark:text-white">{algorithm}</strong>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
                <CheckCircle2 size={16} />
                <span>Ready to train</span>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end mt-6">
          <Button
            type="submit"
            loading={loading}
            disabled={datasets.length === 0 || !selectedDataset || !targetCol.trim()}
          >
            <Play size={15} className="mr-2 fill-current" />
            {loading ? 'Executing ML Pipeline...' : 'Start Training Job'}
          </Button>
        </div>
      </form>
    </Card>
  );
};

export default TrainingConfig;
