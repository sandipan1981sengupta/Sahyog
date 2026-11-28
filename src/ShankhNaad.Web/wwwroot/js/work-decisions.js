// ShankhNaad · Work → Decisions (Nirnay): the register. Tabs, source chips, team, period, search, export,
// and "Waiting for your answer": items someone asked you to own (Accept / Decline; 55_DecisionOwners.sql).
// The record window, cards and meeting window live in js/nirnay.js (app bundle). Server: Controllers/DecisionsController.cs
(function () {
    "use strict";
    const box = document.getElementById("nirReg");
    const N = window.SN && window.SN.nirnay;
    if (!box || !N) return;
    let cfg = {};
    try { cfg = JSON.parse(document.getElementById("nirData")?.textContent || "{}"); } catch { }
    const me = cfg.me;
    const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const initials = (n) => String(n || "?").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
    const listEl = box.querySelector(".sn-nir-list");
    const LIMIT = 300;

    const st = { tab: "all", src: "", open: false, dept: "", period: "", q: "" };
    let rows = [];            // everything loaded (latest 300 you can see, for the period)
    let serverQ = "";         // when the list was full, a search asks the server too

    // ---------- load ----------
    function query(extra) {
        const p = new URLSearchParams();
        if (st.period) p.set("period", st.period);
        Object.entries(extra || {}).forEach(([k, v]) => { if (v) p.set(k, v); });
        return p.toString();
    }
    let seq = 0;
    async function load() {
        const mine = ++seq;
        const q = rows.length >= LIMIT && st.q ? st.q : "";
        try {
            const r = await fetch(`/work/decisions/list?${query({ q })}`, { headers: { Accept: "application/json" } });
            const d = r.ok ? await r.json() : [];
            if (mine !== seq) return;
            rows = Array.isArray(d) ? d : [];
            serverQ = q;
        } catch { if (mine === seq) rows = []; }
        paint();
    }

    // ---------- filter + paint ----------
    const matches = (x) => {
        if (st.src === "chat" && !x.messageId) return false;
        if (st.src === "meeting" && !x.meetingId) return false;
        if (st.src === "other" && (x.messageId || x.meetingId)) return false;
        if (st.open && !(x.isAction && !x.doneUtc)) return false;
        if (st.dept && x.departmentId !== st.dept) return false;
        if (st.q) {
            const hay = [x.title, x.details, x.ownerName, x.channelName, x.meetingTitle, x.departmentName, x.recordedByName].join(" ").toLowerCase();
            if (!st.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
        }
        return true;
    };
    const inTab = (x, tab) => tab === "all" || (tab === "mine" ? (x.ownerId === me || x.recordedBy === me || x.askedOwnerId === me) : x.kind === tab);

    function where(x) {
        if (x.messageId) return `<a class="sn-nir-where" href="/chat/${esc(x.channelId)}?m=${x.messageId}" title="Open the message in the chat"><i class="fa ${x.channelIsDirect ? "fa-comment-o" : "fa-comments-o"}" aria-hidden="true"></i><span class="ellipsis">${x.channelIsDirect ? "One-to-one chat" : esc(x.channelName || "Chat")}</span></a>`;
        if (x.meetingId) return `<a class="sn-nir-where" href="/meetings/${esc(x.meetingId)}/view${x.meetingDate ? "?date=" + esc(x.meetingDate) : ""}" title="Open the meeting"><i class="fa fa-calendar" aria-hidden="true"></i><span class="ellipsis">${esc(x.meetingTitle || "Meeting")}</span></a>`;
        return `<span class="sn-nir-where muted"><i class="fa fa-pencil" aria-hidden="true"></i><span>Added here</span></span>`;
    }
    // under the owner's name: a pending ask, a "no", or the team
    function ownerNote(x) {
        if (x.askedOwnerId) return `<small class="ellipsis ask" title="Asked ${esc(N.day(x.askedUtc))}. It becomes theirs when they accept.">asked ${x.askedOwnerId === me ? "you" : esc(x.askedOwnerName || "someone")} · waiting</small>`;
        if (x.declinedBy) return `<small class="ellipsis no" title="${esc(N.day(x.declinedUtc))}">${x.declinedBy === me ? "you" : esc(x.declinedByName || "someone")} said no</small>`;
        return `<small class="ellipsis">${esc(x.departmentName || "")}</small>`;
    }
    // "Waiting for your answer": items people asked you to own; they aren't yours until you accept
    function asksHtml() {
        const asks = rows.filter((x) => x.askedOwnerId === me);
        if (!asks.length) return "";
        return `<div class="sn-nir-asks" aria-label="Waiting for your answer">
            <div class="sn-nir-asks-h"><i class="fa fa-hand-paper-o" aria-hidden="true"></i> Waiting for your answer <span>${asks.length}</span>
                <small>People asked you to own these. They become yours only when you accept; decline and they stay with whoever asked.</small></div>
            ${asks.map((x) => `<div class="sn-nir-askrow" data-id="${x.decisionId}">
                <span class="sn-nir-tile${x.isAction ? " act" : ""}" aria-hidden="true"><i class="fa ${x.isAction ? "fa-check-square-o" : "fa-balance-scale"}"></i></span>
                <button type="button" class="sn-nir-open-row" data-row-open="${x.decisionId}"><b>${esc(x.title)}</b>
                    <small>${[x.isAction ? "Action item" : "Decision", `asked by ${esc(x.ownerName || x.recordedByName || "someone")} · ${esc(N.day(x.askedUtc))}`, x.isAction && x.dueDate ? `due ${esc(N.dueText(x.dueDate))}` : ""].filter(Boolean).join(" · ")}</small></button>
                <span class="sn-nir-st-btns"><button type="button" class="cee-btn cee-btn-gradient" data-ask-accept="${x.decisionId}"><i class="fa fa-check" aria-hidden="true"></i> <span>Accept</span></button>
                    <button type="button" class="cee-btn sn-btn-light" data-ask-decline="${x.decisionId}"><span>Decline</span></button></span>
            </div>`).join("")}
        </div>`;
    }
    function rowHtml(x) {
        const late = N.overdue(x), done = !!x.doneUtc;
        const sub = [
            x.isAction ? (done ? "Done" : x.dueDate ? `<span class="${late ? "late" : ""}">${late ? "Overdue · " : "Due "}${esc(N.dueText(x.dueDate))}</span>` : "No due date") : "Decision",
            x.details ? esc(x.details.length > 110 ? x.details.slice(0, 110) + "…" : x.details) : ""
        ].filter(Boolean).join(" · ");
        return `<div class="sn-hrow sn-nir-row${x.isAction ? " act" : ""}${done ? " done" : ""}${late ? " late" : ""}" data-id="${x.decisionId}">
            ${x.isAction
                ? `<label class="sn-nir-tick big" title="${done ? "Mark as not done" : "Mark as done"}"><input type="checkbox" data-row-done="${x.decisionId}"${done ? " checked" : ""} aria-label="Done"><span></span></label>`
                : `<span class="sn-nir-tile" aria-hidden="true"><i class="fa fa-balance-scale"></i></span>`}
            <button type="button" class="sn-hmain sn-nir-open-row" data-row-open="${x.decisionId}"><b>${esc(x.title)}</b><small class="sn-hstat">${sub}</small></button>
            <span class="sn-nir-owner">${x.ownerId ? `<span class="avatar av-28 tone-${(x.ownerTone || 0) % 6}" data-user="${esc(x.ownerId)}">${esc(initials(x.ownerName))}</span><span><b class="ellipsis">${x.ownerId === me ? "You" : esc(x.ownerName)}</b>${ownerNote(x)}</span>` : '<span class="muted small">No owner</span>'}</span>
            ${where(x)}
            <time class="sn-htime" datetime="${esc(x.recordedUtc)}" title="Recorded by ${esc(x.recordedByName || "")}">${esc(N.day(x.recordedUtc))}</time>
        </div>`;
    }
    function paint() {
        const pool = rows.filter(matches);
        const count = (t) => pool.filter((x) => inTab(x, t)).length;
        ["all", "D", "A", "mine"].forEach((t) => window.SN.wk.tabBadge("nirTabs", t, count(t), true));
        // the four totals: across everything loaded (not the filters)
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const open = rows.filter((x) => x.isAction && !x.doneUtc);
        const set = (k, v) => { const el = document.querySelector(`[data-stat="${k}"]`); if (el) el.textContent = v; };
        set("dec", rows.filter((x) => !x.isAction).length);
        set("open", open.length);
        set("late", open.filter((x) => N.overdue(x)).length);
        set("mine", open.filter((x) => x.ownerId === me).length);

        const shown = pool.filter((x) => inTab(x, st.tab));
        if (!rows.length) {
            listEl.innerHTML = `<div class="sn-hist-empty sn-nir-emptybox">
                <span class="sn-hist-empty-ic"><i class="fa fa-balance-scale" aria-hidden="true"></i></span>
                <b>No decisions yet</b>
                <p>In any chat, point at a message and press <i class="fa fa-balance-scale" aria-hidden="true"></i> to record it as a decision or an action item. Meetings have a Decisions button too.</p>
                <button type="button" class="sn-hbtn chat" data-nir-new><i class="fa fa-plus" aria-hidden="true"></i><span>Add the first one</span></button>
            </div>`;
            return;
        }
        const asks = asksHtml();
        if (!shown.length) { listEl.innerHTML = asks + `<div class="sn-hist-none">Nothing matches. Try another tab, filter or word.</div>`; return; }
        // grouped by month, newest first
        let html = asks, last = "";
        shown.forEach((x) => {
            const m = new Date(x.recordedUtc).toLocaleDateString(undefined, { month: "long", year: "numeric" });
            if (m !== last) { html += `<div class="sn-hist-day">${esc(m)}</div>`; last = m; }
            html += rowHtml(x);
        });
        if (rows.length >= LIMIT && !serverQ) html += `<p class="sn-nir-more muted small">Showing the latest ${LIMIT}. Search to find older ones.</p>`;
        listEl.innerHTML = html;
    }

    // ---------- events ----------
    const upsert = (d) => {
        if (!d || !d.decisionId) return;
        const i = rows.findIndex((x) => x.decisionId === d.decisionId);
        if (i >= 0) rows[i] = d; else rows.unshift(d);
        paint();
    };
    const drop = (id) => { rows = rows.filter((x) => x.decisionId !== id); paint(); };
    box.addEventListener("click", (e) => {
        const t = e.target;
        const src = t.closest("[data-src]");
        if (src) { st.src = src.dataset.src; box.querySelectorAll("[data-src]").forEach((b) => b.classList.toggle("on", b === src)); paint(); return; }
        if (t.closest("[data-nir-new]")) { N.record({ kind: st.tab === "A" ? "A" : "D" }, upsert, drop); return; }
        const ans = t.closest("[data-ask-accept], [data-ask-decline]");
        if (ans) {
            const id = Number(ans.dataset.askAccept || ans.dataset.askDecline), x = rows.find((r) => r.decisionId === id);
            if (x) { ans.disabled = true; N.answer(x, !!ans.dataset.askAccept).then((d) => { ans.disabled = false; if (d && d.gone) drop(id); else if (d) upsert(d); }); }
            return;
        }
        const op = t.closest("[data-row-open]");
        if (op) { const x = rows.find((r) => r.decisionId === Number(op.dataset.rowOpen)); if (x) N.record({ decision: x }, upsert, drop); return; }
        if (t.closest("[data-nir-export]")) {
            const tabKind = st.tab === "D" || st.tab === "A" ? st.tab : "";
            location.href = `/work/decisions/export?${query({ kind: tabKind, mine: st.tab === "mine" ? "true" : "", open: st.open ? "true" : "", source: st.src, dept: st.dept, q: st.q })}`;
        }
    });
    box.addEventListener("change", async (e) => {
        const t = e.target;
        if (t.matches("[data-row-done]")) { const d = await N.setDone(Number(t.dataset.rowDone), t.checked, t); if (d) upsert(d); return; }
        if (t.id === "nirOpenOnly") { st.open = t.checked; paint(); }
    });
    // the dropdowns (tag-helper controls) report their choice through jQuery on the hidden input
    const $ = window.jQuery;
    if ($) $(box).on("change", "#nirDeptF_value, #nirPeriod_value", function () {
        if (this.id === "nirDeptF_value") { st.dept = this.value; paint(); }
        else { st.period = this.value; load(); }
    });
    let qt = 0;
    box.querySelector("#nirQ")?.addEventListener("input", (e) => {
        st.q = e.target.value.trim();
        paint();
        clearTimeout(qt);
        if (rows.length >= LIMIT || serverQ) qt = setTimeout(load, 350);
    });
    // the clear (×) button of the search box
    box.querySelector("#nirQ")?.closest(".modern-input-wrapper")?.addEventListener("click", (e) => {
        if (e.target.closest(".mi-clear-btn")) setTimeout(() => { st.q = ""; paint(); }, 0);
    });
    // answers, hand-backs and new asks (js/nirnay.js): keep the list current
    document.addEventListener("sn:nirnay", (e) => {
        const d = e.detail || {};
        if (!document.body.contains(box)) return;
        if (d.reload) load(); else if (d.gone) drop(d.id); else upsert(d);
    });
    // the glass tabs (tab-control): All / Decisions / Action items / Mine
    window.SN.wk.onTab("nirTabs", (id) => { st.tab = id || "all"; paint(); });
    // a "Mine" link: /work/decisions?tab=mine
    const want = new URLSearchParams(location.search).get("tab");
    if (want) window.SN.wk.pickTab("nirTabs", want);
    load();
})();
