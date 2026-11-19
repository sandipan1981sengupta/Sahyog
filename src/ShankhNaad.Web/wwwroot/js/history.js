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

    // the All / Missed / Incoming / Outgoing (or Shared by you / with you) tabs: the same glass tabs as the Clients page
    if (window.jQuery) jQuery(box).find("[id$='Tabs']").on("tabcontrol:select", (e, id) => { show = id || "all"; apply(); });
    box.querySelectorAll(".sn-hist-chips [data-type]").forEach((b) => b.addEventListener("click", () => {
        box.querySelectorAll(".sn-hist-chips [data-type]").forEach((x) => x.classList.toggle("on", x === b));
        type = b.dataset.type;
        apply();
    }));
    search?.addEventListener("input", apply);
    apply();

    // ---------- delete: one, the picked ones, or all ----------
    const url = box.dataset.deleteUrl, noun = box.dataset.noun || "item", nouns = box.dataset.nouns || "items";
    const isFiles = box.id === "fileHist";
    const confirmPost = (action, fields, title, text, confirmText) => {
        if (window.SN?.confirmPost) SN.confirmPost(action, { title, text, confirmText, danger: true, fields });
        else if (window.confirm(text)) {   // fallback without the confirm box
            const f = document.createElement("form"); f.method = "post"; f.action = action;
            const add = (n, v) => { const i = document.createElement("input"); i.type = "hidden"; i.name = n; i.value = v; f.appendChild(i); };
            add("__RequestVerificationToken", window.Sahyog?.antiforgery?.() || "");
            Object.entries(fields).forEach(([k, v]) => add(k, v));
            document.body.appendChild(f); f.submit();
        }
    };
    const listNote = isFiles ? " They stay in the chat and still use storage; this only cleans up your Files list." : " The other person keeps theirs.";

    // pick mode
    const toggle = box.querySelector("[data-select-toggle]");
    const delSel = box.querySelector("[data-delete-selected]");
    const countEl = box.querySelector("[data-pick-count]");
    const picked = () => rows.filter((r) => !r.hidden && r.querySelector("[data-pick]")?.checked);
    const paintPick = () => {
        const n = picked().length;
        if (countEl) countEl.textContent = n;
        if (delSel) delSel.hidden = !box.classList.contains("picking") || n === 0;
        rows.forEach((r) => r.classList.toggle("picked", !!r.querySelector("[data-pick]")?.checked));
    };
    toggle?.addEventListener("click", () => {
        const on = box.classList.toggle("picking");
        toggle.querySelector("span").textContent = on ? "Done" : "Select";
        toggle.classList.toggle("on", on);
        if (!on) rows.forEach((r) => { const c = r.querySelector("[data-pick]"); if (c) c.checked = false; });
        paintPick();
    });
    box.addEventListener("change", (e) => { if (e.target.matches("[data-pick]")) paintPick(); });
    // in pick mode a click on the row ticks it
    box.addEventListener("click", (e) => {
        if (!box.classList.contains("picking")) return;
        const r = e.target.closest(".sn-hrow");
        if (!r || e.target.closest("a, button, input, form")) return;
        const c = r.querySelector("[data-pick]");
        if (c) { c.checked = !c.checked; paintPick(); }
    });

    delSel?.addEventListener("click", () => {
        const ids = picked().map((r) => r.dataset.id);
        if (!ids.length) return;
        confirmPost(url, { ids: ids.join(","), all: "false" },
            isFiles ? "Remove from my list" : `Delete ${ids.length} ${ids.length === 1 ? noun : nouns}`,
            `Remove ${ids.length === 1 ? `this ${noun}` : `these ${ids.length} ${nouns}`} from your list?${listNote}`,
            isFiles ? "Remove" : "Delete");
    });
    box.querySelector("[data-delete-all]")?.addEventListener("click", () => {
        if (!rows.length) { window.Sahyog?.toast?.(`There are no ${nouns} in your list.`, { kind: "info" }); return; }
        confirmPost(url, { all: "true", ids: "" },
            isFiles ? "Clear my list" : `Delete all ${nouns}`,
            isFiles
                ? `Hide all ${rows.length} ${rows.length === 1 ? noun : nouns} from your Files list? They stay in the chat, others still see them, and they still use storage. To really delete files, use "Delete for everyone" on your own files${document.getElementById("freeSpaceDialog") ? ', or "Free up space"' : ""}.`
                : `Remove all ${rows.length} ${rows.length === 1 ? noun : nouns} from your list?${listNote} This can't be undone.`,
            isFiles ? "Clear my list" : "Delete all");
    });

    // one row: calls and other people's files are removed from your list;
    // a file you shared yourself can also be deleted for everyone
    const chooser = (row) => {
        const d = document.createElement("dialog");
        d.className = "sn-del-choose";
        d.innerHTML = `<h3>Delete “${row.dataset.label.replace(/[<>&"]/g, "")}”</h3>
            <button type="button" data-c="everyone" class="danger"><i class="fa fa-trash" aria-hidden="true"></i><span><b>Delete for everyone</b><small>Gone from the chat and from storage</small></span></button>
            <button type="button" data-c="mine"><i class="fa fa-eye-slash" aria-hidden="true"></i><span><b>Remove from my list</b><small>Stays in the chat</small></span></button>
            <button type="button" data-c="cancel" class="plain">Cancel</button>`;
        document.body.appendChild(d);
        d.addEventListener("close", () => d.remove());
        d.addEventListener("click", (e) => {
            const b = e.target.closest("[data-c]");
            if (e.target === d || b?.dataset.c === "cancel") { d.close(); return; }
            if (!b) return;
            d.close();
            if (b.dataset.c === "everyone")
                confirmPost(`/files/${row.dataset.id}/delete-everyone`, {}, "Delete for everyone",
                    "Delete this file for everyone? It disappears from the chat too. This can't be undone.", "Delete for everyone");
            else confirmPost(url, { ids: row.dataset.id, all: "false" }, "Remove from my list", "Remove this file from your Files list? It stays in the chat.", "Remove");
        });
        d.showModal();
    };
    box.addEventListener("click", (e) => {
        const b = e.target.closest("[data-del-one]");
        if (!b) return;
        const row = b.closest(".sn-hrow");
        if (isFiles && row.dataset.mine === "1") { chooser(row); return; }
        confirmPost(url, { ids: row.dataset.id, all: "false" },
            isFiles ? "Remove from my list" : "Delete call",
            isFiles ? `Remove “${row.dataset.label}” from your Files list? It stays in the chat.`
                    : `Delete ${row.dataset.label} from your call history? The other person keeps theirs.`,
            isFiles ? "Remove" : "Delete");
    });

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
