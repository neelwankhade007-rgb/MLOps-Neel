import React from 'react';
import { Rocket, Trash2 } from 'lucide-react';
import Card from '../common/Card';
import type { Deployment } from '../../types/deployment';
import type { RegisteredModel } from '../../types/model';
import { getStatusStyle, getStatusLabel } from '../../utils/formatters';

export interface DeploymentCardProps {
  deployment: Deployment;
  index: number;
  models: RegisteredModel[];
  onDelete?: (id: number) => void;
}

export const DeploymentCard: React.FC<DeploymentCardProps> = ({
  deployment,
  index,
  models,
  onDelete,
}) => {
  const status = deployment.status || 'Unknown';
  const model = models.find(m => String(m.id) === String(deployment.model_id));

  return (
    <Card className="p-5 hover:shadow-md transition-shadow">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
        {/* Deployment identity */}
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl bg-emerald-50 text-emerald-600">
            <Rocket size={22} />
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-slate-900">
                {deployment.name || `Deployment #${deployment.id ?? index + 1}`}
              </h3>
              <span
                className={`text-xs font-medium px-2.5 py-1 rounded-full ${getStatusStyle(
                  status
                )}`}
              >
                {getStatusLabel(status)}
              </span>
            </div>

            <p className="text-sm text-slate-500 mt-1">
              {model?.name
                ? model.name
                : deployment.model_id
                ? `Model #${deployment.model_id}`
                : 'Model not specified'}
            </p>
          </div>
        </div>

        {/* Deployment details & Action */}
        <div className="flex items-center justify-between lg:justify-end gap-6">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-3 text-sm">
            <div>
              <p className="text-xs text-slate-400">Deployment ID</p>
              <p className="font-medium text-slate-700 mt-1">
                #{deployment.id ?? '—'}
              </p>
            </div>

            <div>
              <p className="text-xs text-slate-400">Model ID</p>
              <p className="font-medium text-slate-700 mt-1">
                {deployment.model_id ? `#${deployment.model_id}` : '—'}
              </p>
            </div>

            <div>
              <p className="text-xs text-slate-400">Status</p>
              <p className="font-medium text-slate-700 mt-1">
                {getStatusLabel(status)}
              </p>
            </div>
          </div>

          {onDelete && deployment.id != null && (
            <button
              type="button"
              onClick={() => {
                const id = deployment.id;
                if (id != null && window.confirm(`Are you sure you want to delete deployment "${deployment.name || `#${id}`}"? This will unload the model from memory and stop serving predictions.`)) {
                  onDelete(id);
                }
              }}
              title="Delete deployment"
              className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors shrink-0"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>
    </Card>
  );
};

export default DeploymentCard;
