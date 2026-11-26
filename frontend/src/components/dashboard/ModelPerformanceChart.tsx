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
import { BarChart2, Award } from 'lucide-react';
import Card from '../common/Card';
import { ChartCardSkeleton } from '../common/Skeleton';

export interface ModelPerformanceItem {
  metric: string;
  value: number;
  unit?: string;
}

export interface ModelPerformanceChartProps {
  data: ModelPerformanceItem[];
  loading?: boolean;
}

export const ModelPerformanceChart: React.FC<ModelPerformanceChartProps> = ({
  data,
  loading = false,
}) => {
  if (loading) {
    return <ChartCardSkeleton title="Latest Training Metrics" />;
  }

  const isEmpty = data.length === 0;

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Latest Training Metrics</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Confirmed evaluation metrics from the most recent completed run
          </p>
        </div>
        <div className="p-2 rounded-xl bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400">
          <BarChart2 size={18} />
        </div>
      </div>

      {isEmpty ? (
        <div className="h-64 flex flex-col items-center justify-center text-center text-slate-400">
          <Award size={28} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400">No evaluation metrics recorded</p>
          <p className="text-xs text-slate-400 mt-1">Complete a training job to view evaluation scores.</p>
        </div>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.6} />
              <XAxis
                dataKey="metric"
                tick={{ fontSize: 11, fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={['auto', 'auto']}
                tick={{ fontSize: 11, fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  borderColor: '#334155',
                  borderRadius: '0.75rem',
                  color: '#ffffff',
                  fontSize: '12px',
                }}
                formatter={(value: any, _name: any, item: any) => [
                  `${typeof value === 'number' ? value.toFixed(3) : value}${item.payload.unit || ''}`,
                  'Score',
                ]}
              />
              <Bar
                dataKey="value"
                name="Score"
                fill="#6366f1"
                radius={[6, 6, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
};

export default ModelPerformanceChart;
