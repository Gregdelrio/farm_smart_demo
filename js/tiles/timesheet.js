/* =====================================================================
   TILE: EMPLOYEE TIMESHEET
   ---------------------------------------------------------------------
   TO DISABLE THIS TILE: comment out (or delete) in index.html:
     <link rel="stylesheet" href="css/tiles/timesheet.css">
     <script src="js/tiles/timesheet.js"></script>

   DESIGN NOTES:
   - RESTRICTION: Owner-only, same pattern as Milk Statement — hidden
     completely for Greg (Employee), not just greyed out.
   - Deliberately its OWN, self-contained demo employee list and
     schedule — NOT read from js/tiles/roster.js's localStorage. Two
     reasons: (1) this tile must keep working even if the Roster tile
     is disabled/removed per its own "TO DISABLE" instructions, and
     (2) it avoids one tile silently depending on another's internal
     storage keys, which the module system (see core.js §1) is
     designed to avoid. The names match Roster's for a consistent
     demo, but the two schedules are independent.
   - NO MONEY anywhere in this tile — hours and times only. There's a
     short informational note about overtime (see the award note in
     the overlay) but it's descriptive text, not a computed pay figure
     for any individual or shift.
   - One week of shifts (not a fortnight). Dairy shifts are a single
     shift with a break in the middle (morning + evening milking), not
     two separate shifts — total worked time (break excluded) is
     randomized to 9–10h/day, which is realistic for a dairy split
     shift.
   - Award note: under the Pastoral Award 2020 (MA000035), farm and
     livestock hands have NO automatic Saturday/Sunday penalty —
     overtime instead kicks in once more than 152 hours are worked in
     a rolling 4-week cycle. For a casual FLH1, that's 150% of the
     BASE rate ($25.74) plus the 25% casual loading added on top of
     that same base — 175% of base total, i.e. $45.05/hour (confirmed
     against a real payslip; it is NOT 150% of the everyday casual
     rate of $32.18, which would give a different, incorrect number).
     This demo doesn't track the 4-week total, so the note is
     informational only — no per-shift or per-employee dollar amounts
     are shown.
   ===================================================================== */

const TS_PAYROLL_DAYS = 7; // one week of shifts

// Same 6 people as the Roster tile, same order — independent schedule
// (see design note above). farmSchedule[i] is this employee's
// assignment on day i: a farm id, or 'off'.
const tsEmployees = [
  { id: 'greg',      name: 'Greg',
    farmSchedule: ['maguires','maguires','off','maguires','vickers','off','maguires'] },
  { id: 'violette',  name: 'Violette',
    farmSchedule: ['maguires','maguires','off','maguires','maguires','off','maguires'] },
  { id: 'lucia',     name: 'Lucia',
    farmSchedule: ['vickers','off','vickers','vickers','vickers','vickers','off'] },
  { id: 'bart',      name: 'Bart',
    farmSchedule: ['off','vickers','vickers','vickers','vickers','vickers','off'] },
  { id: 'elsep',     name: 'Else',
    farmSchedule: ['vickers','vickers','off','vickers','off','vickers','vickers'] },
  { id: 'carolinas', name: 'Carolina',
    farmSchedule: ['laang','laang','laang','laang','off','off','laang'] },
];

function tsFarmName(farmId) {
  const farm = FARMS.find((f) => f.id === farmId);
  return farm ? farm.name : farmId;
}

