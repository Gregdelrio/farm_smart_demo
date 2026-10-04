/* =====================================================================
   TILE: PADDOCK GATES
   Two deliberately unrelated actions:
     "Timings"  schedules a future opening (up to 4, per farm);
     "Open Now" opens a paddock immediately, leaving the schedule alone.
   The paddock wheels depend on the active farm's naming scheme.
   ===================================================================== */

FarmSmart.registerTile({
  id: 'gates',
  name: 'Gates',

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

    <div class="sheet-mask" id="timingsSheetMask">
      <div class="sheet">
        <div class="sheet-header">
          <button class="sheet-back-btn" id="timingsSheetBackBtn" aria-label="Back">${FarmSmart.icons.back}</button>
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

    <div class="sheet-mask" id="openNowSheetMask">
      <div class="sheet">
        <div class="sheet-header">
          <button class="sheet-back-btn" id="openNowSheetBackBtn" aria-label="Back">${FarmSmart.icons.back}</button>
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
    const range = (length, start) => Array.from({ length }, (_, i) => String(i + start));

    // Paddock wheels per farm, and how their values combine into a code.
    const PADDOCK_WHEELS = {
      vickers: { wheels: [['A', 'B', 'C', 'D'], range(20, 1)], toCode: ([letter, number]) => letter + number },
      maguires: { wheels: [['-', 'W'], range(21, 10)], toCode: ([prefix, number]) => (prefix === '-' ? number : prefix + number) },
      laang: { wheels: [range(30, 1)], toCode: ([number]) => number },
    };

    const HOUR_VALUES = range(12, 1);
    const MINUTE_VALUES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
    const PERIOD_VALUES = ['AM', 'PM'];
    const MAX_SCHEDULED_GATES = 4;

    function to24HourMinutes(hour12, minute, period) {
      let h = parseInt(hour12, 10) % 12;
      if (period === 'PM') h += 12;
      return h * 60 + parseInt(minute, 10);
    }

    const scheduleEntry = (code, date, hour, minute, period) => ({
      code, date, time: `${hour}:${minute} ${period}`, sortMinutes: to24HourMinutes(hour, minute, period),
    });

    // Demo data, one plausible schedule per farm. Replace with an API.
    const scheduleByFarm = {
      vickers: [scheduleEntry('A5', 'Today', '4', '30', 'PM')],
      maguires: [scheduleEntry('W12', 'Today', '6', '00', 'AM')],
      laang: [scheduleEntry('12', 'Tomorrow', '7', '15', 'AM')],
    };

    let selectedDate = 'Today';
    let timingsPaddockWheels = [];
    let timingsTimeWheels = [];
    let openNowPaddockWheels = [];

    function currentSchedule() {
      const farmId = FarmSmart.activeFarmId;
      if (!scheduleByFarm[farmId]) scheduleByFarm[farmId] = [];
      return scheduleByFarm[farmId];
    }

    // Today before Tomorrow, then earliest first.
    function sortSchedule(list) {
      const dateRank = (date) => (date === 'Today' ? 0 : 1);
      list.sort((a, b) => dateRank(a.date) - dateRank(b.date) || a.sortMinutes - b.sortMinutes);
    }

    function renderCard() {
      const list = currentSchedule();
      sortSchedule(list);

      const next = list[0];
      document.getElementById('gateNextBox').classList.toggle('empty', !next);
      document.getElementById('gateNextName').textContent = next ? next.code : 'No gates scheduled';
      document.getElementById('gateNextTime').textContent = next ? `${next.date}, ${next.time}` : '';

      // The other entries, each removable without confirmation (quick
      // to fix a typo).
      const listEl = document.getElementById('gateList');
      listEl.innerHTML = '';
      list.slice(1).forEach((entry) => {
        const row = document.createElement('div');
        row.className = 'gate-list-row';
        row.innerHTML = `
          <span><span class="gate-list-row__text">${entry.code}</span><span class="gate-list-row__time">${entry.date}, ${entry.time}</span></span>
          <button class="gate-list-row__delete" aria-label="Remove">${FarmSmart.icons.close}</button>
        `;
        row.querySelector('.gate-list-row__delete').addEventListener('click', () => {
          list.splice(list.indexOf(entry), 1);
          renderCard();
        });
        listEl.appendChild(row);
      });
    }

    function buildPaddockWheels(containerId) {
      const container = document.getElementById(containerId);
      container.innerHTML = '<div class="wheel-highlight"></div>';
      const config = PADDOCK_WHEELS[FarmSmart.getActiveFarm().code];
      return (config ? config.wheels : []).map((values) => {
        const col = document.createElement('div');
        container.appendChild(col);
        return FarmSmart.createWheel(col, values, 0);
      });
    }

    function selectedPaddockCode(wheels) {
      const values = wheels.map((wheel) => wheel.getValue());
      const config = PADDOCK_WHEELS[FarmSmart.getActiveFarm().code];
      return config ? config.toCode(values) : values.join('');
    }

    // ---- "Timings" sheet ----
    const timingsSheet = FarmSmart.createPanel('timingsSheetMask', 'timingsSheetBackBtn');
    const dateButtons = document.querySelectorAll('#dateToggle .date-toggle__btn');

    function selectDate(date) {
      selectedDate = date;
      dateButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.date === date));
    }

    function openTimingsSheet() {
      if (currentSchedule().length >= MAX_SCHEDULED_GATES) {
        showToast(`Maximum ${MAX_SCHEDULED_GATES} scheduled gates — remove one first`);
        return;
      }
      selectDate('Today');
      timingsPaddockWheels = buildPaddockWheels('timingsPaddockWheels');
      timingsTimeWheels = [
        FarmSmart.createWheel(document.getElementById('timingsHourWheel'), HOUR_VALUES, 0),
        FarmSmart.createWheel(document.getElementById('timingsMinuteWheel'), MINUTE_VALUES, 0),
        FarmSmart.createWheel(document.getElementById('timingsPeriodWheel'), PERIOD_VALUES, 0),
      ];
      timingsSheet.open();
    }

    dateButtons.forEach((btn) => btn.addEventListener('click', () => selectDate(btn.dataset.date)));

    document.getElementById('timingsSaveBtn').addEventListener('click', () => {
      const code = selectedPaddockCode(timingsPaddockWheels);
      const [hour, minute, period] = timingsTimeWheels.map((wheel) => wheel.getValue());
      const entry = scheduleEntry(code, selectedDate, hour, minute, period);
      currentSchedule().push(entry);
      renderCard();
      timingsSheet.close();
      showToast(`${code} scheduled for ${entry.date}, ${entry.time}`);
    });

    // ---- "Open Now" sheet ----
    const openNowSheet = FarmSmart.createPanel('openNowSheetMask', 'openNowSheetBackBtn');

    function openOpenNowSheet() {
      openNowPaddockWheels = buildPaddockWheels('openNowPaddockWheels');
      openNowSheet.open();
    }

    document.getElementById('openNowConfirmBtn').addEventListener('click', () => {
      const code = selectedPaddockCode(openNowPaddockWheels);
      // The sheet stays open underneath, so cancelling lands back on the wheels.
      openConfirm(`Open paddock ${code} now?`, `This will open paddock ${code} immediately.`, 'Open', () => {
        openNowSheet.close();
        showToast(`Paddock ${code} opened now`);
      });
    });

    document.getElementById('editTimingsBtn').addEventListener('click', openTimingsSheet);
    document.getElementById('openGateNowBtn').addEventListener('click', openOpenNowSheet);
    document.addEventListener('farmsmart:farmchanged', renderCard);
    renderCard();
  },
});
