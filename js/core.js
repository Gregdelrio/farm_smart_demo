/* =====================================================================
   FARMSMART — CORE
   ---------------------------------------------------------------------
   This file is the "shell": everything every tile can rely on, but no
   tile-specific logic. Tiles never talk to each other directly — they
   only use what's defined here (FarmSmart.registerTile, showToast,
   openConfirm, etc). That's what keeps each tile file independent and
   safe to add/remove on its own (see README.md "Enabling/disabling a
   tile").

   Sections:
     1. FarmSmart namespace + tile registry (the module system)
     2. Farm data + farm switcher
     3. User data + user switcher (role-based access is NOT implemented
        yet — see the TODO in section 3)
     4. Generic confirmation dialog (neutral, not a red warning)
     5. Toast helper
     6. Online/offline status
     7. Boot — mounts every registered tile once the page has loaded
   ===================================================================== */

/* ---------------------------------------------------------------------
   1. FARMSMART NAMESPACE + TILE REGISTRY
   ---------------------------------------------------------------------
   HOW THE MODULE SYSTEM WORKS:
   Each tile file (js/tiles/xxx.js) calls FarmSmart.registerTile({...})
   when it loads. That just pushes the tile's definition into an array
   — nothing appears on screen yet. Once the whole page has finished
   loading, mountTiles() (section 7) walks that array *in the order the
   tiles were registered* (i.e. the order their <script> tags appear in
   index.html) and:
     1. Injects the tile's HTML string into the #dashboard container.
     2. Calls the tile's init() function, which wires up its buttons.

   This means a tile is a completely self-contained unit: its markup,
   its styles (its own css/tiles/xxx.css file), and its behavior (its
   own js/tiles/xxx.js file) all live together. To remove a tile from
   the app, you only ever touch index.html — comment out its <link>
   and <script> tags and it's gone, without editing this file or any
   other tile.
--------------------------------------------------------------------- */
window.FarmSmart = window.FarmSmart || { tiles: [] };

/**
 * Called by each tile file to register itself.
 * @param {Object} tile
 * @param {string} tile.id     - unique id, e.g. 'vat'
 * @param {string} tile.html   - the tile's full <div class="card">...</div> markup
 * @param {Function} [tile.init] - runs once the markup is in the DOM;
 *                                  attach event listeners here
 */
FarmSmart.registerTile = function (tile) {
  FarmSmart.tiles.push(tile);
};

/* ---------------------------------------------------------------------
   2. FARM DATA + FARM SWITCHER
   Single source of truth for the farm list — add/remove a farm here
   and the switcher sheet re-renders itself, no HTML edits needed.
--------------------------------------------------------------------- */
const FARMS = [
  { id: 'laang',    name: 'Laang Farm',           meta: 'Dairy - Peter',  ownerFirstName: 'Peter',  herdSize: 355, roadName: 'Thorburns Road' },
  { id: 'maguires', name: 'Maguires Road Dairy',  meta: 'Dairy - John',   ownerFirstName: 'John',   herdSize: 557, roadName: 'Maguires Road' },
  { id: 'vickers',  name: 'Vickers Road Panmure', meta: 'Dairy - Damian', ownerFirstName: 'Damian', herdSize: 992, roadName: 'Vickers Road' },
  // Add further farms here as plain objects — the switcher sheet in
  // js/core.js §2 renders straight from this array, so nothing else
  // needs to change. `herdSize`/`ownerFirstName` are used by the Live
  // Milking tile, `roadName` by the Road Crossing tile.
];
FarmSmart.activeFarmId = 'maguires'; // default farm shown when the app first loads
FarmSmart.getActiveFarm = function () {
  return FARMS.find((f) => f.id === FarmSmart.activeFarmId);
};

function renderFarmList() {
  const list = document.getElementById('farmList');
  list.innerHTML = '';
  FARMS.forEach((farm) => {
    const row = document.createElement('button');
    row.className = 'sheet-row' + (farm.id === FarmSmart.activeFarmId ? ' active' : '');
    row.innerHTML = `<span class="sheet-row__title">${farm.name}</span><span class="sheet-row__meta">${farm.meta}</span>`;
    row.onclick = () => onFarmTapped(farm);
    list.appendChild(row);
  });
}

function openFarmSheet() {
  renderFarmList();
  document.getElementById('farmSheetMask').classList.add('show');
}
function closeFarmSheet() {
  document.getElementById('farmSheetMask').classList.remove('show');
}
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('farmSheetMask').addEventListener('click', (e) => {
    if (e.target.id === 'farmSheetMask') closeFarmSheet();
  });
});


