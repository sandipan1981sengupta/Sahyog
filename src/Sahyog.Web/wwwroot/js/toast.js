// ShankhNaad · toast notifications.
// Sahyog.toast("Saved")                                   → plain info toast
// Sahyog.toast("Someone else already uses this email.", { kind: "error" })
// Sahyog.toast("Done", { kind: "success", title: "Saved", ms: 6000, action: { text: "Undo", onClick: fn } })
// Server pages can raise one without script: <div hidden data-toast="text" data-toast-kind="success"></div>
(function () {
    "use strict";

    const Sahyog = (window.Sahyog = window.Sahyog || {});
    const ICONS = { success: "fa-check", error: "fa-exclamation", warn: "fa-exclamation-triangle", info: "fa-info" };
    const TITLES = { success: "Done", error: "Couldn't do that", warn: "Heads up", info: "" };
    const supportsPopover = typeof HTMLElement !== "undefined" && "showPopover" in HTMLElement.prototype;

    const host = () => {
        let el = document.getElementById("toasts");
        if (!el) {
            el = document.createElement("div");
            el.id = "toasts";
            el.className = "toasts";
            el.setAttribute("aria-live", "polite");
            document.body.appendChild(el);
        }
        el.classList.add("sn-toasts");
        // A popover lives in the browser's top layer, so toasts stay visible above open windows.
        if (supportsPopover && !el.hasAttribute("popover")) el.setAttribute("popover", "manual");
        return el;
    };

    // Re-showing the popover moves it to the top of the top layer (above a window opened later).
    const raise = (el) => {
        if (!supportsPopover) return;
        try {
            if (el.matches(":popover-open")) el.hidePopover();
            el.showPopover();
        } catch { /* older browsers: z-index fallback */ }
    };

    const settle = (el) => {
        if (supportsPopover && !el.querySelector(".sn-toast:not(.leaving)")) {
            try { el.hidePopover(); } catch { /* ignore */ }
        }
    };

    Sahyog.toast = (message, options) => {
        const opts = typeof options === "number" ? { ms: options } : (options || {});
        const kind = ICONS[opts.kind] ? opts.kind : "info";
        const ms = opts.ms ?? (kind === "error" ? 7000 : kind === "warn" ? 6000 : 4500);
        const title = opts.title ?? TITLES[kind];

        const box = host();
        const el = document.createElement("div");
        el.className = `toast sn-toast ${kind}`;
        el.setAttribute("role", kind === "error" ? "alert" : "status");
        el.style.setProperty("--sn-toast-ms", `${ms}ms`);

        const ic = document.createElement("span");
        ic.className = "sn-toast-ic";
        ic.innerHTML = `<i class="fa ${ICONS[kind]}" aria-hidden="true"></i>`;

        const body = document.createElement("div");
        body.className = "sn-toast-body";
        if (title) {
            const b = document.createElement("b");
            b.textContent = title;
            body.appendChild(b);
        }
        const p = document.createElement("span");
        p.textContent = message;
        body.appendChild(p);

        if (opts.action?.text) {
            const a = document.createElement("button");
            a.type = "button";
            a.className = "sn-toast-action";
            a.textContent = opts.action.text;
            a.addEventListener("click", () => { opts.action.onClick?.(); if (opts.action.close !== false) dismiss(); });
            body.appendChild(a);
        }

        const x = document.createElement("button");
        x.type = "button";
        x.className = "sn-toast-x";
        x.setAttribute("aria-label", "Close");
        x.innerHTML = '<i class="fa fa-times" aria-hidden="true"></i>';

        const bar = document.createElement("i");
        bar.className = "sn-toast-bar";

        el.append(ic, body, x, bar);
        box.appendChild(el);
        raise(box);

        // Keep only the newest four.
        const all = box.querySelectorAll(".sn-toast:not(.leaving)");
        if (all.length > 4) all[0].remove();

        let timer = 0, left = ms, started = Date.now();
        // Closing: the card slides out to the right and fades, then its space folds away
        // so the toasts below glide up instead of jumping.
        function dismiss() {
            clearTimeout(timer);
            if (el.classList.contains("leaving")) return;
            const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
            if (reduce) { el.remove(); settle(box); return; }
            el.style.height = el.offsetHeight + "px";
            el.classList.add("leaving");
            setTimeout(() => {
                el.classList.add("folding");
                el.style.height = "0px";
            }, 300);
            setTimeout(() => { el.remove(); settle(box); }, 560);
        }
        const run = () => { started = Date.now(); timer = setTimeout(dismiss, left); };
        if (ms > 0) {
            el.addEventListener("mouseenter", () => { clearTimeout(timer); left -= Date.now() - started; el.classList.add("paused"); });
            el.addEventListener("mouseleave", () => { el.classList.remove("paused"); run(); });
            run();
        }
        x.addEventListener("click", dismiss);
        return dismiss;
    };

    Sahyog.toastSuccess = (m, o) => Sahyog.toast(m, { ...(o || {}), kind: "success" });
    Sahyog.toastError = (m, o) => Sahyog.toast(m, { ...(o || {}), kind: "error" });
    Sahyog.toastWarn = (m, o) => Sahyog.toast(m, { ...(o || {}), kind: "warn" });

    // When a window opens on top of the toasts, lift the toasts back above it.
    const lift = () => {
        const box = document.getElementById("toasts");
        if (box?.querySelector(".sn-toast:not(.leaving)")) raise(box);
    };
    const origShowModal = window.HTMLDialogElement?.prototype.showModal;
    if (origShowModal) {
        HTMLDialogElement.prototype.showModal = function () {
            const r = origShowModal.apply(this, arguments);
            lift();
            return r;
        };
    }

    // Messages written by the server into the page.
    const fromPage = () => {
        document.querySelectorAll("[data-toast]").forEach((el) => {
            const action = el.dataset.toastCopy
                ? { text: el.dataset.toastActionText || "Copy", close: false,
                    onClick: () => navigator.clipboard?.writeText(el.dataset.toastCopy).then(() => Sahyog.toast(el.dataset.toastCopied || "Copied", { kind: "success" })) }
                : null;
            Sahyog.toast(el.dataset.toast, {
                kind: el.dataset.toastKind,
                title: el.dataset.toastTitle,
                ms: el.dataset.toastMs ? Number(el.dataset.toastMs) : undefined,
                action
            });
            el.remove();
        });
        document.querySelectorAll("[data-toast-error]").forEach((el) => { Sahyog.toast(el.dataset.toastError, { kind: "error" }); el.remove(); });
    };
    // Wait a tick so dialogs that open on load are already showing; the toast then sits above them.
    const start = () => setTimeout(fromPage, 0);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
})();
