// ShankhNaad · phone and tablet behaviour (the layout itself is in css/responsive.css).
(function () {
    "use strict";
    const phone = () => window.matchMedia("(max-width: 760px)").matches;
    const touch = () => window.matchMedia("(hover: none)").matches;
    const body = document.body;

    // ---- Chat on a phone or tablet: the list, or the open conversation with a back button ----
    const chat = document.getElementById("chat");
    if (chat) {
        // A conversation counts as "open" only when its address says so (/chat/{id}). Plain /chat —
        // the ‹ back button, or the Chat tab — shows the list (the server still picks a chat for big screens).
        const open = /^\/chat\/[0-9a-f-]{36}\/?$/i.test(location.pathname) && !!(chat.dataset.channel || "").trim();
        body.classList.toggle("sn-chat-open", open);
        if (open) {
            const left = document.querySelector(".sn-chat-page .sn-head .hdr-left");
            if (left && !left.querySelector(".sn-chat-back")) {
                const back = document.createElement("a");
                back.href = "/chat?list=1";
                back.className = "sn-chat-back";
                back.setAttribute("aria-label", "Back to chats");
                back.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>';
                left.prepend(back);
            }
        }
        // the Details panel starts closed on a phone, and has its own close button
        const info = document.querySelector(".chat-info");
        if (info) {
            // On tablets and phones there's no room for Details next to the chat, so it's closed
            // there — on page load AND whenever the window is made narrower. Made wide again,
            // it comes back the way you last left it on a big screen.
            const narrow = window.matchMedia("(max-width: 1100px)");
            const savedWide = () => { try { return localStorage.getItem("sn-hide-details") !== "1"; } catch { return true; } };
            const apply = () => {
                if (narrow.matches) body.classList.add("sn-hide-info");
                else body.classList.toggle("sn-hide-info", !savedWide());
                document.querySelectorAll('[data-details-btn], .sn-details-btn').forEach((b) => b.setAttribute("aria-pressed", String(!body.classList.contains("sn-hide-info"))));
            };
            apply();
            narrow.addEventListener("change", apply);
            if (!info.querySelector(".sn-info-close")) {
                const x = document.createElement("button");
                x.type = "button";
                x.className = "sn-info-close";
                x.setAttribute("aria-label", "Close details");
                x.innerHTML = "&times;";
                x.addEventListener("click", () => { if (window.SN?.toggleDetails) SN.toggleDetails(); else body.classList.add("sn-hide-info"); });
                info.prepend(x);
            }
        }
    }

    // ---- touch screens: tap a message to show its reactions and delete button ----
    document.addEventListener("click", (e) => {
        if (!touch()) return;
        const msg = e.target.closest(".msg");
        if (e.target.closest("button, a, input, textarea")) return;
        document.querySelectorAll(".msg.show-acts").forEach((m) => { if (m !== msg) m.classList.remove("show-acts"); });
        if (msg && e.target.closest(".bubble, .msg-body")) msg.classList.toggle("show-acts");
    });

    // ---- never let the page slide sideways (something wider can push it; this puts it back) ----
    const unslide = (el) => { if (el && el.scrollLeft) el.scrollLeft = 0; };
    const boxes = () => [document.documentElement, body, document.querySelector(".sn-shell"), document.querySelector(".sn-col"), document.querySelector(".sn-page")];
    document.addEventListener("scroll", (e) => { const t = e.target === document ? document.documentElement : e.target; if (t && t.scrollLeft && boxes().includes(t)) unslide(t); }, true);
    window.addEventListener("load", () => boxes().forEach(unslide));

    // ---- the on-screen keyboard: keep the message box in view ----
    if (window.visualViewport) {
        const fit = () => document.documentElement.style.setProperty("--sn-vvh", `${window.visualViewport.height}px`);
        window.visualViewport.addEventListener("resize", fit);
        fit();
    }
})();
