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
        if (!x.ok) { root.innerHTML = `<div class="sn-wk-empty glass"><i class="fa fa-database" aria-hidden="true"></i><b>Approvals aren't ready yet</b><p>${esc(x.d.error || "Try again.")}</p></div>`; return; }
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
    function paint() {
        const d = st.data;
        W.badge("approvals", d.todo);
        const tabs = [["todo", "Waiting for me", d.todo], ["mine", "My requests"], ["done", "Decided by me"]].concat(d.isAdmin ? [["all", "All"]] : []);
        root.innerHTML = `<section class="sn-hist glass sn-ap-list">
            <div class="sn-hist-bar"><div class="sn-hist-tabs" role="tablist">${tabs.map(([k, t, n]) => `<button type="button" role="tab" class="${st.box === k ? "on" : ""}" aria-selected="${st.box === k}" data-box="${k}">${t}${n != null ? ` <span class="sn-hist-n${n ? " red" : ""}">${n}</span>` : ""}</button>`).join("")}</div>
                <div class="sn-hist-tools">${d.isAdmin ? '<button type="button" class="sn-tool" data-ap-rules><i class="fa fa-sliders" aria-hidden="true"></i> Rules</button>' : ""}
                    <button type="button" class="cee-btn cee-btn-gradient sn-nir-new" data-ap-new><i class="fa fa-plus" aria-hidden="true"></i> <span>New request</span></button></div></div>
            <div class="sn-hist-list">${d.items.map(row).join("") || `<div class="sn-wk-empty"><i class="fa fa-check-circle-o" aria-hidden="true"></i><b>${st.box === "todo" ? "Nothing waiting for you" : "No requests here"}</b>
                <p>${st.box === "mine" || st.box === "todo" ? "Ask for leave, an expense or a purchase: it goes to your manager, who approves it right in chat." : ""}</p></div>`}</div>
        </section>`;
        const open = params.get("open");
        if (open) { params.delete("open"); details(+open); }
    }

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

    async function create() {
        let kind = "leave";
        const today = W.ymd(new Date());
        const dlg = W.dialog("sn-ap-new-dlg", `${W.head("fa-check-circle-o", "New request", "It goes up your reporting line. Approvers see it as a card in chat.")}
            <div class="sn-dlg-body sn-nir-body">
                <div class="sn-nir-seg sn-ap-kinds" role="radiogroup">${Object.entries(A.KIND).map(([k, v]) => `<button type="button" role="radio" class="${k === kind ? "on" : ""}" data-kind="${k}"><i class="fa ${v[0]}" aria-hidden="true"></i> ${v[1]}</button>`).join("")}</div>
                <div data-for="leave" class="sn-nir-two"><div><label class="sn-field-label" for="apFrom">First day</label><input type="date" id="apFrom" class="sn-wk-input" value="${today}" min="${today}"></div>
                    <div><label class="sn-field-label" for="apTo">Last day</label><input type="date" id="apTo" class="sn-wk-input" value="${today}" min="${today}"></div></div>
                <div data-for="money" hidden><label class="sn-field-label" for="apAmount">Amount (${esc(cur())})</label><input type="number" id="apAmount" class="sn-wk-input" min="1" step="0.01" inputmode="decimal" placeholder="0"></div>
                <label class="sn-field-label" for="apTitle">What it's for</label>
                <input id="apTitle" class="sn-wk-input" maxlength="150" placeholder="Family function in Mysuru">
                <label class="sn-field-label" for="apDetails">Details <span class="muted">(optional)</span></label>
                <textarea id="apDetails" class="sn-textarea" rows="3" maxlength="1000" placeholder="Anything the approver should know"></textarea>
                <div class="sn-ap-route" id="apRoute">Working out who approves…</div>
            </div>
            <div class="sn-dlg-foot"><span></span><span class="sn-nir-foot-r"><button type="button" class="cee-btn sn-btn-light" data-close>Cancel</button>
                <button type="button" class="cee-btn cee-btn-gradient" data-ap-send><i class="fa fa-paper-plane" aria-hidden="true"></i> Send for approval</button></span></div>`);
        const q = (s) => dlg.querySelector(s);
        const placeholders = { leave: "Family function in Mysuru", expense: "Client visit: cab and lunch", purchase: "Monitor for the design team", other: "Work from home on Fridays in December" };
        let rt = 0;
        const route = () => {
            clearTimeout(rt);
            rt = setTimeout(async () => {
                const y = await W.get(`/work/approvals/route?kind=${kind}&amount=${encodeURIComponent(q("#apAmount").value || "")}`);
                const box = q("#apRoute");
                if (!y.ok) { box.textContent = ""; return; }
                box.innerHTML = y.d.approvers.length
                    ? `<i class="fa fa-level-up" aria-hidden="true"></i> Goes to ${y.d.approvers.map((p, i) => `<b>${esc(p.name)}</b> <small>(${esc(p.why)})</small>${i < y.d.approvers.length - 1 ? ", then " : ""}`).join("")}`
                    : `<i class="fa fa-exclamation-triangle" aria-hidden="true"></i> Nobody to approve it yet: add your manager on the Org page, or ask an admin to set an approver.`;
            }, 250);
        };
        const setKind = (k) => {
            kind = k;
            dlg.querySelectorAll("[data-kind]").forEach((b) => b.classList.toggle("on", b.dataset.kind === k));
            q('[data-for="leave"]').hidden = k !== "leave";
            q('[data-for="money"]').hidden = !(k === "expense" || k === "purchase");
            q("#apTitle").placeholder = placeholders[k];
            route();
        };
        setKind("leave");
        dlg.oninput = (e) => { if (e.target.id === "apAmount") route(); };
        dlg.onchange = (e) => { if (e.target.id === "apFrom" && q("#apTo").value < e.target.value) q("#apTo").value = e.target.value; };
        dlg.onclick = async (e) => {
            const k = e.target.closest("[data-kind]"); if (k) { setKind(k.dataset.kind); return; }
            const b = e.target.closest("[data-ap-send]");
            if (!b) return;
            b.disabled = true;
            const y = await W.post("/work/approvals/create", {
                kind, title: q("#apTitle").value, details: q("#apDetails").value,
                amount: q("#apAmount").value ? Number(q("#apAmount").value) : null,
                from: kind === "leave" ? q("#apFrom").value : null, to: kind === "leave" ? q("#apTo").value : null
            });
            b.disabled = false;
            if (!y.ok) { W.toast(y.d.error || "Not sent.", "error", "Approvals"); return; }
            dlg.close();
            W.toast(`Sent to ${y.d.to}${y.d.steps > 1 ? ", then the next approver" : ""}. You'll get a notice when it's decided.`, "success", "✔ Approvals");
            st.box = "mine"; load();
        };
    }

    async function rules() {
        const r = st.data.rules || {};
        const people = await SN.nirnay.people();
        const dlg = W.dialog("sn-ap-rules-dlg", `${W.head("fa-sliders", "Approval rules", "For the whole workspace")}
            <div class="sn-dlg-body sn-nir-body">
                <div class="sn-nir-two"><div><label class="sn-field-label" for="arAmt">Second approver from</label><input type="number" id="arAmt" class="sn-wk-input" min="1" value="${esc(r.secondLevelAmount ?? 50000)}"></div>
                    <div><label class="sn-field-label" for="arCur">Currency sign</label><input id="arCur" class="sn-wk-input" maxlength="8" value="${esc(r.currency || "₹")}"></div></div>
                <small class="muted">Expenses and purchases of this amount or more also go to the manager's manager.</small>
                <div class="sn-field-label">For people with no manager</div><div id="arFb"></div>
                <small class="muted">Nobody picked: it goes to an admin.</small>
            </div>
            <div class="sn-dlg-foot"><span></span><span class="sn-nir-foot-r"><button type="button" class="cee-btn sn-btn-light" data-close>Cancel</button>
                <button type="button" class="cee-btn cee-btn-gradient" data-ar-save><i class="fa fa-check" aria-hidden="true"></i> Save</button></span></div>`);
        const fb = W.personPicker(dlg.querySelector("#arFb"), people, r.fallbackApprover || null, null, "Pick an approver");
        dlg.onclick = async (e) => {
            if (!e.target.closest("[data-ar-save]")) return;
            const y = await W.post("/work/approvals/rules", { secondLevelAmount: Number(dlg.querySelector("#arAmt").value) || null, currency: dlg.querySelector("#arCur").value, fallbackApprover: fb.value });
            if (!y.ok) { W.toast(y.d.error || "Not saved.", "error"); return; }
            dlg.close(); load();
        };
    }

    root.addEventListener("click", async (e) => {
        const t = e.target;
        const bx = t.closest("[data-box]"); if (bx) { st.box = bx.dataset.box; load(); return; }
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
    load();
})();
