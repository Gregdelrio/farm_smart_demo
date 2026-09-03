/* =====================================================================
   TILE: FARM ROSTER
   ---------------------------------------------------------------------
   TO DISABLE THIS TILE: comment out (or delete) in index.html:
     <link rel="stylesheet" href="css/tiles/roster.css">
     <script src="js/tiles/roster.js"></script>

   DESIGN NOTES:
   - Roster employees are DELIBERATELY separate from FarmSmart user
     accounts (John/Greg). This tile manages its own list of workers
     (name, which farm(s) they're trained for, an optional partner for
     couple constraints) — nothing to do with who's logged into the app.
   - Shows every employee across all three farms in one table, not
     filtered by the active farm switcher.
   - Editing is Owner-only: Generate/Clear/Manage Employees/Farm
     Staffing, and tapping a cell, are all gated behind
     FarmSmart.currentUser.role === 'Owner'. Greg sees the same table
     read-only — the tile itself stays visible, just without any edit
     controls (unlike Milk Statement, which hides completely for Greg).
   - Workflow: type in some constraints by hand first (tap cells to
     lock in "must be off" / "must work farm X" for specific people),
     THEN tap "Generate Roster" — generation only fills in the cells
     still blank, it never overwrites anything already set. Every cell
     stays editable afterwards too.
   ===================================================================== */

// ---- Farm-specific roster config: color used in the grid, and the
// min/ideal/max staff-per-day targets the generator aims for. Colors
// are deliberately different from the app's functional status colors
// (yellow=action, green=ok, red=alert, blue=info) so a farm color in
// this grid is never confused with a status elsewhere in the app. ----
const ROSTER_FARM_CONFIG = {
  laang:    { color: '#2A9D8F', min: 1, ideal: 1, max: 2 }, // teal
  maguires: { color: '#E8792E', min: 1, ideal: 2, max: 3 }, // orange
  vickers:  { color: '#8B5FBF', min: 2, ideal: 2, max: 3 }, // purple
};

const WEEKLY_DAYS_OFF = 2; // fixed for every employee, per week

// Reusable red-X icon (used for "Clear" in the cell sheet and the
// delete button in Manage Employees) — visually distinct from the
// dashed gray square used for "Day Off", so the two can't be confused
// when tapping a cell.
const ROSTER_DELETE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

// Demo roster staff — freely editable/removable once the tile is
// running (see "Manage Employees"). partnerId links two employees as
// a couple: they always share the same off-days, and the generator
// tries (best-effort, not a hard rule) to put them on the same farm
// on days they both work.
let rosterEmployees = [
  { id: 'greg',      name: 'Greg',       trainedFarms: ['maguires'],            partnerId: 'violette' },
  { id: 'violette',  name: 'Violette',   trainedFarms: ['maguires'],            partnerId: 'greg' },
  { id: 'bart',      name: 'Bart',       trainedFarms: ['maguires', 'vickers'], partnerId: null },
  { id: 'elsep',     name: 'Else P',     trainedFarms: ['vickers', 'laang'],    partnerId: null },
  { id: 'lucia',     name: 'Lucia',      trainedFarms: ['maguires', 'vickers'], partnerId: null },
  { id: 'carolinas', name: 'Carolina S', trainedFarms: ['laang'],               partnerId: null },
];

// rosterGrid[employeeId][dayIndex] = null (blank) | 'off' | a farm id
let rosterGrid = {};
function ensureGridRow(empId) {
  if (!rosterGrid[empId]) rosterGrid[empId] = Array(7).fill(null);
}
rosterEmployees.forEach((e) => ensureGridRow(e.id));

// ---------------------------------------------------------------------
// PERSISTENCE — employees and farm staffing survive a page reload /
// the next time you open the app, saved to this device's browser via
// localStorage (same pattern as the light/dark theme toggle in
// js/core.js). The demo baseline above is only ever used the very
// first time (or on a browser/device that's never saved anything) —
// after that, whatever you edit in "Manage Employees" or "Farm
// Staffing" is what loads back in. Wrapped in try/catch throughout so
// a blocked/unavailable localStorage never breaks the tile — it just
// won't remember between visits on that device.
// ---------------------------------------------------------------------
const ROSTER_EMPLOYEES_STORAGE_KEY = 'farmsmart-roster-employees';
const ROSTER_STAFFING_STORAGE_KEY = 'farmsmart-roster-staffing';

