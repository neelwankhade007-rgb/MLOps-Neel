import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { modelApi } from '../api/modelApi';
import type { Experiment, RegisteredModel, ModelRegisterRequest } from '../types/model';

export const useModels = () => {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [models, setModels] = useState<RegisteredModel[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  const fetchData = useCallback(async () => {
    setFetching(true);
    try {
      const [expData, modelsData] = await Promise.all([
        modelApi.getExperiments(),
        modelApi.getModels(),
      ]);
      setExperiments(expData);
      setModels(modelsData);
    } catch {
      toast.error('Failed to load models and experiments');
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const registerModel = async (data: ModelRegisterRequest): Promise<boolean> => {
    if (!data.name.trim()) {
      toast.error('Please enter a model name');
      return false;
    }

    if (!data.experiment_id) {
      toast.error('Please select an experiment');
      return false;
    }

    setLoading(true);

    try {
      await modelApi.registerModel(data);
      toast.success('Model registered successfully!');
      await fetchData();
      return true;
    } catch {
      toast.error('Failed to register model');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const filteredModels = models.filter(model => {
    const query = search.toLowerCase();
    return (
      String(model.id ?? '')
        .toLowerCase()
        .includes(query) ||
      String(model.name ?? '')
        .toLowerCase()
        .includes(query) ||
      String(model.status ?? '')
        .toLowerCase()
        .includes(query)
    );
  });

  const deleteModel = async (id: number | string): Promise<boolean> => {
    setLoading(true);
    try {
      await modelApi.deleteModel(id);
      toast.success('Model deleted successfully');
      setModels(prev => prev.filter(m => String(m.id) !== String(id)));
      return true;
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to delete model');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const clearModels = async (): Promise<boolean> => {
    setLoading(true);
    try {
      const res = await modelApi.clearModels();
      toast.success(res.message || 'All registered models cleared');
      setModels([]);
      return true;
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to clear models');
      return false;
    } finally {
      setLoading(false);
    }
  };

  return {
    experiments,
    models,
    filteredModels,
    search,
    setSearch,
    loading,
    fetching,
    registerModel,
    deleteModel,
    clearModels,
    refreshModels: fetchData,
  };
};

export default useModels;
