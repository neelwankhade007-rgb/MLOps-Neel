# Nexus MLOps setup guide

Nexus MLOps is a web app for uploading datasets, training and registering models, and sending predictions. The repository includes a React frontend, a FastAPI backend, PostgreSQL, MinIO, MLflow, and a separate inference service with a round-robin gateway.

**Current prediction routing:** the backend sends prediction requests to `GATEWAY_URL` (default `http://inference-gateway:8080`). The gateway rotates requests across ready inference replicas. `backend/routing.py` contains a native/round-robin strategy selector, but the prediction endpoint does not call it; changing `DEFAULT_ROUTING_STRATEGY` does not switch live traffic.

## Tech stack

- **React, TypeScript, Vite** — browser interface and local frontend development server.
- **FastAPI, Python** — application API, gateway, and inference services.
- **PostgreSQL** — application records and MLflow tracking metadata.
- **MinIO** — S3-compatible storage for datasets and model artifacts.
- **MLflow** — experiment tracking and model artifact access.
- **scikit-learn, XGBoost, pandas** — model training and inference dependencies.
- **Docker Compose** — runs the web app and supporting services in containers.
- **Kubernetes, Minikube** — runs the full app, including inference replicas and gateway, on a local cluster.

## Prerequisites

Choose one setup path below.

- **Kubernetes:** Git, Docker Desktop (or another working Docker Engine), Minikube, and `kubectl`.
- **Docker Compose:** Git and Docker Desktop with Docker Compose v2 (`docker compose`).
- **Local frontend/backend:** Git, Python 3.11, Node.js/npm, and Docker Compose for PostgreSQL, MinIO, and MLflow.

Run commands from the repository root unless a command says otherwise. Examples use PowerShell on Windows; adjust activation commands for your shell.

## Setup path 1: Kubernetes with Minikube

This path applies the manifests in `kubernetes/`. It includes three inference replicas and the inference gateway. The app's frontend is exposed locally with `kubectl port-forward`.

### 1. Start Minikube

```powershell
minikube start --driver=docker
kubectl get nodes
```

**Expected shape (example, not exact output):** `kubectl get nodes` shows a node with `STATUS` `Ready`.

### 2. Build and load the project images

Kubernetes uses locally built images with `imagePullPolicy: Never`, so build and load all five project images into Minikube:

```powershell
docker build -t mlops-backend:latest ./backend
docker build -t mlops-frontend:latest ./frontend
docker build -t mlops-mlflow:latest ./mlflow
docker build -t mlops-inference:latest ./inference
docker build -t mlops-gateway:latest ./gateway

minikube image load mlops-backend:latest
minikube image load mlops-frontend:latest
minikube image load mlops-mlflow:latest
minikube image load mlops-inference:latest
minikube image load mlops-gateway:latest
```

**Expected shape (example, not exact output):** each `docker build` ends with a successful image export/tag step; each `minikube image load` reports that the image was loaded.

### 3. Apply the manifests in dependency order

```powershell
kubectl apply -f kubernetes/config/
kubectl apply -f kubernetes/volumes/
kubectl apply -f kubernetes/workloads/01-db.yaml
kubectl apply -f kubernetes/workloads/02-minio.yaml
kubectl apply -f kubernetes/workloads/03-mlflow.yaml
kubectl apply -f kubernetes/workloads/04-backend.yaml
kubectl apply -f kubernetes/workloads/06-inference.yaml
kubectl apply -f kubernetes/networking/02-inference-headless.yaml
kubectl apply -f kubernetes/workloads/07-gateway.yaml
kubectl apply -f kubernetes/workloads/05-frontend.yaml
kubectl apply -f kubernetes/networking/01-ingress.yaml
```

The ingress manifest is applied as a cluster resource; the access steps below use port forwarding and do not require an ingress address. Database and MinIO manifests request persistent volumes. `kubectl apply` may report `created` the first time or `unchanged` when resources already exist.

### 4. Wait for the workloads and check storage

```powershell
kubectl get pods -n mlops
kubectl get pvc -n mlops
```

**Expected shape (example, not exact output):** workload pods eventually show `Running` and `READY` as `1/1`; the inference deployment has three ready pods. Both `db-pvc` and `minio-pvc` should show `Bound`. It can take a few minutes for model artifacts to load. If pods are still starting, check them again and use the troubleshooting commands below.

### 5. Open the app

Keep this command running in a terminal:

```powershell
kubectl port-forward -n mlops service/frontend 8080:80
```

**Expected shape (example):** a line says `Forwarding from 127.0.0.1:8080 -> 80` (and often a similar IPv6 line). Open <http://localhost:8080> in a browser. `Ctrl+C` stops the port forward only.

Optional monitoring manifests are separate from the app workloads. Apply them if you need Prometheus and Grafana:

```powershell
kubectl apply -f kubernetes/monitoring/
```

## Setup path 2: Docker Compose

Compose runs the frontend, backend, PostgreSQL, MinIO, and MLflow. The Compose file does not start the separate inference service or gateway; use the Kubernetes path for the full inference replica/gateway stack.

From the repository root:

```powershell
docker compose up -d --build
docker compose ps
```

**Expected shape (example, not exact output):** `docker compose ps` lists `db`, `minio`, `mlflow`, `backend`, and `frontend`; their state becomes `Up`/`running` after startup.

Open:

- App: <http://localhost:5173>
- Backend API docs: <http://localhost:8000/docs>
- MLflow: <http://localhost:5000>
- MinIO console: <http://localhost:9001>

To stop the services and keep their named data volumes:

```powershell
docker compose down
```

