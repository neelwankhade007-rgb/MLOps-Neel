import React from 'react';
import { Menu, ShieldCheck } from 'lucide-react';
import NotificationCenter from './NotificationCenter';
import ThemeToggle from './ThemeToggle';

export interface TopNavbarProps {
  onOpenMobileNav?: () => void;
}

export const TopNavbar: React.FC<TopNavbarProps> = ({ onOpenMobileNav }) => {
  return (
    <header className="z-20 flex h-14 shrink-0 items-center justify-between border-b border-slate-200 dark:border-[#262626] bg-white dark:bg-[#151515] px-4 sm:px-6">
      <div className="flex items-center gap-3">
        {/* Mobile Hamburger Toggle Button */}
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label="Open mobile navigation menu"
          className="lg:hidden p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <Menu size={20} />
        </button>

        {/* Cluster / Environment Status Indicator */}
        <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-[#1f1f1f] text-xs font-medium text-slate-700 dark:text-slate-300">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="text-[11px] font-mono">Cluster: mlops-primary</span>
          <ShieldCheck size={13} className="text-emerald-600 dark:text-emerald-400" />
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <NotificationCenter />
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-slate-200 dark:bg-[#262626]" />
        <ThemeToggle fixed={false} />
      </div>
    </header>
  );
};

export default TopNavbar;
