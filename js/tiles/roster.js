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

// ---- Farms are now company data, not code: this used to be a fixed
// object with exactly 3 hardcoded keys (laang/vickers/maguires) —
// that's why there was never an "Add Farm" button. Now it's a plain
// list loaded from Supabase (`roster_farms`, same project as
// employees), so a farm can be added/renamed/recolored/removed from
// "Farm Staffing" and it works for ANY company, not just this one.
// Colors are deliberately different from the app's functional status
// colors (yellow=action, green=ok, red=alert, blue=info) so a farm
// color in the grid is never confused with a status elsewhere. ----
const ROSTER_FARM_COLOR_PALETTE = ['#2A9D8F', '#8B5FBF', '#E8792E', '#3B82C4', '#C4457B', '#7A8B3F', '#B08900', '#5A5A8C'];

// One-time seed only, and only as the in-memory default shown for the
// instant before loadFarmsFromSupabase() resolves — mirrors
// SEED_EMPLOYEES below. Never re-copied into the database automatically;
// if `roster_farms` is empty, the app just shows an empty "Farm
// Staffing" list until someone taps "Add Farm" (or these are inserted
// directly in Supabase — see the SQL notes sent alongside this file).
const SEED_FARMS = [
  { id: 'laang',    name: 'Laang Farm',          company: 'Moloney Sharefarming Trust', color: '#2A9D8F', min: 1, ideal: 1, max: 1, exemptFromMinimumGuarantee: true },
  { id: 'vickers',  name: 'Vickers Road Panmure', company: 'Moloney Sharefarming Trust', color: '#8B5FBF', min: 2, ideal: 2, max: 3 },
  { id: 'maguires', name: 'Maguires Road Dairy',  company: 'Moloney Sharefarming Trust', color: '#E8792E', min: 1, ideal: 2, max: 2 },
];
let rosterFarms = SEED_FARMS.map((f) => ({ ...f })); // populated for real by loadFarmsFromSupabase() at init

function getFarm(farmId) { return rosterFarms.find((f) => f.id === farmId); }

// ---- Roster rules — now configurable from "Farm Staffing" instead of
// fixed in code, same Supabase-backed pattern as farms/employees.
// `weeklyDaysOff` replaces the old WEEKLY_DAYS_OFF constant.
// `coupleSharedDayOff` is the on/off switch: when on (default), the
// generator tries (best-effort — never forced) to line up at least 1
// shared day off for each couple; when off, everyone's off-days are
// picked independently, partner or not. ----
let rosterSettings = { weeklyDaysOff: 2, coupleSharedDayOff: true }; // replaced by loadSettingsFromSupabase() at init

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
// One-time seed only — copied into Supabase the very first time the
// roster_employees table is empty (see loadEmployeesFromSupabase()).
// Never read directly again after that: the database is the source of
// truth from then on, editable via "Manage Employees" like before.
const SEED_EMPLOYEES = [
  { id: 'greg',      name: 'Greg',       trainedFarms: ['vickers'], partnerId: 'violette' },
  { id: 'violette',  name: 'Violette',   trainedFarms: ['maguires'],            partnerId: 'greg' },
  { id: 'lucia',     name: 'Lucia',      trainedFarms: ['vickers'],             partnerId: 'bart' },
  { id: 'bart',      name: 'Bart',       trainedFarms: ['vickers', 'maguires'], partnerId: 'lucia' },
  { id: 'elsep',     name: 'Else',       trainedFarms: ['vickers'],             partnerId: null },
  { id: 'carolinas', name: 'Carolina',   trainedFarms: ['laang'],               partnerId: null },
];
let rosterEmployees = SEED_EMPLOYEES.map((e) => ({ ...e })); // populated for real by loadEmployeesFromSupabase() at init

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
// PERSISTENCE — employees, farms and the weekly grid all live in
// Supabase now (same project as Farm Plan), so they're shared across
// every device rather than saved per-browser. Nothing in this tile
// uses localStorage any more.
// ---------------------------------------------------------------------

// Same Supabase project as Farm Plan — one project for the whole app.
const SUPABASE_URL = 'https://gissuvlnkztpbvghymmz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdpc3N1dmxua3p0cGJ2Z2h5bW16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyOTUxMTAsImV4cCI6MjEwNTg3MTExMH0.iPshYfbWiiFNGjGQVKNxy55M5kbBci3Ti--4xbUOVM0';
let rosterSupabaseClient = null;
function rosterSb() {
  if (rosterSupabaseClient) return rosterSupabaseClient;
  if (typeof window.supabase === 'undefined') throw new Error('supabase-js not loaded — check the <script> tag in index.html');
  rosterSupabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return rosterSupabaseClient;
}

// Employees are no longer hardcoded — this loads them from Supabase,
// shared across every device. The very first time the table is empty
// (brand new Supabase project), it's seeded from SEED_EMPLOYEES once.
async function loadEmployeesFromSupabase() {
  const client = rosterSb();
  const { data, error } = await client.from('roster_employees').select('*').order('sort_order', { ascending: true });
  if (error) throw error;

  // No auto-seeding — an empty table just means an empty roster until
  // someone adds employees via "Manage Employees" (or directly in
  // Supabase). SEED_EMPLOYEES below is unused now, kept only as a
  // reference for the shape a row should have.
  rosterEmployees = (data || []).map(rowToEmployee);
  rosterGrid = {};
  rosterEmployees.forEach((e) => ensureGridRow(e.id));
}

