import React, { useState, useEffect } from 'react';
import {
  Database,
  BrainCircuit,
  Box,
  Rocket,
  Server,
  CheckCircle2,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import Card from '../components/common/Card';
import StatCard from '../components/dashboard/StatCard';
import TrainingActivityChart from '../components/dashboard/TrainingActivityChart';
import ModelPerformanceChart from '../components/dashboard/ModelPerformanceChart';
import DeploymentHealthChart from '../components/dashboard/DeploymentHealthChart';
import RecentActivity from '../components/dashboard/RecentActivity';
import { useTraining } from '../hooks/useTraining';
import { datasetApi } from '../api/datasetApi';
import { modelApi } from '../api/modelApi';
import { deploymentApi } from '../api/deploymentApi';

export const DashboardPage: React.FC = () => {
  const { jobs, completedJobs, runningJobs, failedJobs, legacyJobs } = useTraining();
  const [datasetCount, setDatasetCount] = useState<number | null>(null);
  const [modelCount, setModelCount] = useState<number | null>(null);
  const [deploymentCount, setDeploymentCount] = useState<number | null>(null);

  useEffect(() => {
    datasetApi.getDatasets().then(d => setDatasetCount(d.length)).catch(() => {});
    modelApi.getModels().then(m => setModelCount(m.length)).catch(() => {});
    deploymentApi.getDeployments().then(dep => setDeploymentCount(dep.length)).catch(() => {});
  }, []);

  const activeDeployments = [
    {
      name: 'Customer Churn',
      version: 'v3',
      status: 'Healthy',
      latency: '32 ms',
    },
    {
      name: 'Fraud Detection',
      version: 'v2',
      status: 'Healthy',
      latency: '41 ms',
    },
    {
      name: 'House Prices',
      version: 'v1',
      status: 'Warning',
      latency: '78 ms',
    },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Dashboard Overview
        </h1>
        <p className="text-slate-500 text-sm mt-1">
          Monitor your machine learning lifecycle from data to deployment.
        </p>
      </div>

      {/* Statistic Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard
          label="Datasets"
          value={datasetCount != null ? String(datasetCount) : '—'}
          subtext="Available for training"
          icon={Database}
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        />

        <StatCard
          label="Training Jobs"
          value={String(jobs.length)}
          subtext={`${completedJobs} completed, ${failedJobs} failed${runningJobs > 0 ? `, ${runningJobs} running` : ''}${legacyJobs > 0 ? ` (${legacyJobs} legacy)` : ''}`}
          icon={BrainCircuit}
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        />

        <StatCard
          label="Registered Models"
          value={modelCount != null ? String(modelCount) : '—'}
          subtext="Available in registry"
          subtextColor="text-indigo-600"
          icon={Box}
          iconBgColor="bg-indigo-100"
          iconColor="text-indigo-600"
        />

        <StatCard
          label="Deployments"
          value={deploymentCount != null ? String(deploymentCount) : '—'}
          subtext="Active model endpoints"
          icon={Rocket}
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TrainingActivityChart />
        <ModelPerformanceChart />
      </div>

      {/* Deployment Health + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <DeploymentHealthChart />
        <RecentActivity />
      </div>

      {/* Active Deployments */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Active Deployments
            </h2>
            <p className="text-sm text-slate-500">
              Currently running model endpoints
            </p>
          </div>
          <Server size={20} className="text-indigo-600" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {activeDeployments.map((deployment, index) => (
            <div key={index} className="border border-slate-200 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-slate-900">
                    {deployment.name}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Model {deployment.version}
                  </p>
                </div>

                <div
                  className={`flex items-center gap-1 text-xs font-medium ${
                    deployment.status === 'Healthy'
                      ? 'text-green-600'
                      : 'text-amber-600'
                  }`}
                >
                  {deployment.status === 'Healthy' ? (
                    <CheckCircle2 size={15} />
                  ) : (
                    <AlertTriangle size={15} />
                  )}
                  {deployment.status}
                </div>
              </div>

              <div className="flex items-center gap-2 mt-4 text-xs text-slate-500">
                <Clock size={14} />
                Latency: {deployment.latency}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

export default DashboardPage;
