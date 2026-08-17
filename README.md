# FarmSmart — Dashboard

Mobile-first farm control dashboard. Every tile is its own independent
module (own CSS file + own JS file) so you can add, remove, or disable
a feature without touching anything else. No build step, no framework
— plain HTML/CSS/JS, installable as a PWA.

---

## File structure

```
farmsmart/
├── index.html              Page shell — header, empty #dashboard
│                             container, sheets, dialogs. The ONLY file
│                             you edit to enable/disable a tile.
├── manifest.json            PWA metadata (name, theme color, icons) —
│                             used by "Add to Home Screen" / "Install app"
├── README.md                This file
│
├── css/
│   ├── base.css              Shared design system: theme variables,
│   │                          header, card shell, badges, bottom sheets,
│   │                          confirm dialog, toast, responsive grid
│   └── tiles/
│       ├── vat.css            Milk Vat
│       ├── crossing.css       Road Crossing
│       ├── milking.css        Live Milking
│       ├── milk-statement.css Milk Statement
│       └── gates.css          Paddock Gates (wheel pickers, schedule list)
│
├── js/
│   ├── core.js                App shell: tile registry/mount system,
│   │                          farm data + switcher, user data + switcher,
│   │                          confirm dialog, toast, wheel-picker utility,
│   │                          theme toggle, online/offline status
│   └── tiles/
│       ├── vat.js             Milk Vat — markup + behavior
│       ├── crossing.js        Road Crossing — markup + behavior
│       ├── milking.js         Live Milking — markup + behavior
│       ├── milk-statement.js  Milk Statement — markup + behavior
│       └── gates.js           Paddock Gates — markup + behavior
│
└── icons/
    ├── logo-master.png        High-res source (512×512) — reference
    │                          only, not linked from anywhere directly
    ├── favicon.ico             Browser tab icon (multi-resolution)
    ├── favicon-16x16.png
    ├── favicon-32x32.png
    ├── favicon-48x48.png
    ├── apple-touch-icon.png    iOS "Add to Home Screen" icon
    ├── icon-192.png            Android/PWA "Add to Home Screen" icon
    ├── icon-512.png            Same, higher resolution
    └── header-logo.png         Small logo next to "FarmSmart" in the header
```

---

## How the tile system works

`#dashboard` in `index.html` starts **empty**. Each tile file (e.g.
`js/tiles/vat.js`) calls `FarmSmart.registerTile({ id, html, init })`
when it loads:
- `html` — the tile's complete `<div class="card">...</div>` markup
  (plus any detail overlay / sheet it needs), as a string.
- `init` — a function that runs once that markup is in the page; this
  is where the tile finds its own elements (`document.getElementById(...)`)
  and wires up behavior.

`js/core.js` waits for the page to finish loading, then walks through
every registered tile **in the order their `<script>` tags appear in
`index.html`**, inserts its `html` into `#dashboard`, and calls its
`init()`.

### Enabling / disabling a tile

Open `index.html`. Every tile has exactly two lines: one `<link>` in
`<head>` and one `<script>` near the bottom of `<body>`. Comment out
(or delete) both to remove a tile completely:

```html
<!-- Road Crossing disabled:
<link rel="stylesheet" href="css/tiles/crossing.css">
-->
<!-- <script src="js/tiles/crossing.js"></script> -->
```

Nothing else needs to change — `core.js` and the remaining tiles don't
know or care whether a given tile file was ever loaded.

**To add a new tile**, copy `js/tiles/gates.js` or `js/tiles/vat.js` as
a starting point: give it a new `id`, write your own `html` and
`init`, save it as `js/tiles/your-tile.js` + `css/tiles/your-tile.css`,
then add the matching `<link>`/`<script>` lines in `index.html` at the
position where you want it to appear.

### Shared utilities every tile can use (defined in `js/core.js`)

