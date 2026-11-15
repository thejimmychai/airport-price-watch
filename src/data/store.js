const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const {
  AIRPORT_METADATA,
  WORLD_AIRPORTS_LIST,
  FEATURED_AIRPORT_CODES,
  detectGlobalAirportFromText,
} = require('../../public/world-airports');

const STANDARD_PRODUCTS = {
  water_20oz: { label: 'Bottled Water (20 oz)', category: 'Bottled Water & Beverages', streetRefPrice: 2.19 },
  coffee_16oz_latte: { label: '16 oz Coffee / Latte', category: 'Coffee & Tea', streetRefPrice: 4.95 },
  sandwich_grab_go: { label: 'Grab-and-Go Sandwich', category: 'Grab-and-Go Food', streetRefPrice: 8.50 },
  beer_16oz_craft: { label: '16 oz Craft / Draft Beer', category: 'Alcohol', streetRefPrice: 7.50 },
  chips_snack_bag: { label: 'Snack Chips / Trail Mix', category: 'Snacks & Candy', streetRefPrice: 2.49 },
  pain_reliever_travel: { label: 'Travel Pain Reliever (10-24ct)', category: 'Travel Essentials', streetRefPrice: 4.99 },
  earbuds_wired: { label: 'Wired Earbuds / Adapter', category: 'Travel Essentials', streetRefPrice: 12.99 },
  salad_bowl: { label: 'Fresh Salad / Grain Bowl', category: 'Grab-and-Go Food', streetRefPrice: 11.95 },
};

