import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { deploymentApi } from '../api/deploymentApi';
import type { Deployment, DeploymentCreateRequest } from '../types/deployment';

export const useDeployments = () => {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  const fetchDeployments = useCallback(async () => {
    setFetching(true);
    try {
      const data = await deploymentApi.getDeployments();
      setDeployments(data);
    } catch {
      toast.error('Failed to load deployments');
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    fetchDeployments();
  }, [fetchDeployments]);

  const deployModel = async (
    modelId: string | number,
    data: DeploymentCreateRequest
  ): Promise<boolean> => {
    if (!modelId) {
      toast.error('Please select a model');
      return false;
    }

    if (!data.name.trim()) {
      toast.error('Please enter a deployment name');
      return false;
    }

    setLoading(true);

    try {
      await deploymentApi.deployModel(modelId, data);
      toast.success('Model deployment started!');
      await fetchDeployments();
      return true;
    } catch {
      toast.error('Deployment failed');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const filteredDeployments = deployments.filter(deployment => {
    const query = search.toLowerCase();
    return (
      String(deployment.id ?? '')
        .toLowerCase()
        .includes(query) ||
      String(deployment.name ?? '')
        .toLowerCase()
        .includes(query) ||
      String(deployment.status ?? '')
        .toLowerCase()
        .includes(query) ||
      String(deployment.model_id ?? '')
        .toLowerCase()
        .includes(query)
    );
  });

  const activeDeployments = deployments.filter(deployment => {
    const status = String(deployment.status ?? '').toLowerCase();
    return (
      status === 'active' ||
      status === 'running' ||
      status === 'deployed' ||
      status === 'healthy'
    );
  }).length;

  const pendingDeployments = deployments.filter(deployment => {
    const status = String(deployment.status ?? '').toLowerCase();
    return (
      status === 'pending' ||
      status === 'deploying' ||
      status === 'creating'
    );
  }).length;

  const deleteDeployment = async (id: number | string): Promise<boolean> => {
    setLoading(true);
    try {
      await deploymentApi.deleteDeployment(id);
      toast.success('Deployment deleted successfully');
      setDeployments(prev => prev.filter(d => String(d.id) !== String(id) && d.name !== String(id)));
      return true;
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to delete deployment');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const clearDeployments = async (): Promise<boolean> => {
    setLoading(true);
    try {
      const res = await deploymentApi.clearDeployments();
      toast.success(res.message || 'All deployments cleared');
      setDeployments([]);
      return true;
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to clear deployments');
      return false;
    } finally {
      setLoading(false);
    }
  };

  return {
    deployments,
    filteredDeployments,
    search,
    setSearch,
    loading,
    fetching,
    activeDeployments,
    pendingDeployments,
    deployModel,
    deleteDeployment,
    clearDeployments,
    refreshDeployments: fetchDeployments,
  };
};

export default useDeployments;
