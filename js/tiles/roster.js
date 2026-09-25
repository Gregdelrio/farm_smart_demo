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
  laang:    { color: '#2A9D8F', min: 1, ideal: 1, max: 1, exemptFromMinimumGuarantee: true }, // teal — Carolina is solo here
  vickers:  { color: '#8B5FBF', min: 2, ideal: 2, max: 3 }, // purple
  maguires: { color: '#E8792E', min: 1, ideal: 2, max: 2 }, // orange
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
  { id: 'greg',      name: 'Greg',       trainedFarms: ['vickers'], partnerId: 'violette', consecutiveOffTarget: 2, companionTarget: 2 },
  { id: 'violette',  name: 'Violette',   trainedFarms: ['maguires'],            partnerId: 'greg' },
  { id: 'lucia',     name: 'Lucia',      trainedFarms: ['vickers'],             partnerId: 'bart' },
  { id: 'bart',      name: 'Bart',       trainedFarms: ['vickers', 'maguires'], partnerId: 'lucia' },
  { id: 'elsep',     name: 'Else',       trainedFarms: ['vickers'],             partnerId: null },
  { id: 'carolinas', name: 'Carolina',   trainedFarms: ['laang'],               partnerId: null },
];

// rosterGrid[employeeId][dayIndex] = null (blank) | 'off' | a farm id
let rosterGrid = {};
// Which week is currently being viewed/edited: 0 = this week, negative
// = past, positive = future. Navigation is capped a few weeks each
// way (see ROSTER_WEEKS_BACK/FORWARD below) — past weeks are
// read-only (already happened), current + future weeks stay
// editable. Always reset to 0 when the roster overlay is closed, so
// the dashboard card's live preview is always "this week".
let currentWeekOffset = 0;
const ROSTER_WEEKS_BACK = 4;
const ROSTER_WEEKS_FORWARD = 3;
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

// Bump this whenever the baseline `rosterEmployees` array above changes
// in a way that should override what's already saved on a device
// (reordering, renaming, adding/removing people) — otherwise a device
// that already saved the OLD array would keep shadowing every such
// update forever, since loadEmployeesFromStorage below always prefers
// whatever's saved. Editable in-app changes (Manage Employees) still
// persist normally between versions that don't bump this number.
const ROSTER_EMPLOYEES_SCHEMA_VERSION = 2;
const ROSTER_EMPLOYEES_VERSION_KEY = 'farmsmart-roster-employees-version';

