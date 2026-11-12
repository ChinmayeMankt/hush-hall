#!/usr/bin/env python3
# Restores sharper colour textures in our shipped VRM files from pixiv's
# original CC0 VRoid exports (see docs/ASSETS.md for where those come from).
#
# The first optimisation pass (optimize_vrm.py) shrank every texture to 512 px,
# which is what makes faces, eyes, hair and clothes look soft and blocky when
# you get close. This script keeps everything else in the shipped file exactly
# as it is (trimmed morphs, meshes, materials, VRM data) and only swaps the
# pixels of the colour/alpha textures:
#  - source: the matching image (by name) in the original pixiv file
#  - size: up to MAX px on the long side (1024 by default; the originals are
#    1024-2048), downscaled with Lanczos
#  - format: WebP via the EXT_texture_webp glTF extension (three.js reads it
#    natively); face, eye, brow, lash and mouth art is lossless, the rest is
#    high-quality lossy (q92, alpha kept at full quality), so the files end up
#    about the same size as before despite 4x the pixels
#  - transparent texels get the colour of their visible neighbours, so
#    filtering never pulls black into lash, highlight, hair and lace edges
# Normal, specular, outline-width and matcap maps are low-frequency and stay as
# they are. Never upscales; images already at full size are re-encoded only.
# Usage: python3 restore_vrm_textures.py ORIG_DIR MODELS_DIR [MAX]
#   ORIG_DIR holds the original exports (e.g. Vivi.vrm), MODELS_DIR our files (vivi.vrm); edits in place.
import io, json, os, struct, sys
import numpy as np  # colour bleeding
from PIL import Image  # Pillow (with WebP support)

KEEP = ("_nml", "_spe", "_out", "Matcap", "Shader_")  # data maps left untouched
LOSSLESS = ("Face", "Eye", "Brow", "Mouth")  # line art we never want blurred by lossy coding
# Vita's outfit texture is mostly transparent: the real VRoid design is a
# see-through teal bodysuit. The hall has always shown her in a dark dress with
# long sleeves (an alpha-test bug drew the transparent texels black), and that
# is the look that was approved, so her outfit layer is flattened onto a soft
# near-black fabric colour: same silhouette as before, clean edges, no gaps.
OPAQUE_FILL = {("vita", "F00_002_Onepiece_01"): (16, 17, 24)}  # (model, image) -> fill colour

def read_glb(path):
    d = open(path, "rb").read()  # whole GLB
    jl = struct.unpack("<I", d[12:16])[0]  # JSON chunk length
    j = json.loads(d[20:20 + jl])  # JSON chunk
    bl = struct.unpack("<I", d[20 + jl:24 + jl])[0]  # BIN chunk length
    return j, d[28 + jl:28 + jl + bl]  # json + bin

def view(j, b, i):
    v = j["bufferViews"][i]; o = v.get("byteOffset", 0)  # one buffer view
    return b[o:o + v["byteLength"]]  # its bytes

