/* =====================================================================
   TILE: MILK VAT TEMPERATURE
   The coloured frame carries the status (green = in range, red = too
   warm); the meta line under it only appears during an alert. "View
   details" draws the last 24 h relative to the current time.
   ===================================================================== */

FarmSmart.registerTile({
  id: 'vat',
  name: 'Milk Vat',

  html: `
    <div class="card">
      <div class="card-top">
        <span class="card-title"><i class="ti ti-droplet"></i>Milk Vat</span>
        <span class="badge info" id="vatBadge">Synced 2 min ago</span>
      </div>
      <div class="vat-temp-frame" id="tempFrame">
        <p class="vat-temp" id="temp">3.8<span class="unit">°C</span></p>
        <div class="vat-status-row">
          <i id="statusIcon" class="ti ti-check"></i>
          <span id="statusText">All good</span>
        </div>
      </div>
      <p class="vat-meta" id="meta" style="display:none;"></p>
      <button class="card-btn" id="vatDetailsBtn"><i class="ti ti-chart-line"></i>View details</button>
      <button class="card-btn" id="vatSimulateAlertBtn"><i class="ti ti-alert-triangle"></i>Simulate alert</button>
    </div>

    <div class="overlay" id="vatDetailsOverlay">
      <div class="overlay-header">
        <button class="close-btn" id="vatBackBtn" aria-label="Back">${FarmSmart.icons.back}</button>
        <h1>Today</h1>
      </div>

      <div class="card">
        <span class="card-title vat-section-title vat-section-title--chart">Last 24 hours</span>
        <svg id="trendChart" class="vat-chart" viewBox="0 0 320 150"></svg>
      </div>

      <div class="vat-stat-row">
        <div class="vat-stat"><p class="vat-stat__label">Min 24h</p><p class="vat-stat__value" id="minVal">2.9°</p></div>
        <div class="vat-stat"><p class="vat-stat__label">Max 24h</p><p class="vat-stat__value" id="maxVal">4.1°</p></div>
      </div>

      <div class="card">
        <span class="card-title vat-section-title">Alert log</span>
        <div class="row-line" id="liveAlertRow" style="display:none;"><span class="k">Now</span><span class="v vat-live-alert">In progress · 18 min</span></div>
        <div class="row-line"><span class="k">Jul 28, 2:12 PM</span><span class="v ok">Resolved · 3 min</span></div>
        <div class="row-line"><span class="k">Jul 15, 3:40 AM</span><span class="v ok">Resolved · 9 min</span></div>
      </div>

      <div class="card overlay-last-card">
        <span class="card-title vat-section-title">Sensor status</span>
        <div class="row-line"><span class="k">4G signal</span><span class="v" id="signalVal">Good · -78 dBm</span></div>
        <div class="row-line"><span class="k">Battery</span><span class="v">94%</span></div>
        <div class="row-line"><span class="k">Last sync</span><span class="v" id="syncVal">2 min ago</span></div>
      </div>
    </div>
  `,

  init: function () {
    const ALERT_THRESHOLD_C = 6;

    // Index 0 = 24 h ago, index 23 = now. Swap for a real sensor feed.
    const NORMAL_READINGS = [3.4, 4.1, 3.3, 4.4, 3.6, 2.9, 4.2, 3.5, 4.6, 3.2, 3.9, 4.3, 2.8, 3.7, 4.5, 3.3, 4.0, 3.1, 4.4, 3.6, 2.9, 4.1, 3.5, 3.8];
    const ALERT_READINGS  = [3.4, 4.1, 3.3, 4.4, 3.6, 2.9, 4.2, 3.5, 4.6, 3.2, 3.9, 4.3, 2.8, 3.7, 4.5, 3.3, 4.0, 3.1, 4.4, 4.8, 5.9, 7.1, 7.7, 8.2];

    // Everything that differs between the normal and the alert state.
    const STATES = {
      normal: { readings: NORMAL_READINGS, icon: 'ti-check', temp: '3.8', text: 'All good', meta: '', signal: 'Good · -78 dBm', sync: '2 min ago', button: '<i class="ti ti-alert-triangle"></i>Simulate alert' },
      alert: { readings: ALERT_READINGS, icon: 'ti-alert-triangle', temp: '8.2', text: 'Too warm', meta: 'Above 6°C for 18 min', signal: 'Weak · -102 dBm', sync: 'just now', button: '<i class="ti ti-check"></i>Back to normal' },
    };

    let isAlert = false;
    const currentReadings = () => (isAlert ? ALERT_READINGS : NORMAL_READINGS);

    function buildTrendChart(data) {
      const left = 34, right = 10, top = 12, bottom = 24;
      const width = 320, height = 150;
      const plotW = width - left - right;
      const plotH = height - top - bottom;
      const yFor = (temp) => top + plotH - (temp / 10) * plotH;
      const xFor = (i) => left + (i / (data.length - 1)) * plotW;
      const parts = [];

      [0, 2, 4, 6, 8, 10].forEach((t) => {
        const y = yFor(t);
        parts.push(`<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" class="vat-chart-grid"/>`);
        parts.push(`<text x="${left - 6}" y="${y + 3}" font-size="9" class="vat-chart-label" text-anchor="end">${t}°</text>`);
      });

      const limitY = yFor(ALERT_THRESHOLD_C);
      parts.push(`<line x1="${left}" y1="${limitY}" x2="${width - right}" y2="${limitY}" class="vat-chart-limit-line" stroke-width="1.5" stroke-dasharray="4,4"/>`);

      const now = Date.now();
      [0, 6, 12, 18, 23].forEach((i) => {
        const hoursAgo = data.length - 1 - i;
        const label = new Date(now - hoursAgo * 3600 * 1000).toLocaleTimeString('en-US', { hour: 'numeric' });
        parts.push(`<text x="${xFor(i)}" y="${height - 6}" font-size="9" class="vat-chart-label" text-anchor="middle">${label}</text>`);
      });

      const points = data.map((temp, i) => `${xFor(i)},${yFor(temp)}`).join(' ');
      const lineColor = Math.max(...data) > ALERT_THRESHOLD_C ? '#ff6b6b' : '#6bd47a';
      parts.push(`<polyline points="${points}" fill="none" stroke="${lineColor}" stroke-width="3"/>`);

      document.getElementById('trendChart').innerHTML = parts.join('');
    }

    function setAlert(alertOn) {
      isAlert = alertOn;
      const s = alertOn ? STATES.alert : STATES.normal;
      const meta = document.getElementById('meta');

      document.getElementById('tempFrame').classList.toggle('alert', alertOn);
      document.getElementById('statusIcon').className = 'ti ' + s.icon;
      document.getElementById('temp').innerHTML = `${s.temp}<span class="unit">°C</span>`;
      document.getElementById('statusText').textContent = s.text;
      meta.textContent = s.meta;
      meta.style.display = alertOn ? 'block' : 'none';
      document.getElementById('liveAlertRow').style.display = alertOn ? 'flex' : 'none';
      document.getElementById('signalVal').textContent = s.signal;
      document.getElementById('syncVal').textContent = s.sync;
      document.getElementById('minVal').textContent = Math.min(...s.readings).toFixed(1) + '°';
      document.getElementById('maxVal').textContent = Math.max(...s.readings).toFixed(1) + '°';
      document.getElementById('vatSimulateAlertBtn').innerHTML = s.button;
      buildTrendChart(s.readings);
    }

    const details = FarmSmart.createPanel('vatDetailsOverlay', 'vatBackBtn');
    document.getElementById('vatDetailsBtn').addEventListener('click', () => {
      buildTrendChart(currentReadings()); // redraw so the time axis ends at "now"
      details.open();
    });
    document.getElementById('vatSimulateAlertBtn').addEventListener('click', () => setAlert(!isAlert));
    // Hidden demo shortcut, same as the button.
    document.getElementById('tempFrame').addEventListener('dblclick', () => setAlert(!isAlert));

    FarmSmart.startSyncBadge('vatBadge');
  },
});
