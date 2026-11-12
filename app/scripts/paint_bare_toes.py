#!/usr/bin/env python3
# Paints the bare-foot toe art that goes with the toe geometry in
# components/three/barefeet.ts, into each character's bare-body texture
# (public/looks/*.body-bare.webp), and tones down the matcap shine there in
# public/looks/feet-rim-mask.png.
#
#  1) Toe swatch: barefeet.ts gives every generated toe UVs on a small swatch in
#     an unused corner of the body texture (TOE_SWATCH there; same numbers here).
#     Columns go once round the toe (bottom, inner side, top, outer side,
#     bottom), rows run from the tip back along the toe. The swatch gets the
#     character's own foot skin, a slightly rosier pad underneath and at the
#     tip, soft shade down the sides and at the root (where toes press
#     together), and a small pale nail with a soft rim and highlight on top.
#  2) Old painted toes: the front of VRoid's shoe-shaped foot is folded back
#     into the web between the new toes, so the toes, nails and creases painted
#     there earlier are replaced with plain skin (top) or sole colour (under),
#     shading a little darker toward the web.
# Texel positions on the foot come from the model itself (the foot triangles
# are rasterised in UV space with their rest-pose 3D positions), using the same
# foot frame and toe-root line as barefeet.ts.
#
# Run after scripts/sharpen_bare_bodies.py (that one rebuilds the textures
# from the older paint; this one goes on top). Re-running is safe.
# Usage: python3 scripts/paint_bare_toes.py [public/models] [public/looks]
import io, json, os, struct, sys
import numpy as np
from PIL import Image
from scipy import ndimage as nd

NAMES = ["sendagaya_shibu", "sendagaya_shino", "vivi", "victoria_rubin", "vita", "sakurada_fumiriya", "hairsample_male"]
R = 1024  # texture size
SW = dict(left=246, right=302, tip=699, root=733)  # TOE_SWATCH in barefeet.ts (texels)
SW_PAD = 3  # texels of padding round the swatch (mipmaps)
SW_WIDTHS, SW_POW = 2.6, 0.7  # SWATCH_WIDTHS, SWATCH_POW in barefeet.ts
UR0, UROOT_BACK = 0.135, 0.075  # toe-root line in barefeet.ts: uTip - 0.135 L, sweeping back 0.075 L * lat^1.3
WEB = 0.008  # web line: root + 0.008 L

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}

def read_glb(path):
    d = open(path, "rb").read(); off = 12; js = b = None
    while off < len(d):
        ln, ty = struct.unpack("<II", d[off:off + 8]); c = d[off + 8:off + 8 + ln]
        if ty == 0x4E4F534A: js = json.loads(c)
        else: b = c
        off += 8 + ln
    return js, b

def acc(js, b, i):
    a = js["accessors"][i]; v = js["bufferViews"][a["bufferView"]]; o = v.get("byteOffset", 0) + a.get("byteOffset", 0)
    n = NC[a["type"]]; dt = np.dtype(CT[a["componentType"]]); st = v.get("byteStride", 0) or n * dt.itemsize
    raw = np.frombuffer(b, dtype=np.uint8, count=st * (a["count"] - 1) + n * dt.itemsize, offset=o)
    out = np.lib.stride_tricks.as_strided(raw, shape=(a["count"], n * dt.itemsize), strides=(st, 1)).copy().view(dt).reshape(a["count"], n)
    if a.get("normalized") and dt.kind in "iu": out = out.astype(np.float32) / np.iinfo(dt).max
    return out

def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def blend(img, col, a):
    a = np.clip(a, 0, 1)[..., None]; return img * (1 - a) + np.asarray(col, float) * a

