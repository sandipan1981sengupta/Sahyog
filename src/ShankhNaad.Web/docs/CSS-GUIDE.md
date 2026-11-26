# ShankhNaad styles: where things are and where new rules go

## The files (loaded in this order by Infrastructure/AssetBundles.cs, "layout.css")
1. Libraries and the tag-helper controls (`css/web-control/*`, `css/Theme/*`, `buttons.css`)
2. `site.css`
3. **`css/app/01-controls.css` … `css/app/22-latest.css`**: the app's own styles (this used to be one 5,300-line
   `shankhnaad.css`; it was split in the same order, so which rule wins didn't change: checked pixel for pixel)
4. `responsive.css`, `safari.css`
5. Themes: `theme-dark.css` (Dark), `theme-kesari.css` (Kesari, **generated**: never edit it by hand)
6. `popups-glass.css` (every pop-up's glass, all themes), `dialog-wide.css` (the two-column windows)

Later files win over earlier ones when two rules are equally specific.

## Where a new rule goes
- **A new feature or page**: add it at the end of `css/app/22-latest.css` (keep that file last).
  When it grows past ~400 lines, start `23-<area>.css`, add it to **both** lists in AssetBundles.cs
  (layout.css and auth.css), right after 22.
- **A fix to an existing area**: put it next to the rules it fixes (search for the class), so the next person finds it.
- **Pop-up glass / blur / see-through levels**: `popups-glass.css` only (see its comments for the per-theme variables).
- **Kesari colours**: don't touch `theme-kesari.css`. Change the light rule, then run `python3 tools/gen_kesari.py`.
  Hand-written Kesari-only bits go in `tools/kesari_extra.css`.

## Rules of thumb (to keep it from getting worse)
- **Theme-scope new rules**: `html[data-theme="light"] …`, `html[data-theme="dark"] …`, `html[data-skin="kesari"] …`.
  A light-only rule must not change dark, and vice versa.
- **No new `!important`** unless you're overriding a library or an inline style. Prefer one more class.
- **No repeated-class hacks** (`.x.x.x`) in new code; `tools/check_css.py` counts them.
- **States**: when you style an element, think about `.today`, `.on`, `.sel`, `:disabled` first: a general rule
  added later can override a state rule by accident (that's how today's date turned dark in the light calendar).
- Use the colour variables (`--sn-grad`, `--sn-primary`, `--sn-ink`, `--sn-text-2`, `--pop-*`) instead of new hex codes.

## Before you publish
```bash
python3 tools/gen_kesari.py        # if you changed any style sheet
python3 tools/check_css.py         # braces, !important counts, bundle order, Kesari up to date
```
