import React, { useEffect } from 'react';
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
  X,
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
  onNavigate?: () => void;
}

const NavItem: React.FC<NavItemProps> = ({ to, icon: Icon, label, collapsed, onNavigate }) => {
  const location = useLocation();
  const isActive = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));

  return (
    <Link
      to={to}
      onClick={onNavigate}
      aria-label={label}
      title={collapsed ? label : undefined}
      className={`group relative mx-2 flex min-h-11 items-center rounded-xl text-sm font-medium transition-all duration-150 ${
        collapsed ? 'justify-center px-0' : 'gap-3 px-3'
      } ${
        isActive
          ? 'bg-indigo-600/20 text-white ring-1 ring-inset ring-indigo-500/30'
          : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-100'
      }`}
    >
      {isActive && <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-indigo-500" />}
      <Icon
        size={18}
        className={isActive ? 'text-indigo-400' : 'text-slate-400 group-hover:text-slate-200'}
      />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
};

export interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  collapsed,
  onToggle,
  mobileOpen = false,
  onCloseMobile,
}) => {
  const { logout } = useAuth();
  const location = useLocation();
  const username = getCurrentUsername() || 'User';

  // Automatically close mobile menu on route change
  useEffect(() => {
    onCloseMobile?.();
  }, [location.pathname, onCloseMobile]);

  const handleLogout = () => {
    logout(false);
    toast.success('Logged out successfully');
  };

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Overview' },
    { to: '/datasets', icon: Database, label: 'Datasets' },
    { to: '/training', icon: Activity, label: 'Training' },
    { to: '/registry', icon: Box, label: 'Model Registry' },
    { to: '/predict', icon: Rocket, label: 'Predictions' },
    { to: '/inference-monitoring', icon: GitFork, label: 'Adaptive Load Balancing' },
  ];

  const sidebarContent = (
    <div className="flex h-full flex-col bg-[#0B1120] text-slate-200">
      {/* Sidebar Header */}
      <div
        className={`flex h-16 shrink-0 items-center border-b border-slate-800/80 ${
          collapsed ? 'justify-center px-2' : 'justify-between px-4'
        }`}
      >
        <div className={`flex min-w-0 items-center ${collapsed ? 'justify-center' : 'gap-3'}`}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-lg shadow-indigo-950/40">
            <BrainCircuit size={19} />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight text-white">Nexus MLOps</p>
              <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-indigo-400">
                Workspace
              </p>
            </div>
          )}
        </div>

        {/* Desktop Collapse Toggle */}
        {!collapsed && (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="hidden lg:flex rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          >
            <ChevronLeft size={17} />
          </button>
        )}

        {/* Mobile Close Button */}
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close menu"
          className="lg:hidden rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
        >
          <X size={18} />
        </button>
      </div>

      {/* Desktop Expand Button when collapsed */}
      {collapsed && (
        <button
          type="button"
          onClick={onToggle}
          aria-label="Expand sidebar"
          title="Expand sidebar"
          className="mx-auto mt-3 hidden lg:flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
        >
          <ChevronRight size={17} />
        </button>
      )}

      {/* Navigation Links */}
      <nav aria-label="Main navigation" className={`flex flex-1 flex-col gap-1 overflow-y-auto py-4 ${collapsed ? 'px-1' : 'px-2'}`}>
        {!collapsed && (
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Navigation
          </p>
        )}
        {navItems.map((item) => (
          <NavItem
            key={item.to}
            {...item}
            collapsed={collapsed}
            onNavigate={onCloseMobile}
          />
        ))}
      </nav>

      {/* User and Session Footer */}
      <div className={`shrink-0 border-t border-slate-800/80 ${collapsed ? 'flex flex-col items-center gap-2 p-2' : 'p-3'}`}>
        {collapsed ? (
          <>
            <div
              title={username}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-indigo-300 font-semibold text-xs"
            >
              <User size={16} />
            </div>
            <ThemeToggle fixed={false} />
            <button
              type="button"
              onClick={handleLogout}
              aria-label="Logout"
              title="Logout"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-400 focus:outline-none focus:ring-2 focus:ring-red-400/50"
            >
              <LogOut size={16} />
            </button>
          </>
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.04] p-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-800 text-indigo-300 font-semibold text-xs">
                <User size={16} />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-white">{username}</p>
                <p className="text-[10px] text-slate-500">MLOps Engineer</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <ThemeToggle fixed={false} />
              <button
                type="button"
                onClick={handleLogout}
                aria-label="Logout"
                title="Logout"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-400 focus:outline-none focus:ring-2 focus:ring-red-400/50"
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <aside
        className={`hidden lg:flex z-30 h-full shrink-0 flex-col border-r border-slate-800 bg-[#0B1120] transition-[width] duration-200 ${
          collapsed ? 'w-[72px]' : 'w-64'
        }`}
      >
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Backdrop & Slide-out */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs transition-opacity"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative flex w-72 max-w-[85vw] flex-col z-10 shadow-2xl animate-in slide-in-from-left duration-200">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
};

export default Sidebar;
