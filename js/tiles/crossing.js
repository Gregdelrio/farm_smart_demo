/* =====================================================================
   TILE: ROAD CROSSING
   ---------------------------------------------------------------------
   TO DISABLE THIS TILE: comment out (or delete) in index.html:
     <link rel="stylesheet" href="css/tiles/crossing.css">
     <script src="js/tiles/crossing.js"></script>

   DESIGN NOTES:
   - There's only a warning light at this crossing, no physical gate —
     so there's no lights/gate toggle row.
   - The road name shown under the button comes from the active farm
     (js/core.js FARMS[].roadName) and updates on farmsmart:farmchanged.
   - No badge, no explanatory hint text under the button — the button
     itself (yellow = idle, blinking orange = active) carries the
     status.
   - Confirmation dialogs are deliberately minimal: just "Start/Stop
     crossing sequence?", no extra sentence.
   ===================================================================== */

FarmSmart.registerTile({
  id: 'crossing',

  html: `
    <div class="card">
      <div class="card-top">
        <span class="card-title"><i class="ti ti-alert-octagon"></i>Road Crossing</span>
      </div>
      <button class="crossing-btn" id="crossingBtn">
        <i class="ti ti-player-play" id="crossingIcon"></i>
        <span class="line1" id="crossingLine1">START</span>
        <span class="line2">Crossing Sequence</span>
      </button>
      <p class="crossing-road-label" id="crossingRoadLabel">Vickers Road</p>
      <p class="crossing-elapsed-label" id="crossingElapsedLabel" style="display:none;"></p>
      <button class="card-btn" id="crossingSimulateBtn"><i class="ti ti-repeat"></i>Simulate crossing</button>
    </div>
  `,

  init: function () {
    let crossingActive = false;
    let elapsedBaseMinutes = 0;
    let elapsedStartedAt = 0;
    let elapsedTimer = null;

    function updateRoadLabel() {
      const farm = FarmSmart.getActiveFarm();
      document.getElementById('crossingRoadLabel').textContent = farm.roadName;
    }

    function renderElapsed() {
      const label = document.getElementById('crossingElapsedLabel');
      const extraMinutes = Math.floor((Date.now() - elapsedStartedAt) / 60000);
      const totalMinutes = elapsedBaseMinutes + extraMinutes;
      label.textContent = `Crossing initiated since ${totalMinutes} min`;
      label.style.display = 'block';
    }

    function startCrossing() {
      crossingActive = true;
      document.getElementById('crossingBtn').classList.add('active');
      document.getElementById('crossingIcon').className = 'ti ti-player-stop';
      document.getElementById('crossingLine1').textContent = 'STOP';
      showToast('Crossing sequence started');

      document.getElementById('crossingSimulateBtn').innerHTML = '<i class="ti ti-player-stop"></i>Stop simulating';

      // Backdate the start slightly so the demo doesn't always show
      // "since 0 min" the instant a crossing kicks off.
      elapsedBaseMinutes = 1 + Math.floor(Math.random() * 5);
      elapsedStartedAt = Date.now();
      renderElapsed();
      elapsedTimer = setInterval(renderElapsed, 30000);
    }

    function endCrossing() {
      crossingActive = false;
      document.getElementById('crossingBtn').classList.remove('active');
      document.getElementById('crossingIcon').className = 'ti ti-player-play';
      document.getElementById('crossingLine1').textContent = 'START';
      showToast('Crossing sequence ended');

      document.getElementById('crossingSimulateBtn').innerHTML = '<i class="ti ti-repeat"></i>Simulate crossing';

      if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
      document.getElementById('crossingElapsedLabel').style.display = 'none';
    }

    document.getElementById('crossingBtn').addEventListener('click', () => {
      if (crossingActive) {
        openConfirm('Stop crossing sequence?', '', 'Stop', endCrossing);
      } else {
        openConfirm('Start crossing sequence?', '', 'Start', startCrossing);
      }
    });

    // Simulate crossing: skips the confirm dialog and goes straight to
    // whatever pressing the real button + confirming OK would do —
    // handy for demos so you don't have to explain the confirm step.
    document.getElementById('crossingSimulateBtn').addEventListener('click', () => {
      if (crossingActive) {
        endCrossing();
      } else {
        startCrossing();
      }
    });

    document.addEventListener('farmsmart:farmchanged', updateRoadLabel);
    updateRoadLabel();
  },
});
