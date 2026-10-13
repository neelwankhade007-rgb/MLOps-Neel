import React from 'react';
import { Box, Rocket, Trash2 } from 'lucide-react';
import Card from '../common/Card';
import type { RegisteredModel } from '../../types/model';
import { getStatusStyle, getStatusLabel } from '../../utils/formatters';

export interface ModelListProps {
  models: RegisteredModel[];
  search: string;
  onSearchChange: (value: string) => void;
  onSelectForDeployment: (modelId: string) => void;
  onDeleteModel?: (id: number) => void;
  onClearModels?: () => void;
}

export const ModelList: React.FC<ModelListProps> = ({
  models,
  search,
  onSearchChange,
  onSelectForDeployment,
  onDeleteModel,
  onClearModels,
}) => {
  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Registered Models</h2>
          <p className="text-sm text-slate-500">
            Models available for deployment.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <input
            type="text"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search models..."
            className="w-full md:w-80 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          {onClearModels && models.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Are you sure you want to clear all registered models? This will also remove any active deployments of these models.')) {
                  onClearModels();
                }
              }}
              className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-xl border border-red-200 transition-colors shrink-0"
              title="Clear all registered models"
            >
              <Trash2 size={15} />
              <span>Clear All</span>
            </button>
          )}
        </div>
      </div>

      {models.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {models.map(model => {
            const status = model.status || 'Registered';

            return (
              <Card
                key={model.id}
                className="p-5 hover:shadow-lg hover:-translate-y-0.5 transition-all"
              >
                <div className="flex items-start justify-between">
                  <div className="p-3 rounded-xl bg-violet-50 text-violet-600">
                    <Box size={22} />
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-medium px-2.5 py-1 rounded-full ${getStatusStyle(
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
                          if (window.confirm(`Are you sure you want to delete registered model "${model.name || `#${model.id}`}"? This will also remove any deployments of this model.`)) {
                            onDeleteModel(model.id);
                          }
                        }}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete registered model"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-5">
                  <h3 className="text-lg font-semibold text-slate-900 truncate">
                    {model.name || `Model #${model.id}`}
                  </h3>
                  <p className="text-sm text-slate-500 mt-1">Registered Model</p>
                </div>

                <div className="mt-5 pt-4 border-t border-slate-100 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Model ID</span>
                    <span className="font-semibold text-slate-700">
                      #{model.id}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Experiment</span>
                    <span className="font-semibold text-slate-700">
                      {model.experiment_id ? `#${model.experiment_id}` : '—'}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onSelectForDeployment(String(model.id))}
                  className="w-full mt-5 flex items-center justify-center gap-2 rounded-xl bg-slate-900 text-white py-2.5 text-sm font-medium hover:bg-slate-800 transition"
                >
                  <Rocket size={16} />
                  Select for Deployment
                </button>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="p-12 text-center">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400">
            <Box size={30} />
          </div>

          <h3 className="mt-5 text-lg font-semibold text-slate-800">
            {search ? 'No models found' : 'No registered models yet'}
          </h3>

          <p className="mt-2 text-sm text-slate-500 max-w-md mx-auto">
            {search
              ? 'Try a different search term.'
              : 'Register a trained experiment above to make it available for deployment.'}
          </p>
        </Card>
      )}
    </div>
  );
};

export default ModelList;
