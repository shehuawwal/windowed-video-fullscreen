#!/usr/bin/env python3
"""Draw the toolbar icons (no dependencies): a browser window with a play
button and four 'expand' corners. Writes src/icons/icon-{16,32,48,128}.png."""
import os, struct, zlib

SS = 4  # supersampling factor for anti-aliasing
BG = (79, 70, 229)
FG = (255, 255, 255)

def inside_rrect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

def inside_tri(x, y, a, b, c):
    def s(p, q, r):
        return (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1])
    d1, d2, d3 = s((x, y), a, b), s((x, y), b, c), s((x, y), c, a)
    neg = d1 < 0 or d2 < 0 or d3 < 0
    pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (neg and pos)

def sample(u, v):
    """u, v in [0,1]. Returns (rgb, alpha)."""
    if not inside_rrect(u, v, 0.02, 0.02, 0.98, 0.98, 0.22):
        return None
    # Expand corners: L-shaped strokes.
    t, m, L = 0.085, 0.17, 0.2
    for (cx, cy, sx, sy) in ((m, m, 1, 1), (1 - m, m, -1, 1), (m, 1 - m, 1, -1), (1 - m, 1 - m, -1, -1)):
        ux, vy = (u - cx) * sx, (v - cy) * sy
        if (0 <= ux <= L and 0 <= vy <= t) or (0 <= ux <= t and 0 <= vy <= L):
            return FG
    if inside_tri(u, v, (0.40, 0.33), (0.40, 0.67), (0.69, 0.50)):
        return FG
    return BG

def draw(size):
    n = size * SS
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            r = g = b = a = 0
            for sy in range(SS):
                for sx in range(SS):
                    c = sample((px * SS + sx + 0.5) / n, (py * SS + sy + 0.5) / n)
                    if c:
                        r += c[0]; g += c[1]; b += c[2]; a += 1
            k = SS * SS
            if a:
                row += bytes((r // a, g // a, b // a, 255 * a // k))
            else:
                row += b"\0\0\0\0"
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", raw) + chunk(b"IEND", b""))

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "icons")
    os.makedirs(out, exist_ok=True)
    for s in (16, 32, 48, 128):
        with open(os.path.join(out, f"icon-{s}.png"), "wb") as f:
            f.write(draw(s))
    print("icons written to", os.path.normpath(out))
