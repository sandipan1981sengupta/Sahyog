// ---------- Nirnay: the decision log ----------
// • "Mark as decision" (⚖) on a chat message → the record window → a card under the message, live for everyone in the chat.
// • A meeting's "Decisions" button (details window), and the organizer lands on it after leaving a meeting (?wrap=<id>).
// • The Decisions page (/work/decisions, js/work-decisions.js) uses the same record window.
// • Who owns it (55_DecisionOwners.sql): you can make yourself or anyone below you the owner; anyone else is ASKED
//   and must Accept. The person asked can Accept or Decline; an owner can hand it back ("Not mine").
// Server: Controllers/DecisionsController.cs · database: 46_Nirnay.sql, 55_DecisionOwners.sql
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
    // The window is Razor (Views/Work/_DecisionDialog.cshtml, tag-helper controls), loaded once from /work/decisions/dialog.
    let dlg = null, cur = null;
    const C = () => window.SN.wk.ctl;
    async function ensureDialog() {
        if (dlg && document.body.contains(dlg)) return dlg;
        dlg = document.getElementById("nirRecordDlg");
        if (!dlg) {
            let html = "";
            try { const r = await fetch("/work/decisions/dialog", { headers: { Accept: "text/html" }, credentials: "same-origin" }); if (r.ok) html = await r.text(); } catch { }
            if (!html) { toast("Couldn't open it. Try again.", "error", "Decisions"); return null; }
            const holder = document.createElement("div");
            holder.innerHTML = html.trim();
            dlg = holder.querySelector("dialog");
            document.body.appendChild(dlg);
        }
        C().init(dlg);
        C().wire(dlg);
        // "Today / Tomorrow / Friday / Next week" next to the due date
        const t = new Date(); t.setHours(0, 0, 0, 0);
        const add = (n) => { const x = new Date(t); x.setDate(x.getDate() + n); return ymd(x); };
        dlg.querySelector("[data-nir-quick]").innerHTML = [["Today", 0], ["Tomorrow", 1], ["Friday", (5 - t.getDay() + 7) % 7 || 7], ["Next week", (8 - t.getDay()) % 7 || 7]]
            .map(([l, n]) => `<button type="button" class="sn-nir-chip" data-due="${add(n)}">${l}</button>`).join("");
        const kindChanged = () => paintKind();
        dlg.addEventListener("change", (e) => { if (e.target.name === "nirKind") kindChanged(); });
        dlg.addEventListener("click", onClick);
        // the owner dropdown (tag-helper control) reports its choice through jQuery on its hidden input
        if (window.jQuery) window.jQuery(dlg).on("change", "#nirOwner_value", () => paintOwnerHint());
        return dlg;
    }
    function paintKind() {
        const isA = C().radio("nirKind") === "A", d = cur.decision;
        dlg.querySelector("[data-nir-due]").hidden = !isA;
        C().label("nirTitle", isA ? "What needs to be done" : "What was decided");
        C().label("nirOwner", isA ? "Who will do it" : "Owner");
        dlg.querySelector("#nirTitle").placeholder = isA ? "E.g. Send the revised quote to Mehta Traders" : "E.g. Release moves to 5 December so QA can finish the payment flow";
        const ic = dlg.querySelector("[data-nir-icon]");
        ic.classList.toggle("act", isA);
        ic.innerHTML = `<i class="fa ${isA ? "fa-check-square-o" : "fa-balance-scale"}" aria-hidden="true"></i>`;
        dlg.querySelector("[data-nir-title]").textContent = cur.readOnly ? (isA ? "Action item" : "Decision")
            : d ? (isA ? "Change the action item" : "Change the decision") : (isA ? "Add an action item" : "Record a decision");
        dlg.querySelector("[data-save] span").textContent = d ? "Save" : isA ? "Add action item" : "Save decision";
    }
    // ---------- who owns it ----------
    const ownerLabel = (d) => !d || !d.ownerId ? "nobody" : d.ownerId === me ? "you" : (d.ownerName || "them");
    // a pending ask (Accept / Decline for the person asked), a "no", and "Not mine" for an owner who didn't record it
    function paintStatus(d) {
        const box = dlg.querySelector("[data-nir-status]");
        let html = "";
        if (d && d.askedOwnerId) {
            const by = d.ownerId === me ? "You" : esc(d.ownerName || "Someone");
            html = d.askedOwnerId === me
                ? `<div class="sn-nir-st ask"><i class="fa fa-hand-paper-o" aria-hidden="true"></i>
                    <span><b>${by} asked you to own this</b><small>Accept and it's yours${d.isAction ? ": it moves to Yours to do" : ""}. Decline and it stays with ${esc(ownerLabel(d))}.</small></span>
                    <span class="sn-nir-st-btns"><button type="button" class="cee-btn cee-btn-gradient" data-nir-accept><i class="fa fa-check" aria-hidden="true"></i> <span>Accept</span></button>
                    <button type="button" class="cee-btn sn-btn-light" data-nir-decline><span>Decline</span></button></span></div>`
                : `<div class="sn-nir-st wait"><i class="fa fa-hourglass-half" aria-hidden="true"></i>
                    <span><b>Waiting for ${esc(d.askedOwnerName || "them")} to accept</b><small>Asked ${esc(day(d.askedUtc))}. Until they accept, it stays with ${esc(ownerLabel(d))}.</small></span></div>`;
        } else if (d && d.declinedBy && d.declinedUtc) {
            html = `<div class="sn-nir-st no"><i class="fa fa-undo" aria-hidden="true"></i>
                <span><b>${d.declinedBy === me ? "You" : esc(d.declinedByName || "Someone")} didn't take it on</b><small>${esc(day(d.declinedUtc))} · it's with ${esc(ownerLabel(d))} now. Pick another owner if it needs one.</small></span></div>`;
        }
        if (d && d.canRelease && !d.askedOwnerId)
            html += `<div class="sn-nir-st mine"><i class="fa fa-user-o" aria-hidden="true"></i>
                <span><b>You own this</b><small>Not yours to do? Hand it back to ${esc(d.recordedByName || "whoever recorded it")}.</small></span>
                <span class="sn-nir-st-btns"><button type="button" class="cee-btn sn-btn-light" data-nir-release><i class="fa fa-reply" aria-hidden="true"></i> <span>Not mine</span></button></span></div>`;
        box.innerHTML = html;
        box.hidden = !html;
    }
    // under the owner: "Rajesh isn't below you on the org chart, so they'll be asked to accept it"
    function paintOwnerHint() {
        const el = dlg && dlg.querySelector("[data-nir-ownhint]");
        if (!el) return;
        const d = cur && cur.decision, id = C().get("nirOwner");
        const p = (people || []).find((x) => x.id === id);
        if (!cur || cur.readOnly || !id || !p || p.assign !== false || (d && (id === d.ownerId || id === d.askedOwnerId))) { el.hidden = true; return; }
        el.innerHTML = `<i class="fa fa-info-circle" aria-hidden="true"></i> <b>${esc(p.name)}</b> isn't below you on the org chart, so they'll be <b>asked</b> to accept it.
            Until they do, it stays with ${d && d.ownerId && d.ownerId !== me ? esc(d.ownerName || "its owner") : "you"}.`;
        el.hidden = false;
    }
    const changed = (detail) => document.dispatchEvent(new CustomEvent("sn:nirnay", { detail }));
    // the person asked answers (also used by the "Waiting for your answer" list on the Decisions page)
    async function answer(d, accept) {
        const x = await post(`/work/decisions/${d.decisionId}/answer`, { accept });
        if (!x.ok) { toast(x.d.error || "Couldn't answer it.", "error", "Decisions"); return null; }
        if (dlg && dlg.open && cur && cur.decision && cur.decision.decisionId === d.decisionId) dlg.close();
        toast(accept ? (d.isAction ? "It's yours now: it's under Yours to do." : "You're its owner now.")
                     : `Declined. It stays with ${d.ownerName || "them"}.`, accept ? "success" : "info", "⚖ Nirnay");
        if (x.d && x.d.gone) { removeCard(d.decisionId); changed({ id: d.decisionId, gone: true }); return x.d; }
        paintCard(x.d); changed(x.d);
        return x.d;
    }
    async function release(d) {
        const x = await post(`/work/decisions/${d.decisionId}/release`);
        if (!x.ok) { toast(x.d.error || "Couldn't hand it back.", "error", "Decisions"); return null; }
        if (dlg && dlg.open) dlg.close();
        toast(`Handed back to ${d.recordedByName || "whoever recorded it"}. They've been told.`, "info", "⚖ Nirnay");
        if (x.d && x.d.gone) { removeCard(d.decisionId); changed({ id: d.decisionId, gone: true }); return x.d; }
        paintCard(x.d); changed(x.d);
        return x.d;
    }

    async function openRecord(ctx, onSaved, onDeleted) {
        ctx = ctx || {};
        if (!(await ensureDialog())) return;
        const d = ctx.decision || null;
        const readOnly = !!(d && !canEdit(d));
        cur = { ctx, decision: d, readOnly, onSaved, onDeleted, armed: false };
        const people = await loadPeople();
        const sub = d
            ? (d.messageId ? `From ${d.channelIsDirect ? "a one-to-one chat" : (d.channelName || "a chat")}` : d.meetingId ? `From the meeting ${d.meetingTitle || ""}` : "Added on the Decisions page")
              + ` · recorded by ${d.recordedBy === me ? "you" : (d.recordedByName || "someone")} · ${day(d.recordedUtc)}`
            : ctx.messageId ? `From ${ctx.senderId === me ? "your" : (ctx.senderName || "a") + "'s"} message${ctx.where ? " in " + ctx.where : ""}`
            : ctx.meetingId ? `For the meeting ${ctx.meetingTitle || ""}${ctx.meetingDate ? " · " + day(parseYmd(ctx.meetingDate)) : ""}`
            : "Everyone in the workspace can see decisions added here.";
        dlg.querySelector("[data-nir-sub]").textContent = sub;
        const q = dlg.querySelector("[data-nir-quote]");
        q.hidden = !(ctx.messageId && ctx.text);
        q.textContent = String(ctx.text || "").slice(0, 400);
        dlg.querySelector("[data-nir-edit]").hidden = readOnly;
        dlg.querySelector("[data-nir-read]").hidden = !readOnly;

        const kind = d ? d.kind : (ctx.kind === "A" ? "A" : "D");
        C().setRadio("nirKind", kind);
        if (readOnly) {
            const r = (k, v) => { dlg.querySelector(`[data-ro="${k}"]`).textContent = v; };
            r("title", d.title);
            r("owner", d.ownerId === me ? "You" : d.ownerName || "Nobody yet");
            r("due", d.dueDate ? dueText(d.dueDate) : "No date");
            r("details", d.details || "No notes");
            dlg.querySelector("[data-ro-due-wrap]").hidden = !d.isAction;
        } else {
            C().set("nirTitle", d ? d.title : String(ctx.text || "").replace(/\s+/g, " ").trim().slice(0, 300));
            C().set("nirDetails", d ? d.details || "" : "");
            const owner = d ? d.ownerId : (people.some((p) => p.id === ctx.senderId) ? ctx.senderId : me);
            C().set("nirOwner", owner || "");
            C().set("nirDue", d ? d.dueDate || "" : "");
        }
        const del = dlg.querySelector("[data-delete]");
        del.hidden = !(d && !readOnly);
        del.querySelector("span").textContent = "Delete";
        const chat = dlg.querySelector("[data-open-chat]");
        chat.hidden = !(d && d.messageId && d.channelId && !location.pathname.startsWith("/chat"));
        if (!chat.hidden) chat.href = `/chat/${d.channelId}?m=${d.messageId}`;
        const mt = dlg.querySelector("[data-open-meeting]");
        mt.hidden = !(d && d.meetingId);
        if (!mt.hidden) mt.href = `/meetings/${d.meetingId}/view${d.meetingDate ? "?date=" + d.meetingDate : ""}`;
        dlg.querySelector("[data-save]").hidden = readOnly;
        dlg.querySelector(".sn-nir-foot-r [data-close] span").textContent = readOnly ? "Close" : "Cancel";
        paintStatus(d);
        paintOwnerHint();
        paintKind();
        C().open(dlg);
        if (!d && !readOnly) setTimeout(() => { const t = dlg.querySelector("#nirTitle"); t.focus(); t.select(); }, 60);
    }
    async function onClick(e) {
        const t = e.target;
        if (cur && cur.decision && t.closest("[data-nir-accept], [data-nir-decline]")) { answer(cur.decision, !!t.closest("[data-nir-accept]")); return; }
        if (cur && cur.decision && t.closest("[data-nir-release]")) { release(cur.decision); return; }
        if (!cur || cur.readOnly) return;
        const du = t.closest("[data-due]");
        if (du) { C().set("nirDue", du.dataset.due); return; }
        const d = cur.decision;
        const del = t.closest("[data-delete]");
        if (del) {
            if (!cur.armed) {
                cur.armed = true; del.querySelector("span").textContent = "Yes, delete it";
                setTimeout(() => { if (cur) { cur.armed = false; del.querySelector("span").textContent = "Delete"; } }, 4000);
                return;
            }
            const x = await post(`/work/decisions/${d.decisionId}/delete`);
            if (!x.ok) { toast(x.d.error || "Couldn't delete it.", "error", "Decisions"); return; }
            dlg.close();
            toast(d.isAction ? "Action item deleted." : "Decision deleted.", "success");
            removeCard(d.decisionId);
            cur.onDeleted && cur.onDeleted(d.decisionId);
            return;
        }
        const save = t.closest("[data-save]");
        if (!save) return;
        const kind = C().radio("nirKind") === "A" ? "A" : "D";
        const title = C().get("nirTitle");
        if (!title) {
            window.validateModernInput?.("#nirTitle");
            toast(kind === "A" ? "Write what needs to be done." : "Write what was decided.", "warn");
            dlg.querySelector("#nirTitle").focus();
            return;
        }
        save.disabled = true;
        const ctx = cur.ctx;
        const x = await post("/work/decisions/save", {
            decisionId: d ? d.decisionId : 0, kind, title, details: C().get("nirDetails") || null,
            ownerId: C().get("nirOwner") || null, dueDate: kind === "A" ? C().get("nirDue") || null : null,
            channelId: d ? null : ctx.channelId || null, messageId: d ? null : ctx.messageId || null,
            meetingId: d ? null : ctx.meetingId || null, meetingDate: d ? null : ctx.meetingDate || null
        });
        save.disabled = false;
        if (!x.ok) { toast(x.d.error || "Not saved. Try again.", "error", "Decisions"); return; }
        dlg.close();
        if (x.d && x.d.askedOwnerId && x.d.askedOwnerId !== (d && d.askedOwnerId))
            toast(`Asked ${x.d.askedOwnerName || "them"} to own it. It stays with you until they accept.`, "info", "⚖ Asked");
        else toast(d ? "Saved." : kind === "A" ? "Action item added." : "Decision recorded. It's on the Decisions page too.", "success", d ? null : "⚖ Nirnay");
        if (x.d && x.d.decisionId) { paintCard(x.d); cur.onSaved && cur.onSaved(x.d); }
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
        const owner = (x.ownerId ? (x.ownerId === me ? "You" : esc(x.ownerName || "")) : "")
            + (x.askedOwnerId ? ` → asked ${x.askedOwnerId === me ? "you" : esc(x.askedOwnerName || "someone")} (waiting)` : "");
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
                    <small>${[it.ownerName ? (it.ownerId === me ? "You" : esc(it.ownerName)) : "No owner", it.askedOwnerId ? `asked ${it.askedOwnerId === me ? "you" : esc(it.askedOwnerName || "someone")} (waiting)` : "", it.isAction && it.dueDate ? `due ${esc(dueText(it.dueDate))}` : ""].filter(Boolean).join(" · ")}</small></button>
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
        // someone asked you to own something; someone answered your ask or handed something back
        hub.on("DecisionAsked", (n) => {
            toast(`${n.by} asked you to own ${n.isAction ? "an action item" : "a decision"}: “${n.title}”. Accept or decline it on Work → Decisions.`, "info", "⚖ Asked of you");
            changed({ reload: true });
        });
        hub.on("DecisionAnswered", (n) => {
            toast(n.handedBack ? `${n.by} handed back “${n.title}”. It's yours again.`
                : n.accepted ? `${n.by} accepted “${n.title}”. It's theirs now.` : `${n.by} declined “${n.title}”. It stays with you.`,
                n.accepted ? "success" : "info", "⚖ Nirnay");
            changed({ reload: true });
        });
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

    SN.nirnay = { record: openRecord, queue: queueMessage, paint: paintCard, remove: removeCard, meeting: openMeeting, setDone, people: loadPeople, dueText, overdue, day, answer, release };
    function init() {
        wrapUp();
        if (S().hub) hook(); else document.addEventListener("sahyog:connected", hook, { once: true });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
