/* =====================================================================
   FARMSMART — CORE
   The shell every tile relies on, with no tile-specific logic. Tiles
   never talk to each other: they only use what's defined here, which is
   what lets each one be enabled or disabled from index.html alone.

   Sections:
     1. Tile registry
     2. Shared helpers
     3. Farms + farm switcher
     4. Users + user switcher
     5. Confirmation dialog + toast
     6. Wheel picker
     7. Theme, online status, demo banner
     8. Visitor notifications (ntfy.sh)
     9. Boot
   ===================================================================== */

/* ---------------------------------------------------------------------
   1. TILE REGISTRY
   Each tile file calls registerTile() when it loads; boot() then injects
   every tile's markup into #dashboard, in registration order (= the
   order of the <script> tags in index.html), and runs its init().
--------------------------------------------------------------------- */
window.FarmSmart = window.FarmSmart || { tiles: [] };

/**
 * Registers a tile to be mounted at boot.
 * @param {{id: string, name: string, html: string, init?: Function}} tile
 *   `name` labels the tile in the visit summary; `init` runs once its
 *   markup is in the DOM.
 */
FarmSmart.registerTile = function (tile) {
  FarmSmart.tiles.push(tile);
};

/* ---------------------------------------------------------------------
   2. SHARED HELPERS
--------------------------------------------------------------------- */
FarmSmart.icons = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

/** Escapes text before it is inserted into an HTML string. */
FarmSmart.escapeHtml = function (value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
};

/**
 * Formats a date as YYYY-MM-DD in local time. Not toISOString(), which
 * converts to UTC first and shifts the day for anyone ahead of UTC.
 */
FarmSmart.toDateKey = function (date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

/** Great-circle distance in km between two {lat, lng} points. */
FarmSmart.distanceKm = function (a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

// localStorage can throw (private mode, sandboxed previews). Failing to
// persist a preference is never worth surfacing, so these swallow errors.
FarmSmart.storage = {
  get(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* not persisted */ }
  },
  /** Parsed JSON value, or null when missing or unreadable. */
  getJson(key) {
    try { return JSON.parse(FarmSmart.storage.get(key)); } catch (e) { return null; }
  },
  setJson(key, value) {
    FarmSmart.storage.set(key, JSON.stringify(value));
  },
};

// One Supabase project for the whole app. The anon key is public by
// design; access is controlled by the project's row-level security.
const SUPABASE_URL = 'https://gissuvlnkztpbvghymmz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdpc3N1dmxua3p0cGJ2Z2h5bW16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyOTUxMTAsImV4cCI6MjEwNTg3MTExMH0.iPshYfbWiiFNGjGQVKNxy55M5kbBci3Ti--4xbUOVM0';
let supabaseClient = null;

/** Shared Supabase client, created on first use. */
FarmSmart.supabase = function () {
  if (supabaseClient) return supabaseClient;
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    throw new Error('supabase-js not loaded — check the <script> tag in index.html');
  }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return supabaseClient;
};

/**
 * Wires a sheet or overlay (shown with the `show` class): its back
 * button closes it, and so does a tap on a sheet's dimmed backdrop.
 */
FarmSmart.createPanel = function (panelId, backButtonId) {
  const panel = document.getElementById(panelId);
  const open = () => panel.classList.add('show');
  const close = () => panel.classList.remove('show');
  if (backButtonId) document.getElementById(backButtonId).addEventListener('click', close);
  if (panel.classList.contains('sheet-mask')) {
    panel.addEventListener('click', (e) => { if (e.target === panel) close(); });
  }
  return { open, close };
};

/** Stand-in for a real sensor's last-sync time: random 1–10 min. */
FarmSmart.randomSyncLabel = function () {
  const minutes = 1 + Math.floor(Math.random() * 10);
  return `Synced ${minutes} min ago`;
};

