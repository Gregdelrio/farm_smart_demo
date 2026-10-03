/* =====================================================================
   TILE: EMPLOYEE TIMESHEET (Owner only)
   Has its own demo schedule rather than reading Roster's data, so it
   keeps working when Roster is disabled; the names just match. Hours
   and times only, never pay amounts. A dairy day is one split shift
   (morning + evening milking) totalling 9–10 h worked.
   ===================================================================== */

FarmSmart.registerTile({
  id: 'timesheet',
  name: 'Timesheet',

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
        <button class="close-btn" id="tsBackBtn" aria-label="Back">${FarmSmart.icons.back}</button>
        <h1>Timesheet</h1>
      </div>

      <p class="ts-today-line ts-today-line--overlay" id="tsOverlayTodayLine">Today, Fri 5 Sep</p>

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

      <div id="tsEmployeeList" class="ts-employee-list"></div>
    </div>
  `,

  init: function () {
    const DAYS = 7; // a rolling week ending today
    const TODAY_INDEX = DAYS - 1;

    // schedule[i] = farm id or 'off' on day i (day 6 = today).
    const EMPLOYEES = [
      { id: 'greg', name: 'Greg', schedule: ['maguires', 'maguires', 'off', 'maguires', 'vickers', 'off', 'maguires'] },
      { id: 'violette', name: 'Violette', schedule: ['maguires', 'maguires', 'off', 'maguires', 'maguires', 'off', 'maguires'] },
      { id: 'lucia', name: 'Lucia', schedule: ['vickers', 'off', 'vickers', 'vickers', 'vickers', 'vickers', 'off'] },
      { id: 'bart', name: 'Bart', schedule: ['off', 'vickers', 'vickers', 'vickers', 'vickers', 'vickers', 'off'] },
      { id: 'elsep', name: 'Else', schedule: ['vickers', 'vickers', 'off', 'vickers', 'off', 'vickers', 'vickers'] },
      { id: 'carolinas', name: 'Carolina', schedule: ['laang', 'laang', 'laang', 'laang', 'off', 'off', 'laang'] },
    ];

    function dateForDay(dayIndex) {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (TODAY_INDEX - dayIndex));
      return date;
    }
    const formatDate = (date) => date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });

    function minutesToLabel(totalMinutes) {
      const h = Math.floor(totalMinutes / 60);
      const m = totalMinutes % 60;
      return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
    }
    const jitter = (baseMinutes, spreadMinutes) => baseMinutes + Math.round((Math.random() - 0.5) * 2 * spreadMinutes);

    function generateShifts(employee) {
      const shifts = [];
      employee.schedule.forEach((farmId, dayIndex) => {
        if (farmId === 'off') return;
        const workedMinutes = Math.round((9 + Math.random()) * 60);
        const morningMinutes = Math.round(workedMinutes / 2 + (Math.random() - 0.5) * 60);
        const breakMinutes = jitter(6 * 60, 45); // long midday break between milkings
        const clockIn = jitter(5 * 60, 10);
        const breakStart = clockIn + morningMinutes;
        const breakEnd = breakStart + breakMinutes;
        const clockOut = breakEnd + (workedMinutes - morningMinutes);
        shifts.push({ dayIndex, date: dateForDay(dayIndex), clockIn, breakStart, breakEnd, clockOut });
      });
      return shifts;
    }

    const shiftHours = (shift) => (shift.breakStart - shift.clockIn + (shift.clockOut - shift.breakEnd)) / 60;
    const shiftParts = (shift) => [
      `${minutesToLabel(shift.clockIn)}–${minutesToLabel(shift.breakStart)}`,
      `${minutesToLabel(shift.breakEnd)}–${minutesToLabel(shift.clockOut)}`,
    ];

    // Stable while the app is open, fresh (but plausible) on reload.
    const shiftsByEmployee = {};
    EMPLOYEES.forEach((employee) => { shiftsByEmployee[employee.id] = generateShifts(employee); });
    const todayShift = (employee) => shiftsByEmployee[employee.id].find((s) => s.dayIndex === TODAY_INDEX);

    // People off today sink to the bottom; that position is what says
    // they're off, so no "Off today" label.
    const isOffToday = (employee) => (employee.schedule[TODAY_INDEX] === 'off' ? 1 : 0);
    const sortedEmployees = EMPLOYEES.slice().sort((a, b) => isOffToday(a) - isOffToday(b));

    function renderToday() {
      const todayLine = 'Today, ' + formatDate(dateForDay(TODAY_INDEX));
      document.getElementById('tsTodayLine').textContent = todayLine;
      document.getElementById('tsOverlayTodayLine').textContent = todayLine;

      document.getElementById('tsTodayList').innerHTML = sortedEmployees.map((employee) => {
        const farmId = employee.schedule[TODAY_INDEX];
        const shift = todayShift(employee);
        const farmBadge = farmId === 'off' ? '' : `<span class="ts-row__farm">${FarmSmart.getFarm(farmId).name}</span>`;
        const times = shift ? shiftParts(shift).map((part) => `<span class="ts-row__shift">${part}</span>`).join('') : '';
        return `<div class="ts-row">
          <span class="ts-row__name">${employee.name}</span>
          ${farmBadge}
          <span class="ts-row__times">${times}</span>
        </div>`;
      }).join('');
    }

    // Overlay: today's shift per person, earlier days revealed on tap.
    function renderTimesheet() {
      const el = document.getElementById('tsEmployeeList');
      el.innerHTML = sortedEmployees.map((employee) => {
        const shift = todayShift(employee);
        const pastShifts = shiftsByEmployee[employee.id]
          .filter((s) => s.dayIndex !== TODAY_INDEX)
          .sort((a, b) => b.dayIndex - a.dayIndex);
        const shiftRows = pastShifts.map((s) => `<div class="row-line ts-shift-line">
            <span class="k">${formatDate(s.date)}</span>
            <span class="v">${shiftParts(s).join(' · ')} (${shiftHours(s).toFixed(1)}h)</span>
          </div>`).join('') || '<p class="ts-no-past-shifts">No other shifts this week.</p>';

        return `<div class="card ts-employee-card">
          <button class="ts-employee-summary" data-emp="${employee.id}">
            <span class="ts-employee-summary__name">${employee.name}</span>
            <span class="ts-employee-summary__stats">
              <span class="ts-employee-summary__today">${shift ? shiftParts(shift).join(' · ') : ''}</span>
              <i class="ti ti-chevron-down ts-employee-summary__chevron"></i>
            </span>
          </button>
          <div class="ts-employee-shifts" id="tsShifts-${employee.id}" hidden>${shiftRows}</div>
        </div>`;
      }).join('');

      el.querySelectorAll('.ts-employee-summary').forEach((btn) => {
        btn.addEventListener('click', () => {
          const shiftsEl = document.getElementById('tsShifts-' + btn.dataset.emp);
          shiftsEl.hidden = !shiftsEl.hidden;
          btn.classList.toggle('open', !shiftsEl.hidden);
        });
      });
    }

    const details = FarmSmart.createPanel('tsDetailsOverlay', 'tsBackBtn');
    document.getElementById('tsDetailsBtn').addEventListener('click', details.open);

    renderToday();
    renderTimesheet();
    FarmSmart.restrictToOwner('tsCard', 'tsDetailsOverlay');
    FarmSmart.startSyncBadge('tsBadge');
  },
});
