/* =====================================================================
   TILE: SHIFT CLOCK
   Self-service time clock: Clock On (pick a farm), meal break, Clock
   Off, and Clock On Again later the same day (split shifts). A day is
   one `timesheet_shifts` row; each stretch of work, from a clock on to
   a break or clock off, is one `timesheet_segments` row.

   The app user is matched to a current employee by code (user 'greg'
   is employee 'greg'). Without a match the clock still works, but only
   on this device.

   Local first, for patchy signal: each action is saved on the phone at
   once and queued, then sent to the database. Unsent days are retried
   when the signal returns and every minute. Each action also captures
   the device's GPS and compares it to the farm's estimated centre; GPS
   never blocks an action, it only annotates the record. Shifts past
   midnight are not supported.
   ===================================================================== */

FarmSmart.registerTile({
  id: 'shift-clock',
  name: 'Shift Clock',

  html: `
    <div class="card" id="scCard">
      <div class="card-top">
        <span class="card-title"><i class="ti ti-fingerprint"></i>Shift Clock</span>
        <span class="badge info" id="scBadge"></span>
      </div>

      <p class="sc-status-line" id="scStatusLine">Not clocked in</p>
      <p class="sc-location-line" id="scLocationLine" style="display:none;"></p>
      <p class="sc-summary-line" id="scSummaryLine" style="display:none;"></p>

      <div class="sc-actions" id="scActions"></div>

      <p class="sc-gps-note" id="scNote"></p>
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
    const RETRY_MS = 60000;
    const EMPLOYEES_CACHE_KEY = 'farmsmart-shiftclock-employees';
    const SYNC_LABELS = { saving: 'Saving…', saved: 'Saved', pending: 'Offline, will sync', local: 'This device only' };

    let employees = [];
    let employee = null;   // the current employee matching the app user
    let state = null;      // today's clock, shown on the card
    let outbox = [];       // days changed on this phone, not yet saved
    let busy = false;      // an action is running (GPS can take seconds)
    let syncing = false;

    const todayKey = () => FarmSmart.toDateKey(new Date());
    const nowTime = () => new Date().toTimeString().slice(0, 8); // local 'HH:MM:SS'
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const escape = FarmSmart.escapeHtml;

    function toSeconds(time) {
      const [h, m, s = 0] = time.split(':').map(Number);
      return h * 3600 + m * 60 + s;
    }

    function formatTime(time) {
      const [h, m] = time.split(':').map(Number);
      return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
    }

    function formatDuration(seconds) {
      const totalMinutes = Math.floor(seconds / 60);
      const h = Math.floor(totalMinutes / 60);
      const m = totalMinutes % 60;
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }

    const workedSeconds = (segments) => segments
      .filter((s) => s.end)
      .reduce((total, s) => total + toSeconds(s.end) - toSeconds(s.start), 0);

    const farmName = (farmId) => (FarmSmart.getFarm(farmId) || { name: 'your farm' }).name;

    /* ---------- Who is clocking ---------- */

    function findEmployee() {
      const today = todayKey();
      return employees.find((e) => e.code === FarmSmart.currentUser.id && (!e.end_date || e.end_date >= today)) || null;
    }

    async function loadEmployees() {
      try {
        const { data, error } = await FarmSmart.supabase().from('employees')
          .select('id, code, end_date').eq('company_id', FarmSmart.company.id);
        if (error) throw error;
        employees = data;
        FarmSmart.storage.setJson(EMPLOYEES_CACHE_KEY, employees);
      } catch (err) {
        console.error('[shift-clock] Could not load employees, using the cached list:', err);
        employees = FarmSmart.storage.getJson(EMPLOYEES_CACHE_KEY) || [];
      }
    }

    /* ---------- Local copy (works offline) ---------- */

    const storageKey = () => `farmsmart-shiftclock-${employee ? employee.id : 'user-' + FarmSmart.currentUser.id}`;

    function freshState() {
      return { dateKey: todayKey(), status: 'off', farmId: null, segments: [], checks: [] };
    }

    function loadLocal() {
      const saved = FarmSmart.storage.getJson(storageKey()) || {};
      outbox = Array.isArray(saved.outbox) ? saved.outbox : [];
      state = saved.state && saved.state.dateKey === todayKey() ? saved.state : freshState();
    }

    const saveLocal = () => FarmSmart.storage.setJson(storageKey(), { state, outbox });

    /* ---------- Database ---------- */

    function rowToState(row) {
      const segments = row.timesheet_segments
        .map((s) => ({ start: s.start_time, end: s.end_time }))
        .sort((a, b) => a.start.localeCompare(b.start));
      return {
        dateKey: todayKey(),
        status: segments.length ? row.status : 'off',
        farmId: row.farm_id,
        segments,
        checks: row.gps_checks || [],
      };
    }

    // Two requests, not one transaction: if the second fails, the day
    // stays in the outbox and the retry rewrites both. Segments are
    // upserted in start order, so an open segment is closed before the
    // next one opens (the database allows one open segment per day).
    async function sendDay(day) {
      const db = FarmSmart.supabase();
      const { data: shift, error } = await db.from('timesheet_shifts').upsert({
        employee_id: day.employeeId,
        farm_id: day.farmId,
        work_date: day.dateKey,
        status: day.status,
        gps_checks: day.checks,
        source: 'clock',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'employee_id,work_date' }).select('id').single();
      if (error) throw error;

      const segments = day.segments.map((s) => ({ shift_id: shift.id, start_time: s.start, end_time: s.end }));
      const { error: segmentError } = await db.from('timesheet_segments')
        .upsert(segments, { onConflict: 'shift_id,start_time' });
      if (segmentError) throw segmentError;
    }

    async function sync() {
      if (!employee) { renderBadge('local'); return; }
      if (syncing || !outbox.length) return;
      syncing = true;
      renderBadge('saving');
      try {
        while (outbox.length) {
          const day = outbox[0];
          await sendDay(day);
          // A newer copy of the same day may have been queued meanwhile; it stays.
          outbox = outbox.filter((d) => d !== day);
          saveLocal();
        }
        renderBadge('saved');
      } catch (err) {
        console.error('[shift-clock] Could not save, will retry:', err);
        renderBadge('pending');
      }
      syncing = false;
    }

    // Today's row in the database wins, unless this phone still has
    // changes it could not send.
    async function loadToday() {
      employee = findEmployee();
      loadLocal();
      render();
      if (!employee) return;
      await sync();
      if (outbox.length) return;
      try {
        const { data, error } = await FarmSmart.supabase().from('timesheet_shifts')
          .select('farm_id, status, gps_checks, timesheet_segments(start_time, end_time)')
          .eq('employee_id', employee.id).eq('work_date', todayKey()).maybeSingle();
        if (error) throw error;
        if (data) { state = rowToState(data); saveLocal(); }
        renderBadge('saved');
      } catch (err) {
        console.error("[shift-clock] Could not load today's shift:", err);
        renderBadge('pending');
      }
      render();
    }

    /* ---------- GPS ---------- */

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

    async function recordCheck(action, farmId) {
      const farm = FarmSmart.getFarm(farmId);
      const point = await captureLocation();
      const check = { action, at: new Date().toISOString(), point, farmName: farmName(farmId), matched: false, distanceKm: null };
      if (!point || !farm || typeof farm.lat !== 'number') return check;
      const distanceKm = FarmSmart.distanceKm(point, farm);
      return { ...check, matched: distanceKm <= MATCH_RADIUS_KM, distanceKm };
    }

    function locationNote(check) {
      if (!check.point) return '<span class="sc-location-line--unknown"><i class="ti ti-map-pin-off"></i>Location unavailable</span>';
      if (check.matched) return `<span class="sc-location-line--ok"><i class="ti ti-map-pin-check"></i>Verified at ${escape(check.farmName)}</span>`;
      return `<span class="sc-location-line--warn"><i class="ti ti-map-pin-exclamation"></i>${check.distanceKm.toFixed(1)} km from ${escape(check.farmName)} — doesn't look like a match</span>`;
    }

    /* ---------- Rendering ---------- */

    function renderBadge(syncState) {
      document.getElementById('scBadge').textContent = SYNC_LABELS[syncState] || '';
    }

    function renderActions(actions) {
      const container = document.getElementById('scActions');
      container.innerHTML = actions.map((a, i) =>
        `<button class="card-btn${a.primary ? ' primary' : ''}" data-action="${i}"${busy ? ' disabled' : ''}><i class="ti ${a.icon}"></i>${a.label}</button>`).join('');
      container.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', actions[btn.dataset.action].onClick);
      });
    }

    function render() {
      if (state.dateKey !== todayKey()) state = freshState(); // a new day starts fresh
      const statusLine = document.getElementById('scStatusLine');
      const locationLine = document.getElementById('scLocationLine');
      const summaryLine = document.getElementById('scSummaryLine');
      const segments = state.segments;
      const first = segments[0];
      const last = segments[segments.length - 1];
      const lastCheck = state.checks[state.checks.length - 1];
      const worked = workedSeconds(segments);
      const showSummary = (text) => { summaryLine.style.display = text ? 'block' : 'none'; summaryLine.textContent = text; };

      locationLine.style.display = lastCheck ? 'block' : 'none';
      if (lastCheck) locationLine.innerHTML = locationNote(lastCheck);
      document.getElementById('scNote').textContent = employee
        ? "Uses your device's location to confirm which farm you're clocking in from."
        : `${FarmSmart.currentUser.name} is not a current employee: this clock stays on this device and won't reach the timesheet.`;

      if (state.status === 'on') {
        statusLine.textContent = `Clocked on at ${farmName(state.farmId)} since ${formatTime(last.start)}`;
        showSummary(worked > 0 ? `${formatDuration(worked)} worked earlier today` : '');
        renderActions([
          { label: 'Start Meal Break', icon: 'ti-coffee', onClick: startBreak },
          { label: 'Clock Off', icon: 'ti-logout', primary: true, onClick: clockOff },
        ]);
      } else if (state.status === 'break') {
        statusLine.textContent = `On meal break since ${formatTime(last.end)}`;
        showSummary(`${formatDuration(worked)} worked so far`);
        renderActions([
          { label: 'End Meal Break', icon: 'ti-player-play', primary: true, onClick: endBreak },
          { label: 'Clock Off', icon: 'ti-logout', onClick: clockOff },
        ]);
      } else if (state.status === 'complete') {
        const breaks = toSeconds(last.end) - toSeconds(first.start) - worked;
        const breakNote = breaks >= 60 ? ` (${formatDuration(breaks)} break)` : '';
        statusLine.textContent = `Shift complete at ${farmName(state.farmId)}`;
        showSummary(`${formatTime(first.start)} – ${formatTime(last.end)} · ${formatDuration(worked)} worked${breakNote}`);
        renderActions([{ label: 'Clock On Again', icon: 'ti-login', primary: true, onClick: clockOnAgain }]);
      } else {
        statusLine.textContent = 'Not clocked in';
        showSummary('');
        renderActions([{ label: 'Clock On', icon: 'ti-login', primary: true, onClick: openFarmSheet }]);
      }
    }

    /* ---------- Actions: change the local copy first, then sync ---------- */

    // A time at least one second after `after`, so quick taps never give
    // a zero-length segment or two segments starting at the same second.
    function timeAfter(after) {
      const now = nowTime();
      if (!after || now > after) return now;
      const s = toSeconds(after) + 1;
      return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
    }

    function lastTime() {
      const last = state.segments[state.segments.length - 1];
      return last && (last.end || last.start);
    }

    const openSegment = () => state.segments.push({ start: timeAfter(lastTime()), end: null });
    const closeSegment = () => { state.segments[state.segments.length - 1].end = timeAfter(lastTime()); };

    async function act(action, farmId, change, toastMessage) {
      if (busy) return;
      busy = true;
      render();
      const check = await recordCheck(action, farmId);
      if (state.dateKey !== todayKey()) state = freshState();
      change();
      state.checks.push(check);
      if (employee) {
        outbox = outbox.filter((d) => d.dateKey !== state.dateKey).concat({ ...clone(state), employeeId: employee.id });
      }
      saveLocal();
      busy = false;
      render();
      showToast(toastMessage);
      sync();
    }

    const clockOn = (farmId) => act('clock_on', farmId, () => {
      state.farmId = farmId;
      state.segments = [];
      openSegment();
      state.status = 'on';
    }, `Clocked on at ${farmName(farmId)}`);

    // Same day, same farm (one row per day): opens a new segment.
    const clockOnAgain = () => act('clock_on', state.farmId, () => {
      openSegment();
      state.status = 'on';
    }, 'Clocked on again');

    const startBreak = () => act('break_start', state.farmId, () => {
      closeSegment();
      state.status = 'break';
    }, 'Meal break started');

    const endBreak = () => act('break_end', state.farmId, () => {
      openSegment();
      state.status = 'on';
    }, 'Meal break ended');

    // During a break the last segment is already closed.
    const clockOff = () => act('clock_off', state.farmId, () => {
      if (state.status === 'on') closeSegment();
      state.status = 'complete';
    }, 'Clocked off');

    const farmSheet = FarmSmart.createPanel('scFarmSheetMask', 'scFarmSheetBackBtn');

    function openFarmSheet() {
      const list = document.getElementById('scFarmList');
      list.innerHTML = FarmSmart.farms.map((f) => `
        <button type="button" class="sheet-row" data-farm="${f.id}">
          <span class="sheet-row__title">${escape(f.name)}</span>
          <span class="sheet-row__meta">${escape(f.roadName)}</span>
        </button>`).join('');
      list.querySelectorAll('.sheet-row').forEach((btn) => {
        btn.addEventListener('click', () => { farmSheet.close(); clockOn(btn.dataset.farm); });
      });
      farmSheet.open();
    }

    window.addEventListener('online', sync);
    setInterval(sync, RETRY_MS);
    document.addEventListener('farmsmart:userchanged', loadToday);

    state = freshState();
    render();
    loadEmployees().then(loadToday);
  },
});
