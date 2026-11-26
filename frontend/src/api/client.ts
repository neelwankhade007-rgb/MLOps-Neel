import axios from 'axios';
import { API_URL } from '../utils/constants';
import { getToken } from '../utils/auth';

/**
 * Isolated API Client.
 * Note: Never attach interceptors to the global default `axios` instance to avoid
 * leaking bearer authentication tokens to external origins or unintended third-party requests.
 */
export const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  headers: {
    'Accept': 'application/json',
  },
});

let unauthorizedHandler: (() => void) | null = null;

export const setUnauthorizedHandler = (handler: () => void) => {
  unauthorizedHandler = handler;
};

// Request interceptor exclusively scoped to apiClient
apiClient.interceptors.request.use(
  (config) => {
    const token = getToken();
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor exclusively scoped to apiClient
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      if (unauthorizedHandler) {
        unauthorizedHandler();
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