/** Keeps a badge showing a fresh randomSyncLabel(), so it feels live. */
FarmSmart.startSyncBadge = function (badgeId) {
  const refresh = () => { document.getElementById(badgeId).textContent = FarmSmart.randomSyncLabel(); };
  refresh();
  setInterval(refresh, 20000);
};

/* ---------------------------------------------------------------------
   3. COMPANY, FARMS + FARM SWITCHER
   Loaded from the `companies` and `farms` tables before any tile starts
   (see boot), so tiles can read them synchronously. A farm's `id` is its
   UUID, used for every database reference; `code` ('maguires') is the
   readable name, only for per-farm defaults. herdSize is used by Live
   Milking, roadName by Road Crossing, lat/lng by Shift Clock and Farm Plan.
--------------------------------------------------------------------- */
const DEFAULT_FARM_CODE = 'maguires';
const COMPANY_CACHE_KEY = 'farmsmart-company-cache';

/** Settings of the company whose data the app shows. */
FarmSmart.company = null;
FarmSmart.farms = [];
FarmSmart.activeFarmId = null;

FarmSmart.getFarm = function (farmId) {
  return FarmSmart.farms.find((farm) => farm.id === farmId);
};
// Stand-in when no farm could be loaded (first launch without signal),
// so tiles still render instead of failing.
const NO_FARM = { id: null, code: '', name: 'No farm', meta: '', herdSize: 0, roadName: '', lat: null, lng: null, color: null };

FarmSmart.getActiveFarm = function () {
  return FarmSmart.getFarm(FarmSmart.activeFarmId) || NO_FARM;
};

function rowToCompany(row) {
  return {
    id: row.id, name: row.name, state: row.state, xeroTenantId: row.xero_tenant_id,
    payAnchor: row.pay_anchor, otThresholdHours: Number(row.ot_threshold_hours), cycleDays: row.cycle_days,
    weeklyDaysOff: row.weekly_days_off, coupleSharedDayOff: row.couple_shared_day_off,
  };
}

function rowToFarm(row) {
  return {
    id: row.id, code: row.code, name: row.name,
    meta: [row.farm_type, row.owner_first_name].filter(Boolean).join(' - '),
    herdSize: row.herd_size || 0, roadName: row.road_name || '', lat: row.lat, lng: row.lng, color: row.color,
  };
}

function applyCompanyData({ company, farms }) {
  FarmSmart.company = company;
  FarmSmart.farms = farms;
  const defaultFarm = farms.find((farm) => farm.code === DEFAULT_FARM_CODE) || farms[0];
  FarmSmart.activeFarmId = defaultFarm ? defaultFarm.id : null;
}

async function fetchCompanyData() {
  const db = FarmSmart.supabase();
  // One company for now; choosing among several comes with user accounts.
  const { data: companyRow, error: companyError } = await db.from('companies').select('*').order('created_at').limit(1).single();
  if (companyError) throw companyError;
  const { data: farmRows, error: farmError } = await db.from('farms').select('*')
    .eq('company_id', companyRow.id).eq('active', true).order('sort_order');
  if (farmError) throw farmError;
  return { company: rowToCompany(companyRow), farms: farmRows.map(rowToFarm) };
}

/**
 * Loads the company and its active farms. Falls back to the copy cached
 * on the device, so the app still opens without signal in the paddocks.
 */
FarmSmart.loadCompanyData = async function () {
  try {
    const data = await fetchCompanyData();
    FarmSmart.storage.setJson(COMPANY_CACHE_KEY, data);
    applyCompanyData(data);
  } catch (err) {
    console.error('[FarmSmart] Could not load company and farms, using the cached copy:', err);
    const cached = FarmSmart.storage.getJson(COMPANY_CACHE_KEY);
    if (cached) applyCompanyData(cached);
  }
};

