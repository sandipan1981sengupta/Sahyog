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
    const st = { data: null, tab: "open" };

    const grid = document.getElementById("roGrid"), list = document.getElementById("roList");
    async function load() {
        const x = await W.get("/work/roles/data");
        if (!x.ok) { grid.innerHTML = `<div class="sn-wk-empty"><i class="fa fa-database" aria-hidden="true"></i><b>Roles aren't ready yet</b><p>${esc(x.d.error || "Try again.")}</p></div>`; return; }
        st.data = x.d;
        paint();
    }
    const state = (q) => q.closedUtc ? ["closed", "Closed"] : q.answeredUtc ? ["ok", "Answered"] : q.escalatedUtc ? ["esc", "Escalated"] : ["wait", "Waiting"];

    function paint() {
        const d = st.data;
        const open = d.requests.filter((q) => !q.closedUtc && !q.answeredUtc);
        W.badge("roles", open.filter((q) => !q.sent).length);
        W.tabBadge("roTabs", "open", open.length, true, open.length ? "bad" : "");
        W.tabBadge("roTabs", "sent", d.requests.filter((q) => q.sent).length, true);
        W.tabBadge("roTabs", "all", d.requests.length, true);
        grid.innerHTML = d.roles.map((r) => {
            const on = r.members.filter((m) => m.online && !m.away).length;
            return `<article class="sn-ro-card">
                <header><span class="sn-ro-ic"><i class="fa fa-${esc(r.icon || "life-ring")}" aria-hidden="true"></i></span>
                    <div><b>${esc(r.name)}</b><small>${esc(r.description || "")}</small></div>
                    ${d.isAdmin ? `<button type="button" class="sn-ro-edit" data-ro-edit="${r.roleId}" title="Change" aria-label="Change ${esc(r.name)}"><i class="fa fa-pencil"></i></button>` : ""}</header>
                <div class="sn-ro-people">${r.members.slice(0, 6).map((m) => `<span class="sn-ro-p${m.online && !m.away ? " on" : ""}${m.away ? " away" : ""}" title="${esc(m.displayName)}${m.away ? " · out of office" : m.online ? " · online" : ""}">${W.avatar(m.displayName, m.avatarTone, m.userId)}</span>`).join("")}
                    <small>${on ? `${on} online` : r.members.length ? "Nobody online now" : "Nobody in it yet"}${r.escalateMin ? ` · moves on after ${r.escalateMin} min` : ""}</small></div>
                <button type="button" class="cee-btn cee-btn-gradient sn-ro-ask" data-ro-ask="${r.roleId}"${r.members.some((m) => m.userId !== cfg.me) ? "" : " disabled"}><i class="fa fa-paper-plane" aria-hidden="true"></i> Message ${esc(r.name)}</button>
            </article>`;
        }).join("") || `<div class="sn-wk-empty"><i class="fa fa-life-ring" aria-hidden="true"></i><b>No roles yet</b><p>${d.isAdmin ? "Add roles like “IT help desk”, “Accounts” or “Head of HR”, and who answers for each." : "Your admin can add roles like “IT help desk” or “Accounts”."}</p></div>`;
        const rows = st.tab === "open" ? open : st.tab === "sent" ? d.requests.filter((q) => q.sent) : d.requests;
        list.innerHTML = rows.map((q) => {
            const [cls, txt] = state(q);
            const who = q.escalatedName ? `${esc(q.assignedName)} → ${esc(q.escalatedName)}` : esc(q.assignedName);
            return `<div class="sn-hrow sn-ro-row">
                <span class="sn-ro-ic sm"><i class="fa fa-${esc(q.icon || "life-ring")}" aria-hidden="true"></i></span>
                <div class="sn-hmain"><b class="ellipsis">${esc(q.body)}</b><small class="sn-hstat">${q.sent ? "You" : esc(q.fromName)} → ${esc(q.roleName)} · ${who} · ${esc(W.ago(q.createdUtc))}</small></div>
                <span class="sn-ro-state ${cls}">${txt}</span>
                <div class="sn-hact"><a class="sn-hbtn chat" href="/chat/${esc(q.escChannelId && !q.sent && q.escalatedTo === cfg.me ? q.escChannelId : q.channelId)}"><i class="fa fa-comment" aria-hidden="true"></i><span>Chat</span></a>
                    ${!q.closedUtc ? `<button type="button" class="sn-tool" data-ro-close="${q.requestId}" title="Done: close the request"><i class="fa fa-check" aria-hidden="true"></i> Close</button>` : ""}</div>
            </div>`;
        }).join("") || `<div class="sn-hist-none">${st.tab === "open" ? "Nothing waiting." : "No requests yet."}</div>`;
    }
    W.onTab("roTabs", (id) => { st.tab = id || "open"; if (st.data) paint(); });

    // ---------- the two windows (Views/Work/Roles.cshtml, tag-helper controls) ----------
    const C = W.ctl;
    const askDlg = document.getElementById("roAskDlg"), editDlg = document.getElementById("roEditDlg");
    [askDlg, editDlg].forEach((d) => d && C.wire(d));
    let asking = null, editing = null, members = [], people = [];

    function ask(role) {
        asking = role;
        askDlg.querySelector("[data-ro-title]").textContent = "Message " + role.name;
        askDlg.querySelector("[data-ro-icon]").innerHTML = `<i class="fa fa-${esc(role.icon || "life-ring")}" aria-hidden="true"></i>`;
        askDlg.querySelector("[data-ro-esc]").textContent = role.escalateMin ? `No reply in ${role.escalateMin} minutes? It moves to their manager, or the next person.` : "";
        C.set("roBody", "");
        C.open(askDlg);
        setTimeout(() => askDlg.querySelector("#roBody").focus(), 60);
    }
    askDlg?.querySelector("[data-ro-send]").addEventListener("click", async (e) => {
        const b = e.currentTarget, role = asking;
        const body = C.get("roBody");
        if (!body) { window.validateModernInput?.("#roBody"); askDlg.querySelector("#roBody").focus(); return; }
        b.disabled = true;
        const x = await W.post(`/work/roles/${role.roleId}/ask`, { body });
        b.disabled = false;
        if (!x.ok) { W.toast(x.d.error || "Not sent.", "error", role.name); return; }
        askDlg.close();
        W.toast(`Sent to ${x.d.to}. ${x.d.why}.`, "success", "📨 " + role.name, { ms: 9000, action: { text: "Open chat", onClick: () => (SN.go ? SN.go(x.d.chatUrl) : (location.href = x.d.chatUrl)) } });
        load();
    });

    function paintOrder() {
        editDlg.querySelector("[data-ro-order]").innerHTML = members.map((id, i) => {
            const p = people.find((x) => x.id === id) || { name: "Someone" };
            return `<div class="sn-ro-m"><span class="sn-ro-n">${i + 1}</span>${W.avatar(p.name, p.tone)}<span><b>${esc(p.name)}</b><small>${esc(p.dept || "")}</small></span>
                <button type="button" data-up="${i}" aria-label="Move up"${i ? "" : " disabled"}><i class="fa fa-arrow-up"></i></button>
                <button type="button" data-rm="${i}" aria-label="Remove"><i class="fa fa-times"></i></button></div>`;
        }).join("") || '<p class="sn-nir-empty">Add at least one person.</p>';
    }
    async function editRole(role) {
        editing = role;
        people = await SN.nirnay.people();
        members = role ? role.members.map((m) => m.userId) : [];
        editDlg.querySelector("[data-ro-etitle]").textContent = role ? "Change role" : "New role";
        C.set("roName", role ? role.name : "");
        C.set("roDesc", role ? role.description || "" : "");
        C.set("roIcon", role ? role.icon || "life-ring" : "life-ring");
        C.set("roEsc", String(role ? role.escalateMin : 15));
        C.set("roAdd", "");
        const del = editDlg.querySelector("[data-ro-del]");
        del.hidden = !role; delete del.dataset.armed; del.querySelector("span").textContent = "Delete";
        paintOrder();
        C.open(editDlg);
    }
    // a person picked in "Add a person…": onto the end of the list, and the dropdown is ready for the next one
    if (window.jQuery) jQuery(editDlg).on("change", "#roAdd_value", function () {
        const id = this.value;
        if (!id) return;
        if (!members.includes(id)) members.push(id);
        paintOrder();
        setTimeout(() => C.set("roAdd", ""), 0);
    });
    editDlg?.addEventListener("click", async (e) => {
        const t = e.target;
        const up = t.closest("[data-up]"); if (up) { const i = +up.dataset.up; [members[i - 1], members[i]] = [members[i], members[i - 1]]; paintOrder(); return; }
        const rm = t.closest("[data-rm]"); if (rm) { members.splice(+rm.dataset.rm, 1); paintOrder(); return; }
        const del = t.closest("[data-ro-del]");
        if (del && editing) {
            if (!del.dataset.armed) { del.dataset.armed = "1"; del.querySelector("span").textContent = "Yes, delete the role"; return; }
            const x = await W.post(`/work/roles/${editing.roleId}/delete`);
            if (x.ok) { editDlg.close(); load(); } else W.toast(x.d.error || "Not deleted.", "error");
            return;
        }
        const save = t.closest("[data-ro-save]");
        if (!save) return;
        const name = C.get("roName");
        if (!name) { window.validateModernInput?.("#roName"); W.toast("Give the role a name, e.g. IT help desk.", "warn"); return; }
        if (!members.length) { W.toast("Add at least one person to the role.", "warn"); return; }
        save.disabled = true;
        const x = await W.post("/work/roles/save", {
            roleId: editing ? editing.roleId : 0, name, description: C.get("roDesc"),
            icon: C.get("roIcon") || "life-ring", escalateMin: +(C.get("roEsc") || 15), members
        });
        save.disabled = false;
        if (!x.ok) { W.toast(x.d.error || "Not saved.", "error", "Roles"); return; }
        editDlg.close(); load();
    });

    root.addEventListener("click", async (e) => {
        const t = e.target;
        if (t.closest("[data-ro-new]")) { editRole(null); return; }
        const ed = t.closest("[data-ro-edit]"); if (ed) { editRole(st.data.roles.find((r) => r.roleId === +ed.dataset.roEdit)); return; }
        const a = t.closest("[data-ro-ask]"); if (a) { ask(st.data.roles.find((r) => r.roleId === +a.dataset.roAsk)); return; }
        const c = t.closest("[data-ro-close]");
        if (c) { const x = await W.post(`/work/roles/requests/${c.dataset.roClose}/close`); if (x.ok) load(); else W.toast(x.d.error || "Couldn't close it.", "error"); }
    });
    load();
})();