- `showToast(message)` — small floating confirmation after an action.
- `openConfirm(title, message, confirmLabel, onConfirm)` — the
  reusable confirmation dialog (see "The confirmation dialog is not
  red" below).
- `FarmSmart.getActiveFarm()` — the full farm object currently
  selected (`{ id, name, meta, herdSize, ownerFirstName, roadName }`).
- `FarmSmart.currentUser` — the currently selected user
  (`{ id, name, role, initials }`).
- `FarmSmart.randomSyncLabel()` — returns a "Synced X min ago" string
  (X between 1–10), used by the Milk Vat, Live Milking, and Milk
  Statement badges.
- `FarmSmart.createWheel(container, values, initialIndex)` — builds an
  iPhone-style scroll-and-snap picker column (see Paddock Gates below).
- Two custom events any tile can listen for on `document`:
  `farmsmart:farmchanged` (fires when the active farm changes) and
  `farmsmart:userchanged` (fires when the active user changes).

---

## Header

Three rows, top to bottom:
1. **Brand row** — the logo (`header-logo.png`) and "FarmSmart" text.
2. **Farm picker** (left) + **theme toggle** + **user picker** (right,
   grouped together) — all on the same row.
3. **Sync status pill** — Synced/Offline, based on `navigator.onLine`.

- **Farm picker**: tapping it opens a bottom sheet listing every farm.
  Switching farms goes through the confirmation dialog first (it
  reloads real farm data) and fires `farmsmart:farmchanged`.
- **Theme toggle**: sun/moon button, switches light/dark mode — see
  "Light / dark theme" below.
- **User picker**: tapping it opens a bottom sheet listing John and
  Greg. Switching users does **not** need confirmation (it's not
  destructive) and fires `farmsmart:userchanged`.

---

## Farms

Three farms, defined in `js/core.js` §2 (`FARMS` array):

| Farm | Owner | Herd size | Road |
|---|---|---|---|
| Laang Farm | Peter | 355 cows | Thorburns Road |
| Maguires Road Dairy | John | 557 cows | Maguires Road |
| Vickers Road Panmure | Damian | 992 cows | Vickers Road |

Add more by adding objects to the `FARMS` array (`id`, `name`, `meta`,
`herdSize`, `ownerFirstName`, `roadName`) — the farm switcher sheet,
Live Milking, Road Crossing, and Paddock Gates all read straight from
it, and also need a matching entry in `PADDOCK_WHEEL_CONFIG` (see
Paddock Gates below) if the new farm should support gate scheduling.

**Maguires Road Dairy is the default farm shown when the app first
loads** (`FarmSmart.activeFarmId` in `js/core.js` §2) — change that
one line to make a different farm the default.

## Users & roles

Two users, defined in `js/core.js` §3 (`USERS` array): **John
(Owner)** and **Greg (Employee)**. In the real (non-demo) version only
one user will ever be signed in at a time — the switcher exists here
purely so this can be demonstrated to the client without needing two
separate logins.

**The one permission rule wired up so far:** Greg can't see the Milk
Statement tile. Switching to Greg hides it completely (not greyed
out — it's just not there); switching back to John brings it back,
live, no reload needed. See `updateVisibilityForUser()` in
`js/tiles/milk-statement.js` for how it works, and the comment above
`USERS` in `js/core.js` §3 for how to add further role restrictions
later (either per-tile checks against `FarmSmart.currentUser.role`, or
a `data-requires-role="owner"` attribute pattern).

---

## The tiles

### Milk Vat
Big temperature readout in a colored frame (green = in range, red =
out of range — the frame color alone carries the status, so the badge
just shows "Synced X min ago" rather than "OK"/"Alert"). The meta line
under the frame only appears during an alert, explaining it (e.g.
"Above 6°C for 18 min").

"View details" opens a real chart — temperature on the Y axis, time of
day on the X axis, covering the last 24 hours relative to whatever
time it actually is right now (`buildTrendChart()` in `js/tiles/vat.js`
recomputes the X-axis labels from `new Date()` every time it draws).
Double-tap the colored frame to toggle a demo alert state.

### Road Crossing
One big yellow push-button. Tapping it goes through a minimal
confirmation ("Start crossing sequence?" / "Stop crossing sequence?",
no extra explanation) since it affects live road traffic. While
active, the button blinks orange (a "live action in progress" state,
distinct from the red used for genuine problem states elsewhere) and
its label reads STOP. The road name shown under the button comes from
the active farm's `roadName` and updates on `farmsmart:farmchanged`.

### Live Milking
Cows milked vs. the active farm's herd size, with a progress bar. Herd
size, the milked count, and elapsed time all reset to that farm's
numbers on `farmsmart:farmchanged` (milked count starts at ~70% of the
herd as a demo baseline). Three stats underneath, refreshed every 12
seconds:
- **Avg speed** — random within a farm-specific range
  (`MILKING_SPEED_RANGES` in `js/tiles/milking.js`): Damian/Vickers
  250–270/hr, John/Maguires 197–219/hr, Peter/Laang 170–190/hr.
- **%2TR** — share of cows going through a second rotation this
  session; fluctuates slightly between 7.0–8.0%, same range for every
  farm.
- **Elapsed time**.

### Milk Statement
Daily pickup numbers on the card itself (volume, temperature, BMCC,
TBC, Fat/Protein %, kg milk solids highlighted since that's what
income is actually calculated from) — this is what a farmer checks day
to day. Monthly cumulative volume/kg MS + a payment estimate sit
behind "View details", checked far less often.

Volume scales with the active farm's herd size (35 L/cow/day — the
middle of a realistic 30–40 L range), and everything else cascades
from it:
```
daily volume  = herdSize × 35 L
daily kg MS   = daily volume × (Fat% + Protein%) / 100
month volume  = daily volume × 30
month kg MS   = daily kg MS × 30
quality bonus = month kg MS × $0.05/kg MS
est. payment  = (month kg MS × $8.50/kg MS) + quality bonus
```
Fat%, Protein%, BMCC, TBC, base rate, and bonus rate are flat demo
constants (`MS_*` at the top of `js/tiles/milk-statement.js`) — the
same on every farm. **Hidden entirely for Greg** (see "Users & roles"
above).

### Paddock Gates
Two separate, deliberately unlinked actions:

- **"Timings"** schedules a *future* gate opening: a Today/Tomorrow
  toggle, then paddock wheel(s) (which differ per farm — see
  `PADDOCK_WHEEL_CONFIG` and `composePaddockCode()` in
  `js/tiles/gates.js`), then an hour/minute/AM-PM time. "Save" adds it
  to that farm's schedule list. Max 4 scheduled at once — past that,
  "Timings" shows a toast instead of opening.
- **"Open Now"** opens a *specific* paddock immediately and is
  completely unrelated to the schedule — it never touches the list.
  Its paddock wheel(s) default to the first real value, same as
  "Timings". Tapping "Open" goes through a confirmation naming the
  exact paddock ("Open paddock A5 now?") before it actually opens —
  that's the safeguard against an accidental tap here, rather than a
  blank starting position on the wheels. The sheet stays open
  underneath the confirmation, so cancelling drops you right back on
  the wheels instead of closing everything.

Paddock codes by farm:
| Farm | Wheels | Example |
|---|---|---|
| Vickers Road Panmure | Letter A–D + number 1–20 | `A5` |
| Maguires Road Dairy | Prefix "-" or "W" + number 10–30 | `12` or `W12` |
| Laang Farm | Single number 1–30 | `12` |

Both wheel pickers are built from `FarmSmart.createWheel()` in
`js/core.js` — an iPhone-style scroll-and-snap column, rebuilt fresh
every time a sheet opens so it always matches the currently active
farm. The schedule list itself is per-farm (`scheduleByFarm` in
`js/tiles/gates.js`) — switching farms shows that farm's own list. Any
entry beyond the first (shown big at the top) appears as a small row
with its own red ✕ to remove it, no confirmation needed — a typo is
one tap to fix.

---

## Light / dark theme

Tap the sun/moon button in the header to switch between dark and light
mode. The choice is saved to `localStorage` on that device — it
persists across reloads, independent of which user is selected. Every
color is defined once as a CSS variable in `css/base.css` §0 (`:root`
= dark defaults, `[data-theme="light"]` = overrides). A few solid,
fully-saturated blocks intentionally keep fixed colors in both themes
— the milk vat's green/red frame, the road crossing button, the
crossing-active blink — the same way a stop sign is red regardless of
how bright the day is.

## Responsive layout (phone + desktop)

- **Below 760px wide** (phones, most tablets in portrait): tiles stack
  in a single column, `#appFrame` fills the screen edge-to-edge.
- **760px and up** (tablets landscape, laptops, desktops):
  `#dashboard` switches to a 2-column grid (`css/base.css` §3b), and
  `#appFrame` grows up to 1100px wide, centered.

Tile typography doesn't need separate "desktop sizes": every `.card`
has `container-type: inline-size`, so anything inside a tile sizes
itself using `cqw` units relative to *that card's own rendered width*,
not the page's — a card looks proportioned the same whether it's a
full-width phone column or one cell in the desktop grid. The header
and section label are the exception (they span the *whole* frame
width, so their sizes are fixed `rem` values instead — otherwise
they'd keep growing as `#appFrame` widens on desktop).

`cqw` needs a browser from roughly 2022+ (Chrome/Edge 105+, Safari
16+, Firefox 110+) — comfortably covers current phones and desktops.

## Why sheets/dialogs/overlays used to open below your scroll position

Fixed — they use `position: fixed` (anchored to what's actually on
screen) rather than `position: absolute` (anchored to the full page,
often much taller than one screen once several tiles are stacked). See
the comment above `.overlay` in `css/base.css` §3. Applies to the
farm/user switcher sheets, the confirmation dialog, every tile's
detail overlay, the Paddock Gates sheets, and the toast.

## Back button icon

The back arrow inside a detail overlay is drawn as inline SVG (not the
Tabler icon font) so it can never fail to render due to a slow/blocked
CDN or a stale cache — see the top of `js/tiles/vat.js` or
`js/tiles/milk-statement.js` for the markup, and `.close-btn svg` in
`css/base.css` for its styling.

## The confirmation dialog is not red

Confirming an action (switching farms, starting the crossing sequence,
opening a gate) is routine UX, not a warning — so `.confirm-box` in
`css/base.css` uses the neutral yellow accent, never red. Red is
reserved for genuine problem states inside a tile itself (the vat
temperature out of range, the crossing badge while a sequence is
actually running).

---

## Logo, favicon, and home-screen icon

The tree-circuit logo lives in `icons/`: white line-art on a solid
dark circular badge (`#1c1c1a`, matching the app's own background), so
it stays visible on any surrounding UI, light or dark.

- `favicon.ico` / `favicon-16x16.png` / `favicon-32x32.png` — browser
  tab icon.
- `apple-touch-icon.png` — iOS "Add to Home Screen" icon. Composited
  onto an opaque backing square (iOS mishandles transparency here) —
  since the badge's own fill is already dark, this is seamless.
- `icon-192.png` / `icon-512.png` — referenced from `manifest.json`,
  used by Android/Chrome's "Add to Home Screen"/"Install app".
- `header-logo.png` — the small version next to "FarmSmart" in the
  header (`.brand-logo` in `css/base.css`).

**If you swap in a new source image later:** the process (done with
Python/Pillow) is — isolate the artwork from its background (by
detecting a drawn circle's edge, or by using brightness as an alpha
mask for line-art with no background of its own), then composite it
onto a solid circular badge sized and colored to match the app, then
export every size above from that one master image. Ask and this can
be redone for a new logo in a few minutes.

## What is a CDN, and where do the Tabler icons come from?

Every small icon used across the app (droplet, chart, calendar, etc. —
not the logo) comes from Tabler Icons, loaded from a **CDN** (Content
Delivery Network): a server run by someone else (here, Cloudflare)
that hosts a shared library and lets any website load it directly,
instead of shipping the font file yourself:

```html
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/tabler-icons/2.44.0/iconfont/tabler-icons.min.css">
```

Every such icon is then just a tag like `<i class="ti ti-droplet"></i>`
— the CDN-hosted font turns `ti-droplet` into the glyph. Trade-off: it
needs an internet connection the first time the page loads. (The back
button is the one icon deliberately drawn as inline SVG instead, to
avoid any dependency on this — see "Back button icon" above.)

---

## Run it

Open `index.html` directly, or for best results (and for the PWA
manifest/icons to work correctly) serve the folder with a local static
server:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` — on a phone, use "Add to Home
Screen" to install it.
