import React from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { TrendingUp, Calendar } from 'lucide-react';
import Card from '../common/Card';
import { ChartCardSkeleton } from '../common/Skeleton';

export interface TrainingActivityItem {
  month: string;
  jobs: number;
}

export interface TrainingActivityChartProps {
  data: TrainingActivityItem[];
  loading?: boolean;
}

export const TrainingActivityChart: React.FC<TrainingActivityChartProps> = ({
  data,
  loading = false,
}) => {
  if (loading) {
    return <ChartCardSkeleton title="Training Activity" />;
  }

  const isEmpty = data.length === 0 || data.every((item) => item.jobs === 0);

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Training Activity</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Completed training jobs by month (last 6 months)
          </p>
        </div>
        <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
          <TrendingUp size={18} />
        </div>
      </div>

      {isEmpty ? (
        <div className="h-64 flex flex-col items-center justify-center text-center text-slate-400">
          <Calendar size={28} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400">No training activity recorded</p>
          <p className="text-xs text-slate-400 mt-1">Execute training jobs to populate the trend history.</p>
        </div>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.6} />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 11, fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
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
                itemStyle={{ color: '#818cf8' }}
              />
              <Line
                type="monotone"
                dataKey="jobs"
                name="Completed Jobs"
                stroke="#4f46e5"
                strokeWidth={2.5}
                dot={{
                  r: 4,
                  fill: '#4f46e5',
                  strokeWidth: 2,
                  stroke: '#ffffff',
                }}
                activeDot={{
                  r: 6,
                  fill: '#4338ca',
                }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
};

export default TrainingActivityChart;
