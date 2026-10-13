import React from 'react';
import { Rocket, Trash2 } from 'lucide-react';
import Card from '../common/Card';
import DeploymentCard from './DeploymentCard';
import type { Deployment } from '../../types/deployment';
import type { RegisteredModel } from '../../types/model';

export interface DeploymentListProps {
  deployments: Deployment[];
  models: RegisteredModel[];
  search: string;
  onSearchChange: (value: string) => void;
  onDeleteDeployment?: (id: number) => void;
  onClearDeployments?: () => void;
}

export const DeploymentList: React.FC<DeploymentListProps> = ({
  deployments,
  models,
  search,
  onSearchChange,
  onDeleteDeployment,
  onClearDeployments,
}) => {
  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Active Deployments</h2>
          <p className="text-sm text-slate-500">
            Model endpoints currently managed by the platform.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <input
            type="text"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search deployments..."
            className="w-full md:w-80 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          {onClearDeployments && deployments.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Are you sure you want to clear all deployments? This will unload all models and stop serving predictions.')) {
                  onClearDeployments();
                }
              }}
              className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-xl border border-red-200 transition-colors shrink-0"
              title="Clear all deployments"
            >
              <Trash2 size={15} />
              <span>Clear All</span>
            </button>
          )}
        </div>
      </div>

      {deployments.length > 0 ? (
        <div className="space-y-4">
          {deployments.map((deployment, index) => (
            <DeploymentCard
              key={deployment.id ?? index}
              deployment={deployment}
              index={index}
              models={models}
              onDelete={onDeleteDeployment}
            />
          ))}
        </div>
      ) : (
        <Card className="p-12 text-center">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400">
            <Rocket size={30} />
          </div>

          <h3 className="mt-5 text-lg font-semibold text-slate-800">
            {search ? 'No deployments found' : 'No deployments yet'}
          </h3>

          <p className="mt-2 text-sm text-slate-500 max-w-md mx-auto">
            {search
              ? 'Try a different search term.'
              : 'Select a registered model and deploy it to create a prediction endpoint.'}
          </p>
        </Card>
      )}
    </div>
  );
};

export default DeploymentList;
