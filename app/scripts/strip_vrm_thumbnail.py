#!/usr/bin/env python3
# Removes the embedded "Thumbnail" image from a VRM 0.x file. The thumbnail is
# only a store/preview picture: three-vrm never loads it (needThumbnailImage is
# off) and it is never drawn in the hall, so dropping it is visually lossless.
# Every other byte (meshes, textures, materials, VRM data) is kept exactly.
# Only handles the case where the thumbnail is the last image, texture and
# buffer view (true for all our VRoid samples), so no other index shifts.
# Usage: python3 strip_vrm_thumbnail.py file.vrm [more.vrm ...]   (edits in place)
import json, struct, sys

def strip(path):
    d = open(path, "rb").read()  # whole GLB
    jl = struct.unpack("<I", d[12:16])[0]  # JSON chunk length
    j = json.loads(d[20:20 + jl])  # JSON chunk
    bl = struct.unpack("<I", d[20 + jl:24 + jl])[0]  # BIN chunk length
    b = d[28 + jl:28 + jl + bl]  # BIN chunk
    imgs = j["images"]  # all images
    ti = len(imgs) - 1  # thumbnail must be the last image
    if imgs[ti].get("name") != "Thumbnail": print(path, "no trailing thumbnail, skipped"); return  # nothing safe to do
    bv = imgs[ti]["bufferView"]  # its bytes
    assert bv == len(j["bufferViews"]) - 1, "thumbnail buffer view is not last"  # no index shifts allowed
    assert j["textures"][-1]["source"] == ti and sum(t["source"] == ti for t in j["textures"]) == 1, "thumbnail texture is not last"  # same for textures
    tex = len(j["textures"]) - 1  # thumbnail texture index
    assert j["extensions"]["VRM"]["meta"].get("texture") == tex  # only the meta points at it
    start = j["bufferViews"][bv].get("byteOffset", 0)  # where its bytes begin
    assert all(v.get("byteOffset", 0) + v["byteLength"] <= start for v in j["bufferViews"][:-1]), "thumbnail bytes are not at the end"  # safe to cut the tail
    j["images"].pop(); j["textures"].pop(); j["bufferViews"].pop()  # drop image, texture, view
    j["extensions"]["VRM"]["meta"]["texture"] = -1  # VRM 0.x "no thumbnail"
    nb = b[:start]  # binary without the thumbnail tail
    nb += b"\0" * (-len(nb) % 4)  # 4-byte alignment
    j["buffers"][0]["byteLength"] = len(nb)  # new buffer size
    js = json.dumps(j, separators=(",", ":")).encode()  # compact JSON
    js += b" " * (-len(js) % 4)  # JSON pads with spaces
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(nb))  # GLB header
    out += struct.pack("<II", len(js), 0x4E4F534A) + js  # JSON chunk
    out += struct.pack("<II", len(nb), 0x004E4942) + nb  # BIN chunk
    open(path, "wb").write(out)  # write back
    print(path, len(d), "->", len(out))  # report

for p in sys.argv[1:]: strip(p)  # each file
