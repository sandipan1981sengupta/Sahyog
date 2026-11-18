// ShankhNaad · tooltips. Every title="…" (or data-tip="…") on the page shows as a soft glass bubble with
// a little arrow, after a short pause, above the element (or below when there's no room). Works with mouse and keyboard.
(function () {
    "use strict";
    if (window.matchMedia && window.matchMedia("(hover: none)").matches) return;   // phones/tablets: no hover
    const tip = document.createElement("div");
    tip.className = "sn-tip";
    tip.setAttribute("role", "tooltip");
    tip.id = "snTip";
    tip.innerHTML = '<span class="sn-tip-text"></span><i class="sn-tip-arrow"></i>';
    const text = tip.querySelector(".sn-tip-text"), arrow = tip.querySelector(".sn-tip-arrow");
    const canPop = "showPopover" in HTMLElement.prototype;
    if (canPop) tip.setAttribute("popover", "manual");
    const mount = () => { if (!tip.isConnected) document.body.appendChild(tip); };

    let target = null, showT = null, hideT = null;
    const SKIP = "svg title, [data-no-tip], .sn-tip, iframe";

    // take the title off the element (so the browser's plain one doesn't show) and keep it for us
    const tipOf = (el) => {
        if (el.hasAttribute("title")) {
            const t = el.getAttribute("title");
            el.removeAttribute("title");
            if (t) el.setAttribute("data-tip", t);   // a script may change the title later: the newest one wins
            if (t && !el.hasAttribute("aria-label") && !el.textContent.trim()) el.setAttribute("aria-label", t);
        }
        return el.getAttribute("data-tip") || "";
    };
    const find = (node) => {
        for (let el = node; el && el !== document.body; el = el.parentElement) {
            if (el.nodeType !== 1 || el.matches(SKIP)) continue;
            if (el.hasAttribute("title") || el.hasAttribute("data-tip")) return el;
        }
        return null;
    };

    const place = () => {
        if (!target || !target.isConnected) return hide(true);
        const r = target.getBoundingClientRect();
        const t = tip.getBoundingClientRect();
        const gap = 12, vw = window.innerWidth;
        let below = r.top - t.height - gap < 8;
        let top = below ? r.bottom + gap : r.top - t.height - gap;
        let left = r.left + r.width / 2 - t.width / 2;
        left = Math.max(8, Math.min(left, vw - t.width - 8));
        tip.style.top = `${Math.round(top)}px`;
        tip.style.left = `${Math.round(left)}px`;
        tip.classList.toggle("below", below);
        const ax = Math.max(14, Math.min(t.width - 14, r.left + r.width / 2 - left));
        arrow.style.left = `${Math.round(ax)}px`;
    };

    function show(el) {
        const msg = tipOf(el);
        if (!msg) return;
        mount();
        target = el;
        text.textContent = msg;
        el.setAttribute("aria-describedby", "snTip");
        tip.classList.remove("in");
        tip.style.top = "-999px"; tip.style.left = "-999px";
        if (canPop) { try { if (tip.matches(":popover-open")) tip.hidePopover(); tip.showPopover(); } catch { } }
        tip.classList.add("on");
        requestAnimationFrame(() => { place(); tip.classList.add("in"); });
    }
    function hide(now) {
        clearTimeout(showT);
        if (target) target.removeAttribute("aria-describedby");
        target = null;
        tip.classList.remove("in");
        clearTimeout(hideT);
        hideT = setTimeout(() => {
            if (target) return;
            tip.classList.remove("on");
            if (canPop) { try { tip.hidePopover(); } catch { } }
        }, now ? 0 : 160);
    }

    const enter = (el, delay) => {
        clearTimeout(showT); clearTimeout(hideT);
        if (target === el) return;
        tipOf(el);   // stop the browser tooltip straight away
        // moving from one tooltip to the next: show at once
        const quick = tip.classList.contains("in");
        showT = setTimeout(() => show(el), quick ? 40 : delay);
    };
    document.addEventListener("mouseover", (e) => {
        const el = find(e.target);
        if (el) enter(el, 380); else if (target) hide();
    }, true);
    document.addEventListener("mouseout", (e) => {
        if (!target) { clearTimeout(showT); return; }
        if (e.relatedTarget && target.contains(e.relatedTarget)) return;
        hide();
    }, true);
    document.addEventListener("focusin", (e) => {
        const el = find(e.target);
        if (el && e.target.matches(":focus-visible")) enter(el, 120);
    });
    document.addEventListener("focusout", () => hide());
    document.addEventListener("pointerdown", () => hide(true), true);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(true); });
    window.addEventListener("scroll", () => { if (target) place(); }, true);
    window.addEventListener("resize", () => hide(true));
})();
