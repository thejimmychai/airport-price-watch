const state = {
  metadata: { airports: {}, products: {}, vendors: [], geminiMode: 'local-deterministic-fallback' },
  receipts: [],
  latestAnalysis: null,
  latestAuditReport: null,
  agentRuns: [],
  securityStats: null,
  activeTrack: 'airport',
  intakeMode: 'full', // 'full' | 'quick'
  qsTrack: 'airport',
  qsSelectedKey: 'water_20oz',
  spotlightKey: 'water_20oz',
  receiptPhotoUrl: null,
  annotations: [],
  boxesVisible: true,
};

const SPOTLIGHT_ITEMS = [
  { key: 'water_20oz', shortLabel: 'Bottled Water (20 oz)', unitHint: '20 oz bottle' },
  { key: 'coffee_16oz_latte', shortLabel: 'Hot Coffee / Latte', unitHint: '16 oz cup' },
  { key: 'sandwich_grab_go', shortLabel: 'Grab & Go Sandwich', unitHint: 'Single sandwich' },
  { key: 'beer_16oz_craft', shortLabel: 'Draft / Craft Beer', unitHint: '16 oz pour' },
  { key: 'pain_reliever_travel', shortLabel: 'Travel Pain Relief', unitHint: 'Travel pack' },
  { key: 'chips_snack_bag', shortLabel: 'Bag of Chips / Snack', unitHint: 'Single bag' },
];

const QUICK_SPOT_TILES = [
  { key: 'water_20oz', title: 'Bottled Water', sub: '20 oz bottle', raw: 'BOTTLED WATER 20OZ' },
  { key: 'coffee_16oz_latte', title: 'Coffee / Latte', sub: '16 oz cup', raw: 'COFFEE LATTE 16OZ' },
  { key: 'sandwich_grab_go', title: 'Sandwich / Wrap', sub: 'Grab & go', raw: 'GRAB & GO SANDWICH' },
  { key: 'chips_snack_bag', title: 'Chips / Snack', sub: 'Single bag', raw: 'SNACK CHIPS BAG' },
  { key: 'salad_bowl', title: 'Salad / Bowl', sub: 'Fresh entrée', raw: 'FRESH SALAD BOWL' },
  { key: 'beer_16oz_craft', title: 'Beer / Glass', sub: '16 oz draft', raw: 'CRAFT BEER 16OZ' },
  { key: 'pain_reliever_travel', title: 'Pain Reliever', sub: 'Travel meds', raw: 'TRAVEL PAIN RELIEVER' },
  { key: 'earbuds_wired', title: 'Phone / Audio', sub: 'Cable or buds', raw: 'TRAVEL EARBUDS / CABLE' },
];

const $ = (id) => document.getElementById(id);

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function switchTab(tabName) {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${tabName}`);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setIntakeMode(mode) {
  state.intakeMode = mode;
  $('mode-full-btn').classList.toggle('active', mode === 'full');
  $('mode-quick-btn').classList.toggle('active', mode === 'quick');
  $('full-receipt-container').classList.toggle('hidden', mode !== 'full');
  $('quick-spot-container').classList.toggle('hidden', mode !== 'quick');
}

function setTrack(track) {
  state.activeTrack = track;
  $('track-airport-btn').classList.toggle('active', track === 'airport');
  $('track-street-btn').classList.toggle('active', track === 'street');
  $('form-track-badge').textContent = track === 'airport' ? 'Airport Receipt' : 'Local Store Receipt';
  $('std-location-label').textContent =
    track === 'airport' ? 'Where in the Airport? *' : 'Neighborhood or Street *';
  $('std-location').placeholder =
    track === 'airport'
      ? 'e.g. Terminal 4 — Past Security'
      : 'e.g. Jamaica Ave, Queens, NY';

  const chips = $('location-quick-chips');
  if (chips) {
    chips.classList.toggle('hidden', track !== 'airport');
  }

  if (track === 'street') {
    $('std-vendor').value = 'Local Street Retailer';
  } else if ($('std-vendor').value === 'Local Street Retailer') {
    $('std-vendor').value = 'Unknown / Unconfirmed';
  }

  updatePersonalOverpayCard();
}

function setQuickSpotTrack(track) {
  state.qsTrack = track;
  $('qs-track-airport').classList.toggle('active', track === 'airport');
  $('qs-track-street').classList.toggle('active', track === 'street');
  $('qs-where').value = track === 'airport' ? 'Past Security (At Gates)' : 'Nearby Local Neighborhood';
  updateQuickSpotPreview();
}

function getStreetRefForProduct(productKey, airportCode) {
  const streetPrices = [];
  state.receipts.forEach((r) => {
    if (r.track !== 'street') return;
    if (airportCode && r.airportCode !== airportCode) return;
    (r.lineItems || []).forEach((li) => {
      if (li.standardizedProductKey === productKey && Number(li.unitPrice) > 0) {
        streetPrices.push(Number(li.unitPrice));
      }
    });
  });

  if (!streetPrices.length) {
    state.receipts.forEach((r) => {
      if (r.track !== 'street') return;
      (r.lineItems || []).forEach((li) => {
        if (li.standardizedProductKey === productKey && Number(li.unitPrice) > 0) {
          streetPrices.push(Number(li.unitPrice));
        }
      });
    });
  }

  if (streetPrices.length) {
    return streetPrices.reduce((a, b) => a + b, 0) / streetPrices.length;
  }
  return state.metadata.products?.[productKey]?.streetRefPrice || 2.5;
}

function populateSelects() {
  const airports = state.metadata.airports || {};
  const vendors = state.metadata.vendors || [];

  const airportOptions = Object.entries(airports)
    .map(([code, meta]) => `<option value="${code}">${code} — ${escapeHtml(meta.city)}</option>`)
    .join('');

  $('hint-airport').innerHTML = airportOptions;
  $('std-airport').innerHTML = airportOptions;
  $('qs-airport').innerHTML = airportOptions;
  $('filter-airport').innerHTML = '<option value="all">All Cities</option>' + airportOptions;

  $('std-vendor').innerHTML = vendors
    .map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`)
    .join('');
  if (vendors.includes('Unknown / Unconfirmed')) {
    $('std-vendor').value = 'Unknown / Unconfirmed';
  }

  const now = new Date();
  $('std-date').value = now.toISOString().slice(0, 10);
  $('std-time').value = now.toTimeString().slice(0, 5);

  renderQuickSpotTiles();
}

