import math
import sys

import numpy as np
import trimesh
from trimesh.transformations import euler_matrix

from gpio_3d.constants import (
    MAX_COLS,
    MAX_MM,
    MAX_OPS,
    MAX_PATTERN_COPIES,
    MAX_POINTS,
    MAX_ROWS,
    PITCH_MM,
    TEXT_FACES,
)
from gpio_3d.errors import Gpio3dError
from gpio_3d.text import check_value, check_valign, text_mesh, text_rings

SOLIDS = (
    "box",
    "cylinder",
    "header-bar",
    "sphere",
    "torus",
    "cone",
    "capsule",
    "revolve",
    "extrude",
    "loft",
)

FIELDS = {
    "box": {"size"},
    "cylinder": {"radius", "height", "axis"},
    "header-bar": {"cols", "rows", "thickness"},
    "sphere": {"radius"},
    "torus": {"radius", "tube"},
    "cone": {"radius", "height"},
    "capsule": {"radius", "height"},
    "revolve": {"profile", "angle"},
    "extrude": {"points", "holes", "height", "twist", "taper"},
    "loft": {"bottom", "top", "height"},
}

PLACED = {"at", "rotate", "scale"}


def op_error(label, kinds):
    return Gpio3dError(
        f"{label}.op must be one of {', '.join(sorted(kinds))}"
    )


def count(value, label, limit):
    if isinstance(value, bool):
        raise Gpio3dError(f"{label} must be an integer from 1 to {limit}")
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    if not isinstance(value, int) or value < 1 or value > limit:
        raise Gpio3dError(f"{label} must be an integer from 1 to {limit}")
    return value


