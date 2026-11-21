#!/usr/bin/env python3
"""
Builds wwwroot/css/room-themes.css: the meeting room (Views/Meetings/Room.cshtml) in every theme.

The room's own styles (the "meeting room" part of css/site.css) are written for a dark studio. The room now
opens in the theme the person chose, so this script repeats every room rule that uses a colour, for:

  * Light and Kesari (html[data-theme="light"]): white glass instead of dark glass, dark words instead of
    light ones, soft shadows. Kesari then also swaps blue / purple / pink for saffron / green
    (the same colour map as tools/gen_kesari.py).
  * Dark (html.sn-carbon): the navy and violet tints become neutral greys.
  * CloudWheel: the room as it was (nothing generated).

The video itself (stage, your own picture, the "waiting" card on the stage, reactions flying over the video)
stays dark in every theme: faces and shared screens read best on a dark frame.

Run after changing the room's styles:  python3 tools/gen_room_themes.py
The hand-written part (backgrounds, the aurora) is tools/room_themes_extra.css, added at the end.
"""
import os, re, sys, colorsys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CSS = os.path.join(ROOT, "wwwroot", "css")
sys.path.insert(0, HERE)
import gen_kesari as K          # its CSS reader and its blue/pink/purple -> saffron/green map

SOURCE = os.path.join(CSS, "site.css")
START = "/* ---------- meeting room (dark) ---------- */"
OUT = os.path.join(CSS, "room-themes.css")
EXTRA = os.path.join(HERE, "room_themes_extra.css")

LIGHT = 'html[data-theme="light"]'
KESARI = 'html[data-skin="kesari"]'
CARBON = 'html[data-theme="dark"].sn-carbon'

# classes the room puts on <body> (room.js): a selector that starts with one of them belongs on the body itself
BODY_STATES = {"is-full", "panel-off", "no-anim", "is-sharing", "tile-on", "alone", "panel-max", "panel-popped", "on-hold", "sn-popout"}
# parts that sit on (or are) the video: they keep their dark look
ON_VIDEO = re.compile(r"\.(stage|stage-[\w-]+|self-view|self-show|sv-[\w-]+|orbit|react-layer|react-float|rf-[\w-]+|react-spark|studio-bg|sw-[\w-]+|hold-screen|hs-[\w-]+)\b")

COLOR = re.compile(r"#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)|\bwhite\b")

def parse(c):
    c = c.strip()
    if c.lower() == "white": return (255, 255, 255, 1.0)
    if c.startswith("#"):
        h = c[1:]
        if len(h) == 3: h = "".join(x * 2 for x in h)
        a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)
    n = [x.strip() for x in c[c.index("(") + 1:-1].split(",")]
    return (int(n[0]), int(n[1]), int(n[2]), float(n[3]) if len(n) > 3 else 1.0)

def fmt(r, g, b, a):
    if a >= .999: return "#%02X%02X%02X" % (r, g, b)
    a = round(a, 2)
    return f"rgba({r}, {g}, {b}, {('%g' % a).lstrip('0') if a < 1 else '1'})"

def hls(r, g, b):
    return colorsys.rgb_to_hls(r / 255, g / 255, b / 255)

def is_dark(r, g, b):  return hls(r, g, b)[1] < .22
def is_whiteish(r, g, b): h, l, s = hls(r, g, b); return l > .97 or (l > .9 and s < .3)
def is_lightgrey(r, g, b): h, l, s = hls(r, g, b); return .55 < l <= .97 and (s < .35 or l > .85)
def is_bright(r, g, b, a): h, l, s = hls(r, g, b); return a >= .5 and s > .35 and .2 < l < .8