function renderQuickSpotTiles() {
  const grid = $('qs-item-grid');
  if (!grid) return;
  grid.innerHTML = QUICK_SPOT_TILES.map(
    (tile) => `
      <button type="button" class="spotter-tile ${tile.key === state.qsSelectedKey ? 'active' : ''}" data-key="${tile.key}">
        <strong>${escapeHtml(tile.title)}</strong>
        <small>${escapeHtml(tile.sub)}</small>
      </button>
    `
  ).join('');

  grid.querySelectorAll('.spotter-tile').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.qsSelectedKey = btn.dataset.key;
      renderQuickSpotTiles();
      updateQuickSpotPreview();
    });
  });
}

function updateQuickSpotPreview() {
  const preview = $('qs-live-preview');
  const price = parseFloat($('qs-price').value);
  if (!preview || !price || price <= 0) {
    preview?.classList.add('hidden');
    return;
  }

  const airportCode = $('qs-airport').value || 'JFK';
  const streetAvg = getStreetRefForProduct(state.qsSelectedKey, airportCode);
  const capPct = state.metadata.airports?.[airportCode]?.policyCapPct || 15;
  const fairLimit = streetAvg * (1 + capPct / 100);
  const tile = QUICK_SPOT_TILES.find((t) => t.key === state.qsSelectedKey) || QUICK_SPOT_TILES[0];

  preview.classList.remove('hidden');
  if (state.qsTrack === 'street') {
    preview.innerHTML = `
      <div class="scorecard-title">Neighborhood Price Anchor</div>
      <div class="scorecard-headline">$${price.toFixed(2)} local store price for ${escapeHtml(tile.title)}</div>
      <p class="scorecard-sub">Thank you! Local store prices like yours give ${airportCode} travelers an honest neighborhood baseline.</p>
    `;
    return;
  }

  const diff = price - streetAvg;
  const pct = ((diff / streetAvg) * 100).toFixed(0);
  const overRule = price > fairLimit;

  preview.innerHTML = `
    <div class="scorecard-title">Instant Shelf Price Check (${airportCode})</div>
    <div class="scorecard-headline ${overRule ? 'text-overcharge' : 'text-fair'}">
      $${price.toFixed(2)} at ${airportCode} vs. ~$${streetAvg.toFixed(2)} in town (${diff >= 0 ? '+' : ''}${pct}%)
    </div>
    <p class="scorecard-sub">
      ${
        overRule
          ? `Exceeds ${airportCode}'s +${capPct}% fair-pricing promise ($${fairLimit.toFixed(2)} max) by <strong>$${(price - fairLimit).toFixed(2)}</strong>.`
          : `Stays within ${airportCode}'s +${capPct}% fair-pricing promise ($${fairLimit.toFixed(2)} max).`
      }
    </p>
  `;
}

function highlightOcrBox(annId) {
  const layer = $('ocr-overlay-layer');
  if (!layer) return;
  layer.querySelectorAll('.ocr-box').forEach((box) => {
    box.classList.toggle('active', box.dataset.annId === annId);
  });
}

function pulseAndFocusField(containerEl, inputEl) {
  if (!containerEl) return;
  containerEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  containerEl.classList.remove('field-spotlight-pulse');
  void containerEl.offsetWidth;
  containerEl.classList.add('field-spotlight-pulse');
  if (inputEl) {
    setTimeout(() => {
      inputEl.focus({ preventScroll: true });
      if (typeof inputEl.select === 'function' && inputEl.type === 'text') {
        inputEl.select();
      }
    }, 260);
  }
}

function scrollToFieldForAnnotation(ann) {
  highlightOcrBox(ann.id);
  if (ann.targetField === 'merchant') {
    const inp = $('std-merchant');
    pulseAndFocusField(inp?.closest('.form-group') || inp, inp);
  } else if (ann.targetField === 'location') {
    const inp = $('std-location');
    pulseAndFocusField(inp?.closest('.form-group') || inp, inp);
  } else if (ann.targetField === 'item') {
    const card = document.querySelector(`.line-item-card[data-item-index="${ann.itemIndex}"]`)
      || document.querySelectorAll('.line-item-card')[ann.itemIndex];
    const inp = card?.querySelector('.li-raw');
    pulseAndFocusField(card, inp);
  } else if (ann.targetField === 'tax') {
    const inp = $('std-tax');
    pulseAndFocusField(inp?.closest('.form-group') || inp, inp);
  }
}

function showUploadPhotoPreview(file) {
  const previewBox = $('upload-photo-preview');
  const previewImg = $('upload-preview-img');
  const previewMeta = $('upload-preview-meta');
  const annotatedBox = $('annotated-receipt-box');

  if (state.receiptPhotoUrl && state.receiptPhotoUrl.startsWith('blob:')) {
    URL.revokeObjectURL(state.receiptPhotoUrl);
  }
  state.receiptPhotoUrl = null;
  state.annotations = [];

  if (!file) {
    previewBox?.classList.add('hidden');
    annotatedBox?.classList.add('hidden');
    if (previewImg) previewImg.removeAttribute('src');
    return;
  }

  const url = URL.createObjectURL(file);
  state.receiptPhotoUrl = url;
  if (previewImg) {
    previewImg.onload = () => {
      if (previewMeta) {
        previewMeta.textContent = `${file.name} • ${previewImg.naturalWidth}×${previewImg.naturalHeight} px`;
      }
    };
    previewImg.src = url;
  }
  if (previewMeta) {
    previewMeta.textContent = `${file.name} • ${Math.max(1, Math.round(file.size / 1024))} KB`;
  }
  previewBox?.classList.remove('hidden');
  annotatedBox?.classList.add('hidden');
}

function renderAnnotatedReceipt(annotations = []) {
  const annotatedBox = $('annotated-receipt-box');
  const annotatedImg = $('annotated-receipt-img');
  const layer = $('ocr-overlay-layer');
  const sub = $('annotated-receipt-sub');
  if (!annotatedBox || !annotatedImg || !layer) return;

  if (!state.receiptPhotoUrl) {
    annotatedBox.classList.add('hidden');
    layer.innerHTML = '';
    return;
  }

  state.annotations = annotations;
  annotatedImg.src = state.receiptPhotoUrl;
  annotatedBox.classList.remove('hidden');
  layer.innerHTML = '';
  layer.classList.toggle('boxes-hidden', !state.boxesVisible);

  if (!annotations.length) {
    if (sub) {
      sub.textContent = 'Receipt photo attached above for visual side-by-side comparison.';
    }
    return;
  }

  if (sub) {
    sub.textContent = `Detected ${annotations.length} region(s) on your receipt — click any labeled box to jump directly to its field below.`;
  }

  annotations.forEach((ann) => {
    if (!ann.bbox) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `ocr-box ocr-kind-${escapeHtml(ann.kind || 'item')}`;
    btn.dataset.annId = ann.id;
    btn.title = `Jump to ${ann.label || ann.shortBadge}`;
    btn.style.left = `${ann.bbox.leftPct}%`;
    btn.style.top = `${ann.bbox.topPct}%`;
    btn.style.width = `${ann.bbox.widthPct}%`;
    btn.style.height = `${ann.bbox.heightPct}%`;
    btn.innerHTML = `<span class="ocr-badge">${escapeHtml(ann.shortBadge)}</span>`;
    btn.addEventListener('click', () => scrollToFieldForAnnotation(ann));
    layer.appendChild(btn);
  });
}

function synthesizeSampleReceiptFile(kind = 'airport') {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 780;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#fcfaf4';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#e2dccf';
    ctx.lineWidth = 2;
    ctx.strokeRect(14, 14, canvas.width - 28, canvas.height - 28);

    const lines =
      kind === 'airport'
        ? [
            { text: 'HUDSON NEWS #412', y: 92, align: 'center', bold: true, size: 28 },
            { text: 'JFK INTL AIRPORT - TERMINAL 4', y: 134, align: 'center', size: 21 },
            { text: 'GATE B24 POST-SECURITY', y: 168, align: 'center', size: 20 },
            { text: '------------------------------------', y: 210, align: 'center', size: 20 },
            { text: '2026-05-14 14:22   REG #04', y: 248, align: 'left', size: 19 },
            { text: '------------------------------------', y: 284, align: 'center', size: 20 },
            { text: 'SMARTWATER 20OZ               $6.29', y: 334, align: 'left', bold: true, size: 21 },
            { text: 'TURKEY CLUB SANDWICH         $16.99', y: 382, align: 'left', bold: true, size: 21 },
            { text: 'LAYS CHIPS 2.6OZ              $4.49', y: 430, align: 'left', bold: true, size: 21 },
            { text: '------------------------------------', y: 478, align: 'center', size: 20 },
            { text: 'SUBTOTAL                     $27.77', y: 522, align: 'left', size: 20 },
            { text: 'SALES TAX                     $2.46', y: 566, align: 'left', size: 20 },
            { text: 'TOTAL                        $30.23', y: 620, align: 'left', bold: true, size: 24 },
            { text: 'THANK YOU FOR FLYING JFK', y: 696, align: 'center', size: 18 },
          ]
        : [
            { text: 'QUEENS CORNER MARKET', y: 92, align: 'center', bold: true, size: 27 },
            { text: '144-12 JAMAICA AVE QUEENS NY', y: 134, align: 'center', size: 20 },
            { text: '------------------------------------', y: 186, align: 'center', size: 20 },
            { text: '2026-05-14 12:15   CASHIER #2', y: 226, align: 'left', size: 19 },
            { text: '------------------------------------', y: 266, align: 'center', size: 20 },
            { text: 'SMARTWATER 20OZ               $2.19', y: 320, align: 'left', bold: true, size: 21 },
            { text: 'TURKEY CLUB SANDWICH          $8.99', y: 368, align: 'left', bold: true, size: 21 },
            { text: 'LAYS CHIPS 2.6OZ              $2.29', y: 416, align: 'left', bold: true, size: 21 },
            { text: '------------------------------------', y: 468, align: 'center', size: 20 },
            { text: 'SUBTOTAL                     $13.47', y: 512, align: 'left', size: 20 },
            { text: 'SALES TAX                     $1.20', y: 556, align: 'left', size: 20 },
            { text: 'TOTAL                        $14.67', y: 610, align: 'left', bold: true, size: 24 },
            { text: 'THANK YOU NEIGHBOR!', y: 690, align: 'center', size: 18 },
          ];

    ctx.fillStyle = '#1d262d';
    lines.forEach((ln) => {
      ctx.font = `${ln.bold ? '700' : '500'} ${ln.size}px "Courier New", Courier, monospace`;
      if (ln.align === 'center') {
        ctx.textAlign = 'center';
        ctx.fillText(ln.text, canvas.width / 2, ln.y);
      } else {
        ctx.textAlign = 'left';
        ctx.fillText(ln.text, 56, ln.y);
      }
    });

    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(null);
        return;
      }
      const fname = kind === 'airport' ? 'sample_jfk_hudson_receipt.png' : 'sample_queens_local_receipt.png';
      const file = new File([blob], fname, { type: 'image/png' });
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        const input = $('receipt-image-input');
        if (input) input.files = dt.files;
      } catch (_) {
        // Ignore if DataTransfer assignment is restricted in older browsers
      }
      showUploadPhotoPreview(file);
      resolve(file);
    }, 'image/png');
  });
}

function reindexLineItemCards() {
  document.querySelectorAll('.line-item-card').forEach((card, idx) => {
    card.dataset.itemIndex = String(idx);
    const badge = card.querySelector('.line-item-num-tag');
    if (badge) badge.textContent = `Item #${idx + 1}`;
  });
}

