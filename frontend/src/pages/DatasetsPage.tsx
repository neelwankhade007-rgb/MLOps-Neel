import React from 'react';
import { Database, CheckCircle2, Activity } from 'lucide-react';
import Card from '../components/common/Card';
import DatasetUpload from '../components/datasets/DatasetUpload';
import DatasetList from '../components/datasets/DatasetList';
import { useDatasets } from '../hooks/useDatasets';

export const DatasetsPage: React.FC = () => {
  const {
    datasets,
    filteredDatasets,
    search,
    setSearch,
    loading,
    latestId,
    uploadDataset,
    deleteDataset,
    clearDatasets,
  } = useDatasets();

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-blue-600 mb-1">
            Data Management
          </p>
          <h1 className="text-3xl font-bold text-slate-900">Datasets</h1>
          <p className="text-slate-500 mt-1">
            Upload, manage and prepare datasets for model training.
          </p>
        </div>

        <div className="text-sm text-slate-500">
          {datasets.length} dataset{datasets.length !== 1 ? 's' : ''} available
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">Total Datasets</p>
              <p className="text-3xl font-bold text-slate-900 mt-1">
                {datasets.length}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Uploaded to the platform
              </p>
            </div>

            <div className="p-3 rounded-xl bg-blue-50 text-blue-600">
              <Database size={24} />
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">Available for Training</p>
              <p className="text-3xl font-bold text-slate-900 mt-1">
                {datasets.length}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Dataset records currently available
              </p>
            </div>

            <div className="p-3 rounded-xl bg-emerald-50 text-emerald-600">
              <CheckCircle2 size={24} />
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">Latest Dataset</p>
              <p className="text-3xl font-bold text-slate-900 mt-1">
                {latestId > 0 ? `#${latestId}` : '—'}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Most recent dataset ID
              </p>
            </div>

            <div className="p-3 rounded-xl bg-violet-50 text-violet-600">
              <Activity size={24} />
            </div>
          </div>
        </Card>
      </div>

      {/* Upload Section */}
      <DatasetUpload onUpload={uploadDataset} loading={loading} />

      {/* Dataset Library */}
      <DatasetList
        datasets={filteredDatasets}
        search={search}
        onSearchChange={setSearch}
        onDeleteDataset={deleteDataset}
        onClearDatasets={clearDatasets}
      />
    </div>
  );
};

export default DatasetsPage;
