#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Airport Price Watch — Google Cloud Run Deployment Script (Always-Free-Tier Caps)
# Deploys:
#   1. Express + 3-Agent Pipeline + Tesseract OCR + 3 Front-Ends -> Cloud Run
#   2. Database -> Connected Google Sheet (1wZykxwH2V4r54dYVXtM9RKAbWpcruIWcyDk9CqDENDE)
#   3. Security -> EXIF Stripper + AES-256-GCM Envelope Encryption
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
  echo "Create or select a project first, then run:"
  echo "  gcloud config set project YOUR_PROJECT_ID && ./deploy-gcp.sh go"
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
  echo ""
  echo "PREFLIGHT CHECK PASSED."
  echo "Run './deploy-gcp.sh go' to build and publish your public URL."
  exit 0
fi

echo "==> 1/3 Enabling Cloud Run, Cloud Build & Google Sheets APIs..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  sheets.googleapis.com \
  --project="${PROJECT_ID}"

echo "==> 2/3 Building & Deploying container to Cloud Run (min=0, max=1, 512Mi)..."
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
SA_EMAIL="$(gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --project="${PROJECT_ID}" --format='value(spec.template.spec.serviceAccountName)' 2>/dev/null || true)"
if [[ -z "${SA_EMAIL}" ]]; then
  PROJECT_NUM="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)' 2>/dev/null || true)"
  SA_EMAIL="${PROJECT_NUM}-compute@developer.gserviceaccount.com"
fi

echo ""
echo "================================================================"
echo "  3/3 LIVE PUBLIC LINKS READY FOR EXAMINATION!"
echo "================================================================"
echo "  Main Platform:       ${SERVICE_URL}/"
echo "  Mobile Volunteer UI: ${SERVICE_URL}/submit.html"
echo "  Admin Console:       ${SERVICE_URL}/admin.html"
echo ""
echo "  Google Sheets Sync Service Account:"
echo "  ${SA_EMAIL}"
echo "  (Share Google Sheet ${SPREADSHEET_ID} as Editor with this email,"
echo "   or paste this email back into chat and I will share it for you!)"
echo "================================================================"
