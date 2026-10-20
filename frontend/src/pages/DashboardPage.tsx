import React, { useEffect, useMemo, useState } from 'react';
import { Database, BrainCircuit, Box, Rocket } from 'lucide-react';
import StatCard from '../components/dashboard/StatCard';
import TrainingActivityChart from '../components/dashboard/TrainingActivityChart';
import ModelPerformanceChart from '../components/dashboard/ModelPerformanceChart';
import DeploymentHealthChart from '../components/dashboard/DeploymentHealthChart';
import RecentActivity from '../components/dashboard/RecentActivity';
import { useTraining } from '../hooks/useTraining';
import { modelApi } from '../api/modelApi';
import { deploymentApi } from '../api/deploymentApi';
import type { RegisteredModel } from '../types/model';
import type { Deployment } from '../types/deployment';
import type { TrainingActivityItem } from '../components/dashboard/TrainingActivityChart';
import type { ModelPerformanceItem } from '../components/dashboard/ModelPerformanceChart';
import type { DeploymentHealthItem } from '../components/dashboard/DeploymentHealthChart';
import type { RecentActivityItem } from '../components/dashboard/RecentActivity';

const METRIC_LABELS: Record<string, string> = {
  accuracy: 'Accuracy', precision: 'Precision', recall: 'Recall', f1: 'F1 score',
  roc_auc: 'ROC AUC', r2_score: 'R² score', mae: 'MAE', mse: 'MSE', rmse: 'RMSE',
};

const formatActivityTime = (value?: string) => {
  if (!value) return 'Time unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString();
};

export const DashboardPage: React.FC = () => {
  const { jobs, datasets, completedJobs, runningJobs, failedJobs, legacyJobs, fetching } = useTraining();
  const [models, setModels] = useState<RegisteredModel[] | null>(null);
  const [deployments, setDeployments] = useState<Deployment[] | null>(null);

  useEffect(() => {
    modelApi.getModels().then(setModels).catch(() => setModels(null));
    deploymentApi.getDeployments().then(setDeployments).catch(() => setDeployments(null));
  }, []);

  const trainingActivity = useMemo<TrainingActivityItem[]>(() => {
    const months: TrainingActivityItem[] = [];
    const now = new Date();
    for (let offset = 5; offset >= 0; offset -= 1) {
      const month = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const key = `${month.getFullYear()}-${month.getMonth()}`;
      const count = jobs.filter((job) => {
        if (String(job.status ?? '').toLowerCase() !== 'completed' || !job.created_at) return false;
        const created = new Date(job.created_at);
        return !Number.isNaN(created.getTime()) && `${created.getFullYear()}-${created.getMonth()}` === key;
      }).length;
      months.push({ month: month.toLocaleString(undefined, { month: 'short' }), jobs: count });
    }
    return months;
  }, [jobs]);

  const latestMetrics = useMemo<ModelPerformanceItem[]>(() => {
    const latest = jobs.find((job) => String(job.status ?? '').toLowerCase() === 'completed' && job.metrics);
    if (!latest?.metrics) return [];
    return Object.entries(latest.metrics)
      .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))
      .map(([key, rawValue]) => {
        const isRate = ['accuracy', 'precision', 'recall', 'f1', 'roc_auc'].includes(key.toLowerCase());
        const value = isRate && rawValue >= 0 && rawValue <= 1 ? rawValue * 100 : rawValue;
        return { metric: METRIC_LABELS[key.toLowerCase()] || key, value, unit: isRate ? '%' : '' };
      });
  }, [jobs]);

  const deploymentHealth = useMemo<DeploymentHealthItem[]>(() => {
    if (!deployments) return [];
    const groups = new Map<string, number>();
    deployments.forEach((deployment) => {
      const status = String(deployment.status || 'unknown').toLowerCase();
      const label = status === 'active' ? 'Active' : status === 'inactive' ? 'Inactive' : status;
      groups.set(label, (groups.get(label) || 0) + 1);
    });
    return Array.from(groups, ([name, value]) => ({ name, value }));
  }, [deployments]);

  const recentActivity = useMemo<RecentActivityItem[]>(() => {
    const items: (RecentActivityItem & { sortTime: number })[] = [];
    jobs.forEach((job) => {
      if (!job.created_at) return;
      const status = String(job.status || 'unknown').toLowerCase();
      const date = new Date(job.created_at);
      items.push({
        type: status === 'failed' ? 'error' : status === 'running' || status === 'queued' ? 'warning' : 'success',
        title: `Training ${status}`,
        description: job.name || `${job.algorithm || 'Model'} · run ${job.id ?? 'unknown'}`,
        time: formatActivityTime(job.created_at), sortTime: date.getTime(),
      });
    });
    datasets.forEach((dataset) => {
      if (!dataset.uploaded_at) return;
      const date = new Date(dataset.uploaded_at);
      items.push({
        type: 'success', title: 'Dataset uploaded', description: dataset.name,
        time: formatActivityTime(dataset.uploaded_at), sortTime: date.getTime(),
      });
    });
    (deployments || []).forEach((deployment) => {
      if (!deployment.created_at) return;
      const date = new Date(deployment.created_at);
      items.push({
        type: String(deployment.status).toLowerCase() === 'active' ? 'success' : 'warning',
        title: `Deployment ${deployment.status || 'created'}`, description: deployment.name,
        time: formatActivityTime(deployment.created_at), sortTime: date.getTime(),
      });
    });
    return items.sort((a, b) => b.sortTime - a.sortTime).slice(0, 6);
  }, [jobs, datasets, deployments]);

  const datasetValue = fetching ? '…' : String(datasets.length);
  const modelValue = models ? String(models.length) : '—';
  const deploymentValue = deployments ? String(deployments.length) : '—';

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-7">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard Overview</h1>
        <p className="text-slate-500 text-sm mt-1">Monitor your machine learning lifecycle from data to deployment.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        <StatCard label="Datasets" value={datasetValue} subtext="Available for training" icon={Database} iconBgColor="bg-blue-100" iconColor="text-blue-600" />
        <StatCard label="Training Jobs" value={fetching ? '…' : String(jobs.length)} subtext={`${completedJobs} completed, ${failedJobs} failed${runningJobs > 0 ? `, ${runningJobs} running` : ''}${legacyJobs > 0 ? ` (${legacyJobs} legacy)` : ''}`} icon={BrainCircuit} iconBgColor="bg-purple-100" iconColor="text-purple-600" />
        <StatCard label="Registered Models" value={modelValue} subtext="Available in registry" subtextColor="text-indigo-600" icon={Box} iconBgColor="bg-indigo-100" iconColor="text-indigo-600" />
        <StatCard label="Deployments" value={deploymentValue} subtext="Deployment records" icon={Rocket} iconBgColor="bg-green-100" iconColor="text-green-600" />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <TrainingActivityChart data={trainingActivity} loading={fetching} />
        <ModelPerformanceChart data={latestMetrics} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <DeploymentHealthChart data={deploymentHealth} loading={deployments === null} />
        <RecentActivity activities={recentActivity} />
      </div>
    </div>
  );
};

export default DashboardPage;
