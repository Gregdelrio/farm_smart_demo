/* =====================================================================
   TILE: MILK STATEMENT
   Daily pickup figures on the card, monthly totals and payment behind
   "View details". Quality figures are the same demo values on every
   farm; volume (35 L/cow/day × herd size) and everything derived from
   it scale with the active farm.
   ===================================================================== */

FarmSmart.registerTile({
  id: 'milk-statement',
  name: 'Milk Statement',

  html: `
    <div class="card" id="msCard">
      <div class="card-top">
        <span class="card-title"><i class="ti ti-truck-delivery"></i>Milk Statement</span>
        <span class="badge info" id="msBadge">Synced 4 min ago</span>
      </div>

      <div class="ms-stat-grid ms-stat-grid--card">
        <div class="ms-stat"><p class="stat-label">BMCC</p><p class="stat-value">145,000<small> cells/mL</small></p></div>
        <div class="ms-stat"><p class="stat-label">TBC</p><p class="stat-value">12,000<small> cfu/mL</small></p></div>
      </div>

      <div id="msCardTrendsList" class="ms-trends-list"></div>

      <button class="card-btn" id="msDetailsBtn"><i class="ti ti-chart-bar"></i>View details</button>
    </div>

    <div class="overlay" id="msDetailsOverlay">
      <div class="overlay-header">
        <button class="close-btn" id="msBackBtn" aria-label="Back">${FarmSmart.icons.back}</button>
        <h1>Milk Statement</h1>
      </div>

      <p class="ms-pickup-line ms-pickup-line--overlay">Last pickup: Today, 6:15 AM · 3.5°C</p>

      <div class="card ms-overlay-card">
        <div class="ms-stat-grid">
          <div class="ms-stat"><p class="stat-label">BMCC</p><p class="stat-value">145,000<small> cells/mL</small></p></div>
          <div class="ms-stat"><p class="stat-label">TBC</p><p class="stat-value">12,000<small> cfu/mL</small></p></div>
        </div>

        <div class="ms-highlight">
          <span class="stat-label">Milk Solids</span>
          <span class="stat-value-lg" id="msKgMs">376.0 kg MS</span>
        </div>
      </div>

      <div class="ms-month-row">
        <div class="ms-month-box"><p class="stat-label">Milk Solids this month</p><p class="stat-value" id="msMonthKgMs">9,850 kg MS</p></div>
      </div>

      <div class="card ms-payment-card overlay-last-card">
        <p class="stat-label">Estimated payment</p>
        <p class="ms-payment-value" id="msPaymentValue">$84,135</p>
        <div class="row-line"><span class="k">Base rate</span><span class="v">$8.50 / kg MS</span></div>
        <div class="row-line"><span class="k">Quality bonus</span><span class="v ok" id="msBonusValue">+$410</span></div>
        <div class="row-line"><span class="k">Payment date</span><span class="v">20th next month</span></div>
      </div>
    </div>
  `,

  init: function () {
    // Demo constants: replace with factory/lab data in production.
    const LITRES_PER_COW_PER_DAY = 35; // middle of the real 30–40 L range
    const DAYS_PER_MONTH = 30;
    const FAT_PCT = 4.2;
    const PROTEIN_PCT = 3.6;
    const BASE_RATE_PER_KG_MS = 8.5;
    const QUALITY_BONUS_PER_KG_MS = 0.05;
    const HISTORY_LENGTH = 14; // two non-overlapping 7-pickup windows

    const formatNumber = (n) => Math.round(n).toLocaleString('en-US');

    function refreshForActiveFarm() {
      const dailyKgMs = FarmSmart.getActiveFarm().herdSize * LITRES_PER_COW_PER_DAY * (FAT_PCT + PROTEIN_PCT) / 100;
      const monthKgMs = dailyKgMs * DAYS_PER_MONTH;
      const qualityBonus = monthKgMs * QUALITY_BONUS_PER_KG_MS;
      const estimatedPayment = monthKgMs * BASE_RATE_PER_KG_MS + qualityBonus;

      document.getElementById('msKgMs').textContent = dailyKgMs.toFixed(1) + ' kg MS';
      document.getElementById('msMonthKgMs').textContent = formatNumber(monthKgMs) + ' kg MS';
      document.getElementById('msBonusValue').textContent = '+$' + formatNumber(qualityBonus);
      document.getElementById('msPaymentValue').textContent = '$' + formatNumber(estimatedPayment);
    }

    // Random walk that drifts back towards `base`, so it stays plausible.
    function generateHistory(base, variancePct) {
      const history = [];
      let current = base;
      for (let i = 0; i < HISTORY_LENGTH; i++) {
        const noise = (Math.random() - 0.5) * 2 * variancePct * base;
        current = current + noise * 0.5 + (base - current) * 0.15;
        history.push(Math.max(0, current));
      }
      return history;
    }

    /** % change of the average over the last `windowSize` pickups vs the window before. */
    function trendPct(history, windowSize) {
      const average = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
      const recent = average(history.slice(-windowSize));
      const prior = average(history.slice(-windowSize * 2, -windowSize));
      return prior === 0 ? 0 : ((recent - prior) / prior) * 100;
    }

    // Fewer cells/bacteria means better milk, so a fall is good news.
    function trendCell(pct, windowLabel) {
      const arrow = pct > 0.05 ? '↑' : pct < -0.05 ? '↓' : '→';
      const tone = Math.abs(pct) < 1 ? 'flat' : pct < 0 ? 'good' : 'bad';
      return `<span class="ms-trend--${tone}">${arrow} ${pct > 0 ? '+' : ''}${pct.toFixed(1)}% <small class="ms-trend-window">${windowLabel}</small></span>`;
    }

    const TREND_METRICS = [
      { label: 'BMCC', history: generateHistory(145000, 0.12) },
      { label: 'TBC', history: generateHistory(12000, 0.15) },
    ];

    function renderTrends() {
      document.getElementById('msCardTrendsList').innerHTML = TREND_METRICS.map((metric) => `
        <div class="ms-trend-row ms-trend-row--emphasize">
          <span class="ms-trend-row__label">${metric.label}</span>
          <span class="ms-trend-row__cells ms-trend-row__cells--emphasize">
            ${trendCell(trendPct(metric.history, 3), '3d')}
            ${trendCell(trendPct(metric.history, 7), '7d')}
          </span>
        </div>`).join('');
    }

    const details = FarmSmart.createPanel('msDetailsOverlay', 'msBackBtn');
    document.getElementById('msDetailsBtn').addEventListener('click', details.open);
    document.addEventListener('farmsmart:farmchanged', refreshForActiveFarm);

    refreshForActiveFarm();
    FarmSmart.startSyncBadge('msBadge');
    renderTrends();
  },
});
