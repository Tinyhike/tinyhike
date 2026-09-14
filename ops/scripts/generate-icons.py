#!/usr/bin/env python3
"""Render TinyHike's app icons into web/public/.

The manifest referenced favicon.ico, icon-192.png and icon-512.png, none of which
existed — so the favicon 404'd and "Add to home screen" had no artwork. Rather than
commit opaque binaries, this script draws them, so a palette change is one edit and
a re-run away.

No image library is installed on the box (no Pillow, no ImageMagick), so the PNG
encoder here is hand-rolled on top of zlib. Shapes are drawn by supersampling a
signed-distance test, which is what gives the edges their anti-aliasing.

    ops/scripts/generate-icons.py

Outputs (all under web/public/):
    favicon.ico            32px + 48px, PNG-in-ICO
    icon-192.png           rounded, purpose "any"
    icon-512.png           rounded, purpose "any"
    icon-maskable-512.png  full-bleed, purpose "maskable" (launchers apply their
                           own mask and would otherwise clip our rounded corners)
"""

import math
import pathlib
import struct
import zlib

OUT_DIR = pathlib.Path(__file__).resolve().parents[2] / "web" / "public"

# Design tokens — keep in sync with :root in web/src/index.css.
SUN = (0xFF, 0xD1, 0x66)
BERRY = (0xEF, 0x47, 0x6F)
MINT = (0x06, 0xD6, 0xA0)
SKY = (0x21, 0xA9, 0xD8)
GRAPE = (0x9B, 0x5D, 0xE5)
WHITE = (0xFF, 0xFF, 0xFF)

SUPERSAMPLE = 3  # samples per axis, so 9 per output pixel


def _circle(px, py, cx, cy, r):
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r


def _triangle(px, py, ax, ay, bx, by, cx, cy):
    """Point-in-triangle via consistent sign of the three edge cross products."""
    d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
    d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
    d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
    has_neg = d1 < 0 or d2 < 0 or d3 < 0
    has_pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (has_neg and has_pos)


def _rounded_square(px, py, radius):
    """px/py in 0..1. `radius` is the corner radius in the same unit space."""
    qx = abs(px - 0.5) - (0.5 - radius)
    qy = abs(py - 0.5) - (0.5 - radius)
    if qx <= 0 or qy <= 0:
        return True
    return qx * qx + qy * qy <= radius * radius


def sample(px, py, *, corner_radius, confetti):
    """Colour at unit coordinates, or None where the icon is transparent."""
    if not _rounded_square(px, py, corner_radius):
        return None

    # Map pin: a disc for the head, a triangle tapering to the point below.
    head = (0.5, 0.43, 0.205)
    if _circle(px, py, *head) or _triangle(px, py, 0.5, 0.815, 0.328, 0.515, 0.672, 0.515):
        # White eyelet, so the pin still reads as a pin at favicon size.
        return WHITE if _circle(px, py, 0.5, 0.43, 0.088) else BERRY

    if confetti:
        for cx, cy, colour in ((0.185, 0.205, MINT), (0.815, 0.235, SKY), (0.205, 0.795, GRAPE)):
            if _circle(px, py, cx, cy, 0.052):
                return colour

    return SUN


def render(size, *, corner_radius, confetti):
    """Anti-aliased RGB rows for one square icon."""
    rows = []
    step = 1.0 / (size * SUPERSAMPLE)
    for y in range(size):
        row = bytearray()
        for x in range(size):
            r = g = b = 0
            for sy in range(SUPERSAMPLE):
                py = (y * SUPERSAMPLE + sy + 0.5) * step
                for sx in range(SUPERSAMPLE):
                    px = (x * SUPERSAMPLE + sx + 0.5) * step
                    # Outside the rounded square we composite against white rather
                    # than emit alpha: these icons always sit on an opaque surface,
                    # and staying on colour type 2 keeps the encoder trivial.
                    c = sample(px, py, corner_radius=corner_radius, confetti=confetti) or WHITE
                    r += c[0]
                    g += c[1]
                    b += c[2]
            n = SUPERSAMPLE * SUPERSAMPLE
            row += bytes((r // n, g // n, b // n))
        rows.append(bytes(row))
    return rows


def encode_png(rows):
    size = len(rows)

    def chunk(tag, payload):
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    # Filter type 0 (None) on every scanline: the shapes are flat colour, so the
    # gain from a smarter filter wouldn't pay for the complexity here.
    raw = b"".join(b"\x00" + row for row in rows)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit truecolour
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def encode_ico(pngs):
    """Wrap already-encoded PNGs in an ICO container (accepted by every current browser)."""
    header = struct.pack("<HHH", 0, 1, len(pngs))
    offset = len(header) + 16 * len(pngs)
    entries, blobs = b"", b""
    for size, data in pngs:
        entries += struct.pack(
            "<BBBBHHII", size if size < 256 else 0, size if size < 256 else 0, 0, 0, 1, 32, len(data), offset
        )
        blobs += data
        offset += len(data)
    return header + entries + blobs


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    targets = [
        ("icon-192.png", 192, 0.20, True),
        ("icon-512.png", 512, 0.20, True),
        # Full bleed and no confetti: a maskable icon gets cropped to the launcher's
        # shape, and only the central 80% is guaranteed visible.
        ("icon-maskable-512.png", 512, 0.0, False),
    ]
    for name, size, radius, confetti in targets:
        data = encode_png(render(size, corner_radius=radius, confetti=confetti))
        (OUT_DIR / name).write_bytes(data)
        print(f"{name}: {len(data):,} bytes")

    ico = encode_ico(
        [(s, encode_png(render(s, corner_radius=0.20, confetti=False))) for s in (32, 48)]
    )
    (OUT_DIR / "favicon.ico").write_bytes(ico)
    print(f"favicon.ico: {len(ico):,} bytes")


if __name__ == "__main__":
    main()
