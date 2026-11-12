#!/usr/bin/env python3
# Keeps the bare-leg/foot body textures (public/looks/*.body-bare.webp) as
# sharp as the restored body texture in the VRM files.
#
# The bare variants were painted on a 1024 px Lanczos upscale of the old
# 512 px Body_00 map, so everything outside the painted legs and feet (arms,
# hands, neck, torso) was soft. This script finds the painted texels (where
# the variant differs from that upscale), keeps them exactly, and takes every
# other texel from the original pixiv texture at 1024 px (the same pixels the
# restored VRM now uses), with a 1-2 px feathered seam. Re-run it after any
# repaint of the feet/legs.
# Usage: python3 sharpen_bare_bodies.py ORIG_DIR OLD_MODELS_DIR LOOKS_DIR
#   ORIG_DIR: original pixiv exports (Vivi.vrm ...); OLD_MODELS_DIR: our VRMs as of
#   commit 9430546 (512 px textures, e.g. via `git show`); LOOKS_DIR: public/looks (edited in place).
import io, os, sys
import numpy as np
from PIL import Image, ImageFilter
from restore_vrm_textures import read_glb, view, NAMES  # same GLB helpers + roster

def body_image(path, name=None):
    j, b = read_glb(path)  # parse
    im = [i for i in j["images"] if i.get("name", "").endswith("Body_00") and (name is None or i["name"] == name)][0]  # colour map, not _nml
    return im["name"], Image.open(io.BytesIO(view(j, b, im["bufferView"]))).convert("RGBA")

def sharpen(orig, old, bare_path):
    name, low = body_image(old)  # 512 px map the paint started from
    _, hi = body_image(orig, name)  # original pixels
    bare = Image.open(bare_path).convert("RGBA"); R = bare.size[0]  # painted variant (1024)
    hi = hi.resize(bare.size, Image.LANCZOS); up = low.resize(bare.size, Image.LANCZOS)  # same upscale the paint used
    B = np.asarray(bare, float); U = np.asarray(up, float); H = np.asarray(hi, float)
    seen = U[..., 3] > 0  # texels the body map shows at all (VRoid cuts the skin out under clothes; keep those cut-outs)
    painted = ((np.abs(B - U).max(2) > 2) & seen).astype(np.uint8) * 255  # texels the paint touched
    m = Image.fromarray(painted).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(1.2))  # grow 2 px, feather
    M = np.asarray(m, float)[..., None] / 255.0
    out = np.clip(H * (1 - M) + B * M + 0.5, 0, 255).astype(np.uint8)  # sharp base, paint on top
    res = Image.fromarray(out, "RGBA")
    if out[..., 3].min() == 255: res = res.convert("RGB")  # no transparency
    res.save(bare_path, "WEBP", lossless=True, quality=100, method=6, exact=True)  # keep the painted feet pixel-exact
    print(os.path.basename(bare_path), f"painted {painted.mean() / 255:.1%}", os.path.getsize(bare_path), "bytes")

if __name__ == "__main__":
    orig_dir, old_dir, looks = sys.argv[1:4]
    for ours, theirs in NAMES.items():
        sharpen(os.path.join(orig_dir, theirs + ".vrm"), os.path.join(old_dir, ours + ".vrm"), os.path.join(looks, f"{ours}.body-bare.webp"))
