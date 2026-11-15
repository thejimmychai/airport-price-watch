const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const app = require('../server');
const {
  encryptConsentPayload,
  decryptConsentPayload,
  stripImageMetadata,
} = require('../src/security/encryption');

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('Envelope encryption round-trips consented PII without leaking plaintext', () => {
  const secretPii = {
    email: 'volunteer@example.org',
    zipCode: '11432',
    policyTestimonyOptIn: true,
  };
  const envelope = encryptConsentPayload(secretPii);
  assert.equal(envelope.algorithm, 'AES-256-GCM-ENVELOPE');
  assert.ok(!envelope.ciphertext.includes('volunteer@example.org'));

  const decrypted = decryptConsentPayload(envelope);
  assert.deepEqual(decrypted, secretPii);
});

test('stripImageMetadata removes JPEG APP1 EXIF segment', () => {
  // Minimal JPEG: SOI (FF D8) + APP1 (FF E1, len=8, "Exif\0\0") + EOI (FF D9)
  const fakeJpeg = Buffer.from([
    0xff, 0xd8,
    0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0xff, 0xd9,
  ]);
  const { cleanedBuffer, strippedSegments } = stripImageMetadata(fakeJpeg, 'image/jpeg');
  assert.equal(strippedSegments, 1);
  assert.deepEqual(cleanedBuffer, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
});

test('GET /api/health and /api/bootstrap return initialized 3-agent state', async () => {
  const healthRes = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthRes.status, 200);
  const health = await healthRes.json();
  assert.equal(health.status, 'ok');
  assert.equal(health.encryptionAlgorithm, 'AES-256-GCM-ENVELOPE');

  const bootRes = await fetch(`${baseUrl}/api/bootstrap`);
  assert.equal(bootRes.status, 200);
  const boot = await bootRes.json();
  assert.ok(boot.receipts.length >= 12);
  assert.ok(boot.latestAnalysis.summary.overallAvgMarkupPct > 0);
  assert.ok(boot.latestAuditReport.integrityScore >= 55);
  assert.ok(boot.latestAuditReport.visualizationPanel.airportGapChart.length > 0);
});

test('POST /api/agent1/inspect extracts all items, keeps store brand as-is, and suggests optional chain affiliation', async () => {
  const formData = new FormData();
  formData.append('track', 'airport');
  formData.append('hintAirport', 'DEN');
  formData.append(
    'rawText',
    'TIMBERLINE STEAKS & GRILLE\nDENVER INTL AIRPORT (DEN)\nCONCOURSE C CENTER (POST-SEC)\nCO CRAFT IPA DRAFT 16OZ   $ 15.50\nBISTRO TURKEY SANDWICH   $ 15.95\nBOTTLED WATER 20OZ   $ 4.99\nSALES TAX   $ 3.21\nTOTAL   $ 39.65'
  );

  const res = await fetch(`${baseUrl}/api/agent1/inspect`, {
    method: 'POST',
    body: formData,
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.extracted.airportCode, 'DEN');
  assert.equal(data.extracted.merchantName, 'TIMBERLINE STEAKS & GRILLE');
  assert.equal(data.extracted.potentialChainAffiliation, 'Delaware North');
  assert.equal(data.extracted.lineItems.length, 3);
  assert.equal(data.extracted.tax, 3.21);
  assert.equal(data.extracted.total, 39.65);
});

test('POST /api/agent1/inspect returns OCR bounding-box annotations for vendor and line items on uploaded receipt photo', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const imgBuf = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample_jfk_receipt.png'));

  const formData = new FormData();
  formData.append('track', 'airport');
  formData.append('hintAirport', 'JFK');
  formData.append('receiptImage', new Blob([imgBuf], { type: 'image/png' }), 'sample_jfk_receipt.png');

  const res = await fetch(`${baseUrl}/api/agent1/inspect`, {
    method: 'POST',
    body: formData,
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.extracted.annotations));
  assert.ok(data.extracted.annotations.length >= 4);

  const merchantAnn = data.extracted.annotations.find((a) => a.kind === 'merchant');
  assert.ok(merchantAnn, 'Expected a merchant bounding-box annotation');
  assert.equal(merchantAnn.targetField, 'merchant');
  assert.ok(merchantAnn.bbox.widthPct > 0 && merchantAnn.bbox.heightPct > 0);

  const itemAnns = data.extracted.annotations.filter((a) => a.kind === 'item');
  assert.ok(itemAnns.length >= 3, 'Expected bounding-box annotations for all 3 receipt items');
  itemAnns.forEach((ann, idx) => {
    assert.equal(ann.targetField, 'item');
    assert.equal(ann.itemIndex, idx);
    assert.ok(ann.bbox.leftPct >= 0 && ann.bbox.topPct >= 0);
  });
});

test('POST /api/receipts supports anonymous & encrypted consent submissions and updates Agent 2 + 3', async () => {
  const res = await fetch(`${baseUrl}/api/receipts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      track: 'street',
      airportCode: 'SFO',
      terminalOrLocation: 'Millbrae Ave, Millbrae, CA 94030',
      merchantName: 'Millbrae Market',
      vendorAffiliation: 'Local Street Retailer',
      lineItems: [
        {
          rawName: 'SMARTWATER 20OZ',
          standardizedProductKey: 'water_20oz',
          quantity: 1,
          unitPrice: 2.29,
        },
      ],
      tax: 0.21,
      total: 2.50,
      isAnonymous: false,
      consentInfo: {
        email: 'policy.helper@example.org',
        zipCode: '94030',
        travelFrequency: 'local_resident',
        policyTestimonyOptIn: true,
      },
    }),
  });
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.encryptionStatus.encrypted, true);
  assert.equal(data.receipt.hasEncryptedConsent, true);
  assert.ok(data.latestAuditReport.transparencyReport.executiveSummary.length > 20);

  // Verify CSV export works
  const csvRes = await fetch(`${baseUrl}/api/export/csv`);
  assert.equal(csvRes.status, 200);
  const csvText = await csvRes.text();
  assert.ok(csvText.includes('Millbrae Market'));
  assert.ok(!csvText.includes('policy.helper@example.org'));

  // Verify admin review & traffic endpoints
  const trafRes = await fetch(`${baseUrl}/api/admin/traffic`);
  assert.equal(trafRes.status, 200);
  const traf = await trafRes.json();
  assert.ok(traf.summary.totalSubmissions >= 12);
  assert.ok(Array.isArray(traf.promotionTargets));

  const patchRes = await fetch(`${baseUrl}/api/admin/receipts/${data.receipt.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      merchantName: 'Millbrae Market (Verified)',
      reviewStatus: 'approved',
      adminNotes: 'Verified street baseline',
    }),
  });
  assert.equal(patchRes.status, 200);
  const patched = await patchRes.json();
  assert.equal(patched.receipt.reviewStatus, 'approved');
  assert.equal(patched.receipt.merchantName, 'Millbrae Market (Verified)');
});

