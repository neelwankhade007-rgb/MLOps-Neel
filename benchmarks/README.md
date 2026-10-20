# Locust: live inference traffic

Locust sends valid Titanic feature payloads to the authenticated backend prediction endpoint. That endpoint applies the backend's currently selected routing strategy (Native Kubernetes Service, Round Robin, Weighted Round Robin, or Adaptive) and returns the inference replica ID and request latency. No local virtual environment is required; run Locust in Docker.

## 1. Start a tunnel to the Kubernetes backend

In PowerShell terminal 1, leave this running:

```powershell
kubectl port-forward -n mlops service/backend 8000:8000
```

This forwards to the backend, not directly to the inference Service. Locust therefore follows the same active routing configuration as the app.

## 2. Get an API token and deployment name

In PowerShell terminal 2, enter the username/password for an existing account and log in. The login endpoint accepts form data:

```powershell
$login = Invoke-RestMethod -Method Post -Uri http://localhost:8000/api/v1/auth/login -ContentType 'application/x-www-form-urlencoded' -Body @{ username = 'YOUR_USERNAME'; password = 'YOUR_PASSWORD' }
$env:LOCUST_API_TOKEN = $login.access_token
```

Set `DEPLOYMENT_NAME` to the name of a deployed model owned by that account. You can copy it from the app's Deployments page. The inference replicas must serve the model run associated with that deployment; the backend rejects mismatched runs.

```powershell
$env:DEPLOYMENT_NAME = 'YOUR_DEPLOYMENT_NAME'
```

The token is kept in this PowerShell process environment and passed to the Locust container. Do not paste it into a checked-in file.

## 3. Start the Locust web UI in Docker

From the repository root, run:

```powershell
docker run --rm -p 8089:8089 `
  -v "${PWD}/benchmarks:/mnt/locust" `
  -e TARGET_HOST=http://host.docker.internal:8000 `
  -e DEPLOYMENT_NAME `
  -e LOCUST_API_TOKEN `
  locustio/locust -f /mnt/locust/locustfile.py --web-host 0.0.0.0
```

Open <http://localhost:8089>. Set **Number of users** to `1` and **Spawn rate** to `1`, then start the test. After confirming successful responses, increase users gradually (for example, 3 users at spawn rate 1). The script waits 100–400 ms between requests per user.

`host.docker.internal` lets the Locust container reach the host's port-forward on Docker Desktop. If your Docker engine does not resolve it, run Locust directly on the host with Locust installed and use `TARGET_HOST=http://localhost:8000`; this still does not require a project `.venv`.

## 4. Confirm traffic reached the inference pods

Before and after a short Locust run, read the per-pod inference counters. In PowerShell:

```powershell
$pods = kubectl get pods -n mlops -l app=inference-service -o jsonpath='{.items[*].metadata.name}'
foreach ($pod in $pods.Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries)) {
  Write-Host "--- $pod ---"
  kubectl exec -n mlops $pod -- python -c "import urllib.request; print(urllib.request.urlopen('http://localhost:8000/stats').read().decode())"
}
```

Compare each pod's `requests_served` before and after the run. In Locust's Statistics tab, successful `POST /api/v1/predict/[deployment]` rows and a nonzero request rate confirm the UI is generating HTTP requests. The Locust terminal summary also lists replica IDs observed in successful response bodies. `replica_id` is provided by the inference process itself.

The `/stats` counters are in-memory per pod and reset when a pod restarts. A short test may not hit every pod, especially with only one user. For Native Kubernetes Service routing, distribution is selected by Kubernetes; for other strategies, the backend sends the request through the gateway.

## Troubleshooting

- **401**: log in again and set `LOCUST_API_TOKEN` in the same PowerShell session used by `docker run`.
- **403**: use a deployment owned by the logged-in account.
- **404**: check `DEPLOYMENT_NAME` against the Deployments page.
- **400 model run mismatch**: the deployed model run does not match the run served by the inference replicas.
- **502/503**: check backend, gateway, and inference pod readiness with `kubectl get pods -n mlops`.
- **No counter increase**: confirm the Locust statistics show successful responses, then compare the per-pod `/stats` counters again.
