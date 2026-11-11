# Draws the Hush Hall icon (the same shapes as app/app/icon.svg: a warm brown
# tile, a paper-white desk on two legs, a soft lamp glow) as PNGs for the web
# manifest, the Android launcher and the Play listing. Run from the repo root:
#   python3 android/branding/make_icons.py
from PIL import Image, ImageDraw  # simple vector-ish drawing, then downscale for smooth edges
import os  # folders

BROWN, PAPER, LAMP = (0xA4, 0x71, 0x48, 255), (0xF6, 0xEF, 0xE2, 255), (0xE9, 0xD8, 0xA6, 255)  # colours from icon.svg
SS = 4  # supersampling factor for anti-aliasing

def glyph(d, s, ox, oy):
    # Desk, legs and lamp from icon.svg (64-unit grid), scaled by s and offset by (ox, oy).
    R = lambda x, y, w, h: [ox + x * s, oy + y * s, ox + (x + w) * s, oy + (y + h) * s]  # svg rect -> box
    d.rounded_rectangle(R(12, 30, 40, 8), radius=2 * s, fill=PAPER)  # desk top
    d.rectangle(R(16, 38, 4, 14), fill=PAPER)  # left leg
    d.rectangle(R(44, 38, 4, 14), fill=PAPER)  # right leg
    d.ellipse(R(26, 14, 12, 12), fill=LAMP)  # lamp glow

def render(size, mode):
    # mode "tile": rounded tile like the favicon; "full": edge-to-edge background
    # with the glyph in the safe zone (maskable / adaptive); "fg": transparent
    # adaptive-icon foreground (glyph only, in the 66/108 safe zone).
    N = size * SS  # working canvas
    im = Image.new("RGBA", (N, N), (0, 0, 0, 0))  # transparent start
    d = ImageDraw.Draw(im)  # painter
    if mode == "tile":
        d.rounded_rectangle([0, 0, N - 1, N - 1], radius=N * 14 / 64, fill=BROWN)  # tile
        glyph(d, N / 64, 0, 0)  # glyph at its svg position
    else:
        if mode == "full": d.rectangle([0, 0, N, N], fill=BROWN)  # full-bleed background
        s = N * 0.55 / 40  # glyph (40 units wide) spans 55% of the icon: inside every mask shape
        glyph(d, s, N / 2 - 32 * s, N / 2 - 33 * s)  # centre the glyph (its centre is at 32, 33)
    return im.resize((size, size), Image.LANCZOS)  # smooth downscale

def save(im, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)  # make folders
    im.save(path, optimize=True)  # write PNG

pub = "app/public/icons"  # web icons
save(render(192, "tile"), f"{pub}/icon-192.png")  # manifest "any"
save(render(512, "tile"), f"{pub}/icon-512.png")  # manifest "any"
save(render(512, "full"), f"{pub}/icon-maskable-512.png")  # manifest "maskable"
save(render(180, "full"), "app/public/apple-touch-icon.png")  # iOS home screen

res = "android/app/src/main/res"  # Android resources
for dpi, px in {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}.items():
    save(render(px, "tile"), f"{res}/mipmap-{dpi}/ic_launcher.png")  # legacy launcher icon
    save(render(px * 9 // 4, "fg"), f"{res}/mipmap-{dpi}/ic_launcher_foreground.png")  # adaptive foreground (108dp)
    save(render(px * 2, "full"), f"{res}/drawable-{dpi}/splash.png")  # splash image while the site loads
save(render(512, "full"), "android/branding/play-icon-512.png")  # Play listing icon (512x512, no transparency needed)
print("icons written")  # done
