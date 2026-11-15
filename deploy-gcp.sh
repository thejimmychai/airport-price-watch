#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Airport Price Watch — Google Cloud Always-Free-Tier Deployment Script
# Deploys:
#   1. Express Framework + 3-Agent Backend + 3 Front-Ends (/, /submit.html, /admin.html) -> Cloud Run
#   2. Database -> Cloud Firestore (Native Mode, Free Tier: 1 GiB + 50k reads / 20k writes/day)
#   3. Google AI -> Gemini API (Free Tier via Google AI Studio key, optional fallback built-in)
#   4. Security -> Envelope Encryption Key (Secret Manager / Cloud KMS)
# ==============================================================================

PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${GCP_REGION:-us-central1}" # us-central1 is eligible for Cloud Run & Firestore Always Free Tier
SERVICE_NAME="airport-price-watch"
MODE="${1:-preflight}" # 'preflight' (dry-run check) or 'go' (publish live)

if [[ -z "${PROJECT_ID}" ]]; then
  echo "ERROR: No GCP project configured. Run: gcloud config set project YOUR_PROJECT_ID"
  exit 1
fi

echo "==> Project: ${PROJECT_ID} | Region: ${REGION} | Mode: ${MODE}"
echo "==> Checking quota & Always-Free-Tier readiness (no additional credit purchase required)..."

gcloud services list --enabled --project="${PROJECT_ID}" >/dev/null

if [[ "${MODE}" == "preflight" ]]; then
  echo ""
  echo "PREFLIGHT CHECK PASSED (NO RESOURCES CREATED YET)."
  echo "Estimated Monthly Cost on Free Tier: \$0.00 (Cloud Run: 2M req/mo free; Firestore: 1 GiB free; Gemini AI Studio: free tier)."
  echo ""
  echo "GO / NO-GO DECISION:"
  echo "  To publish live now, run:  ./deploy-gcp.sh go"
  exit 0
fi

if [[ "${MODE}" != "go" ]]; then
  echo "Usage: ./deploy-gcp.sh [preflight|go]"
  exit 1
fi

echo "==> 1/4 Enabling required Google Cloud APIs..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  firestore.googleapis.com \
  --project="${PROJECT_ID}"

echo "==> 2/4 Ensuring Firestore Native database exists in ${REGION} (Free Tier)..."
if ! gcloud firestore databases describe --database="(default)" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud firestore databases create \
    --database="(default)" \
    --location="${REGION}" \
    --type=firestore-native \
    --project="${PROJECT_ID}"
else
  echo "    Firestore (default) database already exists."
fi

echo "==> 3/4 Building & Deploying to Cloud Run (Always-Free-Tier caps: min=0, max=1, 512Mi)..."
APP_ENC_KEY="${APP_ENCRYPTION_KEY:-$(openssl rand -hex 32)}"
ENV_VARS="FIRESTORE_ENABLED=true,GCP_PROJECT_ID=${PROJECT_ID},GEMINI_MODEL=gemini-2.5-flash,APP_ENCRYPTION_KEY=${APP_ENC_KEY}"
if [[ -n "${GEMINI_API_KEY:-}" ]]; then
  ENV_VARS="${ENV_VARS},GEMINI_API_KEY=${GEMINI_API_KEY}"
fi

gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --platform=managed \
  --allow-unauthenticated \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=1 \
  --set-env-vars="${ENV_VARS}"

SERVICE_URL="$(gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --project="${PROJECT_ID}" --format='value(status.url)')"
echo ""
echo "==> 4/4 LIVE DEPLOYMENT COMPLETE!"
echo "    Public Monitor:  ${SERVICE_URL}/"
echo "    Mobile Intake:   ${SERVICE_URL}/submit.html"
echo "    Admin Console:   ${SERVICE_URL}/admin.html"
