# Plan: custom garden map (background image + placeable objects)

Status: **parts 1-2 built** (background mode, aerial photo upload with
opacity/rotation/scale/position). **Part 3 (the two-click distance
calibration described below) was never built** - the map still only has
the older, simpler "width in metres + compass direction" fields from
before this plan existed, not per-photo pixel calibration. **Parts 4-5
(the object library and object shadows) are still planned, not built.**
This is the design agreed on before writing any code, so the reasoning
behind it doesn't get lost.

## The goal

Build your actual property in the app: drop in an aerial photo (a Google
Maps screenshot, say), place the house, decking, trees, rockeries and
fences, then position the growing zones inside it. Plus turn off the
existing grid background in both the map and compact views.

The stated requirement is that it must look **professional, not scribbly**.
That requirement is what drives the whole design below.

## The key design rule: no freehand drawing

The obvious first idea would be "add a brush so you can draw your own trees
and beds". **That is exactly what we should not do.** Freehand drawing with
a mouse or finger always comes out uneven, and the result looks homemade no
matter how good the tool is. It's also unsatisfying to use, because you can
feel that you ought to be able to draw better than you are.

Instead: a **curated library of ready-made objects** you drag out and
scale. Each object is drawn in the same top-down style the existing zones
already use (the greenhouse glazing, the raised bed's wooden frame, the
soil texture). The result then looks good by construction, because it was
designed up front, and there's no way to accidentally make it ugly.

The trade-off: you can't draw your own oddly-shaped feature exactly. That
trade is worth it, and a background photo covers what the library doesn't.

## The parts

### 1. Background mode per map (small, do this first)

Each map tab gets a mode:

- `grid` - today's look (grid plus a soft green glow). Default.
- `plain` - flat surface, no grid. The thing that was asked for.
- `photo` - uploaded aerial image.

Applies to **both** the regular map and compact view, so a stripped-down
site plan can look as clean as the reference images.

Data model: `map.background`.

### 2. Aerial photo as background

Upload one image per map (a Google Maps screenshot or a drone photo).

**Storage, an important call.** The image must *not* live as base64 inside
`tradgard.json`. That file is re-read on every API request, and a single
megabyte-sized image would make the whole app noticeably slower. Instead:

- Downscale in the browser before upload (the same approach the AI chat's
  photos already use).
- Store as its own file, `/data/maps/<mapId>.jpg`.
- Serve via `GET /api/map-image?mapId=...`.
- Only a filename and settings go in the JSON.

Plus an **opacity slider** (say 35-100%), because a full-colour aerial
photo makes the plant icons hard to read. A dimmed photo with crisp zones
on top also reads as more deliberately designed than a raw screenshot.

### 3. Scale calibration (what makes the map "real")

The app already has a setting for the map's width in metres, which the sun
map depends on. With a background photo we can do much better:

**Two clicks and one measurement.** Click two points in the image whose
real distance you know (the length of a house wall, the short side of the
decking), type in the metres. Done. Now the app knows exactly how many
metres a pixel is.

That buys three things:

- Sun map shadows become correct in the real world, not merely
  proportional.
- Zone sizes can be entered in metres instead of fiddled with in pixels.
- "~6.5 hours of sun" becomes a number you can actually trust.

Google Maps has a scale bar in the corner you can use as the reference if
you don't know any measurement on the property.

### 4. The object library

First-pass categories:

| Group | Objects |
|---|---|
| Buildings | house, shed, decking/patio, balcony |
| Planting | deciduous tree, conifer, fruit tree, shrub, hedge, lawn |
| Ground | gravel path, paving, rockery, pond |
| Other | fence, compost bin, outdoor tap, garden furniture |

Each object:

- is drawn as SVG in the same style as the existing zones,
- can be dragged, scaled (corner handle, already exists for zones) and
  **rotated**,
- has a z-order, so a shrub can sit in front of or behind a bench,
- carries a height in metres (tree ~4 m, fence ~1.8 m, hedge ~1.2 m).

**Snapping.** The existing `zonSnappning()` and its alignment guides get
reused, so objects line up with each other and with the zones. Rotation
snaps to 15 degree increments unless a modifier key is held. This is the
single most important detail for keeping the result from looking sloppy:
everything lands in line without anyone having to nudge pixels.

Objects are **not** zones. They can't hold plants, don't appear under "By
zone", and aren't counted in any statistics. They're context.

### 5. Trees that cast shade (the real payoff)

The sun map currently only computes shadows from zones (greenhouses,
beds). In a real garden the **tree on the neighbour's side of the fence is
the dominant source of shade**, not the raised bed.

As soon as objects exist and carry a height in metres, they can feed into
the existing shadow calculation. That makes the sun map realistic for the
first time: "this bed is in shade from the oak after three o'clock" is an
insight that actually changes where you plant.

In my view this is the strongest reason to build the whole feature, more so
than the map simply looking nicer.

## Build order

Each step is useful on its own, so it's fine to stop anywhere.

1. **Background mode** (`grid` / `plain`) in both views. Small, and
   immediately delivers the cleaner look.
2. **Image upload** plus opacity. Now you see your own property.
3. **Scale calibration.** The map becomes dimensionally true.
4. **Object library**, placement, rotation, snapping. The biggest chunk of
   work.
5. **Object shadows in the sun map.** The biggest functional win.

## Open questions before step 4

- **Mobile.** Placing and rotating objects with a finger on a phone will be
  fiddly. My suggestion: editing is a desktop mode (which "Edit layout"
  effectively already is), while the result of course displays properly on
  mobile. Worth confirming before we build.
- **How many objects in the first pass.** Twelve well-drawn ones beat forty
  mediocre ones. The list above can be trimmed.
- **The map's own dimensions.** The scene is a fixed 1000x700 units today.
  A long, narrow property may need its own aspect ratio per map.

## What this should *not* become

- No freehand brush (see above).
- No free-rotating 3D view. The top-down perspective is what makes the app
  understandable at a glance.
- No sticker sheet of decorations. Every object should earn its place:
  either it casts shade, or it helps you orient yourself on the property.
