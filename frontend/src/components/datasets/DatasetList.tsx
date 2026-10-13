import React from 'react';
import { Database } from 'lucide-react';
import Card from '../common/Card';
import DatasetCard from './DatasetCard';
import type { Dataset } from '../../types/dataset';

export interface DatasetListProps {
  datasets: Dataset[];
  search: string;
  onSearchChange: (value: string) => void;
  onDeleteDataset?: (id: number) => void;
  onClearDatasets?: () => void;
}

export const DatasetList: React.FC<DatasetListProps> = ({
  datasets,
  search,
  onSearchChange,
  onDeleteDataset,
  onClearDatasets,
}) => {
  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Dataset Library</h2>
          <p className="text-sm text-slate-500">
            Browse datasets currently available in the platform.
          </p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          {onClearDatasets && datasets.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Are you sure you want to clear all datasets? This will permanently delete your uploaded datasets and their associated training experiments.')) {
                  onClearDatasets();
                }
              }}
              className="px-3.5 py-2.5 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded-xl border border-red-200 transition shrink-0"
            >
              Clear All Datasets
            </button>
          )}

          <div className="relative w-full md:w-72">
            <input
              type="text"
              value={search}
              onChange={e => onSearchChange(e.target.value)}
              placeholder="Search datasets..."
              className="w-full rounded-xl border border-slate-200 bg-white
                px-4 py-2.5 text-sm outline-none
                focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>
      </div>

      {datasets.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {datasets.map(dataset => (
            <DatasetCard key={dataset.id} dataset={dataset} onDelete={onDeleteDataset} />
          ))}
        </div>
      ) : (
        <Card className="p-12 text-center">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400">
            <Database size={30} />
          </div>
          <h3 className="mt-5 text-lg font-semibold text-slate-800">
            {search ? 'No datasets found' : 'No datasets uploaded yet'}
          </h3>
          <p className="mt-2 text-sm text-slate-500 max-w-md mx-auto">
            {search
              ? 'Try a different search term.'
              : 'Upload your first CSV dataset to start the ML training workflow.'}
          </p>
        </Card>
      )}
    </div>
  );
};

export default DatasetList;
