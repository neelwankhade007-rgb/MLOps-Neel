import React from 'react';
import { BrainCircuit, Loader2 } from 'lucide-react';

export interface LoadingProps {
  message?: string;
  fullScreen?: boolean;
}

export const Loading: React.FC<LoadingProps> = ({
  message = 'Loading...',
  fullScreen = false,
}) => {
  if (fullScreen) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="flex flex-col items-center p-8 rounded-2xl bg-white border border-slate-200/80 shadow-sm max-w-sm text-center">
          <div className="relative mb-4">
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 animate-pulse">
              <BrainCircuit size={32} />
            </div>
            <div className="absolute -bottom-1 -right-1 p-1 rounded-full bg-white shadow-xs">
              <Loader2 size={16} className="text-indigo-600 animate-spin" />
            </div>
          </div>
          <p className="text-sm font-semibold text-slate-900">{message}</p>
          <p className="text-xs text-slate-400 mt-1">Connecting to Nexus MLOps engine</p>
        </div>
      </div>
    );
  }

  return (
    <div className="py-12 flex flex-col items-center justify-center text-center">
      <div className="relative">
        <div className="w-10 h-10 rounded-full border-2 border-indigo-100 border-t-indigo-600 animate-spin" />
      </div>
      {message && <p className="mt-3 text-xs font-medium text-slate-500">{message}</p>}
    </div>
  );
};

export default Loading;
