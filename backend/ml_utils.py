import os
import boto3
import pandas as pd
import mlflow
import mlflow.sklearn
import mlflow.xgboost
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LogisticRegression, LinearRegression
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from xgboost import XGBClassifier, XGBRegressor
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    roc_auc_score,
    r2_score,
    mean_absolute_error,
    mean_squared_error,
)
from sklearn.preprocessing import LabelEncoder
import io

MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "localhost:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "admin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "password")

s3_client = boto3.client(
    "s3",
    endpoint_url=f"http://{MINIO_ENDPOINT}",
    aws_access_key_id=MINIO_ACCESS_KEY,
    aws_secret_access_key=MINIO_SECRET_KEY
)

def init_minio():
    try:
        s3_client.head_bucket(Bucket='datasets')
    except Exception:
        s3_client.create_bucket(Bucket='datasets')
    try:
        s3_client.head_bucket(Bucket='mlflow-artifacts')
    except Exception:
        s3_client.create_bucket(Bucket='mlflow-artifacts')

def upload_dataset(file_obj, filename):
    s3_client.upload_fileobj(file_obj, 'datasets', filename)
    return f"s3://datasets/{filename}"

def download_dataset(filename):
    obj = s3_client.get_object(Bucket='datasets', Key=filename)
    df = pd.read_csv(io.BytesIO(obj['Body'].read()))
    return df

def determine_task_type(y: pd.Series) -> str:
    # If target is non-numeric or boolean, treat as classification
    if not pd.api.types.is_numeric_dtype(y) or pd.api.types.is_bool_dtype(y):
        return "classification"
    
    # If float and contains non-integer fractional values, treat as regression
    if pd.api.types.is_float_dtype(y) and not (y.dropna() % 1 == 0).all():
        return "regression"
        
    # For integer or integer-like float values:
    # Low cardinality (e.g. binary 0/1 or <= 10 classes) -> classification
    # High cardinality (e.g. continuous prices, continuous counts) -> regression
    if y.nunique() <= 10:
        return "classification"
        
    return "regression"

