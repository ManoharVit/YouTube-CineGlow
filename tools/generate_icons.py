#!/usr/bin/env python3
"""Generate the extension icons (16/48/128 px PNGs) using only the standard library.

Draws a dark rounded tile with a glowing magenta→cyan halo around a small "screen"
containing a play triangle. Run from the extension root:

    python3 tools/generate_icons.py
"""
import math
import os
import struct
import zlib

SIZES = (16, 48, 128)
SUPERSAMPLE = 4
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")

MAGENTA = (236, 72, 153)
VIOLET = (139, 92, 246)
CYAN = (34, 211, 238)


def lerp(a, b, t):
    return a + (b - a) * t


def lerp_color(c1, c2, t):
    return tuple(lerp(a, b, t) for a, b in zip(c1, c2))


def rounded_rect_sdf(x, y, cx, cy, hw, hh, r):
    """Signed distance from (x, y) to a rounded rectangle (negative = inside)."""
    qx = abs(x - cx) - (hw - r)
    qy = abs(y - cy) - (hh - r)
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    inside = min(max(qx, qy), 0.0)
    return outside + inside - r


def in_triangle(px, py, a, b, c):
    def sign(p1, p2, p3):
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])

    d1, d2, d3 = sign((px, py), a, b), sign((px, py), b, c), sign((px, py), c, a)
    has_neg = d1 < 0 or d2 < 0 or d3 < 0
    has_pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (has_neg and has_pos)


def shade(x, y):
    """Return RGBA (floats 0-255) for normalized coordinates x, y in [0, 1]."""
    # Outer tile
    if rounded_rect_sdf(x, y, 0.5, 0.5, 0.5, 0.5, 0.22) > 0:
        return (0.0, 0.0, 0.0, 0.0)

    base = (14.0, 14.0, 18.0)

    # Inner "screen"
    d = rounded_rect_sdf(x, y, 0.5, 0.5, 0.27, 0.185, 0.05)
    if d <= 0:
        if in_triangle(x, y, (0.44, 0.40), (0.44, 0.60), (0.61, 0.50)):
            return (255.0, 255.0, 255.0, 255.0)
        return (28.0, 28.0, 34.0, 255.0)

    # Glow around the screen, colored by horizontal position
    glow = math.exp(-d / 0.085)
    t = x
    color = lerp_color(MAGENTA, VIOLET, t * 2) if t < 0.5 else lerp_color(VIOLET, CYAN, (t - 0.5) * 2)
    rgb = tuple(min(255.0, b + c * glow * 1.05) for b, c in zip(base, color))
    return (*rgb, 255.0)


def render(size):
    rows = []
    n = SUPERSAMPLE
    for py in range(size):
        row = bytearray([0])  # PNG filter type 0 (None)
        for px in range(size):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(n):
                for sx in range(n):
                    r, g, b, a = shade((px + (sx + 0.5) / n) / size, (py + (sy + 0.5) / n) / size)
                    # Premultiply so edge anti-aliasing blends correctly
                    acc[0] += r * a
                    acc[1] += g * a
                    acc[2] += b * a
                    acc[3] += a
            alpha = acc[3] / (n * n)
            if acc[3] > 0:
                rgb = [int(round(c / acc[3])) for c in acc[:3]]
            else:
                rgb = [0, 0, 0]
            row.extend((*rgb, int(round(alpha))))
        rows.append(bytes(row))
    return b"".join(rows)


def write_png(path, size, raw):
    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in SIZES:
        path = os.path.join(OUT_DIR, f"icon-{size}.png")
        write_png(path, size, render(size))
        print(f"Created {path} ({size}x{size})")


if __name__ == "__main__":
    main()