function renderLineItems(items = []) {
  const container = $('line-items-container');
  const products = state.metadata.products || {};
  const productOpts = Object.entries(products)
    .map(([key, p]) => `<option value="${key}">${escapeHtml(p.label)}</option>`)
    .join('');

  if (!items.length) {
    items = [
      {
        rawName: 'BOTTLED WATER 20OZ',
        standardizedProductKey: 'water_20oz',
        quantity: 1,
        unitPrice: 5.99,
      },
    ];
  }

  container.innerHTML = '';
  items.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'line-item-card';
    card.dataset.itemIndex = String(idx);
    card.innerHTML = `
      <div class="line-item-num-tag">Item #${idx + 1}</div>
      <div class="line-item-grid">
        <div>
          <label>Item on Receipt</label>
          <input type="text" class="li-raw" value="${escapeHtml(item.rawName || '')}" required />
        </div>
        <div>
          <label>Everyday Category</label>
          <select class="li-key">${productOpts}</select>
        </div>
        <div>
          <label>Qty</label>
          <input type="number" class="li-qty" min="1" value="${item.quantity || 1}" required />
        </div>
        <div>
          <label>Each ($)</label>
          <input type="number" class="li-price" step="0.01" min="0" value="${Number(item.unitPrice || 0).toFixed(2)}" required />
        </div>
        <div>
          <button type="button" class="btn btn-outline btn-xs li-remove" title="Remove item">&times;</button>
        </div>
      </div>
    `;
    const keySelect = card.querySelector('.li-key');
    if (item.standardizedProductKey && products[item.standardizedProductKey]) {
      keySelect.value = item.standardizedProductKey;
    } else {
      keySelect.value = 'water_20oz';
    }

    card.addEventListener('focusin', () => {
      highlightOcrBox(`ann_item_${card.dataset.itemIndex}`);
    });

    card.querySelector('.li-remove').addEventListener('click', () => {
      if (container.children.length > 1) {
        card.remove();
        reindexLineItemCards();
        recalcTotals();
      }
    });
    keySelect.addEventListener('change', updatePersonalOverpayCard);
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
  updatePersonalOverpayCard();
}

