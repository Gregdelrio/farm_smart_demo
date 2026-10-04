/* =====================================================================
   TILE: EMPLOYEE TIMESHEET (Owner only)
   Real hours from `timesheet_shifts` and their `timesheet_segments`
   (written live by Shift Clock), one pay fortnight at a time. Hours
   only, never pay amounts: rates live in Xero.

   Pay rules (Pastoral Award MA000035), all settings from `companies`:
   - Fortnights run Monday to Sunday, counted from pay_anchor.
   - Overtime: each employee has their own cycle (cycle_days, from
     cycle_start). Once the cycle passes ot_threshold_hours, every
     further minute in it is overtime; a day crossing it is split.
   - Pay lines sent to Xero: ordinary, overtime, Sunday overtime, and
     public holiday (all hours on a holiday; they still count towards
     the cycle).
   - The first rest break of the day is paid, up to 10 minutes; meal
     breaks are not (clause 12).
   A shift still running is shown, but only finished segments count.
   Dates are local: never toISOString(), which shifts the day.
   ===================================================================== */

FarmSmart.registerTile({
  id: 'timesheet',
  name: 'Timesheet',

  html: `
    <div class="card" id="tsCard">
      <div class="card-top">
        <span class="card-title"><i class="ti ti-clock-hour-4"></i>Timesheet</span>
        <span class="badge info" id="tsBadge"></span>
      </div>

      <p class="ts-today-line" id="tsTodayLine"></p>

      <div id="tsTodayList" class="ts-today-list"><p class="ts-no-past-shifts">Loading…</p></div>

      <button class="card-btn" id="tsDetailsBtn" disabled><i class="ti ti-clock-hour-4"></i>View details</button>
    </div>

    <div class="overlay" id="tsDetailsOverlay">
      <div class="overlay-header">
        <button class="close-btn" id="tsBackBtn" aria-label="Back">${FarmSmart.icons.back}</button>
        <h1>Timesheet</h1>
      </div>

      <div class="ts-period">
        <button class="ts-period__btn" id="tsPrevBtn" aria-label="Previous fortnight"><i class="ti ti-chevron-left"></i></button>
        <div class="ts-period__label">
          <strong id="tsPeriodLabel"></strong>
          <span id="tsPeriodSub"></span>
        </div>
        <button class="ts-period__btn" id="tsNextBtn" aria-label="Next fortnight"><i class="ti ti-chevron-right"></i></button>
      </div>

      <p class="ts-award-note">
        Under the <strong>Pastoral Award 2020 (MA000035)</strong>, overtime
        applies to hours beyond <strong id="tsThresholdNote">152</strong> in
        each employee's own 4-week cycle, whenever they fall in it. Those
        hours show as <strong>OT</strong>, or <strong>OT Sun</strong> on a
        Sunday (higher rate). Hours on a public holiday show as
        <strong>PH</strong>. The first rest break of the day (up to 10 min)
        is paid; meal breaks are not.
      </p>

      <div id="tsEmployeeList" class="ts-employee-list"></div>

      <div class="ts-xero">
        <button class="card-btn primary" id="tsSendBtn"><i class="ti ti-send"></i>Approve and send to Xero</button>
        <p class="ts-xero__status" id="tsSendStatus"></p>
      </div>
    </div>
  `,

  init: function () {
    const FORTNIGHT_DAYS = 14;
    const PAID_REST_MINUTES = 10;
    const XERO_ENDPOINT = '/api/xero-send-timesheet';
    const BREAK_NAMES = { rest_break: 'rest', meal_break: 'meal' };
    const escape = FarmSmart.escapeHtml;
    const db = () => FarmSmart.supabase();

    let settings = null;           // { payAnchor, otThresholdHours, cycleDays }
    let employees = [];            // everyone, including people who left
    let holidays = {};             // 'YYYY-MM-DD' → holiday name
    let approvals = {};            // 'employeeId|YYYY-MM-DD' → { approvedAt, sentAt }
    const days = new Map();        // 'employeeId|YYYY-MM-DD' → day worked
    let loadedFrom = null;
    let loadedTo = null;
    let fortnightOffset = 0;       // 0 = current fortnight, -1 = previous…
    let ready = false;
    const openCards = new Set();

    /* ---------- Dates and times (local) ---------- */

    const dateKey = FarmSmart.toDateKey;
    function parseDate(key) {
      const [y, m, d] = key.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    function addDays(date, n) {
      const d = new Date(date);
      d.setDate(d.getDate() + n);
      return d;
    }
    // Rounded, so daylight-saving changes don't break day counts.
    const daysBetween = (a, b) => Math.round((b - a) / 86400000);
    function today() {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d;
    }
    const mondayOf = (date) => addDays(date, -((date.getDay() + 6) % 7));
    const formatDate = (date) => date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
    const formatShort = (date) => date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
    const formatStamp = (iso) => new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

    function toMinutes(time) {
      const [h, m] = time.split(':').map(Number);
      return h * 60 + m;
    }
    function formatClock(minutes) {
      const h = Math.floor(minutes / 60);
      return `${h % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
    }
    // Minutes as h:mm (37:12), like payslips.
    const formatHours = (minutes) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
    // Break lengths as 10m, 3h, 2h 30m.
    function formatBreak(minutes) {
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      return [h ? `${h}h` : '', m || !h ? `${m}m` : ''].filter(Boolean).join(' ');
    }
    const farmName = (farmId) => (FarmSmart.getFarm(farmId) || { name: 'Unknown farm' }).name;

    /* ---------- Days worked ---------- */

    // The gap after the first rest break of the day, up to 10 minutes.
    function paidRestMinutes(segments) {
      const i = segments.findIndex((s) => s.reason === 'rest_break');
      if (i < 0 || !segments[i + 1]) return 0;
      return Math.min(PAID_REST_MINUTES, segments[i + 1].start - segments[i].end);
    }

    // Without segments (old imports), `hours` holds the day total.
    function rowToDay(row) {
      const segments = row.timesheet_segments
        .map((s) => ({ start: toMinutes(s.start_time), end: s.end_time ? toMinutes(s.end_time) : null, reason: s.end_reason }))
        .sort((a, b) => a.start - b.start);
      const minutes = segments.length
        ? segments.filter((s) => s.end !== null).reduce((sum, s) => sum + s.end - s.start, 0) + paidRestMinutes(segments)
        : Math.round(Number(row.hours || 0) * 60);
      return { farmId: row.farm_id, status: row.status, note: row.note || '', segments, minutes };
    }

    const getDay = (employee, date) => days.get(`${employee.id}|${dateKey(date)}`) || null;

    // "4:30 am–10:15 am", with the break kinds between segments when asked.
    function dayParts(day, withBreaks) {
      if (!day.segments.length) return [`${formatHours(day.minutes)} total`];
      const parts = [];
      day.segments.forEach((s, i) => {
        parts.push(`${formatClock(s.start)}–${s.end === null ? 'now' : formatClock(s.end)}`);
        const next = day.segments[i + 1];
        const breakName = BREAK_NAMES[s.reason];
        if (withBreaks && breakName) parts.push(next ? `${formatBreak(next.start - s.end)} ${breakName}` : `on ${breakName} break`);
      });
      return parts;
    }

    /* ---------- Loading ---------- */

    async function loadBase() {
      const company = FarmSmart.company;
      settings = { payAnchor: company.payAnchor, otThresholdHours: company.otThresholdHours, cycleDays: company.cycleDays };

      const [employeeResult, holidayResult] = await Promise.all([
        db().from('employees').select('id, code, preferred_name, employment_type, start_date, end_date, cycle_start')
          .eq('company_id', company.id).order('sort_order'),
        db().from('public_holidays').select('holiday_date, name').eq('state', company.state),
      ]);
      if (employeeResult.error) throw employeeResult.error;
      if (holidayResult.error) throw holidayResult.error;

      employees = employeeResult.data.map((e) => ({
        id: e.id,
        code: e.code,
        name: e.preferred_name || e.code,
        type: e.employment_type,
        startDate: e.start_date || settings.payAnchor,
        endDate: e.end_date,
        // No cycle set yet: count from the Monday of their first week.
        cycleStart: e.cycle_start || dateKey(mondayOf(parseDate(e.start_date || settings.payAnchor))),
      }));
      holidays = {};
      holidayResult.data.forEach((h) => { holidays[h.holiday_date] = h.name; });

      const { data, error } = await db().from('timesheet_approvals').select('*').in('employee_id', employees.map((e) => e.id));
      if (error) throw error;
      approvals = {};
      data.forEach((a) => { approvals[`${a.employee_id}|${a.fortnight_start}`] = { approvedAt: a.approved_at, sentAt: a.sent_at }; });
    }

    async function fetchDays(from, to) {
      const { data, error } = await db().from('timesheet_shifts')
        .select('employee_id, farm_id, work_date, hours, status, note, timesheet_segments(start_time, end_time, end_reason)')
        .in('employee_id', employees.map((e) => e.id))
        .gte('work_date', dateKey(from)).lte('work_date', dateKey(to));
      if (error) throw error;
      data.forEach((row) => days.set(`${row.employee_id}|${row.work_date}`, rowToDay(row)));
    }

    // Loads every day between `from` and `to`, skipping what is in memory.
    async function loadDays(from, to) {
      if (!loadedFrom) {
        await fetchDays(from, to);
        loadedFrom = from;
        loadedTo = to;
        return;
      }
      if (from < loadedFrom) { await fetchDays(from, addDays(loadedFrom, -1)); loadedFrom = from; }
      if (to > loadedTo) { await fetchDays(addDays(loadedTo, 1), to); loadedTo = to; }
    }

    /* ---------- Overtime and pay lines ---------- */

    function cycleStartFor(employee, date) {
      const anchor = parseDate(employee.cycleStart);
      const n = Math.floor(daysBetween(anchor, date) / settings.cycleDays);
      return addDays(anchor, n * settings.cycleDays);
    }

    // Minutes worked in this cycle strictly before `date`.
    function cycleMinutesBefore(employee, date) {
      let total = 0;
      for (let d = cycleStartFor(employee, date); d < date; d = addDays(d, 1)) {
        const day = getDay(employee, d);
        if (day) total += day.minutes;
      }
      return total;
    }

    const holidayName = (date) => holidays[dateKey(date)] || '';

    // Minutes of one day per pay line.
    function dayLines(employee, date) {
      const lines = { ordinary: 0, overtime: 0, overtimeSunday: 0, publicHoliday: 0 };
      const day = getDay(employee, date);
      if (!day) return lines;
      if (holidayName(date)) { lines.publicHoliday = day.minutes; return lines; }
      const ordinaryLeft = Math.max(0, settings.otThresholdHours * 60 - cycleMinutesBefore(employee, date));
      lines.ordinary = Math.min(day.minutes, ordinaryLeft);
      lines[date.getDay() === 0 ? 'overtimeSunday' : 'overtime'] = day.minutes - lines.ordinary;
      return lines;
    }

    /* ---------- Fortnights ---------- */

    function fortnightStart(offset) {
      const anchor = parseDate(settings.payAnchor);
      const n = Math.floor(daysBetween(anchor, today()) / FORTNIGHT_DAYS) + offset;
      return addDays(anchor, n * FORTNIGHT_DAYS);
    }
    const fortnightDays = (start) => Array.from({ length: FORTNIGHT_DAYS }, (_, i) => addDays(start, i));
    // The fortnight plus a full cycle before it, for the overtime counter.
    const loadFortnight = (start) => loadDays(addDays(start, -settings.cycleDays), addDays(start, FORTNIGHT_DAYS - 1));

    const employedBetween = (employee, from, to) =>
      parseDate(employee.startDate) <= to && (!employee.endDate || parseDate(employee.endDate) >= from);

    const approvalKey = (employee, start) => `${employee.id}|${dateKey(start)}`;
    const hasHours = (employee, start) => fortnightDays(start).some((d) => getDay(employee, d));
    const unsentEmployees = (start) => employees.filter((e) => hasHours(e, start) && !(approvals[approvalKey(e, start)] || {}).sentAt);

    /* ---------- Rendering ---------- */

    function renderToday() {
      const now = today();
      document.getElementById('tsTodayLine').textContent = 'Today, ' + formatDate(now);
      const start = fortnightStart(0);
      document.getElementById('tsBadge').textContent = `${formatShort(start)} – ${formatShort(addDays(start, FORTNIGHT_DAYS - 1))}`;

      // Working today first; position alone says the rest are off.
      const visible = employees.filter((e) => employedBetween(e, now, now) || getDay(e, now));
      visible.sort((a, b) => (getDay(a, now) ? 0 : 1) - (getDay(b, now) ? 0 : 1));
      document.getElementById('tsTodayList').innerHTML = visible.map((employee) => {
        const day = getDay(employee, now);
        const farmBadge = day ? `<span class="ts-row__farm">${escape(farmName(day.farmId))}</span>` : '';
        const times = day ? dayParts(day, false).map((p) => `<span class="ts-row__shift">${p}</span>`).join('') : '';
        return `<div class="ts-row">
          <span class="ts-row__name">${escape(employee.name)}</span>
          ${farmBadge}
          <span class="ts-row__times">${times}</span>
        </div>`;
      }).join('') || '<p class="ts-no-past-shifts">No employees.</p>';
    }

    function cycleLine(employee, lastDay) {
      const parts = [];
      if (lastDay >= parseDate(employee.startDate)) {
        const cycleStart = cycleStartFor(employee, lastDay);
        const lastDayWorked = getDay(employee, lastDay);
        const minutes = cycleMinutesBefore(employee, lastDay) + (lastDayWorked ? lastDayWorked.minutes : 0);
        parts.push(`Cycle ${formatShort(cycleStart)} – ${formatShort(addDays(cycleStart, settings.cycleDays - 1))} · ${formatHours(minutes)} / ${settings.otThresholdHours}:00`);
      }
      if (employee.type === 'permanent') parts.push('Permanent');
      return parts.join(' · ');
    }

    function approvalTag(approval) {
      if (approval.sentAt) return `<span class="ts-tag ts-tag--sent"><i class="ti ti-check"></i>Sent ${formatStamp(approval.sentAt)}</span>`;
      if (approval.approvedAt) return '<span class="ts-tag">Approved, not sent</span>';
      return '';
    }

    function renderEmployee(employee, start, lastDay) {
      const lines = fortnightDays(start).map((d) => dayLines(employee, d));
      const total = (key) => lines.reduce((sum, l) => sum + l[key], 0);
      const worked = fortnightDays(start).filter((d) => getDay(employee, d));
      const totalMinutes = worked.reduce((sum, d) => sum + getDay(employee, d).minutes, 0);
      const key = approvalKey(employee, start);
      const isOpen = openCards.has(key);
      const pill = (label, minutes) => (minutes ? ` <span class="ts-ot">${label} ${formatHours(minutes)}</span>` : '');

      const dayRows = worked.map((date) => {
        const day = getDay(employee, date);
        const line = lines[daysBetween(start, date)];
        const holiday = holidayName(date);
        const tags = holiday
          ? `${pill('PH', line.publicHoliday)}<br><small>${escape(holiday)}</small>`
          : pill('OT', line.overtime) + pill('OT Sun', line.overtimeSunday);
        const note = day.note ? `<br><small>${escape(day.note)}</small>` : '';
        return `<div class="row-line ts-shift-line">
          <span class="k">${formatDate(date)}</span>
          <span class="v">${dayParts(day, true).join(' · ')} (${formatHours(day.minutes)})${tags}${note}</span>
        </div>`;
      }).join('') || '<p class="ts-no-past-shifts">No shifts this fortnight.</p>';

      return `<div class="card ts-employee-card">
        <button class="ts-employee-summary${isOpen ? ' open' : ''}" data-key="${key}">
          <span class="ts-employee-summary__name">${escape(employee.name)}</span>
          <span class="ts-employee-summary__stats">
            <span class="ts-employee-summary__today">${formatHours(totalMinutes)}${pill('OT', total('overtime'))}${pill('OT Sun', total('overtimeSunday'))}${pill('PH', total('publicHoliday'))}</span>
            <i class="ti ti-chevron-down ts-employee-summary__chevron"></i>
          </span>
        </button>
        <div class="ts-employee-meta">
          <span class="ts-employee-meta__cycle">${cycleLine(employee, lastDay)}</span>
          ${approvalTag(approvals[key] || {})}
        </div>
        <div class="ts-employee-shifts" ${isOpen ? '' : 'hidden'}>${dayRows}</div>
      </div>`;
    }

    function renderFortnight() {
      const start = fortnightStart(fortnightOffset);
      const end = addDays(start, FORTNIGHT_DAYS - 1);
      const ended = end < today();

      document.getElementById('tsThresholdNote').textContent = settings.otThresholdHours;
      document.getElementById('tsPeriodLabel').textContent = `${formatShort(start)} – ${formatShort(end)}`;
      document.getElementById('tsPeriodSub').textContent = fortnightOffset === 0 ? 'Current pay fortnight' : 'Pay fortnight ended';
      document.getElementById('tsNextBtn').disabled = fortnightOffset >= 0;

      const visible = employees.filter((e) => employedBetween(e, start, end) || hasHours(e, start));
      const el = document.getElementById('tsEmployeeList');
      el.innerHTML = visible.map((e) => renderEmployee(e, start, ended ? end : today())).join('')
        || '<p class="ts-no-past-shifts">No employees in this fortnight.</p>';
      el.querySelectorAll('.ts-employee-summary').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (!openCards.delete(btn.dataset.key)) openCards.add(btn.dataset.key);
          renderFortnight();
        });
      });

      const toSend = unsentEmployees(start);
      const sendBtn = document.getElementById('tsSendBtn');
      sendBtn.disabled = !ended || toSend.length === 0;
      sendBtn.innerHTML = `<i class="ti ti-send"></i>Approve and send to Xero${ended && toSend.length ? ` (${toSend.length})` : ''}`;
    }

    /* ---------- Approve and send to Xero ---------- */

    // FarmSmart ids and hours per pay line, 14 values Monday → Sunday.
    // The server maps them to Xero's EmployeeID and EarningsRateIDs.
    function buildXeroTimesheet(employee, start) {
      const lines = fortnightDays(start).map((d) => dayLines(employee, d));
      const hours = (key) => lines.map((l) => Math.round((l[key] / 60) * 100) / 100);
      return {
        employeeId: employee.id,
        employeeCode: employee.code,
        startDate: dateKey(start),
        endDate: dateKey(addDays(start, FORTNIGHT_DAYS - 1)),
        ordinaryHours: hours('ordinary'),
        overtimeHours: hours('overtime'),
        overtimeSundayHours: hours('overtimeSunday'),
        publicHolidayHours: hours('publicHoliday'),
      };
    }

    async function saveApprovals(list, start, fields) {
      const rows = list.map((e) => {
        const next = { approvedAt: null, sentAt: null, ...approvals[approvalKey(e, start)], ...fields };
        return { employee_id: e.id, fortnight_start: dateKey(start), approved_at: next.approvedAt, sent_at: next.sentAt };
      });
      const { error } = await db().from('timesheet_approvals').upsert(rows, { onConflict: 'employee_id,fortnight_start' });
      if (error) throw error;
      rows.forEach((r) => { approvals[`${r.employee_id}|${r.fortnight_start}`] = { approvedAt: r.approved_at, sentAt: r.sent_at }; });
    }

    async function approveAndSend() {
      const start = fortnightStart(fortnightOffset);
      const list = unsentEmployees(start);
      const status = document.getElementById('tsSendStatus');
      document.getElementById('tsSendBtn').disabled = true;
      status.textContent = 'Sending…';
      try {
        await saveApprovals(list, start, { approvedAt: new Date().toISOString() });
        let res;
        try {
          res = await fetch(XERO_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timesheets: list.map((e) => buildXeroTimesheet(e, start)) }),
          });
        } catch (err) {
          throw new Error('Could not reach the server. Check the connection.');
        }
        if (res.status === 404) throw new Error('Approved. Xero is not connected yet, so nothing was sent.');
        if (!res.ok) throw new Error(`Approved, but Xero returned an error (${res.status}).`);
        const sentAt = new Date().toISOString();
        await saveApprovals(list, start, { sentAt });
        status.textContent = `Sent to Xero as drafts · ${formatStamp(sentAt)}`;
      } catch (err) {
        console.error('[timesheet] Approve and send failed:', err);
        status.textContent = err.message || 'Could not save the approval. Try again.';
      }
      renderFortnight();
    }

    function confirmSend() {
      const start = fortnightStart(fortnightOffset);
      const names = unsentEmployees(start).map((e) => e.name).join(', ');
      openConfirm('Approve and send to Xero?', `Draft timesheets for ${names}.`, 'Send', approveAndSend);
    }

    /* ---------- Events ---------- */

    function showError(listId, err) {
      console.error('[timesheet] Could not load timesheets:', err);
      document.getElementById(listId).innerHTML = '<p class="ts-no-past-shifts">Could not load timesheets. Check the connection and reload.</p>';
    }

    async function changeFortnight(delta) {
      fortnightOffset = Math.min(0, fortnightOffset + delta);
      document.getElementById('tsSendStatus').textContent = '';
      try {
        await loadFortnight(fortnightStart(fortnightOffset));
        renderFortnight();
      } catch (err) {
        showError('tsEmployeeList', err);
      }
    }

    const details = FarmSmart.createPanel('tsDetailsOverlay', 'tsBackBtn');
    document.getElementById('tsDetailsBtn').addEventListener('click', () => { renderFortnight(); details.open(); });
    document.getElementById('tsPrevBtn').addEventListener('click', () => changeFortnight(-1));
    document.getElementById('tsNextBtn').addEventListener('click', () => changeFortnight(1));
    document.getElementById('tsSendBtn').addEventListener('click', confirmSend);

    // Shift Clock saved a day: re-read it and redraw.
    document.addEventListener('farmsmart:shiftchanged', async (e) => {
      if (!ready) return;
      try {
        days.delete(`${e.detail.employeeId}|${e.detail.workDate}`);
        await fetchDays(parseDate(e.detail.workDate), parseDate(e.detail.workDate));
        renderToday();
        if (document.getElementById('tsDetailsOverlay').classList.contains('show')) renderFortnight();
      } catch (err) {
        console.error('[timesheet] Could not refresh the day:', err);
      }
    });

    FarmSmart.restrictToOwner('tsCard', 'tsDetailsOverlay');
    document.getElementById('tsTodayLine').textContent = 'Today, ' + formatDate(today());

    (async () => {
      try {
        await loadBase();
        await loadFortnight(fortnightStart(0));
        ready = true;
        document.getElementById('tsDetailsBtn').disabled = false;
        renderToday();
      } catch (err) {
        showError('tsTodayList', err);
      }
    })();
  },
});
