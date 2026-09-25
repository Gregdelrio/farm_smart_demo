/* =====================================================================
   TILE: DAILY TASKS
   ---------------------------------------------------------------------
   TO DISABLE THIS TILE: comment out (or delete) in index.html:
     <link rel="stylesheet" href="css/tiles/daily-tasks.css">
     <script src="js/tiles/daily-tasks.js"></script>

   DESIGN NOTES:
   - Shows each employee's tasks for a given day — e.g. "Greg — Vickers
     Road — Milking 4:20am, Fencing 10:00am". Visible to EVERYONE, but
     only the Owner can add/edit/remove tasks (same read-only pattern
     as Roster: Greg can look, only John can plan).
   - Farm-per-day is read from Roster's own saved data (localStorage
     key farmsmart-roster-grid-{mondayDate}, one per week — see
     js/tiles/roster.js), NOT duplicated or re-entered here. This
     tile has its OWN employee list (like Timesheet) rather than
     depending on roster.js's in-memory `rosterEmployees` — that way
     it keeps working even if the Roster tile is disabled, and reading
     Roster's data by IDs off localStorage doesn't require Roster to
     even be loaded on the page.
   - Tasks are stored per calendar day (localStorage key
     farmsmart-dailytasks-{date}), independent of Roster's weekly
     storage, since a day's task list can be edited without touching
     the roster at all.
   - Day navigation (prev/next), not week navigation — this is a daily
     plan, not a weekly grid. Bounded to roughly the same overall
     window as Roster's week navigation (4 weeks back, 3 weeks
     forward), just expressed in days here for finer control.
   ===================================================================== */

const dtEmployees = [
  { id: 'greg',      name: 'Greg' },
  { id: 'violette',  name: 'Violette' },
  { id: 'lucia',     name: 'Lucia' },
  { id: 'bart',      name: 'Bart' },
  { id: 'elsep',     name: 'Else' },
  { id: 'carolinas', name: 'Carolina' },
];

const DT_TASK_TYPES = ['Milking', 'Feeding', 'Fencing', 'Herding', 'Calving Check', 'Equipment Maintenance', 'Pasture/Irrigation', 'Other'];

const DT_DAYS_BACK = 28;    // ~4 weeks, matches Roster's navigation window
const DT_DAYS_FORWARD = 21; // ~3 weeks

