import apiClient from './client';
import type { TrainingJob, TrainingRequest, TrainingResponse } from '../types/training';

export const trainingApi = {
  getTrainingJobs: async (): Promise<TrainingJob[]> => {
    const res = await apiClient.get<TrainingJob[]>('/experiments');
    return res.data;
  },

  startTraining: async (data: TrainingRequest): Promise<TrainingResponse> => {
    const res = await apiClient.post<TrainingResponse>('/training/jobs', data);
    return res.data;
  },
};

export default trainingApi;
