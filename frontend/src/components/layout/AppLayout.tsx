import React, { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import TopNavbar from './TopNavbar';

export interface AppLayoutProps {
  children: React.ReactNode;
}

const SIDEBAR_STORAGE_KEY = 'nexus-sidebar-collapsed';

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarCollapsed));
    } catch {
      // Storage unavailable fallback
    }
  }, [sidebarCollapsed]);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-[#0a0a0a]">
      {/* Sidebar with Desktop Collapse + Mobile Drawer */}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((collapsed) => !collapsed)}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNavbar onOpenMobileNav={() => setMobileNavOpen(true)} />

        <main className="flex-1 overflow-auto">
          <div className="mx-auto min-h-full w-full max-w-[1680px] px-4 py-5 sm:px-6 sm:py-6 xl:px-8 xl:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
