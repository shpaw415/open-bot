#!/usr/bin/env python3
import os
import struct
import sys
import tempfile
import zlib
from pathlib import Path

FUZZ = 32
RING = 3
STRONG = 72
CLEAR = 16
SEARCH = 5


def fail(message):
    print(message, file=sys.stderr)
    raise SystemExit(1)


def paeth(left, up, ul):
    p = left + up - ul
    pa, pb, pc = abs(p - left), abs(p - up), abs(p - ul)
    if pa <= pb and pa <= pc:
        return left
    if pb <= pc:
        return up
    return ul


def decode_png(data):
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("not a png")
    pos = 8
    width = height = color_type = interlace = None
    idat = b""
    palette = b""
    trans = b""
    while pos + 8 <= len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        tag = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if tag == b"IHDR":
            width, height, bit_depth, color_type, _, _, interlace = struct.unpack(
                ">IIBBBBB", chunk
            )
            if bit_depth != 8 or interlace != 0:
                raise ValueError("unsupported png")
        elif tag == b"PLTE":
            palette = chunk
        elif tag == b"tRNS":
            trans = chunk
        elif tag == b"IDAT":
            idat += chunk
        elif tag == b"IEND":
            break
    if width is None or color_type not in (0, 2, 3, 4, 6):
        raise ValueError("unsupported png")
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color_type]
    raw = zlib.decompress(idat)
    stride = width * channels
    rows = []
    i = 0
    prev = bytearray(stride)
    for _y in range(height):
        filt = raw[i]
        i += 1
        row = bytearray(raw[i : i + stride])
        i += stride
        if filt == 1:
            for x in range(stride):
                left = row[x - channels] if x >= channels else 0
                row[x] = (row[x] + left) & 255
        elif filt == 2:
            for x in range(stride):
                row[x] = (row[x] + prev[x]) & 255
        elif filt == 3:
            for x in range(stride):
                left = row[x - channels] if x >= channels else 0
                row[x] = (row[x] + ((left + prev[x]) // 2)) & 255
        elif filt == 4:
            for x in range(stride):
                left = row[x - channels] if x >= channels else 0
                up = prev[x]
                ul = prev[x - channels] if x >= channels else 0
                row[x] = (row[x] + paeth(left, up, ul)) & 255
        elif filt != 0:
            raise ValueError(f"bad png filter {filt}")
        prev = row
        rows.append(row)
    pixels = bytearray()
    for row in rows:
        if color_type == 6:
            pixels.extend(row)
        elif color_type == 2:
            for x in range(width):
                pixels.extend(row[x * 3 : x * 3 + 3])
                pixels.append(255)
        elif color_type == 0:
            for x in range(width):
                v = row[x]
                pixels.extend((v, v, v, 255))
        elif color_type == 4:
            for x in range(width):
                v, a = row[x * 2], row[x * 2 + 1]
                pixels.extend((v, v, v, a))
        else:
            for x in range(width):
                idx = row[x]
                r, g, b = palette[idx * 3 : idx * 3 + 3]
                a = trans[idx] if idx < len(trans) else 255
                pixels.extend((r, g, b, a))
    return width, height, pixels


def decode_pillow(data):
    try:
        from io import BytesIO

        from PIL import Image
    except ImportError:
        fail("defringe needs python3-pil for this image format")
    im = Image.open(BytesIO(data)).convert("RGBA")
    w, h = im.size
    return w, h, bytearray(im.tobytes())


def read_image(path):
    data = Path(path).read_bytes()
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        try:
            return decode_png(data)
        except ValueError:
            return decode_pillow(data)
    return decode_pillow(data)


def write_png(path, w, h, rgba):
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)
        raw.extend(rgba[y * stride : (y + 1) * stride])

    def chunk(tag, body):
        return (
            struct.pack(">I", len(body))
            + tag
            + body
            + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    Path(path).write_bytes(png)


def chdist(r1, g1, b1, r2, g2, b2):
    return max(abs(r1 - r2), abs(g1 - g2), abs(b1 - b2))


def estimate_bg(px, w, h):
    samples = []
    for x, y in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        i = (y * w + x) * 4
        if px[i + 3] >= CLEAR:
            samples.append((px[i], px[i + 1], px[i + 2]))
    if not samples:
        return (255, 255, 255)

    def med(k):
        vals = sorted(sample[k] for sample in samples)
        return vals[len(vals) // 2]

    return (med(0), med(1), med(2))


def defringe_pixels(px, w, h):
    bg = estimate_bg(px, w, h)
    n = w * h
    bg_mask = bytearray(n)
    queue = []

    def push(x, y):
        if x < 0 or y < 0 or x >= w or y >= h:
            return
        idx = y * w + x
        if bg_mask[idx]:
            return
        i = idx * 4
        if px[i + 3] < CLEAR or chdist(px[i], px[i + 1], px[i + 2], *bg) <= FUZZ:
            bg_mask[idx] = 1
            queue.append((x, y))

    for x in range(w):
        push(x, 0)
        push(x, h - 1)
    for y in range(h):
        push(0, y)
        push(w - 1, y)
    head = 0
    while head < len(queue):
        x, y = queue[head]
        head += 1
        push(x - 1, y)
        push(x + 1, y)
        push(x, y - 1)
        push(x, y + 1)
    for idx in range(n):
        if bg_mask[idx]:
            i = idx * 4
            px[i : i + 4] = b"\x00\x00\x00\x00"
    dist = bytearray([255]) * n
    queue = []
    for idx in range(n):
        if px[idx * 4 + 3] < CLEAR:
            dist[idx] = 0
            queue.append(idx)
    head = 0
    while head < len(queue):
        idx = queue[head]
        head += 1
        d = dist[idx]
        if d >= RING:
            continue
        x, y = idx % w, idx // w
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if nx < 0 or ny < 0 or nx >= w or ny >= h:
                continue
            nidx = ny * w + nx
            if dist[nidx] <= d + 1:
                continue
            dist[nidx] = d + 1
            queue.append(nidx)
    for y in range(h):
        for x in range(w):
            idx = y * w + x
            d = dist[idx]
            if d == 0 or d > RING:
                continue
            i = idx * 4
            if px[i + 3] < CLEAR:
                continue
            fg = find_fg(px, w, h, x, y, bg)
            if fg is None:
                continue
            d_bg = chdist(px[i], px[i + 1], px[i + 2], *bg)
            d_fg = chdist(fg[0], fg[1], fg[2], *bg)
            if d_fg == 0:
                continue
            alpha = d_bg / d_fg
            if alpha >= 0.97:
                continue
            if alpha < 0.04:
                px[i : i + 4] = b"\x00\x00\x00\x00"
                continue
            a = max(0, min(255, round(alpha * 255)))

            def un(c, bc):
                v = (c - bc * (1 - alpha)) / alpha
                return max(0, min(255, round(v)))

            px[i] = un(px[i], bg[0])
            px[i + 1] = un(px[i + 1], bg[1])
            px[i + 2] = un(px[i + 2], bg[2])
            px[i + 3] = a
    for idx in range(n):
        i = idx * 4
        if px[i + 3] < CLEAR:
            px[i : i + 4] = b"\x00\x00\x00\x00"


def find_fg(px, w, h, x, y, bg):
    best = None
    best_d = -1
    for dy in range(-SEARCH, SEARCH + 1):
        for dx in range(-SEARCH, SEARCH + 1):
            if dx == 0 and dy == 0:
                continue
            nx, ny = x + dx, y + dy
            if nx < 0 or ny < 0 or nx >= w or ny >= h:
                continue
            i = (ny * w + nx) * 4
            if px[i + 3] < 200:
                continue
            d = chdist(px[i], px[i + 1], px[i + 2], *bg)
            if d > best_d:
                best_d = d
                best = (px[i], px[i + 1], px[i + 2])
    if best is None or best_d < STRONG:
        return None
    return best


def png_out(path, out):
    if out:
        return out
    src = Path(path)
    if src.suffix.lower() == ".png":
        return str(src)
    return str(src.with_suffix(".png"))


def self_test():
    w = h = 48
    px = bytearray([255, 255, 255, 255]) * (w * h)
    cx = cy = 24
    for y in range(h):
        for x in range(w):
            dx, dy = x - cx, y - cy
            radius = (dx * dx + dy * dy) ** 0.5
            i = (y * w + x) * 4
            if radius <= 10:
                px[i : i + 4] = bytes((0, 0, 0, 255))
            elif radius <= 13:
                px[i : i + 4] = bytes((210, 210, 210, 255))
    for y in range(22, 26):
        for x in range(22, 26):
            i = (y * w + x) * 4
            px[i : i + 4] = bytes((255, 255, 255, 255))
    fd, name = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    tmp = Path(name)
    write_png(tmp, w, h, px)
    try:
        w, h, px = read_image(tmp)
    finally:
        tmp.unlink(missing_ok=True)
    defringe_pixels(px, w, h)

    def at(x, y):
        i = (y * w + x) * 4
        return tuple(px[i : i + 4])

    corner = at(0, 0)
    if corner[3] != 0:
        fail(f"corner not clear: {corner}")
    center = at(24, 24)
    if center[3] < 200 or min(center[:3]) < 240:
        fail(f"interior white lost: {center}")
    mark = at(24, 16)
    if mark[3] < 200 or max(mark[:3]) > 30:
        fail(f"mark damaged: {mark}")
    halo = at(24, 37)
    if halo[3] > 200 and min(halo[:3]) > 160:
        fail(f"halo remains: {halo}")
    if halo[3] > 0 and max(halo[:3]) > 40:
        fail(f"halo still light: {halo}")
    print("ok")


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        fail("usage: defringe input [-o output.png]")
    if args[0] == "--self-test":
        self_test()
        return
    src = args[0]
    out = ""
    if "-o" in args:
        i = args.index("-o")
        if i + 1 >= len(args):
            fail("usage: defringe input [-o output.png]")
        out = args[i + 1]
    if not Path(src).is_file():
        fail(f"no such file: {src}")
    target = png_out(src, out)
    w, h, px = read_image(src)
    defringe_pixels(px, w, h)
    write_png(target, w, h, px)
    print(f"saved {target}")


if __name__ == "__main__":
    main()
