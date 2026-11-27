import React from 'react';
import Card from '../common/Card';

export interface StatCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  subtextColor?: string;
  icon: React.ElementType;
  iconBgColor?: string;
  iconColor?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  subtext,
  subtextColor = 'text-emerald-600 dark:text-emerald-400',
  icon: Icon,
  iconBgColor = 'bg-indigo-50 dark:bg-indigo-950/40',
  iconColor = 'text-indigo-600 dark:text-indigo-400',
}) => {
  return (
    <Card className="p-5 hoverable">
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1 pr-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {label}
          </p>
          <p className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white mt-1 font-mono">
            {value}
          </p>
          {subtext && (
            <p className={`text-xs mt-1.5 font-medium truncate ${subtextColor}`}>
              {subtext}
            </p>
          )}
        </div>
        <div className={`p-3 rounded-2xl shrink-0 ${iconBgColor} ${iconColor}`}>
          <Icon size={22} />
        </div>
      </div>
    </Card>
  );
};

export default StatCard;