def mm(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise Gpio3dError(f"{label} must be a number of millimeters")
    number = float(value)
    if not math.isfinite(number) or number <= 0 or number > MAX_MM:
        raise Gpio3dError(f"{label} must be between 0 and {MAX_MM:g} mm")
    return number


def zero_mm(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise Gpio3dError(f"{label} must be a number of millimeters")
    number = float(value)
    if not math.isfinite(number) or number < 0 or number > MAX_MM:
        raise Gpio3dError(f"{label} must be between 0 and {MAX_MM:g} mm")
    return number


def size3(value, label):
    if not isinstance(value, list) or len(value) != 3:
        raise Gpio3dError(f"{label} must be [x, y, z] millimeters")
    return (mm(value[0], f"{label}[0]"), mm(value[1], f"{label}[1]"), mm(value[2], f"{label}[2]"))


def center3(value, label):
    if value is None:
        return (0.0, 0.0, 0.0)
    if not isinstance(value, list) or len(value) != 3:
        raise Gpio3dError(f"{label} must be [x, y, z] millimeters")
    point = []
    for index, item in enumerate(value):
        if isinstance(item, bool) or not isinstance(item, (int, float)):
            raise Gpio3dError(f"{label}[{index}] must be a number")
        number = float(item)
        if not math.isfinite(number) or abs(number) > MAX_MM:
            raise Gpio3dError(f"{label}[{index}] is out of range")
        point.append(number)
    return (point[0], point[1], point[2])


def axis(value, label):
    if value not in {"x", "y", "z"}:
        raise Gpio3dError(f"{label} must be x, y, or z")
    return value


def rotate(value, label):
    if not isinstance(value, list) or len(value) != 3:
        raise Gpio3dError(f"{label} must be [degrees, degrees, degrees]")
    angles = []
    for index, item in enumerate(value):
        if isinstance(item, bool) or not isinstance(item, (int, float)):
            raise Gpio3dError(f"{label}[{index}] must be a number of degrees")
        number = float(item)
        if not math.isfinite(number) or abs(number) > 360:
            raise Gpio3dError(f"{label}[{index}] must be between -360 and 360 degrees")
        angles.append(number)
    if all(angle == 0.0 for angle in angles):
        return None
    return angles


def rotate_about_center(mesh, angles, label):
    if angles is None:
        return mesh
    matrix = euler_matrix(
        math.radians(angles[0]), math.radians(angles[1]), math.radians(angles[2]), "sxyz"
    )
    center = mesh.bounds.mean(axis=0)
    mesh.apply_translation(-center)
    mesh.apply_transform(matrix)
    mesh.apply_translation(center)
    return mesh


def scale3(value, label):
    if not isinstance(value, list) or len(value) != 3:
        raise Gpio3dError(f"{label} must be [x, y, z] scale factors")
    factors = []
    for index, item in enumerate(value):
        if isinstance(item, bool) or not isinstance(item, (int, float)):
            raise Gpio3dError(f"{label}[{index}] must be a number")
        number = float(item)
        if not math.isfinite(number) or number < 0.05 or number > 20:
            raise Gpio3dError(f"{label}[{index}] must be between 0.05 and 20")
        factors.append(number)
    if all(factor == 1.0 for factor in factors):
        return None
    return factors


def scale_about_center(mesh, factors, label):
    if factors is None:
        return mesh
    matrix = np.eye(4)
    matrix[0, 0], matrix[1, 1], matrix[2, 2] = factors
    center = mesh.bounds.mean(axis=0)
    mesh.apply_translation(-center)
    mesh.apply_transform(matrix)
    mesh.apply_translation(center)
    return mesh


def resample_ring(points, count):
    pts = np.asarray(points, dtype=np.float64)
    if np.array_equal(pts[0], pts[-1]):
        pts = pts[:-1]
    if len(pts) < 3:
        raise Gpio3dError("ring needs at least 3 distinct points")
    segments = np.linalg.norm(np.roll(pts, -1, axis=0) - pts, axis=1)
    total = float(segments.sum())
    if total <= 0:
        raise Gpio3dError("ring has no length")
    cumulative = np.concatenate([[0.0], np.cumsum(segments)])
    targets = np.linspace(0.0, total, count, endpoint=False)
    xs = pts[:, 0]
    ys = pts[:, 1]
    x = np.interp(targets, cumulative, np.concatenate([xs, [xs[0]]]))
    y = np.interp(targets, cumulative, np.concatenate([ys, [ys[0]]]))
    return list(zip(x.tolist(), y.tolist()))


def ring_winding(points):
    doubled = points + [points[0]]
    area = 0.0
    for (x0, y0), (x1, y1) in zip(doubled, doubled[1:]):
        area += x0 * y1 - x1 * y0
    return area


def to_manifold(mesh, label):
    import manifold3d

    solid = manifold3d.Mesh(
        np.ascontiguousarray(mesh.vertices, dtype=np.float32),
        np.ascontiguousarray(mesh.faces, dtype=np.uint32),
    )
    try:
        return manifold3d.Manifold(solid)
    except Exception as exc:
        raise Gpio3dError(f"{label} is not a valid solid") from exc


def from_manifold(manifold, label):
    raw = manifold.to_mesh()
    result = trimesh.Trimesh(
        vertices=np.asarray(raw.vert_properties)[:, :3],
        faces=np.asarray(raw.tri_verts),
        process=False,
    )
    return as_mesh(result, label)


def point2(value, label):
    if not isinstance(value, list) or len(value) != 2:
        raise Gpio3dError(f"{label} must be [x, y]")
    point = []
    for index, item in enumerate(value):
        if isinstance(item, bool) or not isinstance(item, (int, float)):
            raise Gpio3dError(f"{label}[{index}] must be a number")
        number = float(item)
        if not math.isfinite(number) or abs(number) > MAX_MM:
            raise Gpio3dError(f"{label}[{index}] is out of range")
        point.append(number)
    return (point[0], point[1])


def ring2(value, label):
    if not isinstance(value, list) or len(value) < 3 or len(value) > MAX_POINTS:
        raise Gpio3dError(f"{label} must list 3 to {MAX_POINTS} [x, y] points")
    points = []
    for index, item in enumerate(value):
        points.append(point2(item, f"{label}[{index}]"))
    return points


def header_size(cols, rows, thickness):
    return (cols * PITCH_MM, rows * PITCH_MM, thickness)


def box_from_min(size):
    mesh = trimesh.creation.box(extents=size)
    mesh.apply_translation((size[0] / 2, size[1] / 2, size[2] / 2))
    return mesh


def cylinder_at(radius, height, center):
    mesh = trimesh.creation.cylinder(radius=radius, height=height, sections=32)
    mesh.apply_translation(center)
    return mesh


def pin_centers(cols, rows):
    centers = []
    for row in range(rows):
        for col in range(cols):
            centers.append(((col + 0.5) * PITCH_MM, (row + 0.5) * PITCH_MM))
    return centers


def require_manifold():
    try:
        __import__("manifold3d")
    except ImportError as exc:
        raise Gpio3dError("manifold3d is not installed; Update companion") from exc


def as_mesh(result, label):
    if isinstance(result, list):
        if len(result) != 1:
            raise Gpio3dError(f"{label} did not produce one mesh")
        result = result[0]
    if not isinstance(result, trimesh.Trimesh) or len(result.faces) == 0:
        raise Gpio3dError(f"{label} did not produce one mesh")
    return result


def subtract(mesh, cuts, label):
    require_manifold()
    tool = cuts[0] if len(cuts) == 1 else trimesh.util.concatenate(cuts)
    try:
        result = trimesh.boolean.difference([mesh, tool], engine="manifold")
    except Exception as exc:
        raise Gpio3dError(f"{label} failed") from exc
    return as_mesh(result, label)


def unite(mesh, other, label):
    require_manifold()
    try:
        result = trimesh.boolean.union([mesh, other], engine="manifold")
    except Exception as exc:
        raise Gpio3dError(f"{label} failed") from exc
    return as_mesh(result, label)


def intersect_with(mesh, solid, label):
    require_manifold()
    try:
        result = trimesh.boolean.intersection([mesh, solid], engine="manifold")
    except Exception as exc:
        raise Gpio3dError(f"{label} failed") from exc
    return as_mesh(result, label)


def clip_mesh(cols, rows, thickness):
    cols = count(cols, "cols", MAX_COLS)
    rows = count(rows, "rows", MAX_ROWS)
    thickness = mm(thickness, "thickness")
    return box_from_min(header_size(cols, rows, thickness))


def spacer_mesh(cols, rows, height, hole):
    cols = count(cols, "cols", MAX_COLS)
    rows = count(rows, "rows", MAX_ROWS)
    height = mm(height, "height")
    hole = mm(hole, "hole")
    if hole >= PITCH_MM:
        raise Gpio3dError(f"hole must be under {PITCH_MM:g} mm")
    plate = box_from_min(header_size(cols, rows, height))
    return punch(plate, cols, rows, hole, "spacer")


def shroud_mesh(cols, rows, height, wall):
    cols = count(cols, "cols", MAX_COLS)
    rows = count(rows, "rows", MAX_ROWS)
    height = mm(height, "height")
    wall = mm(wall, "wall")
    if height <= wall:
        raise Gpio3dError("height must be greater than wall")
    outer = box_from_min((cols * PITCH_MM + 2 * wall, rows * PITCH_MM + 2 * wall, height))
    inner = box_from_min((cols * PITCH_MM, rows * PITCH_MM, height))
    inner.apply_translation((wall, wall, wall))
    return subtract(outer, [inner], "shroud")


def punch(mesh, cols, rows, diameter, label):
    if diameter >= PITCH_MM:
        raise Gpio3dError(f"diameter must be under {PITCH_MM:g} mm")
    low = float(mesh.bounds[0][2])
    high = float(mesh.bounds[1][2])
    span = high - low + 0.4
    center_z = (low + high) / 2
    cuts = [
        cylinder_at(diameter / 2, span, (x, y, center_z))
        for x, y in pin_centers(cols, rows)
    ]
    return subtract(mesh, cuts, label)


def extrude_mesh(op, label):
    from manifold3d import CrossSection, FillRule

    points = ring2(op.get("points"), f"{label}.points")
    contours = [points]
    holes = op.get("holes", [])
    if not isinstance(holes, list):
        raise Gpio3dError(f"{label}.holes must list hole rings")
    if len(holes) > 20:
        raise Gpio3dError(f"{label}.holes must list at most 20 hole rings")
    for index, hole in enumerate(holes):
        contours.append(ring2(hole, f"{label}.holes[{index}]"))
    height = mm(op.get("height"), f"{label}.height")
    twist = 0.0
    if "twist" in op:
        twist = float_check(op.get("twist"), f"{label}.twist")
        if abs(twist) > 360:
            raise Gpio3dError(f"{label}.twist must be between -360 and 360 degrees")
    taper = 1.0
    if "taper" in op:
        if isinstance(op.get("taper"), bool) or not isinstance(op.get("taper"), (int, float)):
            raise Gpio3dError(f"{label}.taper must be a number")
        taper = float(op.get("taper"))
        if not math.isfinite(taper) or taper <= 0 or taper > 10:
            raise Gpio3dError(f"{label}.taper must be between 0 and 10")
    divisions = 0
    if twist != 0.0:
        divisions = int(min(64, max(8, abs(twist) / 2.5)))
    try:
        section = CrossSection(contours, fillrule=FillRule.EvenOdd)
        solid = section.extrude(height, n_divisions=divisions, twist_degrees=twist, scale_top=(taper, taper))
    except Exception as exc:
        raise Gpio3dError(f"{label} did not build a solid") from exc
    mesh = solid.to_mesh()
    result = trimesh.Trimesh(
        vertices=np.asarray(mesh.vert_properties)[:, :3],
        faces=np.asarray(mesh.tri_verts),
        process=False,
    )
    return as_mesh(result, label)


def float_check(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise Gpio3dError(f"{label} must be a number")
    number = float(value)
    if not math.isfinite(number):
        raise Gpio3dError(f"{label} must be a finite number")
    return number


def loft_mesh(op, label):
    from manifold3d import CrossSection, FillRule, Manifold

    bottom = resample_ring(ring2(op.get("bottom"), f"{label}.bottom"), 96)
    top = resample_ring(ring2(op.get("top"), f"{label}.top"), 96)
    height = mm(op.get("height"), f"{label}.height")
    if ring_winding(top) * ring_winding(bottom) < 0:
        top = top[::-1]
    slab = max(0.4, min(1.0, height / 24))
    layers = min(40, max(2, int(math.ceil(height / slab)) + 1))
    slabs = []
    for index in range(layers):
        t = index / (layers - 1)
        ring = np.asarray(bottom) + (np.asarray(top) - np.asarray(bottom)) * t
        section = CrossSection([ring], fillrule=FillRule.EvenOdd)
        slabs.append(section.extrude(slab).translate((0.0, 0.0, t * height - slab / 2)))
    try:
        result = Manifold.batch_hull(slabs)
    except Exception as exc:
        raise Gpio3dError(f"{label} did not loft") from exc
    return from_manifold(result, label)


def revolve_mesh(op, label):
    profile = op.get("profile")
    if not isinstance(profile, list) or len(profile) < 3 or len(profile) > MAX_POINTS:
        raise Gpio3dError(f"{label}.profile must list 3 to {MAX_POINTS} [radius, height] points")
    line = []
    for index, item in enumerate(profile):
        if not isinstance(item, list) or len(item) != 2:
            raise Gpio3dError(f"{label}.profile[{index}] must be [radius, height]")
        radius = zero_mm(item[0], f"{label}.profile[{index}].radius")
        height = zero_mm(item[1], f"{label}.profile[{index}].height")
        line.append((radius, height))
    angle = None
    if "angle" in op:
        angle = float_check(op.get("angle"), f"{label}.angle")
        if angle <= 0 or angle > 360:
            raise Gpio3dError(f"{label}.angle must be between 0 and 360 degrees")
    try:
        mesh = as_mesh(trimesh.creation.revolve(line, sections=64), label)
    except Exception as exc:
        raise Gpio3dError(f"{label} did not build a solid") from exc
    if mesh.volume <= 0:
        raise Gpio3dError(f"{label} did not build a solid")
    if angle is not None and angle < 360:
        radius = max(point[0] for point in line)
        low = float(mesh.bounds[0][2])
        high = float(mesh.bounds[1][2])
        span = high - low + 0.4
        edge = radius + 1.0
        arc = [(0.0, 0.0)]
        steps = max(8, int((360 - angle) / 5) + 1)
        for step in range(steps + 1):
            theta = math.radians(angle + (360 - angle) * step / steps)
            arc.append((edge * math.cos(theta), edge * math.sin(theta)))
        arc.append((0.0, 0.0))
        try:
            from manifold3d import CrossSection, FillRule

            section = CrossSection([arc], fillrule=FillRule.EvenOdd)
            tool = section.extrude(span).to_mesh()
            wedge = trimesh.Trimesh(
                vertices=np.asarray(tool.vert_properties)[:, :3],
                faces=np.asarray(tool.tri_verts),
                process=False,
            )
            wedge.apply_translation((0.0, 0.0, low - 0.2))
            mesh = subtract(mesh, [wedge], label)
        except Exception as exc:
            raise Gpio3dError(f"{label} did not build a solid") from exc
    return mesh


def shape_solid(shape, op, label):
    if shape == "box":
        size = size3(op.get("size"), f"{label}.size")
        solid = box_from_min(size)
        if "at" in op:
            move_center(solid, center3(op.get("at"), f"{label}.at"))
    elif shape == "cylinder":
        radius = mm(op.get("radius"), f"{label}.radius")
        height = mm(op.get("height"), f"{label}.height")
        solid = trimesh.creation.cylinder(radius=radius, height=height, sections=32)
        axis_name = op.get("axis")
        if axis_name is not None:
            axis(axis_name, f"{label}.axis")
            quarter = euler_matrix(
                math.radians(90) if axis_name == "y" else 0.0,
                math.radians(90) if axis_name == "x" else 0.0,
                0.0,
                "sxyz",
            )
            solid.apply_transform(quarter)
        if "at" in op:
            move_center(solid, center3(op.get("at"), f"{label}.at"))
        else:
            solid.apply_translation((0.0, 0.0, height / 2))
    elif shape == "header-bar":
        solid = clip_mesh(op.get("cols"), op.get("rows"), op.get("thickness"))
    elif shape == "sphere":
        radius = mm(op.get("radius"), f"{label}.radius")
        solid = trimesh.creation.uv_sphere(radius=radius, count=(32, 16))
        if "at" in op:
            move_center(solid, center3(op.get("at"), f"{label}.at"))
    elif shape == "torus":
        radius = mm(op.get("radius"), f"{label}.radius")
        tube = mm(op.get("tube"), f"{label}.tube")
        if tube >= radius:
            raise Gpio3dError(f"{label}.tube must be under {label}.radius")
        solid = trimesh.creation.torus(major_radius=radius, minor_radius=tube)
        if "at" in op:
            move_center(solid, center3(op.get("at"), f"{label}.at"))
    elif shape == "cone":
        radius = mm(op.get("radius"), f"{label}.radius")
        height = mm(op.get("height"), f"{label}.height")
        solid = trimesh.creation.cone(radius=radius, height=height, sections=32)
        if "at" in op:
            move_center(solid, center3(op.get("at"), f"{label}.at"))
    elif shape == "capsule":
        radius = mm(op.get("radius"), f"{label}.radius")
        height = mm(op.get("height"), f"{label}.height")
        straight = height - 2 * radius
        if straight < 0:
            raise Gpio3dError(f"{label}.height must be at least twice {label}.radius")
        if straight == 0:
            solid = trimesh.creation.uv_sphere(radius=radius, count=(32, 16))
        else:
            solid = trimesh.creation.capsule(height=straight, radius=radius, count=(32, 16))
        if "at" in op:
            move_center(solid, center3(op.get("at"), f"{label}.at"))
        else:
            solid.apply_translation((0.0, 0.0, height / 2))
    elif shape == "revolve":
        solid = revolve_mesh(op, label)
        if "at" in op:
            move_center(solid, center3(op.get("at"), f"{label}.at"))
    elif shape == "extrude":
        solid = extrude_mesh(op, label)
        if "at" in op:
            move_center(solid, center3(op.get("at"), f"{label}.at"))
    elif shape == "loft":
        solid = loft_mesh(op, label)
        if "at" in op:
            move_center(solid, center3(op.get("at"), f"{label}.at"))
    else:
        raise Gpio3dError(f"{label} must be one of {', '.join(SOLIDS)}")
    if "scale" in op:
        scale_about_center(solid, scale3(op.get("scale"), f"{label}.scale"), label)
    if "rotate" in op:
        rotate_about_center(solid, rotate(op.get("rotate"), f"{label}.rotate"), label)
    return solid


def reject(op, allowed, label):
    for key in op:
        if key not in allowed:
            raise Gpio3dError(f"{label} has unknown field {key}")


FACE_AXES = {
    "top": ((1, 0, 0), (0, 1, 0), (0, 0, 1)),
    "bottom": ((1, 0, 0), (0, -1, 0), (0, 0, -1)),
    "front": ((1, 0, 0), (0, 0, 1), (0, -1, 0)),
    "back": ((-1, 0, 0), (0, 0, 1), (0, 1, 0)),
    "left": ((0, -1, 0), (0, 0, 1), (-1, 0, 0)),
    "right": ((0, 1, 0), (0, 0, 1), (1, 0, 0)),
}


def face_matrix(face):
    x_axis, y_axis, normal = FACE_AXES[face]
    matrix = np.eye(4)
    matrix[:3, 0] = x_axis
    matrix[:3, 1] = y_axis
    matrix[:3, 2] = normal
    return matrix


def count_bodies(mesh):
    parent = list(range(len(mesh.faces)))

    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    seen = {}
    for index, face in enumerate(mesh.faces):
        for a, b in ((face[0], face[1]), (face[1], face[2]), (face[2], face[0])):
            key = (a, b) if a < b else (b, a)
            if key in seen:
                parent[find(index)] = find(seen[key])
            else:
                seen[key] = index
    return len({find(index) for index in range(len(mesh.faces))})


def move_center(mesh, at):
    center = mesh.bounds.mean(axis=0)
    mesh.apply_translation((at[0] - center[0], at[1] - center[1], at[2] - center[2]))


def reflect(mesh, axis_name):
    matrix = np.eye(4)
    index = {"x": 0, "y": 1, "z": 2}[axis_name]
    matrix[index, index] = -1.0
    mesh.apply_transform(matrix)
    return mesh


def count_ops(ops):
    total = 0
    for op in ops:
        total += 1
        if isinstance(op, dict) and op.get("op") in {"pattern", "mirror", "hull"}:
            nested = op.get("ops")
            if isinstance(nested, list):
                total += count_ops(nested)
    return total


def group_solid(nested, label):
    if not isinstance(nested, list) or len(nested) == 0:
        raise Gpio3dError(f"{label}.ops must list at least one solid op")
    group = None
    for index, sub in enumerate(nested):
        if not isinstance(sub, dict) or sub.get("op") not in SOLIDS:
            raise Gpio3dError(
                f"{label}.ops[{index}].op must be one of {', '.join(SOLIDS)}"
            )
        solid = shape_solid(sub["op"], sub, f"{label}.ops[{index}]")
        group = solid if group is None else unite(group, solid, f"{label}.ops[{index}]")
    return group


def compose(mesh, op, label):
    kind = op["op"]
    if kind == "pattern":
        reject(op, {"op", "ops", "mode", "count", "step", "axis", "around", "degrees"}, label)
    else:
        reject(op, {"op", "ops", "mode", "axis"}, label)
    mode = op.get("mode", "add")
    if mode not in {"add", "cut"}:
        raise Gpio3dError(f"{label}.mode must be add or cut")
    group = group_solid(op.get("ops"), label)
    copies = [group]
    if kind == "mirror":
        axis_name = axis(op.get("axis"), f"{label}.axis")
        copies.append(reflect(group.copy(), axis_name))
    else:
        polar = "around" in op or "degrees" in op
        linear = "axis" in op or "step" in op
        if polar and linear:
            raise Gpio3dError(f"{label} needs either step and axis, or around and degrees")
        if not polar and not linear:
            raise Gpio3dError(f"{label} needs step and axis, or around and degrees")
        copies_count = count(op.get("count"), f"{label}.count", MAX_PATTERN_COPIES)
        if copies_count < 2:
            raise Gpio3dError(f"{label}.count must be from 2 to {MAX_PATTERN_COPIES}")
        if polar:
            center = point2(op.get("around"), f"{label}.around")
            step = float_check(op.get("degrees"), f"{label}.degrees")
            if step == 0:
                raise Gpio3dError(f"{label}.degrees must not be zero")
            spin = euler_matrix(0.0, 0.0, math.radians(step))
            pre = trimesh.transformations.translation_matrix((center[0], center[1], 0.0))
            post = trimesh.transformations.translation_matrix((-center[0], -center[1], 0.0))
            turn = pre @ spin @ post
        else:
            axis_name = axis(op.get("axis"), f"{label}.axis")
            step = float_check(op.get("step"), f"{label}.step")
            if step == 0:
                raise Gpio3dError(f"{label}.step must not be zero")
            if abs(step) > MAX_MM:
                raise Gpio3dError(f"{label}.step must be between -{MAX_MM:g} and {MAX_MM:g} mm")
            turn = None
        for index in range(1, copies_count):
            copy = group.copy()
            if polar:
                copy.apply_transform(np.linalg.matrix_power(np.asarray(turn), index))
            else:
                offset = [0.0, 0.0, 0.0]
                offset[{"x": 0, "y": 1, "z": 2}[axis_name]] = step * index
                copy.apply_translation(offset)
            copies.append(copy)
    tool = copies[0] if len(copies) == 1 else trimesh.util.concatenate(copies)
    if mode == "cut":
        if mesh is None:
            raise Gpio3dError(f"{label} needs a mesh first")
        return subtract(mesh, [tool], label)
    return tool if mesh is None else unite(mesh, tool, label)


def hull_with(mesh, op, label):
    reject(op, {"op", "ops"}, label)
    group = group_solid(op.get("ops"), label)
    parts = []
    if mesh is not None:
        parts.append(to_manifold(mesh, label))
    parts.append(to_manifold(group, label))
    try:
        import manifold3d

        return from_manifold(manifold3d.Manifold.batch_hull(parts), label)
    except Exception as exc:
        raise Gpio3dError(f"{label} failed") from exc


def text_op(mesh, op, label):
    reject(op, {"op", "value", "size", "depth", "mode", "align", "valign", "face", "bold", "at", "rotate"}, label)
    mode = op.get("mode", "engrave")
    if mode not in {"engrave", "emboss"}:
        raise Gpio3dError(f"{label}.mode must be engrave or emboss")
    align = op.get("align", "center")
    if align not in {"left", "center", "right"}:
        raise Gpio3dError(f"{label}.align must be left, center, or right")
    valign = check_valign(op.get("valign"))
    face = op.get("face", "top")
    if face not in TEXT_FACES:
        raise Gpio3dError(f"{label}.face must be one of {', '.join(TEXT_FACES)}")
    bold = op.get("bold", False)
    if not isinstance(bold, bool):
        raise Gpio3dError(f"{label}.bold must be true or false")
    if "at" not in op:
        raise Gpio3dError(f"{label} needs at")
    value = check_value(op.get("value"))
    spec = {
        "text": value,
        "size": mm(op.get("size"), f"{label}.size"),
        "align": align,
        "valign": valign,
        "bold": bold,
    }
    depth = mm(op.get("depth"), f"{label}.depth")
    solid = text_mesh(text_rings(spec), depth)
    at = center3(op.get("at"), f"{label}.at")
    if mode == "engrave":
        solid.apply_translation((0.0, 0.0, -depth))
    solid.apply_transform(face_matrix(face))
    solid.apply_translation(at)
    if "rotate" in op:
        rotate_about_center(solid, rotate(op.get("rotate"), f"{label}.rotate"), label)
    if mode == "emboss":
        return solid if mesh is None else unite(mesh, solid, label)
    if mesh is None:
        raise Gpio3dError(f"{label} needs a mesh first")
    before = mesh.volume
    result = subtract(mesh, [solid], label)
    removed = before - result.volume
    glyph = solid.volume
    if removed <= max(1e-3, before * 1e-6):
        print(
            f"gpio-3d: warning: {label} engraved {removed:.3f} mm3 of {glyph:.3f} mm3 text; it missed the part entirely",
            file=sys.stderr,
        )
    elif glyph > 0 and removed < 0.5 * glyph:
        print(
            f"gpio-3d: warning: {label} engraved only {100.0 * removed / glyph:.0f}% of the text volume; the text may hang off the face",
            file=sys.stderr,
        )
    return result


def apply_ops(ops):
    if count_ops(ops) > MAX_OPS:
        raise Gpio3dError(f"recipe has more than {MAX_OPS} ops")
    mesh = None
    for index, op in enumerate(ops):
        kind = op.get("op") if isinstance(op, dict) else None
        default_mode = "engrave" if kind == "text" else "add"
        mode = op.get("mode", default_mode) if isinstance(op, dict) else "add"
        before = mesh.volume if mesh is not None else None
        before_bodies = count_bodies(mesh) if mesh is not None else 0
        removing = (
            kind in {"cut", "hole-grid", "intersect"}
            or (kind in {"pattern", "mirror"} and mode == "cut")
            or (kind == "text" and mode == "engrave")
        )
        mesh = apply_op(mesh, op, index)
        if mesh is None or before is None:
            continue
        after = mesh.volume
        delta = before - after
        epsilon = max(1e-3, before * 1e-6)
        if removing and delta <= epsilon:
            print(
                f"gpio-3d: warning: ops[{index}] {kind} removed {max(delta, 0.0):.3f} mm3; it may have missed the solid",
                file=sys.stderr,
            )
        elif not removing and -delta <= epsilon:
            print(
                f"gpio-3d: warning: ops[{index}] {kind} added {max(-delta, 0.0):.3f} mm3; it may be inside the part",
                file=sys.stderr,
            )
        after_bodies = count_bodies(mesh)
        if removing and after_bodies > before_bodies:
            print(
                f"gpio-3d: warning: ops[{index}] {kind} left an enclosed void inside the part",
                file=sys.stderr,
            )
    if mesh is None:
        raise Gpio3dError("recipe needs a box, cylinder, header-bar, or another solid")
    if mesh.volume <= 0:
        raise Gpio3dError("recipe did not produce one solid")
    return mesh


def apply_op(mesh, op, index):
    kind = op.get("op")
    label = f"ops[{index}]"
    if kind in {"pattern", "mirror"}:
        return compose(mesh, op, label)
    if kind == "hull":
        return hull_with(mesh, op, label)
    if kind == "text":
        return text_op(mesh, op, label)
    if kind == "hole-grid":
        reject(op, {"op", "cols", "rows", "diameter"}, label)
        cols = count(op.get("cols"), f"{label}.cols", MAX_COLS)
        rows = count(op.get("rows"), f"{label}.rows", MAX_ROWS)
        diameter = mm(op.get("diameter"), f"{label}.diameter")
        return punch(mesh, cols, rows, diameter, label)
    if kind == "cut":
        return cut(mesh, op, label)
    if kind == "intersect":
        if mesh is None:
            raise Gpio3dError(f"{label} needs a mesh first")
        shape = op.get("shape")
        if shape not in SOLIDS:
            raise Gpio3dError(f"{label}.shape must be one of {', '.join(SOLIDS)}")
        reject(op, {"op", "shape"} | FIELDS[shape] | PLACED, label)
        return intersect_with(mesh, shape_solid(shape, op, label), label)
    if kind in SOLIDS:
        reject(op, {"op"} | FIELDS[kind] | PLACED, label)
        solid = shape_solid(kind, op, label)
        return solid if mesh is None else unite(mesh, solid, label)
    raise op_error(label, set(SOLIDS) | {"hole-grid", "cut", "intersect", "pattern", "mirror", "hull", "text"})


def cut(mesh, op, label):
    shape = op.get("shape")
    if shape not in SOLIDS:
        raise Gpio3dError(f"{label}.shape must be one of {', '.join(SOLIDS)}")
    reject(op, {"op", "shape"} | FIELDS[shape] | PLACED, label)
    solid = shape_solid(shape, op, label)
    return subtract(mesh, [solid], label)
