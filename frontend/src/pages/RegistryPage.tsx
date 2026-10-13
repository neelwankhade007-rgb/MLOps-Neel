import React, { useState } from 'react';
import { Activity, Box, Rocket } from 'lucide-react';
import Card from '../components/common/Card';
import Input from '../components/common/Input';
import Button from '../components/common/Button';
import ExperimentList from '../components/registry/ExperimentList';
import ModelList from '../components/registry/ModelList';
import DeploymentList from '../components/registry/DeploymentList';
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
    activeDeployments,
    pendingDeployments,
    deployModel,
    refreshDeployments,
    deleteDeployment,
    clearDeployments,
  } = useDeployments();

  const [selectedModel, setSelectedModel] = useState('');
  const [deploymentName, setDeploymentName] = useState('');

  const handleRefreshAll = async () => {
    await Promise.all([refreshModels(), refreshDeployments()]);
  };

  const handleSelectForDeployment = (modelId: string) => {
    setSelectedModel(modelId);
    window.scrollTo({
      top: document.body.scrollHeight,
      behavior: 'smooth',
    });
  };

  const handleDeploySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const success = await deployModel(selectedModel, {
      model_id: Number(selectedModel),
      name: deploymentName,
    });
    if (success) {
      setSelectedModel('');
      setDeploymentName('');
    }
  };

  const selectedModelObj = models.find(
    m => String(m.id) === String(selectedModel)
  );

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-blue-600 mb-1">
            Model Lifecycle
          </p>
          <h1 className="text-3xl font-bold text-slate-900">
            Registry & Deploy
          </h1>
          <p className="text-slate-500 mt-1">
            Register trained models and deploy selected versions as APIs.
          </p>
        </div>

        <button
          type="button"
          onClick={handleRefreshAll}
          className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
        >
          Refresh Registry
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">Experiments</p>
              <p className="text-3xl font-bold text-slate-900 mt-1">
                {experiments.length}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Training experiments
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
              <p className="text-sm text-slate-500">Registered Models</p>
              <p className="text-3xl font-bold text-slate-900 mt-1">
                {models.length}
              </p>
              <p className="text-xs text-slate-400 mt-1">Models in registry</p>
            </div>
            <div className="p-3 rounded-xl bg-violet-50 text-violet-600">
              <Box size={24} />
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">Active Deployments</p>
              <p className="text-3xl font-bold text-slate-900 mt-1">
                {activeDeployments}
              </p>
              <p className="text-xs text-slate-400 mt-1">Serving model APIs</p>
            </div>
            <div className="p-3 rounded-xl bg-emerald-50 text-emerald-600">
              <Rocket size={24} />
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">Deploying</p>
              <p className="text-3xl font-bold text-slate-900 mt-1">
                {pendingDeployments}
              </p>
              <p className="text-xs text-slate-400 mt-1">Pending deployments</p>
            </div>
            <div className="p-3 rounded-xl bg-amber-50 text-amber-600">
              <Activity size={24} />
            </div>
          </div>
        </Card>
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
      />

      {/* Deployment Section */}
      <Card className="overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600">
              <Rocket size={22} />
            </div>
            <div>
              <h2 className="font-semibold text-slate-900">Deploy Model</h2>
              <p className="text-sm text-slate-500">
                Create a serving endpoint for a registered model.
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleDeploySubmit} className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Registered Model
              </label>
              <select
                value={selectedModel}
                onChange={e => setSelectedModel(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                <option value="">Select model</option>
                {models.map(model => (
                  <option key={model.id} value={model.id}>
                    {model.name || `Model #${model.id}`}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Deployment Name
              </label>
              <Input
                value={deploymentName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDeploymentName(e.target.value)}
                required
                placeholder="e.g. churn-api-prod"
              />
            </div>
          </div>

          {selectedModel && (
            <div className="mt-5 rounded-xl border border-emerald-100 bg-emerald-50 p-4">
              <div className="flex items-center gap-3">
                <Rocket size={20} className="text-emerald-600" />
                <div>
                  <p className="text-sm font-medium text-emerald-900">
                    Model selected for deployment
                  </p>
                  <p className="text-xs text-emerald-700 mt-1">
                    {selectedModelObj?.name || `Model #${selectedModel}`}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end mt-6">
            <Button
              type="submit"
              disabled={deployLoading || models.length === 0}
            >
              <Rocket size={18} className="mr-2" />
              {deployLoading ? 'Deploying...' : 'Deploy Model'}
            </Button>
          </div>
        </form>
      </Card>

      {/* Deployments */}
      <DeploymentList
        deployments={filteredDeployments}
        models={models}
        search={deploymentSearch}
        onSearchChange={setDeploymentSearch}
        onDeleteDeployment={deleteDeployment}
        onClearDeployments={clearDeployments}
      />
    </div>
  );
};

export default RegistryPage;
