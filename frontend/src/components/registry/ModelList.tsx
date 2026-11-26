import React, { useState } from 'react';
import { Box, Rocket, Trash2, Search } from 'lucide-react';
import Card from '../common/Card';
import ConfirmDialog from '../common/ConfirmDialog';
import { ListCardSkeleton } from '../common/Skeleton';
import type { RegisteredModel } from '../../types/model';
import { getStatusStyle, getStatusLabel } from '../../utils/formatters';

export interface ModelListProps {
  models: RegisteredModel[];
  search: string;
  onSearchChange: (value: string) => void;
  onSelectForDeployment: (modelId: string) => void;
  onDeleteModel?: (id: number) => void;
  onClearModels?: () => void;
  loading?: boolean;
}

export const ModelList: React.FC<ModelListProps> = ({
  models,
  search,
  onSearchChange,
  onSelectForDeployment,
  onDeleteModel,
  onClearModels,
  loading = false,
}) => {
  const [modelToDelete, setModelToDelete] = useState<RegisteredModel | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Registered Models</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Versioned model artifacts available for deployment and serving
            </p>
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto">
            <div className="relative w-full md:w-80">
              <Search
                size={15}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search models..."
                className="w-full rounded-xl border border-slate-200 dark:border-[#262626] bg-white dark:bg-[#151515] pl-9 pr-4 py-2 text-xs text-slate-800 dark:text-slate-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 transition-all"
              />
            </div>

            {onClearModels && models.length > 0 && (
              <button
                type="button"
                onClick={() => setShowClearConfirm(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-xl border border-red-200 dark:border-red-900/50 transition-colors shrink-0"
                title="Clear all registered models"
              >
                <Trash2 size={13} />
                <span>Clear All</span>
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            <ListCardSkeleton />
            <ListCardSkeleton />
          </div>
        ) : models.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {models.map((model) => {
              const status = model.status || 'Registered';

              return (
                <Card
                  key={model.id}
                  className="p-5 hoverable flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between">
                      <div className="p-3 rounded-2xl bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400">
                        <Box size={20} />
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${getStatusStyle(
                            status
                          )}`}
                        >
                          {getStatusLabel(status)}
                        </span>
                        {onDeleteModel && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setModelToDelete(model);
                            }}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition-colors"
                            title="Delete registered model"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-4">
                      <h3 className="text-base font-bold text-slate-900 dark:text-white truncate" title={model.name}>
                        {model.name || `Model #${model.id}`}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">MLflow Registered Artifact</p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 dark:border-[#262626] space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">Model ID</span>
                        <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                          #{model.id}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">Source Experiment</span>
                        <span className="font-mono text-slate-600 dark:text-slate-400">
                          {model.experiment_id ? `#${model.experiment_id}` : '—'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onSelectForDeployment(String(model.id))}
                    className="w-full mt-5 flex items-center justify-center gap-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white py-2.5 text-xs font-semibold shadow-xs transition-all active:scale-[0.98]"
                  >
                    <Rocket size={14} />
                    <span>Select for Deployment</span>
                  </button>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card className="p-12 text-center">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-violet-50 dark:bg-violet-950/40 flex items-center justify-center text-violet-600 dark:text-violet-400">
              <Box size={26} />
            </div>

            <h3 className="mt-4 text-base font-bold text-slate-800 dark:text-slate-200">
              {search ? 'No models match filter' : 'No registered models yet'}
            </h3>

            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
              {search
                ? `No model matches "${search}". Clear search to view all.`
                : 'Promote a completed experiment above to register it for serving.'}
            </p>
          </Card>
        )}
      </div>

      {/* Non-blocking Accessible Confirmation Modals */}
      <ConfirmDialog
        isOpen={Boolean(modelToDelete)}
        onClose={() => setModelToDelete(null)}
        onConfirm={() => {
          if (modelToDelete) {
            onDeleteModel?.(modelToDelete.id);
            setModelToDelete(null);
          }
        }}
        title="Delete Registered Model"
        message={`Are you sure you want to delete model "${modelToDelete?.name || `#${modelToDelete?.id}`}"? Active deployments of this model will also be impacted.`}
        confirmLabel="Delete Model"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={() => {
          setShowClearConfirm(false);
          onClearModels?.();
        }}
        title="Clear All Models"
        message="Are you sure you want to delete all registered models? This will remove all registry entries and active serving endpoints."
        confirmLabel="Clear All Models"
        variant="danger"
      />
    </>
  );
};

export default ModelList;
