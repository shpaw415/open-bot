import math
import struct
import zlib
from pathlib import Path

import numpy as np

from gpio_3d.errors import Gpio3dError


def load_stl(path):
    data = Path(path).read_bytes()
    if len(data) < 84:
        raise Gpio3dError(f"{Path(path).name} is not an stl")
    count = struct.unpack_from("<I", data, 80)[0]
    if len(data) < 84 + count * 50:
        raise Gpio3dError(f"{Path(path).name} is not an stl")
    raw = np.frombuffer(data, dtype=np.uint8, offset=84, count=count * 50).reshape(count, 50)
    tris = raw[:, :48].copy().view("<f4").reshape(count, 4, 3).astype(np.float64)
    return tris[:, 1], tris[:, 2], tris[:, 3]


def render_png(stl_path, out_path, size=520, elev=18.0, turn=0.0, base=(236, 225, 210)):
    v1, v2, v3 = load_stl(stl_path)
    allv = np.concatenate([v1, v2, v3])
    lo, hi = allv.min(axis=0), allv.max(axis=0)
    er, ar = math.radians(elev), math.radians(turn)
    fwd = np.array([
        math.sin(ar) * math.cos(er),
        -math.cos(ar) * math.cos(er),
        -math.sin(er),
    ])
    up0 = np.array([0.0, 0.0, 1.0])
    right = np.cross(fwd, up0)
    right = right / np.linalg.norm(right)
    up = np.cross(right, fwd)

    def project(points):
        rel = points - (lo + hi) / 2
        return rel @ right, rel @ up, rel @ fwd

    sx, sy, _ = project(allv)
    span = max(sx.max() - sx.min(), sy.max() - sy.min()) * 1.12
    scale = size / span
    cx = (sx.min() + sx.max()) / 2
    cy = (sy.min() + sy.max()) / 2

    img = np.full((size, size, 3), 245, dtype=np.float64)
    zbuf = np.full((size, size), -1e9)
    normal = np.cross(v2 - v1, v3 - v1)
    length = np.linalg.norm(normal, axis=1, keepdims=True)
    length[length == 0] = 1
    normal = normal / length
    light = np.array([-0.3, -0.8, 0.55])
    light = light / np.linalg.norm(light)
    shade = np.clip(normal @ light, 0.0, 1.0) * 0.75 + 0.25
    base_rgb = np.array(base, dtype=np.float64)

    for i in range(len(v1)):
        xs3, ys3, zs3 = project(np.stack([v1[i], v2[i], v3[i]]))
        xs = xs3 * scale + size / 2
        ys = size / 2 - ys3 * scale
        x0 = int(max(0, math.floor(xs.min())))
        x1 = int(min(size - 1, math.ceil(xs.max())))
        y0 = int(max(0, math.floor(ys.min())))
        y1 = int(min(size - 1, math.ceil(ys.max())))
        if x1 < x0 or y1 < y0:
            continue
        det = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2])
        if abs(det) < 1e-9:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        l1 = ((ys[1] - ys[2]) * (gx - xs[2]) + (xs[2] - xs[1]) * (gy - ys[2])) / det
        l2 = ((ys[2] - ys[0]) * (gx - xs[2]) + (xs[0] - xs[2]) * (gy - ys[2])) / det
        l3 = 1 - l1 - l2
        mask = (l1 >= 0) & (l2 >= 0) & (l3 >= 0)
        if not mask.any():
            continue
        depth = l1 * zs3[0] + l2 * zs3[1] + l3 * zs3[2]
        sub = zbuf[y0:y1 + 1, x0:x1 + 1]
        upd = mask & (depth > sub)
        if not upd.any():
            continue
        sub[upd] = depth[upd]
        img[y0:y1 + 1, x0:x1 + 1][upd] = base_rgb * shade[i]

    rgb = img.astype(np.uint8)
    payload = b"".join(b"\x00" + rgb[y].tobytes() for y in range(size))

    def chunk(tag, body):
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body))

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(payload, 6))
        + chunk(b"IEND", b"")
    )
    Path(out_path).write_bytes(png)