function updatePersonalOverpayCard() {
  const headline = $('scorecard-headline');
  const sub = $('scorecard-sub');
  if (!headline || !sub) return;

  const airportCode = $('std-airport')?.value || 'JFK';
  const cards = document.querySelectorAll('.line-item-card');
  let paidSubtotal = 0;
  let streetSubtotal = 0;
  let itemCount = 0;

  cards.forEach((card) => {
    const key = card.querySelector('.li-key')?.value || 'water_20oz';
    const qty = parseFloat(card.querySelector('.li-qty')?.value) || 0;
    const price = parseFloat(card.querySelector('.li-price')?.value) || 0;
    if (qty > 0 && price > 0) {
      paidSubtotal += qty * price;
      streetSubtotal += qty * getStreetRefForProduct(key, airportCode);
      itemCount += qty;
    }
  });

  if (itemCount === 0 || paidSubtotal <= 0) {
    headline.className = 'scorecard-headline';
    headline.textContent = 'Add items above to compare against neighborhood prices';
    sub.textContent = '';
    return;
  }

  const cityLabel = state.metadata.airports?.[airportCode]?.city || airportCode;
  const capPct = state.metadata.airports?.[airportCode]?.policyCapPct || 15;

  if (state.activeTrack === 'street') {
    headline.className = 'scorecard-headline text-fair';
    headline.textContent = `$${paidSubtotal.toFixed(2)} for ${itemCount} item${itemCount > 1 ? 's' : ''} in ${cityLabel}`;
    sub.textContent = `Your local store receipt sets the real-world neighborhood baseline used to hold ${airportCode} shops accountable.`;
    return;
  }

  const extraDollars = paidSubtotal - streetSubtotal;
  const markupPct = streetSubtotal > 0 ? Math.round((extraDollars / streetSubtotal) * 100) : 0;
  const fairCapTotal = streetSubtotal * (1 + capPct / 100);
  const brokeCap = paidSubtotal > fairCapTotal;

  headline.className = `scorecard-headline ${brokeCap ? 'text-overcharge' : 'text-fair'}`;
  if (extraDollars > 0.05) {
    headline.textContent = `$${paidSubtotal.toFixed(2)} at ${airportCode} vs. ~$${streetSubtotal.toFixed(2)} in town (+$${extraDollars.toFixed(2)} airport markup)`;
  } else {
    headline.textContent = `$${paidSubtotal.toFixed(2)} at ${airportCode} — right in line with ~$${streetSubtotal.toFixed(2)} local prices`;
  }

  sub.textContent = brokeCap
    ? `That is +${markupPct}% above nearby stores — exceeding ${airportCode}'s +${capPct}% fair-pricing limit ($${fairCapTotal.toFixed(2)} max before tax).`
    : `Within ${airportCode}'s +${capPct}% fair-pricing promise ($${fairCapTotal.toFixed(2)} max before tax).`;
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

function renderBounties(auditCoverage = []) {
  const listEl = $('bounty-list');
  if (!listEl) return;

  const prioritized = [...auditCoverage]
    .map((c) => {
      const city = state.metadata.airports?.[c.airportCode]?.city || c.airportCode;
      let needText = '';
      let targetTrack = 'airport';
      let priority = 3;
      if (c.streetReceipts === 0) {
        needText = 'Needs 1st local store receipt';
        targetTrack = 'street';
        priority = 1;
      } else if (c.airportReceipts < 2) {
        needText = 'Needs more terminal receipts';
        targetTrack = 'airport';
        priority = 2;
      } else {
        needText = `${c.airportReceipts} airport • ${c.streetReceipts} local — add fresh check`;
        targetTrack = 'airport';
        priority = 3;
      }
      return { ...c, city, needText, targetTrack, priority };
    })
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 4);

  listEl.innerHTML = prioritized
    .map(
      (b) => `
      <div class="bounty-item" data-airport="${b.airportCode}" data-track="${b.targetTrack}" role="button" tabindex="0">
        <div>
          <div class="bounty-city">${b.airportCode} &mdash; ${escapeHtml(b.city)}</div>
          <div class="bounty-need">${escapeHtml(b.needText)}</div>
        </div>
        <span class="badge ${b.priority === 1 ? 'badge-caution' : 'badge-primary'}">+ Add</span>
      </div>
    `
    )
    .join('');

  listEl.querySelectorAll('.bounty-item').forEach((row) => {
    const activate = () => {
      const code = row.dataset.airport;
      const trk = row.dataset.track;
      setTrack(trk);
      setQuickSpotTrack(trk);
      if ($('hint-airport')) $('hint-airport').value = code;
      if ($('std-airport')) $('std-airport').value = code;
      if ($('qs-airport')) $('qs-airport').value = code;
      updatePersonalOverpayCard();
      switchTab('submit');
    };
    row.addEventListener('click', activate);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    });
  });
}

