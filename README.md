# FarmSmart — Dashboard

Mobile-first farm control dashboard. Every tile is its own independent
module (own CSS file + own JS file) so you can add, remove, or disable
a feature without touching anything else.

## File structure

```
farmsmart/
├── index.html              Page shell — header, empty #dashboard
│                             container, sheets, dialogs. This is the
│                             ONLY file you edit to enable/disable a tile.
├── css/
│   ├── base.css              Shared design system: header, card shell,
│   │                          badges, bottom sheets, confirm dialog, toast
│   └── tiles/
│       ├── vat.css            Styles specific to the Milk Vat tile
│       ├── crossing.css       Styles specific to the Road Crossing tile
│       ├── milking.css        Styles specific to the Live Milking tile
│       └── gates.css          Styles specific to the Paddock Gates tile
└── js/
    ├── core.js                App shell: tile registry/mount system,
    │                          farm data + switcher, user data + switcher,
    │                          confirm dialog, toast, online/offline status
    └── tiles/
        ├── vat.js              Milk Vat tile — markup + behavior
        ├── crossing.js         Road Crossing tile — markup + behavior
        ├── milking.js          Live Milking tile — markup + behavior
        └── gates.js            Paddock Gates tile — markup + behavior
```

## How the tile system works

`#dashboard` in `index.html` starts **empty**. Each tile file (e.g.
`js/tiles/vat.js`) calls `FarmSmart.registerTile({ id, html, init })`
when it loads:
- `html` — the tile's complete `<div class="card">...</div>` markup, as
  a string.
- `init` — a function that runs once that markup is in the page; this
  is where the tile finds its own buttons (`document.getElementById(...)`)
  and wires up clicks.

`js/core.js` waits for the page to finish loading, then walks through
every registered tile **in the order their `<script>` tags appear in
`index.html`**, inserts its `html` into `#dashboard`, and calls its
`init()`. That's the whole system — no build step, no framework.

## Enabling / disabling a tile

Open `index.html`. Every tile has exactly two lines: one `<link>` in
`<head>` and one `<script>` near the bottom of `<body>`. Comment out
(or delete) both to remove a tile completely:

```html
<!-- Road Crossing disabled:
<link rel="stylesheet" href="css/tiles/crossing.css">
-->
```
```html
<!-- <script src="js/tiles/crossing.js"></script> -->
```

Nothing else needs to change — `core.js` and the remaining tiles don't
know or care whether `crossing.js` was ever loaded.

**To add a new tile**, copy `js/tiles/gates.js` as a template (it's
the simplest one): give it a new `id`, write your own `html` and
`init`, save it as `js/tiles/your-tile.js` + `css/tiles/your-tile.css`,
then add the matching `<link>`/`<script>` lines in `index.html` at the
position where you want it to appear.

## Header

- **Brand** — "FarmSmart", top-left, small.
- **Farm picker** (left) and **user picker** (right) sit on the same
  row. Tapping either opens a bottom sheet.
  - Switching farm goes through the confirmation dialog first (it
    reloads real farm data).
  - Switching user does not — it's just changing who's using the
    app, not a destructive action.
- **Sync pill**, right-aligned underneath, shows Synced/Offline based
  on `navigator.onLine`.

### Users & roles (not yet restricted)
Two users are defined in `js/core.js` §3: **John (Owner)** and **Greg
(Employee)**. Right now they see and can do exactly the same things —
you told me you haven't decided yet what an Employee should be
blocked from. The switcher and `FarmSmart.currentUser.role` are fully
wired up and ready; the code comment above `USERS` in `js/core.js`
explains exactly where to add the restriction once you know what it
should be (either per-tile checks, or a `data-requires-role="owner"`
attribute pattern — both are sketched out there).

### Farms
Currently: **Laang Farm** (Peter, 355 cows, Thorburns Road), **Maguires
Road Dairy** (John, 557 cows, Maguires Road), and **Vickers Road
Panmure** (Damian, 992 cows, Vickers Road) — defined in `js/core.js`
§2. Add more by adding objects to the `FARMS` array (with `herdSize`,
`ownerFirstName`, `roadName`) — the switcher sheet, Live Milking tile,
and Road Crossing tile all render straight from it.

Switching farms fires a `farmsmart:farmchanged` event on `document` —
any tile can listen for it to refresh itself (see `js/tiles/milking.js`
and `js/tiles/crossing.js` for examples).

### Milk Statement tile
Merged daily + monthly into one tile rather than two: the daily pickup
numbers (volume, temperature, BMCC, TBC, Fat/Protein%, kg MS) sit on
the dashboard card since that's what a farmer checks day to day; the
monthly cumulative + payment estimate is behind "Show more details",
same drill-down pattern as Milk Vat. Shows the same demo values on
every farm for now (not wired to `farmsmart:farmchanged`).

## What is a CDN, and where are the icons?

The icons aren't a file in this project — they come from a **CDN**
(Content Delivery Network): a server run by someone else (here,
Cloudflare) that hosts a shared library and lets any website load it
directly, instead of you having to include the files yourself. This
line in `index.html`'s `<head>` is what pulls in the icon font:

```html
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/tabler-icons/2.44.0/iconfont/tabler-icons.min.css">
```

Every icon in the app (in `index.html` and inside each tile's `html`
template in `js/tiles/*.js`) is then just a small tag like
`<i class="ti ti-droplet"></i>` — the CDN-hosted font turns `ti-droplet`
into the actual glyph. The trade-off: the icons need an internet
connection the first time the page loads (a service worker could cache
them after that for offline use, which isn't set up in this version).

## Responsive layout (phone + desktop)

- **Below 760px wide** (phones, most tablets in portrait): unchanged
  from the mobile-first design — tiles stack in a single column,
  `#appFrame` fills the screen edge-to-edge.
- **760px and up** (tablets landscape, laptops, desktops): `#dashboard`
  switches to a 2-column grid (see `css/base.css` §3b), and `#appFrame`
  is allowed to grow up to 1100px wide and centers itself, instead of
  staying stuck at phone width.

**Why tile typography doesn't need separate "desktop sizes":** every
`.card` has `container-type: inline-size` (`css/base.css` §3), so
anything inside a tile — the big vat number, the crossing button label
— sizes itself using `cqw` units relative to *that card's own
rendered width*, not the page's. A card looks proportioned the same
whether it's a full-width phone column or one cell in the desktop
grid, with no extra breakpoint-specific font rules to maintain per
tile.

The header, section label, and the vat tile's detail overlay header
are the exception: they span the *whole* frame width rather than a
single card's width, so their sizes are fixed `rem` values (tuned once
to look right everywhere) instead of `cqw` — otherwise they'd keep
growing as `#appFrame` widens on desktop. See the comments at the top
of `css/base.css` §0 and §2 for the full explanation.

`cqw` needs a browser from roughly 2022+ (Chrome/Edge 105+, Safari
16+, Firefox 110+) — comfortably covers current phones and desktop
browsers.



Open `index.html` directly, or for best results serve the folder with
a local static server (recommended on a phone):

```bash
python3 -m http.server 8080
```

## The confirmation dialog is not red

Confirming an action (switching farms, starting the crossing sequence,
opening a gate early) is routine UX, not a warning — so `.confirm-box`
in `css/base.css` uses the neutral yellow accent, never red. Red is
reserved for genuine problem states inside a tile itself (the vat
temperature reading out of range, or the crossing badge while a
sequence is actually running) — see the comments above those specific
rules in `css/tiles/vat.css` and `css/tiles/crossing.css`.
