const state = {
  metadata: { airports: {}, products: {}, vendors: [], geminiMode: 'local-deterministic-fallback' },
  receipts: [],
  latestAnalysis: null,
  latestAuditReport: null,
  agentRuns: [],
  securityStats: null,
  activeTrack: 'airport',
};

// DOM Helpers
const $ = (id) => document.getElementById(id);

function switchTab(tabName) {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${tabName}`);
  });
}

function setTrack(track) {
  state.activeTrack = track;
  $('track-airport-btn').classList.toggle('active', track === 'airport');
  $('track-street-btn').classList.toggle('active', track === 'street');
  $('form-track-badge').textContent = track === 'airport' ? 'Airport Track' : 'Street Market Track';
  $('std-location-label').textContent =
    track === 'airport' ? 'Terminal / Gate / Concourse *' : 'Neighborhood / Street / ZIP *';
  $('std-location').placeholder =
    track === 'airport'
      ? 'e.g. Terminal 4, Gate B24 (Post-Security)'
      : 'e.g. Jamaica Ave, Queens, NY 11432';

  if (track === 'street') {
    $('std-vendor').value = 'Local Street Retailer';
  } else if ($('std-vendor').value === 'Local Street Retailer') {
    $('std-vendor').value = 'Hudson Group (Avolta)';
  }
}

function populateSelects() {
  const airports = state.metadata.airports || {};
  const vendors = state.metadata.vendors || [];

  const airportOptions = Object.entries(airports)
    .map(([code, meta]) => `<option value="${code}">${code} — ${meta.city}</option>`)
    .join('');

  $('hint-airport').innerHTML = airportOptions;
  $('std-airport').innerHTML = airportOptions;
  $('filter-airport').innerHTML = '<option value="all">All Airports</option>' + airportOptions;

  $('std-vendor').innerHTML = vendors
    .map((v) => `<option value="${v}">${v}</option>`)
    .join('');

  // Default date/time
  const now = new Date();
  $('std-date').value = now.toISOString().slice(0, 10);
  $('std-time').value = now.toTimeString().slice(0, 5);
}

function renderLineItems(items = []) {
  const container = $('line-items-container');
  const products = state.metadata.products || {};
  const productOpts = Object.entries(products)
    .map(([key, p]) => `<option value="${key}">${p.label}</option>`)
    .join('');

  if (!items.length) {
    items = [
      {
        rawName: 'BOTTLED WATER 20OZ',
        standardizedProductKey: 'water_20oz',
        quantity: 1,
        unitPrice: 5.99,
        confidence: 1.0,
      },
    ];
  }

  container.innerHTML = '';
  items.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'line-item-card';
    card.innerHTML = `
      <div class="line-item-grid">
        <div>
          <label>Receipt Item Name</label>
          <input type="text" class="li-raw" value="${escapeHtml(item.rawName || '')}" required />
        </div>
        <div>
          <label>Standardized Product</label>
          <select class="li-key">${productOpts}</select>
        </div>
        <div>
          <label>Qty</label>
          <input type="number" class="li-qty" min="1" value="${item.quantity || 1}" required />
        </div>
        <div>
          <label>Unit Price ($)</label>
          <input type="number" class="li-price" step="0.01" min="0" value="${Number(item.unitPrice || 0).toFixed(2)}" required />
        </div>
        <div>
          <button type="button" class="btn btn-outline btn-xs li-remove" title="Remove item">&times;</button>
        </div>
      </div>
    `;
    card.querySelector('.li-key').value = item.standardizedProductKey || 'water_20oz';
    card.querySelector('.li-remove').addEventListener('click', () => {
      if (container.children.length > 1) {
        card.remove();
        recalcTotals();
      }
    });
    card.querySelector('.li-qty').addEventListener('input', recalcTotals);
    card.querySelector('.li-price').addEventListener('input', recalcTotals);
    container.appendChild(card);
  });
  recalcTotals();
}

function recalcTotals() {
  const cards = document.querySelectorAll('.line-item-card');
  let subtotal = 0;
  cards.forEach((card) => {
    const qty = parseFloat(card.querySelector('.li-qty').value) || 0;
    const price = parseFloat(card.querySelector('.li-price').value) || 0;
    subtotal += qty * price;
  });
  const tax = parseFloat($('std-tax').value) || 0;
  $('std-total').value = (subtotal + tax).toFixed(2);
}

function collectLineItems() {
  const products = state.metadata.products || {};
  const items = [];
  document.querySelectorAll('.line-item-card').forEach((card) => {
    const key = card.querySelector('.li-key').value;
    const prod = products[key] || { category: 'Snacks & Candy' };
    items.push({
      rawName: card.querySelector('.li-raw').value.trim(),
      standardizedProductKey: key,
      category: prod.category,
      unitSize: 'standard',
      quantity: parseInt(card.querySelector('.li-qty').value, 10) || 1,
      unitPrice: parseFloat(card.querySelector('.li-price').value) || 0,
    });
  });
  return items;
}

function renderDashboard() {
  const analysis = state.latestAnalysis;
  const audit = state.latestAuditReport;
  if (!analysis || !audit) return;

  // Header AI badge
  const badge = $('gemini-mode-badge');
  if (state.metadata.geminiMode === 'gemini-live') {
    badge.textContent = 'Gemini API: LIVE';
    badge.classList.add('live');
  } else {
    badge.textContent = 'AI Mode: Local Standardizer';
    badge.classList.remove('live');
  }

  // KPIs
  $('kpi-avg-markup').textContent = `+${analysis.summary.overallAvgMarkupPct}%`;
  $('kpi-compared-items').textContent = analysis.summary.totalComparedItems;
  $('kpi-violation-rate').textContent = `${analysis.summary.violationRatePct}%`;
  $('kpi-total-receipts').textContent = state.receipts.length;
  $('kpi-airport-count').textContent = analysis.summary.totalAirportReceipts;
  $('kpi-street-count').textContent = analysis.summary.totalStreetReceipts;
  $('kpi-integrity-score').textContent = `${audit.integrityScore}/100`;
  $('kpi-last-updated').textContent = new Date(audit.completedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  // Visualization Panel (Agent 3)
  const viz = audit.visualizationPanel;
  const maxMarkup = Math.max(250, ...viz.airportGapChart.map((a) => a.avgMarkupPct));

  $('chart-airport-gap').innerHTML = viz.airportGapChart
    .map((a) => {
      const widthPct = Math.min(100, (Math.max(0, a.avgMarkupPct) / maxMarkup) * 100);
      const capPosPct = Math.min(100, (a.policyCapPct / maxMarkup) * 100);
      return `
        <div class="bar-row">
          <div class="bar-meta">
            <span class="bar-label">${a.label} (${a.region})</span>
            <span class="bar-val ${a.exceedsCap ? 'text-alert' : 'text-ok'}">+${a.avgMarkupPct}% <small>(Cap ${a.policyCapPct}%)</small></span>
          </div>
          <div class="bar-track" title="Black line = ${a.policyCapPct}% street-pricing policy cap">
            <div class="bar-fill ${a.exceedsCap ? 'alert' : 'ok'}" style="width:${widthPct}%"></div>
            <div class="cap-marker" style="left:${capPosPct}%"></div>
          </div>
        </div>
      `;
    })
    .join('');

  const maxVendorMarkup = Math.max(250, ...viz.vendorMarkupChart.map((v) => v.avgMarkupPct));
  $('chart-vendor-markup').innerHTML = viz.vendorMarkupChart
    .map((v) => {
      const widthPct = Math.min(100, (Math.max(0, v.avgMarkupPct) / maxVendorMarkup) * 100);
      return `
        <div class="bar-row">
          <div class="bar-meta">
            <span class="bar-label">${escapeHtml(v.label)} <small>(n=${v.sampleSize})</small></span>
            <span class="bar-val text-alert">+${v.avgMarkupPct}%</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill alert" style="width:${widthPct}%"></div>
          </div>
        </div>
      `;
    })
    .join('');

  const maxCatPrice = Math.max(20, ...viz.categoryMarkupChart.map((c) => c.avgAirportPrice));
  $('chart-category-gap').innerHTML = viz.categoryMarkupChart
    .map((c) => {
      const airW = Math.min(100, (c.avgAirportPrice / maxCatPrice) * 100);
      const strW = Math.min(100, (c.avgStreetPrice / maxCatPrice) * 100);
      return `
        <div class="compare-row">
          <div>
            <div class="bar-label">${escapeHtml(c.label)}</div>
            <div class="bar-val text-alert">+${c.avgMarkupPct}% markup</div>
          </div>
          <div class="compare-bars">
            <div class="mini-bar-wrap">
              <div class="mini-bar" style="width:${airW}%; background:var(--accent-alert)"></div>
              <span>$${c.avgAirportPrice.toFixed(2)} Air</span>
            </div>
            <div class="mini-bar-wrap">
              <div class="mini-bar" style="width:${strW}%; background:var(--accent-navy)"></div>
              <span>$${c.avgStreetPrice.toFixed(2)} St</span>
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  $('chart-pairing-coverage').innerHTML = `
    <div class="coverage-grid">
      ${viz.auditCoverage
        .map(
          (c) => `
        <div class="coverage-card">
          <div class="coverage-code">${c.airportCode}</div>
          <div class="coverage-counts">${c.airportReceipts} airport &bull; ${c.streetReceipts} street</div>
          <span class="badge ${c.paired ? 'badge-ok' : 'badge-warn'}">${c.paired ? 'Paired Baseline' : 'Needs Street Data'}</span>
        </div>
      `
        )
        .join('')}
    </div>
  `;

  // Agent Cards & Transparency Report (Tab 3)
  $('agent2-meta').textContent = `Mode: ${analysis.mode} | Compared ${analysis.summary.totalComparedItems} items`;
  $('agent3-meta').textContent = `Integrity: ${audit.integrityScore}/100 | ${audit.flags.length} audit flag(s)`;

  const report = audit.transparencyReport;
  $('report-title').textContent = report.title;
  $('report-exec-summary').textContent = report.executiveSummary;
  $('report-insights').innerHTML = report.narrativeInsights.map((i) => `<li>${escapeHtml(i)}</li>`).join('');
  $('report-factors').innerHTML = report.emergingFactors.map((f) => `<li>${escapeHtml(f)}</li>`).join('');
  $('report-recommendations').innerHTML = report.policyRecommendations.map((r) => `<li>${escapeHtml(r)}</li>`).join('');
  $('report-methodology').textContent = report.methodology;

  $('audit-flag-count').textContent = `${audit.flags.length} flag(s)`;
  $('audit-flags-list').innerHTML = audit.flags.length
    ? audit.flags
        .map(
          (f) => `
      <div class="flag-item">
        <span class="badge ${f.severity === 'alert' ? 'badge-alert' : f.severity === 'warning' ? 'badge-warn' : 'badge-navy'}">${escapeHtml(f.type)}</span>
        <p style="margin:6px 0 0">${escapeHtml(f.detail)}</p>
      </div>
    `
        )
        .join('')
    : '<p class="section-sub">No anomalies detected.</p>';

  if (state.securityStats) {
    $('security-audit-box').innerHTML = `
      <div><strong>Anonymous Receipts:</strong> ${state.securityStats.anonymousSubmissions ?? state.securityStats.anonymousReceiptsCount} (EXIF/GPS stripped)</div>
      <div><strong>Encrypted Consent Profiles:</strong> ${state.securityStats.totalEncryptedConsentProfiles ?? state.securityStats.encryptedConsentProfiles ?? 0}</div>
      <div><strong>Cipher:</strong> <span class="mono-code">${state.securityStats.encryptionAlgorithm}</span></div>
      <div><strong>KMS Key ID:</strong> <span class="mono-code">${state.securityStats.kmsKeyId}</span></div>
      <div><strong>PII in Public Table:</strong> <span class="badge badge-ok">FALSE (Decoupled)</span></div>
    `;
  }

  renderReceiptsTable();
}