function dtDateForOffset(offset) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}
function dtDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function dtFormatDate(date) {
  return date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short' });
}
function dtGetMonday(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Reads Roster's own saved weekly grid straight from localStorage —
// no dependency on roster.js being loaded/active. Returns a farm id,
// 'off', or null (nothing generated for that day yet).
function dtFarmForEmployeeOnDate(employeeId, date) {
  try {
    const monday = dtGetMonday(date);
    const raw = localStorage.getItem('farmsmart-roster-grid-' + dtDateKey(monday));
    if (!raw) return null;
    const grid = JSON.parse(raw);
    const dayIndex = Math.round((date - monday) / 86400000); // 0 = Mon .. 6 = Sun
    if (!grid[employeeId] || !Array.isArray(grid[employeeId])) return null;
    return grid[employeeId][dayIndex] || null;
  } catch (e) { return null; }
}
function dtFarmName(farmId) {
  if (!farmId || farmId === 'off') return null;
  const farm = FARMS.find((f) => f.id === farmId);
  return farm ? farm.name : farmId;
}

function dtTasksKey(date) { return 'farmsmart-dailytasks-' + dtDateKey(date); }
function dtLoadTasks(date) {
  const blank = {};
  dtEmployees.forEach((e) => { blank[e.id] = []; });
  try {
    const raw = localStorage.getItem(dtTasksKey(date));
    if (!raw) return blank;
    const saved = JSON.parse(raw);
    dtEmployees.forEach((e) => {
      if (Array.isArray(saved[e.id])) blank[e.id] = saved[e.id];
    });
  } catch (e) { /* fall back to blank */ }
  return blank;
}
function dtSaveTasks(date, tasks) {
  try { localStorage.setItem(dtTasksKey(date), JSON.stringify(tasks)); } catch (e) { /* demo still works this session */ }
}

// Sorts a day's task list chronologically by start time for display.
function dtSortedTasks(tasks) {
  return tasks.slice().sort((a, b) => a.time.localeCompare(b.time));
}
function dtFormatTaskTime(time24) {
  const [h, m] = time24.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}
function dtTaskLabel(task) {
  return task.type === 'Other' && task.customText ? task.customText : task.type;
}

FarmSmart.registerTile({
  id: 'daily-tasks',

  html: `
    <div class="card" id="dtCard">
      <div class="card-top">
        <span class="card-title"><i class="ti ti-clipboard-list"></i>Daily Tasks</span>
        <span class="badge info" id="dtBadge">Synced 4 min ago</span>
      </div>

      <p class="dt-date-line" id="dtDateLine">Today, Fri 5 Sep</p>

      <div id="dtTodayList" class="dt-list"></div>

      <button class="card-btn" id="dtDetailsBtn"><i class="ti ti-calendar-event"></i>View / Edit Plan</button>
    </div>

    <div class="overlay" id="dtDetailsOverlay">
      <div class="overlay-header">
        <button class="close-btn" id="dtBackBtn" aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <h1>Daily Tasks</h1>
      </div>

      <div class="dt-day-nav">
        <button class="dt-day-nav__btn" id="dtDayPrevBtn" aria-label="Previous day">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <p class="dt-day-nav__label" id="dtOverlayDateLine">Today, Fri 5 Sep</p>
        <button class="dt-day-nav__btn" id="dtDayNextBtn" aria-label="Next day">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
        </button>
      </div>

      <div id="dtOverlayList" class="dt-list" style="margin: 0 1.5rem 6vh;"></div>
    </div>

    <!-- ================= TASK EDIT SHEET (Owner only) ================= -->
    <div class="sheet-mask" id="dtTaskSheetMask">
      <div class="sheet">
        <div class="sheet-header">
          <button class="sheet-back-btn" id="dtTaskSheetBackBtn" aria-label="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <h2 id="dtTaskSheetTitle">Tasks</h2>
        </div>

        <div id="dtTaskList" style="margin-bottom: 2vh;"></div>

        <p class="dt-form-label">Add a task</p>
        <div class="dt-chip-row" id="dtTaskTypeChips"></div>
        <input type="text" class="dt-text-input" id="dtCustomTaskInput" placeholder="Describe the task" style="display:none;">
        <p class="dt-form-label">Start time</p>
        <input type="time" class="dt-text-input" id="dtTaskTimeInput" value="07:00">

        <button class="card-btn primary" id="dtAddTaskBtn" style="margin: 1.5rem 1.5rem 0; width: calc(100% - 3rem);"><i class="ti ti-plus"></i>Add Task</button>
      </div>
    </div>
  `,

  init: function () {
    function isOwner() { return FarmSmart.currentUser.role === 'Owner'; }

    let dayOffset = 0;
    let selectedTaskType = DT_TASK_TYPES[0];
    let taskSheetEmployeeId = null;

    function renderRow(emp, date, forCard) {
      const farmId = dtFarmForEmployeeOnDate(emp.id, date);
      const tasks = dtLoadTasks(date)[emp.id] || [];
      const farmBadge = (!farmId || farmId === 'off') ? '' : `<span class="dt-row__farm">${dtFarmName(farmId)}</span>`;
      const taskLines = dtSortedTasks(tasks).map((t) => `<span class="dt-row__task">${dtTaskLabel(t)} · ${dtFormatTaskTime(t.time)}</span>`).join('');
      const editBtn = (!forCard && isOwner()) ? `<button class="dt-row__edit" data-emp="${emp.id}"><i class="ti ti-pencil"></i></button>` : '';
      return `<div class="dt-row">
        <div class="dt-row__head">
          <span class="dt-row__name">${emp.name}</span>
          ${farmBadge}
          ${editBtn}
        </div>
        ${taskLines ? `<div class="dt-row__tasks">${taskLines}</div>` : ''}
      </div>`;
    }

    function sortedEmployeesForDate(date) {
      // Whoever has a farm assignment (working) first, off/unknown at
      // the bottom — same ordering convention as Timesheet.
      return dtEmployees.slice().sort((a, b) => {
        const aOff = dtFarmForEmployeeOnDate(a.id, date) ? 0 : 1;
        const bOff = dtFarmForEmployeeOnDate(b.id, date) ? 0 : 1;
        return aOff - bOff;
      });
    }

    function renderCard() {
      const date = dtDateForOffset(0); // the card always shows TODAY, regardless of what's browsed in the overlay
      document.getElementById('dtDateLine').textContent = 'Today, ' + dtFormatDate(date);
      document.getElementById('dtTodayList').innerHTML = sortedEmployeesForDate(date).map((e) => renderRow(e, date, true)).join('');
    }

    function renderOverlay() {
      const date = dtDateForOffset(dayOffset);
      const label = (dayOffset === 0 ? 'Today, ' : dayOffset === 1 ? 'Tomorrow, ' : dayOffset === -1 ? 'Yesterday, ' : '') + dtFormatDate(date);
      document.getElementById('dtOverlayDateLine').textContent = label;

      document.getElementById('dtDayPrevBtn').disabled = dayOffset <= -DT_DAYS_BACK;
      document.getElementById('dtDayNextBtn').disabled = dayOffset >= DT_DAYS_FORWARD;

      const list = document.getElementById('dtOverlayList');
      list.innerHTML = sortedEmployeesForDate(date).map((e) => renderRow(e, date, false)).join('');
      list.querySelectorAll('.dt-row__edit').forEach((btn) => {
        btn.addEventListener('click', () => openTaskSheet(btn.dataset.emp));
      });
    }

    function renderAll() { renderCard(); renderOverlay(); }

    // ---- Task edit sheet ----
    function openTaskSheet(empId) {
      taskSheetEmployeeId = empId;
      const emp = dtEmployees.find((e) => e.id === empId);
      document.getElementById('dtTaskSheetTitle').textContent = emp.name + '\u2019s Tasks';

      document.getElementById('dtTaskTypeChips').innerHTML = DT_TASK_TYPES.map((t) =>
        `<button type="button" class="dt-chip${t === selectedTaskType ? ' active' : ''}" data-type="${t}">${t}</button>`
      ).join('');
      document.getElementById('dtTaskTypeChips').querySelectorAll('.dt-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          selectedTaskType = chip.dataset.type;
          document.getElementById('dtTaskTypeChips').querySelectorAll('.dt-chip').forEach((c) => c.classList.toggle('active', c === chip));
          document.getElementById('dtCustomTaskInput').style.display = selectedTaskType === 'Other' ? 'block' : 'none';
        });
      });
      document.getElementById('dtCustomTaskInput').style.display = selectedTaskType === 'Other' ? 'block' : 'none';
      document.getElementById('dtCustomTaskInput').value = '';

      renderTaskSheetList();
      document.getElementById('dtTaskSheetMask').classList.add('show');
    }
    function closeTaskSheet() { document.getElementById('dtTaskSheetMask').classList.remove('show'); }

    function renderTaskSheetList() {
      const date = dtDateForOffset(dayOffset);
      const allTasks = dtLoadTasks(date);
      const tasks = dtSortedTasks(allTasks[taskSheetEmployeeId] || []);
      const el = document.getElementById('dtTaskList');
      el.innerHTML = tasks.length
        ? tasks.map((t) => `<div class="row-line dt-task-line">
            <span class="k">${dtTaskLabel(t)}</span>
            <span class="v">${dtFormatTaskTime(t.time)} <button type="button" class="dt-task-remove" data-id="${t.id}"><i class="ti ti-x"></i></button></span>
          </div>`).join('')
        : '<p class="dt-no-tasks">No tasks yet today.</p>';

      el.querySelectorAll('.dt-task-remove').forEach((btn) => {
        btn.addEventListener('click', () => {
          const all = dtLoadTasks(date);
          all[taskSheetEmployeeId] = (all[taskSheetEmployeeId] || []).filter((t) => t.id !== btn.dataset.id);
          dtSaveTasks(date, all);
          renderTaskSheetList();
          renderAll();
        });
      });
    }

    document.getElementById('dtAddTaskBtn').addEventListener('click', () => {
      const time = document.getElementById('dtTaskTimeInput').value || '07:00';
      const customText = document.getElementById('dtCustomTaskInput').value.trim();
      if (selectedTaskType === 'Other' && !customText) { showToast('Describe the task first'); return; }

      const date = dtDateForOffset(dayOffset);
      const all = dtLoadTasks(date);
      all[taskSheetEmployeeId] = all[taskSheetEmployeeId] || [];
      all[taskSheetEmployeeId].push({ id: 'task-' + Date.now() + '-' + Math.round(Math.random() * 9999), type: selectedTaskType, customText: selectedTaskType === 'Other' ? customText : '', time });
      dtSaveTasks(date, all);

      document.getElementById('dtCustomTaskInput').value = '';
      renderTaskSheetList();
      renderAll();
      showToast('Task added');
    });

    document.getElementById('dtTaskSheetBackBtn').addEventListener('click', closeTaskSheet);
    document.getElementById('dtTaskSheetMask').addEventListener('click', (e) => {
      if (e.target.id === 'dtTaskSheetMask') closeTaskSheet();
    });

    document.getElementById('dtDayPrevBtn').addEventListener('click', () => {
      dayOffset = Math.max(-DT_DAYS_BACK, dayOffset - 1);
      renderOverlay();
    });
    document.getElementById('dtDayNextBtn').addEventListener('click', () => {
      dayOffset = Math.min(DT_DAYS_FORWARD, dayOffset + 1);
      renderOverlay();
    });

    document.getElementById('dtDetailsBtn').addEventListener('click', () => {
      dayOffset = 0; // always open on today
      renderOverlay();
      document.getElementById('dtDetailsOverlay').classList.add('show');
    });
    document.getElementById('dtBackBtn').addEventListener('click', () => {
      document.getElementById('dtDetailsOverlay').classList.remove('show');
    });

    function refreshSyncBadge() {
      document.getElementById('dtBadge').textContent = FarmSmart.randomSyncLabel();
    }

    document.addEventListener('farmsmart:userchanged', renderAll);

    renderAll();
    refreshSyncBadge();
    setInterval(refreshSyncBadge, 20000);
  },
});
