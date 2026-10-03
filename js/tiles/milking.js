/* =====================================================================
   TILE: LIVE MILKING
   Herd size follows the active farm. tick() simulates the shed: replace
   it with polling of the shed controller in production; only the DOM
   updates in render() need to stay.
   ===================================================================== */

// Avg speed range (cows/hr) per farm, from the farm meeting notes.
const MILKING_SPEED_RANGES = {
  vickers:  [250, 270],
  maguires: [197, 219],
  laang:    [170, 190],
};
const DEFAULT_MILKING_SPEED_RANGE = [280, 320];

// %2TR = share of cows going round a second time this session.
const TWO_TR_RANGE = [7, 8];

FarmSmart.registerTile({
  id: 'milking',
  name: 'Live Milking',

  html: `
    <div class="card">
      <div class="card-top">
        <span class="card-title"><i class="ti ti-clock"></i>Live Milking</span>
        <span class="badge info" id="milkingBadge">Synced 3 min ago</span>
      </div>
      <div class="milk-count-row">
        <span class="milk-count"><span id="cowsMilked">184</span><span class="milk-of" id="milkOf">/ 240 cows</span></span>
        <span class="milk-pct" id="milkPct">77%</span>
      </div>
      <div class="milk-progress"><div class="fill" id="milkFill" style="width:77%;"></div></div>
      <div class="milk-stat-row">
        <div class="milk-stat-box"><p class="stat-label">Avg speed</p><p class="stat-value" id="milkSpeed">312/hr</p></div>
        <div class="milk-stat-box"><p class="stat-label">%2TR</p><p class="stat-value" id="milk2trPct">7.5%</p></div>
        <div class="milk-stat-box"><p class="stat-label">Elapsed time</p><p class="stat-value" id="milkElapsed">35 min</p></div>
      </div>
    </div>
  `,

  init: function () {
    let totalCows = 0;
    let cowsMilked = 0;
    let elapsedMinutes = 0;

    const randomBetween = ([min, max]) => min + Math.random() * (max - min);

    function render() {
      const pct = Math.round((cowsMilked / totalCows) * 100);
      document.getElementById('cowsMilked').textContent = cowsMilked;
      document.getElementById('milkOf').textContent = `/ ${totalCows} cows`;
      document.getElementById('milkPct').textContent = pct + '%';
      document.getElementById('milkFill').style.width = pct + '%';
      document.getElementById('milkElapsed').textContent = elapsedMinutes + ' min';
    }

    function renderRandomStats() {
      const speedRange = MILKING_SPEED_RANGES[FarmSmart.activeFarmId] || DEFAULT_MILKING_SPEED_RANGE;
      document.getElementById('milkSpeed').textContent = Math.round(randomBetween(speedRange)) + '/hr';
      document.getElementById('milk2trPct').textContent = randomBetween(TWO_TR_RANGE).toFixed(1) + '%';
    }

    function refreshForActiveFarm() {
      totalCows = FarmSmart.getActiveFarm().herdSize;
      cowsMilked = Math.round(totalCows * 0.7); // demo baseline: 70% through the run
      elapsedMinutes = 35;
      render();
      renderRandomStats();
    }

    function tick() {
      if (cowsMilked < totalCows) {
        cowsMilked = Math.min(totalCows, cowsMilked + Math.round(Math.random() * 3));
        elapsedMinutes += 1;
      }
      render();
      renderRandomStats();
      document.getElementById('milkingBadge').textContent = FarmSmart.randomSyncLabel();
    }

    document.addEventListener('farmsmart:farmchanged', refreshForActiveFarm);
    refreshForActiveFarm();
    document.getElementById('milkingBadge').textContent = FarmSmart.randomSyncLabel();
    setInterval(tick, 12000);
  },
});
