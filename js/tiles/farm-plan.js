/* =====================================================================
   FARMSMART — FARM PLAN TILE  (id: farm-plan)
   ---------------------------------------------------------------------
   ONE view: a map showing the farm plan photo, with a Plan <-> Satellite
   slider underneath.
   - By default the slider is on "Plan": only the photo is visible.
   - Once 3 reference points have GPS coordinates, the photo is aligned
     on the real ground and the slider can fade to the satellite image.
     Before that it stays locked on "Plan".

   Everything (placing and moving paddocks and reference points) happens
   on that one view.

   Alignment is RIGID: the photo may only move, rotate and scale evenly
   (never stretch), fitted by least squares to all reference points.
   Reference points have two positions once aligned:
   - their GPS coordinates, typed in, which never move (solid diamond);
   - where they sit on the plan photo (hollow diamond), which the user
     drags. Each drop re-fits the plan. The dashed line between the two
     is the remaining gap.

   Relies on core.js: FarmSmart.registerTile, FarmSmart.getActiveFarm,
   showToast, openConfirm, and the farmsmart:farmchanged event.
   ===================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------------
     CONSTANTS
  --------------------------------------------------------------------- */
  const TILE_ID = 'farm-plan';
  const DB_NAME = 'farmsmart-farm-plan';
  const DB_STORE = 'plans';
  const MAX_IMG_SIDE = 2400;
  const JPEG_QUALITY = 0.85;
  const MIN_REFS = 3;
  const FAR_FROM_FARM_KM = 30;         // further than this = coordinates probably wrong
  const DRAFT_PLAN_SIZE_M = 1000;      // unaligned plan: drawn as if its long side were 1 km
  const LEAFLET_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
  const ESRI_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const ESRI_ATTRIB = 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community';
  const YELLOW_FALLBACK = '#F2B705';
  const PREFS_KEY = 'farmsmart.farmPlan.layers'; // per-device show/hide + imagery choices

  // Recent imagery: Sentinel-2 via Digital Earth Australia (Geoscience
  // Australia). Free, no key, ~every 5 days, 10 m pixels.
  // - WMS layer "s2_ls_combined": Sentinel-2 (and Landsat where S2 is missing).
  // - STAC search: lists the satellite passes over the farm, with cloud cover.
  // If DEA renames a style, only these constants need changing.
  const DEA_WMS = 'https://ows.dea.ga.gov.au/wms';
  const DEA_LAYER = 's2_ls_combined';
  const DEA_STYLE = 'true_colour'; // natural colour, as named in DEA's own config (dea-config, prod inventory)
  const DEA_STAC = 'https://explorer.dea.ga.gov.au/stac/search';
  const DEA_S2_COLLECTIONS = 'ga_s2am_ard_3,ga_s2bm_ard_3,ga_s2cm_ard_3';
  const DEA_ATTRIB = '&copy; Geoscience Australia (Digital Earth Australia), contains modified Copernicus Sentinel data';
  const S2_DAYS_BACK = 120;
  const S2_MAX_CLOUD_DEFAULT = 20; // % — default pick: latest pass under this

  // Paddock states, in the words an Australian dairy farmer would use.
  // Fixed colours (not theme variables): they sit on top of a photo or
  // satellite image and must read the same in light and dark mode.
  const PADDOCK_STATUSES = [
    { id: 'ready',     label: 'Ready to graze',        color: '#2E9E44', text: '#ffffff' },
    { id: 'grazing',   label: 'Grazing now (cows in)', color: '#2F7FE0', text: '#ffffff' },
    { id: 'regrowing', label: 'Regrowing',             color: '#E3A21A', text: '#1c1c1a' },
    { id: 'out',       label: 'Out of use',            color: '#D9432F', text: '#ffffff' }
  ];
  // States from the earlier, longer list, folded into "Out of use".
  const LEGACY_STATUS = { locked: 'out', resown: 'out', pugged: 'out' };
  const STATUS_NONE = { id: '', label: 'Not set', color: '#A3A39B', text: '#1c1c1a' };
  const statusOf = id => PADDOCK_STATUSES.find(s => s.id === id) || STATUS_NONE;
  // Same Esri service as the tiles: its layers 5–18 hold the capture date,
  // resolution and accuracy of each image patch, one layer per resolution.
  const ESRI_MAPSERVER = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';
  const ESRI_META_LAYERS = 'all:5,6,7,8,9,10,11,12,13,14,15,16,17,18';

  // ---- Default plan for Maguires Road Dairy ----
  // Loaded automatically the FIRST time this farm's plan is opened and no
  // plan has been saved yet (see loadFarm()) — after that it's just the
  // farm's normal saved data, editable/replaceable like any other plan.
  // The u/v (photo position) values below are ROUGH PLACEHOLDERS, spread
  // out so the pins don't overlap — they were not precisely measured
  // against the photo, so each one will likely need a quick drag onto
  // its correct spot the first time the plan is viewed. lat/lng ARE the
  // real surveyed values and don't need touching.
  const SEED_FARM_ID = 'maguires';
  const SEED_IMAGE_URL = 'assets/seed/maguires-farm-plan.jpg';
  const SEED_REFS = [
    { name: 'Paddock 38', lat: -38.324233, lng: 142.877854, u: 0.20, v: 0.18 },
    { name: 'Paddock W52', lat: -38.325281, lng: 142.893176, u: 0.35, v: 0.32 },
    { name: 'Paddock W34', lat: -38.317151, lng: 142.894863, u: 0.50, v: 0.46 },
    { name: 'Paddock 12', lat: -38.317854, lng: 142.885000, u: 0.65, v: 0.60 },
    { name: 'Paddock 20', lat: -38.319034, lng: 142.879022, u: 0.80, v: 0.74 },
  ];

  const SVG_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const SVG_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';

  /* ---------------------------------------------------------------------
     TEMPLATE
  --------------------------------------------------------------------- */
  const TILE_HTML = `
<div class="card fp-card" id="fp-card">
  <div class="card-title"><i class="ti ti-map-2"></i>Farm plan</div>
  <!-- Preview: plan photo alone until aligned, then satellite + plan (half/half)
       with coloured paddock dots. The transparent button on top opens the plan. -->
  <div class="fp-preview" id="fp-preview" hidden>
    <img class="fp-preview-img" id="fp-thumb-img" alt="">
    <div class="fp-preview-map" id="fp-preview-map" hidden></div>
    <button type="button" class="fp-preview-hit" id="fp-thumb" aria-label="Open farm plan" data-track="Open plan (preview)"></button>
    <button type="button" class="fp-preview-expand" id="fp-preview-expand" aria-label="Open farm plan" data-track="Open plan (expand)" hidden><i class="ti ti-arrows-maximize" aria-hidden="true"></i></button>
  </div>
  <button type="button" class="card-btn primary" id="fp-open-btn"><i class="ti ti-map-2"></i><span id="fp-open-label">Create plan</span></button>
  <input type="file" id="fp-file" accept="image/*" hidden>
</div>

<div class="overlay fp-overlay" id="fp-overlay" role="dialog" aria-modal="true" aria-labelledby="fp-ov-title">
  <div class="overlay-header">
    <button type="button" class="close-btn" id="fp-close" aria-label="Close farm plan">${SVG_CLOSE}</button>
    <div class="fp-ov-heading">
      <h1 id="fp-ov-title">Farm plan</h1>
      <span class="fp-ov-farm" id="fp-ov-farm"></span>
    </div>
  </div>

  <div class="fp-ov-body">
    <div class="fp-empty" id="fp-plan-empty">
      <i class="ti ti-map-2 fp-empty-icon" aria-hidden="true"></i>
      <p class="fp-empty-title">No plan for this farm yet</p>
      <p>Upload a photo or screenshot of the farm plan. It becomes the background you place paddocks on.</p>
      <button type="button" class="card-btn primary" id="fp-upload-btn"><i class="ti ti-photo-up"></i>Upload a photo</button>
    </div>

    <div class="fp-work" id="fp-work" hidden>
      <!-- Tap = place paddocks on the map, eye = show/hide them.
           Reference points live in "Satellite alignment" below: they're only set up once. -->
      <div class="fp-kinds" id="fp-kinds">
        <div class="fp-kind">
          <button type="button" class="fp-kind-main" data-mode="paddock" aria-pressed="true" data-track="Place paddocks"><span class="fp-dot paddock" aria-hidden="true"></span>Paddocks</button>
          <button type="button" class="fp-kind-eye" data-eye="paddock" aria-pressed="true" aria-label="Hide paddocks on the map" data-track="Show/hide paddocks"><i class="ti ti-eye" aria-hidden="true"></i></button>
        </div>
      </div>
      <p class="fp-hint" id="fp-hint"></p>
      <div class="fp-banner" id="fp-banner" role="status" hidden></div>

      <div class="fp-map" id="fp-map"></div>

      <div class="fp-po-ctl" id="fp-po-ctl">
        <span class="fp-po-end">Plan</span>
        <input type="range" id="fp-po-range" min="0" max="100" step="5" value="0" aria-label="Plan to satellite" aria-valuetext="Plan only">
        <span class="fp-po-end">Satellite</span>
      </div>
      <p class="fp-po-note" id="fp-po-note" hidden></p>

      <div class="fp-src" id="fp-src" hidden>
        <div class="fp-seg2" role="radiogroup" aria-label="Satellite image">
          <button type="button" role="radio" data-src="esri" aria-checked="false">Detailed</button>
          <button type="button" role="radio" data-src="s2" aria-checked="true">Recent (less detailed)</button>
        </div>
        <div class="fp-s2" id="fp-s2" hidden>
          <p class="fp-s2-date-display" id="fp-s2-date"></p>
          <p class="fp-s2-note" id="fp-s2-note"></p>
        </div>
      </div>
      <p class="fp-imgdate" id="fp-imgdate" hidden></p>
      <div class="fp-legend" id="fp-legend" aria-label="Paddock status"></div>

      <!-- Set-up section: open while the plan isn't aligned yet, folded after. -->
      <div class="fp-calib" id="fp-calib">
        <details class="fp-calib-details" id="fp-calib-details">
          <summary class="fp-calib-head">
            <span class="fp-calib-title">Satellite alignment</span>
            <span class="badge info" id="fp-calib-badge"></span>
            <i class="ti ti-chevron-down fp-calib-chev" aria-hidden="true"></i>
          </summary>
          <div class="fp-calib-body">
            <div class="fp-kind fp-kind-ref">
              <button type="button" class="fp-kind-main" data-mode="ref" aria-pressed="false" data-track="Place reference points"><span class="fp-dot ref" aria-hidden="true"></span><span id="fp-ref-label">Add reference points</span></button>
              <button type="button" class="fp-kind-eye" data-eye="ref" aria-pressed="true" aria-label="Hide reference points on the map" data-track="Show/hide reference points"><i class="ti ti-eye" aria-hidden="true"></i></button>
            </div>
            <div id="fp-calib-msgs"></div>
            <ul class="fp-ref-list" id="fp-ref-list" aria-label="Reference points"></ul>
            <button type="button" class="card-btn" id="fp-replace-btn"><i class="ti ti-photo"></i>Replace plan photo</button>
          </div>
        </details>
      </div>
    </div>
  </div>

  <div class="sheet-mask" id="fp-sheet-mask">
    <div class="sheet" id="fp-sheet" role="dialog" aria-modal="true" aria-labelledby="fp-sheet-title">
      <div class="sheet-header">
        <button type="button" class="sheet-back-btn" id="fp-sheet-back" aria-label="Back">${SVG_BACK}</button>
        <h2 id="fp-sheet-title"></h2>
      </div>
      <div class="fp-sheet-body" id="fp-sheet-body"></div>
    </div>
  </div>
</div>`;

  /* ---------------------------------------------------------------------
     STATE
  --------------------------------------------------------------------- */
  const state = {
    farm: null,
    data: emptyData(),
    imgUrl: '',
    calib: { status: 'noimage', n: 0 },
    geo: null,         // transform used to draw: the alignment, or a draft one before that
    mode: 'paddock',
    editing: null,     // { kind, id, isNew, draft: { name, u, v, latText, lngText } }
    pick: false,       // picking a reference point's GPS on the satellite image
    map: null,
    tiles: null,       // satellite tile layer
    mapLayer: null,
    planLayer: null,   // plan photo drawn on the map
    satAmount: 0,      // slider: 0 = plan only, 1 = satellite only
    showPaddocks: true,
    showRefs: true,
    calibOpen: null,   // "Satellite alignment": null = automatic (open until aligned), else user's choice
    source: 's2',      // 'esri' (detailed, older) | 's2' (recent, less detailed) — recent is the default
    s2Date: '',        // YYYY-MM-DD pass shown
    s2Passes: null,    // [{ date, cloud }] for the current farm, null = not loaded
    s2PassesFor: '',   // farm key the passes were loaded for
    esriLayer: null,
    pmap: null,        // preview map in the dashboard card
    pPlanLayer: null,
    pDots: null,
    pNeedsFit: true,   // re-centre the preview map; false once the user has panned/zoomed it themselves
    pTileKey: '',      // which tile layer is on the preview map right now ('esri' or 's2:<date>')
    pTiles: null,
    needsFit: true
  };
  let els = null;
  let loadToken = 0;
  let storageWarned = false;
  let leafletPromise = null;

  /* ---------------------------------------------------------------------
     SMALL HELPERS
  --------------------------------------------------------------------- */
  function emptyData() { return { image: null, imgW: 0, imgH: 0, paddocks: [], refs: [] }; }
  const toNum = x => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const hasGps = r => Number.isFinite(r.lat) && Number.isFinite(r.lng);
  const clamp01 = x => Math.min(1, Math.max(0, x));
  const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
  const farmKey = f => 'farm:' + String(f.id);
  const newId = kind => (kind === 'ref' ? 'r_' : 'p_') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const wrapLng = lng => ((lng + 540) % 360) - 180;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, one, many) => (n === 1 ? one : many);

  function normalizeData(raw) {
    const d = emptyData();
    if (!raw || typeof raw !== 'object') return d;
    const isUrl = typeof raw.image === 'string' && raw.image.length > 0;
    const isFreshBlob = raw.image && typeof raw.image.size === 'number'; // not yet uploaded/persisted
    if (raw.image && (isUrl || isFreshBlob) && raw.imgW > 0 && raw.imgH > 0) {
      d.image = raw.image; d.imgW = raw.imgW; d.imgH = raw.imgH;
    }
    const okPos = p => p && typeof p.id === 'string' && Number.isFinite(p.u) && Number.isFinite(p.v);
    d.paddocks = (Array.isArray(raw.paddocks) ? raw.paddocks : []).filter(okPos)
      .map(p => ({
        id: p.id, name: String(p.name || ''), u: p.u, v: p.v,
        status: PADDOCK_STATUSES.some(s => s.id === (LEGACY_STATUS[p.status] || p.status))
          ? (LEGACY_STATUS[p.status] || p.status) : '',
        lastGrazed: /^\d{4}-\d{2}-\d{2}$/.test(p.lastGrazed || '') ? p.lastGrazed : '',
        notes: String(p.notes || '').slice(0, 1000)
      }));
    d.refs = (Array.isArray(raw.refs) ? raw.refs : []).filter(okPos)
      .map(r => ({ id: r.id, name: String(r.name || ''), u: r.u, v: r.v, lat: toNum(r.lat), lng: toNum(r.lng) }));
    return d;
  }

  function fmtM(m) {
    if (!Number.isFinite(m)) return '—';
    if (m < 10) return m.toFixed(1) + ' m';
    if (m < 1000) return Math.round(m) + ' m';
    return (m / 1000).toFixed(m < 10000 ? 1 : 0) + ' km';
  }
  const fmtCoord = x => (Number.isFinite(x) ? x.toFixed(6) : '');

  /** Today as YYYY-MM-DD in the phone's local time (what <input type="date"> uses). */
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  /** Whole days between a YYYY-MM-DD date and today, or null. */
  function daysSince(ymd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return null;
    const [y, m, d] = ymd.split('-').map(Number);
    const [ty, tm, td] = todayStr().split('-').map(Number);
    return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / 864e5);
  }
  function fmtDaysAgo(n) {
    if (n === null) return '';
    if (n <= 0) return 'today';
    if (n === 1) return 'yesterday';
    return `${n} days ago`;
  }
  function fmtDateAU(ymd) {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      if (p.source === 'esri' || p.source === 's2') state.source = p.source;
      state.calibOpen = typeof p.calibOpen === 'boolean' ? p.calibOpen : null;
    } catch (_) { /* private mode etc.: keep defaults */ }
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ paddocks: state.showPaddocks, refs: state.showRefs, source: state.source, calibOpen: state.calibOpen })); } catch (_) {}
  }

  /** Accepts "-38.3001", "−38.3001" and "-38,3001". Returns {empty} | {invalid} | {value}. */
  function parseCoord(raw) {
    const s = String(raw || '').trim().replace(/°/g, '').replace(/\s+/g, '').replace(/^\u2212/, '-');
    if (!s) return { empty: true };
    const norm = /^[-+]?\d+,\d+$/.test(s) ? s.replace(',', '.') : s;
    if (!/^[-+]?\d+(\.\d+)?$/.test(norm)) return { invalid: true };
    return { value: parseFloat(norm) };
  }

  // core.js toasts are single-line (white-space: nowrap) — keep messages short.
  function toast(msg) {
    if (typeof showToast === 'function') showToast(msg); // eslint-disable-line no-undef
    else console.info('[farm-plan]', msg);
  }
  function confirmAction(title, message, label, onConfirm) {
    if (typeof openConfirm === 'function') openConfirm(title, message, label, onConfirm); // eslint-disable-line no-undef
    else if (window.confirm(title + '\n\n' + message)) onConfirm();
  }
  function getActiveFarm() {
    try { return FarmSmart.getActiveFarm() || null; } catch (_) { return null; } // eslint-disable-line no-undef
  }
  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function warnStorage() {
    if (storageWarned) return;
    storageWarned = true;
    toast('Storage unavailable — not saved');
  }

  /* ---------------------------------------------------------------------
     SUPABASE STORAGE (shared across every device — replaces the old
     per-device IndexedDB store below). Same get(key)/put(key,value)
     interface as before, so nothing else in this file needed to change.
     key is always farmKey(farm), e.g. "farm:maguires" — the farm_id is
     read out of it. image goes into Supabase Storage as a file; the
     3 tables just hold the row data (see the SQL from setup).
  --------------------------------------------------------------------- */
  const SUPABASE_URL = 'https://gissuvlnkztpbvghymmz.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdpc3N1dmxua3p0cGJ2Z2h5bW16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyOTUxMTAsImV4cCI6MjEwNTg3MTExMH0.iPshYfbWiiFNGjGQVKNxy55M5kbBci3Ti--4xbUOVM0';
  const STORAGE_BUCKET = 'farm-plan-images';
  let supabaseClient = null;
  function sb() {
    if (supabaseClient) return supabaseClient;
    if (typeof window.supabase === 'undefined' || typeof window.supabase.createClient !== 'function') {
      throw new Error('supabase-js not loaded — check the <script> tag in index.html');
    }
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return supabaseClient;
  }

  const Store = {
    async get(key) {
      const farmId = key.replace(/^farm:/, '');
      const client = sb();

      const [{ data: planRow, error: planErr }, { data: refRows, error: refErr }, { data: pdkRows, error: pdkErr }] = await Promise.all([
        client.from('farm_plans').select('*').eq('farm_id', farmId).maybeSingle(),
        client.from('farm_plan_refs').select('*').eq('farm_id', farmId),
        client.from('farm_plan_paddocks').select('*').eq('farm_id', farmId),
      ]);
      if (planErr) throw planErr;
      if (refErr) throw refErr;
      if (pdkErr) throw pdkErr;
      if (!planRow) return null; // nothing saved for this farm yet

      return {
        image: planRow.image_path || null, // a public Storage URL (string), not a Blob
        imgW: planRow.img_w || 0,
        imgH: planRow.img_h || 0,
        refs: (refRows || []).map(r => ({ id: r.id, name: r.name, u: r.u, v: r.v, lat: r.lat, lng: r.lng })),
        paddocks: (pdkRows || []).map(p => ({
          id: p.id, name: p.name, u: p.u, v: p.v, status: p.status || '',
          lastGrazed: p.last_grazed || '', notes: p.notes || ''
        })),
      };
    },

    async put(key, value) {
      const farmId = key.replace(/^farm:/, '');
      const client = sb();

      // Only re-upload if the image actually changed (a Blob means new/changed;
      // an unchanged plan still carries its existing URL string through here).
      let imagePath = typeof value.image === 'string' ? value.image : null;
      if (value.image && typeof value.image !== 'string') {
        const path = `${farmId}.jpg`;
        const { error: upErr } = await client.storage.from(STORAGE_BUCKET).upload(path, value.image, { upsert: true, contentType: 'image/jpeg' });
        if (upErr) throw upErr;
        imagePath = client.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
      }

      const { error: planErr } = await client.from('farm_plans').upsert({
        farm_id: farmId, image_path: imagePath, img_w: value.imgW, img_h: value.imgH, updated_at: new Date().toISOString(),
      });
      if (planErr) throw planErr;

      // Simplest correct sync at this scale: replace every ref/paddock row
      // for this farm rather than diffing which ones changed.
      const { error: delRefErr } = await client.from('farm_plan_refs').delete().eq('farm_id', farmId);
      if (delRefErr) throw delRefErr;
      if (value.refs && value.refs.length) {
        const { error: insRefErr } = await client.from('farm_plan_refs').insert(
          value.refs.map(r => ({ id: r.id, farm_id: farmId, name: r.name, lat: r.lat, lng: r.lng, u: r.u, v: r.v }))
        );
        if (insRefErr) throw insRefErr;
      }

      const { error: delPdkErr } = await client.from('farm_plan_paddocks').delete().eq('farm_id', farmId);
      if (delPdkErr) throw delPdkErr;
      if (value.paddocks && value.paddocks.length) {
        const { error: insPdkErr } = await client.from('farm_plan_paddocks').insert(
          value.paddocks.map(p => ({ id: p.id, farm_id: farmId, name: p.name, status: p.status || null, last_grazed: p.lastGrazed || null, notes: p.notes || null, u: p.u, v: p.v }))
        );
        if (insPdkErr) throw insPdkErr;
      }
    },
  };

  /* ---------------------------------------------------------------------
     INDEXEDDB STORAGE (kept, unused, in case Supabase needs to be rolled
     back — the block above is what's actually wired up now)
  --------------------------------------------------------------------- */
  const LegacyIndexedDbStore = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      if (!('indexedDB' in window)) return Promise.reject(new Error('no indexedDB'));
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
        req.onsuccess = () => { this.db = req.result; resolve(this.db); };
        req.onerror = () => reject(req.error);
      });
    },
    async get(key) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const r = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => reject(r.error);
      });
    },
    async put(key, value) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    }
  };

  /* ---------------------------------------------------------------------
     GEOMETRY: plan (pixels) <-> GPS
     GPS is projected into a local flat grid in metres around the centre
     of the reference points (plenty accurate at farm scale), so gaps
     come out directly in metres.
  --------------------------------------------------------------------- */
  const M_PER_DEG_LAT = 110574;
  const M_PER_DEG_LNG = 111320;
  const rad = d => d * Math.PI / 180;

  function toLocal(lat, lng, o) {
    return { E: (lng - o.lng) * M_PER_DEG_LNG * Math.cos(rad(o.lat)), N: (lat - o.lat) * M_PER_DEG_LAT };
  }
  function fromLocal(E, N, o) {
    return { lat: o.lat + N / M_PER_DEG_LAT, lng: o.lng + E / (M_PER_DEG_LNG * Math.cos(rad(o.lat))) };
  }
  function distanceKm(a, b) {
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  }

  /**
   * Rigid fit (2D similarity: move + rotate + even scale, no stretch)
   * by least squares on the reference points that have GPS.
   *   E = p·X − q·Yu + mE,   N = q·X + p·Yu + mN
   * X, Yu = centred photo pixels with the y axis pointing up (Yu = −Y).
   * With flip = true the photo is mirrored — only used to detect a
   * swapped latitude/longitude, never to draw.
   */
  function fitRigid(P, flip) {
    let S = 0, sE = 0, sN = 0;
    for (const p of P) {
      const Yu = flip ? p.Y : -p.Y;
      S += p.X * p.X + Yu * Yu;
      sE += p.X * p.E + Yu * p.N;
      sN += p.X * p.N - Yu * p.E;
    }
    if (!(S > 0)) return null;
    const pp = sE / S, qq = sN / S;
    const residuals = {};
    let ss = 0;
    for (const p of P) {
      const Yu = flip ? p.Y : -p.Y;
      const r = Math.hypot(pp * p.X - qq * Yu - p.E, qq * p.X + pp * Yu - p.N);
      residuals[p.id] = r;
      ss += r * r;
    }
    return { p: pp, q: qq, residuals, rms: Math.sqrt(ss / P.length) };
  }

  function computeCalibration(data) {
    const pts = data.refs.filter(hasGps);
    const n = pts.length;
    if (!data.image) return { status: 'noimage', n };
    if (n < MIN_REFS) return { status: 'insufficient', n };

    const W = data.imgW, H = data.imgH;
    const origin = { lat: avg(pts.map(p => p.lat)), lng: avg(pts.map(p => p.lng)) };
    const raw = pts.map(p => {
      const l = toLocal(p.lat, p.lng, origin);
      return { id: p.id, x: p.u * W, y: p.v * H, E: l.E, N: l.N };
    });
    const mx = avg(raw.map(p => p.x)), my = avg(raw.map(p => p.y));
    const mE = avg(raw.map(p => p.E)), mN = avg(raw.map(p => p.N));
    const P = raw.map(p => ({ id: p.id, X: p.x - mx, Y: p.y - my, E: p.E - mE, N: p.N - mN }));

    // Points must be spread out both on the photo and on the ground.
    const spreadPx = Math.sqrt(avg(P.map(p => p.X * p.X + p.Y * p.Y)));
    const spreadM = Math.sqrt(avg(P.map(p => p.E * p.E + p.N * p.N)));
    if (spreadPx < 0.01 * Math.max(W, H) || spreadM < 2) return { status: 'tooclose', n };

    const fit = fitRigid(P, false);
    if (!fit) return { status: 'tooclose', n };
    const { p, q } = fit;
    const s2 = p * p + q * q;

    const toGPS = (u, v) => {
      const X = u * W - mx, Yu = -(v * H - my);
      return fromLocal(p * X - q * Yu + mE, q * X + p * Yu + mN, origin);
    };
    const toPlan = (lat, lng) => {
      const l = toLocal(lat, lng, origin);
      const E = l.E - mE, N = l.N - mN;
      const X = (p * E + q * N) / s2, Yu = (-q * E + p * N) / s2;
      return { u: (X + mx) / W, v: (-Yu + my) / H };
    };

    const warnings = [];
    const flipped = fitRigid(P, true);
    if (flipped && fit.rms > 5 && flipped.rms < 0.5 * fit.rms) warnings.push('mirror');

    let worstId = null;
    if (n >= 4) {
      const sorted = Object.values(fit.residuals).sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const [id, max] = Object.entries(fit.residuals).reduce((m, kv) => (kv[1] > m[1] ? kv : m));
      if (max > 5 && max > 2.5 * median) worstId = id;
    }

    const scale = Math.sqrt(s2); // metres per photo pixel
    return {
      status: 'ok', n, toGPS, toPlan,
      residuals: fit.residuals, rms: fit.rms,
      checkable: true, // with a rigid fit, 3 points already over-determine it
      warnings, worstId, widthM: scale * W, heightM: scale * H
    };
  }

  /**
   * Before the plan is aligned there is no real position for it, so it is
   * drawn north-up, centred on the farm's coordinates, at an arbitrary
   * scale. Satellite stays hidden meanwhile, so nothing looks "wrong".
   */
  function draftTransform(d, farm) {
    const o = farm && Number.isFinite(farm.lat) && Number.isFinite(farm.lng)
      ? { lat: farm.lat, lng: farm.lng } : { lat: 0, lng: 0 };
    const s = DRAFT_PLAN_SIZE_M / Math.max(d.imgW, d.imgH); // metres per photo pixel
    return {
      toGPS: (u, v) => fromLocal((u - 0.5) * d.imgW * s, -(v - 0.5) * d.imgH * s, o),
      toPlan: (lat, lng) => {
        const l = toLocal(lat, lng, o);
        return { u: l.E / (d.imgW * s) + 0.5, v: -l.N / (d.imgH * s) + 0.5 };
      }
    };
  }

  const isAligned = () => state.calib.status === 'ok';

  /* ---------------------------------------------------------------------
     IMAGE
  --------------------------------------------------------------------- */
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  async function downscale(file) {
    let src = null, w = 0, h = 0, cleanup = () => {};
    if ('createImageBitmap' in window) {
      try {
        src = await createImageBitmap(file, { imageOrientation: 'from-image' });
        w = src.width; h = src.height;
        cleanup = () => src.close && src.close();
      } catch (_) { src = null; }
    }
    if (!src) {
      const url = URL.createObjectURL(file);
      try { src = await loadImage(url); } catch (err) { URL.revokeObjectURL(url); throw err; }
      w = src.naturalWidth; h = src.naturalHeight;
      cleanup = () => URL.revokeObjectURL(url);
    }
    if (!w || !h) { cleanup(); throw new Error('empty image'); }
    const scale = Math.min(1, MAX_IMG_SIDE / Math.max(w, h));
    const cw = Math.round(w * scale), ch = Math.round(h * scale);
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(src, 0, 0, cw, ch);
    cleanup();
    const blob = await new Promise((res, rej) =>
      canvas.toBlob(b => (b ? res(b) : rej(new Error('toBlob'))), 'image/jpeg', JPEG_QUALITY));
    return { blob, w: cw, h: ch };
  }

  /* ---------------------------------------------------------------------
     LEAFLET (loaded when the plan is first opened)
  --------------------------------------------------------------------- */
  function ensureLeaflet() {
    if (window.L && window.L.map) return Promise.resolve();
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise((resolve, reject) => {
      if (!document.querySelector('link[href*="leaflet"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = LEAFLET_BASE + 'leaflet.css';
        document.head.appendChild(link);
      }
      const s = document.createElement('script');
      s.src = LEAFLET_BASE + 'leaflet.js';
      s.async = true;
      s.onload = () => (window.L ? resolve() : reject(new Error('Leaflet missing')));
      s.onerror = () => { s.remove(); leafletPromise = null; reject(new Error('Leaflet failed to load')); };
      document.head.appendChild(s);
    });
    return leafletPromise;
  }

  /* ---------------------------------------------------------------------
     INIT + PER-FARM LOADING
  --------------------------------------------------------------------- */
  function init() {
    if (els) return; // core.js mounts each tile once
    const q = id => document.getElementById(id);
    const overlay = q('fp-overlay');
    els = {
      card: q('fp-card'), overlay,
      thumb: q('fp-thumb'), thumbImg: q('fp-thumb-img'),
      preview: q('fp-preview'), previewMap: q('fp-preview-map'), previewExpand: q('fp-preview-expand'),
      openBtn: q('fp-open-btn'), openLabel: q('fp-open-label'), file: q('fp-file'),
      ovFarm: q('fp-ov-farm'), closeBtn: q('fp-close'),
      planEmpty: q('fp-plan-empty'), work: q('fp-work'),
      kinds: q('fp-kinds'), modeBtns: overlay.querySelectorAll('.fp-kind-main'), eyeBtns: overlay.querySelectorAll('.fp-kind-eye'),
      src: q('fp-src'), srcBtns: overlay.querySelectorAll('[data-src]'), s2Box: q('fp-s2'),
      s2Date: q('fp-s2-date'), s2Note: q('fp-s2-note'),
      hint: q('fp-hint'), banner: q('fp-banner'), map: q('fp-map'),
      legend: q('fp-legend'),
      poCtl: q('fp-po-ctl'), poRange: q('fp-po-range'), poNote: q('fp-po-note'), imgDate: q('fp-imgdate'),
      calib: q('fp-calib'), calibDetails: q('fp-calib-details'), calibBadge: q('fp-calib-badge'),
      calibMsgs: q('fp-calib-msgs'), refList: q('fp-ref-list'), refLabel: q('fp-ref-label'),
      uploadBtn: q('fp-upload-btn'), replaceBtn: q('fp-replace-btn'),
      sheetMask: q('fp-sheet-mask'), sheetTitle: q('fp-sheet-title'),
      sheetBack: q('fp-sheet-back'), sheetBody: q('fp-sheet-body')
    };

    loadPrefs();
    bindEvents();
    // core.js dispatches this on `document`.
    document.addEventListener('farmsmart:farmchanged', e => loadFarm(e.detail && e.detail.farm));
    document.addEventListener('keydown', onGlobalKeydown);
    loadFarm(getActiveFarm());
  }

  function bindEvents() {
    els.openBtn.addEventListener('click', openOverlay);
    els.thumb.addEventListener('click', openOverlay);
    els.previewExpand.addEventListener('click', openOverlay);
    els.closeBtn.addEventListener('click', closeOverlay);
    els.modeBtns.forEach(b => b.addEventListener('click', () => {
      // "Add reference points" works as an on/off switch; back to paddocks when done.
      state.mode = b.dataset.mode === 'ref' && state.mode === 'ref' ? 'paddock' : b.dataset.mode;
      ensureVisible(state.mode); // placing things you can't see would be confusing
      renderModeUi();
    }));
    els.eyeBtns.forEach(b => b.addEventListener('click', () => {
      const kind = b.dataset.eye;
      setLayerVisible(kind, !(kind === 'ref' ? state.showRefs : state.showPaddocks));
    }));
    els.srcBtns.forEach(b => b.addEventListener('click', () => setSource(b.dataset.src)));
    els.uploadBtn.addEventListener('click', () => els.file.click());
    els.replaceBtn.addEventListener('click', onReplaceClick);
    els.file.addEventListener('change', () => {
      const f = els.file.files && els.file.files[0];
      els.file.value = '';
      onFileChosen(f);
    });

    els.poRange.addEventListener('input', () => {
      state.satAmount = Number(els.poRange.value) / 100;
      applyOpacity();
    });
    // A locked slider can't be moved, so explain why when it's touched.
    els.poCtl.addEventListener('click', () => { if (els.poRange.disabled) toast(`Needs ${MIN_REFS} GPS points first`); });

    els.calibDetails.addEventListener('toggle', () => {
      const open = els.calibDetails.open;
      if (open === isCalibOpen()) return; // our own re-render, not the user
      state.calibOpen = open;
      savePrefs();
      if (!open && state.mode === 'ref') { state.mode = 'paddock'; renderModeUi(); } // folded = done with set-up
    });
    els.calib.addEventListener('click', e => {
      const row = e.target.closest('[data-ref-id]');
      if (row) openEditor('ref', row.dataset.refId);
    });
    els.banner.addEventListener('click', e => {
      if (e.target.closest('#fp-pick-cancel')) cancelPick(true);
      else if (e.target.closest('#fp-sat-retry')) renderMap();
    });

    els.sheetBack.addEventListener('click', () => closeSheet());
    els.sheetMask.addEventListener('click', e => { if (e.target === els.sheetMask) closeSheet(); });
    els.sheetBody.addEventListener('click', onSheetClick);
    els.sheetBody.addEventListener('input', onSheetInput);
    els.sheetBody.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); saveEditor(); }
    });
  }

  /** Fetches the bundled seed photo and turns it + SEED_REFS into a data
   *  object shaped exactly like what normalizeData() expects. Only ever
   *  called once per browser, the first time Maguires Road Dairy's plan
   *  is opened with nothing saved yet (see loadFarm()). */
  async function buildSeedData() {
    const res = await fetch(SEED_IMAGE_URL);
    if (!res.ok) throw new Error('seed image fetch failed: ' + res.status);
    const file = await res.blob();
    const { blob, w, h } = await downscale(file); // same pipeline as a manual "Upload a photo"
    return {
      image: blob, imgW: w, imgH: h,
      paddocks: [],
      refs: SEED_REFS.map(r => ({ id: newId('ref'), name: r.name, u: r.u, v: r.v, lat: r.lat, lng: r.lng })),
    };
  }

  async function loadFarm(farm) {
    const token = ++loadToken;
    state.pick = false;
    if (state.editing) { state.editing = null; hideSheet(); }
    state.farm = farm || null;

    let raw = null;
    if (state.farm) {
      try { raw = await Store.get(farmKey(state.farm)); } catch (_) { warnStorage(); }
    }
    if (token !== loadToken) return; // another farm was picked in the meantime

    // First-ever open of Maguires Road Dairy's plan, nothing saved yet:
    // load the bundled default plan + reference points instead of an
    // empty plan. Never runs again once anything has been saved for
    // this farm (including the user clearing it back to empty).
    if (!raw && state.farm && state.farm.id === SEED_FARM_ID) {
      try {
        raw = await buildSeedData();
        await Store.put(farmKey(state.farm), { ...raw, updatedAt: Date.now() });
        if (token !== loadToken) return;
        toast('Default farm plan loaded — drag each pin onto its exact spot');
      } catch (err) {
        console.error('[farm-plan] seed load failed:', err);
        toast('Default farm plan couldn\u2019t be loaded — check console, or upload one manually');
        raw = null; // fall back to an empty plan, same as before this feature existed
      }
    }

    state.data = normalizeData(raw);
    setImageUrl();
    state.needsFit = true;
    state.pNeedsFit = true;
    state.s2Passes = null; state.s2PassesFor = ''; state.s2Date = '';
    afterDataChange();
    if (isOverlayOpen()) renderOverlay();
  }

  function persist() {
    if (!state.farm) return;
    const d = state.data;
    Store.put(farmKey(state.farm), {
      image: d.image, imgW: d.imgW, imgH: d.imgH,
      paddocks: d.paddocks, refs: d.refs, updatedAt: Date.now()
    }).catch(warnStorage);
  }

  function setImageUrl() {
    if (state.imgUrlIsBlob && state.imgUrl) URL.revokeObjectURL(state.imgUrl);
    const img = state.data.image;
    if (!img) { state.imgUrl = ''; state.imgUrlIsBlob = false; }
    else if (typeof img === 'string') { state.imgUrl = img; state.imgUrlIsBlob = false; } // Supabase Storage URL
    else { state.imgUrl = URL.createObjectURL(img); state.imgUrlIsBlob = true; } // fresh upload, not yet persisted
  }

  function afterDataChange() {
    const wasAligned = isAligned();
    state.calib = computeCalibration(state.data);
    state.geo = !state.data.image ? null : (isAligned() ? state.calib : draftTransform(state.data, state.farm));
    renderCard();
    if (!isOverlayOpen()) return;
    // Set-up just finished and the panel is on "automatic": it folds itself,
    // so go back to placing paddocks.
    if (!wasAligned && isAligned() && state.calibOpen === null && state.mode === 'ref') state.mode = 'paddock';
    renderCalibPanel();
    renderLegend();
    if (wasAligned !== isAligned()) {
      state.needsFit = true; // the plan just jumped to (or away from) its real position
      renderModeUi();
      if (!state.pick) {
        // Deferred so it wins over the action's own toast ("Saved", "Deleted"…).
        const msg = isAligned() ? 'Aligned — satellite unlocked' : 'Need 3 GPS points for satellite';
        setTimeout(() => toast(msg), 0);
      }
    }
    refreshMap();
  }

  /* ---------------------------------------------------------------------
     RENDER: DASHBOARD CARD
  --------------------------------------------------------------------- */
  // Red (.badge.warn) is kept for real problems, per base.css — a plan
  // that simply isn't finished yet gets the neutral blue .badge.info.
  function calibBadge(c) {
    switch (c.status) {
      case 'noimage': return { cls: 'info', text: 'No plan' };
      case 'insufficient': return { cls: 'info', text: `${c.n}/${MIN_REFS} GPS points` };
      case 'tooclose': return { cls: 'warn', text: 'Points too close' };
      default:
        if (c.warnings.length) return { cls: 'warn', text: 'Check alignment' };
        return { cls: 'ok', text: `Aligned ±${fmtM(c.rms)}` };
    }
  }

  function renderCard() {
    const d = state.data;
    els.openLabel.textContent = d.image ? 'Open plan' : 'Create plan';
    els.openBtn.disabled = !state.farm;
    els.preview.hidden = !d.image;
    if (!d.image) return;
    if (els.thumbImg.getAttribute('src') !== state.imgUrl) els.thumbImg.src = state.imgUrl;
    if (isAligned()) renderPreviewMap();
    else showPreviewPhoto();
  }

  function showPreviewPhoto() {
    els.thumbImg.hidden = false;
    els.previewMap.hidden = true;
    els.thumb.hidden = false;
    els.previewExpand.hidden = true;
  }

  const PREVIEW_PLAN_OPACITY = 0.5; // "half-way on the slider": plan and ground both visible

  async function renderPreviewMap() {
    try { await ensureLeaflet(); } catch (_) { showPreviewPhoto(); return; } // offline: photo only
    if (!isAligned() || !state.data.image) { showPreviewPhoto(); return; }
    const L = window.L, c = state.calib, d = state.data;
    els.previewMap.hidden = false;
    if (!state.pmap) {
      // One-finger drag pans the preview map directly (by request) — note
      // this means a swipe that starts on the preview pans the map instead
      // of scrolling the dashboard page; the mouse wheel is still left
      // alone so it never hijacks page scrolling on desktop.
      const map = L.map(els.previewMap, {
        zoomControl: false, attributionControl: true,
        dragging: true, touchZoom: true, scrollWheelZoom: false, doubleClickZoom: true,
        boxZoom: false, keyboard: false, zoomSnap: 0.25, fadeAnimation: false
      }).setView([c.toGPS(0.5, 0.5).lat, c.toGPS(0.5, 0.5).lng], 15);
      map.attributionControl.setPrefix(false);
      map.createPane('fpPlanPane').style.zIndex = 350;
      state.pDots = L.layerGroup().addTo(map);
      state.pmap = map;
      let t = null;
      window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { if (isAligned()) renderPreviewMap(); }, 200); });
    }
    const map = state.pmap;
    map.invalidateSize();
    applyPreviewSource();
    if (state.pNeedsFit) {
      const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => { const g = c.toGPS(u, v); return L.latLng(g.lat, g.lng); });
      // Same framing as tapping "Open plan": centred on the paddocks (or the
      // whole plan if there are none yet), zoomed in close.
      const bounds = focusBounds(corners);
      const hasPaddocks = d.paddocks.length > 0;
      const z = Math.min(map.getBoundsZoom(bounds, false, L.point(hasPaddocks ? 34 : 4, hasPaddocks ? 34 : 4)) - 1, 20);
      map.setView(bounds.getCenter(), z, { animate: false });
      state.pNeedsFit = false;
    }

    const opts = { url: state.imgUrl, w: d.imgW, h: d.imgH, toGPS: c.toGPS, opacity: PREVIEW_PLAN_OPACITY };
    if (state.pPlanLayer) state.pPlanLayer.update(opts);
    else state.pPlanLayer = new (getPlanOverlayClass())(opts).addTo(map);

    state.pDots.clearLayers();
    d.paddocks.forEach(p => {
      const g = c.toGPS(p.u, p.v);
      L.marker([g.lat, g.lng], {
        icon: L.divIcon({
          className: 'fp-leaflet-icon', iconSize: [18, 18], iconAnchor: [9, 9],
          html: `<span class="fp-pv-dot" style="--st:${statusOf(p.status).color}"></span>`
        }),
        interactive: false, keyboard: false
      }).addTo(state.pDots);
    });
    els.thumb.hidden = true;
    els.previewExpand.hidden = false;
    els.thumbImg.hidden = true;
  }

  /* ---------------------------------------------------------------------
     RENDER: OVERLAY
  --------------------------------------------------------------------- */
  const isOverlayOpen = () => !!els && els.overlay.classList.contains('show');

  function openOverlay() {
    if (!state.farm) { toast('Select a farm first'); return; }
    els.overlay.classList.add('show');
    els.overlay.scrollTop = 0;
    state.needsFit = true;
    // Paddocks are shown by default. Reference points too while the plan is
    // still being set up; once aligned they're tucked away to keep the view clean.
    state.showPaddocks = true;
    state.showRefs = !isAligned();
    state.satAmount = 0.5; // slider starts half-way: plan over the satellite
    renderOverlay();
  }

  function closeOverlay() {
    state.pick = false;
    if (state.editing) { state.editing = null; hideSheet(); }
    els.overlay.classList.remove('show');
  }

  function onGlobalKeydown(e) {
    if (e.key !== 'Escape' || !isOverlayOpen()) return;
    if (state.pick) cancelPick(true);
    else if (state.editing) closeSheet();
    else closeOverlay();
  }

  function renderOverlay() {
    els.ovFarm.textContent = state.farm ? state.farm.name : '';
    const has = !!state.data.image;
    els.planEmpty.hidden = has;
    els.work.hidden = !has;
    renderModeUi();
    renderLayerToggles();
    renderLegend();
    renderCalibPanel();
    if (has) renderMap();
  }

  /* ---------------------------------------------------------------------
     SHOW / HIDE PADDOCKS AND REFERENCE POINTS
  --------------------------------------------------------------------- */
  function setLayerVisible(kind, visible) {
    if (kind === 'ref') state.showRefs = visible; else state.showPaddocks = visible;
    savePrefs();
    renderLayerToggles();
    refreshMap();
  }

  function ensureVisible(kind) {
    const hidden = kind === 'ref' ? !state.showRefs : !state.showPaddocks;
    if (hidden) setLayerVisible(kind, true);
  }

  function renderLayerToggles() {
    els.eyeBtns.forEach(btn => {
      const isRef = btn.dataset.eye === 'ref';
      const on = isRef ? state.showRefs : state.showPaddocks;
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', `${on ? 'Hide' : 'Show'} ${isRef ? 'reference points' : 'paddocks'} on the map`);
      btn.querySelector('i').className = 'ti ' + (on ? 'ti-eye' : 'ti-eye-off');
      btn.closest('.fp-kind').classList.toggle('hidden-kind', !on);
    });
  }

  /** Paddock count per status, only for statuses in use on this farm. */
  function renderLegend() {
    const counts = new Map();
    state.data.paddocks.forEach(p => counts.set(p.status, (counts.get(p.status) || 0) + 1));
    const items = [...PADDOCK_STATUSES, STATUS_NONE].filter(s => counts.has(s.id));
    els.legend.innerHTML = items.map(s =>
      `<span class="fp-legend-item"><span class="fp-status-dot" style="--st:${s.color}" aria-hidden="true"></span>${esc(s.label)} <strong>${counts.get(s.id)}</strong></span>`
    ).join('');
    els.legend.hidden = !items.length;
  }

  function renderModeUi() {
    els.modeBtns.forEach(b => {
      const on = b.dataset.mode === state.mode;
      b.setAttribute('aria-pressed', String(on));
      b.closest('.fp-kind').classList.toggle('active', on);
    });
    els.refLabel.textContent = state.mode === 'ref' ? 'Done adding points' : 'Add reference points';
    let hint;
    if (state.mode === 'paddock') {
      hint = 'Tap the plan to add a paddock. Drag to move it, tap to edit.';
    } else if (!isAligned()) {
      hint = 'Adding reference points: tap a spot you can recognise from above (shed corner, gateway…), then enter its GPS coordinates.';
    } else {
      hint = 'Adding reference points. To fix one, drag its hollow diamond onto the right spot of the plan.';
    }
    els.hint.textContent = hint;
    els.hint.hidden = state.pick;
    els.kinds.hidden = state.pick;
    renderSlider();
  }

  /* ---------------------------------------------------------------------
     PLAN <-> SATELLITE SLIDER
  --------------------------------------------------------------------- */
  function renderSlider() {
    const aligned = isAligned();
    els.poRange.disabled = !aligned;
    els.poCtl.classList.toggle('locked', !aligned);
    if (!aligned) {
      els.poRange.value = '0';
      const n = state.calib.n || 0;
      els.poNote.textContent = state.calib.status === 'tooclose'
        ? 'Satellite locked: your reference points are too close together. Spread them out.'
        : `Satellite locked: add ${MIN_REFS} reference points with GPS in “Satellite alignment” below (${n}/${MIN_REFS}).`;
      els.poNote.hidden = false;
    } else {
      els.poRange.value = String(Math.round(state.satAmount * 100));
      els.poNote.hidden = true;
    }
    els.src.hidden = !aligned || state.pick;
    renderSourceUi();
    applySource();
  }

  /**
   * Slider t (0 = plan, 1 = satellite). The plan fades out as t grows;
   * the satellite fades in over the first half, so the middle shows the
   * plan half-transparent over a fully visible satellite image.
   */
  function applyOpacity() {
    const pct = Math.round(state.satAmount * 100);
    els.poRange.setAttribute('aria-valuetext', !isAligned() || pct === 0 ? 'Plan only' : pct === 100 ? 'Satellite only' : `${pct}% satellite`);
    let planOp, satOp;
    if (state.pick) { planOp = isAligned() ? 0.25 : 0; satOp = 1; }      // picking GPS needs the real ground
    else if (!isAligned()) { planOp = 1; satOp = 0; }
    else { const t = state.satAmount; planOp = 1 - t; satOp = Math.min(1, 2 * t); }
    if (state.planLayer) state.planLayer.setOpacity(planOp);
    if (state.map && state.tiles) {
      // Don't even download satellite tiles while they're invisible.
      if (satOp > 0 && !state.map.hasLayer(state.tiles)) state.tiles.addTo(state.map);
      if (satOp === 0 && state.map.hasLayer(state.tiles)) state.map.removeLayer(state.tiles);
      state.tiles.setOpacity(satOp);
    }
    if (satOp === 0) renderImageryInfo(null);
    else if (state.source === 's2' && !state.pick) renderImageryInfo(null); // the pass picker already shows the date
    else scheduleImageryInfo();
  }

  function pinHtml(kind, name, noGps) {
    return `<span class="fp-pin ${kind}${noGps ? ' nogps' : ''}" aria-hidden="true"></span>` +
           `<span class="fp-label" aria-hidden="true">${esc(name)}</span>`;
  }

  function calibMessages(c) {
    const out = [];
    if (c.status === 'insufficient') {
      const missing = MIN_REFS - c.n;
      out.push({ text: `${missing} more ${plural(missing, 'reference point', 'reference points')} with GPS coordinates needed to unlock the satellite view. Spread them widely across the plan, ideally near the edges.` });
    } else if (c.status === 'tooclose') {
      out.push({ warn: true, text: 'Your reference points are too close together to align the plan. Spread them out across the farm.' });
    } else if (c.status === 'ok') {
      out.push({ text: `Plan aligned on ${c.n} reference points, without stretching. It covers about ${fmtM(c.widthM)} × ${fmtM(c.heightM)} on the ground.` });
      out.push({ text: `Average gap between the plan and your GPS coordinates: ${fmtM(c.rms)}. Each gap shows as a dashed line between the two diamonds.` });
      if (c.warnings.includes('mirror')) out.push({ warn: true, text: 'The points fit much better with the plan flipped over. A latitude and longitude may have been swapped.' });
      if (c.worstId) {
        const r = state.data.refs.find(x => x.id === c.worstId);
        if (r) out.push({ warn: true, text: `“${r.name}” is well off compared to the others. Check it first.` });
      }
    }
    return out;
  }

  const isCalibOpen = () => (state.calibOpen === null ? !isAligned() : state.calibOpen);

  function renderCalibPanel() {
    const c = state.calib, d = state.data;
    if (!d.image) return;
    const badge = calibBadge(c);
    els.calibBadge.className = 'badge ' + badge.cls;
    els.calibBadge.textContent = badge.text;
    els.calibMsgs.innerHTML = calibMessages(c)
      .map(l => `<p class="fp-calib-msg${l.warn ? ' warn' : ''}">${esc(l.text)}</p>`).join('');
    els.refList.innerHTML = d.refs.map(r => {
      let v;
      if (!hasGps(r)) v = '<span class="badge info">No GPS</span>';
      else if (c.status === 'ok') {
        v = `<span class="${r.id === c.worstId ? 'badge warn' : 'fp-residual'}">off by ${esc(fmtM(c.residuals[r.id]))}</span>`;
      } else v = '<span class="badge ok">GPS set</span>';
      return `<li><button type="button" class="fp-ref-row" data-ref-id="${esc(r.id)}" data-track="Open reference point">` +
        `<span class="row-line"><span class="k"><span class="fp-dot ref" aria-hidden="true"></span>${esc(r.name)}</span>` +
        `<span class="v">${v}</span></span></button></li>`;
    }).join('');
    els.refList.hidden = !d.refs.length;
    if (els.calibDetails.open !== isCalibOpen()) els.calibDetails.open = isCalibOpen();
  }

  const listFor = kind => (kind === 'ref' ? state.data.refs : state.data.paddocks);
  const findItem = (kind, id) => listFor(kind).find(x => x.id === id) || null;

  /* ---------------------------------------------------------------------
     PHOTO UPLOAD
  --------------------------------------------------------------------- */
  function onReplaceClick() {
    const d = state.data;
    if (!d.paddocks.length && !d.refs.length) { els.file.click(); return; }
    confirmAction(
      'Replace the plan photo?',
      'Paddocks and reference points keep their relative position on the new photo. If the framing is different, drag them back into place afterwards.',
      'Choose photo',
      () => els.file.click()
    );
  }

  async function onFileChosen(file) {
    if (!file) return;
    if (file.type && !/^image\//.test(file.type)) { toast('Choose an image file'); return; }
    const farm = state.farm;
    if (!farm) return;
    try {
      const { blob, w, h } = await downscale(file);
      if (state.farm !== farm) return;
      state.data.image = blob;
      state.data.imgW = w;
      state.data.imgH = h;
      setImageUrl();
      state.zoomIdx = 0;
      state.pNeedsFit = true;
      persist();
      afterDataChange();
      if (isOverlayOpen()) renderOverlay();
      toast('Plan photo saved');
    } catch (_) {
      toast('Could not read this image');
    }
  }

  /* ---------------------------------------------------------------------
     EDIT SHEET (paddock / reference point)
  --------------------------------------------------------------------- */
  function startCreate(u, v) {
    const kind = state.mode;
    const n = listFor(kind).length + 1;
    state.editing = {
      kind, id: null, isNew: true,
      draft: {
        name: (kind === 'ref' ? 'Point ' : 'Paddock ') + n, u, v, latText: '', lngText: '',
        status: '', lastGrazed: '', notes: ''
      }
    };
    refreshMap();
    showSheet();
  }

  function openEditor(kind, id) {
    const item = findItem(kind, id);
    if (!item) return;
    state.editing = {
      kind, id, isNew: false,
      draft: {
        name: item.name, u: item.u, v: item.v, latText: fmtCoord(item.lat), lngText: fmtCoord(item.lng),
        status: item.status || '', lastGrazed: item.lastGrazed || '', notes: item.notes || ''
      }
    };
    showSheet();
  }

  function showSheet() {
    renderSheet();
    els.sheetMask.classList.add('show');
    if (state.editing.isNew) {
      setTimeout(() => {
        const input = document.getElementById('fp-f-name');
        if (input) { input.focus(); input.select(); }
      }, 60);
    }
  }

  function hideSheet() {
    els.sheetMask.classList.remove('show');
  }

  function closeSheet() {
    state.editing = null;
    hideSheet();
    refreshMap();
  }

  function renderSheet() {
    const ed = state.editing;
    const isRef = ed.kind === 'ref';
    const c = state.calib;
    els.sheetTitle.textContent = ed.isNew
      ? (isRef ? 'New reference point' : 'New paddock')
      : (isRef ? 'Reference point' : 'Paddock');

    let html =
      `<label class="fp-field"><span>${isRef ? 'Name' : 'Paddock name'}</span>` +
      `<input id="fp-f-name" type="text" maxlength="40" autocomplete="off" enterkeyhint="done" ` +
      `placeholder="${isRef ? 'e.g. North corner of hay shed' : 'e.g. Creek paddock'}" value="${esc(ed.draft.name)}"></label>`;

    if (isRef) {
      const f = state.farm || {};
      const phLat = Number.isFinite(f.lat) ? f.lat.toFixed(6) : '-38.300000';
      const phLng = Number.isFinite(f.lng) ? f.lng.toFixed(6) : '142.780000';
      html +=
        `<div class="fp-field-row">` +
        `<label class="fp-field"><span>Latitude</span><input id="fp-f-lat" type="text" inputmode="decimal" autocomplete="off" placeholder="${phLat}" value="${esc(ed.draft.latText)}"></label>` +
        `<label class="fp-field"><span>Longitude</span><input id="fp-f-lng" type="text" inputmode="decimal" autocomplete="off" placeholder="${phLng}" value="${esc(ed.draft.lngText)}"></label>` +
        `</div>` +
        `<p class="fp-help">Decimal degrees. You can paste “latitude, longitude” copied from a maps app into Latitude and it will be split automatically. Leave both empty to add them later.</p>` +
        `<button type="button" class="card-btn" id="fp-f-pick"><i class="ti ti-crosshair"></i>Pick on satellite map</button>`;
      if (!ed.isNew && c.status === 'ok' && c.checkable && c.residuals[ed.id] !== undefined) {
        html += `<div class="row-line"><span class="k">Gap from alignment</span><span class="v">${esc(fmtM(c.residuals[ed.id]))}</span></div>`;
      }
    } else {
      const opts = [...PADDOCK_STATUSES, STATUS_NONE].map(st =>
        `<button type="button" class="fp-status-opt" role="radio" data-status="${st.id}" aria-checked="${String(ed.draft.status === st.id)}" style="--st:${st.color}">` +
        `<span class="fp-status-dot" aria-hidden="true"></span>${esc(st.label)}</button>`).join('');
      const today = todayStr();
      html +=
        `<div class="fp-field"><span id="fp-f-status-label">Paddock state</span>` +
        `<div class="fp-status-grid" role="radiogroup" aria-labelledby="fp-f-status-label">${opts}</div></div>` +
        `<div class="fp-field"><label for="fp-f-grazed">Last grazed (cows last in)</label>` +
        `<div class="fp-date-row"><input id="fp-f-grazed" type="date" max="${today}" value="${esc(ed.draft.lastGrazed)}">` +
        `<button type="button" class="fp-mini-btn" id="fp-f-today">Today</button></div>` +
        `<span class="fp-help" id="fp-f-days">${esc(grazedHelp(ed.draft.lastGrazed))}</span></div>` +
        `<label class="fp-field"><span>Notes</span>` +
        `<textarea id="fp-f-notes" rows="3" maxlength="1000" placeholder="e.g. Trough leaking in NE corner. Sprayed for thistles.">${esc(ed.draft.notes)}</textarea></label>`;
      if (c.status === 'ok') {
        const g = c.toGPS(ed.draft.u, ed.draft.v);
        html += `<div class="row-line"><span class="k">Estimated GPS</span><span class="v">${g.lat.toFixed(6)}, ${g.lng.toFixed(6)}</span></div>`;
      }
    }

    html += `<p class="fp-error" id="fp-f-error" role="alert"></p>` +
      `<div class="fp-sheet-actions">` +
      (ed.isNew ? '' : `<button type="button" class="card-btn danger" id="fp-f-delete">Delete</button>`) +
      `<button type="button" class="card-btn primary" id="fp-f-save">${ed.isNew ? (isRef ? 'Place point' : 'Place paddock') : 'Save'}</button>` +
      `</div>`;
    els.sheetBody.innerHTML = html;
  }

  function grazedHelp(ymd) {
    const n = daysSince(ymd);
    if (n === null) return 'Not recorded yet.';
    if (n < 0) return 'That date is in the future.';
    return `${fmtDateAU(ymd)}, ${fmtDaysAgo(n)}.`;
  }

  function setGrazed(ymd) {
    const input = document.getElementById('fp-f-grazed');
    if (input) input.value = ymd;
    const help = document.getElementById('fp-f-days');
    if (help) help.textContent = grazedHelp(ymd);
  }

  function onSheetClick(e) {
    const opt = e.target.closest('.fp-status-opt');
    if (opt) {
      els.sheetBody.querySelectorAll('.fp-status-opt').forEach(b => b.setAttribute('aria-checked', String(b === opt)));
      state.editing.draft.status = opt.dataset.status;
      // Cows are in right now, so "last grazed" is today.
      if (opt.dataset.status === 'grazing') setGrazed(todayStr());
      return;
    }
    if (e.target.closest('#fp-f-today')) { setGrazed(todayStr()); return; }
    if (e.target.closest('#fp-f-save')) saveEditor();
    else if (e.target.closest('#fp-f-delete')) deleteEditing();
    else if (e.target.closest('#fp-f-pick')) startPick();
  }

  function onSheetInput(e) {
    if (e.target.id === 'fp-f-grazed') { setGrazed(e.target.value); return; }
    if (e.target.id !== 'fp-f-lat') return;
    // Pasting "-38.30012, 142.78034" into Latitude: split across both fields.
    const m = e.target.value.match(/^\s*([-+\u2212]?\d{1,3}\.\d+)\s*[,;\s]\s*([-+\u2212]?\d{1,3}\.\d+)\s*$/);
    if (!m) return;
    e.target.value = m[1].replace('\u2212', '-');
    const lng = document.getElementById('fp-f-lng');
    if (lng) lng.value = m[2].replace('\u2212', '-');
  }

  function readForm() {
    const ed = state.editing;
    const val = id => { const el = document.getElementById(id); return el ? el.value : ''; };
    ed.draft.name = val('fp-f-name').trim();
    if (ed.kind === 'ref') {
      ed.draft.latText = val('fp-f-lat').trim();
      ed.draft.lngText = val('fp-f-lng').trim();
    } else {
      ed.draft.lastGrazed = val('fp-f-grazed').trim();
      ed.draft.notes = val('fp-f-notes').trim().slice(0, 1000);
    }
    return {
      name: ed.draft.name, lat: parseCoord(ed.draft.latText), lng: parseCoord(ed.draft.lngText),
      status: ed.draft.status, lastGrazed: ed.draft.lastGrazed, notes: ed.draft.notes
    };
  }

  function validate(kind, f) {
    if (!f.name) return { field: 'fp-f-name', msg: kind === 'ref' ? 'Give this reference point a name.' : 'Give this paddock a name.' };
    if (kind !== 'ref') {
      if (f.lastGrazed && daysSince(f.lastGrazed) === null) return { field: 'fp-f-grazed', msg: 'That date isn’t valid.' };
      if (f.lastGrazed && daysSince(f.lastGrazed) < 0) return { field: 'fp-f-grazed', msg: 'Last grazed can’t be in the future.' };
      return null;
    }
    if (f.lat.invalid || (f.lat.value !== undefined && Math.abs(f.lat.value) > 90)) {
      return { field: 'fp-f-lat', msg: 'Latitude must be a number between -90 and 90.' };
    }
    if (f.lng.invalid || (f.lng.value !== undefined && Math.abs(f.lng.value) > 180)) {
      return { field: 'fp-f-lng', msg: 'Longitude must be a number between -180 and 180.' };
    }
    if (!!f.lat.empty !== !!f.lng.empty) {
      return { field: f.lat.empty ? 'fp-f-lat' : 'fp-f-lng', msg: 'Enter both latitude and longitude, or leave both empty to add them later.' };
    }
    return null;
  }

  function showFormError(err) {
    const box = document.getElementById('fp-f-error');
    if (box) box.textContent = err ? err.msg : '';
    ['fp-f-name', 'fp-f-lat', 'fp-f-lng', 'fp-f-grazed'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.setAttribute('aria-invalid', String(!!err && err.field === id));
    });
    if (err) { const el = document.getElementById(err.field); if (el) el.focus(); }
  }

  function saveEditor() {
    const ed = state.editing;
    if (!ed) return;
    const f = readForm();
    const err = validate(ed.kind, f);
    showFormError(err);
    if (err) return;

    const prevStatus = state.calib.status;
    let item;
    if (ed.isNew) {
      item = { id: newId(ed.kind), name: f.name, u: ed.draft.u, v: ed.draft.v };
      listFor(ed.kind).push(item);
    } else {
      item = findItem(ed.kind, ed.id);
      if (!item) { closeSheet(); return; }
      item.name = f.name;
    }
    if (ed.kind === 'ref') {
      item.lat = f.lat.empty ? null : f.lat.value;
      item.lng = f.lng.empty ? null : f.lng.value;
    } else {
      item.status = f.status;
      item.lastGrazed = f.lastGrazed;
      item.notes = f.notes;
    }
    if (ed.isNew) ensureVisible(ed.kind);

    persist();
    state.editing = null;
    hideSheet();
    afterDataChange();

    if (ed.kind === 'ref' && hasGps(item)) {
      const farm = state.farm;
      if (farm && Number.isFinite(farm.lat) && Number.isFinite(farm.lng)) {
        const km = distanceKm(farm, item);
        if (km > FAR_FROM_FARM_KM) { toast(`Check coords: ${Math.round(km)} km from farm`); return; }
      }
      if (prevStatus !== 'ok' && state.calib.status === 'ok') return; // afterDataChange already said so
    }
    toast(ed.isNew ? (ed.kind === 'ref' ? 'Reference point placed' : 'Paddock placed') : 'Saved');
  }

  function deleteEditing() {
    const ed = state.editing;
    if (!ed || ed.isNew) return;
    const item = findItem(ed.kind, ed.id);
    if (!item) return;
    const isRef = ed.kind === 'ref';
    confirmAction(
      `Delete “${item.name}”?`,
      isRef ? 'This point will no longer be used to align the plan with the satellite map.'
            : 'The marker will be removed from the plan and the satellite map.',
      'Delete',
      () => {
        const list = listFor(ed.kind);
        const i = list.findIndex(x => x.id === item.id);
        if (i >= 0) list.splice(i, 1);
        persist();
        closeSheet();
        afterDataChange();
        toast(isRef ? 'Reference point deleted' : 'Paddock deleted');
      }
    );
  }

  /* ---------------------------------------------------------------------
     PICKING A REFERENCE POINT'S GPS ON THE SATELLITE IMAGE
     (optional helper — typing the coordinates stays the main way)
  --------------------------------------------------------------------- */
  function startPick() {
    if (!state.editing) return;
    readForm();
    state.pick = true;
    state.needsFit = true;
    hideSheet();
    renderModeUi();
    renderMap();
  }

  function finishPick(latlng) {
    const ed = state.editing;
    state.pick = false;
    if (ed) {
      ed.draft.latText = latlng.lat.toFixed(7);
      ed.draft.lngText = wrapLng(latlng.lng).toFixed(7);
    }
    renderModeUi();
    refreshMap();
    renderBanner();
    if (ed) { showSheet(); toast('Filled from map — check & save'); }
  }

  function cancelPick(reopen) {
    if (!state.pick) return;
    state.pick = false;
    renderModeUi();
    refreshMap();
    renderBanner();
    if (reopen && state.editing) showSheet();
  }

  /* ---------------------------------------------------------------------
     STATUS BANNER (only shown when there is something to say)
  --------------------------------------------------------------------- */
  function renderBanner(offline) {
    const c = state.calib, b = els.banner;
    let tone = 'info', html = '';
    if (offline) {
      tone = 'warn';
      html = `<span>The map couldn’t load. Check your connection.</span><button type="button" class="card-btn" id="fp-sat-retry">Try again</button>`;
    } else if (state.pick) {
      tone = 'pick';
      const name = state.editing ? state.editing.draft.name : 'this point';
      html = `<span>Tap the exact spot of “${esc(name)}” on the satellite image. Zoom right in for accuracy.</span><button type="button" class="card-btn" id="fp-pick-cancel">Cancel</button>`;
    } else if (c.status === 'ok' && c.warnings.includes('mirror')) {
      tone = 'warn';
      html = 'The plan fits badly: a latitude and longitude may have been swapped. See the list below.';
    }
    b.hidden = !html;
    b.className = 'fp-banner ' + tone;
    b.innerHTML = html;
  }

  /* ---------------------------------------------------------------------
     THE MAP
  --------------------------------------------------------------------- */
  const refreshMap = () => { if (state.map && isOverlayOpen() && state.data.image) drawMapLayers(); };

  async function renderMap() {
    renderBanner();
    try { await ensureLeaflet(); } catch (_) { renderBanner(true); return; }
    if (!isOverlayOpen() || !state.data.image) return;
    if (!state.map) createMap();
    state.map.invalidateSize();
    drawMapLayers();
    if (isAligned() && state.source === 's2') applySource();
  }

  function createMap() {
    const L = window.L;
    const f = state.farm;
    const hasCenter = f && Number.isFinite(f.lat) && Number.isFinite(f.lng);
    const map = L.map(els.map, { zoomControl: true, attributionControl: true, maxZoom: 21 })
      .setView(hasCenter ? [f.lat, f.lng] : [0, 0], 16);
    state.esriLayer = L.tileLayer(ESRI_URL, { maxZoom: 21, maxNativeZoom: 19, attribution: ESRI_ATTRIB });
    state.tiles = state.esriLayer;
    const pane = map.createPane('fpPlanPane');
    pane.style.zIndex = 350;              // above satellite tiles (200), below lines (400)
    pane.style.pointerEvents = 'none';    // taps go through to the map
    state.mapLayer = L.layerGroup().addTo(map);
    map.on('click', onMapClick);
    map.on('moveend', () => {
      if (state.map.hasLayer(state.tiles) && (state.tiles === state.esriLayer)) scheduleImageryInfo();
    });
    map.on('zoomend', () => updatePaddockZoomClass(map));
    updatePaddockZoomClass(map); // set the right size immediately for the opening view too
    state.map = map;
  }

  // Paddock pins are the big name+status pill at close zoom, but shrink to
  // a plain colour dot once zoomed out far enough that a whole plan's worth
  // of pills would just overlap into an unreadable mess.
  const PADDOCK_PIN_SHRINK_ZOOM = 17;
  function updatePaddockZoomClass(map) {
    map.getContainer().classList.toggle('fp-zoom-far', map.getZoom() < PADDOCK_PIN_SHRINK_ZOOM);
  }

  function onMapClick(e) {
    if (state.pick) { finishPick(e.latlng); return; }
    if (state.editing || !state.geo) return;
    const pl = state.geo.toPlan(e.latlng.lat, wrapLng(e.latlng.lng));
    if (pl.u < 0 || pl.u > 1 || pl.v < 0 || pl.v > 1) { toast('Tap inside the plan'); return; }
    startCreate(pl.u, pl.v);
  }

  function divIcon(html, extraClass) {
    return window.L.divIcon({
      className: 'fp-leaflet-icon' + (extraClass ? ' ' + extraClass : ''),
      html,
      iconSize: [44, 44],
      iconAnchor: [22, 22]
    });
  }

  /** Large paddock badge: tinted halo + pill with the name and days since grazed. */
  function paddockIcon(p, pending) {
    const st = statusOf(p.status);
    const days = daysSince(p.lastGrazed);
    const sub = days === null ? '' : `<span class="fp-pd-sub">${days <= 0 ? 'grazed today' : `grazed ${days}d ago`}</span>`;
    const html =
      `<span class="fp-pd" style="--st:${st.color};--st-text:${st.text}">` +
      `<span class="fp-pd-halo" aria-hidden="true"></span>` +
      `<span class="fp-pd-pill"><span class="fp-pd-name">${esc(p.name)}</span>${sub}</span></span>`;
    return window.L.divIcon({
      className: 'fp-leaflet-icon fp-pd-icon' + (pending ? ' fp-pending' : ''),
      html, iconSize: [96, 96], iconAnchor: [48, 48]
    });
  }

  function drawMapLayers() {
    const L = window.L, map = state.map, layer = state.mapLayer, g = state.geo, d = state.data;
    if (!L || !map || !g) return;
    layer.clearLayers();
    syncPlanOverlay();
    els.map.classList.toggle('picking', state.pick);
    const aligned = isAligned();
    const interactive = !state.pick;
    const yellow = cssVar('--accent-yellow', YELLOW_FALLBACK);
    const toLL = (u, v) => { const p = g.toGPS(u, v); return L.latLng(p.lat, p.lng); };
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => toLL(u, v));

    L.polygon(corners, { color: '#ffffff', opacity: 0.7, weight: 1.5, dashArray: '4 6', fill: false, interactive: false }).addTo(layer);

    // Paddocks: big status-coloured badge
    if (state.showPaddocks) d.paddocks.forEach(p => {
      const m = L.marker(toLL(p.u, p.v), {
        icon: paddockIcon(p, false),
        draggable: interactive, interactive, keyboard: interactive,
        title: `${p.name}: ${statusOf(p.status).label}`
      });
      m.on('click', () => { if (!state.pick && !state.editing) openEditor('paddock', p.id); });
      m.on('dragend', () => onMapDrag('paddock', p.id, m.getLatLng()));
      m.addTo(layer);
    });

    // Reference points
    if (state.showRefs) d.refs.forEach(r => {
      const onPlan = toLL(r.u, r.v);
      const showGps = aligned && hasGps(r);
      let line = null;
      if (showGps) {
        // Fixed GPS position + dashed line to where the plan puts the point.
        const gpsLL = L.latLng(r.lat, r.lng);
        line = L.polyline([onPlan, gpsLL], { color: yellow, weight: 2, dashArray: '4 5', interactive: false }).addTo(layer);
        const fixed = L.marker(gpsLL, {
          icon: divIcon(pinHtml('ref', r.name, false)), interactive, keyboard: false,
          title: `${r.name} (GPS)`, zIndexOffset: 100
        });
        fixed.on('click', () => { if (!state.pick && !state.editing) openEditor('ref', r.id); });
        fixed.addTo(layer);
      }
      // Position on the plan photo (draggable). Before alignment it is the
      // only marker, so it shows the name and whether GPS is filled in.
      const planHtml = aligned
        ? `<span class="fp-pin ref onplan${hasGps(r) ? '' : ' nogps'}" aria-hidden="true"></span>` +
          (showGps ? '' : `<span class="fp-label" aria-hidden="true">${esc(r.name)}</span>`)
        : pinHtml('ref', r.name, !hasGps(r));
      const handle = L.marker(onPlan, {
        icon: divIcon(planHtml), draggable: interactive, interactive, keyboard: interactive,
        title: aligned ? `${r.name} (position on plan)` : r.name, zIndexOffset: 200
      });
      handle.on('drag', () => { if (line) line.setLatLngs([handle.getLatLng(), line.getLatLngs()[1]]); });
      handle.on('dragend', () => onMapDrag('ref', r.id, handle.getLatLng()));
      handle.on('click', () => { if (!state.pick && !state.editing) openEditor('ref', r.id); });
      handle.addTo(layer);
    });

    // New item being named in the sheet
    const ed = state.editing;
    if (ed && ed.isNew) {
      L.marker(toLL(ed.draft.u, ed.draft.v), {
        icon: ed.kind === 'paddock'
          ? paddockIcon({ name: ed.draft.name, status: ed.draft.status, lastGrazed: ed.draft.lastGrazed }, true)
          : divIcon(pinHtml(ed.kind, ed.draft.name, true), 'fp-pending'),
        interactive: false, keyboard: false, zIndexOffset: 500
      }).addTo(layer);
    }

    applyOpacity();
    if (state.needsFit) { fitMap(corners); state.needsFit = false; }
  }

  /**
   * Bounds to frame: the paddocks' own footprint once there are some
   * (so the view centres on what matters), else the whole plan.
   */
  function focusBounds(corners) {
    const L = window.L, pads = state.data.paddocks;
    if (pads.length) return L.latLngBounds(pads.map(p => { const g = state.geo.toGPS(p.u, p.v); return L.latLng(g.lat, g.lng); }));
    // No paddocks placed yet: zoom to a smaller region centred on the plan
    // (paddock-sized, ~35% of the full extent) rather than the whole farm —
    // once paddocks exist they take over via the branch above.
    const c = state.calib;
    const half = 0.175;
    const zoomedCorners = [[0.5 - half, 0.5 - half], [0.5 + half, 0.5 - half], [0.5 + half, 0.5 + half], [0.5 - half, 0.5 + half]]
      .map(([u, v]) => { const g = c.toGPS(u, v); return L.latLng(g.lat, g.lng); });
    return L.latLngBounds(zoomedCorners);
  }

  function fitMap(corners) {
    const map = state.map, ed = state.editing;
    if (state.pick && ed) {
      const lat = parseCoord(ed.draft.latText), lng = parseCoord(ed.draft.lngText);
      if (lat.value !== undefined && lng.value !== undefined) { map.setView([lat.value, lng.value], 18); return; }
      if (isAligned()) { const p = state.geo.toGPS(ed.draft.u, ed.draft.v); map.setView([p.lat, p.lng], 18); return; }
      const f = state.farm;
      if (f && Number.isFinite(f.lat) && Number.isFinite(f.lng)) { map.setView([f.lat, f.lng], 16); return; }
    }
    // Opening view: centred on the paddocks (or the whole plan if there are
    // none yet), zoomed in close. Generous pixel padding around the paddocks
    // themselves keeps a lone paddock from being zoomed in to the max.
    const bounds = focusBounds(corners);
    const hasPaddocks = state.data.paddocks.length > 0;
    const z = Math.min(map.getBoundsZoom(bounds, false, window.L.point(hasPaddocks ? 140 : 24, hasPaddocks ? 140 : 24)), 20);
    map.setView(bounds.getCenter(), z);
  }

  /* ---------------------------------------------------------------------
     SATELLITE IMAGE DATE
     World Imagery is a mosaic: each patch has its own capture date. We
     ask Esri which patch is under the centre of the map, at the zoom
     level being displayed, whenever the map stops moving.
  --------------------------------------------------------------------- */
  let imgInfoTimer = null;
  let imgInfoSeq = 0;

  function scheduleImageryInfo() {
    clearTimeout(imgInfoTimer);
    imgInfoTimer = setTimeout(fetchImageryInfo, 400);
  }

  async function fetchImageryInfo() {
    const map = state.map;
    if (!map || !isOverlayOpen() || (state.calib.status !== 'ok' && !state.pick)) { renderImageryInfo(null); return; }
    const seq = ++imgInfoSeq;
    const center = map.getCenter();
    const zoom = Math.min(Math.round(map.getZoom()), 19); // 19 = deepest real imagery level
    const b = map.getBounds(), size = map.getSize();
    const params = new URLSearchParams({
      geometry: `${wrapLng(center.lng)},${center.lat}`,
      geometryType: 'esriGeometryPoint',
      sr: '4326',
      layers: ESRI_META_LAYERS,
      tolerance: '0',
      mapExtent: `${wrapLng(b.getWest())},${b.getSouth()},${wrapLng(b.getEast())},${b.getNorth()}`,
      imageDisplay: `${size.x},${size.y},96`,
      returnGeometry: 'false',
      f: 'json'
    });
    try {
      const res = await fetch(`${ESRI_MAPSERVER}/identify?${params}`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      if (seq !== imgInfoSeq) return; // the map moved again meanwhile
      renderImageryInfo(pickImagery(json.results || [], zoom));
    } catch (_) {
      if (seq === imgInfoSeq) renderImageryInfo(null);
    }
  }

  const numOrNaN = x => (x === null || x === undefined || x === '' || x === 'Null' ? NaN : Number(x));

  function parseImageryDate(a) {
    const s = String(a.SRC_DATE ?? '').replace(/\D/g, ''); // YYYYMMDD
    if (s.length === 8) return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)));
    const d2 = a.SRC_DATE2;
    if (d2 === null || d2 === undefined || d2 === 'Null') return null;
    const t = typeof d2 === 'number' ? d2 : Date.parse(d2);
    return Number.isFinite(t) ? new Date(t) : null;
  }

  /** Of the patches found at that point, keep the one drawn at this zoom level. */
  function pickImagery(results, zoom) {
    const feats = results.map(r => r.attributes || {}).filter(a => parseImageryDate(a));
    if (!feats.length) return null;
    const inRange = feats.filter(a => {
      const mn = numOrNaN(a.MinMapLevel), mx = numOrNaN(a.MaxMapLevel);
      return mn <= zoom && zoom <= mx;
    });
    const pool = (inRange.length ? inRange : feats).slice()
      .sort((x, y) => (numOrNaN(x.SRC_RES) || 1e9) - (numOrNaN(y.SRC_RES) || 1e9)); // finest first
    const a = pool[0];
    return {
      date: parseImageryDate(a),
      source: String(a.NICE_DESC || a.SRC_DESC || '').trim(),
      resM: numOrNaN(a.SRC_RES),
      accM: numOrNaN(a.SRC_ACC)
    };
  }

  function renderImageryInfo(info) {
    const el = els.imgDate;
    if (!info || !info.date) { el.hidden = true; el.textContent = ''; return; }
    const date = info.date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    el.innerHTML = `<i class="ti ti-calendar" aria-hidden="true"></i><span>${esc(info.label || 'Satellite image')}: <strong>${esc(date)}</strong></span>`;
    el.hidden = false;
  }

  /* ---------------------------------------------------------------------
     IMAGERY SOURCE: Esri (detailed, older) or Sentinel-2 via DEA (recent)
  --------------------------------------------------------------------- */
  function setSource(src) {
    if (src === state.source) return;
    state.source = src;
    savePrefs();
    if (state.satAmount === 0) { state.satAmount = 1; els.poRange.value = '100'; } // show what was just picked
    renderSourceUi();
    applySource();
    applyPreviewSource(); // same choice, so the dashboard-card preview follows too
  }


  function renderSourceUi() {
    els.srcBtns.forEach(b => b.setAttribute('aria-checked', String(b.dataset.src === state.source)));
    els.s2Box.hidden = state.source !== 's2';
    if (state.source !== 's2') return;
    const passes = state.s2Passes;
    els.s2Note.textContent = '';
    if (passes === null) {
      els.s2Date.textContent = 'Loading…';
    } else if (!passes.length) {
      els.s2Date.textContent = '';
      els.s2Note.textContent = state.s2Error || `No satellite pass over the farm in the last ${S2_DAYS_BACK} days.`;
    } else {
      const picked = passes.find(p => p.date === state.s2Date) || passes[0];
      const cloud = picked && Number.isFinite(picked.cloud) ? `, ${Math.round(picked.cloud)}% cloud` : '';
      els.s2Date.textContent = picked ? `${fmtDateAU(picked.date)}${cloud}` : '';
    }
  }

  /** Same idea as applySource(), for the small preview map on the dashboard card. */
  function applyPreviewSource() {
    const map = state.pmap;
    if (!map || !window.L) return;
    let key = 'esri';
    if (state.source === 's2') {
      const fkey = farmKey(state.farm || { id: '' });
      if (state.s2PassesFor !== fkey) loadS2Passes(fkey); // async; renderCard() re-runs this once loaded
      else if (state.s2Date) key = 's2:' + state.s2Date;
      // else: no pass found — falls back to Esri below
    }
    if (key === state.pTileKey) return;
    if (state.pTiles && map.hasLayer(state.pTiles)) map.removeLayer(state.pTiles);
    state.pTiles = key.startsWith('s2:')
      ? makeS2Layer(state.s2Date, s2LayerCachePreview)
      : window.L.tileLayer(ESRI_URL, { maxZoom: 21, maxNativeZoom: 19, attribution: 'Tiles &copy; Esri' });
    state.pTiles.addTo(map);
    state.pTileKey = key;
  }

  /** Puts the right satellite layer on the map for the current source/style/date. */
  function applySource() {
    const map = state.map;
    if (!map || !window.L) { applyOpacity(); return; }
    let layer = state.esriLayer;
    if (state.source === 's2' && isAligned() && !state.pick) { // picking GPS: detailed image is better
      const key = farmKey(state.farm || { id: '' });
      if (state.s2PassesFor !== key) { loadS2Passes(key); layer = null; }
      else if (state.s2Date) layer = makeS2Layer(state.s2Date, s2LayerCacheMain);
      else layer = null;
    }
    if (layer === state.tiles) { applyOpacity(); return; }
    if (state.tiles && map.hasLayer(state.tiles)) map.removeLayer(state.tiles);
    state.tiles = layer || state.esriLayer;
    if (!layer && state.source === 's2') {
      // Passes still loading (or none): keep Esri underneath meanwhile.
      state.tiles = state.esriLayer;
    }
    applyOpacity();
  }

  const s2LayerCacheMain = { key: '', layer: null };
  const s2LayerCachePreview = { key: '', layer: null };
  function makeS2Layer(date, cache) {
    const key = date;
    if (cache.key === key) return cache.layer;
    const layer = window.L.tileLayer.wms(DEA_WMS, {
      layers: DEA_LAYER,
      styles: DEA_STYLE,
      format: 'image/png',
      transparent: true,
      version: '1.3.0',
      time: date,
      maxZoom: 21,
      maxNativeZoom: 16,        // 10 m data: no point asking the server for finer tiles
      attribution: DEA_ATTRIB
    });
    let warned = false;
    layer.on('tileerror', () => {
      if (warned) return;
      warned = true;
      toast('Sentinel-2 image not loading');
    });
    cache.key = key; cache.layer = layer;
    return layer;
  }

  /** Lists Sentinel-2 passes over the farm (last S2_DAYS_BACK days), newest first. */
  async function loadS2Passes(key) {
    if (state.s2Loading === key) return;
    state.s2Loading = key;
    state.s2Passes = null;
    state.s2Error = '';
    renderSourceUi();
    const g = state.geo;
    const corners = g ? [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => g.toGPS(u, v)) : [];
    const lats = corners.map(c => c.lat), lngs = corners.map(c => c.lng);
    const bbox = corners.length
      ? [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)]
      : [state.farm.lng - 0.01, state.farm.lat - 0.01, state.farm.lng + 0.01, state.farm.lat + 0.01];
    const lngMid = (bbox[0] + bbox[2]) / 2;
    const end = new Date(), start = new Date(end.getTime() - S2_DAYS_BACK * 864e5);
    const params = new URLSearchParams({
      collections: DEA_S2_COLLECTIONS,
      bbox: bbox.map(x => x.toFixed(5)).join(','),
      datetime: `${start.toISOString().slice(0, 10)}T00:00:00Z/${end.toISOString().slice(0, 10)}T23:59:59Z`,
      limit: '200'
    });
    let passes = [];
    try {
      const res = await fetch(`${DEA_STAC}?${params}`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      const byDate = new Map();
      (json.features || []).forEach(f => {
        const pr = f.properties || {};
        const t = Date.parse(pr.datetime);
        if (!Number.isFinite(t)) return;
        // DEA groups images by local "solar day" (the pass is ~10:30 local time,
        // i.e. the previous day in UTC), so shift by longitude before taking the date.
        const date = new Date(t + (lngMid / 15) * 3600e3).toISOString().slice(0, 10);
        const cloud = Number(pr['eo:cloud_cover']);
        const prev = byDate.get(date);
        if (!prev || (Number.isFinite(cloud) && !(prev.cloud <= cloud))) byDate.set(date, { date, cloud: Number.isFinite(cloud) ? cloud : NaN });
      });
      passes = [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
    } catch (_) {
      state.s2Error = 'Couldn’t get the list of satellite passes. Check your connection.';
    }
    if (state.s2Loading !== key) return; // farm changed meanwhile
    state.s2Loading = '';
    state.s2Passes = passes;
    state.s2PassesFor = key;
    const clear = passes.find(p => Number.isFinite(p.cloud) && p.cloud <= S2_MAX_CLOUD_DEFAULT);
    state.s2Date = (clear || passes[0] || { date: '' }).date;
    renderSourceUi();
    applySource();
    renderCard(); // the preview may be waiting on the same passes
  }

  /* ---------------------------------------------------------------------
     PLAN PHOTO OVER THE SATELLITE MAP
     Leaflet's own ImageOverlay only handles north-up rectangles, but the
     plan is usually rotated. This small custom layer projects three
     corners of the photo (via the alignment) to screen points and
     applies the matching CSS matrix().
  --------------------------------------------------------------------- */
  let PlanOverlayClass = null;
  function getPlanOverlayClass() {
    if (PlanOverlayClass) return PlanOverlayClass;
    const L = window.L;
    PlanOverlayClass = L.Layer.extend({
      options: { pane: 'fpPlanPane' },
      initialize(opts) { this._o = opts; },
      onAdd() {
        const img = this._img = L.DomUtil.create('img', 'fp-plan-overlay leaflet-zoom-animated');
        img.alt = '';
        img.draggable = false;
        this.getPane().appendChild(img);
        this._sync();
      },
      onRemove() { L.DomUtil.remove(this._img); this._img = null; },
      getEvents() {
        const ev = { zoom: this._reset, viewreset: this._reset };
        if (this._zoomAnimated) ev.zoomanim = this._animateZoom;
        return ev;
      },
      update(opts) { this._o = opts; if (this._img) this._sync(); },
      setOpacity(o) {
        this._o.opacity = o;
        if (this._img) { this._img.style.opacity = o; this._img.style.visibility = o > 0 ? '' : 'hidden'; }
      },
      _sync() {
        const o = this._o, img = this._img;
        if (img.getAttribute('src') !== o.url) img.src = o.url;
        img.style.width = o.w + 'px';
        img.style.height = o.h + 'px';
        this.setOpacity(o.opacity);
        // top-left, top-right, bottom-left corners of the photo
        this._corners = [[0, 0], [1, 0], [0, 1]].map(([u, v]) => {
          const g = o.toGPS(u, v);
          return L.latLng(g.lat, g.lng);
        });
        this._reset();
      },
      _apply(p) {
        const o = this._o;
        const a = (p[1].x - p[0].x) / o.w, b = (p[1].y - p[0].y) / o.w;
        const c = (p[2].x - p[0].x) / o.h, d = (p[2].y - p[0].y) / o.h;
        this._img.style.transform = `matrix(${a}, ${b}, ${c}, ${d}, ${p[0].x}, ${p[0].y})`;
      },
      _reset() {
        if (!this._img) return;
        this._apply(this._corners.map(ll => this._map.latLngToLayerPoint(ll)));
      },
      _animateZoom(e) {
        if (!this._img || typeof this._map._latLngToNewLayerPoint !== 'function') return;
        this._apply(this._corners.map(ll => this._map._latLngToNewLayerPoint(ll, e.zoom, e.center)));
      }
    });
    return PlanOverlayClass;
  }

  function syncPlanOverlay() {
    const g = state.geo, d = state.data, map = state.map;
    if (!g || !d.image || !state.imgUrl) {
      if (state.planLayer) { map.removeLayer(state.planLayer); state.planLayer = null; }
      return;
    }
    const opts = { url: state.imgUrl, w: d.imgW, h: d.imgH, toGPS: g.toGPS, opacity: 1 };
    if (state.planLayer) state.planLayer.update(opts);
    else state.planLayer = new (getPlanOverlayClass())(opts).addTo(map);
  }

  /**
   * Paddock or reference point dragged on the map -> new position on the
   * plan photo (inverse transform, as it was when the drag started). GPS
   * coordinates are never changed here. For a reference point on an
   * aligned plan, the plan is then re-fitted.
   */
  function onMapDrag(kind, id, latlng) {
    const g = state.geo, item = findItem(kind, id);
    if (!item || !g) return;
    const wasAligned = isAligned();
    const pl = g.toPlan(latlng.lat, wrapLng(latlng.lng));
    const outside = pl.u < 0 || pl.u > 1 || pl.v < 0 || pl.v > 1;
    item.u = clamp01(pl.u);
    item.v = clamp01(pl.v);
    persist();
    afterDataChange();
    if (outside) toast('Moved back to plan edge');
    else if (kind === 'ref' && wasAligned && isAligned()) toast(`Plan re-aligned ±${fmtM(state.calib.rms)}`);
  }

  /* ---------------------------------------------------------------------
     PUBLIC READ-ONLY API for other tiles
  --------------------------------------------------------------------- */
  const api = {
    /** Active farm's paddocks, with lat/lng when the plan is aligned. */
    getPaddocks() {
      const c = state.calib;
      return state.data.paddocks.map(p => {
        const out = {
          id: p.id, name: p.name,
          status: p.status, statusLabel: statusOf(p.status).label,
          lastGrazed: p.lastGrazed || null, daysSinceGrazed: daysSince(p.lastGrazed), notes: p.notes
        };
        if (c.status === 'ok') Object.assign(out, c.toGPS(p.u, p.v));
        return out;
      });
    },
    getCalibrationStatus() {
      const c = state.calib;
      return { status: c.status, refsWithGps: c.n, rmsMetres: c.status === 'ok' ? c.rms : null };
    },
    computeCalibration
  };

  /* ---------------------------------------------------------------------
     REGISTER
  --------------------------------------------------------------------- */
  if (typeof FarmSmart === 'undefined' || typeof FarmSmart.registerTile !== 'function') { // eslint-disable-line no-undef
    console.error('[farm-plan] FarmSmart.registerTile not found — load core.js before this tile.');
    return;
  }
  FarmSmart.farmPlan = api;                                     // eslint-disable-line no-undef
  FarmSmart.registerTile({ id: TILE_ID, html: TILE_HTML, init }); // eslint-disable-line no-undef
})();
