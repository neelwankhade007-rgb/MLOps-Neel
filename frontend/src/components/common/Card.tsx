import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  hoverable?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  hoverable = false,
  ...props
}) => (
  <div
    className={`bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden transition-all duration-200 ${
      hoverable ? 'hover:shadow-md hover:border-slate-300 hover:-translate-y-0.5' : ''
    } ${className}`}
    {...props}
  >
    {children}
  </div>
);

export default Card;
