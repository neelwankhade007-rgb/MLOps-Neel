import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { datasetApi } from '../api/datasetApi';
import type { Dataset } from '../types/dataset';

export const useDatasets = () => {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  const fetchDatasets = useCallback(async () => {
    try {
      const data = await datasetApi.getDatasets();
      setDatasets(data);
    } catch {
      toast.error('Failed to load datasets');
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    fetchDatasets();
  }, [fetchDatasets]);

  const uploadDataset = async (file: File, name: string, description: string): Promise<boolean> => {
    if (!file) {
      toast.error('Please select a CSV file');
      return false;
    }

    if (!name.trim()) {
      toast.error('Please enter a dataset name');
      return false;
    }

    if (!description.trim()) {
      toast.error('Please enter a description');
      return false;
    }

    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', name);
    formData.append('description', description);

    try {
      const res = await datasetApi.uploadDataset(formData);
      setDatasets(prev => [...prev, res.dataset]);
      toast.success('Dataset uploaded successfully!');
      return true;
    } catch {
      toast.error('Upload failed');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const filteredDatasets = datasets.filter(dataset => {
    const query = search.toLowerCase();
    return (
      dataset.name?.toLowerCase().includes(query) ||
      dataset.description?.toLowerCase().includes(query) ||
      String(dataset.id).includes(query)
    );
  });

  const latestId =
    datasets.length > 0
      ? Math.max(...datasets.map(d => Number(d.id) || 0))
      : 0;

  const deleteDataset = async (id: number | string): Promise<boolean> => {
    setLoading(true);
    try {
      await datasetApi.deleteDataset(id);
      toast.success('Dataset deleted successfully');
      setDatasets(prev => prev.filter(d => String(d.id) !== String(id)));
      return true;
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to delete dataset');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const clearDatasets = async (): Promise<boolean> => {
    setLoading(true);
    try {
      const res = await datasetApi.clearDatasets();
      toast.success(res.message || 'All datasets cleared');
      setDatasets([]);
      return true;
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to clear datasets');
      return false;
    } finally {
      setLoading(false);
    }
  };

  return {
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
    refreshDatasets: fetchDatasets,
  };
};

export default useDatasets;
