import React from 'react';
import { Loader2 } from 'lucide-react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  className?: string;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  icon,
  ...props
}) => {
  const base =
    'inline-flex items-center justify-center font-medium rounded-xl whitespace-nowrap transition-all duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none select-none active:scale-[0.96] hover:-translate-y-0.5 cursor-pointer';

  const sizes = {
    sm: 'px-3 py-1.5 text-xs gap-1.5',
    md: 'px-4 py-2 text-sm gap-2',
    lg: 'px-5 py-2.5 text-base gap-2.5',
  };

  const variants = {
    primary:
      'bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800 focus:ring-indigo-500 shadow-sm shadow-indigo-600/25 hover:shadow-indigo-600/40 hover:shadow-md dark:shadow-indigo-900/40',
    secondary:
      'bg-slate-100 dark:bg-neutral-800 text-slate-800 dark:text-neutral-200 hover:bg-slate-200 dark:hover:bg-neutral-700 active:bg-slate-300 dark:active:bg-neutral-600 focus:ring-slate-400 border border-slate-200/80 dark:border-neutral-700 shadow-xs hover:shadow-sm',
    danger:
      'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/60 active:bg-rose-200 focus:ring-rose-500 border border-rose-200 dark:border-rose-900/50 shadow-xs hover:shadow-sm',
    ghost:
      'bg-transparent text-slate-600 dark:text-neutral-300 hover:bg-slate-100 dark:hover:bg-neutral-800 active:bg-slate-200 dark:active:bg-neutral-700 focus:ring-slate-400 hover:shadow-none',
    outline:
      'bg-transparent text-slate-700 dark:text-neutral-300 border border-slate-200 dark:border-neutral-700 hover:bg-slate-50 dark:hover:bg-neutral-800/60 hover:border-slate-300 dark:hover:border-neutral-600 focus:ring-indigo-500 shadow-xs',
  };

  return (
    <button
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <Loader2 size={size === 'sm' ? 14 : size === 'lg' ? 18 : 16} className="animate-spin shrink-0" />
      ) : icon ? (
        <span className="shrink-0 inline-flex items-center [&>svg]:inline-block [&>svg]:shrink-0">{icon}</span>
      ) : null}
      <span className="inline-flex items-center justify-center gap-2 whitespace-nowrap [&>svg]:shrink-0 [&>svg]:inline-block">
        {children}
      </span>
    </button>
  );
};

export default Button;
