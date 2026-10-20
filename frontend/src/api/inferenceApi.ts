import apiClient from './client';

export interface ReplicaTelemetry {
  index: number;
  name: string;
  replica_id: string;
  color: string;
  badge_class: string;
  node_name: string;
  pod_ip: string;
  status: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';
  is_ready: boolean;
  reachable: boolean;
  requests_served: number;
  requests_success: number;
  requests_error: number;
  error_rate_pct: number;
  active_requests: number;
  avg_latency_ms: number;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  p99_latency_ms: number | null;
  sample_count?: number;
  cpu_pct: number | null;
  mem_pct: number | null;
  cpu_raw: string;
  mem_raw: string;
  metrics_available?: boolean;
  traffic_share_pct: number;
  score: number;
  is_optimal: boolean;
}

export interface RecentEvent {
  timestamp: string;
  request_id: string;
  assigned_pod: string;
  replica_id: string;
  routing_mechanism?: string;
  calculated_score?: number;
  decision_rationale?: string;
  observed_latency_ms: number;
  duration_ms?: number;
  start_epoch_ms?: number;
  gateway_latency_ms?: number;
  upstream_latency_ms?: number;
  http_status: string;
  status_code?: number;
  traffic_type?: string;
}

export interface TelemetrySummary {
  throughput_rps: number;
  throughput_window_s?: number;
  p95_latency_ms: number | null;
  p50_latency_ms: number | null;
  p99_latency_ms: number | null;
  error_rate_pct: number;
  healthy_replicas: number;
  total_replicas: number;
  total_requests: number;
  total_success: number;
  total_errors: number;
  active_requests: number;
  gateway_decision_ms: number | null;
  gateway_decision_desc?: string;
  active_policy: string;
  active_policy_desc: string;
  gateway_active?: boolean;
  gateway_url?: string | null;
  model_name: string;
  namespace: string;
  cluster_name: string;
  last_sync_utc: string;
}

export interface TelemetryHistory {
  latency_trend: Array<{ timestamp: string; p50: number; p95: number; p99: number }>;
  distribution_trend: Array<{ timestamp: string; [key: string]: any }>;
  throughput_trend: Array<{ timestamp: string; rps: number; errors: number; error_rate: number }>;
}

export interface TelemetrySnapshot {
  summary: TelemetrySummary;
  replicas: ReplicaTelemetry[];
  recent_events: RecentEvent[];
  history: TelemetryHistory;
}

export interface TestTrafficResult {
  request_id: string;
  replica_id: string;
  prediction?: string;
  latency_ms: number;
  roundtrip_ms?: number;
  duration_ms?: number;
  start_time?: string;
  start_epoch_ms?: number;
  end_time?: string;
  gateway_latency_ms?: number;
  upstream_latency_ms?: number;
  routing_strategy?: string;
  traffic_type?: string;
  status: number;
  status_text: string;
  timestamp: string;
}

export type RoutingStrategy = 'native' | 'round_robin' | 'weighted_round_robin' | 'adaptive';
export interface RoutingStrategyState {
  strategy: RoutingStrategy;
  strategy_label: string;
  supported_strategies: RoutingStrategy[];
  wrr_weights: number[];
  adaptive_weights?: { lat: number; req: number; cpu: number; err: number };
  gateway_url?: string;
  native_url?: string;
}

export interface LocustRunConfig {
  deployment_name: string;
  users: number;
  target_rps: number;
  duration_seconds: number;
  request_limit: number;
}

export interface LocustRunSnapshot {
  status: 'idle' | 'running' | 'completed' | 'failed';
  run: null | (LocustRunConfig & {
    run_id: string;
    routing_strategy: string;
    started_at: string;
    metrics: {
      sent?: number;
      success?: number;
      failed?: number;
      observed_rps?: number;
      replica_distribution?: Record<string, number>;
      events?: TestTrafficResult[];
    };
  });
}

export const inferenceApi = {
  getRoutingStrategy: async (): Promise<RoutingStrategyState> => {
    const res = await apiClient.get<RoutingStrategyState>('/inference-monitoring/routing-strategy');
    return res.data;
  },

  setRoutingStrategy: async (
    strategy?: RoutingStrategy,
    wrr_weights?: number[],
    adaptive_weights?: { lat: number; req: number; cpu: number; err: number }
  ): Promise<RoutingStrategyState> => {
    const payload: any = {};
    if (strategy !== undefined) payload.strategy = strategy;
    if (wrr_weights !== undefined) payload.wrr_weights = wrr_weights;
    if (adaptive_weights !== undefined) payload.adaptive_weights = adaptive_weights;
    const res = await apiClient.put<RoutingStrategyState>('/inference-monitoring/routing-strategy', payload);
    return res.data;
  },

  getTelemetry: async (weights?: { lat: number; req: number; cpu: number; err: number }): Promise<TelemetrySnapshot> => {
    const params = weights
      ? { w_lat: weights.lat, w_req: weights.req, w_cpu: weights.cpu, w_err: weights.err }
      : {};
    const res = await apiClient.get<TelemetrySnapshot>('/inference-monitoring/telemetry', { params });
    return res.data;
  },

  sendTestTraffic: async (
    count: number = 5,
    strategy?: string,
    traffic_type?: string
  ): Promise<{ success: boolean; count: number; requests: TestTrafficResult[] }> => {
    const res = await apiClient.post<{ success: boolean; count: number; requests: TestTrafficResult[] }>(
      '/inference-monitoring/test-traffic',
      { count, strategy, traffic_type }
    );
    return res.data;
  },

  startLocustRun: async (config: LocustRunConfig): Promise<LocustRunSnapshot> => {
    const res = await apiClient.post<LocustRunSnapshot>('/inference-monitoring/locust/start', config);
    return res.data;
  },

  getLocustDeployments: async (): Promise<Array<{ name: string }>> => {
    const res = await apiClient.get<Array<{ name: string }>>('/inference-monitoring/locust/deployments');
    return res.data;
  },

  getLocustRunStatus: async (): Promise<LocustRunSnapshot> => {
    const res = await apiClient.get<LocustRunSnapshot>('/inference-monitoring/locust/status');
    return res.data;
  },

  stopLocustRun: async (): Promise<LocustRunSnapshot> => {
    const res = await apiClient.post<LocustRunSnapshot>('/inference-monitoring/locust/stop');
    return res.data;
  },

  getPrometheusStatus: async (): Promise<any> => {
    const res = await apiClient.get('/inference-monitoring/prometheus/status');
    return res.data;
  }
};

export default inferenceApi;
