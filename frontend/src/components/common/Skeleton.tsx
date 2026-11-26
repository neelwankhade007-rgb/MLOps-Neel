import React from 'react';
import Card from './Card';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className = '', ...props }) => (
  <div
    className={`animate-pulse rounded-lg bg-slate-200/70 ${className}`}
    {...props}
  />
);

export const StatCardSkeleton: React.FC = () => (
  <Card className="p-5">
    <div className="flex items-center justify-between">
      <div className="space-y-2 flex-1">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-3 w-32" />
      </div>
      <Skeleton className="w-12 h-12 rounded-xl" />
    </div>
  </Card>
);

export const ChartCardSkeleton: React.FC<{ title?: string }> = ({ title }) => (
  <Card className="p-6">
    <div className="flex items-center justify-between mb-5">
      <div className="space-y-1.5">
        {title ? (
          <h2 className="text-base font-bold text-slate-900">{title}</h2>
        ) : (
          <Skeleton className="h-5 w-40" />
        )}
        <Skeleton className="h-3.5 w-64" />
      </div>
      <Skeleton className="w-6 h-6 rounded-md" />
    </div>
    <div className="h-64 flex flex-col justify-end gap-3 pt-6">
      <div className="h-full w-full rounded-xl bg-slate-100 flex items-end justify-between p-4 gap-2">
        <Skeleton className="w-full h-1/3 rounded" />
        <Skeleton className="w-full h-2/3 rounded" />
        <Skeleton className="w-full h-1/2 rounded" />
        <Skeleton className="w-full h-4/5 rounded" />
        <Skeleton className="w-full h-3/5 rounded" />
      </div>
    </div>
  </Card>
);

export const ListCardSkeleton: React.FC = () => (
  <Card className="p-5">
    <div className="flex items-start justify-between">
      <Skeleton className="w-11 h-11 rounded-xl" />
      <Skeleton className="w-20 h-5 rounded-full" />
    </div>
    <div className="mt-5 space-y-2">
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-4 w-full" />
    </div>
    <div className="mt-5 pt-4 border-t border-slate-100 space-y-2">
      <div className="flex justify-between">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-12" />
      </div>
      <div className="flex justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
    <Skeleton className="w-full h-10 rounded-xl mt-5" />
  </Card>
);

export default Skeleton;