function renderSpotlight() {
  const pillsEl = $('spotlight-pills');
  const cardsEl = $('spotlight-cards');
  if (!pillsEl || !cardsEl) return;

  pillsEl.innerHTML = SPOTLIGHT_ITEMS.map(
    (item) => `
      <button type="button" class="item-pill ${item.key === state.spotlightKey ? 'active' : ''}" data-key="${item.key}">
        ${escapeHtml(item.shortLabel)}
      </button>
    `
  ).join('');

  pillsEl.querySelectorAll('.item-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.spotlightKey = btn.dataset.key;
      renderSpotlight();
    });
  });

  const activeItem = SPOTLIGHT_ITEMS.find((i) => i.key === state.spotlightKey) || SPOTLIGHT_ITEMS[0];
  const airPrices = [];
  const strPrices = [];

  state.receipts.forEach((r) => {
    (r.lineItems || []).forEach((li) => {
      if (li.standardizedProductKey === activeItem.key && Number(li.unitPrice) > 0) {
        if (r.track === 'airport') airPrices.push(Number(li.unitPrice));
        else strPrices.push(Number(li.unitPrice));
      }
    });
  });

  const fallbackRef = state.metadata.products?.[activeItem.key]?.streetRefPrice || 2.49;
  const streetAvg = strPrices.length ? strPrices.reduce((a, b) => a + b, 0) / strPrices.length : fallbackRef;
  const airportAvg = airPrices.length
    ? airPrices.reduce((a, b) => a + b, 0) / airPrices.length
    : streetAvg * 2.15;
  const fairLimit = streetAvg * 1.15;
  const extraDollars = airportAvg - streetAvg;
  const markupPct = Math.round((extraDollars / streetAvg) * 100);

  cardsEl.innerHTML = `
    <div class="price-stage-card">
      <div>
        <div class="stage-tag">1. Nearby Neighborhood Store</div>
        <div class="stage-price">$${streetAvg.toFixed(2)}</div>
      </div>
      <p class="stage-note">Typical price for ${escapeHtml(activeItem.shortLabel.toLowerCase())} at grocery stores, pharmacies, and corner markets outside the airport.</p>
    </div>

    <div class="price-stage-card highlight-fair">
      <div>
        <div class="stage-tag">2. Airport Fair-Pricing Limit (+15%)</div>
        <div class="stage-price text-fair">$${fairLimit.toFixed(2)}</div>
      </div>
      <p class="stage-note">The ceiling most U.S. airports promise travelers under &ldquo;street pricing plus 10&ndash;15%&rdquo; lease rules.</p>
    </div>

    <div class="price-stage-card highlight-overcharge">
      <div>
        <div class="stage-tag">3. Actual Terminal Price We Found</div>
        <div class="stage-price text-overcharge">$${airportAvg.toFixed(2)}</div>
      </div>
      <p class="stage-note"><strong>+$${extraDollars.toFixed(2)} extra (+${markupPct}%)</strong> over nearby stores across ${airPrices.length || 1} shared airport receipt${airPrices.length === 1 ? '' : 's'}.</p>
    </div>
  `;
}

