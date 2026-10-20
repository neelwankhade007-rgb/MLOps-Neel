import React from 'react';
import NotificationCenter from './NotificationCenter';
import ThemeToggle from './ThemeToggle';

export const TopNavbar: React.FC = () => {
  return (
    <header className="z-20 flex h-14 shrink-0 items-center justify-end border-b border-slate-200 bg-white px-4 sm:px-6">
      <div className="flex items-center gap-2">
        <NotificationCenter />
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-slate-200" />
        <ThemeToggle fixed={false} />
      </div>
    </header>
  );
};

export default TopNavbar;