def feet(path):
    """Rasterise each foot's triangles in UV space: per texel (u along the foot, s across, normal y), plus the frame."""
    js, b = read_glb(path)
    out = []
    for mi, m in enumerate(js["meshes"]):
        prims = [p for p in m["primitives"] if "Body_00_SKIN" in js["materials"][p["material"]]["name"]]
        if not prims: continue
        node = [x for x in js["nodes"] if x.get("mesh") == mi][0]; skin = js["skins"][node["skin"]]
        names = [js["nodes"][j]["name"] for j in skin["joints"]]
        ibm = acc(js, b, skin["inverseBindMatrices"]).reshape(-1, 4, 4)
        jpos = lambda nm: np.linalg.inv(ibm[names.index(nm)].T)[:3, 3]  # bone origin in bind space (column-major)
        a0 = prims[0]["attributes"]
        P = acc(js, b, a0["POSITION"]); J = acc(js, b, a0["JOINTS_0"]); W = acc(js, b, a0["WEIGHTS_0"]); UV = acc(js, b, a0["TEXCOORD_0"]); N = acc(js, b, a0["NORMAL"])
        tris = np.concatenate([acc(js, b, p["indices"]).ravel() for p in prims]).reshape(-1, 3)
        used = np.unique(tris)
        for side, other in (("L", "R"), ("R", "L")):
            fi, ti = names.index(f"J_Bip_{side}_Foot"), names.index(f"J_Bip_{side}_ToeBase")
            w = ((J == fi) * W).sum(1) + ((J == ti) * W).sum(1)
            ids = used[w[used] >= 0.5]
            JT, JF, JO = jpos(f"J_Bip_{side}_ToeBase"), jpos(f"J_Bip_{side}_Foot"), jpos(f"J_Bip_{other}_ToeBase")
            fwd = JT - JF; fwd[1] = 0; fwd /= np.linalg.norm(fwd)
            med = np.array([fwd[2], 0, -fwd[0]])
            if med @ (JO - JT) < 0: med = -med
            U = (P - JT) @ fwd; S = (P - JT) @ med
            soleY = P[ids, 1].min(); uTip = U[ids].max(); uHeel = U[ids].min(); L = uTip - uHeel
            band = ids[(U[ids] > -0.07 * L) & (U[ids] < 0.02 * L)]
            sMed, sLat = S[band].max(), S[band].min(); Wb = sMed - sLat
            # rasterise this foot's triangles (all three corners on the foot)
            inf = np.zeros(len(P), bool); inf[ids] = True
            ft = tris[inf[tris].all(1)]
            mu = np.full((R, R), np.nan); ms = np.full((R, R), np.nan); mny = np.full((R, R), np.nan)
            for t in ft:
                q = UV[t] * R - 0.5  # texel-centre coordinates
                x0, y0 = np.floor(q.min(0)).astype(int); x1, y1 = np.ceil(q.max(0)).astype(int)
                X, Y = np.meshgrid(np.arange(max(x0, 0), min(x1, R - 1) + 1), np.arange(max(y0, 0), min(y1, R - 1) + 1))
                (ax, ay), (bx, by), (cx, cy) = q
                den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
                if abs(den) < 1e-12: continue
                l0 = ((by - cy) * (X - cx) + (cx - bx) * (Y - cy)) / den; l1 = ((cy - ay) * (X - cx) + (ax - cx) * (Y - cy)) / den; l2 = 1 - l0 - l1
                ins = (l0 >= -0.02) & (l1 >= -0.02) & (l2 >= -0.02)
                if not ins.any(): continue
                L3 = np.stack([l0, l1, l2], -1)[ins]
                mu[Y[ins], X[ins]] = L3 @ U[t]; ms[Y[ins], X[ins]] = L3 @ S[t]; mny[Y[ins], X[ins]] = L3 @ N[t][:, 1]
            out.append(dict(side=side, u=mu, s=ms, ny=mny, L=L, uTip=uTip, uHeel=uHeel, sMed=sMed, Wb=Wb))
    return out

