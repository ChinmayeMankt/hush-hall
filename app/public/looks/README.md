Bare-leg/foot variants of each VRoid sample's Body_00 skin texture.

`{character}.body-bare.webp` (1024x1024, lossless WebP) start from the
character's own body texture. Sock, tight and leg-warmer regions are painted
out as bare skin, and the two foot UV islands (top/toes and sole) are
repainted so bare feet read as natural anime feet:

- soles: the dark brown "shoe sole" paint VRoid leaves under shoes is
  replaced with soft, slightly rosier skin, with faint toe, ball and heel pads;
- toes: laid out in the foot's own 3D space (not along the UV island), so
  from above the big toe runs straight along the foot with a small shaded
  gap to the second toe that opens slightly at the tips; the other toes are
  graded shorter and angle gently inward as on a real foot, with crisp soft
  separations, small pale nails (the big-toe nail largest and square to the
  foot) and a light rosy tint at the toe tips. The toe-web rows still follow
  VRoid's own layout so the baked normal map shading lines up;
- ankle: the foot colour is blended into the leg colour at the seam where
  the foot and leg meshes meet, so no line shows at the ankle;
- heel: a faint rosy tint.

Bare-foot shape (components/three/barefeet.ts): with shoes off, the feet
also get a natural shape at load time — the pointed, shoe-shaped front is
folded back to the ball of the foot, five real toes per foot are added (big
toe straight, a small gap to the second toe, the others graded shorter and
curled slightly) and the inner arch is lifted a little. To go with it,
`scripts/paint_bare_toes.py` (run after `sharpen_bare_bodies.py`):

- paints a small toe swatch into an unused corner of each texture (texels
  x 246-302, y 699-733, plus 3 px padding; the toes' UVs point there): the
  character's foot skin, a rosy pad underneath and at the tip, soft shade at
  the sides and root, and a small pale nail on top;
- replaces the toes painted earlier at the front of the foot (now folded
  into the web between the new toes) with plain skin or sole colour;
- sets the same softened matcap shine for the swatch in `feet-rim-mask.png`.

Everything outside the painted legs and feet is the character's original
pixiv body texture at 1024 px (the same pixels the VRM files now use), put
back by `scripts/sharpen_bare_bodies.py` after each repaint, so arms, hands,
neck and torso stay as sharp barefoot as with shoes on. Texels VRoid cuts out
under clothes stay cut out. All textures are the characters' own CC0 VRoid art (pixiv Inc.);
no third-party images are used.

`feet-rim-mask.png` (256x256, greyscale) is a shared mask for the MToon
matcap shine (`rimMultiplyTexture`): white everywhere, darker on the toes
and soles only, so bare toes don't catch a plastic-looking glint. VRoid
uses the same foot UV layout on all seven characters, so one mask fits all.

Hush Hall swaps these onto the body material (main map, the MToon shade
slot and the matcap mask) when the wardrobe choice "Shoes and socks off" is
on (`look.shoes === "off"`), and lowers the body by the shoe-sole height so
bare soles rest on the floor. The original textures inside the VRM files are
never overwritten.