function saveEmployeesToStorage() {
  try {
    localStorage.setItem(ROSTER_EMPLOYEES_STORAGE_KEY, JSON.stringify(rosterEmployees));
  } catch (e) { /* storage unavailable — edits still work this session */ }
}
function loadEmployeesFromStorage() {
  try {
    const raw = localStorage.getItem(ROSTER_EMPLOYEES_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (Array.isArray(saved) && saved.length > 0) {
      rosterEmployees = saved;
      rosterGrid = {};
      rosterEmployees.forEach((e) => ensureGridRow(e.id));
    }
  } catch (e) { /* ignore corrupt/unavailable storage, fall back to the demo baseline */ }
}

function saveStaffingToStorage() {
  try {
    localStorage.setItem(ROSTER_STAFFING_STORAGE_KEY, JSON.stringify(ROSTER_FARM_CONFIG));
  } catch (e) { /* storage unavailable — edits still work this session */ }
}
function loadStaffingFromStorage() {
  try {
    const raw = localStorage.getItem(ROSTER_STAFFING_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    Object.keys(saved).forEach((farmId) => {
      if (!ROSTER_FARM_CONFIG[farmId]) return; // ignore a farm id no longer in the app
      ['min', 'ideal', 'max'].forEach((key) => {
        if (typeof saved[farmId][key] === 'number') ROSTER_FARM_CONFIG[farmId][key] = saved[farmId][key];
      });
      // Colors stay whatever's defined in code above — never loaded
      // from storage, so a future palette change always takes effect.
    });
  } catch (e) { /* ignore corrupt/unavailable storage, fall back to the defaults above */ }
}

const ROSTER_GRID_STORAGE_KEY = 'farmsmart-roster-grid';

function saveGridToStorage() {
  try {
    localStorage.setItem(ROSTER_GRID_STORAGE_KEY, JSON.stringify(rosterGrid));
  } catch (e) { /* storage unavailable — edits still work this session */ }
}
function loadGridFromStorage() {
  try {
    const raw = localStorage.getItem(ROSTER_GRID_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    // Only accept a saved row for an employee who still exists, and
    // only if it's shaped like a real 7-day row — this is what keeps
    // things safe if an employee was deleted (or the file structure
    // ever changes) since the grid was last saved.
    rosterEmployees.forEach((e) => {
      if (Array.isArray(saved[e.id]) && saved[e.id].length === 7) {
        rosterGrid[e.id] = saved[e.id];
      }
    });
  } catch (e) { /* ignore corrupt/unavailable storage, fall back to a blank grid */ }
}

// Load any saved data immediately, so it's already in place before
// the tile even mounts. Grid loads LAST, after employees — so it only
// ever restores rows for employees who are actually still around.
loadEmployeesFromStorage();
loadStaffingFromStorage();
loadGridFromStorage();


function slugify(name) {
  let base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '');
  let id = base || 'employee';
  let n = 2;
  while (rosterEmployees.some((e) => e.id === id)) { id = base + n; n++; }
  return id;
}

function getMonday(d) {
  d = new Date(d);
  const day = d.getDay(); // 0 = Sunday
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
function weekDates() {
  const monday = getMonday(new Date());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return d;
  });
}
const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function farmName(farmId) {
  const farm = FARMS.find((f) => f.id === farmId);
  return farm ? farm.name : farmId;
}
function farmInitial(farmId) {
  return farmName(farmId).charAt(0).toUpperCase();
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------------------------------------------------------------------
   GENERATION ALGORITHM
   ---------------------------------------------------------------------
   Only fills cells that are still blank (null) — anything already set
   (by hand, as a constraint, or from a previous generation) is left
   exactly as-is. Two passes:
     1. Off-days: give every employee (or couple, jointly) their 2
        weekly days off, picking from days that are blank for everyone
        in the group so a locked farm assignment is never overwritten.
     2. Farm assignments: day by day, fill each farm up toward its
        "ideal" headcount first (preferring trained people whose
        partner is already on that same farm that day), then place any
        still-unassigned trained people wherever there's room under
        that farm's max, and mark anyone left over as off.
   This is a greedy heuristic, not a perfect solver — good enough to
   produce a sensible starting roster that a human then fine-tunes by
   hand, which is the actual intended workflow.
--------------------------------------------------------------------- */
function generateRoster() {
  const farmIds = Object.keys(ROSTER_FARM_CONFIG);
  const processed = new Set();

  // ---- Pass 1: off-days, couples handled jointly ----
  rosterEmployees.forEach((emp) => {
    if (processed.has(emp.id)) return;
    const partner = emp.partnerId ? rosterEmployees.find((e) => e.id === emp.partnerId) : null;
    const group = partner ? [emp, partner] : [emp];
    group.forEach((e) => processed.add(e.id));

    const alreadyOff = new Set();
    group.forEach((e) => rosterGrid[e.id].forEach((v, i) => { if (v === 'off') alreadyOff.add(i); }));

    let candidateDays = [];
    for (let d = 0; d < 7; d++) {
      if (alreadyOff.has(d)) continue;
      if (group.every((e) => rosterGrid[e.id][d] === null)) candidateDays.push(d);
    }
    candidateDays = shuffle(candidateDays);

    const stillNeeded = Math.max(0, WEEKLY_DAYS_OFF - alreadyOff.size);
    candidateDays.slice(0, stillNeeded).forEach((d) => {
      group.forEach((e) => { rosterGrid[e.id][d] = 'off'; });
    });
  });

  // ---- Pass 2: farm assignments, day by day ----
  for (let d = 0; d < 7; d++) {
    let available = rosterEmployees.filter((e) => rosterGrid[e.id][d] === null);
    const counts = {};
    farmIds.forEach((f) => {
      counts[f] = rosterEmployees.filter((e) => rosterGrid[e.id][d] === f).length;
    });

    // Fill each farm toward its ideal headcount, biggest shortfall first.
    const order = farmIds.slice().sort((a, b) => (ROSTER_FARM_CONFIG[b].ideal - counts[b]) - (ROSTER_FARM_CONFIG[a].ideal - counts[a]));

    order.forEach((farmId) => {
      const cfg = ROSTER_FARM_CONFIG[farmId];
      while (counts[farmId] < cfg.ideal) {
        let candidates = available.filter((e) => e.trainedFarms.includes(farmId));
        if (candidates.length === 0) break;
        // Prefer someone whose partner already landed on this farm today.
        candidates.sort((a, b) => {
          const aWithPartner = a.partnerId && rosterGrid[a.partnerId][d] === farmId ? 1 : 0;
          const bWithPartner = b.partnerId && rosterGrid[b.partnerId][d] === farmId ? 1 : 0;
          return bWithPartner - aWithPartner;
        });
        const chosen = candidates[0];
        rosterGrid[chosen.id][d] = farmId;
        counts[farmId]++;
        available = available.filter((e) => e.id !== chosen.id);
      }
    });

    // Anyone still unassigned: place under a trained farm with room
    // left under its max, otherwise treat the day as a bonus day off.
    available.forEach((e) => {
      const farm = e.trainedFarms.find((f) => counts[f] < ROSTER_FARM_CONFIG[f].max);
      if (farm) { rosterGrid[e.id][d] = farm; counts[farm]++; }
      else { rosterGrid[e.id][d] = 'off'; }
    });
  }
}

FarmSmart.registerTile({
  id: 'roster',

  html: `
    <div class="card">
      <div class="card-top">
        <span class="card-title"><i class="ti ti-calendar-week"></i>Farm Roster</span>
      </div>
      <p class="roster-week-label" id="rosterWeekLabel">This week</p>
      <div class="roster-legend roster-legend--card" id="rosterLegendCard"></div>
      <div class="roster-grid-wrap roster-grid-wrap--card"><div class="roster-grid" id="rosterGridCardEl"></div></div>
      <p class="roster-preview-hint">Tap "View Roster" to edit</p>
      <button class="card-btn primary" id="rosterOpenBtn"><i class="ti ti-table"></i>View Roster</button>
    </div>

    <!-- ================= MAIN ROSTER OVERLAY ================= -->
    <div class="overlay" id="rosterOverlay">
      <div class="overlay-header">
        <button class="close-btn" id="rosterBackBtn" aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <h1>Farm Roster</h1>
      </div>

      <p class="roster-week-label" style="margin: 0 1.5rem 1.5rem;" id="rosterOverlayWeekLabel"></p>

      <div class="roster-legend" id="rosterLegend"></div>
      <div class="roster-grid-wrap"><div class="roster-grid" id="rosterGridEl"></div></div>

      <!-- Owner-only edit controls -->
      <div class="roster-action-row" id="rosterOwnerActions" style="margin: 0 1.5rem 2rem;">
        <button class="card-btn primary" id="rosterGenerateBtn"><i class="ti ti-wand"></i>Generate Roster</button>
        <button class="card-btn" id="rosterClearBtn"><i class="ti ti-eraser"></i>Clear Roster</button>
        <button class="card-btn" id="rosterManageEmployeesBtn"><i class="ti ti-users"></i>Manage Employees</button>
        <button class="card-btn" id="rosterStaffingBtn"><i class="ti ti-adjustments"></i>Farm Staffing</button>
      </div>
    </div>

    <!-- ================= CELL EDIT SHEET ================= -->
    <div class="sheet-mask" id="rosterCellSheetMask">
      <div class="sheet">
        <h2 id="rosterCellSheetTitle">Assign</h2>
        <div id="rosterCellOptions"></div>
      </div>
    </div>

    <!-- ================= MANAGE EMPLOYEES SHEET ================= -->
    <div class="sheet-mask" id="rosterEmployeesSheetMask">
      <div class="sheet">
        <h2>Manage Employees</h2>
        <div id="rosterEmployeesList"></div>
        <button class="card-btn primary" id="rosterAddEmployeeBtn" style="margin: 0.5rem 1.5rem 0; width: calc(100% - 3rem);"><i class="ti ti-plus"></i>Add Employee</button>
      </div>
    </div>

    <!-- ================= EMPLOYEE ADD/EDIT FORM SHEET ================= -->
    <div class="sheet-mask" id="rosterEmployeeFormSheetMask">
      <div class="sheet">
        <h2 id="rosterEmployeeFormTitle">Add Employee</h2>

        <p class="roster-form-label">Name</p>
        <input type="text" class="roster-text-input" id="rosterEmployeeNameInput" placeholder="Employee name">

        <p class="roster-form-label">Trained farms</p>
        <div class="roster-chip-row" id="rosterEmployeeFarmChips"></div>

        <p class="roster-form-label">Couple partner</p>
        <div id="rosterEmployeePartnerList" style="margin: 0 1.5rem 1.5rem;"></div>

        <button class="card-btn primary" id="rosterEmployeeSaveBtn" style="margin: 0.5rem 1.5rem 0; width: calc(100% - 3rem);">Save</button>
      </div>
    </div>

    <!-- ================= FARM STAFFING SHEET ================= -->
    <div class="sheet-mask" id="rosterStaffingSheetMask">
      <div class="sheet">
        <h2>Farm Staffing</h2>
        <p class="roster-week-label" style="margin: 0 1.5rem 1.5rem;">Target headcount per day, for the roster generator.</p>
        <div id="rosterStaffingList"></div>
      </div>
    </div>
  `,

  init: function () {
    let editingEmployeeId = null; // null = "add" mode, otherwise "edit" mode
    let editingFarms = [];
    let editingPartnerId = null;
    let cellSheetTarget = null; // { empId, dayIndex }

    function isOwner() { return FarmSmart.currentUser.role === 'Owner'; }

    // ---- Week label ----
    function renderWeekLabel() {
      const dates = weekDates();
      const label = `${DOW_LABELS[0]} ${dates[0].getDate()} ${dates[0].toLocaleString('en-US', { month: 'short' })} – ${DOW_LABELS[6]} ${dates[6].getDate()} ${dates[6].toLocaleString('en-US', { month: 'short' })}`;
      document.getElementById('rosterWeekLabel').textContent = label;
      document.getElementById('rosterOverlayWeekLabel').textContent = label;
    }

    // ---- Legend ----
    // Populates BOTH the compact one on the dashboard card and the
    // full one inside the overlay — same content, just two spots on
    // the page since the card now shows a live preview too.
    function renderLegend() {
      const html = Object.keys(ROSTER_FARM_CONFIG).map((farmId) => `
        <span class="roster-legend-item"><span class="roster-legend-swatch" style="background:${ROSTER_FARM_CONFIG[farmId].color};"></span>${farmName(farmId)}</span>
      `).join('') + `<span class="roster-legend-item"><span class="roster-legend-swatch" style="background:var(--bg-card-alt);border:1px dashed var(--text-faint);"></span>Day off</span>`;
      const overlayEl = document.getElementById('rosterLegend');
      if (overlayEl) overlayEl.innerHTML = html;
      const cardEl = document.getElementById('rosterLegendCard');
      if (cardEl) cardEl.innerHTML = html;
    }

    // ---- Main grid ----
    // Builds the grid's HTML once; `readOnly` strips interactivity for
    // the dashboard card's preview (buttons render disabled, no click
    // listeners attached) — full editing stays behind "View Roster".
    function buildGridHtml(readOnly) {
      const dates = weekDates();
      let html = `<div class="roster-grid-cell roster-corner roster-name-cell">Employee</div>`;
      dates.forEach((d, i) => {
        html += `<div class="roster-grid-cell roster-day-header"><span class="dow">${DOW_LABELS[i]}</span><span class="dom">${d.getDate()}/${d.getMonth() + 1}</span></div>`;
      });

      rosterEmployees.forEach((emp) => {
        html += `<div class="roster-grid-cell roster-name-cell">${emp.name}</div>`;
        for (let d = 0; d < 7; d++) {
          const val = rosterGrid[emp.id][d];
          const isOff = val === 'off';
          const bg = val && !isOff ? ROSTER_FARM_CONFIG[val].color : 'transparent';
          const label = isOff ? 'OFF' : (val ? farmInitial(val) : '');
          const disabledAttr = (readOnly || !isOwner()) ? 'disabled' : '';
          html += `<div class="roster-grid-cell">
            <button class="roster-cell-btn${isOff ? ' is-off' : ''}" style="background:${bg};" data-emp="${emp.id}" data-day="${d}" ${disabledAttr}>${label}</button>
          </div>`;
        }
      });
      return html;
    }

    function renderGrid() {
      // Overlay grid: interactive (Owner only — buildGridHtml already
      // disables buttons for Greg via the isOwner() check inside it).
      const overlayEl = document.getElementById('rosterGridEl');
      if (overlayEl) {
        overlayEl.innerHTML = buildGridHtml(false);
        overlayEl.querySelectorAll('.roster-cell-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            if (!isOwner()) return;
            openCellSheet(btn.dataset.emp, parseInt(btn.dataset.day, 10));
          });
        });
      }

      // Card preview: same data, always read-only, no listeners — a
      // glance at the current roster right on the dashboard, tapping
      // "View Roster" is still how you actually edit it.
      const cardEl = document.getElementById('rosterGridCardEl');
      if (cardEl) cardEl.innerHTML = buildGridHtml(true);
    }

    function renderAll() {
      renderWeekLabel();
      renderLegend();
      renderGrid();
    }

    // ---- Cell edit sheet ----
    function openCellSheet(empId, dayIndex) {
      cellSheetTarget = { empId, dayIndex };
      const emp = rosterEmployees.find((e) => e.id === empId);
      document.getElementById('rosterCellSheetTitle').textContent = `${emp.name} — ${DOW_LABELS[dayIndex]}`;

      const optionsEl = document.getElementById('rosterCellOptions');
      let html = '';
      emp.trainedFarms.forEach((farmId) => {
        html += `<button class="roster-option-row" data-value="${farmId}"><span class="roster-option-swatch" style="background:${ROSTER_FARM_CONFIG[farmId].color};"></span>${farmName(farmId)}</button>`;
      });
      html += `<button class="roster-option-row" data-value="off"><span class="roster-option-swatch off"></span>Day Off</button>`;
      html += `<button class="roster-option-row" data-value=""><span class="roster-option-swatch clear">${ROSTER_DELETE_ICON_SVG}</span>Clear</button>`;
      optionsEl.innerHTML = html;

      optionsEl.querySelectorAll('.roster-option-row').forEach((row) => {
        row.addEventListener('click', () => {
          const v = row.dataset.value;
          rosterGrid[cellSheetTarget.empId][cellSheetTarget.dayIndex] = v || null;
          saveGridToStorage();
          closeCellSheet();
          renderGrid();
        });
      });

      document.getElementById('rosterCellSheetMask').classList.add('show');
    }
    function closeCellSheet() { document.getElementById('rosterCellSheetMask').classList.remove('show'); }

    // ---- Manage Employees sheet ----
    function renderEmployeesList() {
      const el = document.getElementById('rosterEmployeesList');
      el.innerHTML = rosterEmployees.map((emp) => {
        const farmsLabel = emp.trainedFarms.map(farmName).join(', ') || 'No farms trained';
        const partner = emp.partnerId ? rosterEmployees.find((e) => e.id === emp.partnerId) : null;
        const meta = partner ? `${farmsLabel} · Couple with ${partner.name}` : farmsLabel;
        return `
          <div class="roster-emp-row" data-id="${emp.id}">
            <button class="roster-emp-row__handle" aria-label="Drag to reorder" type="button">
              <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>
            </button>
            <div class="roster-emp-row__info">
              <span class="roster-emp-row__name">${emp.name}</span>
              <span class="roster-emp-row__meta">${meta}</span>
            </div>
            <div class="roster-emp-row__actions">
              <button class="roster-emp-row__edit" data-id="${emp.id}" aria-label="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg></button>
              <button class="roster-emp-row__delete" data-id="${emp.id}" aria-label="Delete">${ROSTER_DELETE_ICON_SVG}</button>
            </div>
          </div>`;
      }).join('');

      el.querySelectorAll('.roster-emp-row__edit').forEach((btn) => {
        btn.addEventListener('click', () => openEmployeeForm(btn.dataset.id));
      });
      el.querySelectorAll('.roster-emp-row__delete').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.id;
          rosterEmployees = rosterEmployees.filter((e) => e.id !== id);
          rosterEmployees.forEach((e) => { if (e.partnerId === id) e.partnerId = null; });
          delete rosterGrid[id];
          saveEmployeesToStorage();
          saveGridToStorage();
          renderEmployeesList();
          renderGrid();
        });
      });

      attachDragHandlers(el);
    }

    // ---- Drag-to-reorder ----
    // Works with mouse AND touch via the Pointer Events API (one set
    // of listeners covers both). Only the dragged row moves visually
    // (a simple translateY, following the pointer) — the other rows'
    // positions are captured ONCE at drag-start and never re-measured
    // mid-drag, which keeps the math simple and reliable. The row
    // currently under the dragged item gets a highlighted top border
    // as a drop-target preview; the actual array reorder (and the
    // matching update to the roster grid's row order, since
    // renderGrid() iterates rosterEmployees in this same order) only
    // happens once, on release.
    function attachDragHandlers(el) {
      let dragRow = null;
      let startY = 0;
      let rowBounds = []; // [{ id, top, height }], captured at drag start
      let targetIndex = null;

      function onMove(e) {
        if (!dragRow) return;
        const delta = e.clientY - startY;
        dragRow.style.transform = `translateY(${delta}px)`;

        const draggedBounds = rowBounds.find((b) => b.id === dragRow.dataset.id);
        const draggedCenter = draggedBounds.top + draggedBounds.height / 2 + delta;

        targetIndex = rowBounds.length - 1;
        for (let i = 0; i < rowBounds.length; i++) {
          if (draggedCenter < rowBounds[i].top + rowBounds[i].height / 2) { targetIndex = i; break; }
        }

        el.querySelectorAll('.roster-emp-row').forEach((r) => r.classList.remove('drag-over'));
        const targetId = rowBounds[targetIndex].id;
        if (targetId !== dragRow.dataset.id) {
          const targetRow = el.querySelector(`.roster-emp-row[data-id="${targetId}"]`);
          if (targetRow) targetRow.classList.add('drag-over');
        }
      }

      function onUp(e) {
        if (!dragRow) return;
        try { dragRow.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
        dragRow.removeEventListener('pointermove', onMove);
        dragRow.removeEventListener('pointerup', onUp);
        dragRow.removeEventListener('pointercancel', onUp);

        dragRow.classList.remove('dragging');
        dragRow.style.transform = '';
        el.querySelectorAll('.roster-emp-row').forEach((r) => r.classList.remove('drag-over'));

        const draggedId = dragRow.dataset.id;
        const fromIndex = rosterEmployees.findIndex((emp) => emp.id === draggedId);
        let toIndex = targetIndex;
        if (toIndex !== null && toIndex > fromIndex) toIndex--; // removing the dragged item first shifts later indices down by one

        if (fromIndex !== -1 && toIndex !== null && toIndex !== fromIndex) {
          const [moved] = rosterEmployees.splice(fromIndex, 1);
          rosterEmployees.splice(toIndex, 0, moved);
          saveEmployeesToStorage();
          // rosterEmployees' order IS the grid's row order (renderGrid
          // iterates it directly), so re-rendering the grid here is
          // what makes the reorder show up in the roster table too.
          renderGrid();
        }
        renderEmployeesList(); // always re-render to reset styles/listeners cleanly

        dragRow = null;
      }

      el.querySelectorAll('.roster-emp-row__handle').forEach((handle) => {
        handle.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          const row = handle.closest('.roster-emp-row');
          dragRow = row;
          startY = e.clientY;
          targetIndex = rosterEmployees.findIndex((emp) => emp.id === row.dataset.id);

          rowBounds = Array.from(el.querySelectorAll('.roster-emp-row')).map((r) => {
            const rect = r.getBoundingClientRect();
            return { id: r.dataset.id, top: rect.top, height: rect.height };
          });

          row.classList.add('dragging');
          row.setPointerCapture(e.pointerId);
          row.addEventListener('pointermove', onMove);
          row.addEventListener('pointerup', onUp);
          row.addEventListener('pointercancel', onUp);
        });
      });
    }

    function openEmployeesSheet() {
      renderEmployeesList();
      document.getElementById('rosterEmployeesSheetMask').classList.add('show');
    }
    function closeEmployeesSheet() { document.getElementById('rosterEmployeesSheetMask').classList.remove('show'); }

    // ---- Employee add/edit form ----
    function openEmployeeForm(empId) {
      editingEmployeeId = empId || null;
      const emp = empId ? rosterEmployees.find((e) => e.id === empId) : null;
      editingFarms = emp ? emp.trainedFarms.slice() : [];
      editingPartnerId = emp ? emp.partnerId : null;

      document.getElementById('rosterEmployeeFormTitle').textContent = emp ? 'Edit Employee' : 'Add Employee';
      document.getElementById('rosterEmployeeNameInput').value = emp ? emp.name : '';

      const chipsEl = document.getElementById('rosterEmployeeFarmChips');
      chipsEl.innerHTML = Object.keys(ROSTER_FARM_CONFIG).map((farmId) => `
        <button type="button" class="roster-chip${editingFarms.includes(farmId) ? ' active' : ''}" data-farm="${farmId}" style="${editingFarms.includes(farmId) ? `background:${ROSTER_FARM_CONFIG[farmId].color};` : ''}">
          <span class="roster-legend-swatch" style="background:${ROSTER_FARM_CONFIG[farmId].color};"></span>${farmName(farmId)}
        </button>
      `).join('');
      chipsEl.querySelectorAll('.roster-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          const farmId = chip.dataset.farm;
          if (editingFarms.includes(farmId)) {
            editingFarms = editingFarms.filter((f) => f !== farmId);
            chip.classList.remove('active');
            chip.style.background = '';
          } else {
            editingFarms.push(farmId);
            chip.classList.add('active');
            chip.style.background = ROSTER_FARM_CONFIG[farmId].color;
          }
        });
      });

      const partnerEl = document.getElementById('rosterEmployeePartnerList');
      const otherEmployees = rosterEmployees.filter((e) => e.id !== editingEmployeeId);
      const partnerOptions = [{ id: null, name: 'None' }, ...otherEmployees];
      partnerEl.innerHTML = partnerOptions.map((p) => `
        <button type="button" class="sheet-row${editingPartnerId === p.id ? ' active' : ''}" data-partner="${p.id || ''}" style="margin-bottom:0.5rem;">
          <span class="sheet-row__title">${p.name}</span>
        </button>
      `).join('');
      partnerEl.querySelectorAll('[data-partner]').forEach((row) => {
        row.addEventListener('click', () => {
          editingPartnerId = row.dataset.partner || null;
          partnerEl.querySelectorAll('.sheet-row').forEach((r) => r.classList.remove('active'));
          row.classList.add('active');
        });
      });

      document.getElementById('rosterEmployeeFormSheetMask').classList.add('show');
    }
    function closeEmployeeForm() { document.getElementById('rosterEmployeeFormSheetMask').classList.remove('show'); }

    document.getElementById('rosterEmployeeSaveBtn').addEventListener('click', () => {
      const name = document.getElementById('rosterEmployeeNameInput').value.trim();
      if (!name) { showToast('Enter a name first'); return; }

      if (editingEmployeeId) {
        const emp = rosterEmployees.find((e) => e.id === editingEmployeeId);
        emp.name = name;
        emp.trainedFarms = editingFarms.slice();
        // Clear the old partner's back-reference before setting the new one.
        rosterEmployees.forEach((e) => { if (e.partnerId === emp.id) e.partnerId = null; });
        emp.partnerId = editingPartnerId;
        if (editingPartnerId) rosterEmployees.find((e) => e.id === editingPartnerId).partnerId = emp.id;
      } else {
        const id = slugify(name);
        const newEmp = { id, name, trainedFarms: editingFarms.slice(), partnerId: editingPartnerId };
        rosterEmployees.push(newEmp);
        ensureGridRow(id);
        if (editingPartnerId) rosterEmployees.find((e) => e.id === editingPartnerId).partnerId = id;
      }

      closeEmployeeForm();
      saveEmployeesToStorage();
      renderEmployeesList();
      renderGrid();
      showToast('Employee saved');
    });

    document.getElementById('rosterAddEmployeeBtn').addEventListener('click', () => openEmployeeForm(null));

    // ---- Farm staffing sheet ----
    function renderStaffingList() {
      const el = document.getElementById('rosterStaffingList');
      el.innerHTML = Object.keys(ROSTER_FARM_CONFIG).map((farmId) => {
        const cfg = ROSTER_FARM_CONFIG[farmId];
        return `
          <div class="roster-staffing-row">
            <div class="roster-staffing-row__title"><span class="roster-legend-swatch" style="background:${cfg.color};"></span>${farmName(farmId)}</div>
            <div class="roster-stepper-group">
              ${['min', 'ideal', 'max'].map((key) => `
                <div class="roster-stepper">
                  <div class="roster-stepper__label">${key}</div>
                  <div class="roster-stepper__controls">
                    <button class="roster-stepper__btn" data-farm="${farmId}" data-key="${key}" data-dir="-1">−</button>
                    <span class="roster-stepper__value" id="rosterStaffing-${farmId}-${key}">${cfg[key]}</span>
                    <button class="roster-stepper__btn" data-farm="${farmId}" data-key="${key}" data-dir="1">+</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>`;
      }).join('');

      el.querySelectorAll('.roster-stepper__btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const { farm, key, dir } = btn.dataset;
          const cfg = ROSTER_FARM_CONFIG[farm];
          cfg[key] = Math.max(0, Math.min(15, cfg[key] + parseInt(dir, 10)));
          document.getElementById(`rosterStaffing-${farm}-${key}`).textContent = cfg[key];
          saveStaffingToStorage();
        });
      });
    }

    function openStaffingSheet() {
      renderStaffingList();
      document.getElementById('rosterStaffingSheetMask').classList.add('show');
    }
    function closeStaffingSheet() { document.getElementById('rosterStaffingSheetMask').classList.remove('show'); }

    // ---- Main overlay open/close + owner-only controls ----
    function openRosterOverlay() {
      renderAll();
      document.getElementById('rosterOverlay').classList.add('show');
    }
    function closeRosterOverlay() { document.getElementById('rosterOverlay').classList.remove('show'); }

    function applyRolePermissions() {
      document.getElementById('rosterOwnerActions').style.display = isOwner() ? 'flex' : 'none';
      renderGrid(); // re-render so cell buttons become enabled/disabled to match
    }

    document.getElementById('rosterOpenBtn').addEventListener('click', openRosterOverlay);
    document.getElementById('rosterBackBtn').addEventListener('click', closeRosterOverlay);

    document.getElementById('rosterGenerateBtn').addEventListener('click', () => {
      generateRoster();
      saveGridToStorage();
      renderGrid();
      showToast('Roster generated');
    });
    document.getElementById('rosterClearBtn').addEventListener('click', () => {
      openConfirm('Clear roster?', 'This clears every cell in this week\'s roster.', 'Clear', () => {
        rosterEmployees.forEach((e) => { rosterGrid[e.id] = Array(7).fill(null); });
        saveGridToStorage();
        renderGrid();
        showToast('Roster cleared');
      });
    });
    document.getElementById('rosterManageEmployeesBtn').addEventListener('click', openEmployeesSheet);
    document.getElementById('rosterStaffingBtn').addEventListener('click', openStaffingSheet);

    // Close sheets by tapping the dimmed background.
    [
      ['rosterCellSheetMask', closeCellSheet],
      ['rosterEmployeesSheetMask', closeEmployeesSheet],
      ['rosterEmployeeFormSheetMask', closeEmployeeForm],
      ['rosterStaffingSheetMask', closeStaffingSheet],
    ].forEach(([id, closeFn]) => {
      document.getElementById(id).addEventListener('click', (e) => { if (e.target.id === id) closeFn(); });
    });

    document.addEventListener('farmsmart:userchanged', applyRolePermissions);
    applyRolePermissions();
    renderLegend();
    renderWeekLabel();
  },
});
