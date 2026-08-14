/* =====================================================================
   TILE: MILK STATEMENT
   ---------------------------------------------------------------------
   TO DISABLE THIS TILE: comment out (or delete) in index.html:
     <link rel="stylesheet" href="css/tiles/milk-statement.css">
     <script src="js/tiles/milk-statement.js"></script>

   DESIGN NOTES:
   - Merged into ONE tile rather than two: daily pickup numbers on the
     card itself (checked often), monthly cumulative + payment behind
     "View details" (checked rarely) — same drill-down pattern as the
     Milk Vat tile.
   - Fat/Protein shown as %, since that's how every farmer already
     reads their milk statement. BMCC/TBC shown as raw counts
     (cells/mL, cfu/mL) for the same reason. These four figures (plus
     pickup temperature/time) are demo constants, the SAME on every
     farm — only volume and anything derived from it varies by farm.
   - Volume DOES vary by farm: 35 L/cow/day (middle of the 30-40 L
     range) × the active farm's herd size. kg MS, the monthly totals,
     the quality bonus and the estimated payment are all calculated
     from that volume, so they scale with farm size automatically.
   - Base rate ($8.50/kg MS) and quality bonus rate ($0.05/kg MS) are
     both flat, industry-plausible numbers, the same for every farm —
     only the volume they're multiplied against changes.
   ===================================================================== */

// ---- Demo constants — replace with real factory/lab data in production ----
const MS_LITRES_PER_COW_PER_DAY = 35;   // middle of the real 30–40 L/day range
const MS_DAYS_PER_MONTH = 30;           // simplified — not calendar-accurate
const MS_FAT_PCT = 4.2;
const MS_PROTEIN_PCT = 3.6;
const MS_BASE_RATE_PER_KG_MS = 8.50;    // $ per kg milk solids
const MS_QUALITY_BONUS_PER_KG_MS = 0.05; // $ per kg milk solids, applied monthly

function msFormatNumber(n) {
  return Math.round(n).toLocaleString('en-US');
}
function msFormatCurrency(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

FarmSmart.registerTile({
  id: 'milk-statement',

  html: `
    <div class="card">
      <div class="card-top">
        <span class="card-title"><i class="ti ti-truck-delivery"></i>Milk Statement</span>
        <span class="badge info" id="msBadge">Synced 4 min ago</span>
      </div>

      <p class="ms-pickup-line">Last pickup: Today, 6:15 AM</p>

      <div class="ms-volume-row">
        <span class="ms-volume" id="msVolume">4,820<span class="unit">L</span></span>
        <span class="ms-temp">3.5°C at pickup</span>
      </div>

      <div class="ms-stat-grid">
        <div class="ms-stat"><p class="stat-label">BMCC</p><p class="stat-value">145,000<small> cells/mL</small></p></div>
        <div class="ms-stat"><p class="stat-label">TBC</p><p class="stat-value">12,000<small> cfu/mL</small></p></div>
        <div class="ms-stat"><p class="stat-label">Fat</p><p class="stat-value" id="msFat">4.2%</p></div>
        <div class="ms-stat"><p class="stat-label">Protein</p><p class="stat-value" id="msProtein">3.6%</p></div>
      </div>

      <div class="ms-highlight">
        <span class="stat-label">Milk Solids</span>
        <span class="stat-value-lg" id="msKgMs">376.0 kg MS</span>
      </div>

      <button class="card-btn" id="msDetailsBtn"><i class="ti ti-chart-bar"></i>View details</button>
    </div>

    <div class="overlay" id="msDetailsOverlay">
      <div class="overlay-header">
        <button class="close-btn" id="msBackBtn" aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <h1>This Month</h1>
      </div>

      <div class="ms-month-row">
        <div class="ms-month-box"><p class="stat-label">Volume (L)</p><p class="stat-value" id="msMonthVolume">132,400 L</p></div>
        <div class="ms-month-box"><p class="stat-label">Milk Solids</p><p class="stat-value" id="msMonthKgMs">9,850 kg MS</p></div>
      </div>

      <div class="card ms-payment-card" style="margin-bottom:6vh;">
        <p class="stat-label">Estimated payment</p>
        <p class="ms-payment-value" id="msPaymentValue">$84,135</p>
        <div class="row-line"><span class="k">Base rate</span><span class="v">$8.50 / kg MS</span></div>
        <div class="row-line"><span class="k">Quality bonus</span><span class="v ok" id="msBonusValue">+$410</span></div>
        <div class="row-line"><span class="k">Payment date</span><span class="v">20th next month</span></div>
      </div>
    </div>
  `,

  init: function () {
    function refreshForActiveFarm() {
      const farm = FarmSmart.getActiveFarm();

      const dailyVolume = farm.herdSize * MS_LITRES_PER_COW_PER_DAY;
      const dailyKgMs = dailyVolume * (MS_FAT_PCT + MS_PROTEIN_PCT) / 100;

      const monthVolume = dailyVolume * MS_DAYS_PER_MONTH;
      const monthKgMs = dailyKgMs * MS_DAYS_PER_MONTH;

      const qualityBonus = monthKgMs * MS_QUALITY_BONUS_PER_KG_MS;
      const estimatedPayment = (monthKgMs * MS_BASE_RATE_PER_KG_MS) + qualityBonus;

      document.getElementById('msVolume').innerHTML = msFormatNumber(dailyVolume) + '<span class="unit">L</span>';
      document.getElementById('msKgMs').textContent = dailyKgMs.toFixed(1) + ' kg MS';
      document.getElementById('msFat').textContent = MS_FAT_PCT + '%';
      document.getElementById('msProtein').textContent = MS_PROTEIN_PCT + '%';

      document.getElementById('msMonthVolume').textContent = msFormatNumber(monthVolume) + ' L';
      document.getElementById('msMonthKgMs').textContent = msFormatNumber(monthKgMs) + ' kg MS';
      document.getElementById('msBonusValue').textContent = '+' + msFormatCurrency(qualityBonus);
      document.getElementById('msPaymentValue').textContent = msFormatCurrency(estimatedPayment);
    }

    document.getElementById('msDetailsBtn').addEventListener('click', () => {
      document.getElementById('msDetailsOverlay').classList.add('show');
    });
    document.getElementById('msBackBtn').addEventListener('click', () => {
      document.getElementById('msDetailsOverlay').classList.remove('show');
    });

    function refreshSyncBadge() {
      document.getElementById('msBadge').textContent = FarmSmart.randomSyncLabel();
    }

    document.addEventListener('farmsmart:farmchanged', refreshForActiveFarm);

    refreshForActiveFarm();
    refreshSyncBadge();
    setInterval(refreshSyncBadge, 20000);
  },
});
