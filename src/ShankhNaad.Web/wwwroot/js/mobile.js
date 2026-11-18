// ShankhNaad · phone and tablet behaviour (the layout itself is in css/responsive.css).
(function () {
    "use strict";
    const phone = () => window.matchMedia("(max-width: 760px)").matches;
    const touch = () => window.matchMedia("(hover: none)").matches;
    const body = document.body;

    // ---- Chat on a phone: the list, or the open conversation with a back button ----
    const chat = document.getElementById("chat");
    if (chat) {
        const open = !!(chat.dataset.channel || "").trim();
        body.classList.toggle("sn-chat-open", open);
        if (open) {
            const left = document.querySelector(".sn-chat-page .sn-head .hdr-left");
            if (left && !left.querySelector(".sn-chat-back")) {
                const back = document.createElement("a");
                back.href = "/chat";
                back.className = "sn-chat-back sn-m-only";
                back.setAttribute("aria-label", "Back to chats");
                back.innerHTML = '<i class="fa fa-chevron-left" aria-hidden="true"></i>';
                left.prepend(back);
            }
        }
        // the Details panel starts closed on a phone, and has its own close button
        const info = document.querySelector(".chat-info");
        if (info) {
            // (on tablets and phones it opens over the conversation, so it starts closed)
            if (window.matchMedia("(max-width: 1100px)").matches) body.classList.add("sn-hide-info");
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

    // ---- the on-screen keyboard: keep the message box in view ----
    if (window.visualViewport) {
        const fit = () => document.documentElement.style.setProperty("--sn-vvh", `${window.visualViewport.height}px`);
        window.visualViewport.addEventListener("resize", fit);
        fit();
    }
})();
