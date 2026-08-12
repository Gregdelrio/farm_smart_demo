/* =====================================================================
   TILE: LIVE MILKING STATUS
   ---------------------------------------------------------------------
   TO DISABLE THIS TILE: comment out (or delete) in index.html:
     <link rel="stylesheet" href="css/tiles/milking.css">
     <script src="js/tiles/milking.js"></script>

   DESIGN NOTES:
   - Herd size (the "/ X cows" figure) comes from the active farm
     (js/core.js FARMS[].herdSize) and updates on farmsmart:farmchanged.
   - Cows milked so far starts at ~70% of the herd whenever the farm
     changes, as a demo baseline.
   - Avg speed is randomized within a farm-specific range each tick,
     rather than computed from cows/time — matches what was asked for.
   - Badge shows "Synced X min ago" instead of "In progress".

   The tick() simulation below is a stand-in for a real feed. Replace
   it with polling/WebSocket calls to your milking shed controller in
   a production build — the DOM updates it makes are the only part
   that needs to stay the same.
   ===================================================================== */

// Avg speed range (cows/hr) per farm — see farm meeting notes for
// where these numbers came from; adjust here if they change.
const MILKING_SPEED_RANGES = {
  vickers:  [250, 270], // Damian
  maguires: [197, 219], // John
  laang:    [170, 190], // Peter
};

FarmSmart.registerTile({
  id: 'milking',

  html: `
    <div class="card">
      <div class="card-top">
        <span class="card-title"><i class="ti ti-clock"></i>Live Milking</span>
        <span class="badge info" id="milkingBadge">Synced 3 min ago</span>
      </div>
      <div class="milk-count-row">
        <span class="milk-count"><span id="cowsMilked">184</span><span class="milk-of">/ 240 cows</span></span>
        <span class="milk-pct" id="milkPct">77%</span>
      </div>
      <div class="milk-progress"><div class="fill" id="milkFill" style="width:77%;"></div></div>
      <div class="milk-stat-row">
        <div class="milk-stat-box"><p class="stat-label">Avg speed</p><p class="stat-value" id="milkSpeed">312/hr</p></div>
        <div class="milk-stat-box"><p class="stat-label">Elapsed time</p><p class="stat-value" id="milkElapsed">35 min</p></div>
      </div>
    </div>
  `,

  init: function () {
    let totalCows = 240;
    let cowsMilked = 0;
    let elapsedMinutes = 35;

    function randomInRange([min, max]) {
      return Math.round(min + Math.random() * (max - min));
    }

    function refreshForActiveFarm() {
      const farm = FarmSmart.getActiveFarm();
      totalCows = farm.herdSize;
      cowsMilked = Math.round(totalCows * 0.7); // demo baseline: 70% through the run
      elapsedMinutes = 35;
      render();
      refreshSpeed();
    }

    function refreshSpeed() {
      const farm = FarmSmart.getActiveFarm();
      const range = MILKING_SPEED_RANGES[farm.id] || [280, 320];
      document.getElementById('milkSpeed').textContent = randomInRange(range) + '/hr';
    }

    function refreshSyncBadge() {
      document.getElementById('milkingBadge').textContent = FarmSmart.randomSyncLabel();
    }

    function render() {
      const pct = Math.round((cowsMilked / totalCows) * 100);
      document.getElementById('cowsMilked').textContent = cowsMilked;
      document.querySelector('.milk-of').textContent = `/ ${totalCows} cows`;
      document.getElementById('milkPct').textContent = pct + '%';
      document.getElementById('milkFill').style.width = pct + '%';
      document.getElementById('milkElapsed').textContent = elapsedMinutes + ' min';
    }

    function tick() {
      if (cowsMilked < totalCows) {
        cowsMilked = Math.min(totalCows, cowsMilked + Math.round(Math.random() * 3));
        elapsedMinutes += 1;
      }
      render();
      refreshSpeed();
      refreshSyncBadge();
    }

    document.addEventListener('farmsmart:farmchanged', refreshForActiveFarm);

    refreshForActiveFarm();
    refreshSyncBadge();
    setInterval(tick, 12000);
  },
});
