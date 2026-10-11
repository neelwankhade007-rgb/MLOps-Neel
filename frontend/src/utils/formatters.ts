export const getStatusStyle = (status: string): string => {
  const normalized = String(status || '').toLowerCase();

  if (
    normalized === 'completed' ||
    normalized === 'success' ||
    normalized === 'succeeded' ||
    normalized === 'active' ||
    normalized === 'running' ||
    normalized === 'deployed' ||
    normalized === 'healthy' ||
    normalized === 'production'
  ) {
    return 'bg-emerald-50 text-emerald-700';
  }

  if (
    normalized === 'pending' ||
    normalized === 'deploying' ||
    normalized === 'creating' ||
    normalized === 'queued'
  ) {
    return 'bg-blue-50 text-blue-700';
  }

  if (
    normalized === 'failed' ||
    normalized === 'error' ||
    normalized === 'stopped'
  ) {
    return 'bg-red-50 text-red-700';
  }

  return 'bg-slate-100 text-slate-600';
};

export const getStatusLabel = (status: string): string => {
  if (!status) return 'Unknown';

  const normalized = String(status).toLowerCase();

  if (normalized === 'success' || normalized === 'succeeded') {
    return 'Completed';
  }

  if (normalized === 'running') return 'Active';
  if (normalized === 'deployed') return 'Active';
  if (normalized === 'production') return 'Production';

  return String(status).charAt(0).toUpperCase() + String(status).slice(1);
};

export const formatLabel = (name: string): string => {
  if (!name) return '';
  if (name.toLowerCase() === 'bmi') return 'BMI';
  if (name.toLowerCase() === 'id') return 'ID';
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
};

export interface PrimaryMetricInfo {
  name: string;
  value: string;
  isUnavailable: boolean;
  isRegression: boolean;
  rawScore: number | null;
}

export const getPrimaryMetric = (item: {
  task_type?: string | null;
  algorithm?: string | null;
  primary_metric?: string | null;
  accuracy?: number | null;
  status?: string | null;
}): PrimaryMetricInfo => {
  const isFailed = String(item.status ?? '').toLowerCase() === 'failed';
  const isRunning = String(item.status ?? '').toLowerCase() === 'running';

  // Use persisted task_type - do not infer task type from algorithm name
  const taskTypeLower = item.task_type ? item.task_type.toLowerCase() : null;
  const isRegression = taskTypeLower === 'regression';
  const isClassification = taskTypeLower === 'classification';

  // Determine label: use explicit primary_metric if provided, otherwise derive from persisted task_type
  let name = item.primary_metric;
  if (!name) {
    if (isRegression) {
      name = 'R² Score';
    } else if (isClassification) {
      name = 'Accuracy';
    } else {
      // Historical experiment with missing task_type or metric metadata
      name = 'Score';
    }
  }

  if (isFailed) {
    return { name, value: '— (Failed)', isUnavailable: true, isRegression, rawScore: null };
  }

  if (isRunning) {
    return { name, value: 'Running...', isUnavailable: true, isRegression, rawScore: null };
  }

  if (item.accuracy == null) {
    return { name, value: '—', isUnavailable: true, isRegression, rawScore: null };
  }

  const rawVal = item.accuracy;
  if (typeof rawVal !== 'number' || isNaN(rawVal)) {
    return { name, value: String(rawVal), isUnavailable: false, isRegression, rawScore: null };
  }

  let formattedValue = '—';
  if (isRegression) {
    // Regression: Display actual R² value, normally to 3 decimal places.
    // Preserve negative R² values; never multiply by 100 or label as Accuracy.
    formattedValue = rawVal.toFixed(3);
  } else if (isClassification) {
    // Classification: Format as a percentage only when the stored value is a valid accuracy score in [0, 1].
    if (rawVal >= 0 && rawVal <= 1) {
      formattedValue = `${(rawVal * 100).toFixed(1)}%`;
    } else {
      formattedValue = rawVal.toFixed(3);
    }
  } else {
    // Historical experiment without task_type: do not assume percentage or infer task type
    formattedValue = rawVal.toFixed(3);
  }

  return { name, value: formattedValue, isUnavailable: false, isRegression, rawScore: rawVal };
};

export const formatSecondaryMetric = (key: string, value: unknown): string => {
  if (value == null || value === '' || (typeof value === 'number' && isNaN(value))) {
    return '—';
  }

  if (typeof value !== 'number') {
    return String(value);
  }

  const k = key.toLowerCase();
  if (k === 'accuracy') {
    if (value >= 0 && value <= 1) {
      return `${(value * 100).toFixed(1)}%`;
    }
    return `${value.toFixed(1)}%`;
  }

  if (k === 'precision' || k === 'recall' || k === 'f1' || k === 'f1_score' || k === 'roc_auc') {
    return value.toFixed(3);
  }

  if (k === 'r2' || k === 'r2_score') {
    return value.toFixed(3);
  }

  if (k === 'mae' || k === 'rmse' || k === 'mse') {
    if (Math.abs(value) >= 1000) {
      return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
    }
    return value.toFixed(4);
  }

  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
};
