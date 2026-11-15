# Publish Airport Price Watch to Google Cloud Run

Welcome! Your repository (`thejimmychai/airport-price-watch`) is loaded and ready to deploy onto **Google Cloud Run** (`us-central1`, Free-Tier capped at `min-instances=0`, `max-instances=1`, `512Mi`).

## Step 1 — Pick Your Google Cloud Project

Select an existing Google Cloud project below (or keep your active one):

<walkthrough-project-setup></walkthrough-project-setup>

## Step 2 — Deploy & Get Your Public Link

Click the **Copy to Cloud Shell** button on the command below and press **Enter** in the terminal:

```bash
git pull origin main && chmod +x deploy-gcp.sh && ./deploy-gcp.sh go
```

*(If Cloud Shell asks to Authorize your credentials, click **Authorize**.)*

## Step 3 — Open Your Public Links

In ~90 seconds, the terminal will print three live HTTPS links ending in `.run.app`:
- **Main Comparison Platform**: `https://airport-price-watch-....run.app/`
- **Phone Volunteer App**: `https://airport-price-watch-....run.app/submit.html`
- **Admin Review Console**: `https://airport-price-watch-....run.app/admin.html`

Copy that `.run.app` URL (and the printed Service Account email if you want live Google Sheet sync enabled automatically) back into chat!

<walkthrough-conclusion-trophy></walkthrough-conclusion-trophy>