/** Fills a switcher sheet with one row per item, marking the active one. */
function renderSheetRows(listId, items, activeId, getMeta, onTap) {
  const list = document.getElementById(listId);
  list.innerHTML = '';
  items.forEach((item) => {
    const row = document.createElement('button');
    row.className = 'sheet-row' + (item.id === activeId ? ' active' : '');
    row.innerHTML = `<span class="sheet-row__title">${item.name}</span><span class="sheet-row__meta">${getMeta(item)}</span>`;
    row.onclick = () => onTap(item);
    list.appendChild(row);
  });
}

let farmSheet = null;

function openFarmSheet() {
  renderSheetRows('farmList', FarmSmart.farms, FarmSmart.activeFarmId, (farm) => farm.meta, onFarmTapped);
  farmSheet.open();
}

function onFarmTapped(farm) {
  farmSheet.close();
  if (farm.id === FarmSmart.activeFarmId) return;

  openConfirm(
    'Switch farm?',
    `You're about to switch to "${farm.name}". Any open screens will reload with data for this farm.`,
    'Yes, switch farm',
    () => {
      FarmSmart.activeFarmId = farm.id;
      document.getElementById('activeFarmName').textContent = farm.name;
      showToast('Switched to ' + farm.name);
      document.dispatchEvent(new CustomEvent('farmsmart:farmchanged', { detail: { farm } }));
    }
  );
}

/* ---------------------------------------------------------------------
   4. CLOCKING EMPLOYEE
   One view for everyone, no logins yet. Shift Clock clocks as the
   employee with this code until each person has their own login.
--------------------------------------------------------------------- */
FarmSmart.clockingEmployeeCode = 'greg';

/* ---------------------------------------------------------------------
   5. CONFIRMATION DIALOG + TOAST
   The dialog is a neutral "are you sure?", never a red warning: red is
   reserved for real problem states inside tiles.
--------------------------------------------------------------------- */
let pendingConfirmAction = null;

function openConfirm(title, message, confirmLabel, onConfirm) {
  document.getElementById('confirmTitle').textContent = title;
  const messageEl = document.getElementById('confirmMsg');
  messageEl.textContent = message;
  messageEl.style.display = message ? 'block' : 'none';
  document.getElementById('confirmOkBtn').textContent = confirmLabel;
  pendingConfirmAction = onConfirm;
  document.getElementById('confirmMask').classList.add('show');
}

function closeConfirm() {
  document.getElementById('confirmMask').classList.remove('show');
  pendingConfirmAction = null;
}

function bindConfirmDialog() {
  document.getElementById('confirmOkBtn').addEventListener('click', () => {
    const action = pendingConfirmAction;
    closeConfirm();
    if (action) action();
  });
}

let toastTimer = null;

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

/* ---------------------------------------------------------------------
   6. WHEEL PICKER
   iPhone-style snap-to-centre scroll column (used by Gates). Returns
   { getValue(), getIndex(), setIndex(i) }.
--------------------------------------------------------------------- */
const WHEEL_ROW_HEIGHT = 40; // px — must match .wheel-item height in css/tiles/gates.css

FarmSmart.createWheel = function (container, values, initialIndex) {
  container.innerHTML = '';
  container.classList.add('wheel-col');

  // Padding rows let the first and last values reach the centre.
  const addPadding = () => {
    const pad = document.createElement('div');
    pad.className = 'wheel-pad';
    container.appendChild(pad);
  };
  addPadding();
  values.forEach((value, i) => {
    const item = document.createElement('div');
    item.className = 'wheel-item';
    item.textContent = value;
    item.dataset.index = i;
    container.appendChild(item);
  });
  addPadding();

  let currentIndex = initialIndex || 0;

  function scrollToIndex(i, smooth) {
    currentIndex = Math.max(0, Math.min(values.length - 1, i));
    container.scrollTo({ top: currentIndex * WHEEL_ROW_HEIGHT, behavior: smooth ? 'smooth' : 'auto' });
    container.querySelectorAll('.wheel-item').forEach((el, index) => {
      el.classList.toggle('selected', index === currentIndex);
    });
  }

  // Snap only once a flick has settled.
  let settleTimer = null;
  container.addEventListener('scroll', () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => scrollToIndex(Math.round(container.scrollTop / WHEEL_ROW_HEIGHT), true), 120);
  });

  container.addEventListener('click', (e) => {
    const item = e.target.closest('.wheel-item');
    if (item) scrollToIndex(parseInt(item.dataset.index, 10), true);
  });

  scrollToIndex(currentIndex, false);

  return {
    getValue: () => values[currentIndex],
    getIndex: () => currentIndex,
    setIndex: (i) => scrollToIndex(i, true),
  };
};

