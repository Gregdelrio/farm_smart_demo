/* =====================================================================
   TILE: SHIFT CLOCK
   Self-service time clock: Clock On (pick a farm), meal break, Clock
   Off. One session per day, stored per demo user so switching user
   shows their own state. Each action captures the device's GPS and
   compares it to the farm's estimated centre; GPS never blocks an
   action (denied or unavailable just annotates the record).
   ===================================================================== */

FarmSmart.registerTile({
  id: 'shift-clock',
  name: 'Shift Clock',

  html: `
    <div class="card" id="scCard">
      <div class="card-top">
        <span class="card-title"><i class="ti ti-fingerprint"></i>Shift Clock</span>
        <span class="badge info" id="scBadge">Synced 4 min ago</span>
      </div>

      <p class="sc-status-line" id="scStatusLine">Not clocked in</p>
      <p class="sc-location-line" id="scLocationLine" style="display:none;"></p>
      <p class="sc-summary-line" id="scSummaryLine" style="display:none;"></p>

      <div class="sc-actions" id="scActions"></div>

      <p class="sc-gps-note">Uses your device's location to confirm which farm you're clocking in from.</p>
    </div>

    <div class="sheet-mask" id="scFarmSheetMask">
      <div class="sheet">
        <div class="sheet-header">
          <button class="sheet-back-btn" id="scFarmSheetBackBtn" aria-label="Back">${FarmSmart.icons.back}</button>
          <h2>Clock On — Which farm?</h2>
        </div>
        <div id="scFarmList"></div>
      </div>
    </div>
  `,

  init: function () {
    // Generous: farms only have an estimated centre, not a real boundary.
    const MATCH_RADIUS_KM = 2;

    const todayKey = () => FarmSmart.toDateKey(new Date());
    const storageKey = () => `farmsmart-shiftclock-${FarmSmart.currentUser.name}`;
    const farmName = (farmId) => (FarmSmart.getFarm(farmId) || { name: farmId }).name;
    const formatTime = (iso) => new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });

    function formatDuration(ms) {
      const totalMinutes = Math.round(ms / 60000);
      const h = Math.floor(totalMinutes / 60);
      const m = totalMinutes % 60;
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }

    function freshState() {
      return { dateKey: todayKey(), status: 'off', farmId: null, clockInTime: null, breakStartTime: null, totalBreakMs: 0, clockOffTime: null, checks: [] };
    }

    function loadState() {
      const saved = FarmSmart.storage.getJson(storageKey());
      return saved && saved.dateKey === todayKey() ? saved : freshState();
    }
    const saveState = () => FarmSmart.storage.setJson(storageKey(), state);

    let state = loadState();

    // Always resolves: denied, unavailable or timed out all give null.
    function captureLocation() {
      return new Promise((resolve) => {
        if (!navigator.geolocation) { resolve(null); return; }
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
        );
      });
    }

    async function recordCheck(farmId) {
      const farm = FarmSmart.getFarm(farmId);
      const point = await captureLocation();
      if (!point || !farm || typeof farm.lat !== 'number') return { point, matched: false, distanceKm: null, farmName: farmName(farmId) };
      const distanceKm = FarmSmart.distanceKm(point, farm);
      return { point, matched: distanceKm <= MATCH_RADIUS_KM, distanceKm, farmName: farm.name };
    }

    function locationNote(check) {
      if (!check.point) return '<span class="sc-location-line--unknown"><i class="ti ti-map-pin-off"></i>Location unavailable</span>';
      if (check.matched) return `<span class="sc-location-line--ok"><i class="ti ti-map-pin-check"></i>Verified at ${check.farmName}</span>`;
      return `<span class="sc-location-line--warn"><i class="ti ti-map-pin-exclamation"></i>${check.distanceKm.toFixed(1)} km from ${check.farmName} — doesn't look like a match</span>`;
    }

    function renderActions(actions) {
      const container = document.getElementById('scActions');
      container.innerHTML = actions.map((a, i) =>
        `<button class="card-btn${a.primary ? ' primary' : ''}" data-action="${i}"><i class="ti ${a.icon}"></i>${a.label}</button>`).join('');
      container.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', actions[btn.dataset.action].onClick);
      });
    }

    function render() {
      const statusLine = document.getElementById('scStatusLine');
      const locationLine = document.getElementById('scLocationLine');
      const summaryLine = document.getElementById('scSummaryLine');
      const lastCheck = state.checks[state.checks.length - 1];

      locationLine.style.display = lastCheck ? 'block' : 'none';
      if (lastCheck) locationLine.innerHTML = locationNote(lastCheck);
      summaryLine.style.display = 'none';

      if (state.status === 'on') {
        statusLine.textContent = `Clocked on at ${farmName(state.farmId)} since ${formatTime(state.clockInTime)}`;
        renderActions([
          { label: 'Start Meal Break', icon: 'ti-coffee', onClick: startBreak },
          { label: 'Clock Off', icon: 'ti-logout', primary: true, onClick: clockOff },
        ]);
      } else if (state.status === 'break') {
        statusLine.textContent = `On meal break since ${formatTime(state.breakStartTime)}`;
        renderActions([{ label: 'End Meal Break', icon: 'ti-player-play', primary: true, onClick: endBreak }]);
      } else if (state.clockOffTime) {
        const workedMs = new Date(state.clockOffTime) - new Date(state.clockInTime) - state.totalBreakMs;
        const breakNote = state.totalBreakMs > 0 ? ` (${formatDuration(state.totalBreakMs)} break)` : '';
        statusLine.textContent = `Shift complete at ${farmName(state.farmId)}`;
        summaryLine.style.display = 'block';
        summaryLine.textContent = `${formatTime(state.clockInTime)} – ${formatTime(state.clockOffTime)} · ${formatDuration(Math.max(0, workedMs))} worked${breakNote}`;
        renderActions([{ label: 'Clock On Again', icon: 'ti-login', primary: true, onClick: openFarmSheet }]);
      } else {
        statusLine.textContent = 'Not clocked in';
        renderActions([{ label: 'Clock On', icon: 'ti-login', primary: true, onClick: openFarmSheet }]);
      }
    }

    /** Runs one clock action: records GPS, applies the change, saves, re-renders. */
    async function clockAction(farmId, applyChange, toastMessage) {
      const check = await recordCheck(farmId);
      applyChange(check);
      state.checks.push(check);
      saveState();
      render();
      showToast(typeof toastMessage === 'function' ? toastMessage(check) : toastMessage);
    }

    // Closes a running break into the total, so worked time stays exact.
    function endRunningBreak() {
      if (state.status === 'break' && state.breakStartTime) state.totalBreakMs += new Date() - new Date(state.breakStartTime);
      state.breakStartTime = null;
    }

    const clockOn = (farmId) => clockAction(farmId, () => {
      state = { ...freshState(), status: 'on', farmId, clockInTime: new Date().toISOString() };
    }, (check) => `Clocked on at ${check.farmName}`);

    const startBreak = () => clockAction(state.farmId, () => {
      state.status = 'break';
      state.breakStartTime = new Date().toISOString();
    }, 'Meal break started');

    const endBreak = () => clockAction(state.farmId, () => {
      endRunningBreak();
      state.status = 'on';
    }, 'Meal break ended');

    const clockOff = () => clockAction(state.farmId, () => {
      endRunningBreak();
      state.status = 'off';
      state.clockOffTime = new Date().toISOString();
    }, 'Clocked off');

    const farmSheet = FarmSmart.createPanel('scFarmSheetMask', 'scFarmSheetBackBtn');

    function openFarmSheet() {
      const list = document.getElementById('scFarmList');
      list.innerHTML = FarmSmart.farms.map((f) => `
        <button type="button" class="sheet-row" data-farm="${f.id}">
          <span class="sheet-row__title">${f.name}</span>
          <span class="sheet-row__meta">${f.roadName}</span>
        </button>`).join('');
      list.querySelectorAll('.sheet-row').forEach((btn) => {
        btn.addEventListener('click', () => { farmSheet.close(); clockOn(btn.dataset.farm); });
      });
      farmSheet.open();
    }

    document.addEventListener('farmsmart:userchanged', () => { state = loadState(); render(); });

    render();
    FarmSmart.startSyncBadge('scBadge');
  },
});