def train_model(dataset_filename: str, target_column: str, algorithm: str):
    df = download_dataset(dataset_filename)
    
    # Basic preprocessing
    df = df.dropna() # handle missing basically
    if df.empty:
        raise ValueError("Dataset is empty or contains no usable rows after preprocessing.")
        
    if target_column not in df.columns:
        raise ValueError(f"Target column '{target_column}' not found in dataset.")
        
    X = df.drop(columns=[target_column])
    
    # Drop identifier columns safely
    identifiers = []
    for col in X.columns:
        c_lower = str(col).lower()
        if c_lower in ['id', 'index', 'serial_no', 'sr no', 'sr_no', 'uuid', 'guid']:
            identifiers.append(col)
        elif c_lower.endswith('_id') or c_lower.endswith(' id'):
            identifiers.append(col)
        # Drop completely unique strings only if dataset is large enough to rule out coincidence
        elif X[col].nunique() == len(X) and str(X[col].dtype) == 'object' and len(X) > 30:
            identifiers.append(col)
            
    if identifiers:
        X = X.drop(columns=identifiers)
        
    original_features = []
    for col in X.columns:
        col_type = str(X[col].dtype)
        feature_type = "string"
        options = []
        if "int" in col_type or "float" in col_type:
            feature_type = "number"
        elif "bool" in col_type:
            feature_type = "boolean"
        elif "object" in col_type or "category" in col_type:
            feature_type = "categorical"
            options = X[col].dropna().unique().tolist()
            
        original_features.append({
            "name": col,
            "type": feature_type,
            "required": True,
            "options": options
        })
        
    # Encode categoricals basically
    X_dummies = pd.get_dummies(X)
    
    explicit_schema = {
        "target_column": target_column,
        "features": original_features,
        "encoded_columns": X_dummies.columns.tolist()
    }
    y = df[target_column]
    task_type = determine_task_type(y)
    is_regression = (task_type == "regression")
    explicit_schema["task_type"] = task_type
    
    X_train, X_test, y_train, y_test = train_test_split(X_dummies, y, test_size=0.2, random_state=42)
    
    target_encoder = None
    if is_regression:
        if algorithm == "Logistic Regression":
            model = LinearRegression()
            resolved_algorithm = "Linear Regression"
        elif algorithm == "Random Forest":
            model = RandomForestRegressor(random_state=42)
            resolved_algorithm = "Random Forest Regressor"
        elif algorithm == "XGBoost":
            model = XGBRegressor(random_state=42)
            resolved_algorithm = "XGBoost Regressor"
        else:
            raise ValueError(f"Unsupported algorithm: {algorithm}")
        y_train_fit = y_train
        y_test_eval = y_test
    else:
        if algorithm == "Logistic Regression":
            model = LogisticRegression(max_iter=1000)
            resolved_algorithm = "Logistic Regression"
            y_train_fit = y_train
            y_test_eval = y_test
        elif algorithm == "Random Forest":
            model = RandomForestClassifier(random_state=42)
            resolved_algorithm = "Random Forest Classifier"
            y_train_fit = y_train
            y_test_eval = y_test
        elif algorithm == "XGBoost":
            target_encoder = LabelEncoder()
            y_train_fit = target_encoder.fit_transform(y_train)
            y_test_eval = target_encoder.transform(y_test)
            model = XGBClassifier(eval_metric="logloss", random_state=42)
            resolved_algorithm = "XGBoost Classifier"
        else:
            raise ValueError(f"Unsupported algorithm: {algorithm}")

    # Set up MLflow
    mlflow.set_tracking_uri(os.getenv("MLFLOW_TRACKING_URI", "http://localhost:5000"))
    mlflow.set_experiment("MVP_Experiment")
    
    with mlflow.start_run() as run:
        model.fit(X_train, y_train_fit)
        preds = model.predict(X_test)
        
        if is_regression:
            r2 = float(r2_score(y_test, preds))
            mae = float(mean_absolute_error(y_test, preds))
            mse = float(mean_squared_error(y_test, preds))
            rmse = float(mse ** 0.5)

            metrics_dict = {
                "r2_score": round(r2, 4),
                "mae": round(mae, 4),
                "mse": round(mse, 4),
                "rmse": round(rmse, 4),
            }
            metric_name = "R² Score"
            metric_val = r2

            mlflow.log_param("algorithm", resolved_algorithm)
            mlflow.log_param("task_type", "regression")
            mlflow.log_param("primary_metric", metric_name)
            mlflow.log_metric("r2_score", r2)
            mlflow.log_metric("mae", mae)
            mlflow.log_metric("mse", mse)
            mlflow.log_metric("rmse", rmse)
            mlflow.log_metric("accuracy", r2)  # legacy backward-compat
        else:
            acc = float(accuracy_score(y_test_eval, preds))
            prec = float(precision_score(y_test_eval, preds, average="weighted", zero_division=0))
            rec = float(recall_score(y_test_eval, preds, average="weighted", zero_division=0))
            f1 = float(f1_score(y_test_eval, preds, average="weighted", zero_division=0))

            metrics_dict = {
                "accuracy": round(acc, 4),
                "precision": round(prec, 4),
                "recall": round(rec, 4),
                "f1": round(f1, 4),
            }

            roc_auc_val = None
            if hasattr(model, "predict_proba"):
                try:
                    probs = model.predict_proba(X_test)
                    unique_classes = len(set(y_test_eval))
                    if unique_classes == 2 and probs.shape[1] >= 2:
                        roc_auc_val = float(roc_auc_score(y_test_eval, probs[:, 1]))
                    elif unique_classes > 2 and probs.shape[1] == unique_classes:
                        roc_auc_val = float(roc_auc_score(y_test_eval, probs, multi_class="ovr", average="weighted"))
                except Exception:
                    roc_auc_val = None

            if roc_auc_val is not None:
                metrics_dict["roc_auc"] = round(roc_auc_val, 4)
                mlflow.log_metric("roc_auc", roc_auc_val)

            metric_name = "Accuracy"
            metric_val = acc

            mlflow.log_param("algorithm", resolved_algorithm)
            mlflow.log_param("task_type", "classification")
            mlflow.log_param("primary_metric", metric_name)
            mlflow.log_metric("accuracy", acc)
            mlflow.log_metric("precision", prec)
            mlflow.log_metric("recall", rec)
            mlflow.log_metric("f1", f1)

        if "XGB" in resolved_algorithm or algorithm == "XGBoost":
            mlflow.xgboost.log_model(model, "model")
        else:
            mlflow.sklearn.log_model(model, "model")

        explicit_schema["metric_name"] = metric_name
        explicit_schema["primary_metric"] = metric_name
        explicit_schema["metrics"] = metrics_dict
        if target_encoder is not None:
            explicit_schema["classes"] = target_encoder.classes_.tolist()

        mlflow.log_dict(explicit_schema, "explicit_schema.json")

        return {
            "task_type": task_type,
            "primary_metric": metric_name,
            "primary_metric_value": metric_val,
            "metrics": metrics_dict,
            "run_id": run.info.run_id,
            "resolved_algorithm": resolved_algorithm,
        }

def load_mlflow_model(run_id: str):
    mlflow.set_tracking_uri(os.getenv("MLFLOW_TRACKING_URI", "http://localhost:5000"))
    return mlflow.pyfunc.load_model(f"runs:/{run_id}/model")