/* ---------------------------------------------------------------------
   7. THEME, ONLINE STATUS, DEMO BANNER
   Theme and banner dismissal are remembered per device, not per user.
--------------------------------------------------------------------- */
const THEME_STORAGE_KEY = 'farmsmart-theme';
const DEMO_BANNER_DISMISSED_KEY = 'farmsmart-demo-banner-dismissed';

function applyTheme(theme) {
  const isLight = theme === 'light';
  if (isLight) document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  document.getElementById('themeToggleBtn').setAttribute('aria-label', isLight ? 'Switch to dark mode' : 'Switch to light mode');
}

function bindThemeToggle() {
  applyTheme(FarmSmart.storage.get(THEME_STORAGE_KEY) || 'dark');
  document.getElementById('themeToggleBtn').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next);
    FarmSmart.storage.set(THEME_STORAGE_KEY, next);
  });
}

// Useful on farms with patchy mobile signal between paddocks.
function updateSyncStatus() {
  const pill = document.getElementById('syncPill');
  pill.classList.toggle('offline', !navigator.onLine);
  pill.querySelector('span:last-child').textContent = navigator.onLine ? 'Synced' : 'Offline';
}
window.addEventListener('online', updateSyncStatus);
window.addEventListener('offline', updateSyncStatus);

function bindDemoBanner() {
  const banner = document.getElementById('demoBanner');
  if (FarmSmart.storage.get(DEMO_BANNER_DISMISSED_KEY) === '1') banner.style.display = 'none';
  document.getElementById('demoBannerClose').addEventListener('click', () => {
    banner.style.display = 'none';
    FarmSmart.storage.set(DEMO_BANNER_DISMISSED_KEY, '1');
  });
}

/* ---------------------------------------------------------------------
   8. VISITOR NOTIFICATIONS (ntfy.sh)
   Pushes a notification to the owner's phone when someone opens the
   app, when they tap "Share the app", and a summary of what they tapped
   when they leave. Subscribe to NTFY_TOPIC in the ntfy app to receive
   them; anyone who knows the topic can read it, so keep it obscure.
   Every call fails silently: an ad blocker must never break the app.
--------------------------------------------------------------------- */
const NTFY_TOPIC = 'farm-smart-visits-x203xxxcv45';
const NTFY_URL = `https://ntfy.sh/${NTFY_TOPIC}`;

function sendNtfy(message, { title = 'FarmSmart', tags = 'farmer' } = {}) {
  try {
    fetch(NTFY_URL, { method: 'POST', body: message, headers: { Title: title, Tags: tags } }).catch(() => {});
  } catch (e) { /* fetch unavailable */ }
}

// sendBeacon survives the tab closing, unlike fetch. It can't set
// headers, so the title goes in the body.
function sendNtfyBeacon(message) {
  try {
    if (navigator.sendBeacon) navigator.sendBeacon(NTFY_URL, message);
  } catch (e) { /* not sent */ }
}

function getDeviceLabel() {
  const ua = navigator.userAgent;
  let device = 'Unknown device';
  if (/iPad/.test(ua)) device = 'iPad';
  else if (/iPhone/.test(ua)) device = 'iPhone';
  else if (/Android/.test(ua)) device = 'Android';
  else if (/Macintosh/.test(ua)) device = 'Mac';
  else if (/Windows/.test(ua)) device = 'Windows PC';

  // Order matters: Edge's UA also says Chrome, and Chrome's says Safari.
  let browser = 'Unknown browser';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua)) browser = 'Safari';

  return `${device} · ${browser}`;
}

