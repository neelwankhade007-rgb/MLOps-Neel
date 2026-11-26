import React from 'react';
import Card from '../common/Card';
import { Activity, Clock } from 'lucide-react';

export interface RecentActivityItem {
  type: 'success' | 'warning' | 'error';
  title: string;
  description: string;
  time: string;
}

export interface RecentActivityProps {
  activities: RecentActivityItem[];
}

export const RecentActivity: React.FC<RecentActivityProps> = ({ activities }) => {
  return (
    <Card className="p-6 xl:col-span-2">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Recent Activity</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Latest timestamped events across datasets, training jobs, and deployments
          </p>
        </div>
        <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500">
          <Activity size={18} />
        </div>
      </div>

      {activities.length === 0 ? (
        <div className="py-12 text-center text-slate-400">
          <Clock size={28} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400">No recorded activity yet</p>
          <p className="text-xs text-slate-400 mt-1">Actions performed on datasets and models will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3.5">
          {activities.map((item, index) => {
            const dotColor =
              item.type === 'error'
                ? 'bg-rose-500 ring-4 ring-rose-500/15'
                : item.type === 'warning'
                ? 'bg-amber-500 ring-4 ring-amber-500/15'
                : 'bg-emerald-500 ring-4 ring-emerald-500/15';

            return (
              <div
                key={`${item.title}-${item.time}-${index}`}
                className="flex items-start gap-3 p-3 rounded-xl bg-slate-50/70 dark:bg-[#1a1a1a] border border-slate-100 dark:border-[#262626] transition-colors"
              >
                <div className="mt-1.5 shrink-0">
                  <div className={`w-2.5 h-2.5 rounded-full ${dotColor}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {item.title}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                    {item.description}
                  </p>
                </div>
                <span className="text-[11px] font-mono text-slate-400 shrink-0">
                  {item.time}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};

export default RecentActivity;