function onFarmTapped(farm) {
  closeFarmSheet();
  if (farm.id === FarmSmart.activeFarmId) return; // already active, nothing to confirm

  openConfirm(
    'Switch farm?',
    `You're about to switch to "${farm.name}". Any open screens will reload with data for this farm.`,
    'Yes, switch farm',
    () => {
      FarmSmart.activeFarmId = farm.id;
      document.getElementById('activeFarmName').textContent = farm.name;
      showToast('Switched to ' + farm.name);
      // Let any tile that depends on which farm is active (e.g. Live
      // Milking's herd size) know it should refresh itself.
      document.dispatchEvent(new CustomEvent('farmsmart:farmchanged', { detail: { farm } }));
    }
  );
}

/* ---------------------------------------------------------------------
   3. USER DATA + USER SWITCHER
   ---------------------------------------------------------------------
   TODO (role-based access): both users currently see and can do
   exactly the same things. Once it's decided what an Employee should
   NOT have access to, the place to enforce it is here:
     - FarmSmart.currentUser.role holds 'owner' or 'employee' at all
       times (updated by onUserTapped below).
     - A tile can check it, e.g. inside its init():
         if (FarmSmart.currentUser.role !== 'owner') {
           document.getElementById('someRestrictedButton').hidden = true;
         }
     - Or, simpler for many small restrictions at once: give any
       element that should be Owner-only a `data-requires-role="owner"`
       attribute, and add a loop here in mountTiles() (section 7) that
       hides every such element when the current user isn't an owner.
   Neither of those is wired up yet — this is just where it will go.
--------------------------------------------------------------------- */
const USERS = [
  { id: 'john', name: 'John', role: 'Owner', initials: 'J' },
  { id: 'greg', name: 'Greg', role: 'Employee', initials: 'G' },
];
FarmSmart.currentUser = USERS[0];

function renderUserList() {
  const list = document.getElementById('userList');
  list.innerHTML = '';
  USERS.forEach((user) => {
    const row = document.createElement('button');
    row.className = 'sheet-row' + (user.id === FarmSmart.currentUser.id ? ' active' : '');
    row.innerHTML = `<span class="sheet-row__title">${user.name}</span><span class="sheet-row__meta">${user.role}</span>`;
    row.onclick = () => onUserTapped(user);
    list.appendChild(row);
  });
}

function openUserSheet() {
  renderUserList();
  document.getElementById('userSheetMask').classList.add('show');
}
function closeUserSheet() {
  document.getElementById('userSheetMask').classList.remove('show');
}
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('userSheetMask').addEventListener('click', (e) => {
    if (e.target.id === 'userSheetMask') closeUserSheet();
  });
});

function onUserTapped(user) {
  closeUserSheet();
  if (user.id === FarmSmart.currentUser.id) return;

  // Switching who's using the app isn't a destructive action (unlike
  // switching farms, which reloads real data) — no confirmation step,
  // just switch and confirm with a toast.
  FarmSmart.currentUser = user;
  document.getElementById('activeUserInitials').textContent = user.initials;
  document.getElementById('activeUserName').textContent = user.name;
  document.getElementById('activeUserRole').textContent = user.role;
  showToast(`Now viewing as ${user.name} (${user.role})`);
  document.dispatchEvent(new CustomEvent('farmsmart:userchanged', { detail: { user } }));
}

/* ---------------------------------------------------------------------
   4. GENERIC CONFIRMATION DIALOG
   A plain "are you sure?" step — not a danger warning. Used before
   anything that would be annoying to trigger by accident (switching
   farms, starting the road crossing sequence, opening a gate early).
   Styled with the neutral yellow accent in css/base.css, never red —
   red is reserved for genuine problem states inside individual tiles
   (e.g. the vat temperature tile's own alert state).
--------------------------------------------------------------------- */
let pendingConfirmAction = null;

function openConfirm(title, message, confirmLabel, onConfirm) {
  document.getElementById('confirmTitle').textContent = title;
  const msgEl = document.getElementById('confirmMsg');
  msgEl.textContent = message;
  msgEl.style.display = message ? 'block' : 'none';
  document.getElementById('confirmOkBtn').textContent = confirmLabel;
  pendingConfirmAction = onConfirm;
  document.getElementById('confirmMask').classList.add('show');
}
function closeConfirm() {
  document.getElementById('confirmMask').classList.remove('show');
  pendingConfirmAction = null;
}
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('confirmOkBtn').addEventListener('click', () => {
    const action = pendingConfirmAction;
    closeConfirm();
    if (action) action();
  });
});

