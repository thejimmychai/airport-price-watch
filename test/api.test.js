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

test('POST /api/agent1/inspect smart OCR extracts all 8 regions accurately on LAX HMSHost receipt even with wrong airport hint', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const imgBuf = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample_lax_receipt.png'));

  const formData = new FormData();
  formData.append('track', 'airport');
  formData.append('hintAirport', 'JFK'); // Intentionally wrong hint — OCR must auto-detect LAX
  formData.append('receiptImage', new Blob([imgBuf], { type: 'image/png' }), 'sample_lax_receipt.png');

  const res = await fetch(`${baseUrl}/api/agent1/inspect`, {
    method: 'POST',
    body: formData,
  });
  assert.equal(res.status, 200);
  const { extracted } = await res.json();

  assert.equal(extracted.airportCode, 'LAX');
  assert.equal(extracted.merchantName, 'STARBUCKS #7140 (HMSHOST)');
  assert.equal(extracted.potentialChainAffiliation, 'HMSHost (Avolta)');
  assert.ok(
    extracted.terminalOrLocation.includes('TERMINAL 6') && extracted.terminalOrLocation.includes('GATE 64A'),
    `Expected clean Terminal 6 / Gate 64A location without HMSHOST collision, got: ${extracted.terminalOrLocation}`
  );
  assert.ok(!extracted.terminalOrLocation.includes('HMSHOST'));
  assert.equal(extracted.purchaseDate, '2026-11-14');
  assert.equal(extracted.purchaseTime, '08:14');
  assert.equal(extracted.lineItems.length, 3);
  assert.equal(extracted.lineItems[0].rawName, 'GRANDE CAFFE LATTE 16OZ');
  assert.equal(extracted.lineItems[2].rawName, 'ETHOS BOTTLED WATER 20OZ');
  assert.equal(extracted.tax, 2.86);
  assert.equal(extracted.total, 33.01);

  const kinds = new Set(extracted.annotations.map((a) => a.kind));
  for (const expectedKind of ['merchant', 'vendor', 'airport', 'location', 'datetime', 'item', 'tax', 'total']) {
    assert.ok(kinds.has(expectedKind), `Missing annotation kind: ${expectedKind}`);
  }
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

test('Global world airports catalog covers 5,200+ airports ranked US -> North America -> Worldwide and supports international receipts', async () => {
  const { WORLD_AIRPORTS_LIST, searchAirports } = require('../public/world-airports');

  const bootRes = await fetch(`${baseUrl}/api/bootstrap`);
  assert.equal(bootRes.status, 200);
  const boot = await bootRes.json();

  assert.ok(boot.metadata.totalWorldAirports > 5000, `Expected >5,000 world airports, got ${boot.metadata.totalWorldAirports}`);
  assert.equal(WORLD_AIRPORTS_LIST.length, boot.metadata.totalWorldAirports);

  const airports = boot.metadata.airports;
  // Verify Tier 1 (US Major Hub) < Tier 2 (US Regional) < Tier 3 (North America) < Tier 4 (Worldwide)
  assert.equal(airports.ATL.tier, 1);
  assert.equal(airports.JFK.tier, 1);
  assert.equal(airports.PWM.tier, 2); // Portland, ME (US Regional)
  assert.equal(airports.YYZ.tier, 3); // Toronto Pearson (North America)
  assert.equal(airports.MEX.tier, 3); // Mexico City (North America)
  assert.equal(airports.CUN.tier, 3); // Cancun (North America)
  assert.equal(airports.LHR.tier, 4); // London Heathrow (Worldwide)
  assert.equal(airports.HND.tier, 4); // Tokyo Haneda (Worldwide)
  assert.equal(airports.SYD.tier, 4); // Sydney (Worldwide)

  assert.ok(airports.ATL.rank < airports.PWM.rank, 'US Major Hub must rank ahead of US Regional');
  assert.ok(airports.PWM.rank < airports.YYZ.rank, 'US Regional must rank ahead of North America');
  assert.ok(airports.YYZ.rank < airports.LHR.rank, 'North America must rank ahead of rest of World');

  // Verify search preserves US -> North America -> World priority within match buckets
  const londonHits = searchAirports('london');
  assert.ok(londonHits.some((a) => a.code === 'LHR'));
  const torontoHits = searchAirports('toronto');
  assert.equal(torontoHits[0].code, 'YYZ');

  // Verify Agent 1 auto-detects North American (YYZ) and European (LHR) receipts without TAX/SUB false positives
  const yyzForm = new FormData();
  yyzForm.append('track', 'airport');
  yyzForm.append('hintAirport', 'JFK');
  yyzForm.append(
    'rawText',
    'HUDSON NONSTOP\nTORONTO PEARSON INTL AIRPORT (YYZ)\nTERMINAL 1 GATE F62\nSMARTWATER 20OZ $5.99\nSUB TOTAL $5.99\nSALES TAX $0.78\nTOTAL $6.77'
  );
  const yyzInspect = await (await fetch(`${baseUrl}/api/agent1/inspect`, { method: 'POST', body: yyzForm })).json();
  assert.equal(yyzInspect.extracted.airportCode, 'YYZ');

  // Verify receipt without airport code but with SALES TAX / SUB TOTAL keeps hintAirport instead of matching TAX/SUB
  const plainForm = new FormData();
  plainForm.append('track', 'street');
  plainForm.append('hintAirport', 'BOS');
  plainForm.append('rawText', 'CORNER DELI & MARKET\n120 MAIN ST\nBOTTLED WATER 20OZ $1.99\nSUB TOTAL $1.99\nSALES TAX $0.12\nTOTAL $2.11');
  const plainInspect = await (await fetch(`${baseUrl}/api/agent1/inspect`, { method: 'POST', body: plainForm })).json();
  assert.equal(plainInspect.extracted.airportCode, 'BOS');

  // Submit a global receipt (YYZ) and verify /api/admin/traffic includes YYZ without 5,000+ empty rows
  const postRes = await fetch(`${baseUrl}/api/receipts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      track: 'airport',
      airportCode: 'YYZ',
      terminalOrLocation: 'Terminal 1, Gate F62 (Past Security)',
      merchantName: 'Hudson Nonstop YYZ',
      vendorAffiliation: 'Hudson Group (Avolta)',
      lineItems: [{ rawName: 'SMARTWATER 20OZ', standardizedProductKey: 'water_20oz', quantity: 1, unitPrice: 5.99 }],
      tax: 0.78,
      total: 6.77,
      isAnonymous: true,
    }),
  });
  assert.equal(postRes.status, 201);
  const postData = await postRes.json();
  assert.equal(postData.receipt.airportCode, 'YYZ');
  assert.equal(postData.receipt.region, 'North America (Canada)');

  const traf = await (await fetch(`${baseUrl}/api/admin/traffic`)).json();
  assert.ok(traf.promotionTargets.some((t) => t.airportCode === 'YYZ'));
  assert.ok(traf.promotionTargets.length < 50, `Expected compact promotionTargets list, got ${traf.promotionTargets.length}`);
});

test('Frontend pages and custom editorial illustrations serve aviation, reunion, fair-market, affordability, and oversight finishes', async () => {
  const homeRes = await fetch(`${baseUrl}/`);
  assert.equal(homeRes.status, 200);
  const homeHtml = await homeRes.text();
  assert.ok(homeHtml.includes('PUBLIC CONCOURSE &amp; FAIR-MARKET MONITOR'));
  assert.ok(homeHtml.includes('Every Flight Leads to a Reunion.'));
  assert.ok(homeHtml.includes('id="spotlight-family-impact"'));
  assert.ok(homeHtml.includes('id="open-data-video-window"'));
  assert.ok(homeHtml.includes('/assets/reunion-fair-travel.jpg'));
  assert.ok(homeHtml.includes('/assets/civic-oversight-scale.jpg'));

  const mobileRes = await fetch(`${baseUrl}/submit.html`);
  assert.equal(mobileRes.status, 200);
  const mobileHtml = await mobileRes.text();
  assert.ok(mobileHtml.includes('Every Flight Leads to a Reunion'));
  assert.ok(mobileHtml.includes('id="mpu-video-window"'));

  const adminRes = await fetch(`${baseUrl}/admin.html`);
  assert.equal(adminRes.status, 200);
  const adminHtml = await adminRes.text();
  assert.ok(adminHtml.includes('Oversight &amp; Audit Console'));
  assert.ok(adminHtml.includes('Public Concourse Audit Standard:'));

  for (const assetPath of ['/assets/reunion-fair-travel.jpg', '/assets/civic-oversight-scale.jpg']) {
    const imgRes = await fetch(`${baseUrl}${assetPath}`);
    assert.equal(imgRes.status, 200);
    assert.match(imgRes.headers.get('content-type') || '', /image\/jpeg/);
    const bytes = await imgRes.arrayBuffer();
    assert.ok(bytes.byteLength > 20_000, `Expected ${assetPath} > 20KB`);
  }
});



