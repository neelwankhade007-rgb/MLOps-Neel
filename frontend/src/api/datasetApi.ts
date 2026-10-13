import apiClient from './client';
import type { Dataset, DatasetUploadResponse } from '../types/dataset';

export const datasetApi = {
  getDatasets: async (): Promise<Dataset[]> => {
    const res = await apiClient.get<Dataset[]>('/datasets');
    return res.data;
  },

  uploadDataset: async (formData: FormData): Promise<DatasetUploadResponse> => {
    const res = await apiClient.post<DatasetUploadResponse>('/datasets', formData);
    return res.data;
  },

  deleteDataset: async (id: number | string): Promise<{ success: boolean; message: string }> => {
    const res = await apiClient.delete<{ success: boolean; message: string }>(`/datasets/${id}`);
    return res.data;
  },

  clearDatasets: async (): Promise<{ success: boolean; message: string; count: number }> => {
    const res = await apiClient.delete<{ success: boolean; message: string; count: number }>('/datasets');
    return res.data;
  },
};

export default datasetApi;
