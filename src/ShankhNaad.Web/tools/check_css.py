#!/usr/bin/env python3
"""
ShankhNaad · a quick health check for the app's style sheets (run from the project folder):

    python3 tools/check_css.py            # report
    python3 tools/check_css.py --strict   # also fails (exit code 1) if a file breaks a rule below

What it checks, for every file in wwwroot/css/app/ (and the other hand-written sheets in the layout bundle):
  1. braces { } balance, so one missing "}" can't swallow the rest of the file
  2. how many !important each file has (the number should only go down)
  3. "specificity hacks" like .sn-dialog.sn-dialog.sn-dialog (a class repeated to win a fight): count only
  4. the bundle lists every file in wwwroot/css/app/, in number order (01 → 22 …), and nothing is missing
  5. the generated theme-kesari.css is newer than every source file (otherwise: run tools/gen_kesari.py)

Where new rules go: see docs/CSS-GUIDE.md.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CSS = os.path.join(ROOT, "wwwroot", "css")
APP = os.path.join(CSS, "app")
STRICT = "--strict" in sys.argv

# the most !important a file may have before --strict complains (today's numbers; lower them as you clean up)
IMPORTANT_BUDGET = 400

def strip_comments(t):
    return re.sub(r"/\*.*?\*/", "", t, flags=re.S)

def bundle_files():
    text = open(os.path.join(ROOT, "Infrastructure", "AssetBundles.cs"), encoding="utf-8").read()
    block = text[text.index('["layout.css"]'):]
    block = block[:block.index("}")]
    return re.findall(r'"css/([^"]+\.css)"', block)

def main():
    problems = []
    app_files = sorted(f for f in os.listdir(APP) if f.endswith(".css")) if os.path.isdir(APP) else []
    listed = bundle_files()
    listed_app = [f[4:] for f in listed if f.startswith("app/")]

    # 4. the bundle and the folder agree, in order
    if listed_app != app_files:
        missing = [f for f in app_files if f not in listed_app]
        extra = [f for f in listed_app if f not in app_files]
        if missing: problems.append(f"in wwwroot/css/app but not in the bundle: {', '.join(missing)}")
        if extra: problems.append(f"in the bundle but not in wwwroot/css/app: {', '.join(extra)}")
        if not missing and not extra: problems.append("the bundle lists wwwroot/css/app in a different order than the file numbers")

    rows, total_imp, total_hack = [], 0, 0
    for f in [os.path.join("app", a) for a in app_files] + [f for f in listed if not f.startswith(("app/", "web-control/", "Theme/")) and f != "theme-kesari.css"]:
        path = os.path.join(CSS, f)
        if not os.path.exists(path):
            problems.append(f"{f}: listed but missing")
            continue
        raw = open(path, encoding="utf-8-sig").read()
        t = strip_comments(raw)
        opened, closed = t.count("{"), t.count("}")
        if opened != closed:
            problems.append(f"{f}: braces don't balance ({opened} '{{' vs {closed} '}}')")
        imp = len(re.findall(r"!\s*important", t))
        hacks = len(re.findall(r"(\.[\w-]+)\1{1,}(?![\w-])", t))
        total_imp += imp; total_hack += hacks
        rows.append((f, raw.count("\n") + 1, imp, hacks))
        if imp > IMPORTANT_BUDGET:
            problems.append(f"{f}: {imp} !important (budget {IMPORTANT_BUDGET})")

    # 5. Kesari is up to date
    kes = os.path.join(CSS, "theme-kesari.css")
    if os.path.exists(kes):
        newest = max(os.path.getmtime(os.path.join(CSS, f)) for f in listed if os.path.exists(os.path.join(CSS, f)) and f != "theme-kesari.css")
        extra = os.path.join(HERE, "kesari_extra.css")
        if os.path.exists(extra): newest = max(newest, os.path.getmtime(extra))
        if os.path.getmtime(kes) + 1 < newest:
            problems.append("theme-kesari.css is older than a style sheet: run  python3 tools/gen_kesari.py")

    w = max(len(r[0]) for r in rows) if rows else 10
    print(f"{'file'.ljust(w)}  lines  !important  repeated-class hacks")
    for f, lines, imp, hacks in rows:
        print(f"{f.ljust(w)}  {lines:5}  {imp:10}  {hacks:5}")
    print(f"{'total'.ljust(w)}  {sum(r[1] for r in rows):5}  {total_imp:10}  {total_hack:5}")
    print()
    if problems:
        print("Problems:")
        for p in problems: print("  - " + p)
    else:
        print("No problems found.")
    return 1 if (STRICT and problems) else 0

if __name__ == "__main__":
    sys.exit(main())
