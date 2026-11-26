import React from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { Rocket } from 'lucide-react';
import Card from '../common/Card';
import { ChartCardSkeleton } from '../common/Skeleton';

export interface DeploymentHealthItem {
  name: string;
  value: number;
}

export interface DeploymentHealthChartProps {
  data: DeploymentHealthItem[];
  colors?: string[];
  loading?: boolean;
}

const defaultColors = ['#10b981', '#f59e0b', '#ef4444', '#6366f1'];

export const DeploymentHealthChart: React.FC<DeploymentHealthChartProps> = ({
  data,
  colors = defaultColors,
  loading = false,
}) => {
  if (loading) {
    return <ChartCardSkeleton title="Deployment Status" />;
  }

  const isEmpty = data.length === 0;

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Deployment Status</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Operational status distribution across served models
          </p>
        </div>
        <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
          <Rocket size={18} />
        </div>
      </div>

      {isEmpty ? (
        <div className="h-56 flex flex-col items-center justify-center text-center text-slate-400">
          <Rocket size={28} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400">No active deployments</p>
          <p className="text-xs text-slate-400 mt-1">Deploy registered models to observe status breakdowns.</p>
        </div>
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="45%"
                innerRadius={50}
                outerRadius={75}
                paddingAngle={4}
                dataKey="value"
              >
                {data.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  borderColor: '#334155',
                  borderRadius: '0.75rem',
                  color: '#ffffff',
                  fontSize: '12px',
                }}
              />
              <Legend
                verticalAlign="bottom"
                height={32}
                iconType="circle"
                wrapperStyle={{ fontSize: '12px', color: '#64748b' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
};

export default DeploymentHealthChart;
