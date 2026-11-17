"""Draws the launcher icon (a green stopwatch on dark) at every Android density."""
import os
import sys

from PIL import Image, ImageDraw

SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
BG, GREEN, WHITE = (24, 24, 24), (43, 213, 43), (235, 235, 235)


def draw(size):
    s = size * 4  # draw large, then downsample for smooth edges
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=s * 0.22, fill=BG)
    cx, cy, r = s / 2, s * 0.55, s * 0.30
    w = s * 0.055
    d.rectangle([cx - s * 0.07, s * 0.12, cx + s * 0.07, s * 0.17], fill=GREEN)  # top button
    d.rectangle([cx - w / 2, s * 0.16, cx + w / 2, cy - r], fill=GREEN)  # stem
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=GREEN, width=int(w))  # dial
    d.line([cx, cy, cx, cy - r * 0.62], fill=WHITE, width=int(w * 0.9))  # minute hand
    d.line([cx, cy, cx + r * 0.45, cy + r * 0.25], fill=WHITE, width=int(w * 0.9))  # hour hand
    d.ellipse([cx - w, cy - w, cx + w, cy + w], fill=WHITE)
    return img.resize((size, size), Image.LANCZOS)


out = sys.argv[1]
for name, px in SIZES.items():
    folder = os.path.join(out, f"mipmap-{name}")
    os.makedirs(folder, exist_ok=True)
    draw(px).save(os.path.join(folder, "ic_launcher.png"))
