#!/usr/bin/env python3
"""Generate extension icons (16/48/128 px PNGs) using only stdlib.

Draws a dark rounded tile with a glowing magenta-to-cyan halo around a small
"screen" containing a play triangle. Run from the extension root:

    python3 tools/generate_icons.py
"""
import math
import os
import struct
import zlib

SIZES: tuple[int, ...] = (16, 48, 128)
SUPERSAMPLE = 4
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT_DIR, "icons")

MAGENTA: tuple[int, int, int] = (236, 72, 153)
VIOLET: tuple[int, int, int] = (139, 92, 246)
CYAN: tuple[int, int, int] = (34, 211, 238)

TILE_BASE_RGB: tuple[float, float, float] = (14.0, 14.0, 18.0)
SCREEN_BG_RGBA: tuple[float, float, float, float] = (28.0, 28.0, 34.0, 255.0)
PLAY_ICON_RGBA: tuple[float, float, float, float] = (255.0, 255.0, 255.0, 255.0)
TILE_CORNER_RADIUS = 0.22
SCREEN_HALF_WIDTH = 0.27
SCREEN_HALF_HEIGHT = 0.185
SCREEN_CORNER_RADIUS = 0.05
GLOW_FALLOFF = 0.085
GLOW_INTENSITY = 1.05
PLAY_TRIANGLE = ((0.44, 0.40), (0.44, 0.60), (0.61, 0.50))

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
PNG_BIT_DEPTH = 8
PNG_COLOR_TYPE_RGBA = 6
PNG_COMPRESSION_LEVEL = 9


def lerp(start: float, end: float, factor: float) -> float:
    """Linearly interpolate between start and end at factor."""
    return start + (end - start) * factor


def lerp_color(
    color_a: tuple[float, ...],
    color_b: tuple[float, ...],
    factor: float,
) -> tuple[float, ...]:
    """Linearly interpolate between two equal-length color tuples."""
    return tuple(lerp(ch_a, ch_b, factor) for ch_a, ch_b in zip(color_a, color_b, strict=True))


def rounded_rect_sdf(
    point_x: float,
    point_y: float,
    center_x: float,
    center_y: float,
    half_width: float,
    half_height: float,
    corner_radius: float,
) -> float:
    """Return signed distance to a rounded rectangle (negative = inside)."""
    offset_x = abs(point_x - center_x) - (half_width - corner_radius)
    offset_y = abs(point_y - center_y) - (half_height - corner_radius)
    outside = math.hypot(max(offset_x, 0.0), max(offset_y, 0.0))
    inside = min(max(offset_x, offset_y), 0.0)
    return outside + inside - corner_radius


def in_triangle(
    point_x: float,
    point_y: float,
    vertex_a: tuple[float, float],
    vertex_b: tuple[float, float],
    vertex_c: tuple[float, float],
) -> bool:
    """Return True if point lies inside or on triangle (vertex_a, vertex_b, vertex_c)."""
    def edge_side(
        p1: tuple[float, float],
        p2: tuple[float, float],
        p3: tuple[float, float],
    ) -> float:
        return (
            (p1[0] - p3[0]) * (p2[1] - p3[1])
            - (p2[0] - p3[0]) * (p1[1] - p3[1])
        )

    side_1 = edge_side((point_x, point_y), vertex_a, vertex_b)
    side_2 = edge_side((point_x, point_y), vertex_b, vertex_c)
    side_3 = edge_side((point_x, point_y), vertex_c, vertex_a)
    has_neg = side_1 < 0 or side_2 < 0 or side_3 < 0
    has_pos = side_1 > 0 or side_2 > 0 or side_3 > 0
    return not (has_neg and has_pos)