function buildSeedData() {
  const receipts = [
    // JFK Airport vs Queens/Jamaica Street
    {
      id: 'rcpt_seed_001',
      submissionHash: 'anon_7f9a21c840b1',
      track: 'airport',
      airportCode: 'JFK',
      region: 'Northeast',
      terminalOrLocation: 'Terminal 4, Gate B24 (Post-Security)',
      merchantName: 'Hudson News #412',
      vendorAffiliation: 'Hudson Group (Avolta)',
      purchaseDate: '2026-11-12',
      purchaseTime: '14:22',
      isAnonymous: true,
      hasEncryptedConsent: false,
      verifiedByVolunteer: true,
      aiIntakeMode: 'gemini-vision-standard',
      lineItems: [
        { rawName: 'DASANI WATER 20OZ', standardizedProductKey: 'water_20oz', category: 'Bottled Water & Beverages', unitSize: '20 oz', quantity: 1, unitPrice: 5.99, confidence: 0.98 },
        { rawName: 'LAYS CLASSIC 2.6OZ', standardizedProductKey: 'chips_snack_bag', category: 'Snacks & Candy', unitSize: '2.6 oz', quantity: 1, unitPrice: 4.79, confidence: 0.96 },
      ],
      tax: 0.96,
      total: 11.74,
      createdAt: '2026-11-12T19:25:00.000Z',
    },
    {
      id: 'rcpt_seed_002',
      submissionHash: 'anon_2c8b19e311d4',
      track: 'street',
      airportCode: 'JFK',
      region: 'Northeast',
      terminalOrLocation: 'Jamaica Ave, Queens, NY 11432',
      merchantName: 'Queens Corner Bodega & Market',
      vendorAffiliation: 'Local Street Retailer',
      purchaseDate: '2026-11-12',
      purchaseTime: '16:05',
      isAnonymous: true,
      hasEncryptedConsent: false,
      verifiedByVolunteer: true,
      aiIntakeMode: 'gemini-vision-standard',
      lineItems: [
        { rawName: 'DASANI 20OZ', standardizedProductKey: 'water_20oz', category: 'Bottled Water & Beverages', unitSize: '20 oz', quantity: 1, unitPrice: 2.00, confidence: 0.99 },
        { rawName: 'LAYS CHIPS', standardizedProductKey: 'chips_snack_bag', category: 'Snacks & Candy', unitSize: '2.6 oz', quantity: 1, unitPrice: 2.29, confidence: 0.97 },
      ],
      tax: 0.38,
      total: 4.67,
      createdAt: '2026-11-12T21:10:00.000Z',
    },
    {
      id: 'rcpt_seed_003',
      submissionHash: 'anon_8e3d44a092c1',
      track: 'airport',
      airportCode: 'JFK',
      region: 'Northeast',
      terminalOrLocation: 'Terminal 8, Concourse B (Post-Security)',
      merchantName: 'Cibo Express Gourmet Market',
      vendorAffiliation: 'OTG',
      purchaseDate: '2026-11-13',
      purchaseTime: '08:15',
      isAnonymous: false,
      hasEncryptedConsent: true,
      verifiedByVolunteer: true,
      aiIntakeMode: 'gemini-vision-standard',
      lineItems: [
        { rawName: 'TURKEY AVOCADO CLUB', standardizedProductKey: 'sandwich_grab_go', category: 'Grab-and-Go Food', unitSize: '1 sandwich', quantity: 1, unitPrice: 17.99, confidence: 0.95 },
        { rawName: 'LATTE 16OZ', standardizedProductKey: 'coffee_16oz_latte', category: 'Coffee & Tea', unitSize: '16 oz', quantity: 1, unitPrice: 7.49, confidence: 0.94 },
      ],
      tax: 2.26,
      total: 27.74,
      createdAt: '2026-11-13T13:20:00.000Z',
    },

    // LAX Airport vs Inglewood/Westchester Street
    {
      id: 'rcpt_seed_004',
      submissionHash: 'anon_5a1b92f780e3',
      track: 'airport',
      airportCode: 'LAX',
      region: 'West Coast',
      terminalOrLocation: 'Terminal 6, Gate 64 (Post-Security)',
      merchantName: 'Hudson Nonstop LAX',
      vendorAffiliation: 'Hudson Group (Avolta)',
      purchaseDate: '2026-11-11',
      purchaseTime: '11:40',
      isAnonymous: true,
      hasEncryptedConsent: false,
      verifiedByVolunteer: true,
      aiIntakeMode: 'gemini-vision-standard',
      lineItems: [
        { rawName: 'SMARTWATER 20OZ', standardizedProductKey: 'water_20oz', category: 'Bottled Water & Beverages', unitSize: '20 oz', quantity: 1, unitPrice: 6.49, confidence: 0.98 },
        { rawName: 'ADVIL TRAVEL 10CT', standardizedProductKey: 'pain_reliever_travel', category: 'Travel Essentials', unitSize: '10 ct', quantity: 1, unitPrice: 9.99, confidence: 0.93 },
      ],
      tax: 1.57,
      total: 18.05,
      createdAt: '2026-11-11T19:45:00.000Z',
    },
    {
      id: 'rcpt_seed_005',
      submissionHash: 'anon_9d4c61b230f8',
      track: 'street',
      airportCode: 'LAX',
      region: 'West Coast',
      terminalOrLocation: 'Westchester / Sepulveda Blvd, Los Angeles, CA 90045',
      merchantName: 'CVS Pharmacy #9621',
      vendorAffiliation: 'Local Street Retailer',
      purchaseDate: '2026-11-11',
      purchaseTime: '13:10',
      isAnonymous: true,
      hasEncryptedConsent: false,
      verifiedByVolunteer: true,
      aiIntakeMode: 'gemini-vision-standard',
      lineItems: [
        { rawName: 'SMARTWATER 20OZ', standardizedProductKey: 'water_20oz', category: 'Bottled Water & Beverages', unitSize: '20 oz', quantity: 1, unitPrice: 2.49, confidence: 0.99 },
        { rawName: 'ADVIL POCKET PACK 10CT', standardizedProductKey: 'pain_reliever_travel', category: 'Travel Essentials', unitSize: '10 ct', quantity: 1, unitPrice: 4.79, confidence: 0.97 },
      ],
      tax: 0.69,
      total: 7.97,
      createdAt: '2026-11-11T21:15:00.000Z',
    },
    {
      id: 'rcpt_seed_006',
      submissionHash: 'anon_1f7e82d904a2',
      track: 'airport',
      airportCode: 'LAX',
      region: 'West Coast',
      terminalOrLocation: 'Tom Bradley Intl Terminal (Post-Security)',
      merchantName: 'HMSHost California Pizza / Grab&Go',
      vendorAffiliation: 'HMSHost (Avolta)',
      purchaseDate: '2026-11-13',
      purchaseTime: '18:05',
      isAnonymous: false,
      hasEncryptedConsent: true,
      verifiedByVolunteer: true,
      aiIntakeMode: 'gemini-vision-standard',
      lineItems: [
        { rawName: 'CRAFT IPA DRAFT 16OZ', standardizedProductKey: 'beer_16oz_craft', category: 'Alcohol', unitSize: '16 oz', quantity: 1, unitPrice: 16.50, confidence: 0.96 },
        { rawName: 'CHICKEN CAESAR BOWL', standardizedProductKey: 'salad_bowl', category: 'Grab-and-Go Food', unitSize: '1 bowl', quantity: 1, unitPrice: 19.95, confidence: 0.94 },
      ],
      tax: 3.46,
      total: 39.91,
      createdAt: '2026-11-14T02:10:00.000Z',
    },

    // ORD Airport vs Rosemont Street
    {
      id: 'rcpt_seed_007',
      submissionHash: 'anon_3b6a90c115e7',
      track: 'airport',
      airportCode: 'ORD',
      region: 'Midwest',
      terminalOrLocation: 'Terminal 3, Concourse H (Post-Security)',
      merchantName: 'HMSHost Starbucks ORD T3',
      vendorAffiliation: 'HMSHost (Avolta)',
      purchaseDate: '2026-11-10',
      purchaseTime: '07:45',
      isAnonymous: true,
      hasEncryptedConsent: false,
      verifiedByVolunteer: true,
      aiIntakeMode: 'gemini-vision-standard',
      lineItems: [
        { rawName: 'GRANDE CAFFE LATTE 16OZ', standardizedProductKey: 'coffee_16oz_latte', category: 'Coffee & Tea', unitSize: '16 oz', quantity: 1, unitPrice: 6.95, confidence: 0.98 },
        { rawName: 'HAM & SWISS BISTRO BOX', standardizedProductKey: 'sandwich_grab_go', category: 'Grab-and-Go Food', unitSize: '1 box', quantity: 1, unitPrice: 14.50, confidence: 0.95 },
      ],
      tax: 2.20,
      total: 23.65,
      createdAt: '2026-11-10T13:50:00.000Z',
    },
    {
      id: 'rcpt_seed_008',
      submissionHash: 'anon_4c9d12e873b0',
      track: 'street',
      airportCode: 'ORD',
      region: 'Midwest',
      terminalOrLocation: 'Higgins Rd, Rosemont, IL 60018',
      merchantName: 'Starbucks #2481 Rosemont',
      vendorAffiliation: 'Local Street Retailer',
      purchaseDate: '2026-11-10',
      purchaseTime: '08:30',
      isAnonymous: true,
      hasEncryptedConsent: false,
      verifiedByVolunteer: true,
      aiIntakeMode: 'gemini-vision-standard',
      lineItems: [
        { rawName: 'GRANDE CAFFE LATTE 16OZ', standardizedProductKey: 'coffee_16oz_latte', category: 'Coffee & Tea', unitSize: '16 oz', quantity: 1, unitPrice: 5.25, confidence: 0.99 },
        { rawName: 'TURKEY PROVOLONE SANDWICH', standardizedProductKey: 'sandwich_grab_go', category: 'Grab-and-Go Food', unitSize: '1 sandwich', quantity: 1, unitPrice: 8.75, confidence: 0.97 },
      ],
      tax: 1.44,
      total: 15.44,
      createdAt: '2026-11-10T14:35:00.000Z',
    },

    // ATL Airport vs College Park Street
    {
      id: 'rcpt_seed_009',
      submissionHash: 'anon_6e2f73a901c4',
      track: 'airport',
      airportCode: 'ATL',
      region: 'South',
      terminalOrLocation: 'Concourse B, Gate B12 (Post-Security)',
      merchantName: 'Paradies Lagardère Essentials',
      vendorAffiliation: 'Paradies Lagardère',
      purchaseDate: '2026-11-12',
      purchaseTime: '15:10',
      isAnonymous: true,
      hasEncryptedConsent: false,
      verifiedByVolunteer: true,
      aiIntakeMode: 'gemini-vision-standard',
      lineItems: [
        { rawName: 'AQUAFINA 20OZ', standardizedProductKey: 'water_20oz', category: 'Bottled Water & Beverages', unitSize: '20 oz', quantity: 1, unitPrice: 4.59, confidence: 0.97 },
        { rawName: 'USB-C EARBUDS', standardizedProductKey: 'earbuds_wired', category: 'Travel Essentials', unitSize: '1 unit', quantity: 1, unitPrice: 29.99, confidence: 0.92 },
      ],
      tax: 3.08,
      total: 37.66,
      createdAt: '2026-11-12T20:15:00.000Z',
    },
    {
      id: 'rcpt_seed_010',
      submissionHash: 'anon_0a4b85c219d6',
      track: 'street',
      airportCode: 'ATL',
      region: 'South',
      terminalOrLocation: 'Main St, College Park, GA 30337',
      merchantName: 'College Park Market & Pharmacy',
      vendorAffiliation: 'Local Street Retailer',
      purchaseDate: '2026-11-12',
      purchaseTime: '17:00',
      isAnonymous: true,
      hasEncryptedConsent: false,
      verifiedByVolunteer: true,
      aiIntakeMode: 'gemini-vision-standard',
      lineItems: [
        { rawName: 'AQUAFINA 20OZ', standardizedProductKey: 'water_20oz', category: 'Bottled Water & Beverages', unitSize: '20 oz', quantity: 1, unitPrice: 1.89, confidence: 0.99 },
        { rawName: 'WIRED EARBUDS BASIC', standardizedProductKey: 'earbuds_wired', category: 'Travel Essentials', unitSize: '1 unit', quantity: 1, unitPrice: 12.99, confidence: 0.96 },
      ],
      tax: 1.32,
      total: 16.20,
      createdAt: '2026-11-12T22:05:00.000Z',
    },

    // DEN Airport vs Green Valley Ranch Street
    {
      id: 'rcpt_seed_011',
      submissionHash: 'anon_7d1e34f562b9',
      track: 'airport',
      airportCode: 'DEN',
      region: 'Mountain West',
      terminalOrLocation: 'Concourse B, Center Core (Post-Security)',
      merchantName: 'Tattered Cover / Hudson DEN',
      vendorAffiliation: 'Hudson Group (Avolta)',
      purchaseDate: '2026-11-13',
      purchaseTime: '12:05',
      isAnonymous: true,
      hasEncryptedConsent: false,
      verifiedByVolunteer: true,
      aiIntakeMode: 'gemini-vision-standard',
      lineItems: [
        { rawName: 'BOTTLED WATER 20OZ', standardizedProductKey: 'water_20oz', category: 'Bottled Water & Beverages', unitSize: '20 oz', quantity: 1, unitPrice: 4.99, confidence: 0.98 },
        { rawName: 'COLORADO CRAFT IPA 16OZ', standardizedProductKey: 'beer_16oz_craft', category: 'Alcohol', unitSize: '16 oz', quantity: 1, unitPrice: 14.50, confidence: 0.95 },
      ],
      tax: 1.72,
      total: 21.21,
      createdAt: '2026-11-13T19:10:00.000Z',
    },
    {
      id: 'rcpt_seed_012',
      submissionHash: 'anon_9a8b76c543d2',
      track: 'street',
      airportCode: 'DEN',
      region: 'Mountain West',
      terminalOrLocation: 'Tower Rd, Green Valley Ranch, Denver, CO 80249',
      merchantName: 'King Soopers #118',
      vendorAffiliation: 'Local Street Retailer',
      purchaseDate: '2026-11-13',
      purchaseTime: '14:40',
      isAnonymous: true,
      hasEncryptedConsent: false,
      verifiedByVolunteer: true,
      aiIntakeMode: 'gemini-vision-standard',
      lineItems: [
        { rawName: 'BOTTLED WATER 20OZ', standardizedProductKey: 'water_20oz', category: 'Bottled Water & Beverages', unitSize: '20 oz', quantity: 1, unitPrice: 1.99, confidence: 0.99 },
        { rawName: 'LOCAL IPA 16OZ CAN', standardizedProductKey: 'beer_16oz_craft', category: 'Alcohol', unitSize: '16 oz', quantity: 1, unitPrice: 6.99, confidence: 0.98 },
      ],
      tax: 0.79,
      total: 9.77,
      createdAt: '2026-11-13T21:45:00.000Z',
    },
  ];

  return {
    receipts,
    encryptedVolunteerProfiles: [],
    latestAnalysis: null,
    latestAuditReport: null,
    agentRuns: [],
  };
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadDb() {
  ensureDataDir();
  if (!fs.existsSync(DB_FILE)) {
    const seed = buildSeedData();
    fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2), 'utf8');
    return seed;
  }
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  return JSON.parse(raw);
}

function saveDb(db) {
  ensureDataDir();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

module.exports = {
  AIRPORT_METADATA,
  WORLD_AIRPORTS_LIST,
  FEATURED_AIRPORT_CODES,
  detectGlobalAirportFromText,
  STANDARD_PRODUCTS,
  loadDb,
  saveDb,
  buildSeedData,
};
