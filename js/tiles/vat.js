/* =====================================================================
   TILE: MILK VAT TEMPERATURE
   ---------------------------------------------------------------------
   TO DISABLE THIS TILE: comment out (or delete) these two lines in
   index.html:
     <link rel="stylesheet" href="css/tiles/vat.css">
     <script src="js/tiles/vat.js"></script>

   DESIGN NOTES:
   - The badge just shows "Synced X min ago" — no OK/Alert text, since
     the colored frame around the temperature already shows that
     visually (green = fine, red = out of range).
   - The meta line under the frame ONLY appears during an alert (e.g.
     "Above 6°C for 18 min") — no "Last CIP..." line anymore.
   - "View details" opens a real chart: temperature on the Y axis,
     time of day on the X axis, covering the last 24 hours relative to
     the actual current time — see buildTrendChart() below.
   ===================================================================== */

FarmSmart.registerTile({
  id: 'vat',

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
    </div>

    <div class="overlay" id="vatDetailsOverlay">
      <div class="overlay-header">
        <button class="close-btn" id="vatBackBtn" aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <h1>Today</h1>
      </div>

      <div class="card">
        <span class="card-title" style="margin-bottom:1.25rem;display:block;">Last 24 hours</span>
        <svg id="trendChart" viewBox="0 0 320 150" style="width:100%;height:150px;overflow:visible;"></svg>
      </div>

      <div class="stat-row" style="display:flex;gap:1rem;margin: 0 1.5rem 1.25rem;">
        <div style="flex:1;background:rgba(255,255,255,0.06);border-radius:16px;padding:1.5rem 0.5rem;text-align:center;">
          <p style="font-size:0.85rem;color:rgba(255,255,255,0.5);font-weight:600;margin:0 0 0.5vh;">Min 24h</p>
          <p style="font-size:1.6rem;font-weight:800;margin:0;" id="minVal">2.9°</p>
        </div>
        <div style="flex:1;background:rgba(255,255,255,0.06);border-radius:16px;padding:1.5rem 0.5rem;text-align:center;">
          <p style="font-size:0.85rem;color:rgba(255,255,255,0.5);font-weight:600;margin:0 0 0.5vh;">Max 24h</p>
          <p style="font-size:1.6rem;font-weight:800;margin:0;" id="maxVal">4.1°</p>
        </div>
      </div>

      <div class="card">
        <span class="card-title" style="margin-bottom:2vh;display:block;">Alert log</span>
        <div class="row-line" id="liveAlertRow" style="display:none;"><span class="k">Now</span><span class="v" id="liveAlertVal" style="color:#ff9b8a;">In progress · 18 min</span></div>
        <div class="row-line"><span class="k">Jul 28, 2:12 PM</span><span class="v ok">Resolved · 3 min</span></div>
        <div class="row-line"><span class="k">Jul 15, 3:40 AM</span><span class="v ok">Resolved · 9 min</span></div>
      </div>

      <div class="card" style="margin-bottom:6vh;">
        <span class="card-title" style="margin-bottom:2vh;display:block;">Sensor status</span>
        <div class="row-line"><span class="k">4G signal</span><span class="v" id="signalVal">Good · -78 dBm</span></div>
        <div class="row-line"><span class="k">Battery</span><span class="v">94%</span></div>
        <div class="row-line"><span class="k">Last sync</span><span class="v" id="syncVal">2 min ago</span></div>
      </div>
    </div>
  `,

  init: function () {
    let vatAlert = false;

    // Demo data for the last 24 hours (index 0 = 24h ago, index 23 =
    // right now). Swap for a real sensor feed in production —
    // buildTrendChart() just needs an array of 24 numbers.
    const NORMAL_READINGS = [3.6, 3.7, 3.5, 3.8, 3.9, 3.7, 3.6, 3.8, 4.0, 3.9, 3.7, 3.6, 3.8, 3.9, 4.0, 3.8, 3.7, 3.6, 3.8, 3.9, 3.7, 3.8, 3.9, 3.8];
    const ALERT_READINGS  = [3.6, 3.7, 3.5, 3.8, 3.9, 3.7, 3.6, 3.8, 4.0, 3.9, 3.7, 3.6, 3.8, 3.9, 4.0, 3.8, 3.7, 3.6, 3.8, 4.5, 5.8, 7.0, 7.8, 8.2];

    function buildTrendChart(data) {
      const svg = document.getElementById('trendChart');
      const left = 34, right = 10, top = 12, bottom = 24;
      const width = 320, height = 150;
      const plotW = width - left - right;
      const plotH = height - top - bottom;

      const yTicks = [0, 2, 4, 6, 8, 10]; // °C
      const yFor = (temp) => top + plotH - (temp / 10) * plotH;
      const xFor = (i) => left + (i / (data.length - 1)) * plotW;

      let svgParts = [];

      yTicks.forEach((t) => {
        const y = yFor(t);
        svgParts.push(`<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>`);
        svgParts.push(`<text x="${left - 6}" y="${y + 3}" font-size="9" fill="rgba(255,255,255,0.45)" text-anchor="end">${t}°</text>`);
      });

      const limitY = yFor(6);
      svgParts.push(`<line x1="${left}" y1="${limitY}" x2="${width - right}" y2="${limitY}" stroke="rgba(255,155,138,0.5)" stroke-width="1.5" stroke-dasharray="4,4"/>`);

      const now = new Date();
      [0, 6, 12, 18, 23].forEach((i) => {
        const hoursAgo = (data.length - 1) - i;
        const labelTime = new Date(now.getTime() - hoursAgo * 3600 * 1000);
        const label = labelTime.toLocaleTimeString('en-US', { hour: 'numeric' });
        svgParts.push(`<text x="${xFor(i)}" y="${height - 6}" font-size="9" fill="rgba(255,255,255,0.45)" text-anchor="middle">${label}</text>`);
      });

      const points = data.map((temp, i) => `${xFor(i)},${yFor(temp)}`).join(' ');
      const lineColor = Math.max(...data) > 6 ? '#ff6b6b' : '#6bd47a';
      svgParts.push(`<polyline points="${points}" fill="none" stroke="${lineColor}" stroke-width="3"/>`);

      svg.innerHTML = svgParts.join('');
    }

    function setVatState(alertOn) {
      vatAlert = alertOn;

      const frame = document.getElementById('tempFrame');
      const temp = document.getElementById('temp');
      const icon = document.getElementById('statusIcon');
      const text = document.getElementById('statusText');
      const meta = document.getElementById('meta');
      const liveAlertRow = document.getElementById('liveAlertRow');
      const signalVal = document.getElementById('signalVal');
      const syncVal = document.getElementById('syncVal');
      const minVal = document.getElementById('minVal');
      const maxVal = document.getElementById('maxVal');

      const data = alertOn ? ALERT_READINGS : NORMAL_READINGS;

      if (alertOn) {
        frame.classList.add('alert');
        icon.className = 'ti ti-alert-triangle';
        temp.innerHTML = '8.2<span class="unit">°C</span>';
        text.textContent = 'Too warm';

        meta.textContent = 'Above 6°C for 18 min';
        meta.style.display = 'block';

        liveAlertRow.style.display = 'flex';
        signalVal.textContent = 'Weak · -102 dBm';
        syncVal.textContent = 'just now';
      } else {
        frame.classList.remove('alert');
        icon.className = 'ti ti-check';
        temp.innerHTML = '3.8<span class="unit">°C</span>';
        text.textContent = 'All good';

        meta.textContent = '';
        meta.style.display = 'none';

        liveAlertRow.style.display = 'none';
        signalVal.textContent = 'Good · -78 dBm';
        syncVal.textContent = '2 min ago';
      }

      minVal.textContent = Math.min(...data).toFixed(1) + '°';
      maxVal.textContent = Math.max(...data).toFixed(1) + '°';
      buildTrendChart(data);
    }

    // "Synced X min ago" badge — refreshes periodically so it feels live.
    function refreshSyncBadge() {
      document.getElementById('vatBadge').textContent = FarmSmart.randomSyncLabel();
    }

    document.getElementById('vatDetailsBtn').addEventListener('click', () => {
      buildTrendChart(vatAlert ? ALERT_READINGS : NORMAL_READINGS); // redraw with "now" up to date
      document.getElementById('vatDetailsOverlay').classList.add('show');
    });
    document.getElementById('vatBackBtn').addEventListener('click', () => {
      document.getElementById('vatDetailsOverlay').classList.remove('show');
    });
    // Demo trigger: double-tap the colored frame to toggle the alert state.
    document.getElementById('tempFrame').addEventListener('dblclick', () => setVatState(!vatAlert));

    refreshSyncBadge();
    setInterval(refreshSyncBadge, 20000);
  },
});
