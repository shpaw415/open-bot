#!/usr/bin/env python3
# Frame feeder for ob-record (record.ts): grabs the root window with
# XGetImage — the same non-SHM path xcap.py uses for screenshots, because
# the thread screens run Xvfb with MIT-SHM disabled and ffmpeg's x11grab
# then receives no frames at all — and writes packed BGRA frames to
# stdout, where ffmpeg (rawvideo input) encodes them. The display comes
# from $DISPLAY, the rate from argv[1].
import ctypes
import ctypes.util
import signal
import sys
import time

signal.signal(signal.SIGPIPE, signal.SIG_DFL)


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


def main():
    if len(sys.argv) != 2:
        print("usage: xrecord.py FPS", file=sys.stderr)
        return 1
    fps = float(sys.argv[1])
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
    root = lib.XRootWindow(display, screen)
    out = sys.stdout.buffer
    interval = 1.0 / fps
    nxt = time.monotonic()
    while True:
        image = lib.XGetImage(
            display, root, 0, 0, width, height, ctypes.c_ulong(-1).value, 2
        )
        if not image:
            print("capture failed", file=sys.stderr)
            return 1
        frame = image.contents
        raw = ctypes.string_at(frame.data, frame.bytes_per_line * frame.height)
        if frame.bytes_per_line == width * 4:
            out.write(raw)
        else:
            row = width * 4
            for y in range(height):
                start = y * frame.bytes_per_line
                out.write(raw[start : start + row])
        out.flush()
        lib.XDestroyImage(image)
        nxt += interval
        delay = nxt - time.monotonic()
        if delay > 0:
            time.sleep(delay)
        else:
            nxt = time.monotonic()


if __name__ == "__main__":
    raise SystemExit(main())
