import React, { useState } from 'react';
import { Rocket, Trash2, Search } from 'lucide-react';
import Card from '../common/Card';
import ConfirmDialog from '../common/ConfirmDialog';
import DeploymentCard from './DeploymentCard';
import { ListCardSkeleton } from '../common/Skeleton';
import type { Deployment } from '../../types/deployment';
import type { RegisteredModel } from '../../types/model';

export interface DeploymentListProps {
  deployments: Deployment[];
  models: RegisteredModel[];
  search: string;
  onSearchChange: (value: string) => void;
  onDeleteDeployment?: (id: number) => void;
  onClearDeployments?: () => void;
  loading?: boolean;
}

export const DeploymentList: React.FC<DeploymentListProps> = ({
  deployments,
  models,
  search,
  onSearchChange,
  onDeleteDeployment,
  onClearDeployments,
  loading = false,
}) => {
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Active Deployments</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Serving inference endpoints currently available for online prediction requests
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
                placeholder="Search deployments..."
                className="w-full rounded-xl border border-slate-200 dark:border-[#262626] bg-white dark:bg-[#151515] pl-9 pr-4 py-2 text-xs text-slate-800 dark:text-slate-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 transition-all"
              />
            </div>

            {onClearDeployments && deployments.length > 0 && (
              <button
                type="button"
                onClick={() => setShowClearConfirm(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-xl border border-red-200 dark:border-red-900/50 transition-colors shrink-0"
                title="Clear all deployments"
              >
                <Trash2 size={13} />
                <span>Clear All</span>
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="space-y-4">
            <ListCardSkeleton />
            <ListCardSkeleton />
          </div>
        ) : deployments.length > 0 ? (
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
            <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <Rocket size={26} />
            </div>

            <h3 className="mt-4 text-base font-bold text-slate-800 dark:text-slate-200">
              {search ? 'No deployments match filter' : 'No deployments active'}
            </h3>

            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
              {search
                ? `No deployment matches "${search}". Clear search to view all.`
                : 'Select a registered model above to deploy it as an HTTP inference endpoint.'}
            </p>
          </Card>
        )}
      </div>

      <ConfirmDialog
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={() => {
          setShowClearConfirm(false);
          onClearDeployments?.();
        }}
        title="Clear All Deployments"
        message="Are you sure you want to unload all deployments? All model endpoints will be removed from memory and stop serving predictions."
        confirmLabel="Clear All Endpoints"
        variant="danger"
      />
    </>
  );
};

export default DeploymentList;
