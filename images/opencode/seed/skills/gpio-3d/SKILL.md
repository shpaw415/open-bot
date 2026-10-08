---
name: gpio-3d
description: >-
  Create 3D-printable parts with the gpio-3d CLI. Use when the user wants a
  3D-printed clip, spacer, shroud, bracket, knob, stand, case, or other part —
  simple or complex, with or without text engraving. Run the gpio-3d command.
  Output /home/agent/workspace/model/ as one glTF (.glb) and one STL per part,
  plus model/manifest.json. Meshes come from trimesh — never hand-written.
---

# gpio-3d

This is the procedural (legacy) 3D method: it always works, needs no provider,
and produces printable, watertight parts. When the user asks for an
AI-generated 3D model and a 3D provider is configured on the config page, load
the `gen-3d` skill and run `gen-3d` first; use gpio-3d as the fallback.

Write printable parts the user can slice (`.stl`) and viewers can show (`.glb`).
Do **not** invent a CAD kernel, hand-write glTF/STL bytes, or `import trimesh`.

## Tool

Run `gpio-3d`. It writes meshes with [trimesh](https://github.com/mikedh/trimesh)
and sets manifest `tool` to `trimesh`. Coordinates are **millimeters**. Pitch is
**2.54 mm**. Do not pass a pitch and do not scale to meters.

You run the command yourself. **Never** `pip install`. **Never** tell the user
to pip-install.

If `gpio-3d` is not on PATH, stop and tell the user to update the open-bot
desktop image. Do not install trimesh yourself.

```sh
gpio-3d clip --name header-clip --cols 20 --rows 2 --thickness 2 --fits custom --dir /home/agent/workspace/model
gpio-3d spacer --name standoff --cols 8 --rows 1 --height 3 --hole 1.0 --fits custom --dir /home/agent/workspace/model
gpio-3d shroud --name fan-shroud --cols 20 --rows 2 --height 8 --wall 1.6 --fits custom --dir /home/agent/workspace/model
```

The presets also take an optional `--color #rrggbb`.

`--cols` and `--rows` size the part: length is `cols × 2.54`, width is
`rows × 2.54`. The presets shape parts around a 2.54 mm pin header, so they
also accept the board fits `companion-header`, `arduino-uno`, `arduino-nano`,
or `arduino-mega`; use `custom` for everything else. Repeat `--fits` when the
same geometry fits more than one board. `--hole` must be under 2.54 mm.

Use `clip`, `spacer`, or `shroud` first when they fit. Use `build` for anything
else — brackets, knobs, rings, stands, engraved labels, free geometry. The
recipe is stdin, not a file in `model/`:

```sh
gpio-3d build - --dir /home/agent/workspace/model <<'EOF'
{
  "name": "notched-clip",
  "units": "mm",
  "fits": ["custom"],
  "ops": [
    {"op": "header-bar", "cols": 8, "rows": 2, "thickness": 2},
    {"op": "cut", "shape": "box", "size": [2.54, 2.54, 2], "at": [1.27, 1.27, 1]}
  ]
}
EOF
```

Every successful `build` also refreshes `.gpio-3d/last.json` next to `model/`.
Rerun it with `gpio-3d build last --dir ...`. `--save <name>` keeps a copy as
`.gpio-3d/<name>.json`, and `--patch '<json>'` merges top-level fields
(`name`, `fits`, `color`, `ops`) over the recipe before building — iterate
with a small diff instead of re-pasting the whole recipe:

```sh
gpio-3d build stand --dir /home/agent/workspace/model --patch '{"color": "#22cc88"}'
gpio-3d build last --dir /home/agent/workspace/model
```

`ops` patches one op in place when given an object of index keys — merge
`{"count": 16}` into `ops[1]` without resending the array. The same index
form reaches inside an op for arrays like loft rings — merge one point of
`ops[1]`'s bottom ring without resending it:

```sh
gpio-3d build valve-knob --dir /home/agent/workspace/model --patch '{"ops": {"1": {"count": 16}}}'
gpio-3d build horn --dir /home/agent/workspace/model --patch '{"ops": {"0": {"bottom": {"0": [-9, 2]}}}}'
```

Building a saved recipe by name writes the patched state back to that library
file, so the library always holds the latest iteration.

Saved recipes are read back by name (`gpio-3d build stand`), which resolves
before file paths. `--save` names must be kebab-case.

## Recipe ops

`units` is `mm` only. Every solid op accepts `at` (`[x, y, z]`, the solid's
center), `scale` (`[x, y, z]` factors from 0.05 to 20, applied about the
solid's center — ellipsoid heads, flattened feet), and `rotate`
(`[degX, degY, degZ]`, spins the solid about its own center). `at` translates
the solid so its bbox center lands on that point — for `extrude` and
`revolve` the profile is authored in absolute coordinates, so passing `at`
moves the profile from where you drew it; omit `at` to keep authored
coordinates. A recipe has at most 100 ops total.

The recipe may also set `color`: a `#rrggbb` hex string that tints the part in
a 3D viewer only. It never changes the printable STL — pick a color that makes
the part easy to tell apart on screen, not for printing. The presets set it
with `--color`.

Solids (the first one starts the part; later ones union onto it):

- `box` — `size: [x, y, z]`. Without `at`, the minimum corner sits at the origin.
- `cylinder` — `radius`, `height`; optional `axis` (`x`, `y`, or `z`, default `z`). Without `at`, the base sits on the floor.
- `header-bar` — `cols`, `rows`, `thickness`; sits on the 2.54 mm grid from the origin.
- `sphere` — `radius`, centered at the origin unless `at`.
- `torus` — `radius` (ring) and `tube` (`tube` < `radius`); lies flat, hole along z.
- `cone` — `radius`, `height`; base on the floor, apex up.
- `capsule` — `radius`, `height`; `height` is the overall length including both rounded ends, so it must be at least `2 × radius`; stands on the floor along z.
- `revolve` — `profile: [[radius, height], ...]` spun around the z axis; start and end the profile at radius `0` for a closed solid (a closed loop makes a ring). Optional `angle` (degrees, `0`–`360`) leaves a flat side.
- `extrude` — `points: [[x, y], ...]` (3–200 points), optional `holes` (up to 20 rings of the same shape), `height`. Optional `twist` (degrees) and `taper` (top scale, `0`–`10`).
- `loft` — `bottom` and `top` rings (`[[x, y], ...]`, 3–200 points each, point counts may differ — both are resampled) and `height`. Interpolates one ring into the other organically (tapered torsos, horns, funnel necks). Winding is normalized automatically; the hull-based interpolation is approximate (a few percent proud of the ideal surface), which is fine for character work, not for precision fits.

Modifiers:

- `cut` — `shape` plus that solid's fields; subtracts it. Any solid works as a shape, so `{"op": "cut", "shape": "cylinder", "radius": 2, "height": 10, "axis": "x", "at": [5, 5, 1]}` drills a sideways hole.
- `intersect` — same fields as `cut`; keeps only the overlap. Needs a part first.
- `hole-grid` — `cols`, `rows`, `diameter` (under 2.54 mm); punches the pin grid from the origin.
- `pattern` — `count` (2–200) and `ops` (a list of solid ops only); repeats the group. Linear: `axis` (`x`, `y`, `z`) plus `step` (mm). Polar: `around: [x, y]` plus `degrees` per copy. Default `mode` is `add`; `"mode": "cut"` subtracts every copy instead (vent grids, slots).
- `mirror` — `axis` (`x`, `y`, or `z`) and `ops` (solid ops only); adds the group plus its flip across that axis's plane through the origin. Build one half touching the origin, mirror the other. Also accepts `"mode": "cut"`.
- `hull` — `ops` (solid ops only); stretches a skin over the part and the group — smooth necks joining a head to a body, blended limb roots, capes. With no part yet it is just the hull of the group.
- `text` — `value` (1–40 characters, one line), `size` (mm cap height), `depth` (mm), and `at` (required). `mode` is `engrave` (default; `at` is the face and the text cuts `depth` below it) or `emboss` (`at` is the base and the text grows `depth` above it). `face` picks the surface: `top` (default), `bottom`, `front` (`-y`), `back` (`+y`), `left` (`-x`), `right` (`+x`); `at` sits on that surface and the cut runs into the part along its normal. `valign` positions the text block along its height axis (`center` default — the block is centered on `at`; `baseline` — the type baseline sits at `at`; `top` — the block's top edge sits at `at`). On a `top`/`bottom` face the height axis is world `y`; on walls it is world `z`. `align` (`left`, `center`, `right` — where `at` sits along the text line) and `bold` are optional. DejaVu Sans is built in; accents work. Use one `text` op per part.
- A cut or engrave that misses the part prints a `gpio-3d: warning` on stderr and leaves the mesh unchanged; a cut that traps an enclosed void warns too. Read the warnings, do not ignore them.

Pitch is 2.54 mm. Do not add `pitch`, a file path, or any other field. Do not
nest `pattern` or `mirror` inside another `pattern` or `mirror`; one level
only.

A knurled knob with an engraved label:

```sh
gpio-3d build - --dir /home/agent/workspace/model <<'EOF'
{
  "name": "knob",
  "units": "mm",
  "fits": ["custom"],
  "color": "#22cc88",
  "ops": [
    {"op": "revolve", "profile": [[0, 0], [9, 0], [9, 2], [4, 2], [4, 8], [0, 8]]},
    {"op": "pattern", "count": 12, "around": [0, 0], "degrees": 30, "ops": [{"op": "box", "size": [1.6, 3, 6], "at": [4.2, 0, 4]}]},
    {"op": "cut", "shape": "box", "size": [1.6, 3.4, 3], "at": [9, 0, 1]},
    {"op": "text", "value": "CH1", "size": 3, "depth": 0.8, "at": [0, 0, 8], "align": "center"}
  ]
}
EOF
```

## Output

Every write prints `<name> <glb> <stl> bbox WxDxHmm` — use the bbox to catch size mistakes before telling the user.

Directory: `/home/agent/workspace/model/`

- `model/<part>.glb` — one glTF binary per part (viewer)
- `model/<part>.stl` — same stem (print)
- `model/manifest.json` — one file for every part; `gpio-3d` writes it

No other files in `model/`. Do not put the recipe there.

The command keeps parts it did not name. It replaces a part only when `--name`
matches. Do not delete another part unless the user names it.

In the final message, name the `.stl` as the printable file and embed the
part's `.glb` as `![short description](/home/agent/workspace/model/<part>.glb)`
— the chat renders an interactive 3D viewer for it; the workspace file
explorer serves both raw files. If the part is for a 3D print service, the
`.stl` is what they upload.

## manifest.json

`gpio-3d` writes this. Do not hand-edit it unless a command failed and you are
fixing `fits` only.

```json
{
  "version": 1,
  "units": "mm",
  "tool": "trimesh",
  "parts": [
    {
      "name": "header-clip",
      "file": "header-clip.glb",
      "units": "mm",
      "fits": ["custom"],
      "color": "#22cc88"
    },
    {
      "name": "arduino-header-clip",
      "file": "arduino-header-clip.glb",
      "units": "mm",
      "fits": ["arduino-uno", "arduino-nano", "arduino-mega"]
    }
  ]
}
```

## Rules

- `units` is `mm` only, on the manifest and on every part.
- `file` is one basename, kebab-case, ending in `.glb`. The print file is that
  stem with `.stl`. The command names the file from `--name`.
- `fits` is one or more of `custom`, `companion-header`, `arduino-uno`,
  `arduino-nano`, `arduino-mega`. Use `custom` unless the part targets one of
  those 2.54 mm headers.
- `color` is optional, `#rrggbb`, viewer tint only.
- `name` is unique. `file` is unique. Each `.glb` contains one mesh.
- The presets (`clip`, `spacer`, `shroud`, `header-bar`, `hole-grid`) assume a
  2.54 mm pin header; check the target board's header before trusting defaults.
- Validate before telling the user it is done:

```sh
bun ~/.config/opencode/skills/gpio-3d/validate-manifest.ts /home/agent/workspace/model
```

## Measuring

`gpio-3d inspect /home/agent/workspace/model` prints every manifest part with
its bbox, volume, watertightness, body count, and triangle count; `--name
<part>` limits it to one part. `gpio-3d preview` renders shaded PNGs
(`.gpio-3d/preview/<part>.png`) so you can eyeball organic shapes between
builds — pick a part with `--name`, aim with `--turn`/`--elev`, resize with
`--size`:

```sh
gpio-3d inspect /home/agent/workspace/model
gpio-3d inspect /home/agent/workspace/model --name miko
gpio-3d preview /home/agent/workspace/model --name miko --turn 35
```

For deeper analysis the bundled venv at `/opt/gpio-3d/venv/bin/python` has
trimesh and numpy importable — system `python3` does not. Note `mesh.contains`
and `mesh.section` need scipy/rtree, which are not installed; parse the STL or
use `gpio-3d inspect` instead.
