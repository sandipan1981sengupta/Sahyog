// ShankhNaad · Work → Approvals: Waiting for me / My requests / Decided by me / All (admins), a new request, the details window.
// The card in chat and Approve / Reject live in js/work-live.js (SN.approvals). Server: Controllers/ApprovalsController.cs
(function () {
    "use strict";
    const root = document.getElementById("apApp");
    const W = window.SN && SN.wk, A = window.SN && SN.approvals;
    if (!root || !W || !A) return;
    const esc = W.esc;
    let cfg = {};
    try { cfg = JSON.parse(document.getElementById("wkData")?.textContent || "{}"); } catch { }
    const params = new URLSearchParams(location.search);
    const st = { box: params.get("box") || "todo", data: null };

    async function load() {
        const x = await W.get(`/work/approvals/data?box=${st.box}`);
        if (!x.ok) { document.getElementById("apList").innerHTML = `<div class="sn-wk-empty"><i class="fa fa-database" aria-hidden="true"></i><b>Approvals aren't ready yet</b><p>${esc(x.d.error || "Try again.")}</p></div>`; return; }
        st.data = x.d; st.box = x.d.box;
        paint();
    }
    const cur = () => st.data?.rules?.currency || "₹";

    function row(a) {
        const k = A.KIND[a.kind] || A.KIND.other;
        const facts = [a.kind === "leave" ? `${A.range(a)} · ${A.days(a)} day${A.days(a) === 1 ? "" : "s"}` : "", a.amount != null ? A.money(a.amount, cur()) : ""].filter(Boolean).join(" · ");
        const who = st.box === "mine" ? (a.status === "pending" ? `with ${esc(a.currentApproverName || "")}` : "") : `from ${a.requesterId === cfg.me ? "you" : esc(a.requesterName)}`;
        return `<div class="sn-hrow sn-ap-row" data-open="${a.approvalId}">
            <span class="sn-ap-ic k-${esc(a.kind)}" aria-hidden="true"><i class="fa ${k[0]}"></i></span>
            <button type="button" class="sn-hmain sn-nir-open-row" data-open="${a.approvalId}"><b class="ellipsis">${esc(a.title)}</b><small class="sn-hstat">${k[1]}${facts ? " · " + esc(facts) : ""}${who ? " · " + who : ""}</small></button>
            <span class="sn-ap-badge st-${esc(a.status)}">${A.STATUS[a.status] || esc(a.status)}${a.status === "pending" && a.steps > 1 ? ` · step ${a.step} of ${a.steps}` : ""}</span>
            <time class="sn-htime">${esc(W.ago(a.createdUtc))}</time>
            ${st.box === "todo" ? `<div class="sn-hact sn-ap-quick"><button type="button" class="cee-btn sn-ap-yes sn-btn-sm" data-quick="approved" data-id="${a.approvalId}"><i class="fa fa-check" aria-hidden="true"></i> Approve</button></div>` : ""}
        </div>`;
    }
    const listEl = document.getElementById("apList");
    function paint() {
        const d = st.data;
        W.badge("approvals", d.todo);
        W.tabBadge("apTabs", "todo", d.todo, true, d.todo ? "bad" : "");
        listEl.innerHTML = d.items.map(row).join("") || `<div class="sn-wk-empty"><i class="fa fa-check-circle-o" aria-hidden="true"></i><b>${st.box === "todo" ? "Nothing waiting for you" : "No requests here"}</b>
            <p>${st.box === "mine" || st.box === "todo" ? "Ask for leave, an expense or a purchase: it goes to your manager, who approves it right in chat." : ""}</p></div>`;
        const open = params.get("open");
        if (open) { params.delete("open"); details(+open); }
    }
    W.onTab("apTabs", (id) => { st.box = id || "todo"; load(); });

    async function details(id) {
        const x = await W.get(`/work/approvals/${id}`);
        if (!x.ok) { W.toast(x.d.error || "Couldn't open it.", "warn", "Approvals"); return; }
        const c = x.d, a = c.approval;
        const dlg = W.dialog("sn-ap-dlg", `${W.head((A.KIND[a.kind] || A.KIND.other)[0], a.title, `${(A.KIND[a.kind] || A.KIND.other)[1]} request from ${a.requesterId === cfg.me ? "you" : esc(a.requesterName)} · ${esc(W.day(a.createdUtc))}`)}
            <div class="sn-dlg-body sn-nir-body"><div class="msg-approval sn-ap-in-dlg" data-approval="${a.approvalId}">${A.html(c)}</div>
                <div class="sn-nir-lbl">Steps</div>
                ${c.steps.map((s) => `<div class="sn-nir-mrow"><span class="sn-ap-stepic ${s.decision || (a.status === "pending" && s.step === a.step ? "now" : "")}"><i class="fa ${s.decision === "approved" ? "fa-check" : s.decision === "rejected" ? "fa-times" : "fa-hourglass-half"}"></i></span>
                    <span class="sn-nir-cmain"><b>${esc(s.approverName)}${s.approverTitle ? ` <small class="muted">· ${esc(s.approverTitle)}</small>` : ""}</b>
                    <small>${s.decision ? `${s.decision === "approved" ? "Approved" : "Rejected"} ${esc(W.day(s.decidedUtc))}, ${esc(W.time(s.decidedUtc))}${s.note ? ` · “${esc(s.note)}”` : ""}` : a.status === "pending" && s.step === a.step ? "Deciding now" : a.status === "pending" ? "Next" : "Not needed"}</small></span></div>`).join("")}
            </div>
            <div class="sn-dlg-foot"><span>${c.canCancel ? '<button type="button" class="cee-btn sn-btn-light sn-md-danger" data-ap-cancel>Withdraw request</button>' : ""}</span>
                <span class="sn-nir-foot-r">${c.steps[0]?.channelId ? `<a class="cee-btn sn-btn-light" href="/chat/${esc(c.steps.find((s) => s.step === a.step)?.channelId || c.steps[0].channelId)}"><i class="fa fa-comment" aria-hidden="true"></i> Open chat</a>` : ""}
                <button type="button" class="cee-btn sn-btn-light" data-close>Close</button></span></div>`);
        dlg.onclick = async (e) => {
            const cn = e.target.closest("[data-ap-cancel]");
            if (cn) {
                if (!cn.dataset.armed) { cn.dataset.armed = "1"; cn.textContent = "Yes, withdraw it"; return; }
                const y = await W.post(`/work/approvals/${id}/cancel`);
                if (!y.ok) { W.toast(y.d.error || "Couldn't withdraw it.", "error"); return; }
                dlg.close(); W.toast("Request withdrawn.", "success", "Approvals"); load();
            }
        };
    }

    // ---------- the two windows (Views/Work/Approvals.cshtml, tag-helper controls) ----------
    const C = W.ctl;
    const newDlg = document.getElementById("apNewDlg"), rulesDlg = document.getElementById("apRulesDlg");
    [newDlg, rulesDlg].forEach((d) => d && C.wire(d));
    const num = (v) => { const n = Number(String(v || "").replace(/[^\d.]/g, "")); return isFinite(n) && n > 0 ? n : null; };
    const placeholders = { leave: "Family function in Mysuru", expense: "Client visit: cab and lunch", purchase: "Monitor for the design team", other: "Work from home on Fridays in December" };
    let rt = 0;
    function route() {
        clearTimeout(rt);
        rt = setTimeout(async () => {
            const kind = C.radio("apKind") || "leave";
            const y = await W.get(`/work/approvals/route?kind=${kind}&amount=${encodeURIComponent(num(C.get("apAmount")) || "")}`);
            const box = newDlg.querySelector("[data-ap-route]");
            if (!y.ok) { box.textContent = ""; return; }
            box.innerHTML = y.d.approvers.length
                ? `<i class="fa fa-level-up" aria-hidden="true"></i> Goes to ${y.d.approvers.map((p, i) => `<b>${esc(p.name)}</b> <small>(${esc(p.why)})</small>${i < y.d.approvers.length - 1 ? ", then " : ""}`).join("")}`
                : `<i class="fa fa-exclamation-triangle" aria-hidden="true"></i> Nobody to approve it yet: add your manager on the Org page, or ask an admin to set an approver.`;
        }, 250);
    }
    function paintKind() {
        const k = C.radio("apKind") || "leave";
        newDlg.querySelector('[data-ap-for="leave"]').hidden = k !== "leave";
        newDlg.querySelector('[data-ap-for="money"]').hidden = !(k === "expense" || k === "purchase");
        C.label("apAmount", `Amount (${cur()})`);
        newDlg.querySelector("#apTitle").placeholder = placeholders[k];
        route();
    }
    function create() {
        const today = W.ymd(new Date());
        C.setRadio("apKind", "leave");
        C.set("apFrom", today); C.set("apTo", today);
        ["apAmount", "apTitle", "apDetails"].forEach((id) => C.set(id, ""));
        paintKind();
        C.open(newDlg);
    }
    newDlg?.addEventListener("change", (e) => {
        if (e.target.name === "apKind") { paintKind(); return; }
        // the last day can't be before the first
        if (e.target.id === "apFrom" && C.get("apTo") < C.get("apFrom")) C.set("apTo", C.get("apFrom"));
    });
    newDlg?.addEventListener("input", (e) => { if (e.target.id === "apAmount") route(); });
    newDlg?.querySelector("[data-ap-send]").addEventListener("click", async (e) => {
        const b = e.currentTarget, kind = C.radio("apKind") || "leave";
        const title = C.get("apTitle");
        if (!title && kind !== "leave") { window.validateModernInput?.("#apTitle"); W.toast("Write what it's for.", "warn", "Approvals"); return; }
        if ((kind === "expense" || kind === "purchase") && !num(C.get("apAmount"))) { window.validateModernInput?.("#apAmount"); W.toast("Write the amount.", "warn", "Approvals"); return; }
        b.disabled = true;
        const y = await W.post("/work/approvals/create", {
            kind, title, details: C.get("apDetails"), amount: num(C.get("apAmount")),
            from: kind === "leave" ? C.get("apFrom") : null, to: kind === "leave" ? C.get("apTo") : null
        });
        b.disabled = false;
        if (!y.ok) { W.toast(y.d.error || "Not sent.", "error", "Approvals"); return; }
        newDlg.close();
        W.toast(`Sent to ${y.d.to}${y.d.steps > 1 ? ", then the next approver" : ""}. You'll get a notice when it's decided.`, "success", "✔ Approvals");
        W.pickTab("apTabs", "mine");
    });

    function rules() {
        const r = st.data.rules || {};
        C.set("arAmt", String(r.secondLevelAmount ?? 50000));
        C.set("arCur", r.currency || "₹");
        C.set("arFb", r.fallbackApprover || "");
        C.open(rulesDlg);
    }
    rulesDlg?.querySelector("[data-ar-save]").addEventListener("click", async () => {
        const y = await W.post("/work/approvals/rules", { secondLevelAmount: num(C.get("arAmt")), currency: C.get("arCur"), fallbackApprover: C.get("arFb") || null });
        if (!y.ok) { W.toast(y.d.error || "Not saved.", "error"); return; }
        rulesDlg.close(); load();
    });

    root.addEventListener("click", async (e) => {
        const t = e.target;
        if (t.closest("[data-ap-new]")) { create(); return; }
        if (t.closest("[data-ap-rules]")) { rules(); return; }
        const qk = t.closest("[data-quick]");
        if (qk) { e.stopPropagation(); if (await A.decide(+qk.dataset.id, "approved", null, qk)) load(); return; }
        const op = t.closest("[data-open]"); if (op) details(+op.dataset.open);
    });
    const changed = () => { if (!document.body.contains(root)) { document.removeEventListener("sn:approval-changed", changed); return; } load(); };
    document.addEventListener("sn:approval-changed", changed);
    // decided here (the card's Approve / Reject): refresh the list
    const decided = () => { if (!document.body.contains(root)) { document.removeEventListener("sn:approval", decided); return; } load(); };
    document.addEventListener("sn:approval", decided);
    if (params.get("new")) create();
    if (st.box !== "todo") W.pickTab("apTabs", st.box);
    load();
})();