# light accents drawn for a dark ground -> their darker shade for a light ground
LIGHT_TEXT = {
    "F8FAFC": "0F172A", "F1F5F9": "0F172A", "E2E8F0": "1E293B", "CBD5E1": "334155", "94A3B8": "64748B",
    "A78BFA": "6D28D9", "C4B5FD": "6D28D9", "DDD6FE": "6D28D9", "E9D5FF": "7E22CE", "93C5FD": "1D4ED8",
    "FCA5A5": "DC2626", "F87171": "DC2626", "FDE68A": "B45309", "FBBF24": "B45309", "4ADE80": "15803D",
    "86EFAC": "15803D", "F9A8D4": "BE185D", "F472B6": "BE185D",
}
# Dark (carbon): navy / violet tints -> neutral greys
NEUTRAL_TEXT = {"94A3B8": "A1A1AA", "CBD5E1": "D4D4D8", "E2E8F0": "E4E4E7", "F1F5F9": "F4F4F5", "F8FAFC": "FAFAFA",
                "A78BFA": "D4D4D8", "C4B5FD": "D4D4D8", "DDD6FE": "E4E4E7", "E9D5FF": "E4E4E7"}
VIOLET_RGB = {(139, 92, 246), (167, 139, 250), (124, 58, 237), (79, 70, 229), (196, 181, 253)}

def kesari_hue(c):
    """Kesari: any blue, violet or pink the colour map does not know -> saffron (blue, violet) or green (pink)."""
    r, g, b, a = parse(c)
    h, l, s = hls(r, g, b)
    deg = h * 360
    if s < .3 or not (190 <= deg <= 345): return c
    nh = 140 / 360 if deg >= 300 else 24 / 360
    nr, ng, nb = colorsys.hls_to_rgb(nh, l, s)
    return fmt(round(nr * 255), round(ng * 255), round(nb * 255), a)

def colored_ground(decls):
    """True when the rule paints a strong colour (a red Leave button, a violet badge): its white text stays."""
    for name, val in decls:
        if name.startswith("background"):
            for m in COLOR.finditer(val):
                if is_bright(*parse(m.group(0))): return True
            if "var(--" in val: return True
    return False

def light_color(c, prop, ctx, keep_white):
    r, g, b, a = parse(c)
    hx = "%02X%02X%02X" % (r, g, b)
    if prop in ("color", "-webkit-text-fill-color", "fill", "stroke", "caret-color", "outline-color", "text-decoration-color"):
        if keep_white: return c
        if is_whiteish(r, g, b): return fmt(15, 23, 42, a if a < 1 else 1)
        if hx in LIGHT_TEXT:
            h = LIGHT_TEXT[hx]; return fmt(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)
        hh, l, sat = hls(r, g, b)
        if l > .62:                                          # any other pale tint: the same hue, dark enough to read
            if sat < .2: return fmt(51, 65, 85, a)
            nr, ng, nb = colorsys.hls_to_rgb(hh, .34, max(sat, .65))
            return fmt(round(nr * 255), round(ng * 255), round(nb * 255), a)
        return c
    if prop.startswith("background"):
        if is_whiteish(r, g, b) and a < .5: return fmt(15, 23, 42, max(.035, a * .7))
        if is_dark(r, g, b): return fmt(255, 255, 255, min(.94, max(.5, a * .9 + .12)))
        return c
    if prop.startswith("border") or prop.startswith("outline") or prop == "column-rule":
        if is_whiteish(r, g, b) and a < .5: return fmt(15, 23, 42, max(.07, min(.16, a * .8)))
        if is_dark(r, g, b): return fmt(15, 23, 42, .1)
        return c
    if prop in ("box-shadow", "text-shadow"):
        if is_whiteish(r, g, b) and a < .6:
            return fmt(15, 23, 42, max(.06, min(.14, a * .8))) if ctx == "ring" else c
        if is_dark(r, g, b): return fmt(30, 41, 99, round(min(.32, a * .45), 2))
        return c
    return c

def carbon_color(c):
    r, g, b, a = parse(c)
    hx = "%02X%02X%02X" % (r, g, b)
    if hx in NEUTRAL_TEXT:
        h = NEUTRAL_TEXT[hx]; return fmt(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)
    if (r, g, b) in VIOLET_RGB and a < .6: return fmt(255, 255, 255, round(min(.22, a * .8), 2))
    if is_dark(r, g, b) and b > r + 6:                       # a navy: the same darkness in neutral grey
        y = round(.3 * r + .59 * g + .11 * b) + 4
        return fmt(y, y, y, a)
    return c

