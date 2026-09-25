/* =====================================================================
   TILE: SHIFT CLOCK
   ---------------------------------------------------------------------
   TO DISABLE THIS TILE: comment out (or delete) in index.html:
     <link rel="stylesheet" href="css/tiles/shift-clock.css">
     <script src="js/tiles/shift-clock.js"></script>

   DESIGN NOTES:
   - Deputy-style self-service time clock: Clock On (choose one of the
     3 farms the first time), Start/End Meal Break, Clock Off. This is
     a SEPARATE tile from Timesheet, not a replacement — Timesheet
     keeps its own synthetic demo week; this tile is where a real
     clock-on/off session would actually get recorded if this were a
     production app.
   - Visible to EVERYONE (Owner and Employee) — unlike Milk Statement
     or Timesheet, this isn't sensitive payroll data, it's just "am I
     clocked on right now", which both roles have a reason to use
     (John could clock on too, e.g. for casual relief work).
   - State is tracked PER CURRENT USER (keyed by name) and PER DAY —
     switching the demo's user picker (John/Greg) shows that person's
     own clock state, and a new calendar day starts fresh. Only ONE
     clock-on session per day is modelled (clock on → optional break →
     clock off); this keeps the demo simple rather than supporting
     multiple split sessions in a single day.
   - GPS: uses the browser's native Geolocation API
     (navigator.geolocation.getCurrentPosition), which prompts the
     person for permission the first time. A position is captured at
     every action (clock on, break start/end, clock off) and compared
     to the selected farm's coordinates (added to the FARMS array in
     core.js) using the Haversine formula. Farms only have an
     ESTIMATED centre point (not a real surveyed boundary), so the
     match radius (SC_MATCH_RADIUS_KM) is deliberately generous — this
     is a plausibility check for a demo, not a strict geofence. If
     location is denied, unavailable, or times out, the clock action
     still goes through — GPS never blocks clocking on/off, it only
     annotates the record.
   ===================================================================== */

const SC_MATCH_RADIUS_KM = 2; // generous — farms only have an estimated centre point, not a real boundary

function scHaversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Wraps the Geolocation API in a promise that ALWAYS resolves (never
// rejects) — denied permission, no GPS hardware, or a timeout all just
// resolve to null, so a clock action is never blocked by location.
function scCaptureLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  });
}

function scTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function scFormatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
}
function scFormatDuration(ms) {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

FarmSmart.registerTile({
  id: 'shift-clock',

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

    <!-- ================= FARM PICKER SHEET (first Clock On of the day) ================= -->
    <div class="sheet-mask" id="scFarmSheetMask">
      <div class="sheet">
        <div class="sheet-header">
          <button class="sheet-back-btn" id="scFarmSheetBackBtn" aria-label="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <h2>Clock On — Which farm?</h2>
        </div>
        <div id="scFarmList"></div>
      </div>
    </div>
  `,

  init: function () {
    function storageKey() {
      return `farmsmart-shiftclock-${FarmSmart.currentUser.name}`;
    }

    function loadState() {
      try {
        const raw = localStorage.getItem(storageKey());
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.dateKey === scTodayKey()) return parsed;
        }
      } catch (e) { /* fall through to a fresh state */ }
      return { dateKey: scTodayKey(), status: 'off', farmId: null, clockInTime: null, breakStartTime: null, totalBreakMs: 0, clockOffTime: null, checks: [] };
    }
    function saveState(state) {
      try { localStorage.setItem(storageKey(), JSON.stringify(state)); } catch (e) { /* demo still works this session */ }
    }

    let state = loadState();

    function locationNote(check) {
      if (!check) return '';
      if (!check.point) return '<span class="sc-location-line--unknown"><i class="ti ti-map-pin-off"></i>Location unavailable</span>';
      if (check.matched) return `<span class="sc-location-line--ok"><i class="ti ti-map-pin-check"></i>Verified at ${check.farmName}</span>`;
      return `<span class="sc-location-line--warn"><i class="ti ti-map-pin-exclamation"></i>${check.distanceKm.toFixed(1)} km from ${check.farmName} — doesn't look like a match</span>`;
    }

    async function recordCheck(farmId) {
      const farm = FARMS.find((f) => f.id === farmId);
      const point = await scCaptureLocation();
      if (!point || !farm || typeof farm.lat !== 'number') return { point, matched: false, distanceKm: null, farmName: farm ? farm.name : farmId };
      const distanceKm = scHaversineKm(point.lat, point.lng, farm.lat, farm.lng);
      return { point, matched: distanceKm <= SC_MATCH_RADIUS_KM, distanceKm, farmName: farm.name };
    }

    function render() {
      const statusLine = document.getElementById('scStatusLine');
      const locationLine = document.getElementById('scLocationLine');
      const summaryLine = document.getElementById('scSummaryLine');
      const actions = document.getElementById('scActions');
      const lastCheck = state.checks[state.checks.length - 1];

      locationLine.style.display = lastCheck ? 'block' : 'none';
      if (lastCheck) locationLine.innerHTML = locationNote(lastCheck);

      if (state.status === 'off' && !state.clockOffTime) {
        statusLine.textContent = 'Not clocked in';
        summaryLine.style.display = 'none';
        actions.innerHTML = `<button class="card-btn primary" id="scClockOnBtn"><i class="ti ti-login"></i>Clock On</button>`;
        document.getElementById('scClockOnBtn').addEventListener('click', openFarmSheet);
      } else if (state.status === 'on') {
        const farm = FARMS.find((f) => f.id === state.farmId);
        statusLine.textContent = `Clocked on at ${farm ? farm.name : state.farmId} since ${scFormatTime(state.clockInTime)}`;
        summaryLine.style.display = 'none';
        actions.innerHTML = `
          <button class="card-btn" id="scBreakBtn"><i class="ti ti-coffee"></i>Start Meal Break</button>
          <button class="card-btn primary" id="scClockOffBtn"><i class="ti ti-logout"></i>Clock Off</button>`;
        document.getElementById('scBreakBtn').addEventListener('click', startBreak);
        document.getElementById('scClockOffBtn').addEventListener('click', clockOff);
      } else if (state.status === 'break') {
        statusLine.textContent = `On meal break since ${scFormatTime(state.breakStartTime)}`;
        summaryLine.style.display = 'none';
        actions.innerHTML = `<button class="card-btn primary" id="scEndBreakBtn"><i class="ti ti-player-play"></i>End Meal Break</button>`;
        document.getElementById('scEndBreakBtn').addEventListener('click', endBreak);
      } else if (state.clockOffTime) {
        const farm = FARMS.find((f) => f.id === state.farmId);
        const workedMs = new Date(state.clockOffTime) - new Date(state.clockInTime) - state.totalBreakMs;
        statusLine.textContent = `Shift complete at ${farm ? farm.name : state.farmId}`;
        summaryLine.style.display = 'block';
        summaryLine.textContent = `${scFormatTime(state.clockInTime)} – ${scFormatTime(state.clockOffTime)} · ${scFormatDuration(Math.max(0, workedMs))} worked${state.totalBreakMs > 0 ? ` (${scFormatDuration(state.totalBreakMs)} break)` : ''}`;
        actions.innerHTML = `<button class="card-btn primary" id="scClockOnBtn"><i class="ti ti-login"></i>Clock On Again</button>`;
        document.getElementById('scClockOnBtn').addEventListener('click', openFarmSheet);
      }
    }

    function openFarmSheet() {
      const list = document.getElementById('scFarmList');
      list.innerHTML = FARMS.map((f) => `
        <button type="button" class="sheet-row" data-farm="${f.id}">
          <span class="sheet-row__title">${f.name}</span>
          <span class="sheet-row__meta">${f.roadName}</span>
        </button>`).join('');
      list.querySelectorAll('.sheet-row').forEach((btn) => {
        btn.addEventListener('click', () => { closeFarmSheet(); clockOn(btn.dataset.farm); });
      });
      document.getElementById('scFarmSheetMask').classList.add('show');
    }
    function closeFarmSheet() { document.getElementById('scFarmSheetMask').classList.remove('show'); }

    async function clockOn(farmId) {
      const check = await recordCheck(farmId);
      state = { dateKey: scTodayKey(), status: 'on', farmId, clockInTime: new Date().toISOString(), breakStartTime: null, totalBreakMs: 0, clockOffTime: null, checks: [check] };
      saveState(state);
      render();
      showToast(`Clocked on at ${check.farmName}`);
    }

    async function startBreak() {
      const check = await recordCheck(state.farmId);
      state.status = 'break';
      state.breakStartTime = new Date().toISOString();
      state.checks.push(check);
      saveState(state);
      render();
      showToast('Meal break started');
    }

    async function endBreak() {
      const check = await recordCheck(state.farmId);
      state.totalBreakMs += (new Date() - new Date(state.breakStartTime));
      state.breakStartTime = null;
      state.status = 'on';
      state.checks.push(check);
      saveState(state);
      render();
      showToast('Meal break ended');
    }

    async function clockOff() {
      const check = await recordCheck(state.farmId);
      // Clocking off while still on a break closes the break out too,
      // so worked-time math above always has a clean break total.
      if (state.status === 'break' && state.breakStartTime) {
        state.totalBreakMs += (new Date() - new Date(state.breakStartTime));
      }
      state.status = 'off';
      state.clockOffTime = new Date().toISOString();
      state.checks.push(check);
      saveState(state);
      render();
      showToast('Clocked off');
    }

    document.getElementById('scFarmSheetBackBtn').addEventListener('click', closeFarmSheet);
    document.getElementById('scFarmSheetMask').addEventListener('click', (e) => {
      if (e.target.id === 'scFarmSheetMask') closeFarmSheet();
    });

    function refreshSyncBadge() {
      document.getElementById('scBadge').textContent = FarmSmart.randomSyncLabel();
    }

    // Switching the demo's user picker (John/Greg) should show that
    // person's own clock state, not whoever was active before.
    document.addEventListener('farmsmart:userchanged', () => { state = loadState(); render(); });

    render();
    refreshSyncBadge();
    setInterval(refreshSyncBadge, 20000);
  },
});
