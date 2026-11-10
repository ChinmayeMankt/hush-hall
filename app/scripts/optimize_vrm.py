#!/usr/bin/env python3
# Shrinks a VRM 0.x (VRoid) file for the web while keeping all VRM data:
#  - textures downscaled to <= MAX px (opaque ones re-encoded as JPEG)
#  - morph targets trimmed to the expressions we use (blink, joy, fun, a)
#  - unused buffer data dropped
# Usage: python3 optimize_vrm.py in.vrm out.vrm [max_px]
import io, json, struct, sys
from PIL import Image  # Pillow for texture resizing

KEEP = {"blink", "blink_l", "blink_r", "joy", "fun", "a"}  # VRM0 presets we animate

def read_glb(path):
    d = open(path, "rb").read()  # whole file
    jl = struct.unpack("<I", d[12:16])[0]  # JSON chunk length
    j = json.loads(d[20:20 + jl])  # JSON chunk
    bl = struct.unpack("<I", d[20 + jl:24 + jl])[0]  # BIN chunk length
    return j, d[28 + jl:28 + jl + bl]  # json + bin

def view_bytes(j, b, i):
    v = j["bufferViews"][i]  # one buffer view
    o = v.get("byteOffset", 0)  # start
    return b[o:o + v["byteLength"]]  # slice

def main(src, dst, max_px=512):
    j, b = read_glb(src)  # parse
    ext = j["extensions"]["VRM"]  # VRM 0.x extension
    blobs = {}  # bufferView index -> replacement bytes
    # 1) Textures: downscale, JPEG when fully opaque.
    for img in j["images"]:
        raw = view_bytes(j, b, img["bufferView"])  # encoded image
        im = Image.open(io.BytesIO(raw)); im.load()  # decode
        if max(im.size) > max_px:
            s = max_px / max(im.size)  # scale factor
            im = im.resize((max(1, round(im.size[0] * s)), max(1, round(im.size[1] * s))), Image.LANCZOS)  # resize
        rgba = im.convert("RGBA")  # for alpha check
        out = io.BytesIO()  # re-encode buffer
        if rgba.getextrema()[3][0] == 255:  # no transparency at all
            rgba.convert("RGB").save(out, "JPEG", quality=88); img["mimeType"] = "image/jpeg"  # small + fine for opaque
        else:
            rgba.save(out, "PNG", optimize=True); img["mimeType"] = "image/png"  # keep alpha
        blobs[img["bufferView"]] = out.getvalue()  # replace
    # 2) Morph targets: keep only those bound by the expressions we use.
    groups = ext["blendShapeMaster"]["blendShapeGroups"]  # expressions
    keep_idx = {}  # mesh index -> sorted kept morph indices
    for g in groups:
        if g["presetName"] in KEEP:
            for bd in g["binds"]:
                keep_idx.setdefault(bd["mesh"], set()).add(bd["index"])  # remember
    for mi, mesh in enumerate(j["meshes"]):
        if not any("targets" in p for p in mesh["primitives"]):
            continue  # no morphs here
        ks = sorted(keep_idx.get(mi, set()))  # kept indices
        remap = {o: n for n, o in enumerate(ks)}  # old -> new
        for p in mesh["primitives"]:
            if "targets" in p:
                p["targets"] = [p["targets"][o] for o in ks]  # trim
                if not p["targets"]: del p["targets"]  # none left
            ex = p.get("extras", {})
            if "targetNames" in ex: ex["targetNames"] = [ex["targetNames"][o] for o in ks]  # names
        if "weights" in mesh: mesh["weights"] = [mesh["weights"][o] for o in ks]  # default weights
        ex = mesh.get("extras", {})
        if "targetNames" in ex: ex["targetNames"] = [ex["targetNames"][o] for o in ks]  # names
        for g in groups:  # rewrite binds for this mesh
            nb = []
            for bd in g["binds"]:
                if bd["mesh"] != mi: nb.append(bd)  # other mesh
                elif bd["index"] in remap: nb.append({**bd, "index": remap[bd["index"]]})  # kept
            g["binds"] = nb
    # 3) Rebuild the binary with only referenced data.
    used_acc = set()  # accessor indices still referenced
    for mesh in j["meshes"]:
        for p in mesh["primitives"]:
            used_acc.update(p["attributes"].values())  # vertex data
            if "indices" in p: used_acc.add(p["indices"])  # index buffer
            for t in p.get("targets", []): used_acc.update(t.values())  # morphs
    for s in j.get("skins", []):
        if "inverseBindMatrices" in s: used_acc.add(s["inverseBindMatrices"])  # skinning
    acc_map, new_acc = {}, []  # old -> new accessor
    for i in sorted(used_acc):
        acc_map[i] = len(new_acc); new_acc.append(j["accessors"][i])  # compact list
    used_views = sorted({a["bufferView"] for a in new_acc if "bufferView" in a} | {im["bufferView"] for im in j["images"]})  # live views
    view_map, new_views, out = {}, [], bytearray()  # rebuilt buffer
    for vi in used_views:
        data = blobs.get(vi) or view_bytes(j, b, vi)  # bytes for this view
        while len(out) % 4: out.append(0)  # 4-byte alignment
        v = dict(j["bufferViews"][vi]); v["byteOffset"] = len(out); v["byteLength"] = len(data); v["buffer"] = 0  # new view
        view_map[vi] = len(new_views); new_views.append(v); out += data  # append
    for a in new_acc:
        if "bufferView" in a: a["bufferView"] = view_map[a["bufferView"]]  # remap
    for im in j["images"]: im["bufferView"] = view_map[im["bufferView"]]  # remap
    for mesh in j["meshes"]:
        for p in mesh["primitives"]:
            p["attributes"] = {k: acc_map[v] for k, v in p["attributes"].items()}  # remap
            if "indices" in p: p["indices"] = acc_map[p["indices"]]
            if "targets" in p: p["targets"] = [{k: acc_map[v] for k, v in t.items()} for t in p["targets"]]
    for s in j.get("skins", []):
        if "inverseBindMatrices" in s: s["inverseBindMatrices"] = acc_map[s["inverseBindMatrices"]]
    j["accessors"], j["bufferViews"] = new_acc, new_views  # swap in
    while len(out) % 4: out.append(0)  # pad BIN
    j["buffers"] = [{"byteLength": len(out)}]  # single buffer
    js = json.dumps(j, separators=(",", ":")).encode()  # JSON chunk
    js += b" " * (-len(js) % 4)  # pad JSON
    total = 12 + 8 + len(js) + 8 + len(out)  # file size
    with open(dst, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total))  # header
        f.write(struct.pack("<I4s", len(js), b"JSON")); f.write(js)  # JSON
        f.write(struct.pack("<I4s", len(out), b"BIN\0")); f.write(out)  # BIN

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 512)
