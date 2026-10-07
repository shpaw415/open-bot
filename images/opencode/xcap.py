#!/usr/bin/env python3
import ctypes
import ctypes.util
import struct
import sys
import zlib


def png(path, width, height, rgb):
    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    raw = b"".join(
        b"\x00" + rgb[y * width * 3 : (y + 1) * width * 3] for y in range(height)
    )
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    with open(path, "wb") as handle:
        handle.write(
            b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw, 1))
            + chunk(b"IEND", b"")
        )


class XImage(ctypes.Structure):
    _fields_ = [
        ("width", ctypes.c_int),
        ("height", ctypes.c_int),
        ("xoffset", ctypes.c_int),
        ("format", ctypes.c_int),
        ("data", ctypes.POINTER(ctypes.c_char)),
        ("byte_order", ctypes.c_int),
        ("bitmap_unit", ctypes.c_int),
        ("bitmap_bit_order", ctypes.c_int),
        ("bitmap_pad", ctypes.c_int),
        ("depth", ctypes.c_int),
        ("bytes_per_line", ctypes.c_int),
        ("bits_per_pixel", ctypes.c_int),
        ("red_mask", ctypes.c_ulong),
        ("green_mask", ctypes.c_ulong),
        ("blue_mask", ctypes.c_ulong),
        ("obdata", ctypes.c_void_p),
    ]


def capture(path):
    lib = ctypes.CDLL(ctypes.util.find_library("X11"))
    lib.XOpenDisplay.restype = ctypes.c_void_p
    lib.XGetImage.restype = ctypes.POINTER(XImage)
    lib.XRootWindow.restype = ctypes.c_ulong
    lib.XDefaultScreen.restype = ctypes.c_int
    lib.XDisplayWidth.restype = ctypes.c_int
    lib.XDisplayHeight.restype = ctypes.c_int
    display = lib.XOpenDisplay(None)
    if not display:
        print("no display", file=sys.stderr)
        return 1
    screen = lib.XDefaultScreen(display)
    width = lib.XDisplayWidth(display, screen)
    height = lib.XDisplayHeight(display, screen)
    image = lib.XGetImage(
        display,
        lib.XRootWindow(display, screen),
        0,
        0,
        width,
        height,
        ctypes.c_ulong(-1).value,
        2,
    )
    if not image:
        print("capture failed", file=sys.stderr)
        return 1
    frame = image.contents
    raw = ctypes.string_at(frame.data, frame.bytes_per_line * frame.height)
    step = frame.bits_per_pixel // 8
    rgb = bytearray(width * height * 3)
    out = 0
    for y in range(height):
        row = y * frame.bytes_per_line
        for x in range(width):
            pixel = row + x * step
            rgb[out] = raw[pixel + 2]
            rgb[out + 1] = raw[pixel + 1]
            rgb[out + 2] = raw[pixel]
            out += 3
    png(path, width, height, rgb)
    lib.XCloseDisplay(display)
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: xcap.py FILE", file=sys.stderr)
        raise SystemExit(1)
    raise SystemExit(capture(sys.argv[1]))
