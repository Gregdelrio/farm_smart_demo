/* =====================================================================
   TILE: FARM ROSTER
   Weekly grid of every current employee across all farms. Past weeks
   are read-only and show whoever was employed that week.
   Workflow: lock in constraints by tapping cells, then "Generate"
   fills only the cells still blank. Farms, employees, rules and shifts
   live in Supabase, shared across devices.
   ===================================================================== */
(function () {
  'use strict';

  const esc = FarmSmart.escapeHtml;
  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const WEEKS_BACK = 26;
  const WEEKS_FORWARD = 3;
  // Kept apart from the app's status colours (yellow, green, red, blue)
  // so a farm is never mistaken for a status.
  const FARM_COLOR_PALETTE = ['#2A9D8F', '#8B5FBF', '#E8792E', '#3B82C4', '#C4457B', '#7A8B3F', '#B08900', '#5A5A8C'];
  const SAVE_ERROR_MESSAGE = 'Could not save — check your connection';
  const LOAD_ERROR_MESSAGE = 'Could not load roster — check your connection';

  const ICON_CHEVRON_UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>';
  const ICON_CHEVRON_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
  const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>';
  const ICON_PREV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
  const ICON_NEXT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';

  /* ---------------------------------------------------------------------
     STATE
  --------------------------------------------------------------------- */
  // Ids are database UUIDs. partnerId links a couple: the generator
  // tries to give them a day off together.
  let farms = [];
  let employees = []; // current staff: the ones the roster edits
  let allEmployees = []; // everyone, including past staff, for past weeks
  // Codes already used in the company, including retired farms and past
  // employees: a new code must not collide with any of them.
  let takenFarmCodes = new Set();
  let takenEmployeeCodes = new Set();
  // `weeklyDaysOff` per employee; `coupleSharedDayOff` = try to give
  // couples at least one day off together.
  let settings = { weeklyDaysOff: 2, coupleSharedDayOff: true };
  // grid[employeeId][dayIndex] = null (blank) | 'off' | a farm id
  let grid = {};
  // 0 = this week, negative = past (read-only), positive = future.
  let weekOffset = 0;

  const getFarm = (farmId) => farms.find((f) => f.id === farmId);
  const getEmployee = (employeeId) => employees.find((e) => e.id === employeeId);
  // Roster farms are this tile's own list, separate from the header's
  // farm switcher: a farm added here has no switcher entry.
  const farmName = (farmId) => (getFarm(farmId) ? getFarm(farmId).name : farmId);
  const farmInitial = (farmId) => farmName(farmId).charAt(0).toUpperCase();
  const farmColor = (farmId) => (getFarm(farmId) || {}).color || '#999';

  function resetGrid(offset = weekOffset) {
    grid = {};
    weekStaff(offset).forEach((e) => { grid[e.id] = Array(7).fill(null); });
  }

  /** Slug of `name` not in `takenCodes`; it is added there. */
  function uniqueCode(name, fallback, takenCodes) {
    const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '') || fallback;
    let code = base;
    for (let n = 2; takenCodes.has(code); n++) code = base + n;
    takenCodes.add(code);
    return code;
  }

  /** Swaps the item with its neighbour (dir = -1 up, 1 down). */
  function moveItem(list, id, dir) {
    const index = list.findIndex((item) => item.id === id);
    const target = index + dir;
    if (target < 0 || target >= list.length) return false;
    [list[index], list[target]] = [list[target], list[index]];
    return true;
  }

  function getMonday(date) {
    const monday = new Date(date);
    const day = monday.getDay(); // 0 = Sunday
    monday.setDate(monday.getDate() + (day === 0 ? -6 : 1) - day);
    monday.setHours(0, 0, 0, 0);
    return monday;
  }

  function weekDates(offset = weekOffset) {
    const monday = getMonday(new Date());
    monday.setDate(monday.getDate() + offset * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(monday);
      date.setDate(date.getDate() + i);
      return date;
    });
  }

  // A past week lists whoever was employed during it; this week and
  // later list current staff.
  function weekStaff(offset = weekOffset) {
    if (offset >= 0) return employees;
    const dates = weekDates(offset).map(FarmSmart.toDateKey);
    return allEmployees.filter((e) => (!e.startDate || e.startDate <= dates[6]) && (!e.endDate || e.endDate >= dates[0]));
  }
  resetGrid();

  function shuffle(items) {
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ---------------------------------------------------------------------
     PERSISTENCE (Supabase)
     Farms and employees are upserted row by row and never deleted: a
     retired farm goes inactive, a removed employee gets an end_date, so
     hours and pay history keep pointing at them. sort_order keeps the
     on-screen order, which the generator also depends on.
  --------------------------------------------------------------------- */
  const db = () => FarmSmart.supabase();
  const companyId = () => FarmSmart.company.id;
  const nowIso = () => new Date().toISOString();
  const todayKey = () => FarmSmart.toDateKey(new Date());

  async function execute(query) {
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  function employeeToRow(e, sortOrder) {
    return {
      id: e.id, company_id: companyId(), code: e.code, preferred_name: e.name,
      partner_id: e.partnerId || null,
      employment_type: e.employmentType || null, classification: e.classification || null,
      xero_employee_id: e.xeroEmployeeId || null, app_role: e.appRole || null,
      sort_order: sortOrder, updated_at: nowIso(),
    };
  }
  function rowToEmployee(r) {
    return {
      id: r.id, code: r.code, name: r.preferred_name,
      trainedFarms: r.employee_farms.map((link) => link.farm_id),
      partnerId: r.partner_id,
      employmentType: r.employment_type, classification: r.classification,
      xeroEmployeeId: r.xero_employee_id, appRole: r.app_role,
      startDate: r.start_date, endDate: r.end_date,
    };
  }

  function farmToRow(f, sortOrder) {
    return {
      id: f.id, company_id: companyId(), code: f.code, name: f.name, color: f.color,
      min_staff: f.min, ideal_staff: f.ideal, max_staff: f.max,
      exempt_from_minimum: !!f.exemptFromMinimumGuarantee,
      sort_order: sortOrder, updated_at: nowIso(),
    };
  }
  function rowToFarm(r) {
    return {
      id: r.id, code: r.code, name: r.name, color: r.color,
      min: r.min_staff, ideal: r.ideal_staff, max: r.max_staff,
      exemptFromMinimumGuarantee: r.exempt_from_minimum,
    };
  }

  async function loadEmployees() {
    const rows = await execute(db().from('employees').select('*, employee_farms(farm_id)')
      .eq('company_id', companyId()).order('sort_order'));
    takenEmployeeCodes = new Set(rows.map((r) => r.code));
    const today = todayKey();
    allEmployees = rows.map(rowToEmployee);
    employees = allEmployees.filter((e) => !e.endDate || e.endDate >= today);
    // A partner who has left is no longer on the grid.
    employees.forEach((e) => { if (e.partnerId && !getEmployee(e.partnerId)) e.partnerId = null; });
    resetGrid();
  }
  async function loadFarms() {
    const rows = await execute(db().from('farms').select('*').eq('company_id', companyId()).order('sort_order'));
    takenFarmCodes = new Set(rows.map((r) => r.code));
    farms = rows.filter((r) => r.active).map(rowToFarm);
  }
  async function loadSettings() {
    settings = { weeklyDaysOff: FarmSmart.company.weeklyDaysOff, coupleSharedDayOff: FarmSmart.company.coupleSharedDayOff };
  }
  // Shifts are keyed by real calendar date, so a cell is the same on
  // every device whatever week navigation led there. Blank = no row,
  // a row without farm = day off.
  async function loadGrid(offset) {
    resetGrid(offset);
    const staff = weekStaff(offset);
    if (!staff.length) return;
    const dates = weekDates(offset).map(FarmSmart.toDateKey);
    const rows = await execute(db().from('roster_shifts').select('employee_id, work_date, farm_id')
      .in('work_date', dates).in('employee_id', staff.map((e) => e.id)));
    rows.forEach((row) => {
      const dayIndex = dates.indexOf(row.work_date);
      if (grid[row.employee_id] && dayIndex !== -1) grid[row.employee_id][dayIndex] = row.farm_id || 'off';
    });
  }

  async function saveEmployees() {
    if (!employees.length) return;
    await execute(db().from('employees').upsert(employees.map(employeeToRow)));
    const employeeIds = employees.map((e) => e.id);
    await execute(db().from('employee_farms').delete().in('employee_id', employeeIds));
    const links = employees.flatMap((e) => e.trainedFarms.map((farmId) => ({ employee_id: e.id, farm_id: farmId })));
    if (links.length) await execute(db().from('employee_farms').insert(links));
  }
  const endEmployment = (employeeId) =>
    execute(db().from('employees').update({ end_date: todayKey(), updated_at: nowIso() }).eq('id', employeeId));
  async function saveFarms() {
    if (farms.length) await execute(db().from('farms').upsert(farms.map(farmToRow)));
  }
  const retireFarm = (farmId) =>
    execute(db().from('farms').update({ active: false, updated_at: nowIso() }).eq('id', farmId));
  const saveSettings = () => execute(db().from('companies').update({
    weekly_days_off: settings.weeklyDaysOff,
    couple_shared_day_off: settings.coupleSharedDayOff,
    updated_at: nowIso(),
  }).eq('id', companyId()));
  // Replaces the on-screen employees' cells for that week only. Past
  // weeks are read-only, so never saved.
  async function saveGrid(offset) {
    if (offset < 0 || !employees.length) return;
    const dates = weekDates(offset).map(FarmSmart.toDateKey);
    const rows = [];
    employees.forEach((e) => {
      dates.forEach((workDate, dayIndex) => {
        const value = grid[e.id] ? grid[e.id][dayIndex] : null;
        if (value) rows.push({ employee_id: e.id, work_date: workDate, farm_id: value === 'off' ? null : value });
      });
    });
    await execute(db().from('roster_shifts').delete().in('work_date', dates).in('employee_id', employees.map((e) => e.id)));
    if (rows.length) await execute(db().from('roster_shifts').insert(rows));
  }

  // Edits apply on screen instantly; saving runs in the background and
  // only speaks up if it fails.
  function inBackground(save, label) {
    return () => save().catch((err) => {
      console.error(`[roster] failed to save ${label}:`, err);
      showToast(SAVE_ERROR_MESSAGE);
    });
  }
  const persist = {
    employees: inBackground(saveEmployees, 'employees'),
    farms: inBackground(saveFarms, 'farms'),
    settings: inBackground(saveSettings, 'roster settings'),
    grid: inBackground(() => saveGrid(weekOffset), 'roster'), // the week on screen
    endEmployment: (employeeId) => inBackground(() => endEmployment(employeeId), 'employee')(),
    retireFarm: (farmId) => inBackground(() => retireFarm(farmId), 'farm')(),
  };

  /* ---------------------------------------------------------------------
     GENERATOR
     Fills only blank cells, never anything already set. Rules, in
     priority order (1 and 2 are never broken to satisfy 3):
       1. Everyone gets exactly settings.weeklyDaysOff days off.
       2. If settings.coupleSharedDayOff, each couple shares at least one
          day off (best effort).
       3. Farm minimums are best effort, filled only from people already
          working that day: a farm runs short rather than cancelling
          someone's day off.
     A greedy heuristic, not a solver: it produces a sensible starting
     roster to fine-tune by hand.
  --------------------------------------------------------------------- */
  function generateRoster() {
    const offCount = (employeeId) => grid[employeeId].filter((v) => v === 'off').length;
    const blankDays = (employeeId) => [0, 1, 2, 3, 4, 5, 6].filter((d) => grid[employeeId][d] === null);
    const offCountForDay = (d) => employees.filter((e) => grid[e.id][d] === 'off').length;

    // Load-balancing off-days across the week keeps too many people from
    // being off on the same day.
    function pickLeastLoadedDay(candidateDays) {
      const minLoad = Math.min(...candidateDays.map(offCountForDay));
      return shuffle(candidateDays.filter((d) => offCountForDay(d) === minLoad))[0];
    }

    // ---- Step 1: off-days (rules 1 and 2), one person or couple at a time ----
    const processed = new Set();
    employees.forEach((e) => {
      if (processed.has(e.id)) return;
      const partner = e.partnerId ? getEmployee(e.partnerId) : null;
      const group = partner ? [e, partner] : [e];
      group.forEach((g) => processed.add(g.id));

      // Only if both still have room in their quota, so a manual preset
      // that already maxed someone out is never exceeded.
      if (group.length > 1 && settings.coupleSharedDayOff) {
        const hasSharedOff = [0, 1, 2, 3, 4, 5, 6].some((d) => group.every((g) => grid[g.id][d] === 'off'));
        const allHaveRoom = group.every((g) => offCount(g.id) < settings.weeklyDaysOff);
        if (!hasSharedOff && allHaveRoom) {
          const candidates = [0, 1, 2, 3, 4, 5, 6].filter((d) => group.every((g) => grid[g.id][d] === null));
          if (candidates.length > 0) {
            const sharedDay = pickLeastLoadedDay(candidates);
            group.forEach((g) => { grid[g.id][sharedDay] = 'off'; });
          }
        }
      }

      // Top everyone up to their quota, preferring a day the partner is
      // already off (a shared day for free).
      group.forEach((g) => {
        for (let currentOff = offCount(g.id); currentOff < settings.weeklyDaysOff; currentOff++) {
          const blanks = blankDays(g.id);
          if (blanks.length === 0) break;
          const partnerOffBlanks = g.partnerId && settings.coupleSharedDayOff ? blanks.filter((d) => grid[g.partnerId][d] === 'off') : [];
          const d = partnerOffBlanks.length > 0 ? shuffle(partnerOffBlanks)[0] : pickLeastLoadedDay(blanks);
          grid[g.id][d] = 'off';
        }
      });
    });

    // ---- Step 2: farm assignments (rule 3), day by day ----
    for (let d = 0; d < 7; d++) {
      const isUnassigned = (employeeId) => grid[employeeId][d] === null;
      const headcount = (farmId) => employees.filter((e) => grid[e.id][d] === farmId).length;

      // Below minimum is most urgent, then below ideal, then no need.
      function farmNeed(farmId) {
        const farm = getFarm(farmId);
        const count = headcount(farmId);
        if (count < farm.min) return 1000 + (farm.min - count);
        if (count < farm.ideal) return farm.ideal - count;
        return -1;
      }

      // Single-farm people have no choice.
      employees.forEach((e) => {
        if (isUnassigned(e.id) && e.trainedFarms.length === 1) grid[e.id][d] = e.trainedFarms[0];
      });

      // Cross-trained people cover whichever of their farms needs them most.
      employees
        .filter((e) => isUnassigned(e.id) && e.trainedFarms.length > 1)
        .forEach((e) => {
          let bestFarm = null;
          let bestNeed = -Infinity;
          e.trainedFarms.forEach((farmId) => {
            const need = farmNeed(farmId);
            if (need > bestNeed) { bestNeed = need; bestFarm = farmId; }
          });
          if (bestFarm) grid[e.id][d] = bestFarm;
        });

      // Anyone left (e.g. no trained farm at all) is off.
      employees.forEach((e) => {
        if (isUnassigned(e.id)) grid[e.id][d] = 'off';
      });
    }
  }

  /* ---------------------------------------------------------------------
     TEMPLATE
  --------------------------------------------------------------------- */
  const sheetHeader = (backId, title, titleId) => `
        <div class="sheet-header">
          <button class="sheet-back-btn" id="${backId}" aria-label="Back">${FarmSmart.icons.back}</button>
          <h2${titleId ? ` id="${titleId}"` : ''}>${title}</h2>
        </div>`;

  const stepper = (label, controlsAttrs, valueId, value) => `
            <div class="roster-stepper">
              ${label ? `<div class="roster-stepper__label">${label}</div>` : ''}
              <div class="roster-stepper__controls">
                <button type="button" class="roster-stepper__btn" ${controlsAttrs[0]}>−</button>
                <span class="roster-stepper__value" id="${valueId}">${value}</span>
                <button type="button" class="roster-stepper__btn" ${controlsAttrs[1]}>+</button>
              </div>
            </div>`;
  const farmStepper = (key, value) => stepper(key, [`data-key="${key}" data-dir="-1"`, `data-key="${key}" data-dir="1"`], `rosterFarmForm-${key}`, value);
  const chips = (attr, values) => values.map((v) => `<button type="button" class="roster-chip" data-${attr}="${v.toLowerCase()}">${v}</button>`).join('');

  const TILE_HTML = `
    <div class="card">
      <div class="card-top">
        <span class="card-title"><i class="ti ti-calendar-week"></i>Farm Roster</span>
      </div>
      <p class="roster-week-label">This week</p>
      <div class="roster-legend roster-legend--card" id="rosterLegendCard"></div>
      <div class="roster-grid-wrap roster-grid-wrap--card"><div class="roster-grid" id="rosterGridCardEl"></div></div>
      <p class="roster-preview-hint">Tap "Edit Roster" to edit</p>
      <button class="card-btn primary" id="rosterOpenBtn"><i class="ti ti-table"></i>Edit Roster</button>
    </div>

    <div class="overlay" id="rosterOverlay">
      <div class="overlay-header">
        <button class="close-btn" id="rosterBackBtn" aria-label="Back">${FarmSmart.icons.back}</button>
        <h1>Farm Roster</h1>
      </div>

      <div class="roster-week-nav">
        <button class="roster-week-nav__btn" id="rosterWeekPrevBtn" aria-label="Previous week">${ICON_PREV}</button>
        <p class="roster-week-label" id="rosterOverlayWeekLabel"></p>
        <button class="roster-week-nav__btn" id="rosterWeekNextBtn" aria-label="Next week">${ICON_NEXT}</button>
      </div>
      <p class="roster-readonly-banner" id="rosterReadonlyBanner" style="display:none;"><i class="ti ti-lock"></i>This week has already passed — read-only</p>

      <div>
        <div class="roster-legend" id="rosterLegend"></div>
        <div class="roster-grid-wrap"><div class="roster-grid" id="rosterGridEl"></div></div>
      </div>

      <div class="roster-overlay-section">
        <button class="card-btn" id="rosterShareBtn"><i class="ti ti-share"></i>Share Roster</button>
      </div>

      <div class="roster-action-row">
        <button class="card-btn primary" id="rosterGenerateBtn"><i class="ti ti-wand"></i>Generate Roster</button>
        <button class="card-btn" id="rosterClearBtn"><i class="ti ti-eraser"></i>Clear Roster</button>
        <button class="card-btn" id="rosterManageEmployeesBtn"><i class="ti ti-users"></i>Manage Employees</button>
        <button class="card-btn" id="rosterStaffingBtn"><i class="ti ti-adjustments"></i>Farm Staffing</button>
      </div>
    </div>

    <div class="sheet-mask" id="rosterCellSheetMask">
      <div class="sheet">${sheetHeader('rosterCellSheetBackBtn', 'Assign', 'rosterCellSheetTitle')}
        <div id="rosterCellOptions"></div>
      </div>
    </div>

    <div class="sheet-mask" id="rosterEmployeesSheetMask">
      <div class="sheet">${sheetHeader('rosterEmployeesSheetBackBtn', 'Manage Employees')}
        <div id="rosterEmployeesList"></div>
        <button class="card-btn primary roster-sheet-btn" id="rosterAddEmployeeBtn"><i class="ti ti-plus"></i>Add Employee</button>
      </div>
    </div>

    <div class="sheet-mask" id="rosterEmployeeFormSheetMask">
      <div class="sheet">${sheetHeader('rosterEmployeeFormBackBtn', 'Add Employee', 'rosterEmployeeFormTitle')}

        <p class="roster-form-label">Preferred name (shown everywhere in the app)</p>
        <input type="text" class="roster-text-input" id="rosterEmployeeNameInput" placeholder="e.g. Greg">

        <p class="roster-form-label">Award status</p>
        <div class="roster-chip-row" id="rosterEmployeeEmploymentChips">${chips('emptype', ['Casual', 'Permanent'])}</div>
        <div id="rosterEmployeeClassRow" hidden>
          <p class="roster-form-label">Classification (dairy)</p>
          <div class="roster-chip-row" id="rosterEmployeeClassChips">
            ${['FLH1', 'FLH2', 'FLH3', 'FLH5', 'FLH7', 'FLH8'].map((c) => `<button type="button" class="roster-chip" data-class="${c}">${c}</button>`).join('')}
          </div>
        </div>

        <p class="roster-form-label">Trained farms</p>
        <div class="roster-chip-row" id="rosterEmployeeFarmChips"></div>

        <p class="roster-form-label">Couple partner</p>
        <div class="roster-partner-list" id="rosterEmployeePartnerList"></div>

        <button class="card-btn primary roster-sheet-btn" id="rosterEmployeeSaveBtn">Save</button>
      </div>
    </div>

    <div class="sheet-mask" id="rosterStaffingSheetMask">
      <div class="sheet">${sheetHeader('rosterStaffingSheetBackBtn', 'Farm Staffing')}

        <div class="roster-staffing-row">
          <div class="roster-staffing-row__title"><i class="ti ti-calendar-off"></i>Days off per week</div>
          <div class="roster-stepper-group">${stepper('', ['id="rosterDaysOffMinusBtn"', 'id="rosterDaysOffPlusBtn"'], 'rosterDaysOffValue', 2)}
          </div>
        </div>

        <p class="roster-form-label">Couples</p>
        <div class="roster-chip-row">
          <button type="button" class="roster-chip" id="rosterCoupleDayOffChip"><i class="ti ti-heart"></i>Try to fit at least 1 day off together</button>
        </div>

        <p class="roster-week-label roster-staffing-intro">Target headcount per day, for the roster generator.</p>
        <div id="rosterStaffingList"></div>
        <button class="card-btn primary roster-sheet-btn" id="rosterAddFarmBtn"><i class="ti ti-plus"></i>Add Farm</button>
      </div>
    </div>

    <div class="sheet-mask" id="rosterFarmFormSheetMask">
      <div class="sheet">${sheetHeader('rosterFarmFormBackBtn', 'Add Farm', 'rosterFarmFormTitle')}

        <p class="roster-form-label">Farm name</p>
        <input type="text" class="roster-text-input" id="rosterFarmNameInput" placeholder="e.g. Vickers Road Panmure">

        <p class="roster-form-label">Color</p>
        <div class="roster-color-row" id="rosterFarmColorChips"></div>

        <p class="roster-form-label">Target headcount per day</p>
        <div class="roster-staffing-row">
          <div class="roster-stepper-group">${farmStepper('min', 1)}${farmStepper('ideal', 1)}${farmStepper('max', 2)}
          </div>
        </div>

        <p class="roster-form-label">Guarantee</p>
        <div class="roster-chip-row">
          <button type="button" class="roster-chip" id="rosterFarmExemptChip">Exempt from minimum guarantee</button>
        </div>

        <button class="card-btn primary roster-sheet-btn roster-farm-save-btn" id="rosterFarmSaveBtn">Save</button>
        <button class="card-btn roster-sheet-btn roster-farm-delete-btn" id="rosterFarmDeleteBtn">Delete Farm</button>
      </div>
    </div>
  `;

  /** One row of the Manage Employees / Farm Staffing lists. */
  function listRowHtml({ id, index, count, name, meta, color }) {
    return `
          <div class="roster-emp-row" data-id="${esc(id)}">
            <div class="roster-emp-row__reorder">
              <button class="roster-emp-row__move" data-id="${esc(id)}" data-dir="-1" aria-label="Move up" ${index === 0 ? 'disabled' : ''}>${ICON_CHEVRON_UP}</button>
              <button class="roster-emp-row__move" data-id="${esc(id)}" data-dir="1" aria-label="Move down" ${index === count - 1 ? 'disabled' : ''}>${ICON_CHEVRON_DOWN}</button>
            </div>
            ${color ? `<span class="roster-legend-swatch" style="background:${esc(color)};"></span>` : ''}
            <div class="roster-emp-row__info">
              <span class="roster-emp-row__name">${esc(name)}</span>
              <span class="roster-emp-row__meta">${esc(meta)}</span>
            </div>
            <div class="roster-emp-row__actions">
              <button class="roster-emp-row__edit" data-id="${esc(id)}" aria-label="Edit">${ICON_EDIT}</button>
              <button class="roster-emp-row__delete" data-id="${esc(id)}" aria-label="Delete">${FarmSmart.icons.close}</button>
            </div>
          </div>`;
  }

  /** Wires a list's reorder/edit/delete buttons. */
  function bindListRows(container, list, { onMoved, onEdit, onDelete }) {
    container.querySelectorAll('.roster-emp-row__move').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (moveItem(list(), btn.dataset.id, parseInt(btn.dataset.dir, 10))) onMoved();
      });
    });
    container.querySelectorAll('.roster-emp-row__edit').forEach((btn) => btn.addEventListener('click', () => onEdit(btn.dataset.id)));
    container.querySelectorAll('.roster-emp-row__delete').forEach((btn) => btn.addEventListener('click', () => onDelete(btn.dataset.id)));
  }

  /* ---------------------------------------------------------------------
     INIT
  --------------------------------------------------------------------- */
  function init() {
    const $ = (id) => document.getElementById(id);
    const isPastWeek = () => weekOffset < 0;
    const canEdit = () => !isPastWeek();

    const cellSheet = FarmSmart.createPanel('rosterCellSheetMask', 'rosterCellSheetBackBtn');
    const employeesSheet = FarmSmart.createPanel('rosterEmployeesSheetMask', 'rosterEmployeesSheetBackBtn');
    const employeeForm = FarmSmart.createPanel('rosterEmployeeFormSheetMask', 'rosterEmployeeFormBackBtn');
    const staffingSheet = FarmSmart.createPanel('rosterStaffingSheetMask', 'rosterStaffingSheetBackBtn');
    const farmForm = FarmSmart.createPanel('rosterFarmFormSheetMask', 'rosterFarmFormBackBtn');
    const overlay = FarmSmart.createPanel('rosterOverlay');

    /* ---- Week label, legend, grid ---- */
    function renderWeekLabel() {
      const dates = weekDates();
      const day = (i) => `${DAY_LABELS[i]} ${dates[i].getDate()} ${dates[i].toLocaleString('en-US', { month: 'short' })}`;
      const range = `${day(0)} – ${day(6)}`;
      $('rosterOverlayWeekLabel').textContent = weekOffset === 0 ? `This week (${range})` : range;
      $('rosterWeekPrevBtn').disabled = weekOffset <= -WEEKS_BACK;
      $('rosterWeekNextBtn').disabled = weekOffset >= WEEKS_FORWARD;
      $('rosterReadonlyBanner').style.display = isPastWeek() ? 'flex' : 'none';
      $('rosterGenerateBtn').disabled = !canEdit();
      $('rosterClearBtn').disabled = !canEdit();
    }

    // Same legend on the dashboard card and in the overlay.
    function renderLegend() {
      const html = farms.map((f) => `
        <span class="roster-legend-item"><span class="roster-legend-swatch" style="background:${esc(f.color)};"></span>${esc(f.name)}</span>
      `).join('') + '<span class="roster-legend-item"><span class="roster-legend-swatch roster-legend-swatch--off"></span>Day off</span>';
      $('rosterLegend').innerHTML = html;
      $('rosterLegendCard').innerHTML = html;
    }

    function buildGridHtml(readOnly) {
      const disabledAttr = readOnly ? 'disabled' : '';
      let html = '<div class="roster-grid-cell roster-corner roster-name-cell">Employee</div>';
      weekDates().forEach((date, i) => {
        html += `<div class="roster-grid-cell roster-day-header"><span class="dow">${DAY_LABELS[i]}</span><span class="dom">${date.getDate()}/${date.getMonth() + 1}</span></div>`;
      });
      weekStaff().forEach((e) => {
        html += `<div class="roster-grid-cell roster-name-cell">${esc(e.name)}</div>`;
        grid[e.id].forEach((value, d) => {
          const isOff = value === 'off';
          const background = value && !isOff ? farmColor(value) : 'transparent';
          const label = isOff ? 'OFF' : value ? farmInitial(value) : '';
          html += `<div class="roster-grid-cell">
            <button class="roster-cell-btn${isOff ? ' is-off' : ''}" style="background:${esc(background)};" data-emp="${esc(e.id)}" data-day="${d}" ${disabledAttr}>${esc(label)}</button>
          </div>`;
        });
      });
      return html;
    }

    // The overlay grid is editable; the card shows a read-only preview.
    function renderGrid() {
      const overlayGrid = $('rosterGridEl');
      overlayGrid.innerHTML = buildGridHtml(isPastWeek());
      overlayGrid.querySelectorAll('.roster-cell-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (canEdit()) openCellSheet(btn.dataset.emp, parseInt(btn.dataset.day, 10));
        });
      });
      $('rosterGridCardEl').innerHTML = buildGridHtml(true);
    }

    function renderAll() {
      renderWeekLabel();
      renderLegend();
      renderGrid();
    }

    /* ---- Cell sheet ---- */
    function openCellSheet(employeeId, dayIndex) {
      const employee = getEmployee(employeeId);
      $('rosterCellSheetTitle').textContent = `${employee.name} — ${DAY_LABELS[dayIndex]}`;

      // A trained farm may have been deleted since.
      const farmOptions = employee.trainedFarms.map(getFarm).filter(Boolean).map((f) =>
        `<button class="roster-option-row" data-value="${esc(f.id)}"><span class="roster-option-swatch" style="background:${esc(f.color)};"></span>${esc(f.name)}</button>`);
      const options = $('rosterCellOptions');
      options.innerHTML = farmOptions.join('') +
        '<button class="roster-option-row" data-value="off"><span class="roster-option-swatch off"></span>Day Off</button>' +
        `<button class="roster-option-row" data-value=""><span class="roster-option-swatch clear">${FarmSmart.icons.close}</span>Clear</button>`;

      options.querySelectorAll('.roster-option-row').forEach((row) => {
        row.addEventListener('click', () => {
          grid[employeeId][dayIndex] = row.dataset.value || null;
          persist.grid();
          cellSheet.close();
          renderGrid();
        });
      });
      cellSheet.open();
    }

    /* ---- Manage Employees ---- */
    function renderEmployeesList() {
      const el = $('rosterEmployeesList');
      el.innerHTML = employees.map((e, index) => {
        const farmsLabel = e.trainedFarms.map(farmName).join(', ') || 'No farms trained';
        const partner = e.partnerId ? getEmployee(e.partnerId) : null;
        const meta = partner ? `${farmsLabel} · Couple with ${partner.name}` : farmsLabel;
        return listRowHtml({ id: e.id, index, count: employees.length, name: e.name, meta });
      }).join('');

      bindListRows(el, () => employees, {
        onMoved: () => { persist.employees(); renderEmployeesList(); renderGrid(); },
        onEdit: openEmployeeForm,
        onDelete: (id) => {
          employees = employees.filter((e) => e.id !== id);
          employees.forEach((e) => { if (e.partnerId === id) e.partnerId = null; });
          delete grid[id];
          persist.endEmployment(id);
          persist.employees();
          renderEmployeesList();
          renderGrid();
        },
      });
    }

    /* ---- Employee form ---- */
    let editingEmployeeId = null; // null = adding
    let editingFarms = [];
    let editingPartnerId = null;
    let editingEmploymentType = null; // 'casual' | 'permanent' | null
    let editingClassification = null;

    function renderEmploymentChips() {
      $('rosterEmployeeEmploymentChips').querySelectorAll('.roster-chip').forEach((chip) => {
        chip.classList.toggle('active', chip.dataset.emptype === editingEmploymentType);
      });
      $('rosterEmployeeClassRow').hidden = !editingEmploymentType;
    }
    function renderClassChips() {
      $('rosterEmployeeClassChips').querySelectorAll('.roster-chip').forEach((chip) => {
        chip.classList.toggle('active', chip.dataset.class === editingClassification);
      });
    }

    function renderFarmChips() {
      const el = $('rosterEmployeeFarmChips');
      el.innerHTML = farms.map((f) => {
        const active = editingFarms.includes(f.id);
        return `
        <button type="button" class="roster-chip${active ? ' active' : ''}" data-farm="${esc(f.id)}" style="${active ? `background:${esc(f.color)};` : ''}">
          <span class="roster-legend-swatch" style="background:${esc(f.color)};"></span>${esc(f.name)}
        </button>`;
      }).join('');
      el.querySelectorAll('.roster-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          const farmId = chip.dataset.farm;
          const active = !editingFarms.includes(farmId);
          editingFarms = active ? [...editingFarms, farmId] : editingFarms.filter((id) => id !== farmId);
          chip.classList.toggle('active', active);
          chip.style.background = active ? getFarm(farmId).color : '';
        });
      });
    }

    function renderPartnerOptions() {
      const el = $('rosterEmployeePartnerList');
      const options = [{ id: null, name: 'None' }, ...employees.filter((e) => e.id !== editingEmployeeId)];
      el.innerHTML = options.map((p) => `
        <button type="button" class="sheet-row${editingPartnerId === p.id ? ' active' : ''}" data-partner="${esc(p.id || '')}">
          <span class="sheet-row__title">${esc(p.name)}</span>
        </button>
      `).join('');
      el.querySelectorAll('[data-partner]').forEach((row) => {
        row.addEventListener('click', () => {
          editingPartnerId = row.dataset.partner || null;
          el.querySelectorAll('.sheet-row').forEach((r) => r.classList.toggle('active', r === row));
        });
      });
    }

    function openEmployeeForm(employeeId) {
      const employee = employeeId ? getEmployee(employeeId) : null;
      editingEmployeeId = employee ? employee.id : null;
      editingFarms = employee ? employee.trainedFarms.slice() : [];
      editingPartnerId = employee ? employee.partnerId : null;
      editingEmploymentType = employee ? employee.employmentType || null : null;
      editingClassification = employee ? employee.classification || null : null;

      $('rosterEmployeeFormTitle').textContent = employee ? 'Edit Employee' : 'Add Employee';
      $('rosterEmployeeNameInput').value = employee ? employee.name : '';
      renderEmploymentChips();
      renderClassChips();
      renderFarmChips();
      renderPartnerOptions();
      employeeForm.open();
    }

    $('rosterEmployeeEmploymentChips').querySelectorAll('.roster-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        editingEmploymentType = editingEmploymentType === chip.dataset.emptype ? null : chip.dataset.emptype;
        renderEmploymentChips();
      });
    });
    $('rosterEmployeeClassChips').querySelectorAll('.roster-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        editingClassification = editingClassification === chip.dataset.class ? null : chip.dataset.class;
        renderClassChips();
      });
    });

    $('rosterEmployeeSaveBtn').addEventListener('click', () => {
      const name = $('rosterEmployeeNameInput').value.trim();
      if (!name) { showToast('Enter a name first'); return; }
      // Pay rates live in Xero; the app only keeps the award status.
      const fields = {
        name,
        employmentType: editingEmploymentType,
        classification: editingEmploymentType ? editingClassification : null,
        trainedFarms: editingFarms.slice(),
      };

      let employee;
      if (editingEmployeeId) {
        employee = Object.assign(getEmployee(editingEmployeeId), fields);
        // Unlink the previous partner before linking the new one.
        employees.forEach((e) => { if (e.partnerId === employee.id) e.partnerId = null; });
      } else {
        employee = { id: crypto.randomUUID(), code: uniqueCode(name, 'employee', takenEmployeeCodes), ...fields };
        employees.push(employee);
        grid[employee.id] = Array(7).fill(null);
      }
      employee.partnerId = editingPartnerId;
      if (editingPartnerId) getEmployee(editingPartnerId).partnerId = employee.id;

      employeeForm.close();
      persist.employees();
      renderEmployeesList();
      renderGrid();
      showToast('Employee saved');
    });

    /* ---- Farm Staffing ---- */
    function deleteFarm(farmId) {
      openConfirm('Delete this farm?', 'Employees trained on it will need reassigning, and any roster cells pointing to it will show blank.', 'Delete', () => {
        farms = farms.filter((f) => f.id !== farmId);
        employees.forEach((e) => { e.trainedFarms = e.trainedFarms.filter((id) => id !== farmId); });
        persist.retireFarm(farmId);
        persist.farms();
        persist.employees();
        renderStaffingList();
        renderLegend();
        renderGrid();
        showToast('Farm deleted');
      });
    }

    function renderStaffingList() {
      const el = $('rosterStaffingList');
      el.innerHTML = farms.map((f, index) => {
        const meta = `Min ${f.min} · Ideal ${f.ideal} · Max ${f.max}${f.exemptFromMinimumGuarantee ? ' · Exempt from minimum' : ''}`;
        return listRowHtml({ id: f.id, index, count: farms.length, name: f.name, meta, color: f.color });
      }).join('');

      bindListRows(el, () => farms, {
        onMoved: () => { persist.farms(); renderStaffingList(); renderLegend(); renderGrid(); },
        onEdit: openFarmForm,
        onDelete: deleteFarm,
      });
    }

    function renderSettings() {
      $('rosterDaysOffValue').textContent = settings.weeklyDaysOff;
      $('rosterDaysOffMinusBtn').disabled = settings.weeklyDaysOff <= 0;
      $('rosterDaysOffPlusBtn').disabled = settings.weeklyDaysOff >= 6;
      $('rosterCoupleDayOffChip').classList.toggle('active', settings.coupleSharedDayOff);
    }
    function changeSettings(change) {
      change();
      renderSettings();
      persist.settings();
    }
    $('rosterDaysOffMinusBtn').addEventListener('click', () => changeSettings(() => { settings.weeklyDaysOff = Math.max(0, settings.weeklyDaysOff - 1); }));
    $('rosterDaysOffPlusBtn').addEventListener('click', () => changeSettings(() => { settings.weeklyDaysOff = Math.min(6, settings.weeklyDaysOff + 1); }));
    $('rosterCoupleDayOffChip').addEventListener('click', () => changeSettings(() => { settings.coupleSharedDayOff = !settings.coupleSharedDayOff; }));

    function openStaffingSheet() {
      renderSettings();
      renderStaffingList();
      staffingSheet.open();
    }

    /* ---- Farm form ---- */
    let editingFarmId = null; // null = adding
    let editingFarmColor = null;
    let editingFarmExempt = false;
    let editingFarmStaffing = { min: 1, ideal: 1, max: 2 };

    function renderFarmForm() {
      const colors = $('rosterFarmColorChips');
      colors.innerHTML = FARM_COLOR_PALETTE.map((c) => `
        <button type="button" class="roster-color-swatch${c === editingFarmColor ? ' active' : ''}" data-color="${c}" style="background:${c};" aria-label="${c}"></button>
      `).join('');
      colors.querySelectorAll('.roster-color-swatch').forEach((btn) => {
        btn.addEventListener('click', () => { editingFarmColor = btn.dataset.color; renderFarmForm(); });
      });
      ['min', 'ideal', 'max'].forEach((key) => { $(`rosterFarmForm-${key}`).textContent = editingFarmStaffing[key]; });
      $('rosterFarmExemptChip').classList.toggle('active', editingFarmExempt);
    }

    function openFarmForm(farmId) {
      const farm = farmId ? getFarm(farmId) : null;
      editingFarmId = farm ? farm.id : null;
      editingFarmColor = farm ? farm.color : FARM_COLOR_PALETTE[farms.length % FARM_COLOR_PALETTE.length];
      editingFarmExempt = farm ? !!farm.exemptFromMinimumGuarantee : false;
      editingFarmStaffing = farm ? { min: farm.min, ideal: farm.ideal, max: farm.max } : { min: 1, ideal: 1, max: 2 };
      $('rosterFarmFormTitle').textContent = farm ? 'Edit Farm' : 'Add Farm';
      $('rosterFarmNameInput').value = farm ? farm.name : '';
      $('rosterFarmDeleteBtn').style.display = farm ? 'block' : 'none';
      renderFarmForm();
      farmForm.open();
    }

    document.querySelectorAll('#rosterFarmFormSheetMask .roster-stepper__btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        editingFarmStaffing[key] = Math.max(0, Math.min(15, editingFarmStaffing[key] + parseInt(btn.dataset.dir, 10)));
        renderFarmForm();
      });
    });
    $('rosterFarmExemptChip').addEventListener('click', () => {
      editingFarmExempt = !editingFarmExempt;
      renderFarmForm();
    });

    $('rosterFarmSaveBtn').addEventListener('click', () => {
      const name = $('rosterFarmNameInput').value.trim();
      if (!name) { showToast('Enter a farm name first'); return; }
      const fields = {
        name,
        color: editingFarmColor,
        ...editingFarmStaffing,
        exemptFromMinimumGuarantee: editingFarmExempt,
      };
      if (!(fields.min <= fields.ideal && fields.ideal <= fields.max)) { showToast('Staffing must be min ≤ ideal ≤ max'); return; }
      if (editingFarmId) Object.assign(getFarm(editingFarmId), fields);
      else farms.push({ id: crypto.randomUUID(), code: uniqueCode(name, 'farm', takenFarmCodes), ...fields });

      farmForm.close();
      persist.farms();
      renderStaffingList();
      renderLegend();
      renderGrid();
      showToast('Farm saved');
    });

    $('rosterFarmDeleteBtn').addEventListener('click', () => {
      if (!editingFarmId) return;
      farmForm.close();
      deleteFarm(editingFarmId);
    });

    /* ---- Week navigation + overlay ---- */
    async function goToWeek(offset) {
      const newOffset = Math.max(-WEEKS_BACK, Math.min(WEEKS_FORWARD, offset));
      if (newOffset === weekOffset) return;
      persist.grid(); // the week being left
      weekOffset = newOffset;
      resetGrid();
      renderAll(); // blank grid at once so navigation feels instant
      try {
        await loadGrid(weekOffset);
      } catch (err) {
        console.error('[roster] failed to load roster:', err);
        showToast(LOAD_ERROR_MESSAGE);
      }
      renderGrid();
    }

    function openRosterOverlay() {
      renderAll();
      overlay.open();
    }

    // Always park back on this week: it's what the card preview shows.
    function closeRosterOverlay() {
      overlay.close();
      if (weekOffset !== 0) goToWeek(0);
    }

    /* ---- Share: draws the grid on a canvas rather than screenshotting
       the DOM, whose horizontal scroll would clip the weekend. Open to
       everyone: sharing a snapshot isn't an edit. ---- */
    function drawRosterCanvas() {
      const dates = weekDates();
      const scale = 2; // crisp on high-density screens
      const nameColWidth = 130;
      const dayColWidth = 84;
      const headerHeight = 56;
      const rowHeight = 48;
      const legendRowHeight = 30;
      const padding = 20;
      const font = (weight, size) => `${weight} ${size}px -apple-system, sans-serif`;

      const gridWidth = nameColWidth + dayColWidth * 7;
      const width = gridWidth + padding * 2;
      const legendHeight = 20 + Math.ceil((farms.length + 1) / 2) * legendRowHeight;
      const staff = weekStaff();
      const height = padding + headerHeight + rowHeight * staff.length + legendHeight + padding;

      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);

      // Always light, whatever the app theme, so it reads in any chat app.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      let y = padding;
      const gridLeft = padding;

      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      dates.forEach((date, i) => {
        const cx = gridLeft + nameColWidth + i * dayColWidth + dayColWidth / 2;
        ctx.font = font(600, 12);
        ctx.fillStyle = '#6b7280';
        ctx.fillText(DAY_LABELS[i], cx, y + headerHeight / 2 - 8);
        ctx.font = font(700, 13);
        ctx.fillStyle = '#111827';
        ctx.fillText(`${date.getDate()}/${date.getMonth() + 1}`, cx, y + headerHeight / 2 + 10);
      });
      y += headerHeight;

      staff.forEach((e, rowIndex) => {
        if (rowIndex % 2 === 1) {
          ctx.fillStyle = '#f9fafb';
          ctx.fillRect(gridLeft, y, gridWidth, rowHeight);
        }
        ctx.fillStyle = '#111827';
        ctx.font = font(700, 13);
        ctx.textAlign = 'left';
        ctx.fillText(e.name, gridLeft + 12, y + rowHeight / 2);

        ctx.textAlign = 'center';
        grid[e.id].forEach((value, d) => {
          const cx = gridLeft + nameColWidth + d * dayColWidth + dayColWidth / 2;
          const cy = y + rowHeight / 2;
          if (value === 'off' || !value) {
            ctx.strokeStyle = '#d1d5db';
            ctx.setLineDash([3, 2]);
            ctx.strokeRect(cx - 30, cy - 10, 60, 20);
            ctx.setLineDash([]);
            ctx.fillStyle = '#9ca3af';
            ctx.font = font(600, 10);
            ctx.fillText('Off', cx, cy);
          } else {
            ctx.fillStyle = farmColor(value);
            ctx.beginPath();
            ctx.roundRect(cx - 30, cy - 10, 60, 20, 6);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.font = font(700, 10);
            ctx.fillText(farmInitial(value), cx, cy);
          }
        });
        y += rowHeight;
      });

      y += 16;
      ctx.textAlign = 'left';
      ctx.font = font(600, 12);
      const legendEntries = farms.map((f) => ({ label: f.name, color: f.color })).concat([{ label: 'Day off', color: null }]);
      legendEntries.forEach((entry, i) => {
        const x = gridLeft + (i % 2) * (gridWidth / 2);
        const rowY = y + Math.floor(i / 2) * legendRowHeight;
        if (entry.color) {
          ctx.fillStyle = entry.color;
          ctx.beginPath();
          ctx.roundRect(x, rowY, 14, 14, 4);
          ctx.fill();
        } else {
          ctx.strokeStyle = '#9ca3af';
          ctx.setLineDash([2, 2]);
          ctx.strokeRect(x, rowY, 14, 14);
          ctx.setLineDash([]);
        }
        ctx.fillStyle = '#374151';
        ctx.fillText(entry.label, x + 20, rowY + 7);
      });

      return canvas;
    }

    function shareRosterImage(blob) {
      if (!blob) { showToast('Could not create the roster image'); return; }
      const file = new File([blob], 'farmsmart-roster.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: 'FarmSmart Roster', text: "This week's farm roster." }).catch(() => { /* share sheet cancelled */ });
        return;
      }
      // No file sharing on this browser: download it to attach by hand.
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'farmsmart-roster.png';
      link.click();
      URL.revokeObjectURL(url);
      showToast('Roster image downloaded');
    }

    $('rosterShareBtn').addEventListener('click', () => {
      try {
        drawRosterCanvas().toBlob(shareRosterImage, 'image/png');
      } catch (e) {
        showToast('Could not create the roster image');
      }
    });

    $('rosterGenerateBtn').addEventListener('click', () => {
      if (!canEdit()) return;
      generateRoster();
      persist.grid();
      renderGrid();
      showToast('Roster generated');
    });
    $('rosterClearBtn').addEventListener('click', () => {
      if (!canEdit()) return;
      openConfirm('Clear roster?', 'This clears every cell in this week\'s roster.', 'Clear', () => {
        resetGrid();
        persist.grid();
        renderGrid();
        showToast('Roster cleared');
      });
    });

    $('rosterOpenBtn').addEventListener('click', openRosterOverlay);
    $('rosterBackBtn').addEventListener('click', closeRosterOverlay);
    $('rosterWeekPrevBtn').addEventListener('click', () => goToWeek(weekOffset - 1));
    $('rosterWeekNextBtn').addEventListener('click', () => goToWeek(weekOffset + 1));
    $('rosterManageEmployeesBtn').addEventListener('click', () => { renderEmployeesList(); employeesSheet.open(); });
    $('rosterAddEmployeeBtn').addEventListener('click', () => openEmployeeForm(null));
    $('rosterStaffingBtn').addEventListener('click', openStaffingSheet);
    $('rosterAddFarmBtn').addEventListener('click', () => openFarmForm(null));

    renderGrid();
    renderLegend();
    renderWeekLabel();

    // The grid loads last, once employees are known, so each employee
    // gets their cells back.
    Promise.all([loadFarms(), loadEmployees(), loadSettings()])
      .then(() => {
        renderLegend();
        renderEmployeesList();
        return loadGrid(weekOffset);
      })
      .then(renderGrid)
      .catch((err) => {
        console.error('[roster] failed to load roster data:', err);
        showToast(LOAD_ERROR_MESSAGE);
      });
  }

  FarmSmart.registerTile({ id: 'roster', name: 'Roster', html: TILE_HTML, init });
})();
