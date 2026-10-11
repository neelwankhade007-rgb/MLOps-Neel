import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { datasetApi } from '../api/datasetApi';
import { trainingApi } from '../api/trainingApi';
import type { Dataset } from '../types/dataset';
import type { TrainingJob, TrainingRequest } from '../types/training';
import { getPrimaryMetric } from '../utils/formatters';

export interface ActiveTrainingJob {
  dataset_id: number;
  dataset_name?: string;
  algorithm: string;
  target_column: string;
  started_at: number;
}

export interface TrainingContextType {
  datasets: Dataset[];
  jobs: TrainingJob[];
  filteredJobs: TrainingJob[];
  activeJob: ActiveTrainingJob | null;
  search: string;
  setSearch: (s: string) => void;
  loading: boolean;
  fetching: boolean;
  error: string | null;
  completedJobs: number;
  runningJobs: number;
  failedJobs: number;
  legacyJobs: number;
  unreadCount: number;
  readJobIds: number[];
  dismissedJobIds: number[];
  markAsRead: (id: number) => void;
  markAllAsRead: () => void;
  dismissNotification: (id: number) => void;
  startTrainingJob: (config: TrainingRequest) => Promise<boolean>;
  refreshTraining: () => Promise<void>;
}

const READ_STORAGE_KEY = 'nexus_read_training_job_ids';
const DISMISSED_STORAGE_KEY = 'nexus_dismissed_training_job_ids';

const TrainingContext = createContext<TrainingContextType | undefined>(undefined);

export const TrainingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [activeJob, setActiveJob] = useState<ActiveTrainingJob | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [readJobIds, setReadJobIds] = useState<number[]>(() => {
    try {
      const stored = localStorage.getItem(READ_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [dismissedJobIds, setDismissedJobIds] = useState<number[]>(() => {
    try {
      const stored = localStorage.getItem(DISMISSED_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const saveReadIds = (ids: number[]) => {
    setReadJobIds(ids);
    try {
      localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(ids));
    } catch {
      // ignore storage failure
    }
  };


  const markAsRead = useCallback((id: number) => {
    setReadJobIds(prev => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      try {
        localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const markAllAsRead = useCallback(() => {
    const allIds = jobs.map(j => j.id).filter((id): id is number => id != null);
    saveReadIds(Array.from(new Set([...readJobIds, ...allIds])));
  }, [jobs, readJobIds]);

  const dismissNotification = useCallback((id: number) => {
    setDismissedJobIds(prev => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      try {
        localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
    // Also mark as read when dismissing
    markAsRead(id);
  }, [markAsRead]);

  const fetchData = useCallback(async () => {
    setFetching(true);
    setError(null);
    try {
      const datasetsData = await datasetApi.getDatasets();
      setDatasets(datasetsData || []);
    } catch {
      toast.error('Failed to load datasets');
    }

    try {
      const jobsData = await trainingApi.getTrainingJobs();
      setJobs(jobsData || []);
    } catch {
      toast.error('Failed to load training history');
      setError('Failed to load training history');
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const startTrainingJob = async (config: TrainingRequest): Promise<boolean> => {
    if (!config.dataset_id) {
      toast.error('Please select a dataset');
      return false;
    }

    if (!config.target_column.trim()) {
      toast.error('Please enter the target column');
      return false;
    }

    const datasetObj = datasets.find(d => Number(d.id) === Number(config.dataset_id));
    const activeInfo: ActiveTrainingJob = {
      dataset_id: Number(config.dataset_id),
      dataset_name: datasetObj?.name,
      algorithm: config.algorithm,
      target_column: config.target_column.trim(),
      started_at: Date.now(),
    };

    setActiveJob(activeInfo);
    setLoading(true);

    try {
      const res = await trainingApi.startTraining(config);
      const createdExperiment = res?.experiment || res?.job;

      if (createdExperiment) {
        setJobs(prev => {
          const filtered = prev.filter(j => j.id !== createdExperiment.id);
          return [createdExperiment, ...filtered];
        });
      } else {
        await fetchData();
      }

      let metricSuffix = '';
      if (createdExperiment) {
        const { name, value, isUnavailable } = getPrimaryMetric(createdExperiment);
        if (!isUnavailable) {
          metricSuffix = ` (${name}: ${value})`;
        }
      }

      toast.success(`Training completed successfully!${metricSuffix}`);
      return true;
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      const safeMessage = detail || 'Failed to start training job';
      toast.error(safeMessage);

      // Re-fetch training history to capture the persisted 'failed' record
      try {
        const jobsData = await trainingApi.getTrainingJobs();
        setJobs(jobsData || []);
      } catch {
        // ignore
      }
      return false;
    } finally {
      setActiveJob(null);
      setLoading(false);
    }
  };

  const filteredJobs = jobs.filter(job => {
    const query = search.toLowerCase();
    return (
      String(job.id ?? '').toLowerCase().includes(query) ||
      String(job.name ?? '').toLowerCase().includes(query) ||
      String(job.algorithm ?? '').toLowerCase().includes(query) ||
      String(job.status ?? '').toLowerCase().includes(query) ||
      String(job.target_column ?? '').toLowerCase().includes(query) ||
      String(job.run_id ?? '').toLowerCase().includes(query)
    );
  });

  // Calculate counters strictly from confirmed persisted statuses
  const completedJobs = jobs.filter(
    job => String(job.status ?? '').toLowerCase() === 'completed'
  ).length;

  const runningJobs =
    jobs.filter(job => String(job.status ?? '').toLowerCase() === 'running').length +
    (activeJob ? 1 : 0);

  const failedJobs = jobs.filter(
    job => String(job.status ?? '').toLowerCase() === 'failed'
  ).length;

  const legacyJobs = jobs.filter(
    job => job.status == null || job.status === '' || job.status === 'unknown'
  ).length;

  // Unread count: jobs that are not in readJobIds, not in dismissedJobIds, plus active job if present
  const unreadCount =
    jobs.filter(j => j.id != null && !readJobIds.includes(j.id) && !dismissedJobIds.includes(j.id)).length +
    (activeJob ? 1 : 0);

  return (
    <TrainingContext.Provider
      value={{
        datasets,
        jobs,
        filteredJobs,
        activeJob,
        search,
        setSearch,
        loading,
        fetching,
        error,
        completedJobs,
        runningJobs,
        failedJobs,
        legacyJobs,
        unreadCount,
        readJobIds,
        dismissedJobIds,
        markAsRead,
        markAllAsRead,
        dismissNotification,
        startTrainingJob,
        refreshTraining: fetchData,
      }}
    >
      {children}
    </TrainingContext.Provider>
  );
};

export const useTraining = (): TrainingContextType => {
  const context = useContext(TrainingContext);
  if (!context) {
    throw new Error('useTraining must be used within a TrainingProvider');
  }
  return context;
};

export default TrainingContext;
