import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Activity,
  BrainCircuit,
  Box,
  ChevronLeft,
  ChevronRight,
  Database,
  GitFork,
  LayoutDashboard,
  LogOut,
  Rocket,
  User,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../hooks/useAuth';
import ThemeToggle from './ThemeToggle';
import { getCurrentUsername } from '../../utils/auth';

interface NavItemProps {
  to: string;
  icon: React.ElementType;
  label: string;
  collapsed: boolean;
}

const NavItem: React.FC<NavItemProps> = ({ to, icon: Icon, label, collapsed }) => {
  const location = useLocation();
  const isActive = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));

  return (
    <Link
      to={to}
      aria-label={label}
      title={collapsed ? label : undefined}
      className={`group relative mx-2 flex min-h-11 items-center rounded-xl text-sm font-medium transition-colors ${
        collapsed ? 'justify-center px-0' : 'gap-3 px-3'
      } ${
        isActive
          ? 'bg-blue-500/15 text-white ring-1 ring-inset ring-blue-400/20'
          : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-100'
      }`}
    >
      {isActive && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-blue-400" />}
      <Icon size={18} className={isActive ? 'text-blue-300' : 'text-slate-400 group-hover:text-slate-200'} />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
};

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ collapsed, onToggle }) => {
  const { logout } = useAuth();
  const username = getCurrentUsername() || 'User';

  const handleLogout = () => {
    logout(false);
    toast('Logged out');
  };

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Overview' },
    { to: '/datasets', icon: Database, label: 'Datasets' },
    { to: '/training', icon: Activity, label: 'Training' },
    { to: '/registry', icon: Box, label: 'Model Registry' },
    { to: '/predict', icon: Rocket, label: 'Predictions' },
    { to: '/inference-monitoring', icon: GitFork, label: 'Adaptive Load Balancing' },
  ];

  return (
    <aside
      className={`z-30 flex h-full shrink-0 flex-col border-r border-slate-800 bg-[#0B1120] text-slate-200 transition-[width] duration-200 ${
        collapsed ? 'w-[72px]' : 'w-64'
      }`}
    >
      <div className={`flex h-16 shrink-0 items-center border-b border-slate-800/80 ${collapsed ? 'justify-center px-2' : 'justify-between px-4'}`}>
        <div className={`flex min-w-0 items-center ${collapsed ? 'justify-center' : 'gap-3'}`}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-950/30">
            <BrainCircuit size={19} />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight text-white">Nexus MLOps</p>
              <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">Workspace</p>
            </div>
          )}
        </div>
        {!collapsed && (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-400/60"
          >
            <ChevronLeft size={17} />
          </button>
        )}
      </div>

      {collapsed && (
        <button
          type="button"
          onClick={onToggle}
          aria-label="Expand sidebar"
          title="Expand sidebar"
          className="mx-auto mt-3 flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-400/60"
        >
          <ChevronRight size={17} />
        </button>
      )}

      <nav aria-label="Main navigation" className={`flex flex-1 flex-col gap-1 overflow-y-auto py-4 ${collapsed ? 'px-1' : 'px-2'}`}>
        {!collapsed && <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Workspace</p>}
        {navItems.map((item) => (
          <NavItem key={item.to} {...item} collapsed={collapsed} />
        ))}
      </nav>

      <div className={`shrink-0 border-t border-slate-800/80 ${collapsed ? 'flex flex-col items-center gap-2 p-2' : 'p-3'}`}>
        {collapsed ? (
          <>
            <div title={username} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-blue-200">
              <User size={16} />
            </div>
            <ThemeToggle fixed={false} />
            <button
              type="button"
              onClick={handleLogout}
              aria-label="Logout"
              title="Logout"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-300 focus:outline-none focus:ring-2 focus:ring-red-400/50"
            >
              <LogOut size={16} />
            </button>
          </>
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.04] p-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-800 text-blue-200">
                <User size={16} />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-white">{username}</p>
                <p className="text-[10px] text-slate-500">Account</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <ThemeToggle fixed={false} />
              <button
                type="button"
                onClick={handleLogout}
                aria-label="Logout"
                title="Logout"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-300 focus:outline-none focus:ring-2 focus:ring-red-400/50"
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;
