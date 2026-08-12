/* =====================================================================
   TILE: PADDOCK GATES
   ---------------------------------------------------------------------
   TO DISABLE THIS TILE: comment out (or delete) in index.html:
     <link rel="stylesheet" href="css/tiles/gates.css">
     <script src="js/tiles/gates.js"></script>
   ===================================================================== */

FarmSmart.registerTile({
  id: 'gates',

  html: `
    <div class="card">
      <div class="card-top">
        <span class="card-title"><i class="ti ti-fence"></i>Paddock Gates</span>
        <span class="badge info">Scheduled</span>
      </div>
      <div class="gate-next">
        <span class="lbl">Next gate</span>
        <p class="name">River Flat → Home Paddock</p>
        <p class="time" id="gateTime">Opens in 42 min · 4:30 PM</p>
      </div>
      <div class="gate-btn-row">
        <button class="card-btn primary" id="openGateNowBtn"><i class="ti ti-lock-open"></i>Open Now</button>
        <button class="card-btn" id="editTimingsBtn"><i class="ti ti-calendar"></i>Timings</button>
      </div>
    </div>
  `,

  init: function () {
    document.getElementById('openGateNowBtn').addEventListener('click', () => {
      openConfirm(
        'Open gate now?',
        'This opens the River Flat → Home Paddock gate immediately, ahead of its scheduled time.',
        'Yes, open gate',
        () => {
          document.getElementById('gateTime').textContent = 'Opened manually · just now';
          showToast('Gate opened');
        }
      );
    });

    document.getElementById('editTimingsBtn').addEventListener('click', () => {
      // In a full build this would open a dedicated schedule editor.
      // Kept as a toast here to keep the demo self-contained.
      showToast('Opening gate schedule editor…');
    });
  },
});
