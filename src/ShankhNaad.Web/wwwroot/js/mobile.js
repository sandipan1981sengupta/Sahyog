// ShankhNaad · phone and tablet behaviour (the layout itself is in css/responsive.css).
(function () {
    "use strict";
    const phone = () => window.matchMedia("(max-width: 760px)").matches;
    const touch = () => window.matchMedia("(hover: none)").matches;
    const body = document.body;

    // Page parts (set up on each page, also after a partial page load: see sn-nav.js)
    const setupPage = () => {
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

    // ---- Chat list: a "⋯" button on each row (chats and the Team list). Phone: a sheet from the bottom. Bigger screens: a menu next to the button ----
    const side = document.querySelector(".chat-side");
    if (side) {
        const addMore = () => side.querySelectorAll(".sn-person-row, .sn-team-row").forEach((row) => {
            if (row.querySelector(".sn-row-more") || !row.querySelector(".sn-team-actions .sn-team-btn")) return;
            const b = document.createElement("button");
            b.type = "button";
            b.className = "sn-row-more";
            b.setAttribute("aria-label", "More options");
            b.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
            row.appendChild(b);
        });
        addMore();
        new MutationObserver(addMore).observe(side, { childList: true, subtree: true });

        side.addEventListener("click", (e) => {
            const more = e.target.closest(".sn-row-more");
            if (!more) return;
            e.preventDefault(); e.stopPropagation();
            const row = more.closest(".sn-person-row, .sn-team-row");
            const name = row.querySelector(".sn-person-open .grow, .sn-team-open .grow")?.textContent.trim() || "";
            const avatar = row.querySelector(".sn-person-open .avatar, .sn-team-open .avatar");
            // one item per row button; data-label / data-sub give the wording ("Call" · "Camera off · turn it on any time")
            const KINDS = ["pin", "ping", "chat", "video", "call", "org", "grp", "del"];
            const DEFAULTS = { pin: "Pin", ping: "Ping", chat: "Message", call: "Call", video: "Video call", org: "Organization chart", grp: "Create group", del: "Delete chat" };
            const items = [];
            let last = "";
            row.querySelectorAll(".sn-team-actions .sn-team-btn").forEach((src) => {
                const kind = KINDS.find((k) => src.classList.contains(k)) || "";
                // a thin line between groups of actions: pin/ping · calls · org/group · delete
                const group = { pin: 1, ping: 1, chat: 1, call: 2, video: 2, org: 3, grp: 3, del: 4 }[kind] || 0;
                if (last && group !== last) items.push("sep");
                last = group;
                const label = kind === "pin" ? (src.getAttribute("aria-label") || "Pin") : (src.getAttribute("data-label") || DEFAULTS[kind] || src.getAttribute("aria-label") || "");
                items.push({ kind: kind === "video" ? "call" : kind, label, sub: src.getAttribute("data-sub") || (kind === "ping" ? "A gentle nudge to look at the chat" : ""),
                    icon: src.querySelector("i")?.className || "fa fa-circle", run: () => src.click() });
            });
            if (window.SN && SN.openMenu) SN.openMenu(more, { name, avatar }, items);
        }, true);
        side.addEventListener("scroll", () => { if (window.SN && SN.closeMenu && !window.matchMedia("(max-width: 760px)").matches) SN.closeMenu(); }, true);
    }

    };
    if (window.SN && SN.onPage) SN.onPage(setupPage); else setupPage();

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