function renderDashboard() {
  const analysis = state.latestAnalysis;
  const audit = state.latestAuditReport;
  if (!analysis || !audit) return;

  // Headline plain-language stats
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

  const viz = audit.visualizationPanel;
  renderBounties(viz.auditCoverage || []);
  renderSpotlight();

  // Chart 1: Airport Markup vs Fair Rule
  const maxMarkup = Math.max(220, ...viz.airportGapChart.map((a) => a.avgMarkupPct));
  $('chart-airport-gap').innerHTML = viz.airportGapChart
    .map((a) => {
      const widthPct = Math.min(100, (Math.max(0, a.avgMarkupPct) / maxMarkup) * 100);
      const capPosPct = Math.min(100, (a.policyCapPct / maxMarkup) * 100);
      const city = state.metadata.airports?.[a.airportCode]?.city || a.region;
      return `
        <div class="bar-row">
          <div class="bar-meta">
            <span class="bar-name">${escapeHtml(a.airportCode)} &mdash; ${escapeHtml(city)}</span>
            <span class="bar-figure ${a.exceedsCap ? 'text-overcharge' : 'text-fair'}">+${a.avgMarkupPct}% <small style="font-weight:400; color:var(--ink-muted);">(Rule: +${a.policyCapPct}%)</small></span>
          </div>
          <div class="bar-track" title="Dark vertical line marks ${a.airportCode}'s +${a.policyCapPct}% fair-pricing promise">
            <div class="bar-fill ${a.exceedsCap ? 'overcharge' : 'fair'}" style="width:${widthPct}%"></div>
            <div class="fair-rule-line" style="left:${capPosPct}%"></div>
          </div>
        </div>
      `;
    })
    .join('');

  // Chart 2: Store Operator Markups
  const maxVendorMarkup = Math.max(220, ...viz.vendorMarkupChart.map((v) => v.avgMarkupPct));
  $('chart-vendor-markup').innerHTML = viz.vendorMarkupChart
    .map((v) => {
      const widthPct = Math.min(100, (Math.max(0, v.avgMarkupPct) / maxVendorMarkup) * 100);
      return `
        <div class="bar-row">
          <div class="bar-meta">
            <span class="bar-name">${escapeHtml(v.label)} <small style="font-weight:400; color:var(--ink-muted);">(${v.sampleSize} items)</small></span>
            <span class="bar-figure text-overcharge">+${v.avgMarkupPct}%</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill overcharge" style="width:${widthPct}%"></div>
          </div>
        </div>
      `;
    })
    .join('');

  // Chart 3: Average Price by Item Type (Dollars side by side)
  const maxCatPrice = Math.max(18, ...viz.categoryMarkupChart.map((c) => c.avgAirportPrice));
  $('chart-category-gap').innerHTML = viz.categoryMarkupChart
    .map((c) => {
      const airW = Math.min(100, (c.avgAirportPrice / maxCatPrice) * 100);
      const strW = Math.min(100, (c.avgStreetPrice / maxCatPrice) * 100);
      return `
        <div class="bar-row" style="padding-bottom:8px; border-bottom:1px solid var(--bg-subtle);">
          <div class="bar-meta">
            <span class="bar-name">${escapeHtml(c.label)}</span>
            <span class="bar-figure text-overcharge">$${c.avgAirportPrice.toFixed(2)} airport vs. $${c.avgStreetPrice.toFixed(2)} local (+${c.avgMarkupPct}%)</span>
          </div>
          <div class="bar-track" style="height:9px; margin-bottom:4px;">
            <div class="bar-fill overcharge" style="width:${airW}%"></div>
          </div>
          <div class="bar-track" style="height:9px;">
            <div class="bar-fill primary" style="width:${strW}%"></div>
          </div>
        </div>
      `;
    })
    .join('');

  // Chart 4: City-by-City Coverage Cards
  $('chart-pairing-coverage').innerHTML = `
    <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(210px, 1fr)); gap:10px;">
      ${viz.auditCoverage
        .map((c) => {
          const city = state.metadata.airports?.[c.airportCode]?.city || '';
          return `
            <div style="padding:12px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg);">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <strong>${escapeHtml(c.airportCode)}</strong>
                <span class="badge ${c.paired ? 'badge-fair' : 'badge-caution'}">${c.paired ? 'Matched' : 'Needs Local Store'}</span>
              </div>
              <div style="font-size:12px; color:var(--ink-secondary); margin-bottom:4px;">${escapeHtml(city)}</div>
              <div style="font-size:12.5px; font-family:var(--font-mono);">${c.airportReceipts} airport &bull; ${c.streetReceipts} local</div>
            </div>
          `;
        })
        .join('')}
    </div>
  `;

  // Tab 3: Open Data & How We Check
  $('agent2-meta').textContent = `Checked ${analysis.summary.totalComparedItems} items across ${viz.airportGapChart.length} airports`;
  $('agent3-meta').textContent = `Confidence ${audit.integrityScore}/100 • ${audit.flags.length} quality note(s)`;

  const report = audit.transparencyReport;
  $('report-title').textContent = report.title;
  $('report-exec-summary').textContent = report.executiveSummary;
  $('report-insights').innerHTML = report.narrativeInsights.map((i) => `<li>${escapeHtml(i)}</li>`).join('');
  $('report-factors').innerHTML = report.emergingFactors.map((f) => `<li>${escapeHtml(f)}</li>`).join('');
  $('report-recommendations').innerHTML = report.policyRecommendations.map((r) => `<li>${escapeHtml(r)}</li>`).join('');
  $('report-methodology').textContent = report.methodology;

  $('audit-flag-count').textContent = `${audit.flags.length} note${audit.flags.length === 1 ? '' : 's'}`;
  $('audit-flags-list').innerHTML = audit.flags.length
    ? audit.flags
        .map(
          (f) => `
        <div style="padding:10px 12px; border:1px solid var(--border); border-radius:8px; background:var(--bg);">
          <span class="badge ${f.severity === 'alert' ? 'badge-overcharge' : f.severity === 'warning' ? 'badge-caution' : 'badge-primary'}">${escapeHtml(f.type.replace(/_/g, ' '))}</span>
          <p style="margin:6px 0 0; font-size:13px; color:var(--ink-secondary);">${escapeHtml(f.detail)}</p>
        </div>
      `
        )
        .join('')
    : '<p style="margin:0; font-size:13.5px; color:var(--ink-secondary);">All shared receipts passed duplicate and price-range checks.</p>';

  if (state.securityStats) {
    const anonCount = state.securityStats.anonymousSubmissions ?? state.securityStats.anonymousReceiptsCount ?? 0;
    const encCount = state.securityStats.totalEncryptedConsentProfiles ?? state.securityStats.encryptedConsentProfiles ?? 0;
    $('security-audit-box').innerHTML = `
      <div><strong>100% Anonymous Receipts:</strong> ${anonCount} (camera GPS &amp; EXIF stripped)</div>
      <div><strong>Locked Volunteer Follow-Up Profiles:</strong> ${encCount}</div>
      <div><strong>Personal Info in Public Table:</strong> <span class="badge badge-fair">None (0%)</span></div>
      <div style="font-size:12px; color:var(--ink-muted);">Optional volunteer contact details are locked separately with ${escapeHtml(state.securityStats.encryptionAlgorithm || 'AES-256-GCM')}.</div>
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
      const hay = `${r.merchantName} ${r.vendorAffiliation} ${r.terminalOrLocation} ${(r.lineItems || []).map((i) => i.rawName).join(' ')}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  $('receipts-table-body').innerHTML = filtered
    .map(
      (r) => `
      <tr>
        <td><span class="mono">${escapeHtml(r.purchaseDate)}</span><br><small style="color:var(--ink-muted);">${escapeHtml(r.purchaseTime || '')}</small></td>
        <td><span class="badge ${r.track === 'airport' ? 'badge-overcharge' : 'badge-primary'}">${r.track === 'airport' ? 'Airport' : 'Local Store'}</span></td>
        <td><strong>${escapeHtml(r.airportCode)}</strong><br><small style="color:var(--ink-muted);">${escapeHtml(state.metadata.airports?.[r.airportCode]?.city || r.region || '')}</small></td>
        <td><strong>${escapeHtml(r.merchantName)}</strong><br><small style="color:var(--ink-secondary);">${escapeHtml(r.vendorAffiliation)}</small></td>
        <td>${escapeHtml(r.terminalOrLocation)}</td>
        <td>${(r.lineItems || []).map((i) => `${escapeHtml(i.rawName)} (<strong>$${Number(i.unitPrice).toFixed(2)}</strong>)`).join('<br>')}</td>
        <td><span class="mono">$${Number(r.total).toFixed(2)}</span></td>
        <td>${r.isAnonymous ? '<span class="badge badge-fair">Anonymous</span>' : '<span class="badge badge-primary">Locked Vault</span>'}</td>
      </tr>
    `
    )
    .join('');
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

// Navigation & Mode Listeners
$('brand-home-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  switchTab('monitor');
});

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

$('hero-submit-airport')?.addEventListener('click', () => {
  setTrack('airport');
  setQuickSpotTrack('airport');
  switchTab('submit');
});

$('hero-submit-street')?.addEventListener('click', () => {
  setTrack('street');
  setQuickSpotTrack('street');
  switchTab('submit');
});

$('mode-full-btn')?.addEventListener('click', () => setIntakeMode('full'));
$('mode-quick-btn')?.addEventListener('click', () => setIntakeMode('quick'));

$('track-airport-btn')?.addEventListener('click', () => setTrack('airport'));
$('track-street-btn')?.addEventListener('click', () => setTrack('street'));

$('qs-track-airport')?.addEventListener('click', () => setQuickSpotTrack('airport'));
$('qs-track-street')?.addEventListener('click', () => setQuickSpotTrack('street'));
$('qs-price')?.addEventListener('input', updateQuickSpotPreview);
$('qs-airport')?.addEventListener('change', updateQuickSpotPreview);
$('std-airport')?.addEventListener('change', updatePersonalOverpayCard);

// One-tap location quick chips
document.querySelectorAll('#location-quick-chips .quick-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#location-quick-chips .quick-chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    $('std-location').value = chip.dataset.loc;
  });
});