// Filled once the IP lookup resolves, then reused by every notification.
const visitorInfo = { ip: 'unknown', location: 'unknown', device: getDeviceLabel() };

function notifyAppOpened() {
  fetch('https://ipapi.co/json/')
    .then((res) => res.json())
    .then((data) => {
      visitorInfo.ip = data.ip || 'unknown';
      visitorInfo.location = [data.city, data.country_name].filter(Boolean).join(', ') || 'unknown';
    })
    .catch(() => { /* lookup blocked: notify with what we have */ })
    .finally(() => {
      const v = visitorInfo;
      sendNtfy(`IP: ${v.ip}\nLocation: ${v.location}\nDevice: ${v.device}\nTime: ${new Date().toLocaleString()}`, { title: '📍 FarmSmart opened' });
    });
}

// One summary when the visitor leaves, rather than one ping per tap.
// data-track="..." overrides a button's label, data-track="skip" hides it.
let sessionClicks = [];

document.addEventListener('click', (e) => {
  const el = e.target.closest('button, .farm-picker, .sheet-row');
  if (!el || el.classList.contains('wheel-item') || el.dataset.track === 'skip') return;

  const label = el.dataset.track || el.getAttribute('aria-label') || el.textContent.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!label) return;

  const tileEl = el.closest('[data-tile-name]');
  sessionClicks.push(tileEl ? `${tileEl.dataset.tileName}: ${label}` : label);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden' || sessionClicks.length === 0) return;
  const list = sessionClicks.map((label, i) => `${i + 1}. ${label}`).join('\n');
  sendNtfyBeacon(`🖱 FarmSmart session activity\nIP: ${visitorInfo.ip} · ${visitorInfo.location}\n\n${list}`);
  sessionClicks = []; // visibility can toggle more than once
});

function bindShareButton() {
  document.getElementById('shareAppBtn').addEventListener('click', async () => {
    // navigator.share() must run first, with nothing async before it:
    // some mobile browsers drop the tap's "user activation" otherwise.
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'FarmSmart', text: 'Check out FarmSmart — our farm dashboard app.', url });
      } catch (e) { /* share sheet cancelled */ }
    } else if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(url);
        showToast('Link copied to clipboard');
      } catch (e) {
        showToast('Could not copy link');
      }
    } else {
      showToast('Sharing not supported on this browser');
    }

    const v = visitorInfo;
    sendNtfy(`IP: ${v.ip} · ${v.location}\nDevice: ${v.device}\nTime: ${new Date().toLocaleString()}`, {
      title: '📤 Someone tapped "Share the app"',
      tags: 'loudspeaker',
    });
  });
}

/* ---------------------------------------------------------------------
   9. BOOT
--------------------------------------------------------------------- */
function mountTiles() {
  const dashboard = document.getElementById('dashboard');
  FarmSmart.tiles.forEach((tile) => {
    const childrenBefore = new Set(dashboard.children);
    dashboard.insertAdjacentHTML('beforeend', tile.html);
    // Tag (rather than wrap) the tile's elements so #dashboard's grid
    // layout is untouched; click tracking reads the tag.
    Array.from(dashboard.children).forEach((child) => {
      if (!childrenBefore.has(child)) child.dataset.tileName = tile.name;
    });
    // One broken tile must not stop the ones after it from mounting.
    try {
      if (tile.init) tile.init();
    } catch (err) {
      console.error(`[FarmSmart] Tile "${tile.id}" failed to start:`, err);
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  await FarmSmart.loadCompanyData();
  farmSheet = FarmSmart.createPanel('farmSheetMask');
  bindConfirmDialog();
  notifyAppOpened();
  bindShareButton();
  bindThemeToggle();
  bindDemoBanner();
  mountTiles();
  document.getElementById('activeFarmName').textContent = FarmSmart.getActiveFarm().name;
  updateSyncStatus();
});
