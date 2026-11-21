// ShankhNaad · emoji panel, shared by the Chat page (js/chat.js) and the call room (js/room.js).
// Every emoji (js/emoji-data.js, loaded the first time the panel opens), searchable by name, in groups with your
// recent ones first. One group is drawn at a time, in small batches between frames, so opening, switching groups,
// scrolling and searching stay smooth. Colour emoji come from Google's Noto font so they look the same everywhere.
//
//   SNEmoji.open(anchorEl, { onPick(emoji), keepOpen, title, onClose })   → shows the panel by anchorEl (again: closes it)
//   SNEmoji.close()
(function () {
    "use strict";
    if (window.SNEmoji) return;

    const BASE = (document.currentScript && document.currentScript.src) || (location.origin + "/js/emoji-picker.js");
    const DATA_URL = new URL("emoji-data.js?v=3", BASE).href;
    const RKEY = "sn-emoji-recent";
    const FALLBACK = "😀 😂 😊 😍 😎 🤔 😢 😭 😡 👍 👎 👏 🙏 💪 👋 ❤️ 🔥 🎉 ✅ ❌ 💯 🚀".split(" ");
    const BATCH = 140;                     // emoji drawn per frame
    const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    // ---------- styles (one copy, works on both the light/dark app and the dark call room) ----------
    const css = `
.sne { --sne-bg: #FFFFFF; --sne-fg: #0F172A; --sne-sub: #64748B; --sne-line: rgba(15, 23, 42, .1); --sne-hover: rgba(37, 99, 235, .09); --sne-on: rgba(37, 99, 235, .14); --sne-accent: #2563EB; --sne-field: #F1F5F9;
  position: fixed; z-index: 3000; width: 352px; max-width: calc(100vw - 16px); height: 400px; max-height: calc(100vh - 16px); display: flex; flex-direction: column; gap: 8px; padding: 10px;
  border-radius: 18px; background: var(--sne-bg); color: var(--sne-fg); border: 1px solid var(--sne-line); box-shadow: 0 24px 60px rgba(2, 6, 23, .28), 0 4px 12px rgba(2, 6, 23, .12);
  font: 13px Inter, system-ui, sans-serif; opacity: 0; transform: translateY(8px) scale(.97); transform-origin: var(--sne-origin, 50% 100%);
  transition: opacity .18s ease, transform .22s cubic-bezier(.22, 1, .36, 1); }
.sne.show { opacity: 1; transform: none; }
.sne.out { opacity: 0; transform: translateY(6px) scale(.98); transition-duration: .12s; pointer-events: none; }
html[data-theme="dark"] .sne, .room-body .sne { --sne-bg: #141A33; --sne-fg: #F1F5F9; --sne-sub: #94A3B8; --sne-line: rgba(255, 255, 255, .14); --sne-hover: rgba(255, 255, 255, .1); --sne-on: rgba(167, 139, 250, .25); --sne-accent: #A78BFA; --sne-field: rgba(2, 6, 23, .55); }
.sne-title { font-weight: 700; font-size: 12px; padding: 0 2px; }
.sne-q { flex: none; height: 36px; padding: 0 12px 0 34px; border-radius: 11px; border: 1px solid var(--sne-line); background: var(--sne-field) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='2.4' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='M20 20l-3.5-3.5'/%3E%3C/svg%3E") no-repeat 11px center;
  color: var(--sne-fg); font: 13px Inter, system-ui, sans-serif; outline: none; transition: border-color .15s ease, box-shadow .15s ease; }
.sne-q:focus { border-color: var(--sne-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--sne-accent) 20%, transparent); }
.sne-tabs { flex: none; position: relative; display: flex; gap: 2px; padding-bottom: 6px; border-bottom: 1px solid var(--sne-line); }
.sne-tabs button { flex: 1 1 0; min-width: 24px; height: 32px; padding: 0; border: 0; border-radius: 9px; background: transparent; cursor: pointer; font-size: 17px; line-height: 1;
  font-family: "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif; filter: grayscale(.55); opacity: .8; transition: background .15s ease, filter .15s ease, opacity .15s ease, transform .15s ease; }
.sne-tabs button:hover { background: var(--sne-hover); filter: none; opacity: 1; transform: translateY(-1px); }
.sne-tabs button.on { filter: none; opacity: 1; }
.sne-ink { position: absolute; bottom: 0; left: 0; height: 2px; border-radius: 2px; background: var(--sne-accent); transition: transform .28s cubic-bezier(.22, 1, .36, 1), width .28s cubic-bezier(.22, 1, .36, 1); }
.sne-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scroll-behavior: smooth; scrollbar-width: thin; scrollbar-color: var(--sne-line) transparent; will-change: scroll-position; }
.sne-page { animation: sneIn .22s cubic-bezier(.22, 1, .36, 1); }
.sne-page.left { animation-name: sneInL; }
@keyframes sneIn { from { opacity: 0; transform: translateX(14px); } }
@keyframes sneInL { from { opacity: 0; transform: translateX(-14px); } }
.sne-h { position: sticky; top: 0; z-index: 1; margin: 0; padding: 4px 4px 6px; background: var(--sne-bg); color: var(--sne-sub); font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
.sne-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(38px, 1fr)); gap: 2px; padding: 0 2px 4px; }
.sne-grid button { height: 38px; padding: 0; border: 0; border-radius: 10px; background: transparent; cursor: pointer; font-size: 24px; line-height: 1;
  font-family: "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif; transition: transform .12s ease, background .12s ease; }
.sne-grid button:hover, .sne-grid button:focus-visible { background: var(--sne-hover); transform: scale(1.18); outline: none; }
.sne-grid button:active { transform: scale(.92); }
.sne-grid.more { animation: sneFade .25s ease; }
@keyframes sneFade { from { opacity: 0; } }
.sne-none { margin: 40px 0; text-align: center; color: var(--sne-sub); }
.sne-wait { display: grid; grid-template-columns: repeat(auto-fill, minmax(38px, 1fr)); gap: 6px; padding: 30px 6px; }
.sne-wait i { height: 30px; border-radius: 9px; background: linear-gradient(90deg, var(--sne-hover), var(--sne-line), var(--sne-hover)); background-size: 200% 100%; animation: sneShine 1.1s linear infinite; }
@keyframes sneShine { to { background-position: -200% 0; } }
.sne-foot { flex: none; display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 4px; border-top: 1px solid var(--sne-line); color: var(--sne-sub); font-size: 12px; overflow: hidden; }
.sne-foot b { font: 22px/1 "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif; }
.sne-foot span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: capitalize; }
@media (prefers-reduced-motion: reduce) { .sne, .sne-page, .sne-grid.more, .sne-ink, .sne-grid button { animation: none !important; transition: none !important; } .sne-body { scroll-behavior: auto; } }
`;
    // styles, the colour emoji font (only the pieces in use download) and the listeners go into each window the
    // panel opens in (the call room can pop its chat out into a separate window)
    const docs = new Set();
    function prepare(doc) {
        if (docs.has(doc)) return;
        docs.add(doc);
        const style = doc.createElement("style");
        style.textContent = css;
        doc.head.appendChild(style);
        if (!doc.querySelector('link[href*="Noto+Color+Emoji"]')) {
            const l = doc.createElement("link");
            l.rel = "stylesheet";
            l.href = "https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap";
            doc.head.appendChild(l);
        }
        doc.addEventListener("click", onClick, true);
        doc.addEventListener("keydown", onKey, true);
        doc.defaultView?.addEventListener("resize", () => place());
        doc.addEventListener("scroll", (e) => { if (panel && !panel.contains(e.target)) place(); }, true);
    }

    // ---------- data ----------
    let loading = null;
    const load = () => loading || (loading = new Promise((ok) => {
        if (window.SN_EMOJI) return ok();
        const sc = document.createElement("script");
        sc.src = DATA_URL;
        sc.onload = () => ok();
        sc.onerror = () => { loading = null; ok(); };
        document.head.appendChild(sc);
    }));
    const recent = () => { try { return JSON.parse(localStorage.getItem(RKEY) || "[]"); } catch { return []; } };
    const remember = (e) => { try { localStorage.setItem(RKEY, JSON.stringify([e, ...recent().filter((x) => x !== e)].slice(0, 32))); } catch { } };
    let index = null;                      // [[emoji, name]] of everything, for search
    const nameOf = new Map();
    const buildIndex = () => {
        if (index || !window.SN_EMOJI) return;
        index = [];
        window.SN_EMOJI.groups.forEach(([k]) => window.SN_EMOJI.list[k].forEach((x) => { index.push(x); nameOf.set(x[0], x[1]); }));
    };

    // ---------- the panel ----------
    let panel = null, opts = null, anchor = null, drawJob = 0, tab = "smileys";
    const cell = (e) => `<button type="button" data-sne="${e}" aria-label="${esc(nameOf.get(e) || e)}">${e}</button>`;

    // draws a list into the body: the first batch at once, the rest a frame at a time (no freeze on big groups)
    const raf = (f) => ((panel && panel.ownerDocument.defaultView) || window).requestAnimationFrame(f);
    function draw(title, list, dir) {
        const body = panel.querySelector(".sne-body");
        const job = ++drawJob;
        body.style.scrollBehavior = "auto";
        body.scrollTop = 0;
        body.style.scrollBehavior = "";
        if (!list.length) { body.innerHTML = `<div class="sne-page"><p class="sne-none">${title}</p></div>`; return; }
        body.innerHTML = `<div class="sne-page ${dir < 0 ? "left" : ""}"><p class="sne-h">${esc(title)}</p><div class="sne-grid">${list.slice(0, BATCH).map(cell).join("")}</div></div>`;
        const page = body.firstElementChild;
        let at = BATCH;
        const more = () => {
            if (job !== drawJob || !panel || at >= list.length) return;
            const g = panel.ownerDocument.createElement("div");
            g.className = "sne-grid more";
            g.innerHTML = list.slice(at, at + BATCH).map(cell).join("");
            page.appendChild(g);
            at += BATCH;
            raf(more);
        };
        raf(more);
    }
    const groups = () => (window.SN_EMOJI?.groups || []);
    const tabsList = () => (recent().length ? [["recent", "🕘", "Recently used"]] : []).concat(groups());
    function paintTabs() {
        const box = panel.querySelector(".sne-tabs");
        const list = tabsList();
        if (box.dataset.n !== String(list.length)) {
            box.innerHTML = list.map(([k, icon, name]) => `<button type="button" data-tab="${k}" title="${esc(name)}" aria-label="${esc(name)}">${icon}</button>`).join("") + `<i class="sne-ink"></i>`;
            box.dataset.n = String(list.length);
        }
        moveInk();
    }
    function moveInk() {
        const box = panel.querySelector(".sne-tabs"), ink = box.querySelector(".sne-ink");
        const searching = !!panel.querySelector(".sne-q").value.trim();
        box.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", !searching && b.dataset.tab === tab));
        const on = box.querySelector(`[data-tab="${tab}"]`);
        if (!ink) return;
        if (!on || searching) { ink.style.width = "0"; return; }
        ink.style.width = `${on.offsetWidth - 8}px`;
        ink.style.transform = `translateX(${on.offsetLeft + 4}px)`;
    }
    function showTab(k) {
        const list = tabsList().map((t) => t[0]);
        const dir = list.indexOf(k) - list.indexOf(tab);
        tab = k;
        const q = panel.querySelector(".sne-q");
        q.value = "";
        moveInk();
        if (!window.SN_EMOJI) { draw("Emoji", FALLBACK, 0); return; }
        if (k === "recent") { draw("Recently used", recent(), dir); return; }
        const g = groups().find((x) => x[0] === k) || groups()[0];
        draw(g[2], window.SN_EMOJI.list[g[0]].map((x) => x[0]), dir);
    }
    let searchT = null;
    function search(text) {
        const q = text.trim().toLowerCase();
        moveInk();
        if (!q) { showTab(tab); return; }
        buildIndex();
        const words = q.split(/\s+/);
        const pool = index || FALLBACK.map((e) => [e, ""]);
        const rank = (n) => (n.startsWith(words[0]) ? 0 : n.includes(" " + words[0]) ? 1 : 2);
        const hits = pool.filter(([e, n]) => e === q || words.every((w) => n.includes(w)))
            .map((x, i) => [x, rank(x[1]), i]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map((x) => x[0][0]);
        draw(hits.length ? `Results for “${q}”` : `No emoji called “${q}”`, hits, 0);
    }

    function place() {
        if (!panel || !anchor) return;
        const win = anchor.ownerDocument.defaultView || window;
        const r = anchor.getBoundingClientRect();
        const w = panel.offsetWidth, h = panel.offsetHeight;
        const left = Math.max(8, Math.min(win.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
        let top = r.top - h - 10, below = false;
        if (top < 8) { top = Math.min(r.bottom + 10, win.innerHeight - h - 8); below = true; }
        panel.style.left = `${left}px`;
        panel.style.top = `${Math.max(8, top)}px`;
        panel.style.setProperty("--sne-origin", `${Math.round(r.left + r.width / 2 - left)}px ${below ? "0%" : "100%"}`);
    }

    function close(instant) {
        if (!panel) return;
        const p = panel, o = opts;
        panel = null; opts = null; anchor = null; drawJob++;
        if (instant) p.remove();
        else { p.classList.remove("show"); p.classList.add("out"); setTimeout(() => p.remove(), 140); }
        try { o?.onClose?.(); } catch { }
    }

    function open(el, options) {
        if (panel && anchor === el) { close(); return; }
        close(true);
        anchor = el; opts = options || {};
        const doc = el.ownerDocument || document;
        prepare(doc);
        panel = doc.createElement("div");
        panel.className = "sne";
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-label", opts.title || "Emoji");
        panel.innerHTML = (opts.title ? `<div class="sne-title">${esc(opts.title)}</div>` : "")
            + `<input type="search" class="sne-q" placeholder="Search emoji (laugh, thanks, india…)" aria-label="Search emoji" autocomplete="off" spellcheck="false" />`
            + `<div class="sne-tabs" role="tablist"></div>`
            + `<div class="sne-body"><div class="sne-wait">${"<i></i>".repeat(24)}</div></div>`
            + `<div class="sne-foot"><b></b><span>Pick an emoji</span></div>`;
        doc.body.appendChild(panel);
        place();
        raf(() => panel && panel.classList.add("show"));
        const q = panel.querySelector(".sne-q");
        q.addEventListener("input", () => { clearTimeout(searchT); searchT = setTimeout(() => panel && search(q.value), 90); });
        q.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); panel.querySelector(".sne-body [data-sne]")?.click(); }
            if (e.key === "ArrowDown") { e.preventDefault(); panel.querySelector(".sne-body [data-sne]")?.focus(); }
        });
        const p = panel;
        p.addEventListener("mouseover", (e) => {
            const b = e.target.closest("[data-sne]");
            if (!b) return;
            p.querySelector(".sne-foot b").textContent = b.dataset.sne;
            p.querySelector(".sne-foot span").textContent = [...new Set((nameOf.get(b.dataset.sne) || "").split(" "))].slice(0, 6).join(" ");
        });
        tab = recent().length ? "recent" : "smileys";
        load().then(() => {
            if (panel !== p) return;
            buildIndex();
            paintTabs();
            if (q.value.trim()) search(q.value); else showTab(tab);
        });
        setTimeout(() => panel === p && q.focus({ preventScroll: true }), 40);
    }

    function onClick(e) {
        if (!panel) return;
        const t = e.target.closest(".sne [data-tab]");
        if (t) { showTab(t.dataset.tab); return; }
        const b = e.target.closest(".sne [data-sne]");
        if (b) {
            const emo = b.dataset.sne, o = opts;
            remember(emo);
            if (!o?.keepOpen) close();
            o?.onPick?.(emo);
            return;
        }
        if (!e.target.closest(".sne") && !(anchor && anchor.contains(e.target))) close();
    }
    function onKey(e) {
        if (panel && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    }
    prepare(document);

    window.SNEmoji = { open, close, isOpen: () => !!panel, preload: load, prepare };
})();
