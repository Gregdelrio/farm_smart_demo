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
FarmSmart.activeFarmId = FARMS[0].id;
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
   6. ONLINE/OFFLINE STATUS
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
   7. BOOT
   Runs once the page (and every tile script before this point) has
   loaded. Injects every registered tile's markup into #dashboard, in
   registration order, then runs each tile's init().
--------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  const dashboard = document.getElementById('dashboard');

  FarmSmart.tiles.forEach((tile) => {
    dashboard.insertAdjacentHTML('beforeend', tile.html);
    if (typeof tile.init === 'function') tile.init();
  });

  // Initial paint of header state.
  document.getElementById('activeFarmName').textContent =
    FARMS.find((f) => f.id === FarmSmart.activeFarmId).name;
  updateSyncStatus();
});
