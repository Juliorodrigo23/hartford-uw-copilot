# Deploying to juliooo.com/hartford

End-to-end deploy: backend on Cloud Run, frontend on Vercel, surfaced under the
`/hartford` subpath of `juliooo.com`.

## 0. One-time prerequisites

```bash
# Local CLI tooling
brew install gh pnpm uv google-cloud-sdk
npm i -g vercel

# GCP project + billing (skip if you already have one)
gcloud auth login
gcloud projects create juliooo-uw-copilot --set-as-default
gcloud beta billing projects link juliooo-uw-copilot --billing-account=YOUR_BILLING_ACCT

# Optional ADC authentication (only for GEMINI_AUTH_MODE=adc)
gcloud auth application-default login
```

Enable APIs:

```bash
gcloud services enable \
  aiplatform.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com
```

## 1. Backend service account + secrets

```bash
PROJECT_ID=$(gcloud config get-value project)
REGION=us-central1

# Service account that Cloud Run runs as
gcloud iam service-accounts create uw-copilot-runner \
  --display-name="UW Copilot Cloud Run runtime"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:uw-copilot-runner@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:uw-copilot-runner@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# HMAC shared secret (used by the Vercel route to sign requests)
HMAC=$(openssl rand -hex 32)
echo -n "$HMAC" | gcloud secrets create hmac-secret --data-file=- --replication-policy=automatic

# Model keys: keep values in private local files or enter via stdin, never Git.
# Gemini Developer API key used by the default deployment
gcloud secrets create gemini-api-key --replication-policy=automatic
gcloud secrets versions add gemini-api-key --data-file=/path/to/private/google-key-file

# OpenAI key (required for the cross-family live critic and generation evals)
gcloud secrets create openai-api-key --replication-policy=automatic
echo -n "sk-..." | gcloud secrets versions add openai-api-key --data-file=-

# Artifact registry repo
gcloud artifacts repositories create uw-copilot \
  --repository-format=docker --location=$REGION
```

Save `$HMAC` — you'll set it as `HMAC_SECRET` in Vercel.

## 2. Build & deploy the backend

```bash
gcloud builds submit --config cloudbuild.yaml
```

That builds the Docker image, pushes to Artifact Registry, and deploys to
Cloud Run with `min=1, min-instances=1, max-instances=3`. Note the service URL it
prints (e.g. `https://uw-copilot-backend-xyz-uc.a.run.app`).

Cloud Run stays in `us-central1`. The default model path uses `GEMINI_AUTH_MODE=api_key` and `GEMINI_API_BACKEND=developer`, with `GEMINI_API_KEY=gemini-api-key:latest`. Set the same values locally to use an API key; no gcloud login is needed for inference. `GCP_LOCATION=global` applies to the alternate ADC/Vertex path, independently of the Cloud Run region.
The current configured models are `gemini-3.8-flash` and `gemini-3.5-flash-lite`.
The startup probe calls `/ready`, which returns 503 until retrieval is warm.
Use `/health` for liveness and `/diag` for model names, location, index counts,
and whether the OpenAI key is configured. `openai_configured` checks presence,
not key validity; verify a live explicit OpenAI critique after rotation.

For a source-only repair, `cloudbuild.hotfix.yaml` builds on a pinned deployed
image and preserves its exact dependencies and data. Use it only when those
dependencies and data remain appropriate; ordinary rebuilds use `cloudbuild.yaml`.

Smoke test:

```bash
SERVICE_URL=$(gcloud run services describe uw-copilot-backend --region=$REGION --format='value(status.url)')
curl "$SERVICE_URL/health"
```

## 3. Deploy the frontend to Vercel

From `frontend/`:

```bash
cd frontend
vercel link              # pick a new project named e.g. uw-copilot-hartford
vercel env add BACKEND_URL production   # paste the Cloud Run URL
vercel env add HMAC_SECRET production   # paste the $HMAC from step 1
vercel env add NEXT_PUBLIC_BASE_PATH production   # paste: /hartford
vercel --prod
```

This gives you a Vercel URL like `uw-copilot-hartford.vercel.app`.
The whole site lives under `/hartford` on that URL (`basePath` from
`next.config.ts`).

## 4. Surface it at juliooo.com/hartford

Two paths — pick the one that matches how `juliooo.com` is hosted today.

### 4a. Recommended — subpath rewrite (works only if juliooo.com is on Vercel)

Add this to `juliooo.com`'s `vercel.json`:

```json
{
  "rewrites": [
    {
      "source": "/hartford/:path*",
      "destination": "https://uw-copilot-hartford.vercel.app/hartford/:path*"
    }
  ]
}
```

Redeploy `juliooo.com`. The Hartford project keeps `basePath: '/hartford'`
and the subpath simply works.

### 4b. Subdomain fallback (any host)

If `juliooo.com` lives on Cloudflare, Netlify, a custom server, etc., it's
much simpler to use a subdomain:

1. In the Vercel Hartford project, **Settings → Domains** → add
   `hartford.juliooo.com`. Vercel shows a CNAME target.
2. At your DNS provider (whoever runs juliooo.com's DNS):
   ```
   hartford   CNAME   cname.vercel-dns.com.
   ```
3. In `frontend/next.config.ts`, drop `basePath` and `assetPrefix`. Redeploy.

The site is now at `https://hartford.juliooo.com/`. UX is identical; you save the rewrite headache.

## 5. Verify end-to-end

```bash
curl -sN -X POST https://uw-copilot-hartford.vercel.app/hartford/api/chat \
  -H 'content-type: application/json' \
  -d '{"submission_id":"SUB-001","message":"Triage this submission"}'
```

You should see `event: node_enter` … followed by token streaming and a `final` event.

Open the live site, pick a submission, watch the trace populate. If the
chatbot returns a 502, check Cloud Run logs — the most common cause is a
missing IAM permission on the service account.

## 6. Cost notes

- One minimum warm instance incurs ongoing idle billing. Check current Cloud Run and model pricing for your region, resource allocation, and usage.
- Model inference is billed per request/token usage; the recorded walkthrough avoids model calls.
- To deliberately return to scale-to-zero later, update both minimum settings and the deployment configuration so a later deployment does not restore hot start.

## 7. Operational tips

- Watch logs: `gcloud logging tail "resource.type=cloud_run_revision"`.
- If SAFER scrapes get rate-limited, the cache in `data/raw/fmcsa/safer_cache/` keeps responses warm.
- Re-run only what changed: `08_export_viz_data.py` is fast (< 1 min) once the index exists.

## Optional FMCSA credential

`FMCSA_WEBKEY` is optional. Verified cached profiles and public SAFER lookup remain available without it. If configured later, store the webKey in Secret Manager and mount it as `FMCSA_WEBKEY`; the model-key update does not require it. Do not place an FMCSA key in a frontend environment variable.
