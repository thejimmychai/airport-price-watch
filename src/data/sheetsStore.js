const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execFileAsync = promisify(execFile);

const DEFAULT_SPREADSHEET_ID = '1wZykxwH2V4r54dYVXtM9RKAbWpcruIWcyDk9CqDENDE';

function getSpreadsheetId() {
  return process.env.GSHEETS_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
}

function isSheetsEnabled() {
  if (process.env.GSHEETS_ENABLED === 'false') return false;
  return Boolean(process.env.GSHEETS_ENABLED === 'true' || process.env.GSHEETS_SPREADSHEET_ID);
}

function hasLocalGsheetsCli() {
  return fs.existsSync('/opt/antigravity/bin/gsheets');
}

async function fetchCloudRunAccessToken() {
  const url =
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=https://www.googleapis.com/auth/spreadsheets';
  const res = await fetch(url, {
    headers: { 'Metadata-Flavor': 'Google' },
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) {
    throw new Error(`Metadata server token error (${res.status})`);
  }
  const json = await res.json();
  return json.access_token;
}

async function runRestSheetsOperations(spreadsheetId, operations) {
  const token = await fetchCloudRunAccessToken();
  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  for (const item of operations) {
    if (item.op === 'clear') {
      await fetch(`${baseUrl}/values/${encodeURIComponent(item.range)}:clear`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });
    } else if (item.op === 'write') {
      const res = await fetch(
        `${baseUrl}/values/${encodeURIComponent(item.range)}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ values: item.data }),
        }
      );
      if (!res.ok) {
        throw new Error(`Google Sheets write failed (${res.status})`);
      }
    } else if (item.op === 'append') {
      const res = await fetch(
        `${baseUrl}/values/${encodeURIComponent(item.range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ values: item.data }),
        }
      );
      if (!res.ok) {
        throw new Error(`Google Sheets append failed (${res.status})`);
      }
    }
  }
  return { ok: true, mode: 'cloud-run-rest' };
}

async function runGsheetsBatch(spreadsheetId, operations) {
  if (!hasLocalGsheetsCli()) {
    return runRestSheetsOperations(spreadsheetId, operations);
  }

  const tmpFile = path.join('/tmp', `apw_gsheets_${Date.now()}_${Math.random().toString(16).slice(2)}.json`);
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(operations, null, 2), 'utf8');
    const { stdout } = await execFileAsync('gsheets', ['mutate', 'batch', spreadsheetId, '-f', tmpFile], {
      timeout: 20000,
    });
    return { ok: true, mode: 'gsheets-cli', stdout };
  } finally {
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  }
}

function receiptsToRows(receipts) {
  const header = [
    'Receipt_ID',
    'Submission_Hash',
    'Track',
    'Airport_Code',
    'Region',
    'Terminal_Or_Neighborhood',
    'Merchant_Name',
    'Vendor_Affiliation',
    'Purchase_Date',
    'Purchase_Time',
    'Item_Raw_Name',
    'Standardized_Product',
    'Category',
    'Quantity',
    'Unit_Price_USD',
    'Tax_USD',
    'Receipt_Total_USD',
    'Anonymous',
    'Encrypted_Consent',
    'Review_Status',
    'Admin_Notes',
  ];
  const rows = [header];
  for (const r of receipts) {
    for (const item of r.lineItems) {
      rows.push([
        r.id,
        r.submissionHash,
        r.track,
        r.airportCode,
        r.region || '',
        r.terminalOrLocation || '',
        r.merchantName,
        r.vendorAffiliation,
        r.purchaseDate,
        r.purchaseTime || '',
        item.rawName,
        item.standardizedProductKey,
        item.category,
        Number(item.quantity || 1),
        Number(Number(item.unitPrice || 0).toFixed(2)),
        Number(Number(r.tax || 0).toFixed(2)),
        Number(Number(r.total || 0).toFixed(2)),
        Boolean(r.isAnonymous),
        Boolean(r.hasEncryptedConsent),
        r.reviewStatus || 'approved',
        r.adminNotes || '',
      ]);
    }
  }
  return rows;
}

