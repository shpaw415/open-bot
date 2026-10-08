import json
import re
import sys
from pathlib import Path

from gpio_3d.constants import LIBRARY_DIR, LAST_RECIPE, NAME, UNITS
from gpio_3d.errors import Gpio3dError
from gpio_3d.export import part_color, part_fits, part_name
from gpio_3d.mesh import apply_ops

ALLOWED = {"name", "fits", "units", "ops", "color"}


def library_dir(directory):
    return Path(directory).resolve().parent / LIBRARY_DIR


def library_path(directory, name):
    if not isinstance(name, str) or not re.fullmatch(NAME, name):
        raise Gpio3dError("recipe name must be kebab-case")
    return library_dir(directory) / f"{name}.json"


def read_raw(source, directory):
    if source == "-":
        return sys.stdin.read()
    if re.fullmatch(NAME, source or ""):
        library = library_dir(directory) / f"{source}.json"
        if library.is_file():
            return library.read_text()
    path = Path(source)
    if not path.is_file():
        raise Gpio3dError(f"missing recipe {source}")
    try:
        if path.resolve().is_relative_to(directory.resolve()):
            raise Gpio3dError("recipe must not be inside the model directory")
    except ValueError as exc:
        raise Gpio3dError("recipe path is not valid") from exc
    return path.read_text()


def library_source(source, directory):
    if not re.fullmatch(NAME, source or ""):
        return None
    if (library_dir(directory) / f"{source}.json").is_file():
        return source
    return None


def apply_patch(data, patch):
    if patch is None:
        return data
    if not isinstance(patch, dict):
        raise Gpio3dError("--patch must be a JSON object")
    merged = dict(data)
    for key, value in patch.items():
        if key not in ALLOWED:
            raise Gpio3dError(f"--patch has unknown field {key}")
        merged[key] = merge_patch_field(merged.get(key), value)
    return merged


def merge_patch_field(current, value):
    if key_is_index_map(value):
        if not isinstance(current, list) or len(current) == 0:
            raise Gpio3dError("--patch object needs an existing list")
        items = list(current)
        for index_key, changes in value.items():
            index = int(index_key)
            if index < 0 or index >= len(items):
                raise Gpio3dError(f"--patch index {index_key} is out of range")
            items[index] = merge_one(items[index], changes)
        return items
    return value


def merge_one(current, changes):
    if isinstance(current, dict) and isinstance(changes, dict):
        merged = dict(current)
        for key, value in changes.items():
            merged[key] = merge_patch_field(merged.get(key), value)
        return merged
    if isinstance(current, list) and key_is_index_map(changes):
        return merge_patch_field(current, changes)
    return changes


def key_is_index_map(value):
    if not isinstance(value, dict) or not value:
        return False
    return all(isinstance(key, str) and key.isdigit() for key in value)


def parse_recipe(raw, patch=None):
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise Gpio3dError("recipe is not valid JSON") from exc
    if not isinstance(data, dict):
        raise Gpio3dError("recipe must be an object")
    data = apply_patch(data, patch)
    for key in data:
        if key not in ALLOWED:
            raise Gpio3dError(f"recipe has unknown field {key}")
    if data.get("units") != UNITS:
        raise Gpio3dError("recipe units must be mm")
    data["name"] = part_name(data.get("name"))
    data["fits"] = part_fits(data.get("fits"))
    data["color"] = part_color(data.get("color"))
    ops = data.get("ops")
    if not isinstance(ops, list) or len(ops) == 0:
        raise Gpio3dError("recipe needs ops")
    parsed = []
    for index, op in enumerate(ops):
        if not isinstance(op, dict) or not isinstance(op.get("op"), str):
            raise Gpio3dError(f"ops[{index}] must be an object with op")
        parsed.append(op)
    return data, apply_ops(parsed)


def load_recipe(source, directory, patch=None):
    data, mesh = parse_recipe(read_raw(source, directory), patch)
    return data["name"], data["fits"], data["color"], mesh


def save_recipe(directory, data, name=None):
    stored = {key: value for key, value in data.items() if key in ALLOWED and value is not None}
    target = library_path(directory, LAST_RECIPE)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(stored, indent="\t") + "\n")
    if name:
        target = library_path(directory, name)
        target.write_text(json.dumps(stored, indent="\t") + "\n")
    return target