function saveEmployeesToStorage() {
  try {
    localStorage.setItem(ROSTER_EMPLOYEES_STORAGE_KEY, JSON.stringify(rosterEmployees));
    localStorage.setItem(ROSTER_EMPLOYEES_VERSION_KEY, String(ROSTER_EMPLOYEES_SCHEMA_VERSION));
  } catch (e) { /* storage unavailable — edits still work this session */ }
}
function loadEmployeesFromStorage() {
  try {
    const savedVersion = parseInt(localStorage.getItem(ROSTER_EMPLOYEES_VERSION_KEY) || '0', 10);
    if (savedVersion < ROSTER_EMPLOYEES_SCHEMA_VERSION) return; // stale baseline — keep the fresh defaults above

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

const ROSTER_GRID_STORAGE_KEY_LEGACY = 'farmsmart-roster-grid'; // pre-week-navigation key, migrated below

function gridStorageKeyForOffset(offset) {
  const monday = weekDates(offset)[0];
  return 'farmsmart-roster-grid-' + monday.toISOString().slice(0, 10);
}

function saveGridToStorage() {
  try {
    localStorage.setItem(gridStorageKeyForOffset(currentWeekOffset), JSON.stringify(rosterGrid));
  } catch (e) { /* storage unavailable — edits still work this session */ }
}
function loadGridFromStorage() {
  try {
    let raw = localStorage.getItem(gridStorageKeyForOffset(currentWeekOffset));
    // One-time migration: before week navigation existed, "this week"
    // was saved under a single flat key with no date. Adopt it as
    // this week's data the first time round, so upgrading to this
    // version doesn't make an already-generated roster disappear.
    if (!raw && currentWeekOffset === 0) {
      raw = localStorage.getItem(ROSTER_GRID_STORAGE_KEY_LEGACY);
    }
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
function weekDates(offset) {
  if (offset === undefined) offset = currentWeekOffset;
  const monday = getMonday(new Date());
  monday.setDate(monday.getDate() + offset * 7);
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
  // ======================================================================
  // Built around exactly these 3 rules:
  //   1. Every employee gets exactly WEEKLY_DAYS_OFF (2) days off/week.
  //   2. Each couple (anyone with a partnerId) shares at least 1 of
  //      those days off. A couple can additionally be flagged with
  //      `consecutiveOffTarget: N` on either member (see Greg below)
  //      to require N CONSECUTIVE shared days instead of just 1.
  //   3. Every farm's MINIMUM is respected every day — EXCEPT any farm
  //      flagged `exemptFromMinimumGuarantee: true` in
  //      ROSTER_FARM_CONFIG (Laang, since Carolina is solo there and
  //      her mandatory days off are expected to leave it uncovered
  //      sometimes).
  //
  // DATA-DRIVEN, not hardcoded by name: farm assignment (step 2) reads
  // each employee's live `trainedFarms` and each farm's live
  // `ROSTER_FARM_CONFIG` (min/ideal/max) — so editing an employee's
  // trained farms, changing Farm Staffing numbers, or adding a
  // brand-new employee in "Manage Employees" all take effect on the
  // next Generate, with no code change needed. The one named exception
  // is Greg's `consecutiveOffTarget: 2` flag on his employee record —
  // that's a deliberate business choice for that specific couple, not
  // a limitation; a future couple could get the same treatment by
  // adding the same field to their record.
  //
  // Only cells still blank (null) are ever touched — anything already
  // set by hand (tap a cell before generating) is left alone.
  // ======================================================================

  // Snapshot exactly what was already in the grid BEFORE this
  // generation touches anything — used below (companion-boost pass)
  // to tell "manually pre-set before hitting Generate" apart from
  // "this same generation just decided it a moment ago". Only the
  // latter is ever allowed to be reshuffled.
  const preExisting = {};
  rosterEmployees.forEach((e) => { preExisting[e.id] = rosterGrid[e.id].slice(); });

  // ---- Step 1: off-days (rules 1 + 2) ----
  // Off-days are LOAD-BALANCED across the week (picking whichever
  // valid day currently has the fewest people off, not a pure random
  // day) rather than pure random — this is what keeps too many people
  // from accidentally landing off on the same day, which is what was
  // forcing the safety net below to fire constantly and break rules 1
  // and 2 in the process.
  function offCountForDay(d) {
    return rosterEmployees.filter((e2) => rosterGrid[e2.id][d] === 'off').length;
  }
  function pickLeastLoadedDay(candidateDays) {
    let minLoad = Infinity;
    candidateDays.forEach((d) => { minLoad = Math.min(minLoad, offCountForDay(d)); });
    return shuffle(candidateDays.filter((d) => offCountForDay(d) === minLoad))[0];
  }

  // Finds the best N-day CONSECUTIVE window that's still blank for
  // BOTH members of a group. Only used for couples with a
  // consecutiveOffTarget (see below).
  function pickLeastLoadedConsecutiveBlock(group, length) {
    let bestLoad = Infinity;
    let bestStarts = [];
    for (let start = 0; start <= 7 - length; start++) {
      const days = Array.from({ length }, (_, i) => start + i);
      const allBlank = days.every((d) => group.every((g) => rosterGrid[g.id][d] === null));
      if (!allBlank) continue;
      const load = days.reduce((sum, d) => sum + offCountForDay(d), 0);
      if (load < bestLoad) { bestLoad = load; bestStarts = [start]; }
      else if (load === bestLoad) { bestStarts.push(start); }
    }
    if (bestStarts.length === 0) return null;
    const start = shuffle(bestStarts)[0];
    return Array.from({ length }, (_, i) => start + i);
  }

  const processed = new Set();

  rosterEmployees.forEach((e) => {
    if (processed.has(e.id)) return;
    const partner = e.partnerId ? rosterEmployees.find((p) => p.id === e.partnerId) : null;
    const group = partner ? [e, partner] : [e];
    group.forEach((g) => processed.add(g.id));

    if (group.length > 1) {
      const consecutiveTarget = Math.max(0, ...group.map((g) => g.consecutiveOffTarget || 0));
      const hasPreset = group.some((g) => rosterGrid[g.id].some((v) => v === 'off'));

      if (consecutiveTarget > 1 && !hasPreset) {
        // e.g. Greg+Violette: fully synced N-consecutive-day block,
        // auto-picked fresh — only when NEITHER has any preset yet,
        // so a manually-set day off (tapped before Generate) is never
        // padded with extra days on top of it.
        const block = pickLeastLoadedConsecutiveBlock(group, Math.min(consecutiveTarget, WEEKLY_DAYS_OFF));
        if (block) block.forEach((d) => group.forEach((g) => { rosterGrid[g.id][d] = 'off'; }));
      } else {
        // Regular couples (or a consecutive-target couple with a
        // preset already in place): guarantee at least 1 shared day
        // off, but only if both members still have room in their
        // quota, so a manual preset that already maxed someone out is
        // never exceeded.
        const hasSharedOff = Array.from({ length: 7 }, (_, d) => d).some((d) => group.every((g) => rosterGrid[g.id][d] === 'off'));
        const allHaveRoom = group.every((g) => rosterGrid[g.id].filter((v) => v === 'off').length < WEEKLY_DAYS_OFF);
        if (!hasSharedOff && allHaveRoom) {
          let candidates = [];
          for (let d = 0; d < 7; d++) if (group.every((g) => rosterGrid[g.id][d] === null)) candidates.push(d);
          if (candidates.length > 0) {
            const sharedDay = pickLeastLoadedDay(candidates);
            group.forEach((g) => { rosterGrid[g.id][sharedDay] = 'off'; });
          }
        }
      }
    }

    // Every employee (solo or in a couple) fills up to their full
    // WEEKLY_DAYS_OFF, one day at a time. Prefers a day the partner is
    // ALREADY off on first (keeps/creates a shared day for free, no
    // extra days needed), otherwise picks the currently-least-loaded
    // remaining blank day.
    group.forEach((g) => {
      let currentOff = rosterGrid[g.id].filter((v) => v === 'off').length;
      while (currentOff < WEEKLY_DAYS_OFF) {
        let blanks = [];
        for (let d = 0; d < 7; d++) if (rosterGrid[g.id][d] === null) blanks.push(d);
        if (blanks.length === 0) break;
        const partnerOffBlanks = g.partnerId ? blanks.filter((d) => rosterGrid[g.partnerId][d] === 'off') : [];
        const d = partnerOffBlanks.length > 0 ? shuffle(partnerOffBlanks)[0] : pickLeastLoadedDay(blanks);
        rosterGrid[g.id][d] = 'off';
        currentOff++;
      }
    });
  });

  // ---- Step 2: farm assignments (rule 3), driven by live trainedFarms
  // and ROSTER_FARM_CONFIG — not hardcoded by employee name. ----
  const guaranteedFarms = Object.keys(ROSTER_FARM_CONFIG).filter((f) => !ROSTER_FARM_CONFIG[f].exemptFromMinimumGuarantee);

  for (let d = 0; d < 7; d++) {
    const working = (id) => rosterGrid[id][d] === null; // still undecided today (not a day off)
    const farmCount = (farmId) => rosterEmployees.filter((e) => rosterGrid[e.id][d] === farmId).length;

    // Single-skill people go straight to their one trained farm —
    // they have no choice, so no need-scoring is involved.
    rosterEmployees.forEach((e) => {
      if (working(e.id) && e.trainedFarms.length === 1) {
        rosterGrid[e.id][d] = e.trainedFarms[0];
      }
    });

    // Multi-skill (cross-trained) people are assigned to whichever of
    // their trained farms needs them most RIGHT NOW: below its
    // minimum is always most urgent, then below its ideal, then
    // nothing needed. This is what makes a cross-trained person (like
    // Greg or Bart) automatically cover a farm that's short-staffed
    // that day, without hardcoding who covers what.
    function farmNeed(farmId) {
      const cfg = ROSTER_FARM_CONFIG[farmId];
      const count = farmCount(farmId);
      if (count < cfg.min) return 1000 + (cfg.min - count); // urgent — below minimum
      if (count < cfg.ideal) return cfg.ideal - count; // wants more, less urgent
      return -1; // already at/above ideal — no need
    }
    rosterEmployees
      .filter((e) => working(e.id) && e.trainedFarms.length > 1)
      .forEach((e) => {
        let bestFarm = null;
        let bestNeed = -Infinity;
        e.trainedFarms.forEach((f) => {
          const need = farmNeed(f);
          if (need > bestNeed) { bestNeed = need; bestFarm = f; }
        });
        if (bestFarm) rosterGrid[e.id][d] = bestFarm;
      });

    // Anyone somehow still unassigned (e.g. an employee with no
    // trained farms at all — a data-entry edge case) gets the day off.
    rosterEmployees.forEach((e) => {
      if (rosterGrid[e.id][d] === null) rosterGrid[e.id][d] = 'off';
    });

    // ---- Soft "companion" preference (best-effort, never at the
    // expense of anyone's day off or another farm's minimum) ----
    // An employee flagged `companionTarget: N` prefers having N other
    // people on their farm when they're working — e.g. Greg (Vickers
    // only) prefers 2 others with him. This is purely a nice-to-have:
    // it only pulls in someone ALREADY working elsewhere that day (a
    // day off is never touched), and only if their current farm can
    // still spare them without dropping below its own minimum.
    rosterEmployees.forEach((e) => {
      if (!e.companionTarget) return;
      const farmId = rosterGrid[e.id][d];
      if (!farmId || farmId === 'off') return;
      const cfg = ROSTER_FARM_CONFIG[farmId];
      const desiredTotal = Math.min(cfg.max, 1 + e.companionTarget);

      while (farmCount(farmId) < desiredTotal) {
        const candidates = rosterEmployees.filter((other) => {
          if (other.id === e.id) return false;
          const otherFarm = rosterGrid[other.id][d];
          if (!otherFarm || otherFarm === 'off' || otherFarm === farmId) return false; // never touch a day off
          if (preExisting[other.id][d] !== null) return false; // never move a cell that was set before this generation (manual or otherwise)
          if (!other.trainedFarms.includes(farmId)) return false;
          return farmCount(otherFarm) - 1 >= ROSTER_FARM_CONFIG[otherFarm].min;
        });
        if (candidates.length === 0) break;
        rosterGrid[candidates[0].id][d] = farmId;
      }
    });

    // ---- Safety net (rule 3, hard guarantee) ----
    // Every non-exempt farm must NEVER fall below its minimum, even in
    // the rare case where everyone trained for it happened to land on
    // a day off. Pulls someone in on their day off as a last resort,
    // preferring to break an individual's day off before a couple's
    // shared one.
    guaranteedFarms.forEach((farmId) => {
      const cfg = ROSTER_FARM_CONFIG[farmId];
      let count = farmCount(farmId);
      while (count < cfg.min) {
        let candidates = rosterEmployees.filter((e) => rosterGrid[e.id][d] === 'off' && preExisting[e.id][d] === null && e.trainedFarms.includes(farmId));
        if (candidates.length === 0) break; // nobody trained for this farm is even off today — truly can't be helped
        candidates.sort((a, b) => {
          const aBreaksShared = a.partnerId && rosterGrid[a.partnerId][d] === 'off' ? 1 : 0;
          const bBreaksShared = b.partnerId && rosterGrid[b.partnerId][d] === 'off' ? 1 : 0;
          return aBreaksShared - bBreaksShared;
        });
        rosterGrid[candidates[0].id][d] = farmId;
        count++;
      }
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
      <p class="roster-preview-hint">Tap "Edit Roster" to edit</p>
      <button class="card-btn primary" id="rosterOpenBtn"><i class="ti ti-table"></i>Edit Roster</button>
    </div>

    <!-- ================= MAIN ROSTER OVERLAY ================= -->
    <div class="overlay" id="rosterOverlay">
      <div class="overlay-header">
        <button class="close-btn" id="rosterBackBtn" aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <h1>Farm Roster</h1>
      </div>

      <div class="roster-week-nav">
        <button class="roster-week-nav__btn" id="rosterWeekPrevBtn" aria-label="Previous week">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <p class="roster-week-label" id="rosterOverlayWeekLabel"></p>
        <button class="roster-week-nav__btn" id="rosterWeekNextBtn" aria-label="Next week">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
        </button>
      </div>
      <p class="roster-readonly-banner" id="rosterReadonlyBanner" style="display:none;"><i class="ti ti-lock"></i>This week has already passed — read-only</p>

      <!-- Legend + grid shown here for reference — "Share Roster"
           below draws its own canvas from the same data (see
           drawRosterCanvas() in init()), it doesn't screenshot this. -->
      <div>
        <div class="roster-legend" id="rosterLegend"></div>
        <div class="roster-grid-wrap"><div class="roster-grid" id="rosterGridEl"></div></div>
      </div>

      <div style="margin: 0 1.5rem 2rem;">
        <button class="card-btn" id="rosterShareBtn"><i class="ti ti-share"></i>Share Roster</button>
      </div>

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
        <div class="sheet-header">
          <button class="sheet-back-btn" id="rosterCellSheetBackBtn" aria-label="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <h2 id="rosterCellSheetTitle">Assign</h2>
        </div>
        <div id="rosterCellOptions"></div>
      </div>
    </div>

    <!-- ================= MANAGE EMPLOYEES SHEET ================= -->
    <div class="sheet-mask" id="rosterEmployeesSheetMask">
      <div class="sheet">
        <div class="sheet-header">
          <button class="sheet-back-btn" id="rosterEmployeesSheetBackBtn" aria-label="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <h2>Manage Employees</h2>
        </div>
        <div id="rosterEmployeesList"></div>
        <button class="card-btn primary" id="rosterAddEmployeeBtn" style="margin: 0.5rem 1.5rem 0; width: calc(100% - 3rem);"><i class="ti ti-plus"></i>Add Employee</button>
      </div>
    </div>

    <!-- ================= EMPLOYEE ADD/EDIT FORM SHEET ================= -->
    <div class="sheet-mask" id="rosterEmployeeFormSheetMask">
      <div class="sheet">
        <div class="sheet-header">
          <button class="sheet-back-btn" id="rosterEmployeeFormBackBtn" aria-label="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <h2 id="rosterEmployeeFormTitle">Add Employee</h2>
        </div>

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
        <div class="sheet-header">
          <button class="sheet-back-btn" id="rosterStaffingSheetBackBtn" aria-label="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <h2>Farm Staffing</h2>
        </div>
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

    // ---- Week label + nav ----
    function isPastWeek() { return currentWeekOffset < 0; }

    function renderWeekLabel() {
      const dates = weekDates();
      const label = currentWeekOffset === 0
        ? `This week (${DOW_LABELS[0]} ${dates[0].getDate()} ${dates[0].toLocaleString('en-US', { month: 'short' })} – ${DOW_LABELS[6]} ${dates[6].getDate()} ${dates[6].toLocaleString('en-US', { month: 'short' })})`
        : `${DOW_LABELS[0]} ${dates[0].getDate()} ${dates[0].toLocaleString('en-US', { month: 'short' })} – ${DOW_LABELS[6]} ${dates[6].getDate()} ${dates[6].toLocaleString('en-US', { month: 'short' })}`;
      document.getElementById('rosterWeekLabel').textContent = 'This week';
      document.getElementById('rosterOverlayWeekLabel').textContent = label;

      const prevBtn = document.getElementById('rosterWeekPrevBtn');
      const nextBtn = document.getElementById('rosterWeekNextBtn');
      if (prevBtn) prevBtn.disabled = currentWeekOffset <= -ROSTER_WEEKS_BACK;
      if (nextBtn) nextBtn.disabled = currentWeekOffset >= ROSTER_WEEKS_FORWARD;

      const banner = document.getElementById('rosterReadonlyBanner');
      if (banner) banner.style.display = isPastWeek() ? 'flex' : 'none';

      // Generate/Clear only make sense for a week that can still be edited.
      const generateBtn = document.getElementById('rosterGenerateBtn');
      const clearBtn = document.getElementById('rosterClearBtn');
      if (generateBtn) generateBtn.disabled = isPastWeek() || !isOwner();
      if (clearBtn) clearBtn.disabled = isPastWeek() || !isOwner();
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
      // Overlay grid: interactive (Owner only, and only for the
      // current/a future week — buildGridHtml already disables
      // buttons for Greg or a past week via the checks inside it).
      const overlayEl = document.getElementById('rosterGridEl');
      if (overlayEl) {
        overlayEl.innerHTML = buildGridHtml(isPastWeek());
        overlayEl.querySelectorAll('.roster-cell-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            if (!isOwner() || isPastWeek()) return;
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
      el.innerHTML = rosterEmployees.map((emp, i) => {
        const farmsLabel = emp.trainedFarms.map(farmName).join(', ') || 'No farms trained';
        const partner = emp.partnerId ? rosterEmployees.find((e) => e.id === emp.partnerId) : null;
        const meta = partner ? `${farmsLabel} · Couple with ${partner.name}` : farmsLabel;
        return `
          <div class="roster-emp-row" data-id="${emp.id}">
            <div class="roster-emp-row__reorder">
              <button class="roster-emp-row__move" data-id="${emp.id}" data-dir="-1" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>
              </button>
              <button class="roster-emp-row__move" data-id="${emp.id}" data-dir="1" aria-label="Move down" ${i === rosterEmployees.length - 1 ? 'disabled' : ''}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
              </button>
            </div>
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

      // Reordering directly changes rosterEmployees' array order, which
      // is also the order the main grid's rows render in — so moving
      // someone here immediately reorders the table too. Plain
      // button taps, not a drag gesture: this is the reliable option
      // that works the same way on every phone, no touch-gesture
      // quirks to fight with.
      el.querySelectorAll('.roster-emp-row__move').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.id;
          const dir = parseInt(btn.dataset.dir, 10);
          const index = rosterEmployees.findIndex((e) => e.id === id);
          const swapWith = index + dir;
          if (swapWith < 0 || swapWith >= rosterEmployees.length) return;
          [rosterEmployees[index], rosterEmployees[swapWith]] = [rosterEmployees[swapWith], rosterEmployees[index]];
          saveEmployeesToStorage();
          renderEmployeesList();
          renderGrid();
        });
      });

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
    function goToWeek(newOffset) {
      newOffset = Math.max(-ROSTER_WEEKS_BACK, Math.min(ROSTER_WEEKS_FORWARD, newOffset));
      if (newOffset === currentWeekOffset) return;
      saveGridToStorage(); // persist whatever's on screen for the week we're leaving
      currentWeekOffset = newOffset;
      rosterGrid = {};
      rosterEmployees.forEach((e) => ensureGridRow(e.id));
      loadGridFromStorage();
      renderAll();
    }

    function openRosterOverlay() {
      renderAll();
      document.getElementById('rosterOverlay').classList.add('show');
    }
    function closeRosterOverlay() {
      document.getElementById('rosterOverlay').classList.remove('show');
      // Always leave the overlay parked on "this week" — that's what
      // the dashboard card's live preview should always reflect,
      // regardless of which week was last being browsed.
      if (currentWeekOffset !== 0) goToWeek(0);
    }

    function applyRolePermissions() {
      document.getElementById('rosterOwnerActions').style.display = isOwner() ? 'flex' : 'none';
      renderGrid(); // re-render so cell buttons become enabled/disabled to match
    }

    document.getElementById('rosterOpenBtn').addEventListener('click', openRosterOverlay);
    document.getElementById('rosterWeekPrevBtn').addEventListener('click', () => goToWeek(currentWeekOffset - 1));
    document.getElementById('rosterWeekNextBtn').addEventListener('click', () => goToWeek(currentWeekOffset + 1));

    // Back arrows for the 4 sheets, plus tap-outside-the-sheet to close.
    document.getElementById('rosterCellSheetBackBtn').addEventListener('click', closeCellSheet);
    document.getElementById('rosterEmployeesSheetBackBtn').addEventListener('click', closeEmployeesSheet);
    document.getElementById('rosterEmployeeFormBackBtn').addEventListener('click', closeEmployeeForm);
    document.getElementById('rosterStaffingSheetBackBtn').addEventListener('click', closeStaffingSheet);
    [
      ['rosterCellSheetMask', closeCellSheet],
      ['rosterEmployeesSheetMask', closeEmployeesSheet],
      ['rosterEmployeeFormSheetMask', closeEmployeeForm],
      ['rosterStaffingSheetMask', closeStaffingSheet],
    ].forEach(([maskId, closeFn]) => {
      document.getElementById(maskId).addEventListener('click', (e) => {
        if (e.target.id === maskId) closeFn();
      });
    });
    document.getElementById('rosterBackBtn').addEventListener('click', closeRosterOverlay);

    // ---- Share Roster: draws the grid + legend directly onto a
    // <canvas> (not a DOM screenshot) and opens the device's native
    // share sheet (WhatsApp, Messages, email...), same idea as "Share
    // the app" in js/core.js. Drawing it by hand — rather than
    // html2canvas-ing the on-screen grid — avoids two problems a DOM
    // screenshot has here: the grid's own horizontal scroll clips
    // Saturday/Sunday out of frame, and the captured box otherwise
    // includes surrounding margin/padding as blank space. This way the
    // image is exactly the table + legend, nothing else. Available to
    // everyone, not just the Owner — sharing a read-only snapshot
    // isn't an edit action. ----
    function drawRosterCanvas() {
      const dates = weekDates();
      const farmIdsForLegend = Object.keys(ROSTER_FARM_CONFIG);
      const scale = 2; // render at 2x for a crisp share image

      const nameColWidth = 130;
      const dayColWidth = 84;
      const headerHeight = 56;
      const rowHeight = 48;
      const legendRowHeight = 30;
      const padding = 20;

      const gridWidth = nameColWidth + dayColWidth * 7;
      const width = gridWidth + padding * 2;
      const legendHeight = 20 + Math.ceil((farmIdsForLegend.length + 1) / 2) * legendRowHeight;
      const height = padding + headerHeight + rowHeight * rosterEmployees.length + legendHeight + padding;

      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);

      // Background — always light, regardless of the app's current
      // theme, so the shared image reads well in any chat app.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      let y = padding;
      const gridLeft = padding;

      // Day headers
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#6b7280';
      ctx.font = '600 12px -apple-system, sans-serif';
      dates.forEach((d, i) => {
        const cx = gridLeft + nameColWidth + i * dayColWidth + dayColWidth / 2;
        ctx.textAlign = 'center';
        ctx.fillText(DOW_LABELS[i], cx, y + headerHeight / 2 - 8);
        ctx.font = '700 13px -apple-system, sans-serif';
        ctx.fillStyle = '#111827';
        ctx.fillText(`${d.getDate()}/${d.getMonth() + 1}`, cx, y + headerHeight / 2 + 10);
        ctx.font = '600 12px -apple-system, sans-serif';
        ctx.fillStyle = '#6b7280';
      });
      y += headerHeight;

      // Rows
      rosterEmployees.forEach((emp, rowIdx) => {
        if (rowIdx % 2 === 1) {
          ctx.fillStyle = '#f9fafb';
          ctx.fillRect(gridLeft, y, gridWidth, rowHeight);
        }
        ctx.fillStyle = '#111827';
        ctx.font = '700 13px -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(emp.name, gridLeft + 12, y + rowHeight / 2);

        for (let d = 0; d < 7; d++) {
          const val = rosterGrid[emp.id][d];
          const cx = gridLeft + nameColWidth + d * dayColWidth + dayColWidth / 2;
          const cy = y + rowHeight / 2;
          if (val === 'off' || !val) {
            ctx.strokeStyle = '#d1d5db';
            ctx.setLineDash([3, 2]);
            ctx.strokeRect(cx - 30, cy - 10, 60, 20);
            ctx.setLineDash([]);
            ctx.fillStyle = '#9ca3af';
            ctx.font = '600 10px -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Off', cx, cy);
          } else {
            const color = ROSTER_FARM_CONFIG[val] ? ROSTER_FARM_CONFIG[val].color : '#999';
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.roundRect(cx - 30, cy - 10, 60, 20, 6);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.font = '700 10px -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(farmInitial(val), cx, cy);
          }
        }
        y += rowHeight;
      });

      // Legend
      y += 16;
      ctx.textAlign = 'left';
      let lx = gridLeft;
      let col = 0;
      const legendEntries = farmIdsForLegend.map((f) => ({ label: farmName(f), color: ROSTER_FARM_CONFIG[f].color }))
        .concat([{ label: 'Day off', color: null }]);
      legendEntries.forEach((entry) => {
        const colX = gridLeft + (col % 2) * (gridWidth / 2);
        const rowY = y + Math.floor(col / 2) * legendRowHeight;
        if (entry.color) {
          ctx.fillStyle = entry.color;
          ctx.beginPath();
          ctx.roundRect(colX, rowY, 14, 14, 4);
          ctx.fill();
        } else {
          ctx.strokeStyle = '#9ca3af';
          ctx.setLineDash([2, 2]);
          ctx.strokeRect(colX, rowY, 14, 14);
          ctx.setLineDash([]);
        }
        ctx.fillStyle = '#374151';
        ctx.font = '600 12px -apple-system, sans-serif';
        ctx.fillText(entry.label, colX + 20, rowY + 7);
        col++;
      });

      return canvas;
    }

    document.getElementById('rosterShareBtn').addEventListener('click', async () => {
      try {
        const canvas = drawRosterCanvas();
        canvas.toBlob(async (blob) => {
          if (!blob) { showToast('Could not create the roster image'); return; }
          const file = new File([blob], 'farmsmart-roster.png', { type: 'image/png' });
          const shareData = { files: [file], title: 'FarmSmart Roster', text: "This week's farm roster." };

          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try { await navigator.share(shareData); } catch (e) { /* person cancelled the share sheet */ }
          } else {
            // No file-sharing support on this browser — download the
            // image instead so it can still be attached manually.
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'farmsmart-roster.png';
            a.click();
            URL.revokeObjectURL(url);
            showToast('Roster image downloaded');
          }
        }, 'image/png');
      } catch (e) {
        showToast('Could not create the roster image');
      }
    });

    document.getElementById('rosterGenerateBtn').addEventListener('click', () => {
      if (isPastWeek() || !isOwner()) return;
      generateRoster();
      saveGridToStorage();
      renderGrid();
      showToast('Roster generated');
    });
    document.getElementById('rosterClearBtn').addEventListener('click', () => {
      if (isPastWeek() || !isOwner()) return;
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
