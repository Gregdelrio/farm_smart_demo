/* =====================================================================
   TILE: PADDOCK GATES
   ---------------------------------------------------------------------
   TO DISABLE THIS TILE: comment out (or delete) in index.html:
     <link rel="stylesheet" href="css/tiles/gates.css">
     <script src="js/tiles/gates.js"></script>

   DESIGN NOTES:
   - Two separate actions, deliberately not linked to each other:
       "Timings"  → schedule a FUTURE gate opening (added to the list
                    below, up to 4 at a time, date + paddock + time).
       "Open Now" → open a SPECIFIC paddock immediately. Does not
                    touch the schedule list at all.
   - The paddock wheel(s) shown depend on the active farm — see
     PADDOCK_WHEEL_CONFIG and composePaddockCode() below.
   - Both sheets are built fresh (wheels re-created) every time they
     open, using FarmSmart.createWheel() from js/core.js §6, so they
     always reflect whichever farm is currently active.
   - The schedule is per farm (switching farms shows that farm's own
     list) — kept in `scheduleByFarm` below. In a production build,
     replace that in-memory object with a real API call.
   ===================================================================== */

// ---- Which paddock wheels each farm has, and how their values
// combine into a single paddock code. ----
const PADDOCK_WHEEL_CONFIG = {
  vickers: [
    { values: ['A', 'B', 'C', 'D'] },
    { values: Array.from({ length: 20 }, (_, i) => String(i + 1)) }, // 1–20
  ],
  maguires: [
    { values: ['-', 'W'] },
    { values: Array.from({ length: 21 }, (_, i) => String(i + 10)) }, // 10–30
  ],
  laang: [
    { values: Array.from({ length: 30 }, (_, i) => String(i + 1)) }, // 1–30
  ],
};

function composePaddockCode(farmId, wheelValues) {
  if (farmId === 'vickers') return wheelValues[0] + wheelValues[1];
  if (farmId === 'maguires') return wheelValues[0] === '-' ? wheelValues[1] : wheelValues[0] + wheelValues[1];
  if (farmId === 'laang') return wheelValues[0];
  return wheelValues.join('');
}

const HOUR_VALUES = Array.from({ length: 12 }, (_, i) => String(i + 1));           // 1–12
const MINUTE_VALUES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0')); // 00–59
const PERIOD_VALUES = ['AM', 'PM'];

function to24HourMinutes(hour12, minute, period) {
  let h = parseInt(hour12, 10) % 12;
  if (period === 'PM') h += 12;
  return h * 60 + parseInt(minute, 10);
}

const DELETE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