def shade(norm_x: float, norm_y: float) -> tuple[float, float, float, float]:
    """Return RGBA (0-255 floats) for normalized coordinates norm_x, norm_y in [0, 1]."""
    if rounded_rect_sdf(norm_x, norm_y, 0.5, 0.5, 0.5, 0.5, TILE_CORNER_RADIUS) > 0:
        return (0.0, 0.0, 0.0, 0.0)

    screen_dist = rounded_rect_sdf(
        norm_x, norm_y, 0.5, 0.5,
        SCREEN_HALF_WIDTH, SCREEN_HALF_HEIGHT, SCREEN_CORNER_RADIUS,
    )
    if screen_dist <= 0:
        if in_triangle(norm_x, norm_y, *PLAY_TRIANGLE):
            return PLAY_ICON_RGBA
        return SCREEN_BG_RGBA

    glow = math.exp(-screen_dist / GLOW_FALLOFF)
    if norm_x < 0.5:
        glow_color = lerp_color(MAGENTA, VIOLET, norm_x * 2)
    else:
        glow_color = lerp_color(VIOLET, CYAN, (norm_x - 0.5) * 2)
    rgb = tuple(
        min(255.0, base_ch + glow_ch * glow * GLOW_INTENSITY)
        for base_ch, glow_ch in zip(TILE_BASE_RGB, glow_color, strict=True)
    )
    return (rgb[0], rgb[1], rgb[2], 255.0)


def sample_pixel(
    pixel_x: int,
    pixel_y: int,
    size: int,
    offsets: tuple[float, ...],
) -> tuple[int, int, int, int]:
    """Return straight-alpha RGBA tuple for pixel (pixel_x, pixel_y)."""
    acc_r = acc_g = acc_b = acc_a = 0.0
    for dy in offsets:
        norm_y = (pixel_y + dy) / size
        for dx in offsets:
            red, green, blue, alpha_sample = shade((pixel_x + dx) / size, norm_y)
            acc_r += red * alpha_sample
            acc_g += green * alpha_sample
            acc_b += blue * alpha_sample
            acc_a += alpha_sample
    sample_count = len(offsets) * len(offsets)
    alpha = acc_a / sample_count
    if acc_a > 0:
        return (
            int(round(acc_r / acc_a)),
            int(round(acc_g / acc_a)),
            int(round(acc_b / acc_a)),
            int(round(alpha)),
        )
    return (0, 0, 0, int(round(alpha)))


def render(size: int) -> bytes:
    """Render raw PNG scanlines (filter byte + RGBA) for a square icon."""
    if size <= 0:
        raise ValueError(f"size must be > 0, got {size}")
    if SUPERSAMPLE <= 0:
        raise ValueError(f"SUPERSAMPLE must be > 0, got {SUPERSAMPLE}")

    offsets = tuple((idx + 0.5) / SUPERSAMPLE for idx in range(SUPERSAMPLE))
    stride = 1 + size * 4
    buf = bytearray(size * stride)
    for py in range(size):
        row_offset = py * stride + 1
        for px in range(size):
            r, g, b, a = sample_pixel(px, py, size, offsets)
            pos = row_offset + px * 4
            buf[pos] = r
            buf[pos + 1] = g
            buf[pos + 2] = b
            buf[pos + 3] = a
    return bytes(buf)


def write_png(path: str, size: int, raw: bytes) -> None:
    """Encode raw scanlines as an 8-bit RGBA PNG file at path."""
    if size <= 0:
        raise ValueError(f"size must be > 0, got {size}")
    expected_bytes = size * (size * 4 + 1)
    if len(raw) != expected_bytes:
        raise ValueError(
            f"Invalid raw PNG buffer: expected {expected_bytes} bytes, "
            f"got {len(raw)}"
        )

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        crc = zlib.crc32(body) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + body + struct.pack(">I", crc)

    ihdr = struct.pack(
        ">IIBBBBB", size, size, PNG_BIT_DEPTH, PNG_COLOR_TYPE_RGBA, 0, 0, 0
    )
    png = (
        PNG_SIGNATURE
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, PNG_COMPRESSION_LEVEL))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as png_file:
        png_file.write(png)


def main() -> None:
    """Generate 16x16, 48x48, and 128x128 PNG icon files into OUT_DIR."""
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in SIZES:
        path = os.path.join(OUT_DIR, f"icon-{size}.png")
        write_png(path, size, render(size))
        print(f"Created {path} ({size}x{size})")


if __name__ == "__main__":
    main()
