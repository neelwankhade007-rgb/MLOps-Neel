import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { deploymentApi } from '../api/deploymentApi';
import type { Deployment, FeatureSchema } from '../types/deployment';
import type { PredictionHistoryItem } from '../types/prediction';
import { formatLabel } from '../utils/formatters';

export const extractFeatureSchemas = (schemaData: any): FeatureSchema[] => {
  if (!schemaData) return [];

  if (Array.isArray(schemaData.features)) {
    return schemaData.features
      .map((item: any): FeatureSchema => {
        if (typeof item === 'object' && item !== null) {
          const rawOptions = Array.isArray(item.options) ? item.options : [];
          let inferredType = item.type;
          if (!inferredType) {
            if (rawOptions.length > 0) {
              inferredType = 'categorical';
            } else {
              inferredType = 'string';
            }
          }
          return {
            name: item.name || '',
            type: inferredType,
            required: item.required ?? true,
            options: rawOptions,
          };
        }
        return {
          name: String(item),
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
          const rawOptions = Array.isArray(item.options) ? item.options : [];
          let inferredType = item.type;
          if (!inferredType) {
            if (rawOptions.length > 0) {
              inferredType = 'categorical';
            } else {
              inferredType = 'string';
            }
          }
          return {
            name: item.name || '',
            type: inferredType,
            required: item.required ?? true,
            options: rawOptions,
          };
        }
        return {
          name: String(item),
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
          const rawOptions = Array.isArray(item.options) ? item.options : [];
          return {
            name: item.name || '',
            type: item.type || (rawOptions.length > 0 ? 'categorical' : 'string'),
            required: item.required ?? true,
            options: rawOptions,
          };
        }
        return {
          name: String(item),
          type: 'string',
          required: true,
          options: [],
        };
      })
      .filter((f: FeatureSchema) => Boolean(f.name));
  }

  if (schemaData.properties && typeof schemaData.properties === 'object') {
    return Object.entries(schemaData.properties).map(
      ([name, prop]: [string, any]): FeatureSchema => ({
        name,
        type:
          prop?.type === 'number' || prop?.type === 'integer'
            ? 'number'
            : Array.isArray(prop?.enum) && prop.enum.length > 0
            ? 'categorical'
            : prop?.type || 'string',
        required: true,
        options: Array.isArray(prop?.enum) ? prop.enum : [],
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
    const nonMeta = rawKeys.filter(k => !metaKeys.includes(k));
    const targetKeys = nonMeta.length > 0 ? nonMeta : rawKeys;
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
    } catch {
      toast.error('Failed to load deployments');
    } finally {
      setLoadingDeployments(false);
    }
  }, [selectedDeploy]);

  useEffect(() => {
    loadDeployments();
  }, [loadDeployments]);

  const getFeatureSchemas = useCallback((): FeatureSchema[] => {
    return extractFeatureSchemas(schema);
  }, [schema]);

  const getFeatureNames = useCallback((): string[] => {
    return getFeatureSchemas().map(f => f.name);
  }, [getFeatureSchemas]);

  useEffect(() => {
    if (!selectedDeploy) {
      setSchema(null);
      setFeatures({});
      setPrediction(null);
      return;
    }

    const loadSchema = async () => {
      setLoadingSchema(true);
      setPrediction(null);

      try {
        const schemaData = await deploymentApi.getDeploymentSchema(selectedDeploy);
        setSchema(schemaData);

        const extractedSchemas = extractFeatureSchemas(schemaData);
        const initialFeatures: Record<string, any> = {};
        extractedSchemas.forEach(feature => {
          initialFeatures[feature.name] = '';
        });

        setFeatures(initialFeatures);
      } catch {
        toast.error('Failed to load model input schema');
        setSchema(null);
        setFeatures({});
      } finally {
        setLoadingSchema(false);
      }
    };

    loadSchema();
  }, [selectedDeploy]);

  const handleFeatureChange = (feature: string, value: string) => {
    setFeatures(prev => ({
      ...prev,
      [feature]: value,
    }));
  };

  const runPrediction = async (e?: React.FormEvent): Promise<boolean> => {
    if (e) e.preventDefault();

    if (!selectedDeploy) {
      toast.error('Please select a deployment');
      return false;
    }

    const featureSchemas = getFeatureSchemas();
    if (featureSchemas.length === 0) {
      toast.error('No model input features available');
      return false;
    }

    const missingFeature = featureSchemas.find(
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
      featureSchemas.forEach((feature: FeatureSchema) => {
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
            if (trimmed.toLowerCase() === 'true') {
              payload[feature.name] = true;
            } else if (trimmed.toLowerCase() === 'false') {
              payload[feature.name] = false;
            } else {
              payload[feature.name] = trimmed;
            }
          } else if (normalizedType === 'categorical') {
            payload[feature.name] = val;
          } else {
            const num = Number(trimmed);
            if (!Number.isNaN(num) && (!feature.options || feature.options.length === 0)) {
              payload[feature.name] = num;
            } else if (trimmed.toLowerCase() === 'true') {
              payload[feature.name] = true;
            } else if (trimmed.toLowerCase() === 'false') {
              payload[feature.name] = false;
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

      setPredictionHistory(prev => [historyItem, ...prev].slice(0, 10));
      toast.success('Prediction completed');
      return true;
    } catch {
      toast.error('Prediction failed');
      setPrediction(null);
      return false;
    } finally {
      setPredicting(false);
    }
  };

  const selectedDeployment = deployments.find(
    deployment =>
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
    featureList: getFeatureSchemas(),
    featureNames: getFeatureNames(),
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
