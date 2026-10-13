from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, create_engine, text, JSON
from sqlalchemy.orm import declarative_base, relationship, sessionmaker
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import datetime
import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://mlops:mlops_password@localhost:5432/mlops_db")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# SQLAlchemy Models
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)

class Dataset(Base):
    __tablename__ = "app_datasets"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    description = Column(String)
    file_path = Column(String)
    uploaded_at = Column(DateTime, default=datetime.datetime.utcnow)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)

class Experiment(Base):
    __tablename__ = "app_experiments"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    dataset_id = Column(Integer, ForeignKey("app_datasets.id"))
    algorithm = Column(String)
    accuracy = Column(Float, nullable=True)
    run_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    status = Column(String, nullable=True)
    target_column = Column(String, nullable=True)
    task_type = Column(String, nullable=True)
    primary_metric = Column(String, nullable=True)
    metrics = Column(JSON, nullable=True)
    error_message = Column(String, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "dataset_id": self.dataset_id,
            "algorithm": self.algorithm,
            "target_column": self.target_column,
            "accuracy": self.accuracy,
            "run_id": self.run_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "status": self.status,
            "task_type": self.task_type,
            "primary_metric": self.primary_metric,
            "metrics": self.metrics,
            "error_message": self.error_message,
            "user_id": self.user_id,
        }

class RegisteredModel(Base):
    __tablename__ = "app_registered_models"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    experiment_id = Column(Integer, ForeignKey("app_experiments.id"))
    version = Column(String)
    status = Column(String, default="Development")
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)

class Deployment(Base):
    __tablename__ = "deployments"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    model_id = Column(Integer, ForeignKey("app_registered_models.id"))
    endpoint = Column(String)
    status = Column(String, default="active")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)

Base.metadata.create_all(bind=engine)

# Ensure existing tables have newly added columns
with engine.connect() as _conn:
    _conn.execute(text("ALTER TABLE deployments ADD COLUMN IF NOT EXISTS status VARCHAR DEFAULT 'active'"))
    _conn.execute(text("UPDATE deployments SET status = 'active' WHERE status IS NULL"))
    _conn.execute(text("ALTER TABLE app_experiments ADD COLUMN IF NOT EXISTS status VARCHAR"))
    _conn.execute(text("ALTER TABLE app_experiments ADD COLUMN IF NOT EXISTS task_type VARCHAR"))
    _conn.execute(text("ALTER TABLE app_experiments ADD COLUMN IF NOT EXISTS primary_metric VARCHAR"))
    _conn.execute(text("ALTER TABLE app_experiments ADD COLUMN IF NOT EXISTS metrics JSON"))
    _conn.execute(text("ALTER TABLE app_experiments ADD COLUMN IF NOT EXISTS error_message TEXT"))
    _conn.execute(text("ALTER TABLE app_experiments ADD COLUMN IF NOT EXISTS target_column VARCHAR"))
    _conn.execute(text("ALTER TABLE app_datasets ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id)"))
    _conn.execute(text("ALTER TABLE app_experiments ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id)"))
    _conn.execute(text("ALTER TABLE app_registered_models ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id)"))
    _conn.execute(text("ALTER TABLE deployments ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id)"))
    _conn.commit()

# Pydantic Schemas
class UserCreate(BaseModel):
    username: str
    password: str

class DatasetCreate(BaseModel):
    name: str
    description: str

class ExperimentCreate(BaseModel):
    dataset_id: int
    algorithm: str
    target_column: str

class ModelRegister(BaseModel):
    experiment_id: int
    name: str

class DeploymentCreate(BaseModel):
    model_id: int
    name: str

class PredictionRequest(BaseModel):
    features: Dict[str, Any]

