// ShankhNaad · Work → Visitors: the day's visitors (expected, in the building, left), "Expect a visitor", a walk-in,
// export; admins: the reception tablet link. Server: Controllers/VisitorsController.cs · tablet: /lobby/{code}
(function () {
    "use strict";
    const root = document.getElementById("viApp");
    const W = window.SN && SN.wk;
    if (!root || !W) return;
    const esc = W.esc;
    let cfg = {};
    try { cfg = JSON.parse(document.getElementById("wkData")?.textContent || "{}"); } catch { }
    const st = { day: null, data: null, tab: "all", q: "" };
    const shift = (iso, n) => { const d = W.parseYmd(iso); d.setDate(d.getDate() + n); return W.ymd(d); };
    const stage = (v) => v.leftUtc ? "left" : v.arrivedUtc ? "in" : "expected";

    async function load(day) {
        const x = await W.get(`/work/visitors/data${day ? "?day=" + day : ""}`);
        if (!x.ok) { root.innerHTML = `<div class="sn-wk-empty glass"><i class="fa fa-database" aria-hidden="true"></i><b>Visitors isn't ready yet</b><p>${esc(x.d.error || "Try again.")}</p></div>`; return; }
        st.data = x.d; st.day = x.d.day;
        paint();
    }

    function row(v) {
        const s = stage(v);
        const when = s === "expected" ? `Expected ${W.time(v.expectedUtc)}` : s === "in" ? `Arrived ${W.time(v.arrivedUtc)}` : `${W.time(v.arrivedUtc)} – ${W.time(v.leftUtc)}`;
        const reply = v.hostReply === "coming" ? '<span class="sn-vi-reply ok">Host coming</span>' : v.hostReply === "wait" ? '<span class="sn-vi-reply">Asked to wait</span>' : "";
        const host = v.hostId === cfg.me;
        return `<div class="sn-hrow sn-vi-row st-${s}">
            <span class="sn-vi-av">${esc(W.initials(v.name))}</span>
            <div class="sn-hmain"><b class="ellipsis">${esc(v.name)}${v.company ? ` <small class="muted">· ${esc(v.company)}</small>` : ""}</b>
                <small class="sn-hstat">${v.hostName ? `Meeting ${host ? "you" : esc(v.hostName)}` : "No host picked"}${v.purpose ? " · " + esc(v.purpose) : ""}${v.phone ? " · " + esc(v.phone) : ""}</small></div>
            <span class="sn-vi-stage st-${s}">${s === "expected" ? "Expected" : s === "in" ? "In the building" : "Left"}</span>${reply}
            <time class="sn-htime">${esc(when)}</time>
            <div class="sn-hact">
                ${s === "expected" ? `<button type="button" class="sn-tool" data-vi="arrive" data-id="${v.visitorId}"><i class="fa fa-sign-in" aria-hidden="true"></i> Checked in</button>` : ""}
                ${s === "in" ? `${host && !v.hostReply ? `<button type="button" class="sn-tool" data-vi="coming" data-id="${v.visitorId}"><i class="fa fa-check" aria-hidden="true"></i> I'm coming</button>` : ""}<button type="button" class="sn-tool" data-vi="leave" data-id="${v.visitorId}"><i class="fa fa-sign-out" aria-hidden="true"></i> Left</button>` : ""}
                ${cfg.isAdmin || host || v.createdBy === cfg.me ? `<button type="button" class="sn-hbtn del" data-vi="delete" data-id="${v.visitorId}" title="Remove" aria-label="Remove"><i class="fa fa-trash-o" aria-hidden="true"></i></button>` : ""}
            </div></div>`;
    }

    function paint() {
        const d = st.data, all = d.visitors;
        const n = (s) => all.filter((v) => stage(v) === s).length;
        const q = st.q.toLowerCase();
        const list = all.filter((v) => (st.tab === "all" || stage(v) === st.tab) && (!q || [v.name, v.company, v.hostName, v.phone, v.purpose].join(" ").toLowerCase().includes(q)));
        const isToday = d.day === d.today;
        const lobby = d.lobby;
        root.innerHTML = `
        <div class="sn-grid-4 sn-nir-stats">
            <div class="sn-stat glass"><span class="sn-stat-ic" style="background:rgba(14,165,233,.12);color:#0284c7"><i class="fa fa-clock-o"></i></span><div><div class="sn-eyebrow">Expected</div><div class="sn-stat-val">${n("expected")}</div></div></div>
            <div class="sn-stat glass"><span class="sn-stat-ic" style="background:rgba(22,163,74,.12);color:#15803d"><i class="fa fa-building-o"></i></span><div><div class="sn-eyebrow">In the building</div><div class="sn-stat-val">${n("in")}</div></div></div>
            <div class="sn-stat glass"><span class="sn-stat-ic" style="background:rgba(100,116,139,.14);color:#475569"><i class="fa fa-sign-out"></i></span><div><div class="sn-eyebrow">Left</div><div class="sn-stat-val">${n("left")}</div></div></div>
            <div class="sn-stat glass"><span class="sn-stat-ic" style="background:rgba(124,58,237,.12);color:#6d28d9"><i class="fa fa-users"></i></span><div><div class="sn-eyebrow">${isToday ? "Today" : esc(W.day(d.day))}</div><div class="sn-stat-val">${all.length}</div></div></div>
        </div>
        ${lobby ? `<section class="sn-vi-lobby glass">
            <span class="sn-vi-lobby-ic"><i class="fa fa-tablet" aria-hidden="true"></i></span>
            <div><b>Reception tablet ${lobby.enabled ? '<span class="sn-vi-reply ok">On</span>' : '<span class="sn-vi-reply">Off</span>'}</b>
                <small>${lobby.url ? `Open this link on the tablet at reception (no sign-in needed). Visitors sign in there and their host gets a card.` : "Visitors sign in on a tablet at reception, and the person they're meeting gets a card in ShankhNaad."}</small>
                ${lobby.url && lobby.enabled ? `<div class="sn-vi-link"><input readonly value="${esc(lobby.url)}" aria-label="Reception link"><button type="button" class="sn-tool" data-lobby-copy><i class="fa fa-clipboard" aria-hidden="true"></i> Copy</button><a class="sn-tool" href="${esc(lobby.url)}" target="_blank" rel="noopener"><i class="fa fa-external-link" aria-hidden="true"></i> Open</a></div>` : ""}</div>
            <span class="sn-vi-lobby-acts">${lobby.url ? `<button type="button" class="sn-tool" data-lobby="${lobby.enabled ? "off" : "on"}">${lobby.enabled ? "Turn off" : "Turn on"}</button>${lobby.enabled ? '<button type="button" class="sn-tool" data-lobby="new" title="The old link stops working">New link</button>' : ""}`
                : '<button type="button" class="cee-btn cee-btn-gradient sn-nir-new" data-lobby="on"><i class="fa fa-power-off" aria-hidden="true"></i> <span>Set it up</span></button>'}</span>
        </section>` : ""}
        <section class="sn-hist glass">
            <div class="sn-hist-bar">
                <div class="sn-hist-tabs" role="tablist">${[["all", "All", all.length], ["expected", "Expected", n("expected")], ["in", "In the building", n("in")], ["left", "Left", n("left")]].map(([k, t, c]) => `<button type="button" role="tab" class="${st.tab === k ? "on" : ""}" aria-selected="${st.tab === k}" data-vtab="${k}">${t} <span class="sn-hist-n">${c}</span></button>`).join("")}</div>
                <div class="sn-wk-daynav"><button type="button" data-vday="-1" aria-label="Day before"><i class="fa fa-chevron-left"></i></button><b>${isToday ? "Today" : esc(W.day(d.day))}</b><button type="button" data-vday="1" aria-label="Next day"><i class="fa fa-chevron-right"></i></button></div>
                <label class="search sn-hist-search"><i class="fa fa-search" aria-hidden="true"></i><input type="search" placeholder="Search name, company, host" value="${esc(st.q)}" data-vq aria-label="Search visitors"></label>
                <div class="sn-hist-tools"><a class="sn-tool" href="/work/visitors/export?day=${d.day}"><i class="fa fa-download" aria-hidden="true"></i> Export</a>
                    ${isToday ? '<button type="button" class="sn-tool" data-vi-walkin><i class="fa fa-sign-in" aria-hidden="true"></i> Walk-in</button>' : ""}
                    <button type="button" class="cee-btn cee-btn-gradient sn-nir-new" data-vi-new><i class="fa fa-plus" aria-hidden="true"></i> <span>Expect a visitor</span></button></div>
            </div>
            <div class="sn-hist-list">${list.map(row).join("") || `<div class="sn-wk-empty"><i class="fa fa-id-card-o" aria-hidden="true"></i><b>${all.length ? "Nothing matches" : "No visitors " + (isToday ? "today" : "this day")}</b><p>${all.length ? "" : "Expecting someone? Add them, and reception will know who they're meeting."}</p></div>`}</div>
        </section>`;
    }

    async function expect(walkin) {
        const people = await SN.nirnay.people();
        const now = new Date(); const t = `${String(now.getHours() + 1).padStart(2, "0")}:00`;
        const dlg = W.dialog("sn-vi-dlg", `${W.head(walkin ? "fa-sign-in" : "fa-id-card-o", walkin ? "Check in a walk-in visitor" : "Expect a visitor", walkin ? "They're at reception now. Their host gets a card." : "Reception sees them on the list; if they sign in at the tablet with this phone number, it's matched.")}
            <div class="sn-dlg-body sn-nir-body">
                <div class="sn-nir-two"><div><label class="sn-field-label" for="viName">Name</label><input id="viName" class="sn-wk-input" maxlength="100" placeholder="Ravi Kumar"></div>
                    <div><label class="sn-field-label" for="viCo">Company <span class="muted">(optional)</span></label><input id="viCo" class="sn-wk-input" maxlength="100" placeholder="Mehta Traders"></div></div>
                <div class="sn-nir-two"><div><label class="sn-field-label" for="viPhone">Phone <span class="muted">(optional)</span></label><input id="viPhone" class="sn-wk-input" maxlength="20" inputmode="tel" placeholder="98450 12345"></div>
                    <div><label class="sn-field-label" for="viWhy">Purpose <span class="muted">(optional)</span></label><input id="viWhy" class="sn-wk-input" maxlength="200" placeholder="Quarterly review"></div></div>
                ${walkin ? "" : `<div class="sn-nir-two"><div><label class="sn-field-label" for="viDay">Day</label><input type="date" id="viDay" class="sn-wk-input" value="${st.day >= W.ymd(now) ? st.day : W.ymd(now)}" min="${W.ymd(now)}"></div>
                    <div><label class="sn-field-label" for="viTime">Time</label><input type="time" id="viTime" class="sn-wk-input" value="${t}" step="900"></div></div>`}
                <div class="sn-field-label">Meeting</div><div id="viHost"></div>
            </div>
            <div class="sn-dlg-foot"><span></span><span class="sn-nir-foot-r"><button type="button" class="cee-btn sn-btn-light" data-close>Cancel</button>
                <button type="button" class="cee-btn cee-btn-gradient" data-vi-save><i class="fa fa-check" aria-hidden="true"></i> ${walkin ? "Check in" : "Add"}</button></span></div>`);
        const host = W.personPicker(dlg.querySelector("#viHost"), people, cfg.me, null, "Who are they meeting?");
        setTimeout(() => dlg.querySelector("#viName").focus(), 60);
        dlg.onclick = async (e) => {
            const b = e.target.closest("[data-vi-save]");
            if (!b) return;
            const q = (s) => dlg.querySelector(s);
            b.disabled = true;
            const x = await W.post("/work/visitors/expect", {
                name: q("#viName").value, company: q("#viCo").value, phone: q("#viPhone").value, purpose: q("#viWhy").value,
                hostId: host.value, day: walkin ? null : q("#viDay").value, time: walkin ? null : q("#viTime").value, arrived: !!walkin
            });
            b.disabled = false;
            if (!x.ok) { W.toast(x.d.error || "Not saved.", "error", "Visitors"); return; }
            dlg.close();
            W.toast(walkin ? `${x.d.name} is checked in.` : `${x.d.name} is on the list.`, "success", "Visitors");
            load(st.day);
        };
    }

    root.addEventListener("click", async (e) => {
        const t = e.target;
        const tab = t.closest("[data-vtab]"); if (tab) { st.tab = tab.dataset.vtab; paint(); return; }
        const dn = t.closest("[data-vday]"); if (dn) { load(shift(st.day, +dn.dataset.vday)); return; }
        if (t.closest("[data-vi-new]")) { expect(false); return; }
        if (t.closest("[data-vi-walkin]")) { expect(true); return; }
        if (t.closest("[data-lobby-copy]")) { const i = root.querySelector(".sn-vi-link input"); i.select(); try { await navigator.clipboard.writeText(i.value); W.toast("Link copied.", "success"); } catch { document.execCommand?.("copy"); } return; }
        const lb = t.closest("[data-lobby]");
        if (lb) {
            const l = st.data.lobby || {};
            const x = await W.post("/work/visitors/lobby", { enabled: lb.dataset.lobby !== "off", welcome: l.welcome || null, newLink: lb.dataset.lobby === "new" });
            if (!x.ok) { W.toast(x.d.error || "Didn't work.", "error"); return; }
            W.toast(lb.dataset.lobby === "new" ? "New link made. The old one no longer works." : x.d.enabled ? "The reception tablet is on." : "The reception tablet is off.", "success", "Visitors");
            load(st.day); return;
        }
        const b = t.closest("[data-vi]");
        if (b) {
            if (b.dataset.vi === "delete" && !b.dataset.armed) { b.dataset.armed = "1"; b.title = "Press again to remove"; b.classList.add("armed"); setTimeout(() => { delete b.dataset.armed; b.classList.remove("armed"); }, 3000); return; }
            const x = await W.post(`/work/visitors/${b.dataset.id}/${b.dataset.vi}`);
            if (!x.ok) { W.toast(x.d.error || "Didn't work.", "error"); return; }
            load(st.day);
        }
    });
    root.addEventListener("input", (e) => {
        if (!e.target.matches("[data-vq]")) return;
        st.q = e.target.value; const pos = e.target.selectionStart; paint();
        const i = root.querySelector("[data-vq]"); i.focus(); i.setSelectionRange(pos, pos);
    });
    const changed = () => { if (!document.body.contains(root)) { document.removeEventListener("sn:visitor-changed", changed); return; } load(st.day); };
    document.addEventListener("sn:visitor-changed", changed);
    load();
})();
