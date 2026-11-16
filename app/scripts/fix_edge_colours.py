#!/usr/bin/env python3
# Applies the edge colour fix (see clean_edges in restore_vrm_textures.py) to the VRM files already in
# app/public/models, without needing pixiv's original exports. Only the images named in EDGE_FIX are
# touched (back hair, eye highlights, eyelines, lashes, brows), and only their colour: alpha, size,
# meshes, materials and every other texture stay byte-for-byte as they were. Safe to run twice.
# Usage: python3 fix_edge_colours.py MODELS_DIR
import io, os, sys
import numpy as np
from PIL import Image
from restore_vrm_textures import EDGE_FIX, KEEP, LOSSLESS, SOLID, clean_edges, read_glb, view, write_glb

def encode(im, name):
    out = io.BytesIO()
    if any(k in name for k in LOSSLESS): im.save(out, "WEBP", lossless=True, quality=100, method=6, exact=True)  # line art stays pixel-exact
    else: im.save(out, "WEBP", quality=95, method=6, alpha_quality=100, exact=True)  # alpha kept at full quality
    return out.getvalue()

def fix(path):
    j, b = read_glb(path)
    new_views = {}
    for im in j["images"]:
        name = im.get("name", "")
        if not any(k in name for k in EDGE_FIX) or any(k in name for k in KEEP): continue
        src = Image.open(io.BytesIO(view(j, b, im["bufferView"]))).convert("RGBA")
        alpha = np.asarray(src)[..., 3]
        if alpha.min() >= SOLID * 255: continue  # fully solid: no soft edge to fix
        new_views[im["bufferView"]] = encode(clean_edges(src), name)
        im["mimeType"] = "image/webp"
        print(f"  {name}: edge colours fixed")
    if new_views: write_glb(path, j, b, new_views)

if __name__ == "__main__":
    for f in sorted(os.listdir(sys.argv[1])):
        if f.endswith(".vrm"): print(f); fix(os.path.join(sys.argv[1], f))
