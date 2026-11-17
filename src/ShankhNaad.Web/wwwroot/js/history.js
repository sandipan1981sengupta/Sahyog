// ShankhNaad · Calls and Files pages: tabs, type chips, search, friendly dates and day headings.
(function () {
    "use strict";
    const box = document.querySelector(".sn-hist");
    if (!box) return;
    const rows = [...box.querySelectorAll(".sn-hrow")];
    const list = box.querySelector(".sn-hist-list");
    const none = box.querySelector(".sn-hist-none");
    const search = box.querySelector("[data-hist-search]");
    let show = "all", type = "";

    const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const dayLabel = (d) => {
        const today = new Date(), y = new Date(); y.setDate(today.getDate() - 1);
        if (dayKey(d) === dayKey(today)) return "Today";
        if (dayKey(d) === dayKey(y)) return "Yesterday";
        const sameYear = d.getFullYear() === today.getFullYear();
        return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }) });
    };
    // times in your own time zone
    rows.forEach((r) => {
        const t = r.querySelector("time[data-utc]");
        if (t) t.textContent = new Date(t.dataset.utc).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    });

    function apply() {
        const q = (search?.value || "").trim().toLowerCase();
        list.querySelectorAll(".sn-hist-day").forEach((d) => d.remove());
        let last = null, shown = 0;
        rows.forEach((r) => {
            const kinds = (r.dataset.kind || "").split(" ");
            const ok = (show === "all" || kinds.includes(show))
                && (!type || r.dataset.type === type)
                && (!q || (r.dataset.filter || "").toLowerCase().includes(q));
            r.hidden = !ok;
            if (!ok) return;
            shown++;
            const d = new Date(r.dataset.utc), k = dayKey(d);
            if (k !== last) {
                const h = document.createElement("div");
                h.className = "sn-hist-day";
                h.textContent = dayLabel(d);
                r.before(h);
                last = k;
            }
        });
        if (none) none.hidden = shown > 0 || rows.length === 0;
    }

    box.querySelectorAll(".sn-hist-tabs [data-show]").forEach((b) => b.addEventListener("click", () => {
        box.querySelectorAll(".sn-hist-tabs [data-show]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", String(x === b)); });
        show = b.dataset.show;
        apply();
    }));
    box.querySelectorAll(".sn-hist-chips [data-type]").forEach((b) => b.addEventListener("click", () => {
        box.querySelectorAll(".sn-hist-chips [data-type]").forEach((x) => x.classList.toggle("on", x === b));
        type = b.dataset.type;
        apply();
    }));
    search?.addEventListener("input", apply);
    apply();

    // live: a call or a file in one of your chats → refresh the list (quietly, at most every few seconds)
    let pending = null;
    const later = () => { clearTimeout(pending); pending = setTimeout(() => { if (!document.hidden) location.reload(); }, 2500); };
    const hook = () => {
        const hub = window.Sahyog?.hub;
        if (!hub) return;
        if (box.id === "callHist") hub.on("CallUpdated", later);
        if (box.id === "fileHist") hub.on("MessageReceived", (m) => { if (m && m.attachment) later(); });
    };
    if (window.Sahyog?.hub) hook(); else window.addEventListener("load", hook);
})();