/* ---------------------------------------------------------------------
   5. TOAST HELPER
--------------------------------------------------------------------- */
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.remove('show'), 2400);
}

// Shared by any tile that shows a "Synced X min ago" indicator (Milk
// Vat, Live Milking) instead of a status badge — random 1-10, as a
// stand-in for a real "last synced" timestamp from a live sensor feed.
FarmSmart.randomSyncLabel = function () {
  const minutes = 1 + Math.floor(Math.random() * 10);
  return `Synced ${minutes} min ago`;
};

/* ---------------------------------------------------------------------
   6. VISITOR NOTIFICATIONS (ntfy.sh)
   ---------------------------------------------------------------------
   Sends a push notification to your phone every time someone opens the
   app, and a second one summarizing what they clicked when they leave.
   Also used directly by the "Share the app" button (see index.html).

   SETUP — do this once:
     1. Install the ntfy app: https://ntfy.sh/ (App Store / Play Store).
     2. Pick a private topic name only you know — long and hard to
        guess, since anyone who knows it can also read/send to it.
        Replace NTFY_TOPIC below with it.
     3. In the ntfy app, subscribe to that exact same topic name.
   That's it — no account, no API key.

   Every call here is wrapped so it can NEVER break the app: if ntfy.sh
   is blocked (ad blocker, offline, etc.), these just silently do
   nothing instead of throwing an error anywhere else in the app.
--------------------------------------------------------------------- */
const NTFY_TOPIC = 'farm-smart-visits-x203xxxcv45'; // <-- set this to your own private topic name

function sendNtfy(message, options) {
  options = options || {};
  try {
    fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
      method: 'POST',
      body: message,
      headers: {
        'Title': options.title || 'FarmSmart',
        'Tags': options.tags || 'farmer',
      },
    }).catch(() => {}); // network/blocked — fail silently, never break the app
  } catch (e) {
    // synchronous failure (e.g. fetch unavailable) — also fail silently
  }
}

// Used only for the click-summary sent as the page is closing — regular
// fetch() calls can get cancelled mid-flight when a tab closes, but
// sendBeacon() is specifically designed to reliably finish in that
// situation. It can't set custom headers (title/tags), so the "title"
// is just written as the first line of the message body instead.
function sendNtfyBeacon(message) {
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(`https://ntfy.sh/${NTFY_TOPIC}`, message);
    }
  } catch (e) {
    // fail silently
  }
}

function getDeviceLabel() {
  const ua = navigator.userAgent;
  let device = 'Unknown device';
  if (/iPad/.test(ua)) device = 'iPad';
  else if (/iPhone/.test(ua)) device = 'iPhone';
  else if (/Android/.test(ua)) device = 'Android';
  else if (/Macintosh/.test(ua)) device = 'Mac';
  else if (/Windows/.test(ua)) device = 'Windows PC';

  let browser = 'Unknown browser';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = 'Safari';

  return `${device} · ${browser}`;
}

// Filled in once the IP/location lookup below resolves, and reused by
// both the "opened" notification and the later click-summary/share
// notifications so they don't each need their own network request.
FarmSmart.visitorInfo = { ip: 'unknown', location: 'unknown', device: getDeviceLabel() };

function notifyAppOpened() {
  fetch('https://ipapi.co/json/')
    .then((res) => res.json())
    .then((data) => {
      FarmSmart.visitorInfo.ip = data.ip || 'unknown';
      FarmSmart.visitorInfo.location = [data.city, data.country_name].filter(Boolean).join(', ') || 'unknown';
    })
    .catch(() => {
      // Geolocation lookup failed/blocked — still send the notification
      // below with whatever we have, rather than not sending at all.
    })
    .finally(() => {
      const v = FarmSmart.visitorInfo;
      const message = `IP: ${v.ip}\nLocation: ${v.location}\nDevice: ${v.device}\nTime: ${new Date().toLocaleString()}`;
      sendNtfy(message, { title: '📍 FarmSmart opened', tags: 'farmer' });
    });
}

// ---- Click tracking: logs a short label for every button tapped
// during the visit, and sends one summary notification when the
// person leaves (not one notification per click — that would be way
// too noisy). Works automatically for any button with visible text or
// an aria-label; give an element data-track="..." to override the
// label, or data-track="skip" to exclude a very noisy element (like
// the wheel picker's individual value rows) from being logged. ----
FarmSmart.sessionClicks = [];