// Full-replace sync: simplest correct approach at this small scale —
// delete every row and re-insert the current in-memory list, with
// sort_order matching its array order (order matters for the roster
// generation algorithm, e.g. Greg+Violette need to be processed a
// particular way — see generateRoster()).
async function saveEmployeesToSupabase() {
  const client = rosterSb();
  const { error: delErr } = await client.from('roster_employees').delete().neq('id', '__none__');
  if (delErr) throw delErr;
  if (rosterEmployees.length) {
    const rows = rosterEmployees.map((e, i) => employeeToRow(e, i));
    const { error: insErr } = await client.from('roster_employees').insert(rows);
    if (insErr) throw insErr;
  }
}

function employeeToRow(e, sortOrder) {
  return {
    id: e.id, preferred_name: e.name,
    trained_farms: e.trainedFarms, partner_id: e.partnerId || null,
    company: e.company || null,
    employment_type: e.employmentType || null, hourly_rate: e.hourlyRate || null, classification: e.classification || null,
    xero_employee_id: e.xeroEmployeeId || null,
    app_role: e.appRole || null,
    sort_order: sortOrder,
  };
}
function rowToEmployee(r) {
  // `name` (what the rest of the app displays and matches on) is the preferred name.
  const e = { id: r.id, name: r.preferred_name || r.id, trainedFarms: r.trained_farms || [], partnerId: r.partner_id || null };
  if (r.company) e.company = r.company;
  if (r.employment_type) e.employmentType = r.employment_type;
  if (r.hourly_rate) e.hourlyRate = r.hourly_rate;
  if (r.classification) e.classification = r.classification;
  if (r.xero_employee_id) e.xeroEmployeeId = r.xero_employee_id;
  if (r.app_role) e.appRole = r.app_role;
  return e;
}

// Fire-and-forget wrapper used at every edit point below — keeps the
// existing call sites unchanged in spirit (instant local update, sync
// happens in the background) while surfacing a toast if it fails.
function saveEmployeesToStorage() {
  saveEmployeesToSupabase().catch((err) => {
    console.error('[roster] failed to save employees:', err);
    showToast('Could not save — check your connection');
  });
}

// ---- Farms: same full-replace pattern as employees above ----
async function loadFarmsFromSupabase() {
  const client = rosterSb();
  const { data, error } = await client.from('roster_farms').select('*').order('sort_order', { ascending: true });
  if (error) throw error;
  // No auto-seeding here either — an empty table just means "Farm
  // Staffing" starts empty until someone taps "Add Farm".
  rosterFarms = (data || []).map(rowToFarm);
}
async function saveFarmsToSupabase() {
  const client = rosterSb();
  const { error: delErr } = await client.from('roster_farms').delete().neq('id', '__none__');
  if (delErr) throw delErr;
  if (rosterFarms.length) {
    const rows = rosterFarms.map((f, i) => farmToRow(f, i));
    const { error: insErr } = await client.from('roster_farms').insert(rows);
    if (insErr) throw insErr;
  }
}
function farmToRow(f, sortOrder) {
  return {
    id: f.id, name: f.name, company: f.company || null, color: f.color,
    min_staff: f.min, ideal_staff: f.ideal, max_staff: f.max,
    exempt_from_minimum: !!f.exemptFromMinimumGuarantee,
    sort_order: sortOrder,
  };
}
function rowToFarm(r) {
  return {
    id: r.id, name: r.name, company: r.company || undefined, color: r.color,
    min: r.min_staff, ideal: r.ideal_staff, max: r.max_staff,
    exemptFromMinimumGuarantee: !!r.exempt_from_minimum,
  };
}
function saveFarmsToStorage() {
  saveFarmsToSupabase().catch((err) => {
    console.error('[roster] failed to save farms:', err);
    showToast('Could not save — check your connection');
  });
}

