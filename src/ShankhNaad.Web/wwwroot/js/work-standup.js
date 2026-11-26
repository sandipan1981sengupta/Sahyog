// ShankhNaad · Work → Stand-up. Left: your stand-ups for the day (answer / change). Right: the team roll-up, blockers first.
// Server: Controllers/StandupController.cs · reminders: Infrastructure/WorkJobs.cs · live: sn:standup-answered (js/work-live.js)
(function () {
    "use strict";
    const root = document.getElementById("suApp");
    const W = window.SN && SN.wk;
    if (!root || !W) return;
    const esc = W.esc;
    let cfg = {};
    try { cfg = JSON.parse(document.getElementById("wkData")?.textContent || "{}"); } catch { }
    const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const params = new URLSearchParams(location.search);
    const st = { day: null, data: null, roll: Number(params.get("roll") || params.get("answer")) || null, rollDay: null, rollup: null, editing: {} };
    const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const timeText = (m) => new Date(2000, 0, 1, Math.floor(m / 60), m % 60).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const daysText = (bits) => bits === 31 ? "Weekdays" : bits === 127 ? "Every day" : DAYS.filter((_, i) => bits >> i & 1).join(", ");
    const runsOn = (s, dow) => ((s.days >> dow) & 1) === 1;
    const shift = (iso, n) => { const d = W.parseYmd(iso); d.setDate(d.getDate() + n); return W.ymd(d); };

    async function load(day) {
        const x = await W.get(`/work/standup/data${day ? "?day=" + day : ""}`);
        if (!x.ok) { root.innerHTML = `<div class="sn-wk-empty glass"><i class="fa fa-database" aria-hidden="true"></i><b>Stand-up isn't ready yet</b><p>${esc(x.d.error || "Try again.")}</p></div>`; return; }
        st.data = x.d; st.day = x.d.day;
        if (!st.rollDay) st.rollDay = x.d.day;
        if (!st.roll || !x.d.standups.some((s) => s.standupId === st.roll))
            st.roll = (x.d.mine[0] || x.d.standups.find((s) => s.isActive) || {}).standupId || null;
        paint();
        loadRoll();
    }
    async function loadRoll() {
        if (!st.roll) { st.rollup = null; paintRoll(); return; }
        const x = await W.get(`/work/standup/${st.roll}/rollup?day=${st.rollDay}`);
        st.rollup = x.ok ? x.d : { error: x.d.error };
        paintRoll();
    }

    // ---------- left: my stand-ups ----------
    function myCard(s) {
        const d = st.data, answered = !!s.answeredUtc, edit = st.editing[s.standupId] || !answered;
        const notToday = !runsOn(s, d.dow);
        const waiting = !answered && d.day === d.today && runsOn(s, d.dow) && d.nowMinutes < s.atMinutes;
        if (notToday && !answered) return `<article class="sn-su-card off"><header><b>${esc(s.name)}</b><small>${esc(daysText(s.days))} · ${timeText(s.atMinutes)}</small></header><p class="sn-nir-empty">No stand-up on ${esc(W.day(d.day))}.</p></article>`;
        const q = [s.q1, s.q2, s.q3], a = [s.a1, s.a2, s.a3];
        return `<article class="sn-su-card${answered ? " done" : ""}${s.hasBlocker ? " blocked" : ""}" data-su="${s.standupId}">
            <header><b>${esc(s.name)}</b><small>${esc(s.departmentName || "Everyone")} · ${esc(daysText(s.days))} at ${timeText(s.atMinutes)}</small>
                ${answered ? `<span class="sn-su-tag ok"><i class="fa fa-check" aria-hidden="true"></i> Answered ${esc(W.time(s.answeredUtc))}</span>` : waiting ? `<span class="sn-su-tag">Opens ${timeText(s.atMinutes)}</span>` : `<span class="sn-su-tag due">To answer</span>`}</header>
            ${edit ? `${q.map((t, i) => `<label class="sn-su-q"><span>${esc(t)}</span><textarea class="sn-textarea" rows="2" maxlength="1000" data-a="${i + 1}" placeholder="${i === 2 ? "Nothing? Leave it empty." : "A line or two is enough"}">${esc(a[i] || "")}</textarea></label>`).join("")}
                <div class="sn-su-foot"><label class="sn-su-block"><input type="checkbox" data-blocker${s.hasBlocker ? " checked" : ""}> I'm blocked and need help</label>
                    <span>${answered ? '<button type="button" class="cee-btn sn-btn-light" data-su-cancel>Cancel</button>' : ""}<button type="button" class="cee-btn cee-btn-gradient" data-su-send><i class="fa fa-paper-plane" aria-hidden="true"></i> ${answered ? "Save" : "Post answers"}</button></span></div>`
            : `${q.map((t, i) => a[i] ? `<div class="sn-su-ans"><small>${esc(t)}</small><p>${esc(a[i])}</p></div>` : "").join("")}
                <div class="sn-su-foot">${s.hasBlocker ? '<span class="sn-su-tag bad"><i class="fa fa-exclamation-triangle" aria-hidden="true"></i> Blocked: your manager knows</span>' : "<span></span>"}<button type="button" class="sn-link" data-su-edit>Change</button></div>`}
        </article>`;
    }
    function paint() {
        const d = st.data;
        const isToday = d.day === d.today;
        root.innerHTML = `<div class="sn-wk-cols sn-su">
            <section class="sn-wk-col glass" aria-label="Your stand-ups">
                <div class="sn-wk-colhead"><h2>Your stand-ups</h2>
                    <div class="sn-wk-daynav"><button type="button" data-day="-1" aria-label="Day before"><i class="fa fa-chevron-left"></i></button>
                        <b>${isToday ? "Today" : esc(W.day(d.day))}</b>
                        <button type="button" data-day="1" aria-label="Next day"${isToday ? " disabled" : ""}><i class="fa fa-chevron-right"></i></button></div></div>
                <div class="sn-su-mine">${d.mine.map(myCard).join("") || `<div class="sn-wk-empty"><i class="fa fa-sun-o" aria-hidden="true"></i><b>You're not in a stand-up yet</b>
                    <p>${d.canCreate ? "Set one up for your team: three questions at a time you choose." : "When your admin or department head sets one up, it shows here."}</p>
                    ${d.canCreate ? '<button type="button" class="sn-hbtn chat" data-su-new><i class="fa fa-plus"></i><span>New stand-up</span></button>' : ""}</div>`}</div>
            </section>
            <section class="sn-wk-col glass" aria-label="Team roll-up" id="suRoll"></section>
        </div>`;
        if (params.get("answer")) {
            const card = root.querySelector(`[data-su="${params.get("answer")}"] textarea`);
            if (card) { card.focus(); card.scrollIntoView({ block: "center" }); }
            params.delete("answer");
        }
    }

    // ---------- right: the roll-up ----------
    function paintRoll() {
        const box = root.querySelector("#suRoll");
        if (!box) return;
        const d = st.data;
        const chips = d.standups.length > 1 ? `<div class="sn-hist-chips sn-su-chips">${d.standups.map((s) => `<button type="button" class="${s.standupId === st.roll ? "on" : ""}" data-roll="${s.standupId}">${esc(s.name)}${s.isActive ? "" : " (paused)"}</button>`).join("")}</div>` : "";
        const head = `<div class="sn-wk-colhead"><h2>Team roll-up</h2>
            <span class="sn-wk-tools">${d.canCreate ? '<button type="button" class="sn-tool" data-su-new><i class="fa fa-plus" aria-hidden="true"></i> New</button>' : ""}
            ${st.rollup?.standup?.canEdit ? '<button type="button" class="sn-tool" data-su-edit-roll><i class="fa fa-pencil" aria-hidden="true"></i> Edit</button>' : ""}</span></div>`;
        const r = st.rollup;
        if (!d.standups.length) { box.innerHTML = head + `<div class="sn-wk-empty"><i class="fa fa-users" aria-hidden="true"></i><b>No stand-ups yet</b><p>${d.canCreate ? "Press New to set the first one up." : "Nothing to show yet."}</p></div>`; return; }
        if (!r) { box.innerHTML = head + chips + '<div class="sn-nir-loading">Loading…</div>'; return; }
        if (r.error) { box.innerHTML = head + chips + `<div class="sn-wk-empty"><i class="fa fa-lock" aria-hidden="true"></i><p>${esc(r.error)}</p></div>`; return; }
        const people = r.people, done = people.filter((p) => p.answeredUtc), blocked = done.filter((p) => p.hasBlocker), waiting = people.filter((p) => !p.answeredUtc);
        const pct = people.length ? Math.round(100 * done.length / people.length) : 0;
        const s = r.standup;
        const ansCard = (p) => `<article class="sn-su-person${p.hasBlocker ? " blocked" : ""}">
            <header>${W.avatar(p.displayName, p.avatarTone, p.userId, 38)}<span><b>${p.userId === cfg.me ? "You" : esc(p.displayName)}</b><small>${esc(p.jobTitle || "")} · ${esc(W.time(p.answeredUtc))}</small></span>${p.hasBlocker ? '<span class="sn-su-tag bad"><i class="fa fa-exclamation-triangle" aria-hidden="true"></i> Blocked</span>' : ""}</header>
            ${[[s.q1, p.a1], [s.q2, p.a2], [s.q3, p.a3]].filter((x) => x[1]).map(([q, a], i) => `<div class="sn-su-ans${p.hasBlocker && i === 2 ? " hot" : ""}"><small>${esc(q)}</small><p>${esc(a)}</p></div>`).join("")}
        </article>`;
        box.innerHTML = head + chips + `
            <div class="sn-wk-daynav sn-su-rollnav"><button type="button" data-rday="-1" aria-label="Day before"><i class="fa fa-chevron-left"></i></button>
                <b>${r.day === d.today ? "Today" : esc(W.day(r.day))}</b>
                <button type="button" data-rday="1" aria-label="Next day"${r.day >= d.today ? " disabled" : ""}><i class="fa fa-chevron-right"></i></button>
                <small>${esc(s.departmentName || "Everyone")} · ${esc(daysText(s.days))} at ${timeText(s.atMinutes)}</small></div>
            ${!r.runsToday && !done.length ? `<p class="sn-nir-empty">No stand-up on this day.</p>` : `
            <div class="sn-shk-meter sn-su-meter"><div class="sn-shk-bar"><i style="width:${pct}%"></i></div><b>${done.length} of ${people.length} answered</b>${blocked.length ? `<span class="sn-su-tag bad">${blocked.length} blocked</span>` : ""}</div>
            ${blocked.length ? `<div class="sn-nir-lbl">Blockers <span>${blocked.length}</span></div>${blocked.map(ansCard).join("")}` : ""}
            ${done.length - blocked.length ? `<div class="sn-nir-lbl">Answers <span>${done.length - blocked.length}</span></div>${done.filter((p) => !p.hasBlocker).map(ansCard).join("")}` : ""}
            ${waiting.length ? `<div class="sn-nir-lbl">Not answered yet <span>${waiting.length}</span></div><div class="sn-su-waiting">${waiting.map((p) => `<span title="${esc(p.displayName)}">${W.avatar(p.displayName, p.avatarTone, p.userId, 28)}<small>${esc(p.displayName.split(" ")[0])}</small></span>`).join("")}</div>` : ""}`}`;
    }

    // ---------- set up / change a stand-up ----------
    function editor(s) {
        const d = st.data;
        const deptOpts = (cfg.depts || []).filter((x) => (d.manageDepts || []).includes(x.id));
        const days = s ? s.days : 31;
        const at = s ? s.atMinutes : 600;
        const times = []; for (let m = 6 * 60; m <= 21 * 60 + 30; m += 30) times.push(m);
        const dlg = W.dialog("sn-su-dlg", `${W.head("fa-sun-o", s ? "Change stand-up" : "New stand-up", "People answer three short questions on the days you pick. At the time, ShankhNaad reminds whoever hasn't.")}
            <div class="sn-dlg-body sn-nir-body">
                <label class="sn-field-label" for="suName">Name</label>
                <input id="suName" class="sn-wk-input" maxlength="80" value="${esc(s ? s.name : "Daily stand-up")}">
                <div class="sn-nir-two">
                    <div><label class="sn-field-label" for="suTeam">Who</label>
                        <select id="suTeam" class="sn-wk-input">${d.canEveryone ? `<option value="">Everyone in the workspace</option>` : ""}${deptOpts.map((x) => `<option value="${esc(x.id)}"${s && s.departmentId === x.id ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>
                    <div><label class="sn-field-label" for="suAt">Time</label>
                        <select id="suAt" class="sn-wk-input">${times.map((m) => `<option value="${hm(m)}"${m === at ? " selected" : ""}>${timeText(m)}</option>`).join("")}</select></div>
                </div>
                <div class="sn-field-label">Days</div>
                <div class="sn-nir-chips sn-su-days">${DAYS.map((t, i) => `<button type="button" class="sn-nir-chip${days >> i & 1 ? " on" : ""}" data-dow="${i}" aria-pressed="${!!(days >> i & 1)}">${t}</button>`).join("")}</div>
                <div class="sn-field-label">Questions</div>
                ${[1, 2, 3].map((n) => `<input class="sn-wk-input" data-q="${n}" maxlength="150" value="${esc(s ? s["q" + n] : ["What did you finish since the last stand-up?", "What are you working on today?", "Anything blocking you?"][n - 1])}">`).join("")}
                ${s ? `<label class="sn-su-block"><input type="checkbox" id="suActive"${s.isActive ? " checked" : ""}> Running (untick to pause it)</label>` : ""}
            </div>
            <div class="sn-dlg-foot"><span>${s ? '<button type="button" class="cee-btn sn-btn-light sn-md-danger" data-su-del>Delete</button>' : ""}</span>
                <span class="sn-nir-foot-r"><button type="button" class="cee-btn sn-btn-light" data-close>Cancel</button>
                <button type="button" class="cee-btn cee-btn-gradient" data-su-save><i class="fa fa-check" aria-hidden="true"></i> ${s ? "Save" : "Start it"}</button></span></div>`);
        dlg.onclick = async (e) => {
            const dow = e.target.closest("[data-dow]");
            if (dow) { const on = !dow.classList.contains("on"); dow.classList.toggle("on", on); dow.setAttribute("aria-pressed", on); return; }
            if (e.target.closest("[data-su-del]")) {
                const b = e.target.closest("[data-su-del]");
                if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Yes, delete it and its answers"; return; }
                const x = await W.post(`/work/standup/${s.standupId}/delete`);
                if (!x.ok) { W.toast(x.d.error || "Couldn't delete it.", "error"); return; }
                dlg.close(); st.roll = null; load(st.day); return;
            }
            if (e.target.closest("[data-su-save]")) {
                const body = {
                    standupId: s ? s.standupId : 0, name: dlg.querySelector("#suName").value, departmentId: dlg.querySelector("#suTeam").value || null,
                    days: [...dlg.querySelectorAll("[data-dow].on")].map((b) => +b.dataset.dow), at: dlg.querySelector("#suAt").value,
                    q1: dlg.querySelector('[data-q="1"]').value, q2: dlg.querySelector('[data-q="2"]').value, q3: dlg.querySelector('[data-q="3"]').value,
                    isActive: s ? dlg.querySelector("#suActive").checked : true
                };
                const x = await W.post("/work/standup/save", body);
                if (!x.ok) { W.toast(x.d.error || "Not saved.", "error", "Stand-up"); return; }
                dlg.close(); st.roll = x.d.standupId;
                W.toast(s ? "Saved." : "Stand-up started. People get a reminder at its time.", "success", "☀ Stand-up");
                load(st.day);
            }
        };
    }

    root.addEventListener("click", async (e) => {
        const t = e.target;
        const dn = t.closest("[data-day]"); if (dn) { st.editing = {}; load(shift(st.day, +dn.dataset.day)); return; }
        const rd = t.closest("[data-rday]"); if (rd) { st.rollDay = shift(st.rollDay, +rd.dataset.rday); loadRoll(); return; }
        const rl = t.closest("[data-roll]"); if (rl) { st.roll = +rl.dataset.roll; loadRoll(); paintRoll(); return; }
        if (t.closest("[data-su-new]")) { editor(null); return; }
        if (t.closest("[data-su-edit-roll]")) { editor(st.data.standups.find((s) => s.standupId === st.roll) || st.rollup.standup); return; }
        const card = t.closest("[data-su]");
        if (!card) return;
        const id = +card.dataset.su;
        if (t.closest("[data-su-edit]")) { st.editing[id] = true; paint(); paintRoll(); return; }
        if (t.closest("[data-su-cancel]")) { delete st.editing[id]; paint(); paintRoll(); return; }
        const send = t.closest("[data-su-send]");
        if (send) {
            const a = (n) => card.querySelector(`[data-a="${n}"]`).value;
            send.disabled = true;
            const x = await W.post(`/work/standup/${id}/answer`, { day: st.day, a1: a(1), a2: a(2), a3: a(3), blocker: card.querySelector("[data-blocker]").checked });
            send.disabled = false;
            if (!x.ok) { W.toast(x.d.error || "Not saved.", "error", "Stand-up"); return; }
            delete st.editing[id];
            W.toast(card.querySelector("[data-blocker]").checked ? "Posted. Your manager has been told you're blocked." : "Posted. Thanks!", "success", "☀ Stand-up");
            st.roll = id; st.rollDay = st.day;
            load(st.day);
        }
    });
    const onAnswered = (e) => {
        if (!document.body.contains(root)) { document.removeEventListener("sn:standup-answered", onAnswered); return; }
        if (e.detail && e.detail.id === st.roll && e.detail.day === st.rollDay) loadRoll();
    };
    document.addEventListener("sn:standup-answered", onAnswered);
    load();
})();
