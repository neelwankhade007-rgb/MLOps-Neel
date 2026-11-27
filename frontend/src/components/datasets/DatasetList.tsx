import React, { useState } from 'react';
import { Database, Search, Trash2 } from 'lucide-react';
import Card from '../common/Card';
import ConfirmDialog from '../common/ConfirmDialog';
import DatasetCard from './DatasetCard';
import { ListCardSkeleton } from '../common/Skeleton';
import type { Dataset } from '../../types/dataset';

export interface DatasetListProps {
  datasets: Dataset[];
  search: string;
  onSearchChange: (value: string) => void;
  onDeleteDataset?: (id: number) => void;
  onClearDatasets?: () => void;
  loading?: boolean;
}

export const DatasetList: React.FC<DatasetListProps> = ({
  datasets,
  search,
  onSearchChange,
  onDeleteDataset,
  onClearDatasets,
  loading = false,
}) => {
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Dataset Library</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Available datasets uploaded for model development and evaluation
            </p>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto">
            {onClearDatasets && datasets.length > 0 && (
              <button
                type="button"
                onClick={() => setShowClearConfirm(true)}
                className="px-3.5 py-2 text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-xl border border-red-200 dark:border-red-900/50 transition-colors shrink-0 flex items-center gap-1.5"
              >
                <Trash2 size={13} />
                <span>Clear All</span>
              </button>
            )}

            <div className="relative w-full md:w-72">
              <Search
                size={15}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search datasets..."
                className="w-full rounded-xl border border-slate-200 dark:border-[#262626] bg-white dark:bg-[#151515]
                  pl-9 pr-4 py-2 text-xs text-slate-800 dark:text-slate-100 outline-none
                  focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 transition-all"
              />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            <ListCardSkeleton />
            <ListCardSkeleton />
            <ListCardSkeleton />
          </div>
        ) : datasets.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {datasets.map((dataset) => (
              <DatasetCard key={dataset.id} dataset={dataset} onDelete={onDeleteDataset} />
            ))}
          </div>
        ) : (
          <Card className="p-12 text-center">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <Database size={26} />
            </div>
            <h3 className="mt-4 text-base font-bold text-slate-800 dark:text-slate-200">
              {search ? 'No matching datasets' : 'No datasets uploaded yet'}
            </h3>
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
              {search
                ? `No dataset matches your filter "${search}". Clear search to view all.`
                : 'Upload your first CSV dataset above to begin training machine learning models.'}
            </p>
          </Card>
        )}
      </div>

      <ConfirmDialog
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={() => {
          setShowClearConfirm(false);
          onClearDatasets?.();
        }}
        title="Clear All Datasets"
        message="Are you sure you want to delete all uploaded datasets? This will permanently delete dataset files and associated experiments."
        confirmLabel="Clear All Datasets"
        variant="danger"
      />
    </>
  );
};

export default DatasetList;
