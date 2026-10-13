import React from 'react';
import { Rocket, Box, Activity } from 'lucide-react';
import Card from '../components/common/Card';
import DeploymentSelector from '../components/prediction/DeploymentSelector';
import PredictionForm from '../components/prediction/PredictionForm';
import {
  PredictionResultCard,
  PredictionHistory,
} from '../components/prediction/PredictionHistory';
import { usePrediction } from '../hooks/usePrediction';

export const PredictPage: React.FC = () => {
  const {
    deployments,
    selectedDeploy,
    setSelectedDeploy,
    selectedDeployment,
    features,
    prediction,
    predictionHistory,
    loadingDeployments,
    loadingSchema,
    predicting,
    featureList,
    featureNames,
    handleFeatureChange,
    runPrediction,
    refreshDeployments,
    clearHistory,
  } = usePrediction();

  const deploymentStatus = selectedDeployment?.status || 'Active';

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-blue-600 mb-1">
            Model Inference
          </p>
          <h1 className="text-3xl font-bold text-slate-900">Predictions</h1>
          <p className="text-slate-500 mt-1">
            Send input data to a deployed model and view its prediction.
          </p>
        </div>

        <button
          type="button"
          onClick={refreshDeployments}
          disabled={loadingDeployments}
          className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
        >
          {loadingDeployments ? 'Refreshing...' : 'Refresh Endpoints'}
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">Available Endpoints</p>
              <p className="text-3xl font-bold text-slate-900 mt-1">
                {deployments.length}
              </p>
              <p className="text-xs text-slate-400 mt-1">Deployed model APIs</p>
            </div>
            <div className="p-3 rounded-xl bg-blue-50 text-blue-600">
              <Rocket size={24} />
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">Selected Endpoint</p>
              <p className="text-lg font-bold text-slate-900 mt-2 truncate max-w-[180px]">
                {selectedDeploy || 'None'}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Current inference target
              </p>
            </div>
            <div className="p-3 rounded-xl bg-violet-50 text-violet-600">
              <Box size={24} />
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">Predictions This Session</p>
              <p className="text-3xl font-bold text-slate-900 mt-1">
                {predictionHistory.length}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Recent inference requests
              </p>
            </div>
            <div className="p-3 rounded-xl bg-emerald-50 text-emerald-600">
              <Activity size={24} />
            </div>
          </div>
        </Card>
      </div>

      {/* Endpoint Selection */}
      <DeploymentSelector
        deployments={deployments}
        selectedDeploy={selectedDeploy}
        onSelectDeploy={setSelectedDeploy}
        deploymentStatus={deploymentStatus}
      />

      {/* Main Prediction Area */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <PredictionForm
          selectedDeploy={selectedDeploy}
          loadingSchema={loadingSchema}
          featureList={featureList}
          featureNames={featureNames}
          features={features}
          predicting={predicting}
          onFeatureChange={handleFeatureChange}
          onSubmit={runPrediction}
        />
        <PredictionResultCard prediction={prediction} />
      </div>

      {/* Prediction History */}
      <PredictionHistory
        history={predictionHistory}
        onClearHistory={clearHistory}
      />
    </div>
  );
};

export default PredictPage;
