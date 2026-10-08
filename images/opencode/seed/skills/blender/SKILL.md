---
name: blender
description: Local 3D modeling with Blender on this desktop. Use when the user asks for a real 3D model, a product visual, a printable part, materials or lighting beyond procedural gpio-3d parts, or any Blender scene work. Covers the blender-team worker pipeline (the only path that has the blender MCP tools) and quick headless bpy one-offs.
---

# Blender on this desktop

A headless Blender runs on 127.0.0.1:9876 with the blender-mcp addon socket
server. You (the chat agent) do NOT have the blender MCP tools — only
`blender-team` workers do. Never launch a second Blender instance and never
open the scene file in another instance: the live scene exists only in the
running process.

## Team pipeline (default path)

```sh
blender-team "a ceramic owl figurine, 80mm tall, printable" -o /home/agent/workspace/owl.glb
```

- The orchestrator runs role workers in order: `model` → `materials` →
  `lighting` → `qa`, each an opencode session driving the live scene through
  the blender MCP tools (`get_scene_info`, `execute_code`, …). QA renders a
  preview and exports the model; on `RESULT: FAIL` it spawns fix rounds
  (`--rounds`, default 1).
- `--roles model,materials,qa` picks a shorter pipeline. `--timeout 20` sets
  the per-worker minute budget (default 15). `--out path.glb` (or `.stl`)
  sets the export target.
- Each worker saves the scene to a `blender-team-<ts>/scene.blend` under the
  workspace and renders `preview-<role>.png` there. Read those PNGs to review
  a stage.
- The CLI prints one `[blender-team]` line per stage. Surface the final model
  path and previews; do not paste the log.
- A scene lock serializes runs. If it says another run holds the lock, wait.
  Do not drive Blender yourself while a team runs.

## Quick headless one-offs (no MCP needed)

For a small deterministic edit (unit conversion, export, mesh stats), skip
the team and run bpy directly:

```sh
blender --background /home/agent/workspace/model.glb --python-expr "import bpy; print(len(bpy.data.objects))"
blender --background --python /tmp/script.py
```

Prefer `blender-team` when the goal needs modeling judgment, materials,
lighting, or iteration.

## Deliverables

- Save exports and previews under `/home/agent/workspace`.
- Embed the final model: `![description](/home/agent/workspace/name.glb)` —
  the chat renders an interactive 3D viewer for `.glb`/`.gltf`. Embed
  `preview-qa.png` as an image when it shows the result well.
- For AI-generated meshes from a provider (Meshy, Tripo, …) use `gen-3d`
  instead; Blender is for local, controllable, printable work.

## Troubleshooting

- `Blender is not reachable on 127.0.0.1:9876` — check
  `~/.open-bot/blender.log`; the supervisor restarts crashed instances in a
  few seconds, so retry once after a pause.
- `the blender MCP is disabled` — the feature is toggled off on the config
  page; tell the user.
- `another blender-team run holds the scene lock` — wait, or remove
  `~/.open-bot/blender-team.lock` only if no run is actually going.