// Friendly names for the ntfy click summary — keyed by each tile's
// registerTile({id}). Falls back to the raw id for any tile added
// later and not listed here.
const TILE_DISPLAY_NAMES = {
  vat: 'Milk Vat',
  crossing: 'Road Crossing',
  milking: 'Live Milking',
  'milk-statement': 'Milk Statement',
  gates: 'Gates',
  roster: 'Roster',
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('button, .farm-picker, .user-picker, .sheet-row');
  if (!el) return;
  if (el.classList.contains('wheel-item') || el.dataset.track === 'skip') return;

  const label = el.dataset.track || el.getAttribute('aria-label') || el.textContent.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!label) return;

  const tileEl = el.closest('[data-tile-name]');
  const tileName = tileEl ? (TILE_DISPLAY_NAMES[tileEl.dataset.tileName] || tileEl.dataset.tileName) : null;
  FarmSmart.sessionClicks.push(tileName ? `${tileName}: ${label}` : label);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden' || FarmSmart.sessionClicks.length === 0) return;
  const v = FarmSmart.visitorInfo;
  const list = FarmSmart.sessionClicks.map((label, i) => `${i + 1}. ${label}`).join('\n');
  sendNtfyBeacon(`🖱 FarmSmart session activity\nIP: ${v.ip} · ${v.location}\n\n${list}`);
  FarmSmart.sessionClicks = []; // avoid sending the same clicks twice if visibility toggles more than once
});

document.addEventListener('DOMContentLoaded', notifyAppOpened);

// ---- "Share the app" button ----
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('shareAppBtn').addEventListener('click', async () => {
    // IMPORTANT: navigator.share() must run FIRST, with nothing async
    // before it — some mobile browsers require a share() call to
    // happen as a direct, immediate result of the tap. Even a
    // non-awaited fetch() call (like the ntfy notification below)
    // running beforehand can be enough to lose that "user activation"
    // context on some Android browsers, silently making share() fail
    // or do nothing. So: share/copy first, notify after.
    const shareData = {
      title: 'FarmSmart',
      text: 'Check out FarmSmart — our farm dashboard app.',
      url: window.location.href,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (e) {
        // Person cancelled the share sheet — nothing to do.
      }
    } else if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(shareData.url);
        showToast('Link copied to clipboard');
      } catch (e) {
        showToast('Could not copy link');
      }
    } else {
      showToast('Sharing not supported on this browser');
    }

    // Notified after the share attempt (not batched into the
    // session-end summary) — the person asked to know right away when
    // this specific button is used, regardless of what happens in the
    // share sheet (sent, or cancelled).
    const v = FarmSmart.visitorInfo;
    sendNtfy(`IP: ${v.ip} · ${v.location}\nDevice: ${v.device}\nTime: ${new Date().toLocaleString()}`, {
      title: '📤 Someone tapped "Share the app"',
      tags: 'loudspeaker',
    });
  });
});

/* ---------------------------------------------------------------------
   7. WHEEL PICKER (shared iPhone-style scroll wheel utility)
   ---------------------------------------------------------------------
   Any tile can use this for a scrollable, snap-to-center picker column
   (see js/tiles/gates.js for the paddock/time picker built from it).

   FarmSmart.createWheel(container, values, initialIndex) turns an
   empty element into one wheel column: it fills it with one row per
   value, adds top/bottom padding so the first and last values can
   still scroll to the vertical center, and tracks which value is
   currently centered as the user scrolls. Returns a small controller
   object: { getValue(), getIndex(), setIndex(i) }.

   IMPORTANT: the row height here (WHEEL_ROW_HEIGHT) must match
   `.wheel-item { height: ... }` in css/tiles/gates.css — if you change
   one, change the other, or the snap math will be off.
--------------------------------------------------------------------- */
const WHEEL_ROW_HEIGHT = 40; // px — keep in sync with .wheel-item height in CSS

