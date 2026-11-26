import React, { useMemo } from 'react';
import { BrainCircuit, Rocket, Activity, Play, Loader2 } from 'lucide-react';
import Card from '../common/Card';
import Button from '../common/Button';
import type { FeatureSchema } from '../../types/deployment';
import { formatLabel } from '../../utils/formatters';

export interface PredictionFormProps {
  selectedDeploy: string;
  loadingSchema: boolean;
  featureList?: FeatureSchema[];
  featureNames?: string[];
  features: Record<string, any>;
  predicting: boolean;
  onFeatureChange: (feature: string, value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

export const PredictionForm: React.FC<PredictionFormProps> = ({
  selectedDeploy,
  loadingSchema,
  featureList,
  featureNames,
  features,
  predicting,
  onFeatureChange,
  onSubmit,
}) => {
  const resolvedFeatures: FeatureSchema[] = useMemo(() => {
    if (featureList && featureList.length > 0) {
      return featureList;
    }
    if (featureNames && featureNames.length > 0) {
      return featureNames.map((name) => ({
        name,
        type: 'string',
        required: true,
        options: [],
      }));
    }
    return [];
  }, [featureList, featureNames]);

  return (
    <Card className="xl:col-span-2 overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-100 dark:border-[#262626]">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400">
            <BrainCircuit size={20} />
          </div>

          <div>
            <h2 className="font-bold text-slate-900 dark:text-white text-base">Model Input Features</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Enter the input attributes required by the serving model schema.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={onSubmit} className="p-6">
        {!selectedDeploy ? (
          <div className="py-12 text-center">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
              <Rocket size={26} />
            </div>

            <h3 className="mt-4 text-base font-bold text-slate-800 dark:text-slate-200">
              Select an endpoint
            </h3>

            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
              Choose an active model deployment above to load its input feature schema.
            </p>
          </div>
        ) : loadingSchema ? (
          <div className="py-12 flex flex-col items-center justify-center text-center">
            <Loader2 size={32} className="text-indigo-600 animate-spin" />
            <p className="mt-3 text-xs font-semibold text-slate-600 dark:text-slate-400">
              Inspecting model signature & feature schema...
            </p>
          </div>
        ) : resolvedFeatures.length === 0 ? (
          <div className="py-12 text-center">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center text-amber-500">
              <Activity size={26} />
            </div>

            <h3 className="mt-4 text-base font-bold text-slate-800 dark:text-slate-200">
              No input features discovered
            </h3>

            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
              The selected deployment did not expose structured input column metadata.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {resolvedFeatures.map((feature: FeatureSchema) => {
                const isCategorical =
                  feature.type === 'categorical' &&
                  Array.isArray(feature.options) &&
                  feature.options.length > 0;
                const isBoolean =
                  feature.type === 'boolean' || feature.type === 'bool';
                const isNumber =
                  feature.type === 'number' ||
                  feature.type === 'numeric' ||
                  feature.type === 'float' ||
                  feature.type === 'int' ||
                  feature.type === 'integer';

                return (
                  <div key={feature.name}>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
                      {formatLabel(feature.name)}{' '}
                      {feature.required && <span className="text-red-500">*</span>}
                    </label>

                    {isCategorical ? (
                      <select
                        value={features[feature.name] ?? ''}
                        onChange={(e) => onFeatureChange(feature.name, e.target.value)}
                        required={feature.required}
                        className="w-full rounded-xl border border-slate-200 dark:border-[#262626] bg-white dark:bg-[#151515] px-3.5 py-2.5 text-xs text-slate-800 dark:text-slate-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 transition-all"
                      >
                        <option value="">-- Select {formatLabel(feature.name)} --</option>
                        {feature.options!.map((opt: any) => (
                          <option key={String(opt)} value={String(opt)}>
                            {String(opt)}
                          </option>
                        ))}
                      </select>
                    ) : isBoolean ? (
                      <select
                        value={features[feature.name] ?? ''}
                        onChange={(e) => onFeatureChange(feature.name, e.target.value)}
                        required={feature.required}
                        className="w-full rounded-xl border border-slate-200 dark:border-[#262626] bg-white dark:bg-[#151515] px-3.5 py-2.5 text-xs text-slate-800 dark:text-slate-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 transition-all"
                      >
                        <option value="">-- Select --</option>
                        <option value="true">True</option>
                        <option value="false">False</option>
                      </select>
                    ) : (
                      <input
                        type={isNumber ? 'number' : 'text'}
                        step={isNumber ? 'any' : undefined}
                        value={features[feature.name] ?? ''}
                        onChange={(e) => onFeatureChange(feature.name, e.target.value)}
                        onWheel={isNumber ? (e) => e.currentTarget.blur() : undefined}
                        placeholder={`Enter ${formatLabel(feature.name)}`}
                        required={feature.required}
                        className="w-full rounded-xl border border-slate-200 dark:border-[#262626] bg-white dark:bg-[#151515] px-3.5 py-2.5 text-xs text-slate-800 dark:text-slate-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 transition-all"
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-6 flex items-center justify-between p-3.5 rounded-xl border border-slate-100 dark:border-[#262626] bg-slate-50/70 dark:bg-[#1a1a1a]">
              <span className="text-xs text-slate-500 dark:text-slate-400">Features required</span>
              <span className="font-mono font-bold text-xs text-indigo-600 dark:text-indigo-400">
                {resolvedFeatures.length} attributes detected
              </span>
            </div>

            <div className="flex justify-end mt-6">
              <Button
                type="submit"
                loading={predicting}
                icon={<Play size={14} className="fill-current shrink-0" />}
              >
                {predicting ? 'Executing Inference...' : 'Run Prediction'}
              </Button>
            </div>
          </>
        )}
      </form>
    </Card>
  );
};

export default PredictionForm;
