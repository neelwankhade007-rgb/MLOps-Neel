export interface TrainingJob {
  id?: number;
  name?: string;
  dataset_id: number | string;
  algorithm: string;
  target_column?: string;
  status?: 'queued' | 'running' | 'completed' | 'failed' | string | null;
  accuracy?: number | null;
  task_type?: 'classification' | 'regression' | string | null;
  primary_metric?: string | null;
  metrics?: Record<string, number> | null;
  error_message?: string | null;
  run_id?: string | null;
  created_at?: string;
}

export interface TrainingRequest {
  dataset_id: number;
  target_column: string;
  algorithm: string;
}

export interface TrainingResponse {
  success: boolean;
  experiment?: TrainingJob;
  job?: TrainingJob;
}
