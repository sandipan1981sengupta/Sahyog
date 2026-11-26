// ---------- Nirnay: the decision log ----------
// • "Mark as decision" (⚖) on a chat message → the record window → a card under the message, live for everyone in the chat.
// • A meeting's "Decisions" button (details window), and the organizer lands on it after leaving a meeting (?wrap=<id>).
// • The Decisions page (/work/decisions, js/work-decisions.js) uses the same record window.
// Server: Controllers/DecisionsController.cs · database: 46_Nirnay.sql
(function () {
    "use strict";
    const me = document.body && document.body.dataset.me;
    if (!me || !window.fetch) return;
    const IS_ADMIN = document.body.dataset.admin === "1";
    const SN = (window.SN = window.SN || {});
    const S = () => window.Sahyog || {};
    const token = () => (S().antiforgery && S().antiforgery()) || document.querySelector('input[name="__RequestVerificationToken"]')?.value || "";
    const toast = (text, kind, title) => S().toast?.(text, { kind: kind || "info", title });
    const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const initials = (n) => String(n || "?").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
    const post = (url, body) => fetch(url, {
        method: "POST",
        headers: Object.assign({ "RequestVerificationToken": token(), Accept: "application/json" }, body ? { "Content-Type": "application/json" } : {}),
        body: body ? JSON.stringify(body) : undefined
    }).then((r) => r.json().catch(() => ({})).then((d) => ({ ok: r.ok, d })));
    const getJson = (url) => fetch(url, { headers: { Accept: "application/json" } }).then((r) => r.json().catch(() => ({})).then((d) => ({ ok: r.ok, d })));

    // dates: "Tue 24 Nov"; a due date "yyyy-MM-dd" is a calendar day (no time zone)
    const day = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }); };
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const parseYmd = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
    const dueText = (s) => {
        const d = parseYmd(s); if (!d) return "";
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const diff = Math.round((d - today) / 86400000);
        return diff === 0 ? "today" : diff === 1 ? "tomorrow" : diff === -1 ? "yesterday" : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    };
    const overdue = (x) => x.isAction && !x.doneUtc && x.dueDate && parseYmd(x.dueDate) < new Date(new Date().setHours(0, 0, 0, 0));
    const canEdit = (x) => x.canEdit || IS_ADMIN || x.recordedBy === me || x.ownerId === me;

    // people for the owner picker (loaded once per page visit)
    let people = null;
    async function loadPeople() {
        if (people) return people;
        const x = await getJson("/work/decisions/people");
        people = x.ok && Array.isArray(x.d) ? x.d : [];
        return people;
    }

    // =================================================================
    // the record / edit window
    // ctx: { decision } to change one, or { messageId, channelId, text, senderId, senderName, where } from a message,
    //      or { meetingId, meetingDate, meetingTitle } from a meeting, or {} on the register. ctx.kind "A" starts as an action item.
    // onSaved(decision) runs after a save, onDeleted(id) after a delete.
    // =================================================================
    let dlg = null;
    async function openRecord(ctx, onSaved, onDeleted) {
        ctx = ctx || {};
        const list = await loadPeople();
        const d = ctx.decision || null;
        const readOnly = !!(d && !canEdit(d));
        const st = {
            kind: d ? d.kind : (ctx.kind === "A" ? "A" : "D"),
            title: d ? d.title : String(ctx.text || "").replace(/\s+/g, " ").trim().slice(0, 300),
            details: d ? (d.details || "") : "",
            owner: d ? d.ownerId : (list.some((p) => p.id === ctx.senderId) ? ctx.senderId : me),
            due: d ? (d.dueDate || "") : "",
            q: "", picking: false, armedDelete: false, busy: false
        };
        if (!dlg) {
            dlg = document.createElement("dialog");
            dlg.className = "sn-dialog glass-strong sn-nir-dlg";
            dlg.setAttribute("aria-labelledby", "snNirT");
            document.body.appendChild(dlg);
        }
        const person = (id) => list.find((p) => p.id === id) || (d && d.ownerId === id ? { id, name: d.ownerName, dept: d.departmentName, tone: d.ownerTone } : null);
        const source = d
            ? (d.messageId ? `From ${d.channelIsDirect ? "a one-to-one chat" : esc(d.channelName || "a chat")}` : d.meetingId ? `From the meeting ${esc(d.meetingTitle || "")}` : "Added on the Decisions page")
              + ` · recorded by ${d.recordedBy === me ? "you" : esc(d.recordedByName || "someone")} · ${day(d.recordedUtc)}`
            : ctx.messageId ? `From ${ctx.senderId === me ? "your" : esc((ctx.senderName || "a") + "'s")} message${ctx.where ? " in " + esc(ctx.where) : ""}`
            : ctx.meetingId ? `For the meeting ${esc(ctx.meetingTitle || "")}${ctx.meetingDate ? " · " + day(parseYmd(ctx.meetingDate)) : ""}`
            : "Everyone in the workspace can see decisions added here.";
        const quickDue = () => {
            const t = new Date(); t.setHours(0, 0, 0, 0);
            const add = (n) => { const x = new Date(t); x.setDate(x.getDate() + n); return x; };
            const fri = add((5 - t.getDay() + 7) % 7 || 7);
            const mon = add((8 - t.getDay()) % 7 || 7);
            return [["Today", add(0)], ["Tomorrow", add(1)], ["Friday", fri], ["Next week", mon]].map(([l, x]) => [l, ymd(x)]);
        };

        function ownerHtml() {
            const p = person(st.owner);
            if (readOnly) return p ? `<div class="sn-nir-who"><span class="avatar av-28 tone-${(p.tone || 0) % 6}">${esc(initials(p.name))}</span><span><b>${esc(p.name)}</b><small>${esc(p.dept || "")}</small></span></div>` : `<p class="muted">Nobody yet</p>`;
            if (p && !st.picking) return `<div class="sn-nir-who"><span class="avatar av-28 tone-${(p.tone || 0) % 6}">${esc(initials(p.name))}</span><span><b>${p.id === me ? "You" : esc(p.name)}</b><small>${esc([p.title, p.dept].filter(Boolean).join(" · "))}</small></span><button type="button" class="sn-link" data-pick>Change</button></div>`;
            const q = st.q.toLowerCase();
            const hits = list.filter((x) => !q || (x.name + " " + (x.dept || "") + " " + (x.title || "")).toLowerCase().includes(q)).slice(0, 7);
            return `<label class="sn-nir-search"><i class="fa fa-search" aria-hidden="true"></i><input type="search" data-q placeholder="Who owns it? Type a name" value="${esc(st.q)}" autocomplete="off"></label>
                <div class="sn-nir-hits sn-glass-scroll" role="listbox">${hits.map((x) => `<button type="button" role="option" class="sn-nir-hit" data-owner="${esc(x.id)}"><span class="avatar av-28 tone-${(x.tone || 0) % 6}">${esc(initials(x.name))}</span><span><b>${x.id === me ? "You" : esc(x.name)}</b><small>${esc([x.title, x.dept].filter(Boolean).join(" · "))}</small></span></button>`).join("") || '<p class="muted small" style="padding:8px">Nobody matches.</p>'}</div>`;
        }

        function render() {
            const isA = st.kind === "A";
            dlg.innerHTML = `
            <form method="dialog" novalidate>
            <div class="sn-dlg-head">
                <div class="sn-dlg-title"><span class="sn-dlg-icon sn-nir-ic${isA ? " act" : ""}" aria-hidden="true"><i class="fa ${isA ? "fa-check-square-o" : "fa-balance-scale"}"></i></span>
                    <div><h2 id="snNirT">${readOnly ? (isA ? "Action item" : "Decision") : d ? (isA ? "Change the action item" : "Change the decision") : (isA ? "Add an action item" : "Record a decision")}</h2><p>${source}</p></div></div>
                <button type="button" class="sn-close" data-close aria-label="Close"><i class="fa fa-times" aria-hidden="true"></i></button>
            </div>
            <div class="sn-dlg-body sn-nir-body">
                ${ctx.messageId && ctx.text ? `<blockquote class="sn-nir-quote">${esc(String(ctx.text).slice(0, 400))}</blockquote>` : ""}
                ${readOnly ? "" : `<div class="sn-nir-seg" role="radiogroup" aria-label="Type">
                    <button type="button" role="radio" aria-checked="${!isA}" class="${!isA ? "on" : ""}" data-kind="D"><i class="fa fa-balance-scale" aria-hidden="true"></i> Decision</button>
                    <button type="button" role="radio" aria-checked="${isA}" class="${isA ? "on act" : ""}" data-kind="A"><i class="fa fa-check-square-o" aria-hidden="true"></i> Action item</button>
                </div>`}
                <label class="sn-field-label" for="nirTitle">${isA ? "What needs to be done" : "What was decided"}</label>
                ${readOnly ? `<p class="sn-nir-ro">${esc(st.title)}</p>` : `<textarea id="nirTitle" class="sn-textarea" rows="2" maxlength="300" placeholder="${isA ? "E.g. Send the revised quote to Mehta Traders" : "E.g. Release moves to 5 December so QA can finish the payment flow"}">${esc(st.title)}</textarea>`}
                <div class="sn-nir-two">
                    <div><div class="sn-field-label">${isA ? "Who will do it" : "Owner"}</div>${ownerHtml()}</div>
                    ${isA ? `<div><label class="sn-field-label" for="nirDue">Due</label>
                        ${readOnly ? `<p class="sn-nir-ro">${st.due ? esc(dueText(st.due)) : "No date"}</p>` : `<div class="sn-nir-due"><input type="date" id="nirDue" class="sn-input" value="${esc(st.due)}">
                        <div class="sn-nir-chips">${quickDue().map(([l, v]) => `<button type="button" class="sn-nir-chip${st.due === v ? " on" : ""}" data-due="${v}">${l}</button>`).join("")}${st.due ? '<button type="button" class="sn-nir-chip" data-due="">No date</button>' : ""}</div></div>`}</div>` : ""}
                </div>
                <label class="sn-field-label" for="nirDetails">Why, or notes <span class="muted">(optional)</span></label>
                ${readOnly ? `<p class="sn-nir-ro">${st.details ? esc(st.details) : '<span class="muted">No notes</span>'}</p>` : `<textarea id="nirDetails" class="sn-textarea" rows="2" maxlength="1000" placeholder="The reason, or anything people should know later">${esc(st.details)}</textarea>`}
            </div>
            <div class="sn-dlg-foot">
                <span>${d && !readOnly ? `<button type="button" class="cee-btn sn-btn-light sn-md-danger" data-delete><i class="fa fa-trash-o" aria-hidden="true"></i> ${st.armedDelete ? "Yes, delete it" : "Delete"}</button>` : ""}
                    ${d && d.messageId && d.channelId && !location.pathname.startsWith("/chat") ? `<a class="sn-link" href="/chat/${esc(d.channelId)}?m=${d.messageId}">Open in chat</a>` : ""}
                    ${d && d.meetingId ? `<a class="sn-link" href="/meetings/${esc(d.meetingId)}/view${d.meetingDate ? "?date=" + esc(d.meetingDate) : ""}">Open the meeting</a>` : ""}</span>
                <span class="sn-nir-foot-r">
                    <button type="button" class="cee-btn sn-btn-light" data-close>${readOnly ? "Close" : "Cancel"}</button>
                    ${readOnly ? "" : `<button type="button" class="cee-btn cee-btn-gradient" data-save${st.busy ? " disabled" : ""}><i class="fa fa-check" aria-hidden="true"></i> ${d ? "Save" : isA ? "Add action item" : "Save decision"}</button>`}
                </span>
            </div></form>`;
            const qi = dlg.querySelector("[data-q]");
            if (qi && st.picking) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
        }
        const keep = () => {
            const t = dlg.querySelector("#nirTitle"); if (t) st.title = t.value;
            const x = dlg.querySelector("#nirDetails"); if (x) st.details = x.value;
            const due = dlg.querySelector("#nirDue"); if (due) st.due = due.value;
        };
        dlg.onclick = async (e) => {
            const t = e.target;
            if (t.closest("[data-close]")) { dlg.close(); return; }
            if (readOnly) return;
            const k = t.closest("[data-kind]"); if (k) { keep(); st.kind = k.dataset.kind; render(); return; }
            if (t.closest("[data-pick]")) { keep(); st.picking = true; st.q = ""; render(); return; }
            const o = t.closest("[data-owner]"); if (o) { keep(); st.owner = o.dataset.owner; st.picking = false; render(); return; }
            const du = t.closest("[data-due]"); if (du) { keep(); st.due = du.dataset.due; render(); return; }
            if (t.closest("[data-delete]")) {
                if (!st.armedDelete) { keep(); st.armedDelete = true; render(); setTimeout(() => { if (st.armedDelete && dlg.open) { st.armedDelete = false; keep(); render(); } }, 4000); return; }
                const x = await post(`/work/decisions/${d.decisionId}/delete`);
                if (!x.ok) { toast(x.d.error || "Couldn't delete it.", "error", "Decisions"); return; }
                dlg.close();
                toast(d.isAction ? "Action item deleted." : "Decision deleted.", "success");
                removeCard(d.decisionId);
                onDeleted && onDeleted(d.decisionId);
                return;
            }
            if (t.closest("[data-save]")) {
                keep();
                const title = st.title.trim();
                if (!title) { toast(st.kind === "A" ? "Write what needs to be done." : "Write what was decided.", "warn"); dlg.querySelector("#nirTitle")?.focus(); return; }
                st.busy = true; render();
                const x = await post("/work/decisions/save", {
                    decisionId: d ? d.decisionId : 0, kind: st.kind, title, details: st.details.trim() || null,
                    ownerId: st.owner || null, dueDate: st.kind === "A" && st.due ? st.due : null,
                    channelId: d ? null : ctx.channelId || null, messageId: d ? null : ctx.messageId || null,
                    meetingId: d ? null : ctx.meetingId || null, meetingDate: d ? null : ctx.meetingDate || null
                });
                st.busy = false;
                if (!x.ok) { render(); toast(x.d.error || "Not saved. Try again.", "error", "Decisions"); return; }
                dlg.close();
                toast(d ? "Saved." : st.kind === "A" ? "Action item added." : "Decision recorded. It's on the Decisions page too.", "success", d ? null : "⚖ Nirnay");
                if (x.d && x.d.decisionId) { paintCard(x.d); onSaved && onSaved(x.d); }
            }
        };
        dlg.oninput = (e) => {
            if (e.target.matches("[data-q]")) { st.q = e.target.value; keep(); render(); }
        };
        dlg.onchange = (e) => { if (e.target.matches("#nirDue")) { st.due = e.target.value; keep(); render(); } };
        dlg.onkeydown = (e) => {
            if (e.key === "Enter" && e.target.matches("[data-q]")) { e.preventDefault(); dlg.querySelector("[data-owner]")?.click(); }
        };
        render();
        if (!dlg.open) dlg.showModal();
        setTimeout(() => { const t = dlg.querySelector("#nirTitle"); if (t && !d) { t.focus(); t.select(); } }, 60);
    }

    // =================================================================
    // cards under chat messages
    // =================================================================
    const cards = new Map();          // decisionId → decision (on this page)
    let queue = new Set(), timer = 0;
    function queueMessage(id) {
        if (!document.getElementById("messageList")) return;
        queue.add(Number(id));
        clearTimeout(timer);
        timer = setTimeout(async () => {
            const ids = [...queue]; queue = new Set();
            if (!ids.length) return;
            const x = await getJson(`/work/decisions/messages?ids=${ids.join(",")}`).catch(() => ({ ok: false }));
            if (x.ok && Array.isArray(x.d)) x.d.forEach(paintCard);
        }, 200);
    }
    function cardHtml(x) {
        const isA = x.isAction, done = !!x.doneUtc;
        const owner = x.ownerId ? (x.ownerId === me ? "You" : esc(x.ownerName || "")) : "";
        const bits = [owner ? (isA ? owner : "Owner: " + owner) : "", isA && x.dueDate ? `<span class="${overdue(x) ? "late" : ""}">due ${esc(dueText(x.dueDate))}</span>` : "",
            `recorded by ${x.recordedBy === me ? "you" : esc(x.recordedByName || "someone")} · ${day(x.recordedUtc)}`].filter(Boolean).join(" · ");
        return `${isA ? `<label class="sn-nir-tick" title="${done ? "Mark as not done" : "Mark as done"}"><input type="checkbox" data-nir-done="${x.decisionId}"${done ? " checked" : ""}><span></span></label>` : `<span class="sn-nir-cic" aria-hidden="true"><i class="fa fa-balance-scale"></i></span>`}
            <button type="button" class="sn-nir-cmain" data-nir-open="${x.decisionId}" title="${canEdit(x) ? "Change" : "Details"}">
                <b><span class="sn-nir-tag">${isA ? (done ? "Done" : "Action item") : "Decision"}</span>${esc(x.title)}</b>
                <small>${bits}</small>
            </button>`;
    }
    function paintCard(x) {
        if (!x || !x.decisionId) return;
        cards.set(x.decisionId, x);
        if (!x.messageId) return;
        const msg = document.querySelector(`#messageList .msg[data-id="${x.messageId}"] .msg-body`);
        if (!msg) return;
        let wrap = msg.querySelector(".sn-nir-cards");
        if (!wrap) {
            wrap = document.createElement("div");
            wrap.className = "sn-nir-cards";
            const reacts = msg.querySelector(".msg-reacts");
            msg.insertBefore(wrap, reacts || null);
        }
        let card = wrap.querySelector(`[data-dec="${x.decisionId}"]`);
        if (!card) { card = document.createElement("div"); card.dataset.dec = x.decisionId; wrap.appendChild(card); }
        card.className = `sn-nir-card${x.isAction ? " act" : ""}${x.doneUtc ? " done" : ""}${overdue(x) ? " late" : ""}`;
        card.innerHTML = cardHtml(x);
        msg.closest(".msg")?.classList.add("has-decision");
    }
    function removeCard(id) {
        cards.delete(id);
        document.querySelectorAll(`.sn-nir-card[data-dec="${id}"]`).forEach((c) => {
            const wrap = c.parentElement; c.remove();
            if (wrap && !wrap.children.length) { wrap.closest(".msg")?.classList.remove("has-decision"); wrap.remove(); }
        });
    }
    async function setDone(id, done, box) {
        const x = await post(`/work/decisions/${id}/done`, { done });
        if (!x.ok) { if (box) box.checked = !done; toast(x.d.error || "Couldn't change it.", "error"); return null; }
        if (x.d) paintCard(x.d);
        return x.d;
    }
    document.addEventListener("click", (e) => {
        const op = e.target.closest("[data-nir-open]");
        if (op) { e.preventDefault(); const x = cards.get(Number(op.dataset.nirOpen)); if (x) openRecord({ decision: x }); return; }
        const mt = e.target.closest("[data-nirnay-meeting]");
        if (mt) { e.preventDefault(); openMeeting(mt.dataset.nirnayMeeting, mt.dataset.date || null); }
    });
    document.addEventListener("change", (e) => {
        const b = e.target.closest(".sn-nir-card [data-nir-done]");
        if (b) setDone(Number(b.dataset.nirDone), b.checked, b);
    });

    // =================================================================
    // a meeting's decisions and action items
    // =================================================================
    let meetDlg = null;
    async function openMeeting(id, date, ended) {
        const x = await getJson(`/work/decisions/meeting/${encodeURIComponent(id)}${date ? "?date=" + encodeURIComponent(date) : ""}`).catch(() => ({ ok: false, d: {} }));
        if (!x.ok) { if (!ended) toast(x.d?.error || "Couldn't open this meeting's decisions.", "error", "Decisions"); return; }
        const m = x.d;
        if (!meetDlg) {
            meetDlg = document.createElement("dialog");
            meetDlg.className = "sn-dialog glass-strong sn-nir-dlg sn-nir-meet";
            meetDlg.setAttribute("aria-labelledby", "snNirMT");
            document.body.appendChild(meetDlg);
        }
        const ctx = { meetingId: m.meetingId, meetingDate: m.date, meetingTitle: m.title };
        const refresh = async () => {
            const y = await getJson(`/work/decisions/meeting/${encodeURIComponent(m.meetingId)}?date=${m.date}`).catch(() => ({ ok: false }));
            if (y.ok) { m.items = y.d.items; render(); }
        };
        const row = (it) => `<div class="sn-nir-mrow${it.isAction ? " act" : ""}${it.doneUtc ? " done" : ""}${overdue(it) ? " late" : ""}">
                ${it.isAction ? `<label class="sn-nir-tick"><input type="checkbox" data-m-done="${it.decisionId}"${it.doneUtc ? " checked" : ""}><span></span></label>` : '<span class="sn-nir-cic" aria-hidden="true"><i class="fa fa-balance-scale"></i></span>'}
                <button type="button" class="sn-nir-cmain" data-m-open="${it.decisionId}"><b>${esc(it.title)}</b>
                    <small>${[it.ownerName ? (it.ownerId === me ? "You" : esc(it.ownerName)) : "No owner", it.isAction && it.dueDate ? `due ${esc(dueText(it.dueDate))}` : ""].filter(Boolean).join(" · ")}</small></button>
            </div>`;
        function render() {
            const dec = m.items.filter((i) => !i.isAction), act = m.items.filter((i) => i.isAction);
            meetDlg.innerHTML = `
            <form method="dialog" novalidate>
            <div class="sn-dlg-head">
                <div class="sn-dlg-title"><span class="sn-dlg-icon sn-nir-ic" aria-hidden="true"><i class="fa fa-balance-scale"></i></span>
                    <div><h2 id="snNirMT">${ended ? "Meeting ended · what was decided?" : "Decisions and action items"}</h2><p>${esc(m.title)} · ${day(parseYmd(m.date))}</p></div></div>
                <button type="button" class="sn-close" data-close aria-label="Close"><i class="fa fa-times" aria-hidden="true"></i></button>
            </div>
            <div class="sn-dlg-body sn-nir-body">
                <div class="sn-nir-lbl">Decisions <span>${dec.length}</span></div>
                ${dec.map(row).join("") || '<p class="sn-nir-empty">No decisions yet.</p>'}
                <button type="button" class="sn-nir-add" data-add="D"><i class="fa fa-plus" aria-hidden="true"></i> Add a decision</button>
                <div class="sn-nir-lbl">Action items <span>${act.length}</span></div>
                ${act.map(row).join("") || '<p class="sn-nir-empty">No action items yet.</p>'}
                <button type="button" class="sn-nir-add" data-add="A"><i class="fa fa-plus" aria-hidden="true"></i> Add an action item</button>
            </div>
            <div class="sn-dlg-foot">
                <span class="muted small">Everyone invited can see these, and they're on the Decisions page.</span>
                <span class="sn-nir-foot-r">
                    <button type="button" class="cee-btn sn-btn-light" data-close>${ended && !m.items.length ? "Skip" : "Close"}</button>
                    ${m.chatName ? `<button type="button" class="cee-btn cee-btn-gradient" data-post${m.items.length ? "" : " disabled"}><i class="fa fa-paper-plane" aria-hidden="true"></i> Post in ${esc(m.chatName)}</button>` : ""}
                </span>
            </div></form>`;
        }
        meetDlg.onclick = async (e) => {
            const t = e.target;
            if (t.closest("[data-close]")) { meetDlg.close(); return; }
            const add = t.closest("[data-add]");
            if (add) { openRecord(Object.assign({ kind: add.dataset.add }, ctx), refresh, refresh); return; }
            const op = t.closest("[data-m-open]");
            if (op) { const it = m.items.find((i) => i.decisionId === Number(op.dataset.mOpen)); if (it) openRecord({ decision: it }, refresh, refresh); return; }
            const p = t.closest("[data-post]");
            if (p) {
                p.disabled = true;
                const y = await post(`/work/decisions/meeting/${encodeURIComponent(m.meetingId)}/post?date=${m.date}`);
                if (!y.ok) { p.disabled = false; toast(y.d.error || "Couldn't post it.", "error"); return; }
                meetDlg.close();
                toast(`Posted in ${m.chatName}.`, "success", "⚖ Nirnay");
            }
        };
        meetDlg.onchange = async (e) => {
            const b = e.target.closest("[data-m-done]");
            if (b) { await setDone(Number(b.dataset.mDone), b.checked, b); refresh(); }
        };
        render();
        if (!meetDlg.open) meetDlg.showModal();
    }

    // =================================================================
    // live: a decision added, changed or deleted in a chat on screen
    // =================================================================
    function hook() {
        const hub = S().hub;
        if (!hub || hook.done) return;
        hook.done = true;
        hub.on("Decision", (x) => paintCard(x));
        hub.on("DecisionDeleted", (id) => removeCard(Number(id)));
    }

    // after leaving a meeting you organized: ?wrap=<meetingId>
    function wrapUp() {
        const u = new URL(location.href);
        const id = u.searchParams.get("wrap");
        if (!id) return;
        u.searchParams.delete("wrap");
        history.replaceState(history.state, "", u.pathname + (u.search || "") + u.hash);
        if (/^[0-9a-f-]{36}$/i.test(id)) setTimeout(() => openMeeting(id, null, true), 700);
    }

    SN.nirnay = { record: openRecord, queue: queueMessage, paint: paintCard, remove: removeCard, meeting: openMeeting, setDone, people: loadPeople, dueText, overdue, day };
    function init() {
        wrapUp();
        if (S().hub) hook(); else document.addEventListener("sahyog:connected", hook, { once: true });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
