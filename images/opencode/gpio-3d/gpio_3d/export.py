import json
import re
from pathlib import Path

from gpio_3d.constants import COLOR, FITS, MANIFEST, NAME, TOOL, UNITS
from gpio_3d.errors import Gpio3dError


def part_name(value):
    if not isinstance(value, str) or not re.fullmatch(NAME, value) or len(value) > 80:
        raise Gpio3dError("name must be kebab-case")
    return value


def part_color(value):
    if value is None:
        return None
    if not isinstance(value, str) or not re.fullmatch(COLOR, value):
        raise Gpio3dError("color must be a #rrggbb hex color")
    return value.lower()


def part_fits(value):
    if not isinstance(value, list) or len(value) == 0:
        raise Gpio3dError(
            "fits must list custom, companion-header, and/or arduino-uno, arduino-nano, arduino-mega"
        )
    fits = []
    for item in value:
        if item not in FITS or item in fits:
            raise Gpio3dError(
                "fits must be custom, companion-header, arduino-uno, arduino-nano, or arduino-mega"
            )
        fits.append(item)
    return fits


def model_dir(value):
    directory = Path(value)
    if not directory.parent.is_dir():
        raise Gpio3dError(f"missing {directory.parent}")
    directory.mkdir(exist_ok=True)
    if not directory.is_dir():
        raise Gpio3dError(f"{directory} is not a directory")
    return directory


def tint(mesh, color):
    if not color:
        return mesh
    red = int(color[1:3], 16)
    green = int(color[3:5], 16)
    blue = int(color[5:7], 16)
    mesh.visual.vertex_colors = [red, green, blue, 255]
    return mesh


def write_part(mesh, name, fits, directory, color=None):
    name = part_name(name)
    fits = part_fits(fits)
    color = part_color(color)
    directory = model_dir(directory)
    if len(mesh.faces) == 0:
        raise Gpio3dError("mesh is empty")
    glb_name = f"{name}.glb"
    stl_name = f"{name}.stl"
    glb = tint(mesh, color).export(file_type="glb")
    stl = mesh.export(file_type="stl")
    if not isinstance(glb, bytes) or not glb.startswith(b"glTF") or b"mikedh/trimesh" not in glb:
        raise Gpio3dError("export did not write a trimesh glb")
    if color and b"COLOR_0" not in glb:
        raise Gpio3dError("export did not write the tint")
    if not isinstance(stl, bytes) or len(stl) < 84:
        raise Gpio3dError("export did not write an stl")
    (directory / glb_name).write_bytes(glb)
    (directory / stl_name).write_bytes(stl)
    upsert_manifest(directory, name, glb_name, fits, color)
    size = mesh.extents
    print(f"{name} {glb_name} {stl_name} bbox {size[0]:.1f}x{size[1]:.1f}x{size[2]:.2f}mm")


def upsert_manifest(directory, name, glb_name, fits, color=None):
    path = directory / MANIFEST
    manifest = load_manifest(path)
    entry = {"name": name, "file": glb_name, "units": UNITS, "fits": fits}
    if color:
        entry["color"] = color
    parts = manifest["parts"]
    replaced = False
    for index, part in enumerate(parts):
        if isinstance(part, dict) and part.get("name") == name:
            old = part.get("file")
            if isinstance(old, str) and old != glb_name:
                remove_old(directory, old, parts, index)
            parts[index] = entry
            replaced = True
            break
    if not replaced:
        for part in parts:
            if isinstance(part, dict) and part.get("file") == glb_name:
                raise Gpio3dError(f"duplicate part file {glb_name}")
        parts.append(entry)
    path.write_text(json.dumps(manifest, indent="\t") + "\n")


def load_manifest(path):
    if not path.exists():
        return {"version": 1, "units": UNITS, "tool": TOOL, "parts": []}
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise Gpio3dError("manifest.json is not valid JSON") from exc
    if (
        not isinstance(data, dict)
        or data.get("version") != 1
        or data.get("units") != UNITS
        or data.get("tool") != TOOL
        or not isinstance(data.get("parts"), list)
    ):
        raise Gpio3dError("manifest.json must be a trimesh mm manifest")
    return data


def remove_old(directory, file, parts, index):
    stem = file[:-4] if file.endswith(".glb") else None
    if stem is None or "/" in file or file.startswith("."):
        return
    used = False
    for other_index, part in enumerate(parts):
        if other_index != index and isinstance(part, dict) and part.get("file") == file:
            used = True
    if used:
        return
    for suffix in (".glb", ".stl"):
        target = directory / f"{stem}{suffix}"
        if target.is_file():
            target.unlink()


def load_part_mesh(directory, file):
    import trimesh

    path = Path(directory) / file
    if not path.is_file():
        raise Gpio3dError(f"missing {file}")
    try:
        mesh = trimesh.load(path, force="mesh", process=False)
    except Exception as exc:
        raise Gpio3dError(f"{file} did not load") from exc
    if not isinstance(mesh, trimesh.Trimesh) or len(mesh.faces) == 0:
        raise Gpio3dError(f"{file} is not one mesh")
    return mesh


def inspect_dir(directory, name=None):
    from gpio_3d.mesh import count_bodies

    directory = Path(directory)
    manifest = load_manifest(directory / MANIFEST)
    parts = manifest["parts"]
    if name:
        parts = [part for part in parts if part.get("name") == name]
        if not parts:
            raise Gpio3dError(f"no part named {name}")
    print(f"{directory} {len(parts)} parts")
    for part in parts:
        mesh = load_part_mesh(directory, part["file"])
        size = mesh.extents
        fits = ",".join(part.get("fits", []))
        watertight = "yes" if mesh.is_watertight else "no"
        print(
            f"{part['name']} {part['file']} fits {fits} bbox {size[0]:.1f}x{size[1]:.1f}x{size[2]:.2f}mm "
            f"volume {mesh.volume:.0f}mm3 watertight {watertight} bodies {count_bodies(mesh)} tris {len(mesh.faces)}"
        )


def hex_base(color):
    if not isinstance(color, str) or len(color) != 7 or not color.startswith("#"):
        return (236, 225, 210)
    try:
        return tuple(int(color[i:i + 2], 16) for i in (1, 3, 5))
    except ValueError:
        return (236, 225, 210)


def preview_dir(directory, name=None, out=None, size=520, elev=18.0, turn=0.0):
    from gpio_3d.render import render_png

    directory = Path(directory)
    manifest = load_manifest(directory / MANIFEST)
    parts = manifest["parts"]
    if name:
        parts = [part for part in parts if part.get("name") == name]
        if not parts:
            raise Gpio3dError(f"no part named {name}")
    preview_root = directory.parent / ".gpio-3d" / "preview"
    for part in parts:
        stl = Path(part["file"]).with_suffix(".stl")
        if not (directory / stl).is_file():
            raise Gpio3dError(f"missing {stl}")
        if out:
            target = Path(out)
            if len(parts) > 1:
                target = target.with_name(f"{target.stem}-{part['name']}{target.suffix or '.png'}")
        else:
            target = preview_root / f"{part['name']}.png"
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            render_png(directory / stl, target, size=size, elev=elev, turn=turn, base=hex_base(part.get("color")))
        except OSError as exc:
            raise Gpio3dError(
                f"preview could not write {target}; check who owns {target.parent} (was it created by root?)"
            ) from exc
        print(f"preview {part['name']} {target}")