## Setup path 3: Local frontend and backend

Use this path for direct source editing with the supporting database, object storage, and tracking server in Compose. Predictions that require the separate inference gateway need that gateway reachable too; Compose alone does not start it.

### 1. Create and install the root Python environment

Run from the repository root:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt -r requirements-ml.txt
```

The root `.venv` is a local, ignored Python environment; it is not committed project code. Create it once per checkout, activate it when working in Python, and install packages into it. `requirements.txt` contains shared API, database, test, and benchmark dependencies. `requirements-ml.txt` adds the larger MLflow, pandas, scikit-learn, XGBoost, and Boto3 dependencies used by backend training and inference. Installing both is needed for the full local backend.

Other requirement files serve narrower purposes:

- `backend/requirements.txt` — full set needed to build the backend image, including its ML dependencies.
- `gateway/requirements.txt` — FastAPI, Uvicorn, HTTPX, and Pydantic for the gateway image and gateway tests.
- `inference/requirements.txt` — FastAPI, Uvicorn, Pydantic, and the ML dependencies for the inference image.

Dockerfiles install the requirements file in their own component directory. They keep each image's dependencies scoped to that service; the root files support a shared local development/test environment.

### 2. Start the supporting services

```powershell
docker compose up -d db minio mlflow
docker compose ps
```

**Expected shape (example, not exact output):** `db`, `minio`, and `mlflow` report `Up`/`running`.

### 3. Run the backend

In the activated Python environment, start a backend terminal from the repository root:

```powershell
$env:DATABASE_URL = "postgresql://mlops:mlops_password@localhost:5432/mlops_db"
$env:MINIO_ENDPOINT = "localhost:9000"
$env:MINIO_ACCESS_KEY = "admin"
$env:MINIO_SECRET_KEY = "password"
$env:MLFLOW_TRACKING_URI = "http://localhost:5000"
$env:MLFLOW_S3_ENDPOINT_URL = "http://localhost:9000"
$env:AWS_ACCESS_KEY_ID = "admin"
$env:AWS_SECRET_ACCESS_KEY = "password"
python -m uvicorn main:app --app-dir backend --reload --port 8000
```

**Expected shape (example):** Uvicorn reports that the server is running at `http://127.0.0.1:8000`. The API docs are at <http://localhost:8000/docs>.

### 4. Run the frontend

In a second terminal, from the repository root:

```powershell
cd frontend
npm ci
$env:VITE_API_URL = "http://localhost:8000/api/v1"
npm run dev
```

**Expected shape (example):** Vite prints a `Local` URL, usually `http://localhost:5173/`. Open that URL in a browser. `npm ci` installs the versions locked in `package-lock.json`.

## Run and test

### Gateway tests

From the repository root with the root `.venv` active and both root requirements files installed:

```powershell
$env:PYTHONPATH = "gateway;backend"
python -m pytest gateway/test_gateway.py -v
```

**Expected shape (example, not exact output):** pytest prints test names/progress and finishes with a summary such as `passed`; a failure summary identifies the failed test.

### Frontend checks

From `frontend/` after `npm ci`:

```powershell
npm run lint
npm run build
```

The build command runs TypeScript project checks and creates the production frontend bundle. **Expected shape (example):** both commands exit without an error; the build reports generated assets under `dist/`.

## After code changes

- **Compose:** rebuild the changed service. For example, `docker compose up -d --build backend frontend`. If you changed only the MLflow Dockerfile, use `docker compose up -d --build mlflow`.
- **Kubernetes:** rebuild and load the changed project's image, then restart that deployment. Example for the backend:

  ```powershell
  docker build -t mlops-backend:latest ./backend
  minikube image load mlops-backend:latest
  kubectl rollout restart deployment/backend -n mlops
  kubectl rollout status deployment/backend -n mlops
  ```

  Replace the image, build directory, and deployment name for the component you changed. This applies to the five locally built images: backend, frontend, MLflow, inference, and gateway.
- **Local development:** Uvicorn reloads backend source changes. Vite refreshes frontend changes. Re-run `npm run lint` and `npm run build` for frontend checks.

## Stop safely

- **Local Python processes:** press `Ctrl+C` in each Uvicorn/Vite terminal.
- **Compose:** run `docker compose down`. This stops/removes the containers and network while keeping the named PostgreSQL and MinIO volumes.
- **Kubernetes app access:** press `Ctrl+C` in the port-forward terminal. The cluster keeps running.
- **Minikube:** run `minikube stop` to stop the cluster while retaining its Kubernetes resources and persistent data. Start it later with `minikube start --driver=docker`.

## Troubleshooting

- **A pod is `Pending`, `ImagePullBackOff`, or not ready:** run `kubectl get pods -n mlops` and `kubectl describe pod -n mlops <pod-name>`. Confirm all five `mlops-*` images were built and loaded, then inspect logs with `kubectl logs -n mlops <pod-name>`.
- **Inference pods are not ready:** the inference container loads a model and schema from MLflow on startup. Check `kubectl logs -n mlops deployment/inference-service` and confirm MLflow and MinIO are ready.
- **PVC remains `Pending`:** run `kubectl get pvc -n mlops` and `kubectl describe pvc -n mlops <pvc-name>`; Minikube needs a working storage provisioner.
- **Browser cannot reach the Kubernetes app:** leave the `kubectl port-forward` command running and open <http://localhost:8080>.
- **Compose services are not running:** inspect `docker compose ps` and `docker compose logs <service-name>` (for example, `docker compose logs backend`).
- **Local frontend requests fail:** check that the backend is running on port 8000 and that `VITE_API_URL` was set before starting Vite.

