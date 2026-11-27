import http from 'k6/http';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const config = JSON.parse(__ENV.NEXUS_CONFIG || '{"duration":60,"rate":5,"vus":10,"scenario":"steady"}');
const corpus = new SharedArray('feature rows', () => JSON.parse(open('./corpus.json')));
const completed = new Counter('nexus_completed');
const scenario = {
  executor: config.stages ? 'ramping-arrival-rate' : 'constant-arrival-rate',
  timeUnit: '1s',
  preAllocatedVUs: config.vus,
  maxVUs: config.vus,
  gracefulStop: '21s',
};
if (config.stages) {
  scenario.startRate = config.rate;
  scenario.stages = config.stages.map(([seconds, target]) => ({ duration: seconds + 's', target }));
  // Give k6's final area crossing time to dispatch before its executor deadline.
  // The 1 ns transition contributes less than half an arrival for supported rates.
  scenario.stages.push({duration: '1ns', target: 0}, {duration: '200ms', target: 0});
} else {
  scenario.rate = config.rate;
  // The periodic executor begins at slot zero. End halfway through the
  // final inter-arrival gap so the deadline and the next timer cannot race.
  scenario.duration = (config.duration * 1000 - 500 / config.rate).toFixed(6) + 'ms';
}
export const options = {
  scenarios: { [config.scenario]: scenario },
  systemTags: ['status', 'method', 'scenario', 'error_code'],
  noConnectionReuse: false,
  noVUConnectionReuse: false,
};

export default function () {
  const iteration = exec.scenario.iterationInTest;
  const row = (iteration + config.seed) % corpus.length;
  const started = Date.now();
  const response = http.post(config.url, JSON.stringify({features: corpus[row]}), {
    headers: {'Authorization': 'Bearer ' + __ENV.NEXUS_TOKEN, 'Content-Type': 'application/json'},
    timeout: '20s',
    redirects: 0,
  });
  let data;
  try { data = response.json(); } catch (_) { data = null; }
  const meta = data && data.gateway_meta;
  const gatewayOk = config.strategy === 'native' ? meta === null :
    meta && meta.routing_strategy === config.strategy && meta.model_run_id === config.model &&
    meta.selected_replica === data.replica_id && config.endpoints[data.replica_id] === meta.target_endpoint &&
    Number.isFinite(meta.gateway_latency_ms) && meta.gateway_latency_ms >= 0;
  const valid = Boolean(response.status === 200 && data &&
    typeof data.prediction === 'string' && data.prediction.length &&
    Object.prototype.hasOwnProperty.call(config.endpoints, data.replica_id) &&
    typeof data.request_id === 'string' && data.request_id.length &&
    Number.isFinite(data.latency_ms) && data.latency_ms >= 0 && data.deployment === config.deployment && gatewayOk);
  const timeout = response.error_code === 1050 || response.status === 504;
  completed.add(1, {valid: String(valid), timeout: String(timeout)});
  console.log(JSON.stringify({
    iteration, row, started_ms: started, scenario_start_ms: exec.scenario.startTime,
    ended_ms: Date.now(), duration_ms: response.timings.duration,
    status: response.status, error_code: response.error_code || null, valid, timeout,
    transport_error: response.status === 0 ? response.error || null : null,
    prediction_type: data ? typeof data.prediction : null,
    replica_id: data && data.replica_id, request_id: data && data.request_id,
    inference_ms: data && data.latency_ms,
    gateway_meta: meta ? {
      routing_strategy: meta.routing_strategy, model_run_id: meta.model_run_id,
      selected_replica: meta.selected_replica, target_endpoint: meta.target_endpoint,
      gateway_latency_ms: meta.gateway_latency_ms, upstream_latency_ms: meta.upstream_latency_ms,
    } : null,
  }));
}
