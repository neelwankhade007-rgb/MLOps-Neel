import React from 'react';

export interface HeaderProps {
  title: string;
  subtitle?: string;
  category?: string;
  action?: React.ReactNode;
}

export const Header: React.FC<HeaderProps> = ({ title, subtitle, category, action }) => {
  return (
    <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 pb-2">
      <div>
        {category && (
          <p className="text-xs font-semibold tracking-wider uppercase text-indigo-600 dark:text-indigo-400 mb-1">
            {category}
          </p>
        )}
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
};

export default Header;