document.querySelectorAll('input[name="privacyMode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    const isConsent = $('privacy-consent').checked;
    $('consent-fields-box').classList.toggle('hidden', !isConsent);
  });
});

$('receipt-image-input')?.addEventListener('change', (e) => {
  const file = e.target.files?.[0] || null;
  if (file && $('receipt-raw-text')) {
    $('receipt-raw-text').value = '';
  }
  showUploadPhotoPreview(file);
});

$('btn-clear-photo')?.addEventListener('click', () => {
  const input = $('receipt-image-input');
  if (input) input.value = '';
  showUploadPhotoPreview(null);
});

$('btn-toggle-boxes')?.addEventListener('click', () => {
  state.boxesVisible = !state.boxesVisible;
  $('ocr-overlay-layer')?.classList.toggle('boxes-hidden', !state.boxesVisible);
  $('btn-toggle-boxes').textContent = state.boxesVisible ? 'Hide Boxes' : 'Show Boxes';
});

$('std-merchant')?.addEventListener('focus', () => highlightOcrBox('ann_merchant'));
$('std-location')?.addEventListener('focus', () => highlightOcrBox('ann_location'));
$('std-tax')?.addEventListener('focus', () => highlightOcrBox('ann_tax'));

$('load-sample-airport')?.addEventListener('click', async () => {
  setTrack('airport');
  $('hint-airport').value = 'JFK';
  $('receipt-raw-text').value =
    'HUDSON NEWS #412\nJFK INTL AIRPORT - TERMINAL 4\nGATE B24 POST-SECURITY\nSMARTWATER 20OZ $6.29\nTURKEY CLUB SANDWICH $16.99\nLAYS CHIPS 2.6OZ $4.49\nSALES TAX $2.46';
  await synthesizeSampleReceiptFile('airport');
});

$('load-sample-street')?.addEventListener('click', async () => {
  setTrack('street');
  $('hint-airport').value = 'JFK';
  $('receipt-raw-text').value =
    'QUEENS CORNER MARKET\n144-12 JAMAICA AVE QUEENS NY\nSMARTWATER 20OZ $2.19\nTURKEY CLUB SANDWICH $8.99\nLAYS CHIPS 2.6OZ $2.29\nSALES TAX $1.20';
  await synthesizeSampleReceiptFile('street');
});

$('btn-add-item')?.addEventListener('click', () => {
  const current = collectLineItems();
  current.push({
    rawName: 'COFFEE LATTE 16OZ',
    standardizedProductKey: 'coffee_16oz_latte',
    quantity: 1,
    unitPrice: state.activeTrack === 'airport' ? 7.25 : 4.95,
  });
  renderLineItems(current);
});

$('std-tax')?.addEventListener('input', recalcTotals);

