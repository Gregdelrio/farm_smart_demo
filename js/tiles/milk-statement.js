/* =====================================================================
   TILE: MILK STATEMENT
   ---------------------------------------------------------------------
   TO DISABLE THIS TILE: comment out (or delete) in index.html:
     <link rel="stylesheet" href="css/tiles/milk-statement.css">
     <script src="js/tiles/milk-statement.js"></script>

   DESIGN NOTES:
   - Merged into ONE tile rather than two separate dashboard tiles:
     the daily pickup numbers (volume, temp, quality readings, kg MS)
     are what a farmer checks day to day, so they live on the card
     itself. The monthly cumulative + payment estimate is checked far
     less often, so it's tucked behind "Show more details" — same
     drill-down pattern as the Milk Vat tile.
   - Fat/Protein shown as %, since that's how every farmer already
     reads their milk statement. BMCC/TBC shown as raw counts
     (cells/mL, cfu/mL) for the same reason — converting them to some
     other "score" would be less recognizable, not more.
   - kg MS (milk solids) gets its own highlighted row on the card,
     since that's the figure farm income is actually calculated from.
     Demo calculation: kg MS = Volume(L) × (Fat% + Protein%) / 100 —
     a common simplified formula; swap for your factory's exact
     formula (which usually also accounts for milk density) in a
     production build.
   - Same demo values shown regardless of the active farm (not tied to
     farmsmart:farmchanged) — the person asked for this to stay
     consistent across farms for now.
   ===================================================================== */

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
        <span class="ms-volume">4,820<span class="unit">L</span></span>
        <span class="ms-temp">3.5°C at pickup</span>
      </div>

      <div class="ms-stat-grid">
        <div class="ms-stat"><p class="stat-label">BMCC</p><p class="stat-value">145,000<small> cells/mL</small></p></div>
        <div class="ms-stat"><p class="stat-label">TBC</p><p class="stat-value">12,000<small> cfu/mL</small></p></div>
        <div class="ms-stat"><p class="stat-label">Fat</p><p class="stat-value">4.2%</p></div>
        <div class="ms-stat"><p class="stat-label">Protein</p><p class="stat-value">3.6%</p></div>
      </div>

      <div class="ms-highlight">
        <span class="stat-label">Milk Solids</span>
        <span class="stat-value-lg">376.0 kg MS</span>
      </div>

      <button class="card-btn" id="msDetailsBtn"><i class="ti ti-chart-bar"></i>Show more details</button>
    </div>

    <div class="overlay" id="msDetailsOverlay">
      <div class="overlay-header">
        <button class="close-btn" id="msBackBtn" aria-label="Back"><i class="ti ti-arrow-left"></i></button>
        <h1>This Month</h1>
      </div>

      <div class="ms-month-row">
        <div class="ms-month-box"><p class="stat-label">Volume (L)</p><p class="stat-value">132,400 L</p></div>
        <div class="ms-month-box"><p class="stat-label">Milk Solids</p><p class="stat-value">9,850 kg MS</p></div>
      </div>

      <div class="card ms-payment-card" style="margin-bottom:6vh;">
        <p class="stat-label">Estimated payment</p>
        <p class="ms-payment-value">$84,135</p>
        <div class="row-line"><span class="k">Base rate</span><span class="v">$8.50 / kg MS</span></div>
        <div class="row-line"><span class="k">Quality bonus</span><span class="v ok">+$410</span></div>
        <div class="row-line"><span class="k">Payment date</span><span class="v">20th next month</span></div>
      </div>
    </div>
  `,

  init: function () {
    document.getElementById('msDetailsBtn').addEventListener('click', () => {
      document.getElementById('msDetailsOverlay').classList.add('show');
    });
    document.getElementById('msBackBtn').addEventListener('click', () => {
      document.getElementById('msDetailsOverlay').classList.remove('show');
    });

    // Same "Synced X min ago" pattern as the Milk Vat and Live Milking
    // tiles — see FarmSmart.randomSyncLabel() in js/core.js.
    function refreshSyncBadge() {
      document.getElementById('msBadge').textContent = FarmSmart.randomSyncLabel();
    }
    refreshSyncBadge();
    setInterval(refreshSyncBadge, 20000);
  },
});
