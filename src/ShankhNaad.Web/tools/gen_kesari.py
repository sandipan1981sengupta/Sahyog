#!/usr/bin/env python3
"""
ShankhNaad · builds wwwroot/css/theme-kesari.css, the "Kesari" theme (saffron, white and green).

Kesari is a light theme (data-theme="light", data-skin="kesari"). This script reads the light rules of the
app's style sheets and repeats every rule that uses a brand colour for html[data-skin="kesari"], with:
  blue   -> saffron         (#2563EB -> #EA580C …)
  pink   -> green           (#DB2777 -> #15803D …)
  purple -> deep saffron (#7C3AED -> #C2410C …); inside a gradient with pink it turns green
  a gradient that ran blue … pink now runs saffron | green (a clean split, no muddy brown in the middle)
Rules for the dark themes are left out. The hand-written part (background, spheres, theme menu swatch)
is added at the end from tools/kesari_extra.css.

Run from the project folder after changing a style sheet:  python3 tools/gen_kesari.py
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CSS = os.path.join(ROOT, "wwwroot", "css")
def bundle_sources():
    """The layout bundle's own style sheets (Infrastructure/AssetBundles.cs), in order: libraries, the other
    themes and the popup glass are left out."""
    text = open(os.path.join(ROOT, "Infrastructure", "AssetBundles.cs"), encoding="utf-8").read()
    block = text[text.index('["layout.css"]'):]
    block = block[:block.index("}")]                 # only the layout list, not the bundles after it
    files = re.findall(r'"css/([^"]+\.css)"', block)
    skip = {"theme-dark.css", "theme-kesari.css", "popups-glass.css", "safari.css"}
    return [f for f in files if f not in skip]

SOURCES = bundle_sources() + [f for f in ["shankhnaad-auth.css"] if f not in bundle_sources()]   # the sign-in pages follow the chosen theme too
OUT = os.path.join(CSS, "theme-kesari.css")
EXTRA = os.path.join(HERE, "kesari_extra.css")
SKIN = 'html[data-skin="kesari"]'

# ---------------------------------------------------------------- colours
BLUE = {   # -> saffron
    "2563EB": "EA580C", "1D4ED8": "C2410C", "1E40AF": "9A3412", "1E3A8A": "7C2D12", "3B82F6": "F97316",
    "60A5FA": "FB923C", "93C5FD": "FDBA74", "BFDBFE": "FED7AA", "DBEAFE": "FFEDD5", "EFF6FF": "FFF7ED",
    "0EA5E9": "F59E0B", "38BDF8": "FBBF24", "7DD3FC": "FCD34D", "BAE6FD": "FDE68A", "E0F2FE": "FEF3C7",
    "F0F9FF": "FFFBEB", "0284C7": "D97706", "0369A1": "B45309",
}
PINK = {   # -> green
    "DB2777": "15803D", "BE185D": "166534", "9D174D": "14532D", "EC4899": "16A34A", "F472B6": "4ADE80",
    "F9A8D4": "86EFAC", "FBCFE8": "BBF7D0", "FCE7F3": "DCFCE7", "FDF2F8": "F0FDF4", "C026D3": "15803D",
    "E879F9": "4ADE80", "D946EF": "16A34A",
}
PURPLE_NAVY = {   # purple / indigo -> navy (outside gradients)
    "7C3AED": "1E3A8A", "6D28D9": "1E3A8A", "5B21B6": "172554", "4C1D95": "172554", "8B5CF6": "2F4FA8",
    "A78BFA": "6B83C9", "C4B5FD": "A9B8E3", "DDD6FE": "D3DCF2", "EDE9FE": "E8EDF8", "F5F3FF": "F4F6FC",
    "4F46E5": "1E3A8A", "4338CA": "172554", "6366F1": "2F4FA8", "818CF8": "6B83C9", "A5B4FC": "A9B8E3",
    "C7D2FE": "C9D3EE", "E0E7FF": "E2E8F6", "EEF2FF": "F1F4FA", "9333EA": "1E3A8A", "A855F7": "2F4FA8",
}
PURPLE_SAFFRON = {   # purple inside a gradient that also has blue / saffron
    "7C3AED": "C2410C", "6D28D9": "9A3412", "5B21B6": "7C2D12", "4C1D95": "7C2D12", "8B5CF6": "EA580C",
    "A78BFA": "FB923C", "C4B5FD": "FDBA74", "DDD6FE": "FED7AA", "EDE9FE": "FFEDD5", "F5F3FF": "FFF7ED",
    "4F46E5": "C2410C", "4338CA": "9A3412", "6366F1": "EA580C", "818CF8": "FB923C", "A5B4FC": "FDBA74",
    "C7D2FE": "FED7AA", "E0E7FF": "FFEDD5", "EEF2FF": "FFF7ED", "9333EA": "C2410C", "A855F7": "EA580C",
}
PURPLE_GREEN = {   # purple inside a gradient that also has pink / green (no blue)
    "7C3AED": "166534", "6D28D9": "14532D", "5B21B6": "14532D", "4C1D95": "14532D", "8B5CF6": "16A34A",
    "A78BFA": "4ADE80", "C4B5FD": "86EFAC", "DDD6FE": "BBF7D0", "EDE9FE": "DCFCE7", "F5F3FF": "F0FDF4",
    "4F46E5": "166534", "4338CA": "14532D", "6366F1": "16A34A", "818CF8": "4ADE80", "A5B4FC": "86EFAC",
    "C7D2FE": "BBF7D0", "E0E7FF": "DCFCE7", "EEF2FF": "F0FDF4", "9333EA": "166534", "A855F7": "16A34A",
}
PAGE = {"E6ECFB": "FFF4E8", "ECEEF8": "FFFDF9", "F7EAF2": "EEF8EE"}   # the light page background
SAFFRON_KNOWN = {"EA580C", "F97316", "FB923C", "F59E0B", "C2410C"}   # already orange: counts as the saffron side

def rgb_of(h):
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

def triplets(table):
    return {rgb_of(k): rgb_of(v) for k, v in table.items()}

T_BLUE, T_PINK, T_PN, T_PS, T_PG = (triplets(t) for t in (BLUE, PINK, PURPLE_NAVY, PURPLE_SAFFRON, PURPLE_GREEN))

HEX = re.compile(r"#([0-9a-fA-F]{8}|[0-9a-fA-F]{6})\b")
RGB = re.compile(r"(rgba?\(\s*)(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})")
SPLIT = "#FF8A1F 0%, #F97316 46%, #15803D 54%, #138808 100%"

def families(text):
    fam = set()
    for m in HEX.finditer(text):
        h = m.group(1)[:6].upper()
        if h in BLUE or h in SAFFRON_KNOWN: fam.add("B")
        elif h in PINK: fam.add("K")
        elif h in PURPLE_NAVY: fam.add("P")
        elif h in PAGE: fam.add("G")
    for m in RGB.finditer(text):
        t = (int(m.group(2)), int(m.group(3)), int(m.group(4)))
        if t in T_BLUE or t in (rgb_of(x) for x in SAFFRON_KNOWN): fam.add("B")
        elif t in T_PINK: fam.add("K")
        elif t in T_PN: fam.add("P")
    return fam

def map_colors(text, purple_hex, purple_rgb):
    def hx(m):
        full = m.group(1)
        h, alpha = full[:6].upper(), full[6:]
        for table in (BLUE, PINK, purple_hex, PAGE):
            if h in table:
                return "#" + table[h] + alpha
        return m.group(0)
    def rg(m):
        t = (int(m.group(2)), int(m.group(3)), int(m.group(4)))
        for table in (T_BLUE, T_PINK, purple_rgb):
            if t in table:
                r, g, b = table[t]
                return f"{m.group(1)}{r}, {g}, {b}"
        return m.group(0)
    return RGB.sub(rg, HEX.sub(hx, text))

GRAD = re.compile(r"(repeating-)?(linear|radial|conic)-gradient\(", re.I)

def map_value(v):
    out, i = [], 0
    while True:
        m = GRAD.search(v, i)
        if not m:
            out.append(map_colors(v[i:], PURPLE_SAFFRON, T_PS))
            break
        out.append(map_colors(v[i:m.start()], PURPLE_SAFFRON, T_PS))
        depth, j = 1, m.end()
        while j < len(v) and depth:
            depth += {"(": 1, ")": -1}.get(v[j], 0)
            j += 1
        g = v[m.start():j]
        fam = families(g)
        if "B" in fam and "K" in fam and m.group(2).lower() == "linear":
            inner = g[m.end() - m.start():-1]
            first = inner.split(",")[0].strip()
            head = first + ", " if re.match(r"^(-?\d|to\s)", first) else ""
            out.append(f"{m.group(1) or ''}linear-gradient({head}{SPLIT})")
        elif "B" in fam:
            out.append(map_colors(g, PURPLE_SAFFRON, T_PS))
        elif "K" in fam:
            out.append(map_colors(g, PURPLE_GREEN, T_PG))
        else:
            out.append(map_colors(g, PURPLE_SAFFRON, T_PS))     # a purple-only gradient: deep saffron
        i = j
    return "".join(out)

# ---------------------------------------------------------------- a small CSS reader
def strip_comments(s):
    out, i, n = [], 0, len(s)
    while i < n:
        c = s[i]
        if c in "\"'":
            j = i + 1
            while j < n and s[j] != c:
                j += 2 if s[j] == "\\" else 1
            out.append(s[i:j + 1]); i = j + 1; continue
        if s.startswith("/*", i):
            e = s.find("*/", i + 2); i = n if e < 0 else e + 2; out.append(" "); continue
        out.append(c); i += 1
    return "".join(out)

def split_top(s, sep):
    parts, depth, cur, q, i = [], 0, [], None, 0
    while i < len(s):
        c = s[i]
        if q:
            cur.append(c)
            if c == "\\" and i + 1 < len(s): cur.append(s[i + 1]); i += 2; continue
            if c == q: q = None
        elif c in "\"'": q = c; cur.append(c)
        elif c in "([": depth += 1; cur.append(c)
        elif c in ")]": depth -= 1; cur.append(c)
        elif c == sep and depth == 0: parts.append("".join(cur)); cur = []
        else: cur.append(c)
        i += 1
    if "".join(cur).strip(): parts.append("".join(cur))
    return parts

def blocks(s):
    """Yields (prelude, body) for each top-level item; body None for a statement."""
    i, n = 0, len(s)
    while i < n:
        j, depth, q = i, 0, None
        while j < n:
            c = s[j]
            if q:
                if c == "\\": j += 2; continue
                if c == q: q = None
            elif c in "\"'": q = c
            elif c == "(": depth += 1
            elif c == ")": depth -= 1
            elif depth == 0 and c in "{;": break
            j += 1
        if j >= n: break
        prelude = s[i:j].strip()
        if s[j] == ";":
            yield prelude, None; i = j + 1; continue
        k, level, q = j + 1, 1, None
        while k < n and level:
            c = s[k]
            if q:
                if c == "\\": k += 2; continue
                if c == q: q = None
            elif c in "\"'": q = c
            elif c == "{": level += 1
            elif c == "}": level -= 1
            k += 1
        yield prelude, s[j + 1:k - 1]
        i = k

def skin_selector(sel):
    s = sel.strip()
    if not s or 'data-theme="dark"' in s or "data-theme='dark'" in s or "sn-carbon" in s or ".room-body" in s:
        return None
    if "sn-sw-" in s or "sn-theme-sw" in s:          # the theme menu's swatches show each theme's own colours
        return None
    if s.startswith(":root"):
        return SKIN + s[5:]
    if s.startswith("html"):
        return SKIN + s[4:]
    return SKIN + " " + s

def convert(css):
    out = []
    for prelude, body in blocks(css):
        if body is None:
            continue
        low = prelude.lower()
        if low.startswith(("@media", "@supports", "@container", "@layer")):
            inner = convert(body)
            if inner.strip():
                out.append(f"{prelude} {{\n{inner}}}\n")
            continue
        if low.startswith("@"):
            continue                                   # @keyframes, @font-face, @property: shared by all themes
        sels = [x for x in (skin_selector(p) for p in split_top(prelude, ",")) if x]
        if not sels:
            continue
        decls = []
        for d in split_top(body, ";"):
            if ":" not in d:
                continue
            name, val = d.split(":", 1)
            new = map_value(val)
            if new != val:
                prop = name.strip()
                # gradient text (background-clip: text): the shorthand would reset the clip and paint a block
                if prop.lower() == "background" and "background-clip: text" in body.lower().replace("  ", " "):
                    prop = "background-image"
                decls.append(f"{prop}: {new.strip()}")
        if decls:
            out.append(", ".join(sels) + " { " + "; ".join(decls) + "; }\n")
    return "".join(out)

def main():
    parts = ["/* =====================================================================\n"
             "   ShankhNaad · theme-kesari.css: the \"Kesari\" theme (saffron, white and green).\n"
             "   GENERATED by tools/gen_kesari.py from the light rules (blue → saffron, pink → green,\n"
             "   purple → deep saffron) + tools/kesari_extra.css at the end. Regenerate after changing a style sheet.\n"
             "   ===================================================================== */\n"]
    for f in SOURCES:
        path = os.path.join(CSS, f)
        if not os.path.exists(path):
            continue
        text = strip_comments(open(path, encoding="utf-8-sig").read())
        conv = convert(text)
        if conv.strip():
            parts.append(f"/* ---- from {f} ---- */\n" + conv)
    if os.path.exists(EXTRA):
        parts.append("/* ---- hand-written (tools/kesari_extra.css) ---- */\n" + open(EXTRA, encoding="utf-8").read())
    open(OUT, "w", encoding="utf-8", newline="\n").write("".join(parts))
    print(f"wrote {OUT}: {sum(len(p) for p in parts)} characters")

if __name__ == "__main__":
    sys.exit(main())
