import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Database,
  Activity,
  Box,
  Rocket,
  GitFork,
  LogOut,
  BrainCircuit,
  User,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../hooks/useAuth';
import ThemeToggle from './ThemeToggle';
import { getCurrentUsername } from '../../utils/auth';

interface NavItemProps {
  to: string;
  icon: React.ElementType;
  children: React.ReactNode;
  badge?: string;
}

const NavItem: React.FC<NavItemProps> = ({ to, icon: Icon, children, badge }) => {
  const location = useLocation();
  const isActive = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));

  return (
    <Link
      to={to}
      className={`flex items-center justify-between px-3 py-2.5 mx-2 rounded-lg transition-all text-xs font-medium ${
        isActive
          ? 'bg-blue-600 text-white shadow-sm'
          : 'text-slate-400 hover:bg-slate-800/60 hover:text-white'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <Icon
          size={18}
          className={`${isActive ? 'text-white' : 'text-slate-400'}`}
        />
        <span>{children}</span>
      </div>
      {badge && (
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
          isActive ? 'bg-blue-700 text-white' : 'bg-slate-800 text-blue-400'
        }`}>
          {badge}
        </span>
      )}
    </Link>
  );
};

export const Sidebar: React.FC = () => {
  const { logout } = useAuth();

  const handleLogout = () => {
    logout(false);
    toast('Logged out');
  };

  const username = getCurrentUsername() || 'User';

  return (
    <aside className="w-60 bg-[#0B1120] text-slate-200 border-r border-slate-800/80 flex flex-col justify-between shrink-0 shadow-lg select-none z-30">
      <div className="flex flex-col">
        {/* Brand Header */}
        <div className="h-14 px-4 flex items-center justify-between border-b border-slate-800/70">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
              <BrainCircuit size={17} />
            </div>
            <span className="font-semibold text-sm tracking-tight text-white font-['Geist',sans-serif]">
              Nexus<span className="text-blue-400 font-normal ml-0.5">MLOps</span>
            </span>
          </div>
          <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/40 font-mono text-[9px] uppercase tracking-wider font-semibold">
            RESEARCH
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex flex-col gap-1 p-2 pt-3">
          <NavItem to="/" icon={LayoutDashboard}>
            Overview
          </NavItem>
          <NavItem to="/datasets" icon={Database}>
            Datasets
          </NavItem>
          <NavItem to="/training" icon={Activity}>
            Training
          </NavItem>
          <NavItem to="/registry" icon={Box}>
            Model Registry
          </NavItem>
          <NavItem to="/predict" icon={Rocket}>
            Predictions
          </NavItem>
          <NavItem to="/inference-monitoring" icon={GitFork} badge="LIVE">
            Adaptive Load Balancing
          </NavItem>
        </nav>
      </div>

      {/* Cluster Status & User Profile Footer */}
      <div className="flex flex-col border-t border-slate-800/80 p-3 gap-2.5">
        {/* Cluster Status Chip */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/90 border border-slate-800">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="font-mono text-[11px] text-slate-300 truncate">
            Minikube-Cluster: Online
          </span>
        </div>

        {/* User Profile Card */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-7 h-7 rounded-full bg-blue-600 flex-shrink-0 flex items-center justify-center text-white">
              <User size={15} />
            </div>
            <div className="flex flex-col truncate">
              <span className="text-xs text-white font-medium truncate">
                {username}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle fixed={false} />
            <button
              onClick={handleLogout}
              className="p-1.5 rounded text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors"
              title="Logout"
              type="button"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
