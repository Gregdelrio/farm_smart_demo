/* =====================================================================
   TILE: ROAD CROSSING
   The crossing only has a warning light, no gate. The big button
   itself carries the status (yellow = idle, blinking orange = active);
   the road name below follows the active farm.
   ===================================================================== */

FarmSmart.registerTile({
  id: 'crossing',
  name: 'Road Crossing',

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
    let isActive = false;
    let elapsedBaseMinutes = 0;
    let elapsedStartedAt = 0;
    let elapsedTimer = null;

    function updateRoadLabel() {
      document.getElementById('crossingRoadLabel').textContent = FarmSmart.getActiveFarm().roadName;
    }

    function renderElapsed() {
      const label = document.getElementById('crossingElapsedLabel');
      const totalMinutes = elapsedBaseMinutes + Math.floor((Date.now() - elapsedStartedAt) / 60000);
      label.textContent = `Crossing initiated since ${totalMinutes} min`;
      label.style.display = 'block';
    }

    function setActive(active) {
      isActive = active;
      document.getElementById('crossingBtn').classList.toggle('active', active);
      document.getElementById('crossingIcon').className = active ? 'ti ti-player-stop' : 'ti ti-player-play';
      document.getElementById('crossingLine1').textContent = active ? 'STOP' : 'START';
      document.getElementById('crossingSimulateBtn').innerHTML = active
        ? '<i class="ti ti-player-stop"></i>Stop simulating'
        : '<i class="ti ti-repeat"></i>Simulate crossing';
      showToast(active ? 'Crossing sequence started' : 'Crossing sequence ended');
    }

    function startCrossing() {
      setActive(true);
      // Backdated a little so the demo doesn't always read "since 0 min".
      elapsedBaseMinutes = 1 + Math.floor(Math.random() * 5);
      elapsedStartedAt = Date.now();
      renderElapsed();
      elapsedTimer = setInterval(renderElapsed, 30000);
    }

    function endCrossing() {
      setActive(false);
      clearInterval(elapsedTimer);
      document.getElementById('crossingElapsedLabel').style.display = 'none';
    }

    document.getElementById('crossingBtn').addEventListener('click', () => {
      if (isActive) openConfirm('Stop crossing sequence?', '', 'Stop', endCrossing);
      else openConfirm('Start crossing sequence?', '', 'Start', startCrossing);
    });

    // Demo shortcut: same as the button, without the confirmation step.
    document.getElementById('crossingSimulateBtn').addEventListener('click', () => {
      if (isActive) endCrossing();
      else startCrossing();
    });

    document.addEventListener('farmsmart:farmchanged', updateRoadLabel);
    updateRoadLabel();
  },
});
