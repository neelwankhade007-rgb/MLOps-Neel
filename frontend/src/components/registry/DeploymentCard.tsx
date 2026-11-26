import React, { useState } from 'react';
import { Rocket, Trash2 } from 'lucide-react';
import Card from '../common/Card';
import ConfirmDialog from '../common/ConfirmDialog';
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
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const status = deployment.status || 'Active';
  const model = models.find((m) => String(m.id) === String(deployment.model_id));

  return (
    <>
      <Card className="p-5 hoverable">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          {/* Deployment identity */}
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
              <Rocket size={20} />
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-bold text-slate-900 dark:text-white text-base">
                  {deployment.name || `Deployment #${deployment.id ?? index + 1}`}
                </h3>
                <span
                  className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${getStatusStyle(
                    status
                  )}`}
                >
                  {getStatusLabel(status)}
                </span>
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Source Model:{' '}
                <strong className="font-semibold text-slate-800 dark:text-slate-200">
                  {model?.name
                    ? model.name
                    : deployment.model_id
                    ? `Model #${deployment.model_id}`
                    : 'Not specified'}
                </strong>
              </p>
            </div>
          </div>

          {/* Deployment details & Action */}
          <div className="flex items-center justify-between lg:justify-end gap-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-2 text-xs">
              <div>
                <p className="text-slate-400 uppercase tracking-wider text-[10px]">Deployment ID</p>
                <p className="font-mono font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                  #{deployment.id ?? '—'}
                </p>
              </div>

              <div>
                <p className="text-slate-400 uppercase tracking-wider text-[10px]">Model ID</p>
                <p className="font-mono font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                  {deployment.model_id ? `#${deployment.model_id}` : '—'}
                </p>
              </div>

              <div>
                <p className="text-slate-400 uppercase tracking-wider text-[10px]">Status</p>
                <p className="font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">
                  {getStatusLabel(status)}
                </p>
              </div>
            </div>

            {onDelete && deployment.id != null && (
              <button
                type="button"
                onClick={() => setShowConfirmDelete(true)}
                title="Delete deployment"
                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-xl transition-colors shrink-0"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        </div>
      </Card>

      <ConfirmDialog
        isOpen={showConfirmDelete}
        onClose={() => setShowConfirmDelete(false)}
        onConfirm={() => {
          setShowConfirmDelete(false);
          if (deployment.id != null) onDelete?.(deployment.id);
        }}
        title="Unload & Delete Deployment"
        message={`Are you sure you want to delete deployment "${deployment.name || `#${deployment.id}`}"? This will unload the serving endpoint and stop accepting predictions.`}
        confirmLabel="Delete Deployment"
        variant="danger"
      />
    </>
  );
};

export default DeploymentCard;
