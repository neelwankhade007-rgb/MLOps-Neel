# MLOps project walkthrough

This is a short PowerShell runbook for starting the existing Minikube app, sending controlled inference traffic from the dashboard, and checking where requests and telemetry go. Run commands from the repository root. No local Python virtual environment or separate Locust install is needed for the dashboard load test.

## 1. Start Minikube and check the cluster

```powershell
minikube start --driver=docker
kubectl config current-context
kubectl get nodes
kubectl get pods -n mlops -o wide
kubectl get pvc -n mlops
```

The context should be `minikube`; the node should be `Ready`; application pods should become `Running` and ready. The inference deployment should have three ready pods, and the database and MinIO PVCs should be `Bound`.

If this is a new cluster with no application resources, apply the manifests in dependency order:

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
kubectl get pods -n mlops -w
```

For a fresh cluster, build and load the locally referenced images before applying the workloads. Follow the image commands in the main `README.md`; the manifests use `imagePullPolicy: Never`.

## 2. Open the dashboard

Keep this running in a PowerShell terminal:

```powershell
kubectl port-forward -n mlops service/frontend 8080:80
```

Open <http://localhost:8080> and sign in. Navigate to **Inference → Adaptive Load Balancing**. The selected strategy applies to prediction requests made by the backend. The strategy is held in backend memory, so select it again after restarting the backend.

## 3. Send a controlled Locust run from the dashboard

In the **Locust Load Generator** panel:

1. Select an active deployment that is served by the inference replicas.
2. Choose the number of users, target requests per second, duration, and request limit.
3. Start with a small run, such as 1 user, 1 request/second, 10 seconds, and a limit of 10 requests.
4. Start the run and watch **Completed Requests**, **Succeeded**, **Failed**, and **Observed Rate**. Use Stop to end a run early.

The request limit and duration both cap the run. The backend starts Locust inside its container. Locust sends authenticated `POST /api/v1/predict/{deployment}` requests to the backend, which applies the selected routing strategy. The backend validates that the selected deployment belongs to the user and uses the model run currently served by the inference pods.

Successful dashboard events include a `replica_id` and routing strategy. A small Adaptive run may select only one pod; it is not expected to exercise every replica.

## 4. Verify inference requests reached pods

Before and after a run, inspect each inference pod's in-memory counters:

```powershell
$pods = kubectl get pods -n mlops -l app=inference-service -o jsonpath='{.items[*].metadata.name}'
foreach ($pod in $pods.Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries)) {
  Write-Host "--- $pod ---"
  kubectl exec -n mlops $pod -c inference-service -- python -c "import urllib.request; print(urllib.request.urlopen('http://localhost:8000/stats').read().decode())"
}
```

Compare `requests_served` before and after. For an Adaptive, round-robin, or weighted run, the selected pod's counter should increase. Native Kubernetes Service routing may select a different pod because Kubernetes makes the replica choice. Counters reset when a pod restarts.

If Locust reports failures, check the panel's run status and then inspect the backend logs:

```powershell
kubectl logs -n mlops deployment/backend --tail=100
kubectl get pods -n mlops
```

Typical causes are an expired login, no active deployment available to the user, or a model-run mismatch between the deployment and inference pods.

## 5. Check the gateway and Adaptive telemetry

Check gateway readiness and discovered inference replicas:

```powershell
$gateway = kubectl get pods -n mlops -l app=inference-gateway -o jsonpath='{.items[0].metadata.name}'
kubectl exec -n mlops $gateway -c inference-gateway -- python -c "import urllib.request; print(urllib.request.urlopen('http://localhost:8080/ready').read().decode()); print(urllib.request.urlopen('http://localhost:8080/replicas').read().decode())"
```

The gateway should be ready and report three available replicas. Check that the telemetry settings are loaded:

```powershell
kubectl exec -n mlops $gateway -c inference-gateway -- python -c "import os; print('EMA alpha:', os.getenv('ADAPTIVE_EMA_ALPHA')); print('Metric max age (seconds):', os.getenv('ADAPTIVE_METRIC_MAX_AGE_S')); print('Refresh interval (seconds):', os.getenv('ADAPTIVE_METRICS_INTERVAL_S'))"
```

For this project configuration, the expected values are `0.3`, `120`, and `5`. Check that the gateway can read pod and Metrics Server data:

```powershell
kubectl auth can-i list pods --as=system:serviceaccount:mlops:inference-gateway-sa -n mlops
kubectl auth can-i list pods.metrics.k8s.io --as=system:serviceaccount:mlops:inference-gateway-sa -n mlops
kubectl get --raw /apis/metrics.k8s.io/v1beta1/namespaces/mlops/pods
```

The permission checks should return `yes`. Metrics Server entries include a `timestamp`; samples older than 120 seconds are ignored by Adaptive routing. Metrics Server samples in this cluster are typically around one minute old. If no current CPU samples are available, Adaptive continues routing with the other usable signals rather than using an old CPU value.

After changing gateway code or these settings, rebuild and load only the gateway image, apply its ConfigMap and Deployment, and wait for its rollout:

```powershell
docker build -t mlops-gateway:latest ./gateway
minikube image load mlops-gateway:latest
kubectl apply -f kubernetes/config/01-configmap.yaml
kubectl apply -f kubernetes/workloads/07-gateway.yaml
kubectl rollout status deployment/inference-gateway -n mlops
```

## 6. Optional Prometheus and Grafana checks

If the monitoring workloads are running, open separate terminals and keep these port-forwards active:

```powershell
kubectl port-forward -n mlops service/prometheus 9090:9090
kubectl port-forward -n mlops service/grafana 3000:3000
```

Open <http://localhost:9090> or <http://localhost:3000>. Prometheus scrapes the inference replicas' `/metrics` endpoint. Use the dashboards to inspect replica request counts, latency, active requests, and resource observations alongside the per-pod `/stats` check above.

## 7. Stop the session safely

- Click **Stop** in the Locust panel if a run is active.
- Press `Ctrl+C` in each port-forward terminal.
- To stop Minikube while retaining its resources and data, run `minikube stop`. Start it later with `minikube start --driver=docker`.