function renderReceiptsTable() {
  const trackFilter = $('filter-track').value;
  const airportFilter = $('filter-airport').value;
  const search = $('filter-search').value.trim().toLowerCase();

  const filtered = state.receipts.filter((r) => {
    if (trackFilter !== 'all' && r.track !== trackFilter) return false;
    if (airportFilter !== 'all' && r.airportCode !== airportFilter) return false;
    if (search) {
      const hay = `${r.merchantName} ${r.vendorAffiliation} ${r.terminalOrLocation} ${r.lineItems.map((i) => i.rawName).join(' ')}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  $('receipts-table-body').innerHTML = filtered
    .map(
      (r) => `
    <tr>
      <td><span class="mono-code">${r.purchaseDate}</span><br><small>${r.purchaseTime || ''}</small></td>
      <td><span class="badge ${r.track === 'airport' ? 'badge-alert' : 'badge-navy'}">${r.track.toUpperCase()}</span></td>
      <td><strong>${r.airportCode}</strong><br><small>${r.region || ''}</small></td>
      <td><strong>${escapeHtml(r.merchantName)}</strong><br><small>${escapeHtml(r.vendorAffiliation)}</small></td>
      <td>${escapeHtml(r.terminalOrLocation)}</td>
      <td>${r.lineItems.map((i) => `${escapeHtml(i.rawName)} (<strong>$${Number(i.unitPrice).toFixed(2)}</strong>)`).join('<br>')}</td>
      <td><span class="mono-code">$${Number(r.total).toFixed(2)}</span></td>
      <td>${r.isAnonymous ? '<span class="badge badge-ok">Anonymous</span>' : '<span class="badge badge-navy">Encrypted Consent</span>'}</td>
    </tr>
  `
    )
    .join('');
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadBootstrap() {
  const res = await fetch('/api/bootstrap');
  const data = await res.json();
  state.metadata = data.metadata;
  state.receipts = data.receipts;
  state.latestAnalysis = data.latestAnalysis;
  state.latestAuditReport = data.latestAuditReport;
  state.agentRuns = data.agentRuns;
  state.securityStats = data.securityStats;

  populateSelects();
  renderLineItems();
  renderDashboard();
}

// Event Listeners
document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

$('hero-submit-airport').addEventListener('click', () => {
  setTrack('airport');
  switchTab('submit');
});

$('hero-submit-street').addEventListener('click', () => {
  setTrack('street');
  switchTab('submit');
});

$('track-airport-btn').addEventListener('click', () => setTrack('airport'));
$('track-street-btn').addEventListener('click', () => setTrack('street'));

document.querySelectorAll('input[name="privacyMode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    const isConsent = $('privacy-consent').checked;
    $('consent-fields-box').classList.toggle('hidden', !isConsent);
  });
});

$('load-sample-airport').addEventListener('click', () => {
  setTrack('airport');
  $('hint-airport').value = 'JFK';
  $('receipt-raw-text').value =
    'HUDSON NEWS #412 JFK TERMINAL 4\nSMARTWATER 20OZ $6.29\nTURKEY CLUB SANDWICH $16.99\nLAYS CHIPS 2.6OZ $4.49\nTAX $2.46';
});

$('load-sample-street').addEventListener('click', () => {
  setTrack('street');
  $('hint-airport').value = 'JFK';
  $('receipt-raw-text').value =
    'QUEENS CORNER BODEGA & MARKET\nSMARTWATER 20OZ $2.19\nTURKEY CLUB SANDWICH $8.99\nLAYS CHIPS 2.6OZ $2.29\nTAX $1.20';
});

$('btn-add-item').addEventListener('click', () => {
  const current = collectLineItems();
  current.push({
    rawName: 'COFFEE LATTE 16OZ',
    standardizedProductKey: 'coffee_16oz_latte',
    quantity: 1,
    unitPrice: state.activeTrack === 'airport' ? 7.25 : 4.95,
  });
  renderLineItems(current);
});

$('std-tax').addEventListener('input', recalcTotals);

$('btn-run-agent1').addEventListener('click', async () => {
  const btn = $('btn-run-agent1');
  const statusEl = $('agent1-status');
  btn.disabled = true;
  btn.textContent = 'Agent 1 Inspecting Receipt...';

  try {
    const formData = new FormData();
    formData.append('rawText', $('receipt-raw-text').value);
    formData.append('track', state.activeTrack);
    formData.append('hintAirport', $('hint-airport').value);
    const fileInput = $('receipt-image-input');
    if (fileInput.files[0]) {
      formData.append('receiptImage', fileInput.files[0]);
    }

    const res = await fetch('/api/agent1/inspect', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Agent 1 failed');

    const ex = data.extracted;
    $('std-merchant').value = ex.merchantName || '';
    if (ex.vendorAffiliation) $('std-vendor').value = ex.vendorAffiliation;
    if (ex.airportCode && state.metadata.airports[ex.airportCode]) $('std-airport').value = ex.airportCode;
    $('std-location').value = ex.terminalOrLocation || '';
    if (ex.purchaseDate) $('std-date').value = ex.purchaseDate;
    if (ex.purchaseTime) $('std-time').value = ex.purchaseTime;
    $('std-tax').value = Number(ex.tax || 0).toFixed(2);
    renderLineItems(ex.lineItems || []);

    $('agent1-meta').textContent = `Last intake: ${data.mode} (${ex.lineItems?.length || 0} items)`;
    statusEl.classList.remove('hidden');
    statusEl.innerHTML = `<strong>Agent 1 (${data.mode}):</strong> ${escapeHtml(ex.aiNotes || 'Form pre-filled.')}<br><small>${escapeHtml(data.privacyCheck.message)}</small>`;
  } catch (err) {
    statusEl.classList.remove('hidden');
    statusEl.textContent = 'Error: ' + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run Agent 1: Inspect & Pre-Fill Standardized Form';
  }
});

$('standardized-receipt-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('btn-submit-receipt');
  const banner = $('submit-result-banner');
  btn.disabled = true;
  btn.textContent = 'Submitting & Running Agent 2 + Agent 3...';

  try {
    const isAnonymous = $('privacy-anon').checked;
    const payload = {
      track: state.activeTrack,
      airportCode: $('std-airport').value,
      terminalOrLocation: $('std-location').value,
      merchantName: $('std-merchant').value,
      vendorAffiliation: $('std-vendor').value,
      purchaseDate: $('std-date').value,
      purchaseTime: $('std-time').value,
      lineItems: collectLineItems(),
      tax: parseFloat($('std-tax').value) || 0,
      total: parseFloat($('std-total').value) || 0,
      isAnonymous,
      consentInfo: isAnonymous
        ? null
        : {
            zipCode: $('consent-zip').value,
            travelFrequency: $('consent-freq').value,
            email: $('consent-email').value,
            policyTestimonyOptIn: $('consent-testimony').checked,
          },
    };

    const res = await fetch('/api/receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Submission failed');

    state.receipts.unshift(data.receipt);
    state.latestAnalysis = data.latestAnalysis;
    state.latestAuditReport = data.latestAuditReport;
    if (data.encryptionStatus?.encrypted && state.securityStats) {
      state.securityStats.totalEncryptedConsentProfiles =
        (state.securityStats.totalEncryptedConsentProfiles || 0) + 1;
    } else if (state.securityStats) {
      state.securityStats.anonymousReceiptsCount =
        (state.securityStats.anonymousReceiptsCount || 0) + 1;
    }

    renderDashboard();

    banner.classList.remove('hidden');
    banner.classList.add('success');
    banner.innerHTML = data.encryptionStatus.encrypted
      ? `<strong>Confirmed &amp; Encrypted!</strong> Receipt ${data.receipt.id} added. Policy consent encrypted via ${data.encryptionStatus.algorithm}. Agent 2 &amp; Agent 3 updated the report and charts.`
      : `<strong>Confirmed Anonymously!</strong> Receipt ${data.receipt.id} (${data.receipt.submissionHash}) added with zero PII. Agent 2 &amp; Agent 3 updated the report and charts.`;
    $('volunteer-confirm-checkbox').checked = false;
  } catch (err) {
    banner.classList.remove('hidden', 'success');
    banner.textContent = 'Submission error: ' + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirm & Submit to Public Database';
  }
});

async function runFullPipeline() {
  const res = await fetch('/api/agents/run-pipeline', { method: 'POST' });
  const data = await res.json();
  if (res.ok) {
    state.latestAnalysis = data.latestAnalysis;
    state.latestAuditReport = data.latestAuditReport;
    state.agentRuns = data.agentRuns;
    renderDashboard();
  }
}

$('btn-refresh-viz').addEventListener('click', runFullPipeline);
$('btn-run-full-pipeline').addEventListener('click', runFullPipeline);
$('filter-track').addEventListener('change', renderReceiptsTable);
$('filter-airport').addEventListener('change', renderReceiptsTable);
$('filter-search').addEventListener('input', renderReceiptsTable);

loadBootstrap();
