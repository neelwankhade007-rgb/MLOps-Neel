from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
import pandas as pd

from models import (
    SessionLocal, User, Dataset, Experiment, RegisteredModel, Deployment,
    UserCreate, DatasetCreate, ExperimentCreate, ModelRegister, DeploymentCreate, PredictionRequest
)
from ml_utils import (
    init_minio, upload_dataset, train_model, load_mlflow_model,
    delete_dataset_file, delete_mlflow_run
)

import uuid

# Constants
SECRET_KEY = "supersecretkey"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
BACKEND_SESSION_ID = str(uuid.uuid4())

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/v1/auth/login")

app = FastAPI(title="MLOps MVP API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global in-memory deployed models
deployed_models = {}

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.on_event("startup")
def startup_event():
    init_minio()
    # Auto-load existing deployments into memory on startup
    db = SessionLocal()
    try:
        # Backfill target_column for existing experiments from MLflow schema
        exps = db.query(Experiment).filter(Experiment.target_column.is_(None), Experiment.run_id.isnot(None)).all()
        if exps:
            import mlflow
            for e in exps:
                try:
                    schema_dict = mlflow.artifacts.load_dict(f"runs:/{e.run_id}/explicit_schema.json")
                    if schema_dict and "target_column" in schema_dict:
                        e.target_column = schema_dict["target_column"]
                except Exception:
                    pass
            db.commit()

        deployments = db.query(Deployment).all()
        for dep in deployments:
            model_record = db.query(RegisteredModel).filter(RegisteredModel.id == dep.model_id).first()
            if model_record:
                exp = db.query(Experiment).filter(Experiment.id == model_record.experiment_id).first()
                if exp and exp.run_id:
                    try:
                        deployed_models[dep.name] = load_mlflow_model(exp.run_id)
                        print(f"Auto-loaded deployed model: {dep.name}")
                    except Exception as e:
                        print(f"Failed to auto-load model {dep.name}: {e}")
    finally:
        db.close()

# Auth Utils
def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=401)
    except JWTError:
        raise HTTPException(status_code=401)
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise HTTPException(status_code=401)
    return user

