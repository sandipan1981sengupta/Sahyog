// ShankhNaad · View a shared file without leaving the app, or download it.
// Any element with data-fv-view and the file's data (on itself or on a parent with data-fv-url) opens the viewer:
//   data-fv-url="/chat/file/{id}" data-fv-name="Report.pdf" data-fv-type="application/pdf" data-fv-size="123456"
// Download always uses "?dl=1" (the server then sends it as a download). Server: ChatController.Download / CanShowInPlace.
(function () {
    "use strict";
    const SN = (window.SN = window.SN || {});
    let dlg = null;

    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const kind = (type) => {
        const t = String(type || "").split(";")[0].trim().toLowerCase();
        if (t === "image/svg+xml") return "";                       // never shown in place (it can carry script)
        if (t.startsWith("image/")) return "image";
        if (t === "application/pdf") return "pdf";
        if (t.startsWith("video/")) return "video";
        if (t.startsWith("audio/")) return "audio";
        if (t === "text/plain" || t === "text/csv") return "text";
        return "";
    };
    /** Can this kind of file be viewed in the app? (the same list as the server's CanShowInPlace) */
    SN.canView = (type) => !!kind(type);
    const dlUrl = (url) => url + (url.includes("?") ? "&" : "?") + "dl=1";
    const size = (b) => {
        b = Number(b) || 0; if (!b) return "";
        const u = ["B", "KB", "MB", "GB"]; let i = 0;
        while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
        return `${b < 10 && i ? b.toFixed(1) : Math.round(b)} ${u[i]}`;
    };

    function ensure() {
        if (dlg) return dlg;
        dlg = document.createElement("dialog");
        dlg.className = "sn-fv";
        dlg.setAttribute("aria-label", "View file");
        dlg.innerHTML = `
            <div class="sn-fv-bar">
                <span class="sn-fv-name"><b class="ellipsis" data-fv-title></b><small data-fv-meta></small></span>
                <a class="cee-btn cee-btn-gradient sn-fv-btn" data-fv-dl download><i class="fa fa-download" aria-hidden="true"></i> <span>Download</span></a>
                <a class="cee-btn sn-btn-light sn-fv-btn" data-fv-tab target="_blank" rel="noopener"><i class="fa fa-external-link" aria-hidden="true"></i> <span>Open in a new tab</span></a>
                <button type="button" class="sn-fv-x" data-fv-close aria-label="Close" title="Close (Esc)"><i class="fa fa-times" aria-hidden="true"></i></button>
                <i class="sn-fv-glow" aria-hidden="true"></i>
            </div>
            <div class="sn-fv-stage" data-fv-stage></div>`;
        document.body.appendChild(dlg);
        dlg.addEventListener("click", (e) => {
            if (e.target === dlg || e.target.closest("[data-fv-close]")) { shut(); return; }
            const img = e.target.closest(".sn-fv-stage img");
            if (img) img.classList.toggle("full");                     // click a picture: actual size / fit
        });
        dlg.addEventListener("cancel", (e) => { e.preventDefault(); shut(); });   // Esc: close with the animation too
        // stop video or sound when the viewer closes
        dlg.addEventListener("close", () => { dlg.querySelector("[data-fv-stage]").replaceChildren(); dlg.classList.remove("sn-fv-closing"); });
        return dlg;
    }

    // ---------- the opening / closing animation ----------
    // The viewer grows out of the button that was pressed (and shrinks back into it), the background blurs in,
    // the top bar's parts follow one after another and the file fades in once it has loaded.
    // Web Animations only (GPU: transform, opacity), nothing runs once it has settled, and none of it with "reduce motion".
    const calm = () => !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) || !Element.prototype.animate;
    const EASE_OUT = "cubic-bezier(.16, 1, .3, 1)", EASE_IN = "cubic-bezier(.4, 0, 1, 1)";
    let from = null, closing = null;

    // where the click came from: the viewer grows out of that point
    document.addEventListener("pointerdown", (e) => { from = { x: e.clientX, y: e.clientY, t: Date.now() }; }, true);
    function origin(d) {
        const r = d.getBoundingClientRect();
        if (!from || Date.now() - from.t > 1500 || !r.width) return "50% 50%";
        const x = Math.min(Math.max(from.x - r.left, 0), r.width), y = Math.min(Math.max(from.y - r.top, 0), r.height);
        return `${x}px ${y}px`;
    }

    function openAnim(d) {
        if (calm()) return;
        d.style.transformOrigin = origin(d);
        d.animate([
            { opacity: 0, transform: "scale(.82) translateY(14px)", filter: "blur(6px)" },
            { opacity: 1, transform: "none", filter: "blur(0)" }
        ], { duration: 460, easing: EASE_OUT });
        try { d.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: "ease-out", pseudoElement: "::backdrop" }); } catch { }
        // the top bar: name, Download, Open in a new tab, Close, one after another
        [...d.querySelectorAll(".sn-fv-bar > *:not([hidden])")].forEach((el, i) => el.animate([
            { opacity: 0, transform: "translateY(-8px)" }, { opacity: 1, transform: "none" }
        ], { duration: 380, delay: 120 + i * 55, easing: EASE_OUT, fill: "backwards" }));
        // a light sweep across the top edge
        const glow = d.querySelector(".sn-fv-glow");
        if (glow) glow.animate([{ transform: "translateX(-100%)", opacity: 0 }, { opacity: 1, offset: .3 }, { transform: "translateX(100%)", opacity: 0 }],
            { duration: 1100, delay: 180, easing: "ease-in-out" });
    }

    /** Closes the viewer, after the closing animation. */
    function shut() {
        const d = dlg;
        if (!d || !d.open || closing) return;
        if (calm()) { d.close(); return; }
        d.classList.add("sn-fv-closing");
        d.style.transformOrigin = origin(d);
        const a = d.animate([
            { opacity: 1, transform: "none", filter: "blur(0)" },
            { opacity: 0, transform: "scale(.9) translateY(10px)", filter: "blur(4px)" }
        ], { duration: 220, easing: EASE_IN, fill: "forwards" });
        try { d.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: "ease-in", fill: "forwards", pseudoElement: "::backdrop" }); } catch { }
        closing = a;
        const done = () => { closing = null; d.close(); d.getAnimations({ subtree: true }).forEach((x) => x.cancel()); };
        a.onfinish = done; a.oncancel = done;
    }
    SN.closeFileView = shut;

    // the file itself: a soft shimmer while it loads, then it fades and settles in
    function reveal(stage) {
        const el = stage.querySelector("img, iframe, video, .sn-fv-audio, .sn-fv-none");
        if (!el) return;
        let shown = false;
        const show = () => {
            if (shown || !el.isConnected) return;
            shown = true;
            stage.classList.remove("sn-fv-loading");
            if (calm()) return;
            el.animate([{ opacity: 0, transform: "scale(.97)", filter: "blur(10px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }],
                { duration: 520, easing: EASE_OUT });
        };
        const tag = el.tagName;
        if (tag === "IMG" && !el.complete) { stage.classList.add("sn-fv-loading"); el.addEventListener("load", show, { once: true }); el.addEventListener("error", show, { once: true }); }
        else if (tag === "IFRAME") { stage.classList.add("sn-fv-loading"); el.addEventListener("load", show, { once: true }); setTimeout(show, 6000); }
        else if (tag === "VIDEO") { stage.classList.add("sn-fv-loading"); el.addEventListener("loadeddata", show, { once: true }); el.addEventListener("error", show, { once: true }); setTimeout(show, 6000); }
        else show();
    }

    /** Opens the viewer: { url, name, type, size }. Files that can't be shown get a Download card instead. */
    function view(f) {
        const d = ensure(), k = kind(f.type), url = f.url, name = f.name || "File";
        d.querySelector("[data-fv-title]").textContent = name;
        d.querySelector("[data-fv-meta]").textContent = [size(f.size), (f.type || "").split(";")[0]].filter(Boolean).join(" · ");
        const dl = d.querySelector("[data-fv-dl]"); dl.href = dlUrl(url); dl.setAttribute("download", name);
        const tab = d.querySelector("[data-fv-tab]"); tab.href = url; tab.hidden = !k;
        const stage = d.querySelector("[data-fv-stage]");
        stage.className = "sn-fv-stage " + (k || "none");
        stage.innerHTML =
            k === "image" ? `<img src="${esc(url)}" alt="${esc(name)}" title="Click for actual size">`
          : k === "pdf" || k === "text" ? `<iframe src="${esc(url)}" title="${esc(name)}"></iframe>`
          : k === "video" ? `<video src="${esc(url)}" controls autoplay playsinline></video>`
          : k === "audio" ? `<div class="sn-fv-audio"><i class="fa fa-music" aria-hidden="true"></i><audio src="${esc(url)}" controls autoplay></audio></div>`
          : `<div class="sn-fv-none"><i class="fa fa-file-o" aria-hidden="true"></i><b>${esc(name)}</b><span>This kind of file can't be shown here. Download it to open it.</span>
                <a class="cee-btn cee-btn-gradient" href="${esc(dlUrl(url))}" download="${esc(name)}"><i class="fa fa-download" aria-hidden="true"></i> <span>Download</span></a></div>`;
        if (closing) {                                                // opened again while it was closing: stay open
            closing.onfinish = closing.oncancel = null; closing = null;
            d.getAnimations({ subtree: true }).forEach((x) => x.cancel());
            d.classList.remove("sn-fv-closing");
        }
        const opening = !d.open;
        if (opening) d.showModal();
        reveal(stage);
        if (opening) openAnim(d);
    }
    // the viewer lives on the window, not on a page: it must keep working after partial page loads (sn-nav.js)
    SN.viewFile = SN.nav && SN.nav.unscoped ? SN.nav.unscoped(view) : view;

    // any [data-fv-view] (chat file cards, the Files page): read the file's data from itself or a parent
    document.addEventListener("click", (e) => {
        const b = e.target.closest && e.target.closest("[data-fv-view]");
        if (!b) return;
        const host = b.closest("[data-fv-url]");
        if (!host) return;
        e.preventDefault(); e.stopPropagation();
        SN.viewFile({ url: host.dataset.fvUrl, name: host.dataset.fvName, type: host.dataset.fvType, size: host.dataset.fvSize });
    });
})();
