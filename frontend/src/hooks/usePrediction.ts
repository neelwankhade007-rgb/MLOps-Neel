import { useState, useEffect, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import { deploymentApi } from '../api/deploymentApi';
import type { Deployment, FeatureSchema } from '../types/deployment';
import type { PredictionHistoryItem } from '../types/prediction';
import { formatLabel } from '../utils/formatters';
import { sanitizeErrorMessage } from '../utils/error';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const extractFeatureSchemas = (schemaData: any): FeatureSchema[] => {
  if (!schemaData) return [];

  const sanitizeOptions = (options: any): any[] => {
    return Array.isArray(options) ? options.filter((o) => typeof o === 'string' || typeof o === 'number') : [];
  };

  const sanitizeName = (rawName: any): string => {
    const str = String(rawName || '').trim();
    return FORBIDDEN_KEYS.has(str) ? '' : str;
  };

  if (Array.isArray(schemaData.features)) {
    return schemaData.features
      .map((item: any): FeatureSchema => {
        if (typeof item === 'object' && item !== null) {
          const rawOptions = sanitizeOptions(item.options);
          let inferredType = item.type;
          if (!inferredType) {
            inferredType = rawOptions.length > 0 ? 'categorical' : 'string';
          }
          return {
            name: sanitizeName(item.name),
            type: inferredType,
            required: item.required ?? true,
            options: rawOptions,
          };
        }
        return {
          name: sanitizeName(item),
          type: 'string',
          required: true,
          options: [],
        };
      })
      .filter((f: FeatureSchema) => Boolean(f.name));
  }

  if (Array.isArray(schemaData)) {
    return schemaData
      .map((item: any): FeatureSchema => {
        if (typeof item === 'object' && item !== null) {
          const rawOptions = sanitizeOptions(item.options);
          let inferredType = item.type;
          if (!inferredType) {
            inferredType = rawOptions.length > 0 ? 'categorical' : 'string';
          }
          return {
            name: sanitizeName(item.name),
            type: inferredType,
            required: item.required ?? true,
            options: rawOptions,
          };
        }
        return {
          name: sanitizeName(item),
          type: 'string',
          required: true,
          options: [],
        };
      })
      .filter((f: FeatureSchema) => Boolean(f.name));
  }

  if (Array.isArray(schemaData.columns)) {
    return schemaData.columns
      .map((item: any): FeatureSchema => {
        if (typeof item === 'object' && item !== null) {
          const rawOptions = sanitizeOptions(item.options);
          return {
            name: sanitizeName(item.name),
            type: item.type || (rawOptions.length > 0 ? 'categorical' : 'string'),
            required: item.required ?? true,
            options: rawOptions,
          };
        }
        return {
          name: sanitizeName(item),
          type: 'string',
          required: true,
          options: [],
        };
      })
      .filter((f: FeatureSchema) => Boolean(f.name));
  }

  if (schemaData.properties && typeof schemaData.properties === 'object') {
    return Object.entries(schemaData.properties)
      .filter(([name]) => !FORBIDDEN_KEYS.has(name))
      .map(
        ([name, prop]: [string, any]): FeatureSchema => ({
          name,
          type:
            prop?.type === 'number' || prop?.type === 'integer'
              ? 'number'
              : Array.isArray(prop?.enum) && prop.enum.length > 0
              ? 'categorical'
              : prop?.type || 'string',
          required: true,
          options: sanitizeOptions(prop?.enum),
        })
      );
  }

  if (schemaData && typeof schemaData === 'object') {
    const rawKeys = Object.keys(schemaData);
    const metaKeys = [
      'deployment_id',
      'model_name',
      'model_version',
      'target_column',
      'encoded_columns',
    ];
    const nonMeta = rawKeys.filter((k) => !metaKeys.includes(k) && !FORBIDDEN_KEYS.has(k));
    const targetKeys = nonMeta.length > 0 ? nonMeta : rawKeys.filter((k) => !FORBIDDEN_KEYS.has(k));
    return targetKeys.map(
      (key): FeatureSchema => ({
        name: key,
        type: 'string',
        required: true,
        options: [],
      })
    );
  }

  return [];
};

export const usePrediction = () => {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [selectedDeploy, setSelectedDeploy] = useState<string>('');
  const [schema, setSchema] = useState<any>(null);
  const [features, setFeatures] = useState<Record<string, any>>({});
  const [prediction, setPrediction] = useState<any>(null);
  const [predictionHistory, setPredictionHistory] = useState<PredictionHistoryItem[]>([]);

  const [loadingDeployments, setLoadingDeployments] = useState(false);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [predicting, setPredicting] = useState(false);

  const loadDeployments = useCallback(async () => {
    setLoadingDeployments(true);
    try {
      const data = await deploymentApi.getDeployments();
      setDeployments(data);

      if (data.length > 0 && !selectedDeploy) {
        setSelectedDeploy(data[0].name || data[0].deployment_name || '');
      }
    } catch (err) {
      toast.error(sanitizeErrorMessage(err, 'Failed to load deployments'));
    } finally {
      setLoadingDeployments(false);
    }
  }, [selectedDeploy]);

  useEffect(() => {
    loadDeployments();
  }, [loadDeployments]);

  const featureList = useMemo((): FeatureSchema[] => {
    return extractFeatureSchemas(schema);
  }, [schema]);

  const featureNames = useMemo((): string[] => {
    return featureList.map((f) => f.name);
  }, [featureList]);

  useEffect(() => {
    if (!selectedDeploy) {
      setSchema(null);
      setFeatures({});
      setPrediction(null);
      return;
    }

    let isCurrent = true;
    setLoadingSchema(true);
    setPrediction(null);

    deploymentApi
      .getDeploymentSchema(selectedDeploy)
      .then((schemaData) => {
        if (!isCurrent) return;
        setSchema(schemaData);

        const extracted = extractFeatureSchemas(schemaData);
        const initialFeatures: Record<string, any> = {};
        extracted.forEach((feature) => {
          if (!FORBIDDEN_KEYS.has(feature.name)) {
            initialFeatures[feature.name] = '';
          }
        });
        setFeatures(initialFeatures);
      })
      .catch((err) => {
        if (!isCurrent) return;
        toast.error(sanitizeErrorMessage(err, 'Failed to load model schema'));
        setSchema(null);
        setFeatures({});
      })
      .finally(() => {
        if (isCurrent) setLoadingSchema(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [selectedDeploy]);

  const handleFeatureChange = (feature: string, value: string) => {
    const key = String(feature).trim();
    if (FORBIDDEN_KEYS.has(key)) return;

    setFeatures((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const runPrediction = async (e?: React.FormEvent): Promise<boolean> => {
    if (e) e.preventDefault();

    if (!selectedDeploy) {
      toast.error('Please select an active deployment');
      return false;
    }

    if (featureList.length === 0) {
      toast.error('No input features discovered for this model');
      return false;
    }

    const missingFeature = featureList.find(
      (feature: FeatureSchema) =>
        feature.required &&
        (features[feature.name] === undefined ||
          String(features[feature.name]).trim() === '')
    );

    if (missingFeature) {
      toast.error(`Please provide a value for ${formatLabel(missingFeature.name)}`);
      return false;
    }

    setPredicting(true);

    try {
      const payload: Record<string, any> = {};
      featureList.forEach((feature: FeatureSchema) => {
        if (FORBIDDEN_KEYS.has(feature.name)) return;
        const val = features[feature.name];
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          const trimmed = String(val).trim();
          const normalizedType = String(feature.type || '').toLowerCase();

          if (
            normalizedType === 'number' ||
            normalizedType === 'numeric' ||
            normalizedType === 'float' ||
            normalizedType === 'int' ||
            normalizedType === 'integer'
          ) {
            const num = Number(trimmed);
            payload[feature.name] = !Number.isNaN(num) ? num : trimmed;
          } else if (normalizedType === 'boolean' || normalizedType === 'bool') {
            payload[feature.name] = trimmed.toLowerCase() === 'true';
          } else {
            const num = Number(trimmed);
            if (!Number.isNaN(num) && (!feature.options || feature.options.length === 0)) {
              payload[feature.name] = num;
            } else {
              payload[feature.name] = trimmed;
            }
          }
        } else {
          payload[feature.name] = '';
        }
      });

      const res = await deploymentApi.predict(selectedDeploy, {
        features: payload,
      });

      const result =
        res?.prediction ??
        res?.predicted_value ??
        res?.result ??
        res;

      setPrediction(result);

      const historyItem: PredictionHistoryItem = {
        id: Date.now(),
        deployment: selectedDeploy,
        prediction: result,
        time: new Date().toLocaleTimeString(),
      };

      setPredictionHistory((prev) => [historyItem, ...prev].slice(0, 15));
      toast.success('Prediction generated successfully');
      return true;
    } catch (err) {
      toast.error(sanitizeErrorMessage(err, 'Prediction failed. Check input data.'));
      setPrediction(null);
      return false;
    } finally {
      setPredicting(false);
    }
  };

  const selectedDeployment = deployments.find(
    (deployment) =>
      (deployment.name || deployment.deployment_name) === selectedDeploy
  );

  return {
    deployments,
    selectedDeploy,
    setSelectedDeploy,
    selectedDeployment,
    schema,
    features,
    prediction,
    predictionHistory,
    loadingDeployments,
    loadingSchema,
    predicting,
    featureList,
    featureNames,
    handleFeatureChange,
    runPrediction,
    clearHistory: () => {
      setPredictionHistory([]);
      toast.success('Prediction history cleared');
    },
    refreshDeployments: loadDeployments,
  };
};

export default usePrediction;
