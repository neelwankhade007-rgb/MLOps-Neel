import React from 'react';
import { Rocket, Box, Activity, RotateCw } from 'lucide-react';
import Card from '../components/common/Card';
import Header from '../components/layout/Header';
import Button from '../components/common/Button';
import DeploymentSelector from '../components/prediction/DeploymentSelector';
import PredictionForm from '../components/prediction/PredictionForm';
import {
  PredictionResultCard,
  PredictionHistory,
} from '../components/prediction/PredictionHistory';
import { StatCardSkeleton } from '../components/common/Skeleton';
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
    <div className="max-w-[1520px] mx-auto space-y-7">
      {/* Header */}
      <Header
        category="Model Inference"
        title="Live Prediction Studio"
        subtitle="Test deployed models in real time by dispatching feature payloads to active cluster endpoints."
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={refreshDeployments}
            loading={loadingDeployments}
            icon={<RotateCw size={14} className={loadingDeployments ? 'animate-spin' : ''} />}
          >
            Refresh Endpoints
          </Button>
        }
      />

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        {loadingDeployments ? (
          <>
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
                    Active Endpoints
                  </p>
                  <p className="text-3xl font-bold font-mono text-slate-900 dark:text-white mt-1">
                    {deployments.length}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">Ready for requests</p>
                </div>
                <div className="p-3 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
                  <Rocket size={22} />
                </div>
              </div>
            </Card>

            <Card className="p-5 hoverable">
              <div className="flex items-center justify-between">
                <div className="min-w-0 pr-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Selected Model
                  </p>
                  <p className="text-lg font-bold font-mono text-slate-900 dark:text-white mt-1.5 truncate">
                    {selectedDeploy || 'None'}
                  </p>
                  <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">Inference target</p>
                </div>
                <div className="p-3 rounded-2xl bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400 shrink-0">
                  <Box size={22} />
                </div>
              </div>
            </Card>

            <Card className="p-5 hoverable">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Session Inferences
                  </p>
                  <p className="text-3xl font-bold font-mono text-slate-900 dark:text-white mt-1">
                    {predictionHistory.length}
                  </p>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">Executed queries</p>
                </div>
                <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                  <Activity size={22} />
                </div>
              </div>
            </Card>
          </>
        )}
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
