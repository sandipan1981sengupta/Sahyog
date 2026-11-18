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

    // ---- Chat list: a "⋯" button on each row. Phone: a sheet from the bottom. Bigger screens: a menu next to the button ----
    const side = document.querySelector(".chat-side");
    if (side) {
        const addMore = () => side.querySelectorAll(".sn-person-row").forEach((row) => {
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

        const esc = (t) => String(t || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
        let open = null;
        const close = () => {
            if (!open) return;
            const { scrim, sheet, btn } = open; open = null;
            btn?.classList.remove("on");
            scrim.classList.remove("show"); sheet.classList.remove("show");
            setTimeout(() => { scrim.remove(); sheet.remove(); }, 320);
        };
        side.addEventListener("click", (e) => {
            const more = e.target.closest(".sn-row-more");
            if (!more) return;
            e.preventDefault(); e.stopPropagation();
            const row = more.closest(".sn-person-row");
            const name = row.querySelector(".sn-person-open .grow")?.textContent.trim() || "";
            const avatar = row.querySelector(".sn-person-open .avatar")?.cloneNode(true);
            const scrim = document.createElement("div"); scrim.className = "sn-sheet-scrim";
            const sheet = document.createElement("div"); sheet.className = "sn-sheet"; sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-label", name);
            sheet.innerHTML = '<div class="sn-sheet-grip"></div><div class="sn-sheet-head"><b>' + esc(name) + "</b></div>";
            if (avatar) { avatar.querySelector(".dot")?.remove(); sheet.querySelector(".sn-sheet-head").prepend(avatar); }
            row.querySelectorAll(".sn-team-actions .sn-team-btn").forEach((src) => {
                const kind = ["pin", "ping", "call", "del"].find((k) => src.classList.contains(k)) || "";
                const label = kind === "pin" ? (src.getAttribute("aria-label") || "Pin") : kind === "ping" ? "Ping" : kind === "call" ? "Video call" : kind === "del" ? "Delete chat" : (src.getAttribute("aria-label") || "");
                const icon = src.querySelector("i")?.className || "fa fa-circle";
                const item = document.createElement("button");
                item.type = "button";
                item.className = "sn-sheet-item " + kind;
                item.innerHTML = '<span class="sn-sheet-ic ' + kind + '"><i class="' + esc(icon) + '" aria-hidden="true"></i></span><span>' + esc(label) + "</span>";
                item.addEventListener("click", () => { close(); setTimeout(() => src.click(), 60); });
                sheet.appendChild(item);
            });
            const cancel = document.createElement("button");
            cancel.type = "button"; cancel.className = "sn-sheet-cancel"; cancel.textContent = "Cancel";
            cancel.addEventListener("click", close);
            sheet.appendChild(cancel);
            scrim.addEventListener("click", close);
            const asPop = !phone();
            if (asPop) {
                sheet.classList.add("pop"); scrim.classList.add("pop");
                more.classList.add("on");
            }
            body.append(scrim, sheet);
            if (asPop) {
                // just below the ⋯ button, its right edge lined up with the button; above it when there's no room below
                const r = more.getBoundingClientRect(), h = sheet.offsetHeight, w = sheet.offsetWidth;
                const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
                let top = r.bottom + 6;
                if (top + h > window.innerHeight - 8) { top = Math.max(8, r.top - h - 6); sheet.classList.add("up"); }
                sheet.style.left = left + "px"; sheet.style.top = top + "px";
            }
            open = { scrim, sheet, btn: more };
            requestAnimationFrame(() => { scrim.classList.add("show"); sheet.classList.add("show"); });
            sheet.querySelector(".sn-sheet-item")?.focus({ preventScroll: true });
        }, true);
        document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
        window.addEventListener("resize", close);
        side.addEventListener("scroll", () => { if (open?.sheet.classList.contains("pop")) close(); }, true);
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
