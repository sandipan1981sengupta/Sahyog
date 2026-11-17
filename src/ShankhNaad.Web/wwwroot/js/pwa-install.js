// ShankhNaad · desktop app (installable web app).
// Registers the service worker, keeps the browser's install prompt, and gives
// SN.installApp() to the "Install desktop app" menu item and the install dialog.
(function () {
    "use strict";

    const SN = (window.SN = window.SN || {});
    let deferredPrompt = null;

    /** True when ShankhNaad is open in its own app window (not a browser tab). */
    SN.isApp = () =>
        window.matchMedia("(display-mode: standalone)").matches ||
        window.matchMedia("(display-mode: window-controls-overlay)").matches ||
        window.matchMedia("(display-mode: minimal-ui)").matches ||
        window.navigator.standalone === true;

    const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

    const message = (title, text, type) => {
        if (typeof openMessageBox === "function") openMessageBox({ title, text, type: type || "info", icon: "arrow" });
        else alert(title + "\n\n" + text);
    };

    function applyMode() {
        const app = SN.isApp();
        document.body?.classList.toggle("sn-app", app);
        document.querySelectorAll("[data-strip-install-item]").forEach((el) => { el.hidden = app; });
        document.querySelectorAll("[data-running-as]").forEach((el) => { el.textContent = app ? "Desktop app (own window)" : "Web browser"; });
        document.querySelectorAll("[data-install-only]").forEach((el) => { el.hidden = app; });
    }

    // Keep the browser's own install prompt so our button can show it later.
    window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        deferredPrompt = e;
    });

    window.addEventListener("appinstalled", () => {
        deferredPrompt = null;
        document.getElementById("installDialog")?.close();
        message("App installed", "ShankhNaad is installed. Open it from your Desktop, Start menu or taskbar. No browser needed.", "success");
    });

    /** Shows the browser's install box, or simple steps when the browser has none to offer. */
    SN.installApp = () => {
        if (SN.isApp()) {
            message("Already installed", "You are using the ShankhNaad desktop app.", "info");
            return;
        }
        if (deferredPrompt) {
            const prompt = deferredPrompt;
            deferredPrompt = null;              // a prompt can be used only once
            prompt.prompt();
            prompt.userChoice.then((choice) => {
                if (choice && choice.outcome === "accepted") document.getElementById("installDialog")?.close();
            });
            return;
        }
        if (isIos()) {
            message("Install ShankhNaad", "In Safari, tap the Share button, then 'Add to Home Screen'.", "warning");
        } else {
            message("Install ShankhNaad",
                "Use Chrome or Edge. In Edge open the menu (…) → Apps → Install this site as an app. " +
                "In Chrome open the menu (⋮) → Cast, save and share → Install page as app. " +
                "If ShankhNaad is already installed, open it from your Desktop or Start menu.",
                "warning");
        }
    };

    if ("serviceWorker" in navigator) {
        window.addEventListener("load", () => {
            navigator.serviceWorker.register("/service-worker.js", { scope: "/" })
                .catch((err) => console.warn("Service worker registration failed:", err));
        });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", applyMode);
    else applyMode();
    window.matchMedia("(display-mode: standalone)").addEventListener?.("change", applyMode);
    window.matchMedia("(display-mode: window-controls-overlay)").addEventListener?.("change", applyMode);
})();
