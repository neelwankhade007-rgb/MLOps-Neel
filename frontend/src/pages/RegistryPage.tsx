import React, { useState } from 'react';
import { Activity, Box, Rocket, RotateCw, CheckCircle2 } from 'lucide-react';
import Card from '../components/common/Card';
import Input from '../components/common/Input';
import Button from '../components/common/Button';
import Header from '../components/layout/Header';
import ExperimentList from '../components/registry/ExperimentList';
import ModelList from '../components/registry/ModelList';
import DeploymentList from '../components/registry/DeploymentList';
import { StatCardSkeleton } from '../components/common/Skeleton';
import { useModels } from '../hooks/useModels';
import { useDeployments } from '../hooks/useDeployments';

export const RegistryPage: React.FC = () => {
  const {
    experiments,
    models,
    filteredModels,
    search: modelSearch,
    setSearch: setModelSearch,
    loading: registerLoading,
    fetching: modelsFetching,
    registerModel,
    refreshModels,
    deleteModel,
    clearModels,
  } = useModels();

  const {
    filteredDeployments,
    search: deploymentSearch,
    setSearch: setDeploymentSearch,
    loading: deployLoading,
    fetching: deploymentsFetching,
    activeDeployments,
    pendingDeployments,
    deployModel,
    refreshDeployments,
    deleteDeployment,
    clearDeployments,
  } = useDeployments();

  const [selectedModel, setSelectedModel] = useState('');
  const [deploymentName, setDeploymentName] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefreshAll = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([refreshModels(), refreshDeployments()]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSelectForDeployment = (modelId: string) => {
    setSelectedModel(modelId);
    const deploySection = document.getElementById('deploy-model-form');
    if (deploySection) {
      deploySection.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleDeploySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedModel || !deploymentName.trim()) return;

    const success = await deployModel(selectedModel, {
      model_id: Number(selectedModel),
      name: deploymentName.trim(),
    });
    if (success) {
      setSelectedModel('');
      setDeploymentName('');
    }
  };

  const selectedModelObj = models.find(
    (m) => String(m.id) === String(selectedModel)
  );

  const isInitialLoading = modelsFetching || deploymentsFetching;

  return (
    <div className="max-w-[1520px] mx-auto space-y-7">
      {/* Header */}
      <Header
        category="Model Registry & Serving"
        title="Registry & Deployments"
        subtitle="Version trained model artifacts, manage lifecycle stages, and deploy endpoints for online inference."
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshAll}
            loading={isRefreshing}
            icon={<RotateCw size={14} className={isRefreshing ? 'animate-spin' : ''} />}
          >
            Refresh Registry
          </Button>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {isInitialLoading ? (
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
                    Experiments
                  </p>
                  <p className="text-3xl font-bold font-mono text-slate-900 dark:text-white mt-1">
                    {experiments.length}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">Ready for registry promotion</p>
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
                    Registered Models
                  </p>
                  <p className="text-3xl font-bold font-mono text-slate-900 dark:text-white mt-1">
                    {models.length}
                  </p>
                  <p className="text-xs text-violet-600 dark:text-violet-400 mt-1">Versioned artifacts</p>
                </div>
                <div className="p-3 rounded-2xl bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400">
                  <Box size={22} />
                </div>
              </div>
            </Card>

            <Card className="p-5 hoverable">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Active Endpoints
                  </p>
                  <p className="text-3xl font-bold font-mono text-slate-900 dark:text-white mt-1">
                    {activeDeployments}
                  </p>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">Serving predictions</p>
                </div>
                <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                  <Rocket size={22} />
                </div>
              </div>
            </Card>

            <Card className="p-5 hoverable">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Deploying / Pending
                  </p>
                  <p className="text-3xl font-bold font-mono text-slate-900 dark:text-white mt-1">
                    {pendingDeployments}
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Transitioning state</p>
                </div>
                <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400">
                  <Activity size={22} />
                </div>
              </div>
            </Card>
          </>
        )}
      </div>

      {/* Register Model */}
      <ExperimentList
        experiments={experiments}
        onRegister={registerModel}
        loading={registerLoading}
      />

      {/* Registered Models */}
      <ModelList
        models={filteredModels}
        search={modelSearch}
        onSearchChange={setModelSearch}
        onSelectForDeployment={handleSelectForDeployment}
        onDeleteModel={deleteModel}
        onClearModels={clearModels}
        loading={modelsFetching}
      />

      {/* Deploy Model Section */}
      <div id="deploy-model-form">
        <Card className="overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100 dark:border-[#262626]">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                <Rocket size={20} />
              </div>
              <div>
                <h2 className="font-bold text-slate-900 dark:text-white text-base">Deploy Model Endpoint</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Launch a high-throughput HTTP inference endpoint for online predictions.
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={handleDeploySubmit} className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
                  Target Registered Model <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-200 dark:border-[#262626] bg-white dark:bg-[#151515] px-3.5 py-2.5 text-xs text-slate-800 dark:text-slate-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 transition-all"
                >
                  <option value="">-- Select model --</option>
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name || `Model #${model.id}`}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
                  Deployment Endpoint Name <span className="text-red-500">*</span>
                </label>
                <Input
                  value={deploymentName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDeploymentName(e.target.value)}
                  required
                  placeholder="e.g. churn-prod-v1"
                />
              </div>
            </div>

            {selectedModel && (
              <div className="mt-5 rounded-xl border border-emerald-100 dark:border-emerald-900/40 bg-emerald-50/60 dark:bg-emerald-950/20 p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 size={18} />
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                      Model Selected For Serving
                    </p>
                    <p className="text-xs text-slate-700 dark:text-slate-300 mt-0.5">
                      {selectedModelObj?.name || `Model #${selectedModel}`} will be loaded into active serving memory.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end mt-6">
              <Button
                type="submit"
                loading={deployLoading}
                disabled={deployLoading || models.length === 0 || !selectedModel || !deploymentName.trim()}
              >
                <Rocket size={15} className="mr-1.5" />
                {deployLoading ? 'Deploying to Cluster...' : 'Deploy Serving Endpoint'}
              </Button>
            </div>
          </form>
        </Card>
      </div>

      {/* Deployments List */}
      <DeploymentList
        deployments={filteredDeployments}
        models={models}
        search={deploymentSearch}
        onSearchChange={setDeploymentSearch}
        onDeleteDeployment={deleteDeployment}
        onClearDeployments={clearDeployments}
        loading={deploymentsFetching}
      />
    </div>
  );
};

export default RegistryPage;
