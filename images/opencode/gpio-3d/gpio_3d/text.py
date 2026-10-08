import math
from pathlib import Path

from gpio_3d.constants import MAX_TEXT_CHARS
from gpio_3d.errors import Gpio3dError

ASSETS = Path(__file__).resolve().parent.parent / "assets" / "fonts"
FONTS = {"regular": "DejaVuSans.ttf", "bold": "DejaVuSans-Bold.ttf"}
STEPS = 16
_cache = {}


def _font(bold):
    try:
        from fontTools.ttLib import TTFont
    except ImportError as exc:
        raise Gpio3dError("text needs fontTools; Update companion") from exc
    key = "bold" if bold else "regular"
    if key not in _cache:
        path = ASSETS / FONTS[key]
        if not path.is_file():
            raise Gpio3dError("bundled font is missing; Update companion")
        try:
            _cache[key] = TTFont(str(path), lazy=True)
        except Exception as exc:
            raise Gpio3dError("bundled font did not load") from exc
    return _cache[key]


def _cap_height(font, glyphset):
    cap = getattr(font.get("OS/2"), "sCapHeight", 0) if "OS/2" in font else 0
    if cap and cap > 0:
        return float(cap)
    from fontTools.pens.boundsPen import BoundsPen

    pen = BoundsPen(glyphset)
    glyphset["H"].draw(pen)
    if pen.bounds is None:
        raise Gpio3dError("bundled font has no cap height")
    return float(pen.bounds[3])


def _sample_quad(p0, control, point, steps):
    out = []
    for step in range(1, steps + 1):
        t = step / steps
        u = 1.0 - t
        x = u * u * p0[0] + 2 * u * t * control[0] + t * t * point[0]
        y = u * u * p0[1] + 2 * u * t * control[1] + t * t * point[1]
        out.append((x, y))
    return out


def _sample_cubic(p0, c1, c2, point, steps):
    out = []
    for step in range(1, steps + 1):
        t = step / steps
        u = 1.0 - t
        x = u**3 * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t**3 * point[0]
        y = u**3 * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t**3 * point[1]
        out.append((x, y))
    return out


def _contours(pen_value, steps=STEPS):
    contours = []
    points = []
    for op, args in pen_value:
        if op == "moveTo":
            points = [tuple(args[0])]
        elif op == "lineTo":
            if points:
                points.append(tuple(args[0]))
        elif op == "qCurveTo":
            if not points:
                continue
            seq = list(args)
            if seq and seq[-1] is None:
                offs = [p for p in seq if p is not None]
                if len(offs) < 2:
                    continue
                seq = offs + [((offs[-1][0] + offs[0][0]) / 2, (offs[-1][1] + offs[0][1]) / 2)]
            on = seq[-1]
            offs = seq[:-1]
            current = points[-1]
            if not offs:
                points.append(tuple(on))
            else:
                for index, off in enumerate(offs):
                    if index < len(offs) - 1:
                        nxt = ((off[0] + offs[index + 1][0]) / 2, (off[1] + offs[index + 1][1]) / 2)
                    else:
                        nxt = on
                    points.extend(_sample_quad(current, off, nxt, steps))
                    current = nxt
        elif op == "curveTo":
            if not points:
                continue
            c1, c2, on = args
            points.extend(_sample_cubic(points[-1], c1, c2, on, steps))
        elif op in {"closePath", "endPath"}:
            if len(points) >= 3:
                if points[0] != points[-1]:
                    points.append(points[0])
                contours.append(points)
            points = []
    return contours


def _glyph(value, bold):
    font = _font(bold)
    cmap = font.getBestCmap()
    glyphset = font.getGlyphSet()
    cap = _cap_height(font, glyphset)
    hmtx = font["hmtx"]
    scale = value["size"] / cap
    contours = []
    min_x = min_y = math.inf
    max_x = max_y = -math.inf
    pen_x = 0.0
    for char in value["text"]:
        name = cmap.get(ord(char))
        if name is None:
            raise Gpio3dError(f"text has unsupported character {char!r}")
        from fontTools.pens.recordingPen import DecomposingRecordingPen

        pen = DecomposingRecordingPen(glyphset)
        glyphset[name].draw(pen)
        fresh = _contours(pen.value)
        for contour in fresh:
            mm = []
            for x, y in contour:
                px = x * scale + pen_x
                py = y * scale
                mm.append((px, py))
                if px < min_x:
                    min_x = px
                if px > max_x:
                    max_x = px
                if py < min_y:
                    min_y = py
                if py > max_y:
                    max_y = py
            contours.append(mm)
        pen_x += hmtx[name][0] * scale
    if not contours:
        raise Gpio3dError("text produced no glyphs")
    shift_x = {"left": -min_x, "center": -(min_x + max_x) / 2, "right": -max_x}[value["align"]]
    shift_y = {"center": -(min_y + max_y) / 2, "baseline": 0.0, "top": -max_y}[value["valign"]]
    shifted = []
    for contour in contours:
        moved = []
        for x, y in contour:
            px = x + shift_x
            py = y + shift_y
            if not moved or abs(px - moved[-1][0]) > 1e-6 or abs(py - moved[-1][1]) > 1e-6:
                moved.append((px, py))
        if len(moved) >= 3:
            if abs(moved[0][0] - moved[-1][0]) <= 1e-6 and abs(moved[0][1] - moved[-1][1]) <= 1e-6:
                moved.pop()
            moved.append(moved[0])
            shifted.append(moved)
    return shifted


def text_rings(value):
    return _glyph(value, value.get("bold", False))


def text_mesh(rings, depth):
    import numpy as np
    import trimesh
    from manifold3d import CrossSection, FillRule

    try:
        section = CrossSection(rings, fillrule=FillRule.EvenOdd)
        solid = section.extrude(depth)
    except Exception as exc:
        raise Gpio3dError("text did not build a solid") from exc
    mesh = solid.to_mesh()
    result = trimesh.Trimesh(
        vertices=np.asarray(mesh.vert_properties)[:, :3],
        faces=np.asarray(mesh.tri_verts),
        process=False,
    )
    if len(result.faces) == 0 or not result.is_watertight or result.volume <= 0:
        raise Gpio3dError("text did not produce one mesh")
    return result


def check_value(value):
    if not isinstance(value, str) or len(value) == 0 or len(value) > MAX_TEXT_CHARS:
        raise Gpio3dError(f"text must be 1 to {MAX_TEXT_CHARS} characters")
    for char in value:
        if ord(char) < 32 or ord(char) == 127:
            raise Gpio3dError("text must not have control characters")
    return value


def check_valign(valign):
    from gpio_3d.constants import TEXT_VALIGNS

    if valign is None:
        return "center"
    if valign not in TEXT_VALIGNS:
        raise Gpio3dError(f"text valign must be one of {', '.join(TEXT_VALIGNS)}")
    return valign
