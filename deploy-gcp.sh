#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Airport Price Watch — Google Cloud Run Deployment Script (Always-Free-Tier Caps)
# Automatically grants required Cloud Build IAM roles to the default compute
# service account so newer GCP projects build from source cleanly.
# ==============================================================================

PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
if [[ -z "${PROJECT_ID}" || "${PROJECT_ID}" == "(unset)" ]]; then
  echo "==> Detecting active Google Cloud project..."
  PROJECT_ID="$(gcloud projects list --filter="lifecycleState=ACTIVE" --format="value(projectId)" --limit=1 2>/dev/null || true)"
  if [[ -n "${PROJECT_ID}" ]]; then
    gcloud config set project "${PROJECT_ID}" >/dev/null
  fi
fi

if [[ -z "${PROJECT_ID}" || "${PROJECT_ID}" == "(unset)" ]]; then
  echo "ERROR: No active Google Cloud project found."
  echo "Run: gcloud config set project YOUR_PROJECT_ID && ./deploy-gcp.sh go"
  exit 1
fi

REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="airport-price-watch"
SPREADSHEET_ID="${GSHEETS_SPREADSHEET_ID:-1wZykxwH2V4r54dYVXtM9RKAbWpcruIWcyDk9CqDENDE}"
MODE="${1:-go}"

echo "================================================================"
echo "  Airport Price Watch -> Google Cloud Run"
echo "  Project: ${PROJECT_ID} | Region: ${REGION} | Mode: ${MODE}"
echo "================================================================"

if [[ "${MODE}" == "preflight" ]]; then
  gcloud services list --enabled --project="${PROJECT_ID}" >/dev/null
  echo "PREFLIGHT CHECK PASSED. Run './deploy-gcp.sh go' to deploy."
  exit 0
fi

echo "==> 1/4 Enabling Cloud Run, Cloud Build, Storage & Google Sheets APIs..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  storage.googleapis.com \
  sheets.googleapis.com \
  --project="${PROJECT_ID}"

PROJECT_NUM="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
COMPUTE_SA="${PROJECT_NUM}-compute@developer.gserviceaccount.com"

echo "==> 2/4 Granting Cloud Build source permissions to ${COMPUTE_SA}..."
for ROLE in \
  roles/cloudbuild.builds.builder \
  roles/storage.objectAdmin \
  roles/artifactregistry.writer \
  roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${COMPUTE_SA}" \
    --role="${ROLE}" \
    --condition=None \
    --quiet >/dev/null
done

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/run.builder" \
  --condition=None \
  --quiet >/dev/null 2>&1 || true

SOURCE_BUCKET="gs://run-sources-${PROJECT_ID}-${REGION}"
if gcloud storage buckets describe "${SOURCE_BUCKET}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud storage buckets add-iam-policy-binding "${SOURCE_BUCKET}" \
    --member="serviceAccount:${COMPUTE_SA}" \
    --role="roles/storage.objectAdmin" \
    --quiet >/dev/null 2>&1 || true
fi

echo "    Waiting 12s for IAM permissions to propagate..."
sleep 12

echo "==> 3/4 Building & Deploying container to Cloud Run (min=0, max=1, 512Mi)..."
APP_ENC_KEY="${APP_ENCRYPTION_KEY:-$(openssl rand -hex 32)}"
ENV_VARS="GSHEETS_ENABLED=true,GSHEETS_SPREADSHEET_ID=${SPREADSHEET_ID},GEMINI_MODEL=gemini-2.5-flash,APP_ENCRYPTION_KEY=${APP_ENC_KEY}"
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
echo "================================================================"
echo "  4/4 LIVE PUBLIC LINKS READY FOR EXAMINATION!"
echo "================================================================"
echo "  Main Platform:       ${SERVICE_URL}/"
echo "  Mobile Volunteer UI: ${SERVICE_URL}/submit.html"
echo "  Admin Console:       ${SERVICE_URL}/admin.html"
echo "================================================================"
