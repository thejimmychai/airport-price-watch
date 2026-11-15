# Airport Price Watch

Crowdsourced airport vs. local neighborhood street-market receipt monitoring platform built to continue More Perfect Union's airport price-gouging transparency investigation (`35ypZJ3Zc0Y`).

## Features

- **Two-Track Receipt Intake**:
  - **Traveler (Airport) Track**: Tag airport IATA code, terminal/gate, concessionaire affiliation (`Hudson Group`, `HMSHost`, `Paradies Lagardère`, `OTG`, etc.), and standardized items.
  - **Local Resident (Street Market) Track**: Submit nearby neighborhood purchases to establish real-time street baselines.
- **Mobile-First Intake + Post-Submit Weekly Dashboard (`/submit.html`)**: Dedicated 3-step mobile receipt intake that unlocks the live weekly AI price analysis after submission.
- **Administrator Review & Traffic Console (`/admin.html`)**: Manual submission review/correction queue (`PATCH /api/admin/receipts/:id`) and daily submission/sign-up traffic planner (`GET /api/admin/traffic`).
- **Google AI 3-Agent Pipeline (`src/agents/pipeline.js`)**:
  1. **Agent 1 (Intake & Standardization)**: Inspects receipt photos/text via Google Gemini (`gemini-2.5-flash` when `GEMINI_API_KEY` is set, with deterministic local fallback) and pre-fills editable form slots.
  2. **Agent 2 (Trend & Cross-Regional Analyst)**: Benchmarks airport markups across regions, categories, vendor affiliations, and 10–15% "street pricing" cap violations.
  3. **Agent 3 (Audit, Report & Visualizer)**: Audits duplicates, price outliers, and missing street baselines; updates the Transparency Report and Visualization Panel.
- **Privacy & Encryption (`src/security/encryption.js`)**:
  - **Anonymous Default**: Strips JPEG EXIF/APP1–APP15 and PNG metadata chunks before inspection and stores only an unlinkable submission hash.
  - **Encrypted Policy Consent**: Optional volunteer info uses `AES-256-GCM` envelope encryption (Cloud KMS ready), decoupled from public pricing records.
- **Google Sheets Database & Cloud Run Deployment**:
  - Supports **Google Sheets DB** (`GSHEETS_ENABLED=true`) for zero-GCP-billing persistence, or **Google Cloud Run + Firestore** (`./deploy-gcp.sh preflight` / `./deploy-gcp.sh go`).

## Quick Start

```bash
npm install
npm test
npm start
```

- Public Monitor: `http://localhost:8080/`
- Mobile Receipt Intake: `http://localhost:8080/submit.html`
- Admin Console: `http://localhost:8080/admin.html`
