import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Database, ChevronRight, Trash2 } from 'lucide-react';
import Card from '../common/Card';
import ConfirmDialog from '../common/ConfirmDialog';
import type { Dataset } from '../../types/dataset';

export interface DatasetCardProps {
  dataset: Dataset;
  onDelete?: (id: number) => void;
}

export const DatasetCard: React.FC<DatasetCardProps> = ({ dataset, onDelete }) => {
  const navigate = useNavigate();
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  return (
    <>
      <Card className="p-5 hoverable flex flex-col justify-between">
        <div>
          <div className="flex items-start justify-between">
            <div className="p-3 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
              <Database size={20} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/50">
                Ready
              </span>
              {onDelete && (
                <button
                  type="button"
                  onClick={() => setShowConfirmDelete(true)}
                  title="Delete dataset"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          </div>

          <div className="mt-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white truncate" title={dataset.name}>
              {dataset.name}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2 min-h-[32px]">
              {dataset.description || 'No description provided.'}
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-[#262626] space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Dataset ID</span>
              <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                #{dataset.id}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Format</span>
              <span className="font-mono text-slate-600 dark:text-slate-400">CSV Table</span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigate('/training')}
          className="w-full mt-5 flex items-center justify-center gap-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white py-2.5 text-xs font-semibold shadow-xs transition-all active:scale-[0.98]"
        >
          <span>Configure Training</span>
          <ChevronRight size={14} />
        </button>
      </Card>

      {/* Accessible Non-Blocking Delete Confirmation */}
      <ConfirmDialog
        isOpen={showConfirmDelete}
        onClose={() => setShowConfirmDelete(false)}
        onConfirm={() => {
          setShowConfirmDelete(false);
          onDelete?.(Number(dataset.id));
        }}
        title="Delete Dataset"
        message={`Are you sure you want to delete dataset "${dataset.name}" (#${dataset.id})? Associated experiments and model records referencing this dataset may also be affected.`}
        confirmLabel="Delete Dataset"
        variant="danger"
      />
    </>
  );
};

export default DatasetCard;
