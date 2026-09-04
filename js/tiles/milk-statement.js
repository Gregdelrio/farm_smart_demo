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
    <div class="card" id="msCard">
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

      <div class="card">
        <span class="card-title" style="margin-bottom:0.5rem;display:block;">Trends</span>
        <p style="font-size:0.78rem;color:var(--text-muted);margin:0 0 1.25rem;">
          Each pickup vs. the same-length period right before it — e.g.
          "3d" compares the last 3 pickups' average to the 3 before that.
        </p>
        <div id="msTrendsList"></div>
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
    // RESTRICTION: this tile is Owner-only. It's the only permission
    // rule in the app so far — see the TODO in js/core.js §3 for how
    // to add more if/when it's decided what else Employee shouldn't
    // see. Hides completely (not greyed out/locked) — for Greg, this
    // tile simply doesn't exist.
    function updateVisibilityForUser() {
      const card = document.getElementById('msCard');
      const isOwner = FarmSmart.currentUser.role === 'Owner';
      card.style.display = isOwner ? '' : 'none';
      if (!isOwner) {
        document.getElementById('msDetailsOverlay').classList.remove('show');
      }
    }

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

    // ---- Trends: 3-day and 7-day % change per metric ----
    // Demo history only (no real backend) — generated once when the
    // tile loads, so the numbers stay stable while you have the app
    // open rather than jumping around every time you reopen "View
    // details". A fresh page load gets a fresh (but still plausible)
    // history. Each metric compares its most recent N-pickup average
    // to the N pickups right before that — e.g. "3d" = last 3 vs. the
    // 3 before them — which is a clearer, more actionable read for a
    // farmer than comparing to a single distant day.
    const MS_HISTORY_LENGTH = 14; // enough for two non-overlapping 7-pickup windows

    function generateHistory(base, variancePct) {
      const history = [];
      let current = base;
      for (let i = 0; i < MS_HISTORY_LENGTH; i++) {
        const noise = (Math.random() - 0.5) * 2 * variancePct * base;
        current = current + noise * 0.5 + (base - current) * 0.15; // mean-reverts a bit so it doesn't drift wildly
        history.push(Math.max(0, current));
      }
      return history;
    }

    function computeTrendPct(history, windowSize) {
      const recent = history.slice(-windowSize);
      const prior = history.slice(-windowSize * 2, -windowSize);
      const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
      const recentAvg = avg(recent);
      const priorAvg = avg(prior);
      if (priorAvg === 0) return 0;
      return ((recentAvg - priorAvg) / priorAvg) * 100;
    }

    function formatTrend(pct) {
      const arrow = pct > 0.05 ? '↑' : (pct < -0.05 ? '↓' : '→');
      const sign = pct > 0 ? '+' : '';
      return `${arrow} ${sign}${pct.toFixed(1)}%`;
    }

    // Which direction is GOOD for each metric: more volume/fat/protein
    // is generally positive, while lower BMCC/TBC (fewer cells/bacteria)
    // is the sign of better milk quality — so their trend colors are
    // deliberately inverted from the others.
    const msTrendMetrics = [
      { label: 'Volume',   history: generateHistory(4820, 0.06), goodDirection: 'up' },
      { label: 'BMCC',     history: generateHistory(145000, 0.12), goodDirection: 'down' },
      { label: 'TBC',      history: generateHistory(12000, 0.15), goodDirection: 'down' },
      { label: 'Fat %',    history: generateHistory(MS_FAT_PCT, 0.04), goodDirection: 'up' },
      { label: 'Protein %', history: generateHistory(MS_PROTEIN_PCT, 0.04), goodDirection: 'up' },
    ];

    function renderTrends() {
      const el = document.getElementById('msTrendsList');
      el.innerHTML = msTrendMetrics.map((m) => {
        const t3 = computeTrendPct(m.history, 3);
        const t7 = computeTrendPct(m.history, 7);
        const colorFor = (pct) => {
          if (Math.abs(pct) < 1) return 'var(--text-secondary)'; // negligible change — don't imply good/bad
          const isGood = m.goodDirection === 'up' ? pct > 0 : pct < 0;
          return isGood ? 'var(--color-green)' : 'var(--color-red)';
        };
        return `<div class="row-line">
          <span class="k">${m.label}</span>
          <span class="v" style="display:flex;gap:0.75rem;">
            <span style="color:${colorFor(t3)};">${formatTrend(t3)} <small style="opacity:0.7;">3d</small></span>
            <span style="color:${colorFor(t7)};">${formatTrend(t7)} <small style="opacity:0.7;">7d</small></span>
          </span>
        </div>`;
      }).join('');
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
    document.addEventListener('farmsmart:userchanged', updateVisibilityForUser);

    refreshForActiveFarm();
    updateVisibilityForUser();
    refreshSyncBadge();
    renderTrends();
    setInterval(refreshSyncBadge, 20000);
  },
});