def map_shadow(val, fn):
    parts = K.split_top(val, ",")
    out = []
    for p in parts:
        ctx = "ring" if re.match(r"\s*inset\s+0(px)?\s+0(px)?\s+0(px)?\s", p) else "drop"
        out.append(COLOR.sub(lambda m: fn(m.group(0), ctx), p))
    return ",".join(out)

def prefix(sel, root):
    s = sel.strip()
    if not s or s.startswith(("html", ":root", "body")): return None
    first = re.split(r"[\s>+~]", s, maxsplit=1)[0]
    rest = s[len(first):]
    classes = set(re.findall(r"\.([\w-]+)", first))
    if "room-body" in classes:
        return f"{root} body{first}{rest}"
    if classes & BODY_STATES and not first.startswith(("*", "[")) and re.fullmatch(r"(\.[\w-]+)+(:[\w()-]+)*", first):
        return f"{root} body.room-body{first}{rest}"
    return f"{root} body.room-body {s}"

def convert(css, mode):
    out = []
    for prelude, body in K.blocks(css):
        if body is None: continue
        low = prelude.lower()
        if low.startswith(("@media", "@supports", "@container")):
            inner = convert(body, mode)
            if inner.strip(): out.append(f"{prelude} {{\n{inner}}}\n")
            continue
        if low.startswith("@"): continue
        sels_raw = K.split_top(prelude, ",")
        if mode != "carbon":
            sels_raw = [x for x in sels_raw if not ON_VIDEO.search(x)]
        decls = []
        for d in K.split_top(body, ";"):
            if ":" not in d: continue
            n, v = d.split(":", 1)
            decls.append((n.strip().lower(), v.strip()))
        keep_white = colored_ground(decls)
        new = []
        for n, v in decls:
            if n.startswith("--"): continue
            if mode == "carbon":
                nv = COLOR.sub(lambda m: carbon_color(m.group(0)), v)
            else:
                if n in ("box-shadow", "text-shadow"):
                    nv = map_shadow(v, lambda c, ctx: light_color(c, n, ctx, keep_white))
                else:
                    nv = COLOR.sub(lambda m: light_color(m.group(0), n, "", keep_white), v)
                if mode == "kesari":
                    lv = nv
                    nv = COLOR.sub(lambda m: kesari_hue(m.group(0)), K.map_value(nv))
                    if nv == lv: continue                    # the Light rule already says this
            if nv != v: new.append(f"{n}: {nv}")
        if not new: continue
        root = {"light": LIGHT, "kesari": KESARI, "carbon": CARBON}[mode]
        sels = [x for x in (prefix(p, root) for p in sels_raw) if x]
        if sels: out.append(", ".join(sels) + " { " + "; ".join(new) + "; }\n")
    return "".join(out)

def main():
    text = open(SOURCE, encoding="utf-8-sig").read()
    if START not in text: sys.exit("site.css: the meeting room part was not found")
    room = K.strip_comments(text[text.index(START):])
    parts = ["/* =====================================================================\n"
             "   ShankhNaad · room-themes.css: the meeting room in Light, Kesari and Dark (CloudWheel is site.css as is).\n"
             "   GENERATED by tools/gen_room_themes.py from the meeting-room part of css/site.css\n"
             "   + tools/room_themes_extra.css at the end. Regenerate after changing the room's styles.\n"
             "   The video (stage, your own picture) stays dark in every theme.\n"
             "   ===================================================================== */\n",
             "/* ---- Light and Kesari ---- */\n", convert(room, "light"),
             "/* ---- Kesari: saffron and green ---- */\n", convert(room, "kesari"),
             "/* ---- Dark: neutral greys ---- */\n", convert(room, "carbon")]
    if os.path.exists(EXTRA):
        parts.append("/* ---- hand-written (tools/room_themes_extra.css) ---- */\n" + open(EXTRA, encoding="utf-8").read())
    open(OUT, "w", encoding="utf-8", newline="\n").write("".join(parts))
    print(f"wrote {OUT}: {sum(len(p) for p in parts)} characters")

if __name__ == "__main__":
    main()
