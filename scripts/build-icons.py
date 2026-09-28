"""
Build the TaskNote Plus icon set from the user's supplied artwork.

The source is a wide 16:9 illustration (a person at a desk with a task-list
monitor). App icons must be square and readable at 32px, so we crop to the
monitor — the most recognisable, on-brand element — and pad it onto a square
brand-coloured canvas.
"""
from PIL import Image, ImageOps
import os

SRC = r"C:\Users\Msabry\Desktop\Health-Tracker.png"
OUT = r"D:\Tasks-Notes By WorkBuddy\tasknote-plus\public\icons"

BRAND = (79, 70, 229)      # #4f46e5 brand-600
CANVAS = (238, 242, 255)   # #eef2ff brand-50, light and clean behind dark line art

os.makedirs(OUT, exist_ok=True)
src = Image.open(SRC).convert("RGBA")
W, H = src.size
print(f"source: {W}x{H}")

# The monitor occupies roughly the left 55% and the middle band vertically.
# Crop a square around it with a little breathing room.
side = int(H * 0.94)
left = int(W * 0.055)
top = int(H * 0.03)
crop = src.crop((left, top, left + side, top + side))
print(f"cropped: {crop.size}")

def pad_square(img: Image.Image, bg, scale: float) -> Image.Image:
    """Fit `img` onto a square canvas of `bg`, occupying `scale` of the width."""
    size = max(img.size)
    canvas = Image.new("RGBA", (size, size), bg + (255,))
    target = int(size * scale)
    ratio = target / max(img.size)
    resized = img.resize(
        (max(1, int(img.width * ratio)), max(1, int(img.height * ratio))),
        Image.LANCZOS,
    )
    canvas.paste(
        resized,
        ((size - resized.width) // 2, (size - resized.height) // 2),
        resized,
    )
    return canvas

# ── Generic + maskable icons ────────────────────────────────────────────────
# Maskable icons must keep content inside a ~80% safe zone, so the artwork is
# scaled down and the brand colour fills the rest (Android may crop to a circle).
plain = pad_square(crop, CANVAS, 0.96)
maskable = pad_square(crop, CANVAS, 0.68)

for px in (192, 512):
    plain.resize((px, px), Image.LANCZOS).save(f"{OUT}/icon-{px}.png", "PNG")
    maskable.resize((px, px), Image.LANCZOS).save(f"{OUT}/maskable-{px}.png", "PNG")
    print(f"wrote icon-{px}.png, maskable-{px}.png")

plain.resize((180, 180), Image.LANCZOS).save(f"{OUT}/apple-touch-icon.png", "PNG")
plain.resize((32, 32), Image.LANCZOS).save(f"{OUT}/favicon-32.png", "PNG")
plain.resize((256, 256), Image.LANCZOS).save(f"{OUT}/logo.png", "PNG")

# ── Transparent logo for in-app use on any background ──────────────────────
# Trim the near-white page background so the line art sits cleanly on the
# sidebar in both light and dark themes.
logo = crop.copy()
px = logo.load()
for y in range(logo.height):
    for x in range(logo.width):
        r, g, b, a = px[x, y]
        if r > 238 and g > 238 and b > 238:
            px[x, y] = (r, g, b, 0)
bbox = logo.getbbox()
if bbox:
    logo = logo.crop(bbox)
logo.thumbnail((512, 512), Image.LANCZOS)
logo.save(f"{OUT}/logo-transparent.png", "PNG")
print(f"wrote logo-transparent.png {logo.size}")
