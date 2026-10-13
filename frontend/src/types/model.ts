export interface Experiment {
  id: number;
  name?: string;
  experiment_name?: string;
  dataset_id?: number;
  algorithm?: string;
  target_column?: string | null;
  accuracy?: number | null;
  status?: string | null;
  task_type?: string | null;
  primary_metric?: string | null;
  metrics?: Record<string, number> | null;
  error_message?: string | null;
  run_id?: string | null;
  created_at?: string;
}

export interface RegisteredModel {
  id: number;
  name: string;
  experiment_id: number;
  version?: string;
  status?: string;
}

export interface ModelRegisterRequest {
  name: string;
  experiment_id: number;
}
