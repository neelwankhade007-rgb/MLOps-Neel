import React from 'react';
import Sidebar from './Sidebar';
import TopNavbar from './TopNavbar';

export interface AppLayoutProps {
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopNavbar />
        <main className="flex-1 overflow-auto">
          <div className="p-8 md:p-12 pb-24 h-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