def paint(name, models, looks):
    path = os.path.join(looks, f"{name}.body-bare.webp")
    im = Image.open(path); mode = im.mode; rgba = np.asarray(im.convert("RGBA")).astype(float)
    rgb = rgba[..., :3].copy()
    pink = np.array([243, 178, 170.0])
    skins = []
    for f in feet(os.path.join(models, f"{name}.vrm")):
        u, s, ny, L = f["u"], f["s"], f["ny"], f["L"]
        isl = ~np.isnan(u)
        lat = np.clip((f["sMed"] - np.nan_to_num(s)) / f["Wb"], 0, 1)
        root = (f["uTip"] - UR0 * L) - UROOT_BACK * L * lat ** 1.3  # toe-root line under this texel
        rel = (np.nan_to_num(u, nan=-9) - root) / L  # + = in front of the root line
        top = isl & (np.nan_to_num(ny) > -0.35); sole = isl & (np.nan_to_num(ny) <= -0.35)
        inst = top & (rel > -0.45) & (rel < -0.2)  # instep: the reference skin colour
        skin = np.median(rgb[inst], 0); skins.append(skin)
        ref_sole = sole & (rel > -0.3) & (rel < -0.12)
        sole_col = np.median(rgb[ref_sole], 0) if ref_sole.any() else skin * np.array([0.99, 0.95, 0.95])
        # smooth skin to fill with: mask-aware blur of what is behind the toes
        for m, col in ((top, skin), (sole, sole_col)):
            keep = m & (rel < -0.06)
            k = keep.astype(float)
            bl = np.stack([nd.gaussian_filter(rgb[..., c] * k, 6) for c in range(3)], -1) / (nd.gaussian_filter(k, 6)[..., None] + 1e-6)
            bl = np.where((nd.gaussian_filter(k, 6) > 0.02)[..., None], bl, col)
            a = smooth(-0.06, -0.025, rel)  # 0 behind .. 1 at the toe roots
            fill = bl * 0.85 + col * 0.15
            if m is top: fill = blend(fill, skin * np.array([0.9, 0.8, 0.77]), 0.45 * smooth(WEB - 0.01, WEB + 0.01, rel))  # web between the toes: soft shade
            else: fill = blend(fill, pink, 0.18)
            new = rgb * (1 - a[..., None]) + fill * a[..., None]
            rgb[m] = new[m]
    skin = np.mean(skins, 0)
    # toe swatch
    x0, x1, y0, y1 = SW["left"], SW["right"], SW["tip"], SW["root"]
    Y, X = np.mgrid[0:R, 0:R].astype(float)
    c = (X - x0) / (x1 - x0)  # 0..1 round the toe (0 and 1 underneath, 0.5 on top)
    r = np.clip((Y - y0) / (y1 - y0), 0, 1) ** (1 / SW_POW) * SW_WIDTHS  # toe widths back from the tip
    box = (X >= x0 - SW_PAD) & (X <= x1 + SW_PAD) & (Y >= y0 - SW_PAD) & (Y <= y1 + SW_PAD)
    ang = np.cos(2 * np.pi * np.clip(c, 0, 1))  # 1 underneath, -1 on top
    col = np.broadcast_to(skin, rgb.shape).copy()
    col = blend(col, skin * np.array([0.99, 0.93, 0.92]) * 0.5 + pink * 0.5, 0.55 * smooth(0.3, 0.85, ang))  # rosy pad underneath
    col = blend(col, pink, 0.22 * smooth(0.9, 0.15, r))  # rosy tip
    col = blend(col, skin * np.array([0.88, 0.78, 0.75]), 0.22 * np.exp(-(ang / 0.35) ** 2) * smooth(0.4, 1.2, r))  # sides, where toes touch
    col = blend(col, skin * np.array([0.86, 0.75, 0.72]), 0.3 * smooth(1.6, 2.4, r))  # root: shade where it meets the foot
    col = blend(col, np.minimum(skin * 1.04 + 5, 255), 0.25 * smooth(-0.5, -0.95, ang) * smooth(2.0, 1.2, r))  # soft highlight down the top
    # nail
    nc = (c - 0.5) / 0.11; nr = (r - 0.42) / 0.3  # nail centred on top, from 0.12 to 0.72 toe widths back
    rr = (np.abs(nc) ** 3.0 + np.abs(nr) ** 3.0) ** (1 / 3.0)  # rounded rectangle
    px = 1.0 / 5.5  # about one texel in nail units
    inside = np.clip((1 - rr) / px + 0.5, 0, 1)
    ring = np.clip(1 - np.abs(rr - 1) / (px * 1.2), 0, 1)
    grad = np.clip(1 - (r - 0.12) / 0.6, 0, 1)  # 0 cuticle .. 1 free edge
    bed = skin * 0.6 + np.array([246, 198, 192.0]) * 0.4; free = skin * 0.45 + np.array([255, 244, 240.0]) * 0.55
    nail = bed * (1 - grad[..., None] * 0.75) + free * (grad[..., None] * 0.75)
    col = col * (1 - 0.9 * inside[..., None]) + nail * 0.9 * inside[..., None]
    col = blend(col, skin * np.array([0.82, 0.67, 0.63]), ring * 0.32 * (1 - 0.5 * grad))  # soft rim, lighter toward the free edge
    hl = np.exp(-(((c - 0.47) / 0.035) ** 2 + ((r - 0.36) / 0.12) ** 2))
    col = blend(col, (255, 250, 247), 0.5 * hl * inside)
    rgb[box] = col[box]
    rgba[..., :3] = rgb; rgba[box, 3] = 255
    out = Image.fromarray(np.clip(rgba + 0.5, 0, 255).astype(np.uint8), "RGBA")
    if mode == "RGB": out = out.convert("RGB")
    out.save(path, "WEBP", lossless=True, quality=100, method=6, exact=True)
    print(name, "skin", skin.round(1), os.path.getsize(path), "bytes")

def rim_mask(looks):
    p = os.path.join(looks, "feet-rim-mask.png"); m = np.asarray(Image.open(p).convert("L")).astype(float)
    s = m.shape[0] / R
    Y, X = np.mgrid[0:m.shape[0], 0:m.shape[1]] / s
    box = (X >= SW["left"] - SW_PAD) & (X <= SW["right"] + SW_PAD) & (Y >= SW["tip"] - SW_PAD) & (Y <= SW["root"] + SW_PAD)
    m[box] = 102  # same softened shine as the old painted toes
    Image.fromarray(m.astype(np.uint8), "L").save(p, optimize=True)

if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    models = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "public", "models")
    looks = sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, "..", "public", "looks")
    for n in NAMES: paint(n, models, looks)
    rim_mask(looks)