FarmSmart.registerTile({
  id: 'gates',

  html: `
    <div class="card">
      <div class="card-top">
        <span class="card-title"><i class="ti ti-fence"></i>Paddock Gates</span>
        <span class="badge info">Scheduled</span>
      </div>

      <div class="gate-next" id="gateNextBox">
        <span class="lbl">Next gate</span>
        <p class="name" id="gateNextName">—</p>
        <p class="time" id="gateNextTime"></p>
      </div>

      <div class="gate-list" id="gateList"></div>

      <div class="gate-btn-row">
        <button class="card-btn primary" id="openGateNowBtn"><i class="ti ti-lock-open"></i>Open Now</button>
        <button class="card-btn" id="editTimingsBtn"><i class="ti ti-calendar"></i>Timings</button>
      </div>
    </div>

    <!-- "Timings" sheet: date + paddock + time, adds to the schedule list -->
    <div class="sheet-mask" id="timingsSheetMask">
      <div class="sheet">
        <div class="sheet-header">
          <button class="sheet-back-btn" id="timingsSheetBackBtn" aria-label="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <h2>Schedule Gate</h2>
        </div>

        <div class="date-toggle" id="dateToggle">
          <button class="date-toggle__btn active" data-date="Today" type="button">Today</button>
          <button class="date-toggle__btn" data-date="Tomorrow" type="button">Tomorrow</button>
        </div>

        <p class="wheel-section-label">Paddock</p>
        <div class="wheel-picker-row" id="timingsPaddockWheels">
          <div class="wheel-highlight"></div>
        </div>

        <p class="wheel-section-label">Time</p>
        <div class="wheel-picker-row">
          <div class="wheel-col" id="timingsHourWheel"></div>
          <div class="wheel-col" id="timingsMinuteWheel"></div>
          <div class="wheel-col" id="timingsPeriodWheel"></div>
          <div class="wheel-highlight"></div>
        </div>

        <div class="wheel-sheet-actions">
          <button class="card-btn primary" id="timingsSaveBtn">Save</button>
        </div>
      </div>
    </div>

    <!-- "Open Now" sheet: paddock only, no date/time — opens immediately -->
    <div class="sheet-mask" id="openNowSheetMask">
      <div class="sheet">
        <div class="sheet-header">
          <button class="sheet-back-btn" id="openNowSheetBackBtn" aria-label="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <h2>Open Paddock Now</h2>
        </div>

        <p class="wheel-section-label">Paddock</p>
        <div class="wheel-picker-row" id="openNowPaddockWheels">
          <div class="wheel-highlight"></div>
        </div>

        <div class="wheel-sheet-actions">
          <button class="card-btn primary" id="openNowConfirmBtn">Open</button>
        </div>
      </div>
    </div>
  `,

  init: function () {
    const MAX_SCHEDULED = 4;

    // Demo seed data — one entry per farm, so switching farms shows a
    // different (plausible) schedule. Replace with a real API call in
    // production; everything below just reads/writes this object.
    const scheduleByFarm = {
      vickers:  [{ code: 'A5',  date: 'Today',    time: '4:30 PM', sortMinutes: to24HourMinutes('4', '30', 'PM') }],
      maguires: [{ code: 'W12', date: 'Today',    time: '6:00 AM', sortMinutes: to24HourMinutes('6', '00', 'AM') }],
      laang:    [{ code: '12',  date: 'Tomorrow', time: '7:15 AM', sortMinutes: to24HourMinutes('7', '15', 'AM') }],
    };

    let selectedDate = 'Today'; // Timings sheet state
    let timingsPaddockWheelInstances = [];
    let timingsTimeWheelInstances = [];
    let openNowPaddockWheelInstances = [];

    function currentSchedule() {
      const farm = FarmSmart.getActiveFarm();
      if (!scheduleByFarm[farm.id]) scheduleByFarm[farm.id] = [];
      return scheduleByFarm[farm.id];
    }

    // Today sorts before Tomorrow; within the same day, earlier times first.
    function sortSchedule(list) {
      const dateRank = (d) => (d === 'Today' ? 0 : 1);
      list.sort((a, b) => dateRank(a.date) - dateRank(b.date) || a.sortMinutes - b.sortMinutes);
    }

    function renderCard() {
      const list = currentSchedule();
      sortSchedule(list);

      const nameEl = document.getElementById('gateNextName');
      const timeEl = document.getElementById('gateNextTime');
      const box = document.getElementById('gateNextBox');
      const listEl = document.getElementById('gateList');

      if (list.length === 0) {
        box.classList.add('empty');
        nameEl.textContent = 'No gates scheduled';
        timeEl.textContent = '';
      } else {
        box.classList.remove('empty');
        const next = list[0];
        nameEl.textContent = next.code;
        timeEl.textContent = `${next.date}, ${next.time}`;
      }

      // Remaining entries (up to 3 more, 4 total) as a short list, each
      // deletable with its own small red X — no confirmation, matches
      // what was asked for (quick to fix a typo).
      listEl.innerHTML = '';
      list.slice(1).forEach((entry) => {
        const row = document.createElement('div');
        row.className = 'gate-list-row';
        row.innerHTML = `
          <span><span class="gate-list-row__text">${entry.code}</span><span class="gate-list-row__time">${entry.date}, ${entry.time}</span></span>
          <button class="gate-list-row__delete" aria-label="Remove">${DELETE_ICON_SVG}</button>
        `;
        row.querySelector('.gate-list-row__delete').addEventListener('click', () => {
          const idx = list.indexOf(entry);
          if (idx > -1) list.splice(idx, 1);
          renderCard();
        });
        listEl.appendChild(row);
      });
    }

    // ---- Build a row of paddock wheels for the given farm into containerEl ----
    function buildPaddockWheels(containerEl, farmId) {
      containerEl.innerHTML = '<div class="wheel-highlight"></div>';
      const config = PADDOCK_WHEEL_CONFIG[farmId] || [];
      return config.map((wheelDef) => {
        const col = document.createElement('div');
        containerEl.appendChild(col);
        return FarmSmart.createWheel(col, wheelDef.values, 0);
      });
    }

    // ---- "Timings" sheet ----
    function openTimingsSheet() {
      const list = currentSchedule();
      if (list.length >= MAX_SCHEDULED) {
        showToast(`Maximum ${MAX_SCHEDULED} scheduled gates — remove one first`);
        return;
      }

      const farm = FarmSmart.getActiveFarm();
      selectedDate = 'Today';
      document.querySelectorAll('#dateToggle .date-toggle__btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.date === 'Today');
      });

      timingsPaddockWheelInstances = buildPaddockWheels(document.getElementById('timingsPaddockWheels'), farm.id);
      timingsTimeWheelInstances = [
        FarmSmart.createWheel(document.getElementById('timingsHourWheel'), HOUR_VALUES, 0),
        FarmSmart.createWheel(document.getElementById('timingsMinuteWheel'), MINUTE_VALUES, 0),
        FarmSmart.createWheel(document.getElementById('timingsPeriodWheel'), PERIOD_VALUES, 0),
      ];

      document.getElementById('timingsSheetMask').classList.add('show');
    }
    function closeTimingsSheet() {
      document.getElementById('timingsSheetMask').classList.remove('show');
    }

    document.querySelectorAll('#dateToggle .date-toggle__btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedDate = btn.dataset.date;
        document.querySelectorAll('#dateToggle .date-toggle__btn').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });

    document.getElementById('timingsSaveBtn').addEventListener('click', () => {
      const farm = FarmSmart.getActiveFarm();
      const code = composePaddockCode(farm.id, timingsPaddockWheelInstances.map((w) => w.getValue()));
      const [hourWheel, minuteWheel, periodWheel] = timingsTimeWheelInstances;
      const hour = hourWheel.getValue(), minute = minuteWheel.getValue(), period = periodWheel.getValue();
      const time = `${hour}:${minute} ${period}`;

      currentSchedule().push({ code, date: selectedDate, time, sortMinutes: to24HourMinutes(hour, minute, period) });
      renderCard();
      closeTimingsSheet();
      showToast(`${code} scheduled for ${selectedDate}, ${time}`);
    });

    // ---- "Open Now" sheet ----
    function openOpenNowSheet() {
      const farm = FarmSmart.getActiveFarm();
      openNowPaddockWheelInstances = buildPaddockWheels(document.getElementById('openNowPaddockWheels'), farm.id);
      document.getElementById('openNowSheetMask').classList.add('show');
    }
    function closeOpenNowSheet() {
      document.getElementById('openNowSheetMask').classList.remove('show');
    }

    document.getElementById('openNowConfirmBtn').addEventListener('click', () => {
      const farm = FarmSmart.getActiveFarm();
      const code = composePaddockCode(farm.id, openNowPaddockWheelInstances.map((w) => w.getValue()));

      // The Open Now sheet stays open underneath while this confirms —
      // if the person cancels, they land right back on the wheels
      // instead of having to reopen the sheet from scratch.
      openConfirm(
        `Open paddock ${code} now?`,
        `This will open paddock ${code} immediately.`,
        'Open',
        () => {
          closeOpenNowSheet();
          showToast(`Paddock ${code} opened now`);
        }
      );
    });

    // Close either sheet by tapping the dimmed background.
    document.getElementById('timingsSheetMask').addEventListener('click', (e) => {
      if (e.target.id === 'timingsSheetMask') closeTimingsSheet();
    });
    document.getElementById('timingsSheetBackBtn').addEventListener('click', closeTimingsSheet);
    document.getElementById('openNowSheetMask').addEventListener('click', (e) => {
      if (e.target.id === 'openNowSheetMask') closeOpenNowSheet();
    });
    document.getElementById('openNowSheetBackBtn').addEventListener('click', closeOpenNowSheet);

    document.getElementById('editTimingsBtn').addEventListener('click', openTimingsSheet);
    document.getElementById('openGateNowBtn').addEventListener('click', openOpenNowSheet);

    document.addEventListener('farmsmart:farmchanged', renderCard);
    renderCard();
  },
});