def bleed(rgba):
    # VRoid leaves transparent texels black. Once the GPU blends neighbouring
    # texels (bilinear filtering, mipmaps) that black leaks into the edges of
    # eye highlights, lashes, hair tips and lace as dark fringes. Fill the RGB
    # of fully transparent texels with the colour of the nearest visible ones
    # (push-pull), leaving every visible texel and all alpha values unchanged.
    a = np.asarray(rgba, dtype=np.float64) / 255.0  # H x W x 4
    w = (a[..., 3] > 0).astype(np.float64)  # visible texels
    if w.all() or not w.any(): return rgba  # nothing to fill
    levels = [(a[..., :3] * w[..., None], w)]  # premultiplied colour + weight
    while min(levels[-1][1].shape) > 1:  # pull: average down to 1 px
        c, ww = levels[-1]; h2, w2 = c.shape[0] // 2 * 2, c.shape[1] // 2 * 2
        c = c[:h2, :w2].reshape(h2 // 2, 2, w2 // 2, 2, 3).sum((1, 3)); ww = ww[:h2, :w2].reshape(h2 // 2, 2, w2 // 2, 2).sum((1, 3))
        levels.append((c, ww))
    col = levels[-1][0] / np.maximum(levels[-1][1], 1e-9)[..., None]  # coarsest average colour
    for c, ww in reversed(levels[:-1]):  # push: fill holes from the coarser level
        up = np.repeat(np.repeat(col, 2, 0), 2, 1)
        up = np.pad(up, ((0, c.shape[0] - up.shape[0]), (0, c.shape[1] - up.shape[1]), (0, 0)), mode="edge")
        col = np.where(ww[..., None] > 0, c / np.maximum(ww, 1e-9)[..., None], up)
    out = a.copy(); hole = a[..., 3] == 0
    out[hole, :3] = col[hole]  # only invisible texels change
    return Image.fromarray(np.round(out * 255).astype(np.uint8), "RGBA")

def encode(im, name, fill=None):
    rgba = im.convert("RGBA")  # uniform input
    if fill:  # composite over an opaque fabric colour
        base = Image.new("RGBA", rgba.size, fill + (255,)); base.alpha_composite(rgba); rgba = base
    opaque = rgba.getchannel("A").getextrema()[0] == 255  # no transparency at all
    if not opaque: rgba = bleed(rgba)  # no dark fringes when filtered
    src = rgba.convert("RGB") if opaque else rgba  # drop a useless alpha channel
    out = io.BytesIO()
    if any(k in name for k in LOSSLESS): src.save(out, "WEBP", lossless=True, quality=100, method=6, exact=True)  # pixel-exact
    else: src.save(out, "WEBP", quality=92, method=6, alpha_quality=100, exact=True)  # visually lossless at this size
    return out.getvalue()

def restore(orig_path, path, max_px):
    jo, bo = read_glb(orig_path); j, b = read_glb(path)  # original + shipped
    by_name = {im.get("name"): im for im in jo["images"]}  # original images by name
    new_views = {}  # bufferView index -> replacement bytes
    webp_images = set()  # image indices now stored as WebP
    for idx, im in enumerate(j["images"]):
        name = im.get("name", "")
        if any(k in name for k in KEEP) or name not in by_name: continue  # leave data maps alone
        src = Image.open(io.BytesIO(view(jo, bo, by_name[name]["bufferView"]))); src.load()  # original pixels
        cur = Image.open(io.BytesIO(view(j, b, im["bufferView"])))  # shipped size (to report)
        if max(src.size) > max_px:
            s = max_px / max(src.size)  # never upscale
            src = src.resize((max(1, round(src.size[0] * s)), max(1, round(src.size[1] * s))), Image.LANCZOS)
        new_views[im["bufferView"]] = encode(src, name, OPAQUE_FILL.get((os.path.basename(path)[:-4], name)))  # new bytes
        im["mimeType"] = "image/webp"; webp_images.add(idx)  # mark
        print(f"  {name}: {cur.size[0]}x{cur.size[1]} -> {src.size[0]}x{src.size[1]}")
    for t in j["textures"]:  # point textures at the WebP through the extension
        if t.get("source") in webp_images:
            t.setdefault("extensions", {})["EXT_texture_webp"] = {"source": t.pop("source")}
    if webp_images:
        for k in ("extensionsUsed", "extensionsRequired"):
            j.setdefault(k, [])
            if "EXT_texture_webp" not in j[k]: j[k].append("EXT_texture_webp")
    nb = bytearray()  # rebuild BIN in view order
    for i, v in enumerate(j["bufferViews"]):
        data = new_views.get(i, view(j, b, i))
        nb += b"\0" * (-len(nb) % 4)  # keep every view 4-byte aligned
        v["byteOffset"] = len(nb); v["byteLength"] = len(data); nb += data
    nb += b"\0" * (-len(nb) % 4)
    j["buffers"][0]["byteLength"] = len(nb)
    js = json.dumps(j, separators=(",", ":")).encode(); js += b" " * (-len(js) % 4)  # JSON pads with spaces
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(nb))  # GLB header
    out += struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(nb), 0x004E4942) + bytes(nb)
    before = os.path.getsize(path); open(path, "wb").write(out)
    print(path, before, "->", len(out))

NAMES = {"sendagaya_shibu": "Sendagaya_Shibu", "sendagaya_shino": "Sendagaya_Shino", "vivi": "Vivi", "victoria_rubin": "Victoria_Rubin", "vita": "Vita", "sakurada_fumiriya": "Sakurada_Fumiriya", "hairsample_male": "HairSample_Male"}  # ours -> pixiv file
if __name__ == "__main__":
    orig_dir, models_dir = sys.argv[1], sys.argv[2]; max_px = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
    for ours, theirs in NAMES.items():
        print(ours); restore(os.path.join(orig_dir, theirs + ".vrm"), os.path.join(models_dir, ours + ".vrm"), max_px)
