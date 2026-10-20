import React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import Card from '../common/Card';

export interface ModelPerformanceItem {
  metric: string;
  value: number;
  unit?: string;
}

export interface ModelPerformanceChartProps {
  data: ModelPerformanceItem[];
}

export const ModelPerformanceChart: React.FC<ModelPerformanceChartProps> = ({
  data,
}) => {
  return (
    <Card className="p-6">
      <div className="mb-5">
        <h2 className="text-lg font-bold text-slate-900">Latest Training Metrics</h2>
        <p className="text-sm text-slate-500">
          Metrics recorded for the latest completed training run
        </p>
      </div>

      {data.length === 0 ? <div className="h-64 flex items-center justify-center text-sm text-slate-500">No recorded metrics from a completed training run.</div> : <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="metric" tick={{ fontSize: 11 }} />
            <YAxis domain={['auto', 'auto']} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(value, _name, item) => [`${value}${item.payload.unit || ''}`, 'Recorded value']} />
            <Bar dataKey="value" fill="#6366f1" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>}
    </Card>
  );
};

export default ModelPerformanceChart;