FarmSmart.createWheel = function (container, values, initialIndex) {
  container.innerHTML = '';
  container.classList.add('wheel-col');

  // Padding rows above/below so the first/last real values can be
  // scrolled all the way to the center of the visible wheel.
  const padTop = document.createElement('div');
  padTop.className = 'wheel-pad';
  container.appendChild(padTop);

  values.forEach((value, i) => {
    const item = document.createElement('div');
    item.className = 'wheel-item';
    item.textContent = value;
    item.dataset.index = i;
    container.appendChild(item);
  });

  const padBottom = document.createElement('div');
  padBottom.className = 'wheel-pad';
  container.appendChild(padBottom);

  let currentIndex = initialIndex || 0;

  function markSelected() {
    container.querySelectorAll('.wheel-item').forEach((el, i) => {
      el.classList.toggle('selected', i === currentIndex);
    });
  }

  function scrollToIndex(i, smooth) {
    currentIndex = Math.max(0, Math.min(values.length - 1, i));
    container.scrollTo({ top: currentIndex * WHEEL_ROW_HEIGHT, behavior: smooth ? 'smooth' : 'auto' });
    markSelected();
  }

  // While scrolling/flicking, wait for it to settle (debounced) before
  // snapping to the nearest value and reporting it as selected.
  let settleTimer = null;
  container.addEventListener('scroll', () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      const idx = Math.round(container.scrollTop / WHEEL_ROW_HEIGHT);
      scrollToIndex(idx, true);
    }, 120);
  });

  // Tapping a value directly (instead of scrolling to it) selects it.
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
   8. LIGHT / DARK THEME TOGGLE
   ---------------------------------------------------------------------
   Persisted per-device via localStorage (not tied to which user —
   John/Greg — is selected). Wrapped in try/catch because localStorage
   can throw in some sandboxed preview contexts; if it fails, the
   toggle still works for the current session, it just won't be
   remembered on reload.
--------------------------------------------------------------------- */
const THEME_STORAGE_KEY = 'farmsmart-theme';

function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY);
  } catch (e) {
    return null;
  }
}
function storeTheme(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (e) {
    // Storage unavailable — toggle still works this session, just
    // won't persist. Not worth surfacing to the user.
  }
}
function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    document.getElementById('themeToggleBtn').setAttribute('aria-label', 'Switch to dark mode');
  } else {
    document.documentElement.removeAttribute('data-theme');
    document.getElementById('themeToggleBtn').setAttribute('aria-label', 'Switch to light mode');
  }
}
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(getStoredTheme() || 'dark');
  document.getElementById('themeToggleBtn').addEventListener('click', () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const next = isLight ? 'dark' : 'light';
    applyTheme(next);
    storeTheme(next);
  });
});

/* ---------------------------------------------------------------------
   9. ONLINE/OFFLINE STATUS
   Useful on farms with patchy mobile signal between paddocks.
--------------------------------------------------------------------- */
function updateSyncStatus() {
  const pill = document.getElementById('syncPill');
  const isOnline = navigator.onLine;
  pill.classList.toggle('offline', !isOnline);
  pill.querySelector('span:last-child').textContent = isOnline ? 'Synced' : 'Offline';
}
window.addEventListener('online', updateSyncStatus);
window.addEventListener('offline', updateSyncStatus);

/* ---------------------------------------------------------------------
   9b. DEMO BANNER
   ---------------------------------------------------------------------
   Shown once above everything else (markup lives in index.html, right
   above the header). Dismissing it hides it for the rest of this
   browser/device via localStorage, same pattern as the theme toggle —
   wrapped in try/catch so a blocked localStorage just means the
   banner reappears next visit instead of breaking anything.
--------------------------------------------------------------------- */
const DEMO_BANNER_DISMISSED_KEY = 'farmsmart-demo-banner-dismissed';

document.addEventListener('DOMContentLoaded', () => {
  const banner = document.getElementById('demoBanner');
  if (!banner) return;

  let dismissed = false;
  try { dismissed = localStorage.getItem(DEMO_BANNER_DISMISSED_KEY) === '1'; } catch (e) { /* ignore */ }
  if (dismissed) banner.style.display = 'none';

  document.getElementById('demoBannerClose').addEventListener('click', () => {
    banner.style.display = 'none';
    try { localStorage.setItem(DEMO_BANNER_DISMISSED_KEY, '1'); } catch (e) { /* ignore — still hidden this session */ }
  });
});

/* ---------------------------------------------------------------------
   10. BOOT
   Runs once the page (and every tile script before this point) has
   loaded. Injects every registered tile's markup into #dashboard, in
   registration order, then runs each tile's init().
--------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  const dashboard = document.getElementById('dashboard');

  FarmSmart.tiles.forEach((tile) => {
    const childrenBefore = new Set(dashboard.children);
    dashboard.insertAdjacentHTML('beforeend', tile.html);
    // Tag every top-level element this tile just added with its id, so
    // click tracking (section 6) can report which tile a button
    // belongs to. Tagging the elements directly (not wrapping them)
    // keeps #dashboard's CSS grid children exactly as before.
    Array.from(dashboard.children).forEach((child) => {
      if (!childrenBefore.has(child)) child.dataset.tileName = tile.id;
    });
    if (typeof tile.init === 'function') tile.init();
  });

  // Initial paint of header state.
  document.getElementById('activeFarmName').textContent =
    FARMS.find((f) => f.id === FarmSmart.activeFarmId).name;
  updateSyncStatus();
});