// ---- Roster rules (weekly days off + couple day-off toggle) — a
// single row, upserted rather than delete+reinsert since there's only
// ever one. An empty table (fresh Supabase project) just keeps the
// in-memory defaults above until "Farm Staffing" is saved once.
async function loadSettingsFromSupabase() {
  const client = rosterSb();
  const { data, error } = await client.from('roster_settings').select('*').eq('id', 'global').maybeSingle();
  if (error) throw error;
  if (data) {
    rosterSettings = {
      weeklyDaysOff: typeof data.weekly_days_off === 'number' ? data.weekly_days_off : rosterSettings.weeklyDaysOff,
      coupleSharedDayOff: typeof data.couple_shared_day_off === 'boolean' ? data.couple_shared_day_off : rosterSettings.coupleSharedDayOff,
    };
  }
}
async function saveSettingsToSupabase() {
  const client = rosterSb();
  const { error } = await client.from('roster_settings').upsert({
    id: 'global',
    weekly_days_off: rosterSettings.weeklyDaysOff,
    couple_shared_day_off: rosterSettings.coupleSharedDayOff,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}
function saveSettingsToStorage() {
  saveSettingsToSupabase().catch((err) => {
    console.error('[roster] failed to save roster settings:', err);
    showToast('Could not save — check your connection');
  });
}

// ---- The weekly grid: one row per employee per day worked, keyed by
// the REAL calendar date (not a week-offset+day-index pair) — this is
// what makes "Tue 3 Nov" the same cell no matter which device or which
// week-nav path got you there. A blank cell simply has no row; only
// 'off' or a farm id are ever stored. Same full-replace pattern as
// employees/farms, scoped to the 7 dates of whichever week is showing. ----
function isoDate(d) { return d.toISOString().slice(0, 10); }

async function loadGridFromSupabase(offset) {
  const dates = weekDates(offset).map(isoDate);
  const client = rosterSb();
  const { data, error } = await client.from('roster_shifts').select('*').in('work_date', dates);
  if (error) throw error;
  rosterGrid = {};
  rosterEmployees.forEach((e) => ensureGridRow(e.id));
  (data || []).forEach((row) => {
    if (!rosterGrid[row.employee_id]) return; // employee no longer exists — ignore
    const dayIndex = dates.indexOf(row.work_date);
    if (dayIndex === -1) return;
    rosterGrid[row.employee_id][dayIndex] = row.assignment;
  });
}
async function saveGridToSupabase(offset) {
  const dates = weekDates(offset).map(isoDate);
  const client = rosterSb();
  const { error: delErr } = await client.from('roster_shifts').delete().in('work_date', dates);
  if (delErr) throw delErr;
  const rows = [];
  rosterEmployees.forEach((e) => {
    dates.forEach((workDate, d) => {
      const val = rosterGrid[e.id] ? rosterGrid[e.id][d] : null;
      if (val) rows.push({ employee_id: e.id, work_date: workDate, assignment: val });
    });
  });
  if (rows.length) {
    const { error: insErr } = await client.from('roster_shifts').insert(rows);
    if (insErr) throw insErr;
  }
}
// Fire-and-forget wrapper, same spirit as saveEmployeesToStorage —
// always saves whichever week is CURRENTLY in memory (currentWeekOffset),
// so every existing call site (cell edit, Generate, Clear, leaving a
// week) keeps working unchanged.
function saveGridToStorage() {
  saveGridToSupabase(currentWeekOffset).catch((err) => {
    console.error('[roster] failed to save roster:', err);
    showToast('Could not save — check your connection');
  });
}


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
  // Reads from THIS tile's own `rosterFarms` (Farm Staffing), not the
  // app-wide farm switcher in core.js — those two lists are separate
  // on purpose: a farm added here via "Add Farm" has no entry in the
  // header switcher, and shouldn't need one just to show its name.
  const farm = getFarm(farmId);
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
  // Built around exactly these 3 rules, in this priority order — 1 and
  // 2 are absolute and NEVER broken to satisfy 3:
  //   1. Every employee gets exactly `rosterSettings.weeklyDaysOff`
  //      days off/week, always. Nothing below ever cancels a day off
  //      to cover a farm. Configurable in "Farm Staffing".
  //   2. If `rosterSettings.coupleSharedDayOff` is on (the default),
  //      each couple (anyone with a partnerId) shares at least 1 of
  //      those days off — best-effort, never forced. Toggle it off in
  //      "Farm Staffing" to pick every employee's off-days
  //      independently, partner or not.
  //   3. Every farm's MINIMUM is a best-effort target, filled only from
  //      people who are already working that day (step 2 below) — if
  //      everyone trained for a farm happens to be off, it just runs
  //      short that day. A farm flagged `exemptFromMinimumGuarantee: true`
  //      in "Farm Staffing" (Laang, since Carolina is solo there) is
  //      expected to run short often; any farm can now run short
  //      occasionally too, e.g. with only 1-2 people trained for it.
  //
  // DATA-DRIVEN, not hardcoded by name: farm assignment (step 2) reads
  // each employee's live `trainedFarms` and the live `rosterFarms` list
  // (min/ideal/max, loaded from Supabase) — so editing an employee's
  // trained farms, adding/renaming/recoloring a farm in "Farm
  // Staffing", or adding a brand-new employee in "Manage Employees"
  // all take effect on the next Generate, with no code change needed.
  //
  // Only cells still blank (null) are ever touched — anything already
  // set by hand (tap a cell before generating) is left alone.
  // ======================================================================

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

  const processed = new Set();

  rosterEmployees.forEach((e) => {
    if (processed.has(e.id)) return;
    const partner = e.partnerId ? rosterEmployees.find((p) => p.id === e.partnerId) : null;
    const group = partner ? [e, partner] : [e];
    group.forEach((g) => processed.add(g.id));

    if (group.length > 1 && rosterSettings.coupleSharedDayOff) {
      // Guarantee at least 1 shared day off, but only if both members
      // still have room in their quota, so a manual preset that
      // already maxed someone out is never exceeded.
      const hasSharedOff = Array.from({ length: 7 }, (_, d) => d).some((d) => group.every((g) => rosterGrid[g.id][d] === 'off'));
      const allHaveRoom = group.every((g) => rosterGrid[g.id].filter((v) => v === 'off').length < rosterSettings.weeklyDaysOff);
      if (!hasSharedOff && allHaveRoom) {
        let candidates = [];
        for (let d = 0; d < 7; d++) if (group.every((g) => rosterGrid[g.id][d] === null)) candidates.push(d);
        if (candidates.length > 0) {
          const sharedDay = pickLeastLoadedDay(candidates);
          group.forEach((g) => { rosterGrid[g.id][sharedDay] = 'off'; });
        }
      }
    }

    // Every employee (solo or in a couple) fills up to their full
    // rosterSettings.weeklyDaysOff, one day at a time. When the couple
    // toggle is on, prefers a day the partner is ALREADY off on first
    // (keeps/creates a shared day for free, no extra days needed);
    // otherwise (toggle off, or no partner) just picks the
    // currently-least-loaded remaining blank day.
    group.forEach((g) => {
      let currentOff = rosterGrid[g.id].filter((v) => v === 'off').length;
      while (currentOff < rosterSettings.weeklyDaysOff) {
        let blanks = [];
        for (let d = 0; d < 7; d++) if (rosterGrid[g.id][d] === null) blanks.push(d);
        if (blanks.length === 0) break;
        const partnerOffBlanks = (g.partnerId && rosterSettings.coupleSharedDayOff) ? blanks.filter((d) => rosterGrid[g.partnerId][d] === 'off') : [];
        const d = partnerOffBlanks.length > 0 ? shuffle(partnerOffBlanks)[0] : pickLeastLoadedDay(blanks);
        rosterGrid[g.id][d] = 'off';
        currentOff++;
      }
    });
  });

  // ---- Step 2: farm assignments (rule 3), driven by live trainedFarms
  // and the live rosterFarms list — not hardcoded by employee name. ----
  const guaranteedFarms = rosterFarms.filter((f) => !f.exemptFromMinimumGuarantee).map((f) => f.id);

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
      const cfg = getFarm(farmId);
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

    // ---- Farm minimums are best-effort, NEVER at the cost of a day off ----
    // Rule 1 (everyone gets their 2 days off/week) always wins over
    // rule 3 (farm minimum). There used to be a "safety net" here that
    // pulled someone in on their day off as a last resort when a farm
    // fell short — that's exactly what caused a 2-person, 2-farm setup
    // to work every single person 7 days a week, since neither could
    // ever be "spared" to rest without leaving their own farm empty.
    // So this pass no longer touches anyone who is off: if every
    // employee trained for a non-exempt farm happens to be off the
    // same day, that farm is simply understaffed that day — surfaced
    // to the Owner via the "Farm Staffing" live check (see
    // renderStaffingCheck below), not silently fixed by cancelling a
    // day off. `guaranteedFarms` is kept only for that informational
    // check and for the below-min urgency scoring above.
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

        <p class="roster-form-label">Preferred name (shown everywhere in the app)</p>
        <input type="text" class="roster-text-input" id="rosterEmployeeNameInput" placeholder="e.g. Greg">

        <p class="roster-form-label">Company</p>
        <input type="text" class="roster-text-input" id="rosterEmployeeCompanyInput" placeholder="e.g. Moloney Sharefarming Trust">

        <p class="roster-form-label">Award status</p>
        <div class="roster-chip-row" id="rosterEmployeeEmploymentChips">
          <button type="button" class="roster-chip" data-emptype="casual">Casual</button>
          <button type="button" class="roster-chip" data-emptype="permanent">Permanent</button>
        </div>
        <div id="rosterEmployeeRateRow" hidden>
          <p class="roster-form-label">Hourly rate ($)</p>
          <input type="number" step="0.01" min="0" class="roster-text-input" id="rosterEmployeeRateInput" placeholder="e.g. 28.50">
        </div>
        <div id="rosterEmployeeClassRow" hidden>
          <p class="roster-form-label">Classification (dairy)</p>
          <div class="roster-chip-row" id="rosterEmployeeClassChips">
            <button type="button" class="roster-chip" data-class="FLH1">FLH1</button>
            <button type="button" class="roster-chip" data-class="FLH2">FLH2</button>
            <button type="button" class="roster-chip" data-class="FLH3">FLH3</button>
            <button type="button" class="roster-chip" data-class="FLH5">FLH5</button>
            <button type="button" class="roster-chip" data-class="FLH7">FLH7</button>
            <button type="button" class="roster-chip" data-class="FLH8">FLH8</button>
          </div>
        </div>

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

        <div class="roster-staffing-row" style="margin: 0 1.5rem 1.5rem;">
          <div class="roster-staffing-row__title"><i class="ti ti-calendar-off"></i>Days off per week</div>
          <div class="roster-stepper-group">
            <div class="roster-stepper">
              <div class="roster-stepper__controls">
                <button type="button" class="roster-stepper__btn" id="rosterDaysOffMinusBtn">−</button>
                <span class="roster-stepper__value" id="rosterDaysOffValue">2</span>
                <button type="button" class="roster-stepper__btn" id="rosterDaysOffPlusBtn">+</button>
              </div>
            </div>
          </div>
        </div>

        <p class="roster-form-label">Couples</p>
        <div class="roster-chip-row">
          <button type="button" class="roster-chip" id="rosterCoupleDayOffChip"><i class="ti ti-heart"></i>Try to fit at least 1 day off together</button>
        </div>

        <p class="roster-week-label" style="margin: 1.5rem 1.5rem 1.5rem;">Target headcount per day, for the roster generator.</p>
        <div id="rosterStaffingList"></div>
        <button class="card-btn primary" id="rosterAddFarmBtn" style="margin: 0.5rem 1.5rem 0; width: calc(100% - 3rem);"><i class="ti ti-plus"></i>Add Farm</button>
      </div>
    </div>

    <!-- ================= FARM ADD/EDIT FORM SHEET ================= -->
    <div class="sheet-mask" id="rosterFarmFormSheetMask">
      <div class="sheet">
        <div class="sheet-header">
          <button class="sheet-back-btn" id="rosterFarmFormBackBtn" aria-label="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <h2 id="rosterFarmFormTitle">Add Farm</h2>
        </div>

        <p class="roster-form-label">Farm name</p>
        <input type="text" class="roster-text-input" id="rosterFarmNameInput" placeholder="e.g. Vickers Road Panmure">

        <p class="roster-form-label">Company</p>
        <input type="text" class="roster-text-input" id="rosterFarmCompanyInput" placeholder="e.g. Moloney Sharefarming Trust">

        <p class="roster-form-label">Color</p>
        <div class="roster-color-row" id="rosterFarmColorChips"></div>

        <p class="roster-form-label">Target headcount per day</p>
        <div class="roster-staffing-row" style="margin: 0 1.5rem 1.5rem;">
          <div class="roster-stepper-group">
            <div class="roster-stepper">
              <div class="roster-stepper__label">min</div>
              <div class="roster-stepper__controls">
                <button type="button" class="roster-stepper__btn" data-key="min" data-dir="-1">−</button>
                <span class="roster-stepper__value" id="rosterFarmForm-min">1</span>
                <button type="button" class="roster-stepper__btn" data-key="min" data-dir="1">+</button>
              </div>
            </div>
            <div class="roster-stepper">
              <div class="roster-stepper__label">ideal</div>
              <div class="roster-stepper__controls">
                <button type="button" class="roster-stepper__btn" data-key="ideal" data-dir="-1">−</button>
                <span class="roster-stepper__value" id="rosterFarmForm-ideal">1</span>
                <button type="button" class="roster-stepper__btn" data-key="ideal" data-dir="1">+</button>
              </div>
            </div>
            <div class="roster-stepper">
              <div class="roster-stepper__label">max</div>
              <div class="roster-stepper__controls">
                <button type="button" class="roster-stepper__btn" data-key="max" data-dir="-1">−</button>
                <span class="roster-stepper__value" id="rosterFarmForm-max">2</span>
                <button type="button" class="roster-stepper__btn" data-key="max" data-dir="1">+</button>
              </div>
            </div>
          </div>
        </div>

        <p class="roster-form-label">Guarantee</p>
        <div class="roster-chip-row">
          <button type="button" class="roster-chip" id="rosterFarmExemptChip">Exempt from minimum guarantee</button>
        </div>

        <button class="card-btn primary" id="rosterFarmSaveBtn" style="margin: 0.5rem 1.5rem 0.75rem; width: calc(100% - 3rem);">Save</button>
        <button class="card-btn" id="rosterFarmDeleteBtn" style="margin: 0 1.5rem 1rem; width: calc(100% - 3rem); color: var(--color-red);">Delete Farm</button>
      </div>
    </div>
  `,

  init: function () {
    let editingEmployeeId = null; // null = "add" mode, otherwise "edit" mode
    let editingFarms = [];
    let editingPartnerId = null;
    let editingEmploymentType = null; // 'casual' | 'permanent' | null (not set)
    let editingClassification = null; // 'FLH1'..'FLH8' — only relevant when casual
    let cellSheetTarget = null; // { empId, dayIndex }
    let editingFarmId = null; // null = "add" mode, otherwise "edit" mode (Farm Staffing)
    let editingFarmColor = null;
    let editingFarmExempt = false;
    let editingFarmStaffing = { min: 1, ideal: 1, max: 2 };

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
      const html = rosterFarms.map((f) => `
        <span class="roster-legend-item"><span class="roster-legend-swatch" style="background:${f.color};"></span>${f.name}</span>
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
          const bg = val && !isOff ? ((getFarm(val) || {}).color || '#999') : 'transparent';
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
        const f = getFarm(farmId);
        if (!f) return; // a farm this employee was trained on has since been deleted
        html += `<button class="roster-option-row" data-value="${farmId}"><span class="roster-option-swatch" style="background:${f.color};"></span>${f.name}</button>`;
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
      document.getElementById('rosterEmployeeCompanyInput').value = emp ? (emp.company || '') : '';

      editingEmploymentType = emp ? (emp.employmentType || null) : null;
      editingClassification = emp ? (emp.classification || null) : null;
      document.getElementById('rosterEmployeeRateInput').value = emp ? (emp.hourlyRate || '') : '';
      const empChipsEl = document.getElementById('rosterEmployeeEmploymentChips');
      const rateRowEl = document.getElementById('rosterEmployeeRateRow');
      const classRowEl = document.getElementById('rosterEmployeeClassRow');
      const classChipsEl = document.getElementById('rosterEmployeeClassChips');
      function renderEmploymentChips() {
        empChipsEl.querySelectorAll('.roster-chip').forEach((chip) => {
          chip.classList.toggle('active', chip.dataset.emptype === editingEmploymentType);
        });
        rateRowEl.hidden = editingEmploymentType !== 'permanent';
        classRowEl.hidden = editingEmploymentType !== 'casual';
      }
      function renderClassChips() {
        classChipsEl.querySelectorAll('.roster-chip').forEach((chip) => {
          chip.classList.toggle('active', chip.dataset.class === editingClassification);
        });
      }
      renderEmploymentChips();
      renderClassChips();
      empChipsEl.querySelectorAll('.roster-chip').forEach((chip) => {
        chip.onclick = () => {
          editingEmploymentType = editingEmploymentType === chip.dataset.emptype ? null : chip.dataset.emptype;
          renderEmploymentChips();
        };
      });
      classChipsEl.querySelectorAll('.roster-chip').forEach((chip) => {
        chip.onclick = () => {
          editingClassification = editingClassification === chip.dataset.class ? null : chip.dataset.class;
          renderClassChips();
        };
      });
      document.getElementById('rosterEmployeeNameInput').value = emp ? emp.name : '';

      const chipsEl = document.getElementById('rosterEmployeeFarmChips');
      chipsEl.innerHTML = rosterFarms.map((f) => `
        <button type="button" class="roster-chip${editingFarms.includes(f.id) ? ' active' : ''}" data-farm="${f.id}" style="${editingFarms.includes(f.id) ? `background:${f.color};` : ''}">
          <span class="roster-legend-swatch" style="background:${f.color};"></span>${f.name}
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
            chip.style.background = getFarm(farmId).color;
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
      const company = document.getElementById('rosterEmployeeCompanyInput').value.trim();
      const rateRaw = document.getElementById('rosterEmployeeRateInput').value;
      // Casual runs on the flat award rate (not stored per-employee) —
      // an hourly rate only means something for a Permanent employee.
      const hourlyRate = editingEmploymentType === 'permanent' && rateRaw ? Number(rateRaw) : undefined;
      const classification = editingEmploymentType === 'casual' ? (editingClassification || undefined) : undefined;

      if (editingEmployeeId) {
        const emp = rosterEmployees.find((e) => e.id === editingEmployeeId);
        emp.name = name;
        emp.company = company || undefined;
        emp.employmentType = editingEmploymentType || undefined;
        emp.hourlyRate = hourlyRate;
        emp.classification = classification;
        emp.trainedFarms = editingFarms.slice();
        // Clear the old partner's back-reference before setting the new one.
        rosterEmployees.forEach((e) => { if (e.partnerId === emp.id) e.partnerId = null; });
        emp.partnerId = editingPartnerId;
        if (editingPartnerId) rosterEmployees.find((e) => e.id === editingPartnerId).partnerId = emp.id;
      } else {
        const id = slugify(name);
        const newEmp = {
          id, name, company: company || undefined,
          employmentType: editingEmploymentType || undefined, hourlyRate, classification,
          trainedFarms: editingFarms.slice(), partnerId: editingPartnerId,
        };
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
    // A farm is now a real row in Supabase, not a fixed JS object, so
    // this list has the same add/edit/delete/reorder shape as "Manage
    // Employees" — the per-farm min/ideal/max steppers moved into the
    // Add/Edit Farm form below, alongside its name/company/color.
    function renderStaffingList() {
      const el = document.getElementById('rosterStaffingList');
      el.innerHTML = rosterFarms.map((f, i) => {
        const meta = `${f.company ? f.company + ' · ' : ''}Min ${f.min} · Ideal ${f.ideal} · Max ${f.max}${f.exemptFromMinimumGuarantee ? ' · Exempt from minimum' : ''}`;
        return `
          <div class="roster-emp-row" data-id="${f.id}">
            <div class="roster-emp-row__reorder">
              <button class="roster-emp-row__move" data-id="${f.id}" data-dir="-1" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>
              </button>
              <button class="roster-emp-row__move" data-id="${f.id}" data-dir="1" aria-label="Move down" ${i === rosterFarms.length - 1 ? 'disabled' : ''}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
              </button>
            </div>
            <span class="roster-legend-swatch" style="background:${f.color};flex-shrink:0;"></span>
            <div class="roster-emp-row__info">
              <span class="roster-emp-row__name">${f.name}</span>
              <span class="roster-emp-row__meta">${meta}</span>
            </div>
            <div class="roster-emp-row__actions">
              <button class="roster-emp-row__edit" data-id="${f.id}" aria-label="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg></button>
              <button class="roster-emp-row__delete" data-id="${f.id}" aria-label="Delete">${ROSTER_DELETE_ICON_SVG}</button>
            </div>
          </div>`;
      }).join('');

      // Reordering directly changes rosterFarms' array order — same
      // plain-button approach as Manage Employees (see there for why).
      el.querySelectorAll('.roster-emp-row__move').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.id;
          const dir = parseInt(btn.dataset.dir, 10);
          const index = rosterFarms.findIndex((f) => f.id === id);
          const swapWith = index + dir;
          if (swapWith < 0 || swapWith >= rosterFarms.length) return;
          [rosterFarms[index], rosterFarms[swapWith]] = [rosterFarms[swapWith], rosterFarms[index]];
          saveFarmsToStorage();
          renderStaffingList();
          renderLegend();
          renderGrid();
        });
      });
      el.querySelectorAll('.roster-emp-row__edit').forEach((btn) => {
        btn.addEventListener('click', () => openFarmForm(btn.dataset.id));
      });
      el.querySelectorAll('.roster-emp-row__delete').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.id;
          openConfirm('Delete this farm?', 'Employees trained on it will need reassigning, and any roster cells pointing to it will show blank.', 'Delete', () => {
            rosterFarms = rosterFarms.filter((f) => f.id !== id);
            rosterEmployees.forEach((e) => { e.trainedFarms = e.trainedFarms.filter((fid) => fid !== id); });
            saveFarmsToStorage();
            saveEmployeesToStorage();
            renderStaffingList();
            renderLegend();
            renderGrid();
            showToast('Farm deleted');
          });
        });
      });
    }

    // ---- Roster rules: days off/week + the couple day-off toggle ----
    function renderRosterSettings() {
      document.getElementById('rosterDaysOffValue').textContent = rosterSettings.weeklyDaysOff;
      document.getElementById('rosterDaysOffMinusBtn').disabled = rosterSettings.weeklyDaysOff <= 0;
      document.getElementById('rosterDaysOffPlusBtn').disabled = rosterSettings.weeklyDaysOff >= 6;
      document.getElementById('rosterCoupleDayOffChip').classList.toggle('active', rosterSettings.coupleSharedDayOff);
    }
    document.getElementById('rosterDaysOffMinusBtn').addEventListener('click', () => {
      rosterSettings.weeklyDaysOff = Math.max(0, rosterSettings.weeklyDaysOff - 1);
      renderRosterSettings();
      saveSettingsToStorage();
    });
    document.getElementById('rosterDaysOffPlusBtn').addEventListener('click', () => {
      rosterSettings.weeklyDaysOff = Math.min(6, rosterSettings.weeklyDaysOff + 1);
      renderRosterSettings();
      saveSettingsToStorage();
    });
    document.getElementById('rosterCoupleDayOffChip').addEventListener('click', () => {
      rosterSettings.coupleSharedDayOff = !rosterSettings.coupleSharedDayOff;
      renderRosterSettings();
      saveSettingsToStorage();
    });

    function openStaffingSheet() {
      renderRosterSettings();
      renderStaffingList();
      document.getElementById('rosterStaffingSheetMask').classList.add('show');
    }
    function closeStaffingSheet() { document.getElementById('rosterStaffingSheetMask').classList.remove('show'); }

    // ---- Add/Edit Farm form ----
    function slugifyFarm(name) {
      let base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '');
      let id = base || 'farm';
      let n = 2;
      while (rosterFarms.some((f) => f.id === id)) { id = base + n; n++; }
      return id;
    }

    function renderFarmColorChips() {
      const colorEl = document.getElementById('rosterFarmColorChips');
      colorEl.innerHTML = ROSTER_FARM_COLOR_PALETTE.map((c) => `
        <button type="button" class="roster-color-swatch${c === editingFarmColor ? ' active' : ''}" data-color="${c}" style="background:${c};" aria-label="${c}"></button>
      `).join('');
      colorEl.querySelectorAll('.roster-color-swatch').forEach((btn) => {
        btn.addEventListener('click', () => { editingFarmColor = btn.dataset.color; renderFarmColorChips(); });
      });
    }
    function renderFarmStaffingSteppers() {
      ['min', 'ideal', 'max'].forEach((key) => {
        document.getElementById(`rosterFarmForm-${key}`).textContent = editingFarmStaffing[key];
      });
    }
    function renderFarmExemptChip() {
      document.getElementById('rosterFarmExemptChip').classList.toggle('active', editingFarmExempt);
    }

    function openFarmForm(farmId) {
      editingFarmId = farmId || null;
      const f = farmId ? getFarm(farmId) : null;
      document.getElementById('rosterFarmFormTitle').textContent = f ? 'Edit Farm' : 'Add Farm';
      document.getElementById('rosterFarmNameInput').value = f ? f.name : '';
      document.getElementById('rosterFarmCompanyInput').value = f ? (f.company || '') : '';
      editingFarmColor = f ? f.color : ROSTER_FARM_COLOR_PALETTE[rosterFarms.length % ROSTER_FARM_COLOR_PALETTE.length];
      editingFarmExempt = f ? !!f.exemptFromMinimumGuarantee : false;
      editingFarmStaffing = f ? { min: f.min, ideal: f.ideal, max: f.max } : { min: 1, ideal: 1, max: 2 };
      renderFarmColorChips();
      renderFarmStaffingSteppers();
      renderFarmExemptChip();
      document.getElementById('rosterFarmDeleteBtn').style.display = editingFarmId ? 'block' : 'none';
      document.getElementById('rosterFarmFormSheetMask').classList.add('show');
    }
    function closeFarmForm() { document.getElementById('rosterFarmFormSheetMask').classList.remove('show'); }

    document.querySelectorAll('#rosterFarmFormSheetMask .roster-stepper__btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        const dir = parseInt(btn.dataset.dir, 10);
        editingFarmStaffing[key] = Math.max(0, Math.min(15, editingFarmStaffing[key] + dir));
        renderFarmStaffingSteppers();
      });
    });
    document.getElementById('rosterFarmExemptChip').addEventListener('click', () => {
      editingFarmExempt = !editingFarmExempt;
      renderFarmExemptChip();
    });

    document.getElementById('rosterFarmSaveBtn').addEventListener('click', () => {
      const name = document.getElementById('rosterFarmNameInput').value.trim();
      if (!name) { showToast('Enter a farm name first'); return; }
      const company = document.getElementById('rosterFarmCompanyInput').value.trim();

      if (editingFarmId) {
        const f = getFarm(editingFarmId);
        f.name = name;
        f.company = company || undefined;
        f.color = editingFarmColor;
        f.min = editingFarmStaffing.min; f.ideal = editingFarmStaffing.ideal; f.max = editingFarmStaffing.max;
        f.exemptFromMinimumGuarantee = editingFarmExempt;
      } else {
        const id = slugifyFarm(name);
        rosterFarms.push({
          id, name, company: company || undefined, color: editingFarmColor,
          min: editingFarmStaffing.min, ideal: editingFarmStaffing.ideal, max: editingFarmStaffing.max,
          exemptFromMinimumGuarantee: editingFarmExempt,
        });
      }

      closeFarmForm();
      saveFarmsToStorage();
      renderStaffingList();
      renderLegend();
      renderGrid();
      showToast('Farm saved');
    });

    document.getElementById('rosterFarmDeleteBtn').addEventListener('click', () => {
      if (!editingFarmId) return;
      const id = editingFarmId;
      closeFarmForm();
      openConfirm('Delete this farm?', 'Employees trained on it will need reassigning, and any roster cells pointing to it will show blank.', 'Delete', () => {
        rosterFarms = rosterFarms.filter((f) => f.id !== id);
        rosterEmployees.forEach((e) => { e.trainedFarms = e.trainedFarms.filter((fid) => fid !== id); });
        saveFarmsToStorage();
        saveEmployeesToStorage();
        renderStaffingList();
        renderLegend();
        renderGrid();
        showToast('Farm deleted');
      });
    });

    document.getElementById('rosterAddFarmBtn').addEventListener('click', () => openFarmForm(null));
    document.getElementById('rosterFarmFormBackBtn').addEventListener('click', closeFarmForm);

    // ---- Main overlay open/close + owner-only controls ----
    async function goToWeek(newOffset) {
      newOffset = Math.max(-ROSTER_WEEKS_BACK, Math.min(ROSTER_WEEKS_FORWARD, newOffset));
      if (newOffset === currentWeekOffset) return;
      saveGridToStorage(); // persist whatever's on screen for the week we're leaving (fire-and-forget)
      currentWeekOffset = newOffset;
      rosterGrid = {};
      rosterEmployees.forEach((e) => ensureGridRow(e.id));
      renderAll(); // render immediately with a blank grid so week nav feels instant
      try {
        await loadGridFromSupabase(currentWeekOffset);
      } catch (err) {
        console.error('[roster] failed to load roster:', err);
        showToast('Could not load roster — check your connection');
      }
      renderGrid(); // re-render once the real data for this week arrives
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

    // Back arrows for the 5 sheets, plus tap-outside-the-sheet to close.
    document.getElementById('rosterCellSheetBackBtn').addEventListener('click', closeCellSheet);
    document.getElementById('rosterEmployeesSheetBackBtn').addEventListener('click', closeEmployeesSheet);
    document.getElementById('rosterEmployeeFormBackBtn').addEventListener('click', closeEmployeeForm);
    document.getElementById('rosterStaffingSheetBackBtn').addEventListener('click', closeStaffingSheet);
    [
      ['rosterCellSheetMask', closeCellSheet],
      ['rosterEmployeesSheetMask', closeEmployeesSheet],
      ['rosterEmployeeFormSheetMask', closeEmployeeForm],
      ['rosterStaffingSheetMask', closeStaffingSheet],
      ['rosterFarmFormSheetMask', closeFarmForm],
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
      const farmIdsForLegend = rosterFarms.map((f) => f.id);
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
            const color = getFarm(val) ? getFarm(val).color : '#999';
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
      const legendEntries = farmIdsForLegend.map((f) => ({ label: farmName(f), color: getFarm(f).color }))
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
      ['rosterFarmFormSheetMask', closeFarmForm],
    ].forEach(([id, closeFn]) => {
      document.getElementById(id).addEventListener('click', (e) => { if (e.target.id === id) closeFn(); });
    });

    document.addEventListener('farmsmart:userchanged', applyRolePermissions);
    applyRolePermissions();
    renderLegend();
    renderWeekLabel();

    // Employees and farms come from Supabase now, not hardcoded — the
    // card briefly shows the built-in defaults (SEED_EMPLOYEES /
    // SEED_FARMS) until this resolves, then re-renders with whatever's
    // really in the database. The grid loads LAST, after employees —
    // so it only ever restores cells for employees who are actually
    // still around — and needs the CURRENT week's dates, so it's kept
    // separate from the farms/employees Promise.all.
    Promise.all([loadFarmsFromSupabase(), loadEmployeesFromSupabase(), loadSettingsFromSupabase()])
      .then(() => {
        renderLegend();
        renderEmployeesList();
        return loadGridFromSupabase(currentWeekOffset);
      })
      .then(() => {
        renderGrid();
      })
      .catch((err) => {
        console.error('[roster] failed to load roster data:', err);
        showToast('Could not load roster — check your connection');
      });
  },
});