// Day 0 is 6 days ago, day 6 is today — a rolling week ending today,
// so the tile always looks current.
function tsDateForDay(dayIndex) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (TS_PAYROLL_DAYS - 1 - dayIndex));
  return d;
}
function tsFormatDate(date) {
  return date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

function tsMinutesToLabel(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function tsJitter(baseMins, spreadMins) {
  return baseMins + Math.round((Math.random() - 0.5) * 2 * spreadMins);
}

// ---- Generate this week's shift records once per page load. Each
// working day is ONE shift with a break in the middle (morning +
// evening milking) — not two separate shifts — totalling 9–10h of
// actual worked time (break excluded), which is realistic for a
// dairy split shift. ----
function tsGenerateShifts(emp) {
  const shifts = [];
  emp.farmSchedule.forEach((farmId, dayIndex) => {
    if (farmId === 'off') return;
    const date = tsDateForDay(dayIndex);

    const totalWorkedMins = Math.round((9 + Math.random()) * 60); // 9.0–10.0h
    const morningMins = Math.round(totalWorkedMins / 2 + (Math.random() - 0.5) * 60); // roughly half, +/- jitter
    const eveningMins = totalWorkedMins - morningMins;
    const breakMins = tsJitter(6 * 60, 45); // ~5.25–6.75h midday break, typical of a dairy split shift

    const clockIn = tsJitter(5 * 60, 10); // ~5:00 AM
    const breakStart = clockIn + morningMins;
    const breakEnd = breakStart + breakMins;
    const clockOut = breakEnd + eveningMins;

    shifts.push({ dayIndex, date, farmId, clockIn, breakStart, breakEnd, clockOut });
  });
  return shifts;
}

function tsShiftHours(shift) {
  return ((shift.breakStart - shift.clockIn) + (shift.clockOut - shift.breakEnd)) / 60;
}
function tsShiftTimesLabel(shift) {
  return `${tsMinutesToLabel(shift.clockIn)}–${tsMinutesToLabel(shift.breakStart)} · ${tsMinutesToLabel(shift.breakEnd)}–${tsMinutesToLabel(shift.clockOut)}`;
}
function tsShiftTimesParts(shift) {
  return [
    `${tsMinutesToLabel(shift.clockIn)}–${tsMinutesToLabel(shift.breakStart)}`,
    `${tsMinutesToLabel(shift.breakEnd)}–${tsMinutesToLabel(shift.clockOut)}`,
  ];
}

FarmSmart.registerTile({
  id: 'timesheet',

  html: `
    <div class="card" id="tsCard">
      <div class="card-top">
        <span class="card-title"><i class="ti ti-clock-hour-4"></i>Timesheet</span>
        <span class="badge info" id="tsBadge">Synced 4 min ago</span>
      </div>

      <p class="ts-today-line" id="tsTodayLine">Today, Fri 5 Sep</p>

      <div id="tsTodayList" class="ts-today-list"></div>

      <button class="card-btn" id="tsDetailsBtn"><i class="ti ti-clock-hour-4"></i>View details</button>
    </div>

    <div class="overlay" id="tsDetailsOverlay">
      <div class="overlay-header">
        <button class="close-btn" id="tsBackBtn" aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <h1>Timesheet</h1>
      </div>

      <p class="ts-today-line" id="tsOverlayTodayLine" style="margin: 0 1.5rem 1.5rem;">Today, Fri 5 Sep</p>

      <p class="ts-award-note">
        Under the <strong>Pastoral Award 2020 (MA000035)</strong>, farm and
        livestock hands have no automatic Saturday/Sunday penalty —
        overtime instead applies once more than 152 hours are worked
        in a rolling 4-week cycle. For a casual FLH1, that overtime is
        150% of the <strong>base</strong> rate ($25.74) plus the 25%
        casual loading added on top of that same base rate — 175% of
        base in total, i.e. <strong>$45.05/hour</strong> (not 150% of
        the everyday casual rate of $32.18). This demo doesn't track
        the 4-week total.
      </p>

      <div id="tsEmployeeList" class="ts-employee-list" style="margin-bottom:6vh;"></div>
    </div>
  `,

  init: function () {
    // RESTRICTION: Owner-only, same pattern as Milk Statement.
    function updateVisibilityForUser() {
      const card = document.getElementById('tsCard');
      const isOwner = FarmSmart.currentUser.role === 'Owner';
      card.style.display = isOwner ? '' : 'none';
      if (!isOwner) {
        document.getElementById('tsDetailsOverlay').classList.remove('show');
      }
    }

    // Build each employee's shifts once per page load — stays stable
    // while the app is open, fresh (but still plausible) on reload.
    const tsShiftsByEmployee = {};
    tsEmployees.forEach((emp) => { tsShiftsByEmployee[emp.id] = tsGenerateShifts(emp); });

    function renderToday() {
      const todayIndex = TS_PAYROLL_DAYS - 1;
      const todayLine = 'Today, ' + tsFormatDate(tsDateForDay(todayIndex));
      document.getElementById('tsTodayLine').textContent = todayLine;
      document.getElementById('tsOverlayTodayLine').textContent = todayLine;

      const list = document.getElementById('tsTodayList');
      // Working-today people first, off-today people pushed to the
      // bottom — order within each group otherwise unchanged.
      const sorted = tsEmployees.slice().sort((a, b) => {
        const aOff = a.farmSchedule[todayIndex] === 'off' ? 1 : 0;
        const bOff = b.farmSchedule[todayIndex] === 'off' ? 1 : 0;
        return aOff - bOff;
      });

      list.innerHTML = sorted.map((emp) => {
        const farmId = emp.farmSchedule[todayIndex];
        const todayShift = tsShiftsByEmployee[emp.id].find((s) => s.dayIndex === todayIndex);
        // Not working today: no "Off today" label, just blank — the
        // bottom position in the list is what communicates it.
        const farmBadge = farmId === 'off' ? '' : `<span class="ts-row__farm">${tsFarmName(farmId)}</span>`;
        const times = todayShift
          ? tsShiftTimesParts(todayShift).map((part) => `<span class="ts-row__shift">${part}</span>`).join('')
          : '';
        return `<div class="ts-row">
          <span class="ts-row__name">${emp.name}</span>
          ${farmBadge}
          <span class="ts-row__times">${times}</span>
        </div>`;
      }).join('');
    }

    function renderTimesheet() {
      const el = document.getElementById('tsEmployeeList');
      const todayIndex = TS_PAYROLL_DAYS - 1;

      // Working-today people first, off-today people at the bottom —
      // same ordering as the card's today list, for consistency.
      const sorted = tsEmployees.slice().sort((a, b) => {
        const aOff = a.farmSchedule[todayIndex] === 'off' ? 1 : 0;
        const bOff = b.farmSchedule[todayIndex] === 'off' ? 1 : 0;
        return aOff - bOff;
      });

      el.innerHTML = sorted.map((emp) => {
        const shifts = tsShiftsByEmployee[emp.id];
        const todayShift = shifts.find((s) => s.dayIndex === todayIndex);
        // Directly visible: today's shift, or nothing if not working
        // today (no "day off" label — the row just shows the name).
        const todayLabel = todayShift ? tsShiftTimesLabel(todayShift) : '';

        // Only revealed on tap: the other days, most recent first.
        const pastShifts = shifts.filter((s) => s.dayIndex !== todayIndex).sort((a, b) => b.dayIndex - a.dayIndex);
        const shiftRows = pastShifts.map((s) => `<div class="row-line ts-shift-line">
            <span class="k">${tsFormatDate(s.date)}</span>
            <span class="v">${tsShiftTimesLabel(s)} (${tsShiftHours(s).toFixed(1)}h)</span>
          </div>`).join('') || '<p class="ts-no-past-shifts">No other shifts this week.</p>';

        return `<div class="card ts-employee-card">
          <button class="ts-employee-summary" data-emp="${emp.id}">
            <span class="ts-employee-summary__name">${emp.name}</span>
            <span class="ts-employee-summary__stats">
              <span class="ts-employee-summary__today">${todayLabel}</span>
              <i class="ti ti-chevron-down ts-employee-summary__chevron"></i>
            </span>
          </button>
          <div class="ts-employee-shifts" id="tsShifts-${emp.id}" style="display:none;">${shiftRows}</div>
        </div>`;
      }).join('');

      // Accordion: tap an employee to reveal/hide their earlier days
      // this week (today's shift is already shown above, collapsed).
      el.querySelectorAll('.ts-employee-summary').forEach((btn) => {
        btn.addEventListener('click', () => {
          const shiftsEl = document.getElementById('tsShifts-' + btn.dataset.emp);
          const isOpen = shiftsEl.style.display !== 'none';
          shiftsEl.style.display = isOpen ? 'none' : 'block';
          btn.classList.toggle('open', !isOpen);
        });
      });
    }

    function refreshSyncBadge() {
      document.getElementById('tsBadge').textContent = FarmSmart.randomSyncLabel();
    }

    document.getElementById('tsDetailsBtn').addEventListener('click', () => {
      document.getElementById('tsDetailsOverlay').classList.add('show');
    });
    document.getElementById('tsBackBtn').addEventListener('click', () => {
      document.getElementById('tsDetailsOverlay').classList.remove('show');
    });

    document.addEventListener('farmsmart:userchanged', updateVisibilityForUser);

    renderToday();
    renderTimesheet();
    updateVisibilityForUser();
    refreshSyncBadge();
    setInterval(refreshSyncBadge, 20000);
  },
});
