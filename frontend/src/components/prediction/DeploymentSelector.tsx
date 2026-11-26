import React from 'react';
import { Rocket } from 'lucide-react';
import Card from '../common/Card';
import type { Deployment } from '../../types/deployment';
import { getStatusStyle, getStatusLabel } from '../../utils/formatters';

export interface DeploymentSelectorProps {
  deployments: Deployment[];
  selectedDeploy: string;
  onSelectDeploy: (name: string) => void;
  deploymentStatus: string;
}

export const DeploymentSelector: React.FC<DeploymentSelectorProps> = ({
  deployments,
  selectedDeploy,
  onSelectDeploy,
  deploymentStatus,
}) => {
  return (
    <Card className="overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-100 dark:border-[#262626]">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
            <Rocket size={20} />
          </div>
          <div>
            <h2 className="font-bold text-slate-900 dark:text-white text-base">Select Deployment Target</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Choose the active model serving endpoint to query with input features.
            </p>
          </div>
        </div>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
              Inference Endpoint
            </label>
            <select
              value={selectedDeploy}
              onChange={(e) => onSelectDeploy(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-[#262626] bg-white dark:bg-[#151515] px-3.5 py-2.5 text-xs text-slate-800 dark:text-slate-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 transition-all"
            >
              <option value="">-- Select endpoint --</option>
              {deployments.map((deployment, index) => {
                const name =
                  deployment.name ||
                  deployment.deployment_name ||
                  `Deployment #${deployment.id || index + 1}`;

                return (
                  <option key={deployment.id || index} value={name}>
                    {name}
                  </option>
                );
              })}
            </select>
            {deployments.length === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">
                No active deployments found. Deploy a model in Model Registry first.
              </p>
            )}
          </div>

          <div className="flex items-end">
            <div className="w-full rounded-xl border border-slate-100 dark:border-[#262626] bg-slate-50/70 dark:bg-[#1a1a1a] px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 dark:text-slate-400">Target Endpoint Status</span>
                <span
                  className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${getStatusStyle(
                    deploymentStatus
                  )}`}
                >
                  {getStatusLabel(deploymentStatus)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default DeploymentSelector;
