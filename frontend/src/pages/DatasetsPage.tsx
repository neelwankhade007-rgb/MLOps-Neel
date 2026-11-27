import React from 'react';
import { Database, CheckCircle2, Activity } from 'lucide-react';
import Card from '../components/common/Card';
import Header from '../components/layout/Header';
import DatasetUpload from '../components/datasets/DatasetUpload';
import DatasetList from '../components/datasets/DatasetList';
import { StatCardSkeleton } from '../components/common/Skeleton';
import { useDatasets } from '../hooks/useDatasets';

export const DatasetsPage: React.FC = () => {
  const {
    datasets,
    filteredDatasets,
    search,
    setSearch,
    loading,
    fetching,
    latestId,
    uploadDataset,
    deleteDataset,
    clearDatasets,
  } = useDatasets();

  return (
    <div className="max-w-[1520px] mx-auto space-y-7">
      <Header
        category="Data Pipeline"
        title="Datasets"
        subtitle="Upload, inspect, and prepare tabular datasets for model training workflows."
        action={
          <span className="text-xs font-mono font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-[#1a1a1a] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#262626]">
            {datasets.length} dataset{datasets.length !== 1 ? 's' : ''} available
          </span>
        }
      />

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        {fetching ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            <Card className="p-5 hoverable">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Total Datasets
                  </p>
                  <p className="text-3xl font-bold font-mono text-slate-900 dark:text-white mt-1">
                    {datasets.length}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">Uploaded to platform</p>
                </div>
                <div className="p-3 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
                  <Database size={22} />
                </div>
              </div>
            </Card>

            <Card className="p-5 hoverable">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Ready for Training
                  </p>
                  <p className="text-3xl font-bold font-mono text-slate-900 dark:text-white mt-1">
                    {datasets.length}
                  </p>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                    Verified tabular format
                  </p>
                </div>
                <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 size={22} />
                </div>
              </div>
            </Card>

            <Card className="p-5 hoverable">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Latest Ingest
                  </p>
                  <p className="text-3xl font-bold font-mono text-slate-900 dark:text-white mt-1">
                    {latestId > 0 ? `#${latestId}` : '—'}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">Most recent dataset ID</p>
                </div>
                <div className="p-3 rounded-2xl bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400">
                  <Activity size={22} />
                </div>
              </div>
            </Card>
          </>
        )}
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
        loading={fetching}
      />
    </div>
  );
};

export default DatasetsPage;
