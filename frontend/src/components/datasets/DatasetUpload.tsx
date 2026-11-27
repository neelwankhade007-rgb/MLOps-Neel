import React, { useState } from 'react';
import { UploadCloud, Database, CheckCircle2, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import Card from '../common/Card';
import Input from '../common/Input';
import Button from '../common/Button';

export interface DatasetUploadProps {
  onUpload: (file: File, name: string, description: string) => Promise<boolean>;
  loading?: boolean;
}

const MAX_FILE_SIZE_MB = 50;

export const DatasetUpload: React.FC<DatasetUploadProps> = ({ onUpload, loading = false }) => {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) {
      setFile(null);
      return;
    }

    if (!selectedFile.name.toLowerCase().endsWith('.csv')) {
      setFileError('Only CSV (.csv) files are supported for tabular training.');
      setFile(null);
      return;
    }

    if (selectedFile.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setFileError(`File size exceeds ${MAX_FILE_SIZE_MB}MB limit.`);
      setFile(null);
      return;
    }

    setFile(selectedFile);
    if (!name) {
      // Auto-populate name without .csv extension
      setName(selectedFile.name.replace(/\.csv$/i, ''));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      toast.error('Please select a valid CSV file');
      return;
    }

    if (!name.trim()) {
      toast.error('Please provide a dataset name');
      return;
    }

    const success = await onUpload(file, name.trim(), desc.trim());
    if (success) {
      setFile(null);
      setName('');
      setDesc('');
      setFileError(null);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-100 dark:border-[#262626]">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
            <UploadCloud size={20} />
          </div>
          <div>
            <h2 className="font-bold text-slate-900 dark:text-white text-base">Upload New Dataset</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Add a CSV dataset to your platform workspace for feature extraction and training.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
              Dataset Name <span className="text-red-500">*</span>
            </label>
            <Input
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              required
              placeholder="e.g. customer_churn_v1"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
              Description <span className="text-red-500">*</span>
            </label>
            <Input
              value={desc}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDesc(e.target.value)}
              required
              placeholder="Short summary of tabular features"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
              CSV File (.csv) <span className="text-red-500">*</span>
            </label>
            <input
              type="file"
              accept=".csv,text/csv"
              required
              onChange={handleFileChange}
              className="block w-full text-xs text-slate-500 dark:text-slate-400
                file:mr-3 file:py-2 file:px-3.5
                file:rounded-xl file:border-0
                file:text-xs file:font-semibold
                file:bg-indigo-50 file:text-indigo-700 dark:file:bg-indigo-950/40 dark:file:text-indigo-300
                hover:file:bg-indigo-100 dark:hover:file:bg-indigo-900/50
                cursor-pointer transition-all border border-slate-200 dark:border-[#262626] rounded-xl p-1 bg-white dark:bg-[#181818]"
            />
          </div>
        </div>

        {fileError && (
          <div className="mt-4 flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 text-xs border border-red-200 dark:border-red-900/50">
            <AlertCircle size={16} className="shrink-0" />
            <span>{fileError}</span>
          </div>
        )}

        {file && !fileError && (
          <div className="mt-5 flex items-center justify-between rounded-xl border border-indigo-100 dark:border-indigo-900/40 bg-indigo-50/60 dark:bg-indigo-950/20 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-white dark:bg-[#181818] text-indigo-600 dark:text-indigo-400 shadow-xs">
                <Database size={18} />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{file.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                  {(file.size / (1024 * 1024)).toFixed(2)} MB • Ready for ingest
                </p>
              </div>
            </div>
            <CheckCircle2 size={20} className="text-emerald-500" />
          </div>
        )}

        <div className="flex justify-end mt-6">
          <Button type="submit" loading={loading} disabled={!file || !name.trim()}>
            <UploadCloud size={16} className="mr-2" />
            {loading ? 'Uploading...' : 'Upload Dataset'}
          </Button>
        </div>
      </form>
    </Card>
  );
};

export default DatasetUpload;