function consentProfilesToRows(profiles) {
  const header = [
    'Profile_ID',
    'Pseudonym_Token',
    'Algorithm',
    'KMS_Key_ID',
    'IV_Base64',
    'Auth_Tag_Base64',
    'Ciphertext_Base64',
    'Encrypted_At',
  ];
  const rows = [header];
  for (const p of profiles) {
    rows.push([
      p.profileId,
      p.pseudonymToken,
      p.envelope.algorithm,
      p.envelope.keyId,
      p.envelope.iv,
      p.envelope.authTag,
      p.envelope.ciphertext,
      p.envelope.encryptedAt,
    ]);
  }
  return rows;
}

function auditReportToRows(analysis, audit) {
  const rows = [
    ['Airport Price Watch — Agent 2 & Agent 3 Audit Report', ''],
    ['Generated At', audit.completedAt],
    ['Data Integrity Score', `${audit.integrityScore}/100`],
    ['Total Airport Receipts', analysis.summary.totalAirportReceipts],
    ['Total Street Baseline Receipts', analysis.summary.totalStreetReceipts],
    ['Overall Avg Airport Markup %', `+${analysis.summary.overallAvgMarkupPct}%`],
    ['Policy Cap Violation Rate %', `${analysis.summary.violationRatePct}%`],
    ['Executive Summary', audit.transparencyReport.executiveSummary],
    ['', ''],
    ['Airport Breakdown', 'Region', 'Policy Cap %', 'Avg Markup %', 'Avg Airport $', 'Avg Street $'],
  ];
  for (const a of analysis.byAirport) {
    rows.push([
      a.airportCode,
      a.region,
      `${a.policyCapPct}%`,
      `+${a.avgMarkupPct}%`,
      a.avgAirportPrice,
      a.avgStreetPrice,
    ]);
  }
  rows.push(['', '']);
  rows.push(['Audit Flags', 'Severity', 'Receipt ID', 'Detail']);
  for (const f of audit.flags) {
    rows.push([f.type, f.severity, f.receiptId || 'N/A', f.detail]);
  }
  return rows;
}

async function syncDatabaseToGoogleSheet(db) {
  const spreadsheetId = getSpreadsheetId();
  const receiptRows = receiptsToRows(db.receipts || []);
  const consentRows = consentProfilesToRows(db.encryptedVolunteerProfiles || []);
  const ops = [
    { op: 'clear', range: 'Receipts!A1:U500' },
    { op: 'write', range: 'Receipts!A1', data: receiptRows },
    { op: 'clear', range: 'Encrypted_Consent!A1:H500' },
    { op: 'write', range: 'Encrypted_Consent!A1', data: consentRows },
  ];

  if (db.latestAnalysis && db.latestAuditReport) {
    const auditRows = auditReportToRows(db.latestAnalysis, db.latestAuditReport);
    ops.push({ op: 'clear', range: 'Agent3_Audit_Report!A1:F200' });
    ops.push({ op: 'write', range: 'Agent3_Audit_Report!A1', data: auditRows });
  }

  return runGsheetsBatch(spreadsheetId, ops);
}

async function appendReceiptToGoogleSheet(receipt) {
  const spreadsheetId = getSpreadsheetId();
  const rows = receiptsToRows([receipt]).slice(1);
  return runGsheetsBatch(spreadsheetId, [
    { op: 'append', range: 'Receipts!A1', data: rows },
  ]);
}

async function appendEncryptedConsentToGoogleSheet(profileRecord) {
  const spreadsheetId = getSpreadsheetId();
  const rows = consentProfilesToRows([profileRecord]).slice(1);
  return runGsheetsBatch(spreadsheetId, [
    { op: 'append', range: 'Encrypted_Consent!A1', data: rows },
  ]);
}

module.exports = {
  DEFAULT_SPREADSHEET_ID,
  getSpreadsheetId,
  isSheetsEnabled,
  syncDatabaseToGoogleSheet,
  appendReceiptToGoogleSheet,
  appendEncryptedConsentToGoogleSheet,
};
