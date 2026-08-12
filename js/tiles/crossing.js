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
    </div>
  `,

  init: function () {
    let crossingActive = false;

    function updateRoadLabel() {
      const farm = FarmSmart.getActiveFarm();
      document.getElementById('crossingRoadLabel').textContent = farm.roadName;
    }

    function startCrossing() {
      crossingActive = true;
      document.getElementById('crossingBtn').classList.add('active');
      document.getElementById('crossingIcon').className = 'ti ti-player-stop';
      document.getElementById('crossingLine1').textContent = 'STOP';
      showToast('Crossing sequence started');
    }

    function endCrossing() {
      crossingActive = false;
      document.getElementById('crossingBtn').classList.remove('active');
      document.getElementById('crossingIcon').className = 'ti ti-player-play';
      document.getElementById('crossingLine1').textContent = 'START';
      showToast('Crossing sequence ended');
    }

    document.getElementById('crossingBtn').addEventListener('click', () => {
      if (crossingActive) {
        openConfirm('Stop crossing sequence?', '', 'Stop', endCrossing);
      } else {
        openConfirm('Start crossing sequence?', '', 'Start', startCrossing);
      }
    });

    document.addEventListener('farmsmart:farmchanged', updateRoadLabel);
    updateRoadLabel();
  },
});