# Auth Routes
@app.post("/api/v1/auth/register")
def register(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    hashed_password = get_password_hash(user.password)
    new_user = User(username=user.username, hashed_password=hashed_password)
    db.add(new_user)
    db.commit()
    return {"message": "User registered successfully"}

@app.post("/api/v1/auth/login")
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user:
        raise HTTPException(status_code=400, detail="Account does not exist")
    if not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect password")
    access_token = create_access_token(data={"sub": user.username})
    return {
        "access_token": access_token, 
        "token_type": "bearer",
        "backend_session_id": BACKEND_SESSION_ID
    }

@app.get("/api/v1/auth/session")
def get_session_info():
    return {"session_id": BACKEND_SESSION_ID}

# Resource Cleanup Helpers
def check_resource_ownership(resource, current_user: User):
    if hasattr(resource, 'user_id') and resource.user_id is not None:
        if resource.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized to delete this resource")

def delete_deployment_internal(dep: Deployment, db: Session):
    deployed_models.pop(dep.name, None)
    db.delete(dep)

def delete_model_internal(model: RegisteredModel, db: Session):
    deployments = db.query(Deployment).filter(Deployment.model_id == model.id).all()
    for dep in deployments:
        delete_deployment_internal(dep, db)
    db.delete(model)

def delete_experiment_internal(exp: Experiment, db: Session):
    models = db.query(RegisteredModel).filter(RegisteredModel.experiment_id == exp.id).all()
    for m in models:
        delete_model_internal(m, db)
    if exp.run_id:
        delete_mlflow_run(exp.run_id)
    db.delete(exp)

def delete_dataset_internal(ds: Dataset, db: Session):
    exps = db.query(Experiment).filter(Experiment.dataset_id == ds.id).all()
    for e in exps:
        delete_experiment_internal(e, db)
    if ds.file_path:
        delete_dataset_file(ds.file_path)
    db.delete(ds)

# Dataset Routes
@app.post("/api/v1/datasets")
def create_dataset(
    name: str = Form(...),
    description: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")
        
    try:
        filename = f"{datetime.utcnow().timestamp()}_{file.filename}"
        s3_path = upload_dataset(file.file, filename)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Storage error: {str(e)}")
        
    dataset = Dataset(name=name, description=description, file_path=filename, user_id=current_user.id)
    db.add(dataset)
    db.commit()
    db.refresh(dataset)
    return {"success": True, "dataset": dataset}

@app.get("/api/v1/datasets")
def get_datasets(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Dataset).all()

@app.delete("/api/v1/datasets/{dataset_id}")
def delete_dataset(dataset_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ds = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    check_resource_ownership(ds, current_user)
    delete_dataset_internal(ds, db)
    db.commit()
    return {"success": True, "message": f"Dataset {dataset_id} deleted successfully"}

@app.delete("/api/v1/datasets")
def clear_datasets(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    datasets = db.query(Dataset).filter((Dataset.user_id == current_user.id) | (Dataset.user_id.is_(None))).all()
    count = len(datasets)
    for ds in datasets:
        delete_dataset_internal(ds, db)
    db.commit()
    return {"success": True, "message": f"Successfully cleared {count} datasets", "count": count}

# Training Routes
@app.post("/api/v1/training/jobs")
def start_training(req: ExperimentCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    dataset = db.query(Dataset).filter(Dataset.id == req.dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
        
    exp = Experiment(
        name=f"{dataset.name}_{req.algorithm}",
        dataset_id=dataset.id,
        algorithm=req.algorithm,
        target_column=req.target_column,
        status="running",
        created_at=datetime.utcnow(),
        user_id=current_user.id
    )
    db.add(exp)
    db.commit()
    db.refresh(exp)

    try:
        result = train_model(dataset.file_path, req.target_column, req.algorithm)
        exp.algorithm = result["resolved_algorithm"]
        exp.target_column = req.target_column
        exp.task_type = result["task_type"]
        exp.primary_metric = result["primary_metric"]
        exp.accuracy = result["primary_metric_value"]
        exp.metrics = result["metrics"]
        exp.run_id = result["run_id"]
        exp.status = "completed"
        db.commit()
        db.refresh(exp)
        return {"success": True, "experiment": exp.to_dict()}
    except Exception as e:
        safe_error = str(e)
        db.rollback()
        try:
            exp.status = "failed"
            exp.error_message = safe_error
            db.commit()
        except Exception:
            db.rollback()
        raise HTTPException(status_code=400, detail=f"Training failed: {safe_error}")

@app.get("/api/v1/experiments")
def get_experiments(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    experiments = db.query(Experiment).order_by(Experiment.id.desc()).all()
    updated = False
    for exp in experiments:
        if not exp.target_column and exp.run_id:
            try:
                import mlflow
                schema_dict = mlflow.artifacts.load_dict(f"runs:/{exp.run_id}/explicit_schema.json")
                if schema_dict and "target_column" in schema_dict:
                    exp.target_column = schema_dict["target_column"]
                    updated = True
            except Exception:
                pass
    if updated:
        try:
            db.commit()
        except Exception:
            db.rollback()
    return [exp.to_dict() for exp in experiments]

@app.delete("/api/v1/experiments/{experiment_id}")
def delete_experiment(experiment_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    exp = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not exp:
        raise HTTPException(status_code=404, detail="Experiment not found")
    check_resource_ownership(exp, current_user)
    delete_experiment_internal(exp, db)
    db.commit()
    return {"success": True, "message": f"Experiment {experiment_id} deleted successfully"}

@app.delete("/api/v1/experiments")
def clear_experiments(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    experiments = db.query(Experiment).filter((Experiment.user_id == current_user.id) | (Experiment.user_id.is_(None))).all()
    count = len(experiments)
    for exp in experiments:
        delete_experiment_internal(exp, db)
    db.commit()
    return {"success": True, "message": f"Successfully cleared {count} experiments", "count": count}

# Model Registry
@app.post("/api/v1/models")
def register_model(req: ModelRegister, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    exp = db.query(Experiment).filter(Experiment.id == req.experiment_id).first()
    model = RegisteredModel(name=req.name, experiment_id=req.experiment_id, version="v1", user_id=current_user.id)
    db.add(model)
    db.commit()
    db.refresh(model)
    return {"success": True, "model": model}

@app.get("/api/v1/models")
def get_models(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(RegisteredModel).all()

@app.delete("/api/v1/models/{model_id}")
def delete_model(model_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    model = db.query(RegisteredModel).filter(RegisteredModel.id == model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    check_resource_ownership(model, current_user)
    delete_model_internal(model, db)
    db.commit()
    return {"success": True, "message": f"Model {model_id} deleted successfully"}

@app.delete("/api/v1/models")
def clear_models(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    models = db.query(RegisteredModel).filter((RegisteredModel.user_id == current_user.id) | (RegisteredModel.user_id.is_(None))).all()
    count = len(models)
    for m in models:
        delete_model_internal(m, db)
    db.commit()
    return {"success": True, "message": f"Successfully cleared {count} registered models", "count": count}

# Deployment
@app.post("/api/v1/models/{model_id}/deploy")
def deploy_model(model_id: int, req: DeploymentCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    existing = db.query(Deployment).filter(Deployment.name == req.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Deployment name already exists")
        
    model_record = db.query(RegisteredModel).filter(RegisteredModel.id == model_id).first()
    if not model_record:
        raise HTTPException(status_code=404, detail="Model not found")
    
    exp = db.query(Experiment).filter(Experiment.id == model_record.experiment_id).first()
    
    # Load model into memory dynamically
    try:
        loaded_model = load_mlflow_model(exp.run_id)
        deployed_models[req.name] = loaded_model
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
        
    deployment = Deployment(
        name=req.name,
        model_id=model_id,
        endpoint=f"/api/v1/predict/{req.name}",
        status="active",
        user_id=current_user.id
    )
    db.add(deployment)
    db.commit()
    db.refresh(deployment)
    
    return {"success": True, "deployment": deployment}

@app.get("/api/v1/deployments")
def get_deployments(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Deployment).all()

@app.delete("/api/v1/deployments/{deployment_id}")
def delete_deployment(deployment_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if deployment_id.isdigit():
        dep = db.query(Deployment).filter(Deployment.id == int(deployment_id)).first()
    else:
        dep = db.query(Deployment).filter(Deployment.name == deployment_id).first()
    if not dep:
        raise HTTPException(status_code=404, detail="Deployment not found")
    check_resource_ownership(dep, current_user)
    delete_deployment_internal(dep, db)
    db.commit()
    return {"success": True, "message": f"Deployment {deployment_id} deleted successfully"}

@app.delete("/api/v1/deployments")
def clear_deployments(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    deployments = db.query(Deployment).filter((Deployment.user_id == current_user.id) | (Deployment.user_id.is_(None))).all()
    count = len(deployments)
    for dep in deployments:
        delete_deployment_internal(dep, db)
    db.commit()
    return {"success": True, "message": f"Successfully cleared {count} deployments", "count": count}

from ml_utils import download_dataset

@app.get("/api/v1/deployments/{deployment_name}/schema")
def get_deployment_schema(deployment_name: str, db: Session = Depends(get_db)):
    dep = db.query(Deployment).filter(Deployment.name == deployment_name).first()
    if not dep:
        raise HTTPException(status_code=404, detail="Deployment not found")
        
    model_record = db.query(RegisteredModel).filter(RegisteredModel.id == dep.model_id).first()
    exp = db.query(Experiment).filter(Experiment.id == model_record.experiment_id).first()
    
    try:
        import mlflow
        explicit_schema = mlflow.artifacts.load_dict(f"runs:/{exp.run_id}/explicit_schema.json")
        return {
            "deployment_id": dep.id,
            "model_name": model_record.name,
            "model_version": model_record.version,
            "target_column": explicit_schema.get("target_column"),
            "features": explicit_schema.get("features"),
            "encoded_columns": explicit_schema.get("encoded_columns")
        }
    except Exception:
        raise HTTPException(status_code=404, detail="Schema not found for this deployment.")

# Prediction
@app.post("/api/v1/predict/{deployment_name}")
def predict(deployment_name: str, req: PredictionRequest, db: Session = Depends(get_db)):
    dep = db.query(Deployment).filter(Deployment.name == deployment_name).first()
    if not dep:
        raise HTTPException(status_code=404, detail="Deployment not found")
    model_record = db.query(RegisteredModel).filter(RegisteredModel.id == dep.model_id).first()
    if not model_record:
        raise HTTPException(status_code=404, detail="Model record not found")
    exp = db.query(Experiment).filter(Experiment.id == model_record.experiment_id).first()
    if not exp or not exp.run_id:
        raise HTTPException(status_code=404, detail="Experiment run not found")
        
    if deployment_name not in deployed_models:
        try:
            deployed_models[deployment_name] = load_mlflow_model(exp.run_id)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to load model: {str(e)}")

    import mlflow
    try:
        explicit_schema = mlflow.artifacts.load_dict(f"runs:/{exp.run_id}/explicit_schema.json")
    except Exception:
        raise HTTPException(status_code=404, detail="Schema not found for deployment.")

    features_schema = explicit_schema.get("features", [])
    
    # Input validation
    for feature in features_schema:
        fname = feature["name"]
        if feature.get("required", False) and fname not in req.features:
            raise HTTPException(status_code=400, detail=f"Missing required feature: {fname}")
        if fname in req.features:
            val = req.features[fname]
            if feature["type"] == "number" and not isinstance(val, (int, float)):
                try:
                    req.features[fname] = float(val)
                except ValueError:
                    raise HTTPException(status_code=400, detail=f"Invalid numeric value for {fname}")
            elif feature["type"] == "categorical" and feature.get("options") and val not in feature["options"]:
                raise HTTPException(status_code=400, detail=f"Unknown categorical value for {fname}: {val}. Allowed: {feature['options']}")

    model = deployed_models[deployment_name]
    df = pd.DataFrame([req.features])
    
    df_dummies = pd.get_dummies(df)
    
    expected_features = explicit_schema.get("encoded_columns", [])
    if expected_features:
        df_dummies = df_dummies.reindex(columns=expected_features, fill_value=0)
    else:
        # Fallback for old models
        if hasattr(model, '_model_impl') and hasattr(model._model_impl, 'sklearn_model'):
            expected_features = model._model_impl.sklearn_model.feature_names_in_
            df_dummies = df_dummies.reindex(columns=expected_features, fill_value=0)
        elif hasattr(model, '_model_impl') and hasattr(model._model_impl, 'xgb_model'):
            expected_features = model._model_impl.xgb_model.feature_names
            df_dummies = df_dummies.reindex(columns=expected_features, fill_value=0)
            
    try:
        prediction = model.predict(df_dummies)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")
    
    raw_pred = prediction[0].item() if hasattr(prediction[0], 'item') else prediction[0]
    classes = explicit_schema.get("classes")
    if classes and isinstance(raw_pred, (int, float)) and int(raw_pred) < len(classes):
        pred_output = str(classes[int(raw_pred)])
    else:
        pred_output = str(raw_pred)

    return {
        "prediction": pred_output,
        "deployment": deployment_name
    }

# ==============================================================================
# Inference Monitoring & Telemetry Proxy Endpoints
# ==============================================================================
import json
import urllib.request
from pydantic import BaseModel
from inference_telemetry import telemetry_aggregator

class TestTrafficRequest(BaseModel):
    count: int = 5

@app.get("/api/v1/inference-monitoring/telemetry")
def get_inference_telemetry(
    w_lat: float = 0.40,
    w_req: float = 0.30,
    w_cpu: float = 0.20,
    w_err: float = 0.10,
    current_user: User = Depends(get_current_user)
):
    """
    Returns real telemetry from all inference replicas, Kubernetes Metrics Server,
    and Prometheus. Exposes data safely to the frontend without exposing cluster internals.
    """
    weights = {"lat": w_lat, "req": w_req, "cpu": w_cpu, "err": w_err}
    return telemetry_aggregator.get_telemetry_snapshot(weights)

@app.post("/api/v1/inference-monitoring/test-traffic")
def trigger_test_traffic(
    req: TestTrafficRequest,
    current_user: User = Depends(get_current_user)
):
    """
    Sends actual test prediction requests through native Kubernetes Service ClusterIP,
    allowing live verification of request routing across replicas.
    """
    results = telemetry_aggregator.send_test_traffic(count=req.count)
    return {
        "success": True,
        "count": len(results),
        "requests": results
    }

@app.get("/api/v1/inference-monitoring/prometheus/status")
def get_prometheus_status(current_user: User = Depends(get_current_user)):
    """
    Returns Prometheus scrape health and active targets status for complementary display.
    """
    try:
        req = urllib.request.Request("http://prometheus:9090/api/v1/targets")
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            data = json.loads(resp.read().decode())
            return {"status": "connected", "targets": data.get("data", {}).get("activeTargets", [])}
    except Exception as e:
        return {"status": "unavailable", "error": str(e), "targets": []}