// Receipt Reader (Agent 1)
$('btn-run-agent1')?.addEventListener('click', async () => {
  const btn = $('btn-run-agent1');
  const statusEl = $('agent1-status');
  btn.disabled = true;
  btn.textContent = 'Reading Receipt Items...';

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
    if (!res.ok) throw new Error(data.error || 'Could not read receipt');

    const ex = data.extracted;
    $('std-merchant').value = ex.merchantName || '';
    const suggestedChain = ex.potentialChainAffiliation || ex.vendorAffiliation || 'Unknown / Unconfirmed';
    $('std-vendor').value = suggestedChain;

    const affBox = $('affiliation-hint-box');
    if (affBox) {
      affBox.classList.remove('hidden');
      affBox.innerHTML = `<strong>Optional Parent Company Guess:</strong> Looks like <strong>${escapeHtml(suggestedChain)}</strong>. ${escapeHtml(ex.affiliationReason || 'Feel free to leave as Unknown if you are not sure.')}`;
    }

    if (ex.airportCode && state.metadata.airports[ex.airportCode]) {
      $('std-airport').value = ex.airportCode;
    }
    $('std-location').value = ex.terminalOrLocation || '';
    if (ex.purchaseDate) $('std-date').value = ex.purchaseDate;
    if (ex.purchaseTime) $('std-time').value = ex.purchaseTime;
    $('std-tax').value = Number(ex.tax || 0).toFixed(2);
    renderLineItems(ex.lineItems || []);
    renderAnnotatedReceipt(ex.annotations || []);

    if ($('agent1-meta')) {
      $('agent1-meta').textContent = `Last scan: ${ex.lineItems?.length || 0} item(s) pre-filled`;
    }
    statusEl.classList.remove('hidden');
    statusEl.classList.add('success');
    const boxNote = (ex.annotations && ex.annotations.length)
      ? ' Click any labeled box on your receipt photo on the right to jump straight to that field.'
      : ' Please glance over the right-hand form to make sure prices match your receipt.';
    statusEl.innerHTML = `<strong>Pre-filled ${ex.lineItems?.length || 0} item(s)!</strong>${boxNote}`;
  } catch (err) {
    statusEl.classList.remove('hidden', 'success');
    statusEl.textContent = 'Could not read receipt: ' + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Scan Receipt & Pre-Fill All Items';
  }
});

// 10-Second Quick Price Spotter Submit
$('quick-spot-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('qs-submit-btn');
  const feedback = $('qs-feedback');
  btn.disabled = true;
  btn.textContent = 'Adding Price Spot...';

  try {
    const tile = QUICK_SPOT_TILES.find((t) => t.key === state.qsSelectedKey) || QUICK_SPOT_TILES[0];
    const prod = state.metadata.products?.[state.qsSelectedKey] || { category: 'Bottled Water & Beverages' };
    const price = parseFloat($('qs-price').value) || 0;
    const now = new Date();

    const payload = {
      track: state.qsTrack,
      airportCode: $('qs-airport').value,
      terminalOrLocation: $('qs-where').value.trim() || 'Past Security',
      merchantName: $('qs-store').value.trim(),
      vendorAffiliation: state.qsTrack === 'street' ? 'Local Street Retailer' : 'Unknown / Unconfirmed',
      purchaseDate: now.toISOString().slice(0, 10),
      purchaseTime: now.toTimeString().slice(0, 5),
      aiIntakeMode: 'quick-spot',
      lineItems: [
        {
          rawName: tile.raw,
          standardizedProductKey: state.qsSelectedKey,
          category: prod.category,
          unitSize: 'standard',
          quantity: 1,
          unitPrice: price,
        },
      ],
      tax: 0,
      total: price,
      isAnonymous: true,
      consentInfo: null,
    };

    const res = await fetch('/api/receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save price spot');

    state.receipts.unshift(data.receipt);
    state.latestAnalysis = data.latestAnalysis;
    state.latestAuditReport = data.latestAuditReport;
    renderDashboard();

    feedback.classList.remove('hidden');
    feedback.classList.add('success');
    feedback.innerHTML = `<strong>Added!</strong> Your $${price.toFixed(2)} ${escapeHtml(tile.title)} spot at ${escapeHtml(payload.airportCode)} is now live in the community charts.`;
    $('qs-price').value = '';
  } catch (err) {
    feedback.classList.remove('hidden', 'success');
    feedback.textContent = 'Error: ' + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add This Price Spot';
  }
});

// Full Receipt Submit
$('standardized-receipt-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('btn-submit-receipt');
  const banner = $('submit-result-banner');
  btn.disabled = true;
  btn.textContent = 'Saving & Updating Live Charts...';

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
    banner.innerHTML = data.encryptionStatus?.encrypted
      ? `<strong>Thank you!</strong> Your receipt is live in the charts, and your optional contact info was locked in our private vault.`
      : `<strong>Thank you!</strong> Your anonymous receipt is now live in the community comparison charts.`;
    $('volunteer-confirm-checkbox').checked = false;
  } catch (err) {
    banner.classList.remove('hidden', 'success');
    banner.textContent = 'Could not save receipt: ' + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Share Receipt & Update Live Charts';
  }
});

async function runFullPipeline() {
  const btn = $('btn-run-full-pipeline');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Re-Checking...';
  }
  try {
    const res = await fetch('/api/agents/run-pipeline', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      state.latestAnalysis = data.latestAnalysis;
      state.latestAuditReport = data.latestAuditReport;
      state.agentRuns = data.agentRuns;
      renderDashboard();
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Re-Check All Numbers';
    }
  }
}

$('btn-run-full-pipeline')?.addEventListener('click', runFullPipeline);
$('filter-track')?.addEventListener('change', renderReceiptsTable);
$('filter-airport')?.addEventListener('change', renderReceiptsTable);
$('filter-search')?.addEventListener('input', renderReceiptsTable);

loadBootstrap();
