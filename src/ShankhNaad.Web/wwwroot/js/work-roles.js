// ShankhNaad · Work → Roles: message a team or a job ("IT help desk") instead of a person.
// Cards for each role (who's in it, who's online) with "Message"; requests you sent or got, with their state.
// Admins add and change roles. Server: Controllers/RolesController.cs · escalation: Infrastructure/WorkJobs.cs
(function () {
    "use strict";
    const root = document.getElementById("roApp");
    const W = window.SN && SN.wk;
    if (!root || !W) return;
    const esc = W.esc;
    let cfg = {};
    try { cfg = JSON.parse(document.getElementById("wkData")?.textContent || "{}"); } catch { }
    const ICONS = ["life-ring", "laptop", "users", "inr", "shield", "truck", "wrench", "medkit", "bullhorn", "id-badge", "building", "graduation-cap", "balance-scale", "phone"];
    const st = { data: null, tab: "open" };

    async function load() {
        const x = await W.get("/work/roles/data");
        if (!x.ok) { root.innerHTML = `<div class="sn-wk-empty glass"><i class="fa fa-database" aria-hidden="true"></i><b>Roles aren't ready yet</b><p>${esc(x.d.error || "Try again.")}</p></div>`; return; }
        st.data = x.d;
        paint();
    }
    const state = (q) => q.closedUtc ? ["closed", "Closed"] : q.answeredUtc ? ["ok", "Answered"] : q.escalatedUtc ? ["esc", "Escalated"] : ["wait", "Waiting"];

    function paint() {
        const d = st.data;
        const open = d.requests.filter((q) => !q.closedUtc && !q.answeredUtc);
        W.badge("roles", open.filter((q) => !q.sent).length);
        const list = st.tab === "open" ? open : st.tab === "sent" ? d.requests.filter((q) => q.sent) : d.requests;
        root.innerHTML = `
        <section class="sn-hist glass sn-ro-roles" aria-label="Roles">
            <div class="sn-wk-colhead"><h2>Ask a role</h2><span class="sn-wk-tools">${d.isAdmin ? '<button type="button" class="cee-btn cee-btn-gradient sn-nir-new" data-ro-new><i class="fa fa-plus" aria-hidden="true"></i> <span>New role</span></button>' : ""}</span></div>
            <div class="sn-ro-grid">${d.roles.map((r) => {
                const on = r.members.filter((m) => m.online && !m.away).length;
                return `<article class="sn-ro-card">
                    <header><span class="sn-ro-ic"><i class="fa fa-${esc(r.icon || "life-ring")}" aria-hidden="true"></i></span>
                        <div><b>${esc(r.name)}</b><small>${esc(r.description || "")}</small></div>
                        ${d.isAdmin ? `<button type="button" class="sn-ro-edit" data-ro-edit="${r.roleId}" title="Change" aria-label="Change ${esc(r.name)}"><i class="fa fa-pencil"></i></button>` : ""}</header>
                    <div class="sn-ro-people">${r.members.slice(0, 6).map((m) => `<span class="sn-ro-p${m.online && !m.away ? " on" : ""}${m.away ? " away" : ""}" title="${esc(m.displayName)}${m.away ? " · out of office" : m.online ? " · online" : ""}">${W.avatar(m.displayName, m.avatarTone, m.userId)}</span>`).join("")}
                        <small>${on ? `${on} online` : r.members.length ? "Nobody online now" : "Nobody in it yet"}${r.escalateMin ? ` · moves on after ${r.escalateMin} min` : ""}</small></div>
                    <button type="button" class="cee-btn cee-btn-gradient sn-ro-ask" data-ro-ask="${r.roleId}"${r.members.some((m) => m.userId !== cfg.me) ? "" : " disabled"}><i class="fa fa-paper-plane" aria-hidden="true"></i> Message ${esc(r.name)}</button>
                </article>`;
            }).join("") || `<div class="sn-wk-empty"><i class="fa fa-life-ring" aria-hidden="true"></i><b>No roles yet</b><p>${d.isAdmin ? "Add roles like “IT help desk”, “Accounts” or “Head of HR”, and who answers for each." : "Your admin can add roles like “IT help desk” or “Accounts”."}</p></div>`}</div>
        </section>
        <section class="sn-hist glass sn-ro-reqs" aria-label="Requests">
            <div class="sn-hist-bar"><div class="sn-hist-tabs" role="tablist">
                ${[["open", "Waiting", open.length], ["sent", "Sent by me", d.requests.filter((q) => q.sent).length], ["all", "All", d.requests.length]].map(([k, t, n]) => `<button type="button" role="tab" class="${st.tab === k ? "on" : ""}" aria-selected="${st.tab === k}" data-ro-tab="${k}">${t} <span class="sn-hist-n">${n}</span></button>`).join("")}
            </div></div>
            <div class="sn-hist-list">${list.map((q) => {
                const [cls, txt] = state(q);
                const who = q.escalatedName ? `${esc(q.assignedName)} → ${esc(q.escalatedName)}` : esc(q.assignedName);
                return `<div class="sn-hrow sn-ro-row">
                    <span class="sn-ro-ic sm"><i class="fa fa-${esc(q.icon || "life-ring")}" aria-hidden="true"></i></span>
                    <div class="sn-hmain"><b class="ellipsis">${esc(q.body)}</b><small class="sn-hstat">${q.sent ? "You" : esc(q.fromName)} → ${esc(q.roleName)} · ${who} · ${esc(W.ago(q.createdUtc))}</small></div>
                    <span class="sn-ro-state ${cls}">${txt}</span>
                    <div class="sn-hact"><a class="sn-hbtn chat" href="/chat/${esc(q.escChannelId && !q.sent && q.escalatedTo === cfg.me ? q.escChannelId : q.channelId)}"><i class="fa fa-comment" aria-hidden="true"></i><span>Chat</span></a>
                        ${!q.closedUtc ? `<button type="button" class="sn-tool" data-ro-close="${q.requestId}" title="Done: close the request"><i class="fa fa-check" aria-hidden="true"></i> Close</button>` : ""}</div>
                </div>`;
            }).join("") || `<div class="sn-hist-none">${st.tab === "open" ? "Nothing waiting." : "No requests yet."}</div>`}</div>
        </section>`;
    }

    function ask(role) {
        const dlg = W.dialog("sn-ro-dlg", `${W.head("fa-" + (role.icon || "life-ring"), "Message " + role.name, "It goes to whoever in the role is in and free. You'll chat with them one-to-one.")}
            <div class="sn-dlg-body sn-nir-body">
                <textarea id="roBody" class="sn-textarea" rows="4" maxlength="1000" placeholder="What do you need? E.g. My laptop won't connect to the office Wi-Fi."></textarea>
                ${role.escalateMin ? `<small class="muted">No reply in ${role.escalateMin} minutes? It moves to their manager, or the next person.</small>` : ""}
            </div>
            <div class="sn-dlg-foot"><span></span><span class="sn-nir-foot-r"><button type="button" class="cee-btn sn-btn-light" data-close>Cancel</button>
                <button type="button" class="cee-btn cee-btn-gradient" data-ro-send><i class="fa fa-paper-plane" aria-hidden="true"></i> Send</button></span></div>`);
        setTimeout(() => dlg.querySelector("#roBody").focus(), 60);
        dlg.onclick = async (e) => {
            const b = e.target.closest("[data-ro-send]");
            if (!b) return;
            const body = dlg.querySelector("#roBody").value.trim();
            if (!body) { dlg.querySelector("#roBody").focus(); return; }
            b.disabled = true;
            const x = await W.post(`/work/roles/${role.roleId}/ask`, { body });
            b.disabled = false;
            if (!x.ok) { W.toast(x.d.error || "Not sent.", "error", role.name); return; }
            dlg.close();
            W.toast(`Sent to ${x.d.to}. ${x.d.why}.`, "success", "📨 " + role.name, { ms: 9000, action: { text: "Open chat", onClick: () => (SN.go ? SN.go(x.d.chatUrl) : (location.href = x.d.chatUrl)) } });
            load();
        };
    }

    async function editRole(role) {
        const people = (await SN.nirnay.people()).slice();
        const members = role ? role.members.map((m) => m.userId) : [];
        const st2 = { icon: role?.icon || "life-ring", members: members.slice() };
        const dlg = W.dialog("sn-ro-edit-dlg", `${W.head("fa-life-ring", role ? "Change role" : "New role", "People message the role; the first person in the list who is in and free gets it.")}
            <div class="sn-dlg-body sn-nir-body">
                <div class="sn-nir-two"><div><label class="sn-field-label" for="roName">Name</label><input id="roName" class="sn-wk-input" maxlength="80" value="${esc(role?.name || "")}" placeholder="IT help desk"></div>
                    <div><label class="sn-field-label" for="roEsc">No reply? Move on after</label><select id="roEsc" class="sn-wk-input">${[[5, "5 minutes"], [10, "10 minutes"], [15, "15 minutes"], [30, "30 minutes"], [60, "1 hour"], [0, "Never"]].map(([v, t]) => `<option value="${v}"${(role ? role.escalateMin : 15) === v ? " selected" : ""}>${t}</option>`).join("")}</select></div></div>
                <label class="sn-field-label" for="roDesc">What it's for <span class="muted">(optional)</span></label>
                <input id="roDesc" class="sn-wk-input" maxlength="200" value="${esc(role?.description || "")}" placeholder="Laptops, Wi-Fi, email, access cards">
                <div class="sn-field-label">Icon</div>
                <div class="sn-ro-icons">${ICONS.map((i) => `<button type="button" class="${i === st2.icon ? "on" : ""}" data-icon="${i}" aria-label="${i}"><i class="fa fa-${i}"></i></button>`).join("")}</div>
                <div class="sn-field-label">Who answers, in order</div>
                <div class="sn-ro-order" id="roOrder"></div>
                <div id="roAdd"></div>
            </div>
            <div class="sn-dlg-foot"><span>${role ? '<button type="button" class="cee-btn sn-btn-light sn-md-danger" data-ro-del>Delete</button>' : ""}</span>
                <span class="sn-nir-foot-r"><button type="button" class="cee-btn sn-btn-light" data-close>Cancel</button>
                <button type="button" class="cee-btn cee-btn-gradient" data-ro-save><i class="fa fa-check" aria-hidden="true"></i> Save</button></span></div>`);
        const paintOrder = () => {
            dlg.querySelector("#roOrder").innerHTML = st2.members.map((id, i) => {
                const p = people.find((x) => x.id === id) || { name: "Someone" };
                return `<div class="sn-ro-m"><span class="sn-ro-n">${i + 1}</span>${W.avatar(p.name, p.tone)}<span><b>${esc(p.name)}</b><small>${esc(p.dept || "")}</small></span>
                    <button type="button" data-up="${i}" aria-label="Move up"${i ? "" : " disabled"}><i class="fa fa-arrow-up"></i></button>
                    <button type="button" data-rm="${i}" aria-label="Remove"><i class="fa fa-times"></i></button></div>`;
            }).join("") || '<p class="sn-nir-empty">Add at least one person.</p>';
            W.personPicker(dlg.querySelector("#roAdd"), people.filter((p) => !st2.members.includes(p.id)), null, (p) => { st2.members.push(p.id); paintOrder(); }, "Add a person");
        };
        paintOrder();
        dlg.onclick = async (e) => {
            const t = e.target;
            const ic = t.closest("[data-icon]"); if (ic) { st2.icon = ic.dataset.icon; dlg.querySelectorAll("[data-icon]").forEach((b) => b.classList.toggle("on", b === ic)); return; }
            const up = t.closest("[data-up]"); if (up) { const i = +up.dataset.up; [st2.members[i - 1], st2.members[i]] = [st2.members[i], st2.members[i - 1]]; paintOrder(); return; }
            const rm = t.closest("[data-rm]"); if (rm) { st2.members.splice(+rm.dataset.rm, 1); paintOrder(); return; }
            const del = t.closest("[data-ro-del]");
            if (del) {
                if (!del.dataset.armed) { del.dataset.armed = "1"; del.textContent = "Yes, delete the role"; return; }
                const x = await W.post(`/work/roles/${role.roleId}/delete`);
                if (x.ok) { dlg.close(); load(); } else W.toast(x.d.error || "Not deleted.", "error");
                return;
            }
            if (t.closest("[data-ro-save]")) {
                const x = await W.post("/work/roles/save", {
                    roleId: role ? role.roleId : 0, name: dlg.querySelector("#roName").value, description: dlg.querySelector("#roDesc").value,
                    icon: st2.icon, escalateMin: +dlg.querySelector("#roEsc").value, members: st2.members
                });
                if (!x.ok) { W.toast(x.d.error || "Not saved.", "error", "Roles"); return; }
                dlg.close(); load();
            }
        };
    }

    root.addEventListener("click", async (e) => {
        const t = e.target;
        const tab = t.closest("[data-ro-tab]"); if (tab) { st.tab = tab.dataset.roTab; paint(); return; }
        if (t.closest("[data-ro-new]")) { editRole(null); return; }
        const ed = t.closest("[data-ro-edit]"); if (ed) { editRole(st.data.roles.find((r) => r.roleId === +ed.dataset.roEdit)); return; }
        const a = t.closest("[data-ro-ask]"); if (a) { ask(st.data.roles.find((r) => r.roleId === +a.dataset.roAsk)); return; }
        const c = t.closest("[data-ro-close]");
        if (c) { const x = await W.post(`/work/roles/requests/${c.dataset.roClose}/close`); if (x.ok) load(); else W.toast(x.d.error || "Couldn't close it.", "error"); }
    });
    load();
})();
