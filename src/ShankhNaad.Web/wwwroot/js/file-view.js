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
            </div>
            <div class="sn-fv-stage" data-fv-stage></div>`;
        document.body.appendChild(dlg);
        dlg.addEventListener("click", (e) => {
            if (e.target === dlg || e.target.closest("[data-fv-close]")) { dlg.close(); return; }
            const img = e.target.closest(".sn-fv-stage img");
            if (img) img.classList.toggle("full");                     // click a picture: actual size / fit
        });
        // stop video or sound when the viewer closes
        dlg.addEventListener("close", () => { dlg.querySelector("[data-fv-stage]").replaceChildren(); });
        return dlg;
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
        if (!d.open) d.showModal();
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
