// ShankhNaad · live Work events on every page (app bundle):
//  • Stand-up time (and a reminder when the app opens), a teammate's blocker
//  • Message a role: a request for you, an escalation
//  • Visitor lobby: the host's card ("I'm coming" / "Ask them to wait")
//  • Approvals: the card in chat ([[approval:ID]]) with Approve / Reject, and notices
// Server: StandupController, RolesController, VisitorsController, ApprovalsController, Infrastructure/WorkJobs.cs
(function () {
    "use strict";
    const me = document.body && document.body.dataset.me;
    const SN = (window.SN = window.SN || {});
    if (!me || !SN.wk) return;
    const W = SN.wk, esc = W.esc;
    const S = () => window.Sahyog || {};
    const go = (url) => (SN.go ? SN.go(url) : (location.href = url));
    const onPage = (path) => location.pathname.toLowerCase().startsWith(path);

    // =================================================================
    // stand-up
    // =================================================================
    function standupDue(id, name) {
        if (onPage("/work/standup")) { document.dispatchEvent(new CustomEvent("sn:standup-due", { detail: { id } })); }
        W.toast(`Time for “${name}”. Three quick answers.`, "info", "☀ Stand-up", { ms: 15000, action: { text: "Answer now", onClick: () => go(`/work/standup?answer=${id}`) } });
    }
    async function checkDue() {
        const key = "sn-su-told-" + new Date().toDateString();
        let told = [];
        try { told = JSON.parse(localStorage.getItem(key) || "[]"); } catch { }
        const x = await W.get("/work/standup/due");
        if (!x.ok || !Array.isArray(x.d)) return;
        x.d.filter((s) => !told.includes(s.standupId)).slice(0, 2).forEach((s) => { told.push(s.standupId); standupDue(s.standupId, s.name); });
        try { localStorage.setItem(key, JSON.stringify(told)); } catch { }
    }

    // =================================================================
    // visitor at reception: the host's card
    // =================================================================
    function visitorCard(v) {
        if (!v || !v.visitorId) return;
        document.querySelector(`.sn-vis-card[data-id="${v.visitorId}"]`)?.remove();
        const el = document.createElement("div");
        el.className = "sn-vis-card glass-strong";
        el.dataset.id = v.visitorId;
        el.setAttribute("role", "alertdialog");
        el.innerHTML = `<span class="sn-vis-ic" aria-hidden="true"><i class="fa fa-id-card-o"></i></span>
            <div class="sn-vis-main"><small>Visitor at reception</small><b>${esc(v.name)}${v.company ? ` · ${esc(v.company)}` : ""}</b>
                ${v.purpose ? `<span>${esc(v.purpose)}</span>` : ""}</div>
            <div class="sn-vis-acts"><button type="button" class="cee-btn cee-btn-gradient" data-vis="coming"><i class="fa fa-check" aria-hidden="true"></i> I'm coming</button>
                <button type="button" class="cee-btn sn-btn-light" data-vis="wait">Ask them to wait</button></div>
            <button type="button" class="sn-vis-x" data-vis="x" aria-label="Close"><i class="fa fa-times" aria-hidden="true"></i></button>`;
        document.body.appendChild(el);
        S().ding?.();
        el.addEventListener("click", async (e) => {
            const b = e.target.closest("[data-vis]");
            if (!b) return;
            if (b.dataset.vis === "x") { el.remove(); return; }
            b.disabled = true;
            const x = await W.post(`/work/visitors/${v.visitorId}/${b.dataset.vis}`);
            if (!x.ok) { b.disabled = false; W.toast(x.d.error || "Didn't work. Try again.", "error"); return; }
            el.remove();
            W.toast(b.dataset.vis === "coming" ? `Reception will tell ${v.name} you're on your way.` : `Reception will ask ${v.name} to take a seat.`, "success", "Visitor");
        });
        if ("Notification" in window && Notification.permission === "granted" && (document.hidden || !document.hasFocus()))
            try { new Notification("Visitor at reception", { body: `${v.name}${v.company ? " · " + v.company : ""}`, tag: "visitor-" + v.visitorId }); } catch { }
    }

    // =================================================================
    // approvals: the card in a chat
    // =================================================================
    const KIND = { leave: ["fa-plane", "Leave"], expense: ["fa-inr", "Expense"], purchase: ["fa-shopping-cart", "Purchase"], other: ["fa-file-text-o", "Request"] };
    const STATUS = { pending: "Waiting", approved: "Approved", rejected: "Rejected", cancelled: "Withdrawn" };
    const money = (a, cur) => a == null ? "" : (cur || "₹") + Number(a).toLocaleString("en-IN", { maximumFractionDigits: 2 });
    const range = (a) => a.fromDate ? (a.toDate && a.toDate !== a.fromDate ? `${W.day(a.fromDate)} – ${W.day(a.toDate)}` : W.day(a.fromDate)) : "";
    function days(a) {
        const f = W.parseYmd(a.fromDate), t = W.parseYmd(a.toDate || a.fromDate);
        return f && t ? Math.round((t - f) / 86400000) + 1 : 0;
    }
    function approvalHtml(x) {
        const a = x.approval;
        if (!a || a.hidden) return `<div class="sn-ap-card hidden"><i class="fa fa-lock" aria-hidden="true"></i> An approval request (not shared with you)</div>`;
        const k = KIND[a.kind] || KIND.other;
        const facts = [a.kind === "leave" ? `${range(a)} · ${days(a)} day${days(a) === 1 ? "" : "s"}` : "", a.amount != null ? money(a.amount) : ""].filter(Boolean).join(" · ");
        const steps = (x.steps || []).map((s) => {
            const st = s.decision === "approved" ? "ok" : s.decision === "rejected" ? "no" : (a.status === "pending" && s.step === a.step ? "now" : "later");
            return `<span class="sn-ap-step ${st}" title="${esc(s.approverName)}${s.note ? ": " + esc(s.note) : ""}"><i class="fa ${st === "ok" ? "fa-check" : st === "no" ? "fa-times" : st === "now" ? "fa-hourglass-half" : "fa-circle-o"}" aria-hidden="true"></i> ${esc((s.approverName || "").split(" ")[0])}</span>`;
        }).join('<i class="fa fa-angle-right sn-ap-arrow" aria-hidden="true"></i>');
        const note = (x.steps || []).filter((s) => s.note).map((s) => `<q>${esc(s.note)}</q> <small>— ${esc((s.approverName || "").split(" ")[0])}</small>`).join("<br>");
        return `<div class="sn-ap-card st-${esc(a.status)}" data-ap="${a.approvalId}">
            <div class="sn-ap-top"><span class="sn-ap-ic k-${esc(a.kind)}" aria-hidden="true"><i class="fa ${k[0]}"></i></span>
                <div class="sn-ap-t"><small>${k[1]} request · ${a.requesterId === me ? "you" : esc(a.requesterName)}</small><b>${esc(a.title)}</b>${facts ? `<span>${esc(facts)}</span>` : ""}</div>
                <span class="sn-ap-badge st-${esc(a.status)}">${STATUS[a.status] || esc(a.status)}</span></div>
            ${a.details ? `<p class="sn-ap-details">${esc(a.details)}</p>` : ""}
            <div class="sn-ap-steps">${steps}</div>
            ${note ? `<p class="sn-ap-note">${note}</p>` : ""}
            ${x.canDecide ? `<div class="sn-ap-acts" data-ap-acts>
                <button type="button" class="cee-btn sn-ap-yes" data-ap-do="approved"><i class="fa fa-check" aria-hidden="true"></i> Approve</button>
                <button type="button" class="cee-btn sn-btn-light sn-ap-no" data-ap-do="rejected"><i class="fa fa-times" aria-hidden="true"></i> Reject</button>
                <a class="sn-link" href="/work/approvals?open=${a.approvalId}">Details</a></div>` : `<div class="sn-ap-acts"><a class="sn-link" href="/work/approvals?open=${a.approvalId}">Details</a></div>`}
        </div>`;
    }
    let apQueue = new Set(), apTimer = 0;
    function queueApproval(id) {
        apQueue.add(Number(id));
        clearTimeout(apTimer);
        apTimer = setTimeout(async () => {
            const ids = [...apQueue]; apQueue = new Set();
            const x = await W.get(`/work/approvals/cards?ids=${ids.join(",")}`);
            if (!x.ok || !Array.isArray(x.d)) {
                ids.forEach((id) => document.querySelectorAll(`.msg-approval[data-approval="${id}"]`).forEach((b) => { b.innerHTML = `<div class="sn-ap-card hidden">${esc(x.d?.error || "Approval request")}</div>`; }));
                return;
            }
            x.d.forEach((c) => paintApproval(c));
        }, 120);
    }
    function paintApproval(c) {
        const id = c.approval?.approvalId;
        if (!id) return;
        document.querySelectorAll(`.msg-approval[data-approval="${id}"]`).forEach((b) => { b.innerHTML = approvalHtml(c); });
        document.dispatchEvent(new CustomEvent("sn:approval", { detail: c }));
    }
    async function decide(id, decision, note, btn) {
        if (btn) btn.disabled = true;
        const x = await W.post(`/work/approvals/${id}/decide`, { decision, note: note || null });
        if (!x.ok) { if (btn) btn.disabled = false; W.toast(x.d.error || "Didn't work. Try again.", "error", "Approvals"); return null; }
        paintApproval(x.d);
        W.toast(decision === "approved" ? "Approved." : "Rejected.", "success", "Approvals");
        return x.d;
    }
    document.addEventListener("click", (e) => {
        const b = e.target.closest(".msg-approval [data-ap-do]");
        if (!b) return;
        e.preventDefault();
        const card = b.closest("[data-ap]"), id = Number(card.dataset.ap), acts = card.querySelector("[data-ap-acts]");
        if (b.dataset.apDo === "approved") { decide(id, "approved", null, b); return; }
        // reject: a short reason first (optional)
        acts.innerHTML = `<input type="text" class="sn-ap-why" maxlength="300" placeholder="Why? (optional, they see it)" aria-label="Reason">
            <button type="button" class="cee-btn sn-ap-no2" data-ap-reject><i class="fa fa-times" aria-hidden="true"></i> Reject</button>
            <button type="button" class="sn-link" data-ap-back>Back</button>`;
        acts.querySelector("input").focus();
        acts.onclick = (ev) => {
            if (ev.target.closest("[data-ap-back]")) { queueApproval(id); return; }
            const r = ev.target.closest("[data-ap-reject]");
            if (r) decide(id, "rejected", acts.querySelector("input").value.trim(), r);
        };
        acts.onkeydown = (ev) => { if (ev.key === "Enter") acts.querySelector("[data-ap-reject]").click(); };
    });

    // =================================================================
    // live
    // =================================================================
    function hook() {
        const hub = S().hub;
        if (!hub || hook.done) return;
        hook.done = true;
        hub.on("StandupDue", standupDue);
        hub.on("StandupBlocker", (who, name, text, id) =>
            W.toast(`${who} is blocked: “${String(text || "").slice(0, 120)}”`, "warn", `☀ ${name}`, { ms: 20000, action: { text: "See stand-up", onClick: () => go(`/work/standup?roll=${id}`) } }));
        hub.on("RoleRequest", (role, from, url, escalated) => {
            S().ding?.();
            W.toast(escalated ? `${from}'s message to ${role} wasn't answered in time, so it's with you now.` : `${from} needs ${role}. You're up.`,
                escalated ? "warn" : "info", escalated ? "⏫ Escalated to you" : `📨 ${role}`, { ms: 20000, action: { text: "Open chat", onClick: () => go(url) } });
        });
        hub.on("RoleEscalated", (role, who, url) =>
            W.toast(`${who} hasn't replied yet, so your message to ${role} went to the next person.`, "info", "⏫ " + role, { action: { text: "Open", onClick: () => go(url) } }));
        hub.on("Visitor", visitorCard);
        // for the Work pages (they come and go with page changes; the hub handlers stay registered once)
        hub.on("StandupAnswered", (id, day) => document.dispatchEvent(new CustomEvent("sn:standup-answered", { detail: { id, day } })));
        hub.on("VisitorChanged", (v) => document.dispatchEvent(new CustomEvent("sn:visitor-changed", { detail: v })));
        hub.on("Approval", (id, status, by, byId) => {
            queueApproval(id);
            if (byId === me) return;
            if (status === "todo") W.toast(`${by} sent you a request to approve.`, "info", "✔ Approvals", { ms: 15000, action: { text: "Open", onClick: () => go(`/work/approvals?open=${id}`) } });
            else if (status === "approved" || status === "rejected") W.toast(`${by} ${status} a request.`, status === "approved" ? "success" : "warn", "✔ Approvals", { action: { text: "Open", onClick: () => go(`/work/approvals?open=${id}`) } });
            document.dispatchEvent(new CustomEvent("sn:approval-changed", { detail: { id, status } }));
        });
    }

    SN.approvals = { queue: queueApproval, html: approvalHtml, decide, KIND, STATUS, money, range, days };
    function init() {
        if (S().hub) hook(); else document.addEventListener("sahyog:connected", hook, { once: true });
        setTimeout(checkDue, 4000);
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
