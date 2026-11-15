const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const { AIRPORT_METADATA, STANDARD_PRODUCTS, loadDb, saveDb } = require('./src/data/store');
const {
  getSpreadsheetId,
  isSheetsEnabled,
  syncDatabaseToGoogleSheet,
  appendReceiptToGoogleSheet,
  appendEncryptedConsentToGoogleSheet,
} = require('./src/data/sheetsStore');
const { isGeminiConfigured } = require('./src/agents/geminiClient');
const {
  VENDOR_AFFILIATIONS,
  runIntakeInspectorAgent,
  runTrendAnalystAgent,
  runAuditVisualizerAgent,
} = require('./src/agents/pipeline');
const {
  encryptConsentPayload,
  createAnonymousReceiptHash,
  stripImageMetadata,
} = require('./src/security/encryption');

const app = express();
const PORT = parseInt(process.env.PORT || '8080', 10);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

async function ensureInitialAnalysisAndAudit(db) {
  if (!db.latestAnalysis || !db.latestAuditReport) {
    const analysis = await runTrendAnalystAgent(db.receipts);
    const audit = await runAuditVisualizerAgent(db.receipts, analysis);
    db.latestAnalysis = analysis;
    db.latestAuditReport = audit;
    db.agentRuns.unshift({
      runId: 'run_init_' + Date.now(),
      timestamp: new Date().toISOString(),
      agents: ['Agent 2: Trend Analyst', 'Agent 3: Audit & Visualizer'],
      mode: analysis.mode,
      integrityScore: audit.integrityScore,
    });
    saveDb(db);
  }
  return db;
}

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'airport-price-watch',
    geminiMode: isGeminiConfigured() ? 'gemini-live' : 'local-deterministic-fallback',
    encryptionAlgorithm: 'AES-256-GCM-ENVELOPE',
    kmsKeyId: process.env.GCP_KMS_KEY_NAME || 'local-kms-aes256-gcm-v1',
    storageBackend: isSheetsEnabled() ? 'google-sheets-db' : 'local-json-store',
    spreadsheetId: isSheetsEnabled() ? getSpreadsheetId() : null,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/bootstrap', async (req, res) => {
  try {
    const db = await ensureInitialAnalysisAndAudit(loadDb());
    res.json({
      metadata: {
        airports: AIRPORT_METADATA,
        products: STANDARD_PRODUCTS,
        vendors: VENDOR_AFFILIATIONS,
        geminiMode: isGeminiConfigured() ? 'gemini-live' : 'local-deterministic-fallback',
      },
      receipts: db.receipts,
      latestAnalysis: db.latestAnalysis,
      latestAuditReport: db.latestAuditReport,
      agentRuns: db.agentRuns.slice(0, 12),
      securityStats: {
        totalEncryptedConsentProfiles: db.encryptedVolunteerProfiles.length,
        anonymousReceiptsCount: db.receipts.filter((r) => r.isAnonymous).length,
        encryptionAlgorithm: 'AES-256-GCM-ENVELOPE',
        kmsKeyId: process.env.GCP_KMS_KEY_NAME || 'local-kms-aes256-gcm-v1',
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Agent 1: Inspect incoming receipt (image and/or text), strip EXIF metadata,
 * and return pre-filled standardized form fields for volunteer review.
 */
app.post('/api/agent1/inspect', upload.single('receiptImage'), async (req, res) => {
  try {
    const { rawText = '', track = 'airport', hintAirport = 'JFK' } = req.body || {};
    let imageBase64 = null;
    let imageMimeType = null;
    let strippedSegments = 0;

    if (req.file && req.file.buffer) {
      const { cleanedBuffer, strippedSegments: stripped } = stripImageMetadata(
        req.file.buffer,
        req.file.mimetype
      );
      strippedSegments = stripped;
      imageBase64 = cleanedBuffer.toString('base64');
      imageMimeType = req.file.mimetype;
    }

    const result = await runIntakeInspectorAgent({
      rawText,
      imageBase64,
      imageMimeType,
      track,
      hintAirport,
    });

    res.json({
      ...result,
      privacyCheck: {
        exifMetadataStripped: Boolean(req.file),
        strippedSegments,
        message: req.file
          ? `Image sanitized: ${strippedSegments} metadata segment(s) stripped before AI inspection.`
          : 'Text-only intake: no image metadata present.',
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Submit volunteer-confirmed receipt (Airport or Street Market).
 * Supports Anonymous Submission (default) or Optional Encrypted Policy-Support Consent.
 */
app.post('/api/receipts', async (req, res) => {
  try {
    const body = req.body || {};
    const {
      track = 'airport',
      airportCode = 'JFK',
      terminalOrLocation = '',
      merchantName = '',
      vendorAffiliation = 'Hudson Group (Avolta)',
      purchaseDate,
      purchaseTime,
      lineItems = [],
      tax = 0,
      total = 0,
      aiIntakeMode = 'agent1-assisted',
      isAnonymous = true,
      consentInfo = null,
    } = body;

    if (!merchantName || !Array.isArray(lineItems) || lineItems.length === 0) {
      return res.status(400).json({
        error: 'merchantName and at least one lineItem are required.',
      });
    }

    const db = loadDb();
    const submissionHash = createAnonymousReceiptHash();
    const airportMeta = AIRPORT_METADATA[airportCode] || { region: 'Other' };

    const newReceipt = {
      id: 'rcpt_' + crypto.randomBytes(6).toString('hex'),
      submissionHash,
      track: track === 'street' ? 'street' : 'airport',
      airportCode: airportCode.toUpperCase(),
      region: airportMeta.region,
      terminalOrLocation: terminalOrLocation || (track === 'street' ? 'Nearby Metro Area' : 'Terminal Concourse'),
      merchantName: merchantName.trim(),
      vendorAffiliation,
      purchaseDate: purchaseDate || new Date().toISOString().slice(0, 10),
      purchaseTime: purchaseTime || new Date().toTimeString().slice(0, 5),
      isAnonymous: Boolean(isAnonymous),
      hasEncryptedConsent: Boolean(!isAnonymous && consentInfo),
      verifiedByVolunteer: true,
      aiIntakeMode,
      lineItems: lineItems.map((item) => ({
        rawName: String(item.rawName || 'ITEM').trim(),
        standardizedProductKey: item.standardizedProductKey || 'water_20oz',
        category: item.category || STANDARD_PRODUCTS[item.standardizedProductKey]?.category || 'Snacks & Candy',
        unitSize: String(item.unitSize || '1 unit'),
        quantity: Number(item.quantity || 1),
        unitPrice: Number(Number(item.unitPrice || 0).toFixed(2)),
        confidence: Number(item.confidence || 1.0),
      })),
      tax: Number(Number(tax || 0).toFixed(2)),
      total: Number(Number(total || 0).toFixed(2)),
      createdAt: new Date().toISOString(),
    };

    db.receipts.unshift(newReceipt);

    let encryptedProfileRecord = null;
    if (!isAnonymous && consentInfo && (consentInfo.email || consentInfo.zipCode || consentInfo.policyNotes)) {
      const envelope = encryptConsentPayload({
        email: consentInfo.email || '',
        zipCode: consentInfo.zipCode || '',
        travelFrequency: consentInfo.travelFrequency || 'occasional',
        policyTestimonyOptIn: Boolean(consentInfo.policyTestimonyOptIn),
        policyNotes: consentInfo.policyNotes || '',
        consentedAt: new Date().toISOString(),
      });

      encryptedProfileRecord = {
        profileId: 'enc_prof_' + crypto.randomBytes(6).toString('hex'),
        // Decoupled cryptographic link; public receipt table does not store PII
        pseudonymToken: crypto.createHash('sha256').update(submissionHash).digest('hex').slice(0, 16),
        envelope,
      };
      db.encryptedVolunteerProfiles.push(encryptedProfileRecord);
    }

    // Automatically run Agent 2 (Trend Analysis) & Agent 3 (Audit + Visualization Updater)
    const analysis = await runTrendAnalystAgent(db.receipts);
    const audit = await runAuditVisualizerAgent(db.receipts, analysis);

    db.latestAnalysis = analysis;
    db.latestAuditReport = audit;
    db.agentRuns.unshift({
      runId: 'run_' + Date.now(),
      timestamp: new Date().toISOString(),
      trigger: `New ${newReceipt.track} receipt (${newReceipt.airportCode})`,
      agents: ['Agent 1: Intake', 'Agent 2: Trend Analyst', 'Agent 3: Audit & Visualizer'],
      mode: analysis.mode,
      integrityScore: audit.integrityScore,
    });

    saveDb(db);

    if (isSheetsEnabled()) {
      await appendReceiptToGoogleSheet(newReceipt);
      if (encryptedProfileRecord) {
        await appendEncryptedConsentToGoogleSheet(encryptedProfileRecord);
      }
      await syncDatabaseToGoogleSheet(db);
    }

    res.status(201).json({
      receipt: newReceipt,
      encryptionStatus: encryptedProfileRecord
        ? {
            encrypted: true,
            algorithm: encryptedProfileRecord.envelope.algorithm,
            keyId: encryptedProfileRecord.envelope.keyId,
            profileId: encryptedProfileRecord.profileId,
          }
        : { encrypted: false, anonymous: true },
      latestAnalysis: analysis,
      latestAuditReport: audit,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Manually trigger Agent 2 (Trend Analyst) & Agent 3 (Audit & Visualizer)
 */
app.post('/api/agents/run-pipeline', async (req, res) => {
  try {
    const db = loadDb();
    const analysis = await runTrendAnalystAgent(db.receipts);
    const audit = await runAuditVisualizerAgent(db.receipts, analysis);

    db.latestAnalysis = analysis;
    db.latestAuditReport = audit;
    db.agentRuns.unshift({
      runId: 'run_' + Date.now(),
      timestamp: new Date().toISOString(),
      trigger: 'Manual 3-Agent Pipeline Refresh',
      agents: ['Agent 2: Trend Analyst', 'Agent 3: Audit & Visualizer'],
      mode: analysis.mode,
      integrityScore: audit.integrityScore,
    });

    saveDb(db);

    res.json({
      latestAnalysis: analysis,
      latestAuditReport: audit,
      agentRuns: db.agentRuns.slice(0, 12),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Export standardized crowdsourced dataset as CSV (Excel-compatible)
 */
app.get('/api/export/csv', (req, res) => {
  const db = loadDb();
  const headers = [
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
    'Unit_Size',
    'Quantity',
    'Unit_Price_USD',
    'Tax_USD',
    'Receipt_Total_USD',
    'Anonymous_Submission',
    'Encrypted_Consent',
  ];

  const rows = [headers.join(',')];
  const esc = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;

  for (const r of db.receipts) {
    for (const item of r.lineItems) {
      rows.push(
        [
          esc(r.id),
          esc(r.submissionHash),
          esc(r.track),
          esc(r.airportCode),
          esc(r.region),
          esc(r.terminalOrLocation),
          esc(r.merchantName),
          esc(r.vendorAffiliation),
          esc(r.purchaseDate),
          esc(r.purchaseTime),
          esc(item.rawName),
          esc(item.standardizedProductKey),
          esc(item.category),
          esc(item.unitSize),
          item.quantity,
          item.unitPrice.toFixed(2),
          r.tax.toFixed(2),
          r.total.toFixed(2),
          r.isAnonymous,
          r.hasEncryptedConsent,
        ].join(',')
      );
    }
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="airport-price-watch-dataset.csv"');
  res.send(rows.join('\n'));
});

app.get('/api/security/audit', (req, res) => {
  const db = loadDb();
  res.json({
    anonymousSubmissions: db.receipts.filter((r) => r.isAnonymous).length,
    encryptedConsentProfiles: db.encryptedVolunteerProfiles.length,
    encryptionStandard: 'AES-256-GCM Envelope Encryption (DEK wrapped by KEK / Cloud KMS)',
    kmsKeyId: process.env.GCP_KMS_KEY_NAME || 'local-kms-aes256-gcm-v1',
    piiStoredInPublicReceiptsTable: false,
    sampleEncryptedRecordMetadata: db.encryptedVolunteerProfiles.slice(-3).map((p) => ({
      profileId: p.profileId,
      pseudonymToken: p.pseudonymToken,
      algorithm: p.envelope.algorithm,
      keyId: p.envelope.keyId,
      encryptedAt: p.envelope.encryptedAt,
      ciphertextPreview: p.envelope.ciphertext.slice(0, 24) + '...',
    })),
  });
});

/**
 * Admin: Manual review & correction of a receipt, then re-run Agent 2 + Agent 3
 */
app.patch('/api/admin/receipts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body || {};
    const db = loadDb();
    const idx = db.receipts.findIndex((r) => r.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Receipt not found' });
    }

    const current = db.receipts[idx];
    const updated = {
      ...current,
      merchantName: updates.merchantName !== undefined ? String(updates.merchantName).trim() : current.merchantName,
      vendorAffiliation: updates.vendorAffiliation || current.vendorAffiliation,
      airportCode: updates.airportCode ? String(updates.airportCode).toUpperCase() : current.airportCode,
      terminalOrLocation: updates.terminalOrLocation !== undefined ? String(updates.terminalOrLocation) : current.terminalOrLocation,
      reviewStatus: updates.reviewStatus || current.reviewStatus || 'approved',
      adminNotes: updates.adminNotes !== undefined ? String(updates.adminNotes) : current.adminNotes,
      reviewedAt: new Date().toISOString(),
    };

    if (Array.isArray(updates.lineItems) && updates.lineItems.length > 0) {
      updated.lineItems = updates.lineItems.map((item) => ({
        rawName: String(item.rawName || 'ITEM').trim(),
        standardizedProductKey: item.standardizedProductKey || 'water_20oz',
        category: item.category || STANDARD_PRODUCTS[item.standardizedProductKey]?.category || 'Snacks & Candy',
        unitSize: String(item.unitSize || '1 unit'),
        quantity: Number(item.quantity || 1),
        unitPrice: Number(Number(item.unitPrice || 0).toFixed(2)),
        confidence: 1.0,
      }));
    }
    if (updates.tax !== undefined) updated.tax = Number(Number(updates.tax).toFixed(2));
    if (updates.total !== undefined) updated.total = Number(Number(updates.total).toFixed(2));

    db.receipts[idx] = updated;

    const analysis = await runTrendAnalystAgent(db.receipts);
    const audit = await runAuditVisualizerAgent(db.receipts, analysis);
    db.latestAnalysis = analysis;
    db.latestAuditReport = audit;
    db.agentRuns.unshift({
      runId: 'run_admin_' + Date.now(),
      timestamp: new Date().toISOString(),
      trigger: `Admin review (${updated.id} -> ${updated.reviewStatus})`,
      agents: ['Agent 2: Trend Analyst', 'Agent 3: Audit & Visualizer'],
      mode: analysis.mode,
      integrityScore: audit.integrityScore,
    });
    saveDb(db);

    if (isSheetsEnabled()) {
      await syncDatabaseToGoogleSheet(db);
    }

    res.json({
      receipt: updated,
      latestAnalysis: analysis,
      latestAuditReport: audit,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Admin: Submission & Volunteer Sign-Up Traffic Analytics for Promotion Planning
 */
app.get('/api/admin/traffic', (req, res) => {
  const db = loadDb();
  const byDate = {};
  const byAirport = {};

  for (const code of Object.keys(AIRPORT_METADATA)) {
    byAirport[code] = { airportCode: code, city: AIRPORT_METADATA[code].city, airport: 0, street: 0 };
  }

  for (const r of db.receipts) {
    const date = r.purchaseDate || r.createdAt.slice(0, 10);
    if (!byDate[date]) {
      byDate[date] = { date, airport: 0, street: 0, consentSignups: 0, total: 0 };
    }
    byDate[date][r.track] += 1;
    byDate[date].total += 1;
    if (r.hasEncryptedConsent) byDate[date].consentSignups += 1;

    if (byAirport[r.airportCode]) {
      byAirport[r.airportCode][r.track] += 1;
    }
  }

  const dailyTraffic = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  const promotionTargets = Object.values(byAirport)
    .map((a) => {
      let priority = 'Healthy';
      let recommendation = 'Maintain steady organic collection.';
      if (a.airport === 0 && a.street === 0) {
        priority = 'High — Zero Coverage';
        recommendation = `Launch traveler + local resident outreach in ${a.city}.`;
      } else if (a.street === 0) {
        priority = 'High — Missing Street Baseline';
        recommendation = `Promote local street-market receipt drive near ${a.airportCode} (${a.city}).`;
      } else if (a.airport < 3) {
        priority = 'Medium — Low Sample Size';
        recommendation = `Boost airport traveler QR/flyer promo at ${a.airportCode} (n=${a.airport} < 3).`;
      }
      return { ...a, priority, recommendation };
    });

  const totalReceipts = db.receipts.length;
  const consentSignups = db.encryptedVolunteerProfiles.length;
  const pendingReviews = db.receipts.filter((r) => r.reviewStatus === 'pending_review').length;
  const flaggedCount = db.receipts.filter((r) => r.reviewStatus === 'flagged').length;

  res.json({
    summary: {
      totalSubmissions: totalReceipts,
      consentSignups,
      consentConversionPct: totalReceipts ? Number(((consentSignups / totalReceipts) * 100).toFixed(1)) : 0,
      pendingReviews,
      flaggedCount,
    },
    dailyTraffic,
    promotionTargets,
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Airport Price Watch server listening on http://localhost:${PORT}`);
  });
}

module.exports = app;
