import React from 'react';
import { Server } from 'lucide-react';
import NotificationCenter from './NotificationCenter';
import ThemeToggle from './ThemeToggle';

export const TopNavbar: React.FC = () => {
  return (
    <header className="h-16 px-6 sm:px-8 border-b border-slate-200 bg-white/90 backdrop-blur-sm flex items-center justify-between shrink-0 z-20">
      {/* Left: Operational Environment Banner */}
      <div className="flex items-center gap-3 text-xs">
        <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-medium border border-emerald-200/60">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="tracking-wide">MLOps Engine Online</span>
        </div>

        <div className="hidden sm:flex items-center gap-1.5 text-slate-500">
          <Server size={14} className="text-slate-400" />
          <span className="font-mono">cluster/minikube-mlops</span>
        </div>
      </div>

      {/* Right: Operational Controls & Notification Center */}
      <div className="flex items-center gap-4">
        <NotificationCenter />
        <div className="h-5 w-px bg-slate-200" />
        <ThemeToggle fixed={false} />
      </div>
    </header>
  );
};

export default TopNavbar;
