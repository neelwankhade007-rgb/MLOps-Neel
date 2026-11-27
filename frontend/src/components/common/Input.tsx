import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  className?: string;
  error?: boolean;
}

export const Input: React.FC<InputProps> = ({
  className = '',
  type,
  onWheel,
  error = false,
  ...props
}) => (
  <input
    type={type}
    onWheel={(e) => {
      if (type === 'number') {
        e.currentTarget.blur();
      }
      onWheel?.(e);
    }}
    className={`w-full px-3.5 py-2.5 bg-white text-sm text-slate-800 rounded-xl border transition-all duration-150 outline-none placeholder:text-slate-400 ${
      error
        ? 'border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-500/15'
        : 'border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15'
    } ${className}`}
    {...props}
  />
);

export default Input;
