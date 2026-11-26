import React, { useState } from 'react';
import { CheckCircle2, BrainCircuit, Trash2 } from 'lucide-react';
import Card from '../common/Card';
import ConfirmDialog from '../common/ConfirmDialog';
import type { PredictionHistoryItem } from '../../types/prediction';

export interface PredictionResultCardProps {
  prediction: any;
}

export const PredictionResultCard: React.FC<PredictionResultCardProps> = ({ prediction }) => {
  return (
    <Card className="overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-100 dark:border-[#262626]">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={20} />
          </div>
          <div>
            <h2 className="font-bold text-slate-900 dark:text-white text-base">Inference Output</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Latest serving prediction response</p>
          </div>
        </div>
      </div>

      <div className="p-6">
        {prediction !== null ? (
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400">
              Predicted Result
            </div>

            <div className="mt-4 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 p-6">
              <p className="text-3xl sm:text-4xl font-mono font-bold text-emerald-700 dark:text-emerald-300 break-words">
                {typeof prediction === 'object'
                  ? JSON.stringify(prediction, null, 2)
                  : String(prediction)}
              </p>
            </div>

            <div className="mt-4 flex items-center justify-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 size={15} />
              <span>Inference query executed successfully</span>
            </div>
          </div>
        ) : (
          <div className="py-10 text-center">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
              <BrainCircuit size={26} />
            </div>

            <h3 className="mt-4 text-sm font-bold text-slate-800 dark:text-slate-200">
              Awaiting Prediction
            </h3>

            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
              Supply input attributes in the form and click "Run Prediction".
            </p>
          </div>
        )}
      </div>
    </Card>
  );
};

export interface PredictionHistoryProps {
  history: PredictionHistoryItem[];
  onClearHistory?: () => void;
}

export const PredictionHistory: React.FC<PredictionHistoryProps> = ({
  history,
  onClearHistory,
}) => {
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Recent Predictions</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              History of inference queries generated during the active browser session
            </p>
          </div>

          {onClearHistory && history.length > 0 && (
            <button
              type="button"
              onClick={() => setShowClearConfirm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-xl border border-red-200 dark:border-red-900/50 transition-colors"
              title="Clear prediction history"
            >
              <Trash2 size={13} />
              <span>Clear History</span>
            </button>
          )}
        </div>

        {history.length > 0 ? (
          <Card className="overflow-hidden">
            <div className="divide-y divide-slate-100 dark:divide-[#262626]">
              {history.map((item) => (
                <div
                  key={item.id}
                  className="px-6 py-3.5 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 size={16} />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        {item.deployment}
                      </p>
                      <p className="text-[11px] font-mono text-slate-400 mt-0.5">{item.time}</p>
                    </div>
                  </div>

                  <div className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300 break-all px-3 py-1 rounded-lg bg-slate-50 dark:bg-[#1a1a1a] border border-slate-200 dark:border-[#262626]">
                    {typeof item.prediction === 'object'
                      ? JSON.stringify(item.prediction)
                      : String(item.prediction)}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : (
          <Card className="p-8 text-center">
            <p className="text-xs text-slate-400">
              No predictions recorded during this session.
            </p>
          </Card>
        )}
      </div>

      <ConfirmDialog
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={() => {
          setShowClearConfirm(false);
          onClearHistory?.();
        }}
        title="Clear Prediction History"
        message="Are you sure you want to clear your local session prediction history?"
        confirmLabel="Clear History"
        variant="danger"
      />
    </>
  );
};

export default PredictionHistory;
