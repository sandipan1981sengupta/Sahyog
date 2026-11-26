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
    const st = { day: null, data: null, roll: Number(params.get("roll") || params.get("answer")) || null, rollDay: null, rollup: null };
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
        const d = st.data, answered = !!s.answeredUtc;
        const notToday = !runsOn(s, d.dow);
        const waiting = !answered && d.day === d.today && runsOn(s, d.dow) && d.nowMinutes < s.atMinutes;
        if (notToday && !answered) return `<article class="sn-su-card off"><header><b>${esc(s.name)}</b><small>${esc(daysText(s.days))} · ${timeText(s.atMinutes)}</small></header><p class="sn-nir-empty">No stand-up on ${esc(W.day(d.day))}.</p></article>`;
        const q = [s.q1, s.q2, s.q3], a = [s.a1, s.a2, s.a3];
        return `<article class="sn-su-card${answered ? " done" : ""}${s.hasBlocker ? " blocked" : ""}" data-su="${s.standupId}">
            <header><b>${esc(s.name)}</b><small>${esc(s.departmentName || "Everyone")} · ${esc(daysText(s.days))} at ${timeText(s.atMinutes)}</small>
                ${answered ? `<span class="sn-su-tag ok"><i class="fa fa-check" aria-hidden="true"></i> Answered ${esc(W.time(s.answeredUtc))}</span>` : waiting ? `<span class="sn-su-tag">Opens ${timeText(s.atMinutes)}</span>` : `<span class="sn-su-tag due">To answer</span>`}</header>
            ${answered ? q.map((t, i) => a[i] ? `<div class="sn-su-ans"><small>${esc(t)}</small><p>${esc(a[i])}</p></div>` : "").join("") : `<p class="sn-su-qs">${q.map(esc).join("<br>")}</p>`}
            <div class="sn-su-foot">${s.hasBlocker ? '<span class="sn-su-tag bad"><i class="fa fa-exclamation-triangle" aria-hidden="true"></i> Blocked: your manager knows</span>' : "<span></span>"}
                ${answered ? '<button type="button" class="sn-link" data-su-answer>Change</button>' : '<button type="button" class="cee-btn cee-btn-gradient" data-su-answer><i class="fa fa-pencil" aria-hidden="true"></i> Answer now</button>'}</div>
        </article>`;
    }
    function paint() {
        const d = st.data;
        const isToday = d.day === d.today;
        root.innerHTML = `<div class="sn-wk-cols sn-su">
            <section class="sn-wk-col glass" aria-label="Your stand-ups">
                <div class="sn-wk-colhead"><h2>Your stand-ups</h2>
                    ${W.dayPill("mine", d.day, d.today, { max: d.today })}</div>
                <div class="sn-su-mine">${d.mine.map(myCard).join("") || `<div class="sn-wk-empty"><i class="fa fa-sun-o" aria-hidden="true"></i><b>You're not in a stand-up yet</b>
                    <p>${d.canCreate ? "Set one up for your team: three questions at a time you choose." : "When your admin or department head sets one up, it shows here."}</p>
                    ${d.canCreate ? '<button type="button" class="sn-hbtn chat" data-su-new><i class="fa fa-plus"></i><span>New stand-up</span></button>' : ""}</div>`}</div>
            </section>
            <section class="sn-wk-col glass" aria-label="Team roll-up" id="suRoll"></section>
        </div>`;
        if (params.get("answer")) {
            const s = d.mine.find((x) => x.standupId === +params.get("answer"));
            params.delete("answer");
            if (s && !s.answeredUtc) setTimeout(() => answer(s), 100);
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
            <div class="sn-su-rollnav">${W.dayPill("roll", r.day, d.today, { max: d.today, attr: "rday" })}
                <small>${esc(s.departmentName || "Everyone")} · ${esc(daysText(s.days))} at ${timeText(s.atMinutes)}</small></div>
            ${!r.runsToday && !done.length ? `<p class="sn-nir-empty">No stand-up on this day.</p>` : `
            <div class="sn-shk-meter sn-su-meter"><div class="sn-shk-bar"><i style="width:${pct}%"></i></div><b>${done.length} of ${people.length} answered</b>${blocked.length ? `<span class="sn-su-tag bad">${blocked.length} blocked</span>` : ""}</div>
            ${blocked.length ? `<div class="sn-nir-lbl">Blockers <span>${blocked.length}</span></div>${blocked.map(ansCard).join("")}` : ""}
            ${done.length - blocked.length ? `<div class="sn-nir-lbl">Answers <span>${done.length - blocked.length}</span></div>${done.filter((p) => !p.hasBlocker).map(ansCard).join("")}` : ""}
            ${waiting.length ? `<div class="sn-nir-lbl">Not answered yet <span>${waiting.length}</span></div><div class="sn-su-waiting">${waiting.map((p) => `<span title="${esc(p.displayName)}">${W.avatar(p.displayName, p.avatarTone, p.userId, 28)}<small>${esc(p.displayName.split(" ")[0])}</small></span>`).join("")}</div>` : ""}`}`;
    }

    // ---------- the two windows (Views/Work/Standup.cshtml, tag-helper controls) ----------
    const C = W.ctl;
    const ansDlg = document.getElementById("suAnswerDlg"), editDlg = document.getElementById("suEditDlg");
    [ansDlg, editDlg].forEach((d) => { if (d) { C.wire(d); } });
    let answering = null, editing = null;

    function answer(s) {
        answering = s;
        ansDlg.querySelector("[data-su-title]").textContent = s.name;
        ansDlg.querySelector("[data-su-sub]").textContent = `${st.day === st.data.today ? "Today" : W.day(st.day)} · ${s.departmentName || "Everyone"}`;
        [1, 2, 3].forEach((n) => { C.label("suA" + n, s["q" + n]); C.set("suA" + n, s["a" + n] || ""); });
        C.set("suBlocked", !!s.hasBlocker);
        ansDlg.querySelector("[data-su-send] span").textContent = s.answeredUtc ? "Save" : "Post answers";
        C.open(ansDlg);
        setTimeout(() => ansDlg.querySelector("#suA1").focus(), 60);
    }
    ansDlg?.querySelector("[data-su-send]").addEventListener("click", async (e) => {
        const b = e.currentTarget, s = answering;
        if (!s) return;
        const a = [1, 2, 3].map((n) => C.get("suA" + n));
        if (!a.some(Boolean)) { W.toast("Write at least one answer.", "warn", "Stand-up"); return; }
        const blocked = !!C.get("suBlocked");
        b.disabled = true;
        const x = await W.post(`/work/standup/${s.standupId}/answer`, { day: st.day, a1: a[0], a2: a[1], a3: a[2], blocker: blocked });
        b.disabled = false;
        if (!x.ok) { W.toast(x.d.error || "Not saved.", "error", "Stand-up"); return; }
        ansDlg.close();
        W.toast(blocked ? "Posted. Your manager has been told you're blocked." : "Posted. Thanks!", "success", "☀ Stand-up");
        st.roll = s.standupId; st.rollDay = st.day;
        load(st.day);
    });

    function editor(s) {
        editing = s;
        const d = st.data;
        // the teams this person may set stand-ups up for
        const teams = (d.canEveryone ? [{ value: "", text: "Everyone in the workspace" }] : [])
            .concat((cfg.depts || []).filter((x) => (d.manageDepts || []).includes(x.id)).map((x) => ({ value: x.id, text: x.name })));
        C.options("suTeam", teams, s ? (s.departmentId || "") : teams[0]?.value);
        editDlg.querySelector("[data-su-etitle]").textContent = s ? "Change stand-up" : "New stand-up";
        C.set("suName", s ? s.name : "Daily stand-up");
        C.set("suAt", hm(s ? s.atMinutes : 600));
        const bits = s ? s.days : 31;
        for (let i = 0; i < 7; i++) C.set("suD" + i, !!(bits >> i & 1));
        ["What did you finish since the last stand-up?", "What are you working on today?", "Anything blocking you?"]
            .forEach((q, i) => C.set("suQ" + (i + 1), s ? s["q" + (i + 1)] : q));
        editDlg.querySelector("[data-su-activewrap]").hidden = !s;
        C.set("suActive", s ? s.isActive : true);
        const del = editDlg.querySelector("[data-su-del]");
        del.hidden = !s; delete del.dataset.armed; del.querySelector("span").textContent = "Delete";
        editDlg.querySelector("[data-su-save] span").textContent = s ? "Save" : "Start it";
        C.open(editDlg);
    }
    editDlg?.addEventListener("click", async (e) => {
        const s = editing;
        const del = e.target.closest("[data-su-del]");
        if (del && s) {
            if (!del.dataset.armed) { del.dataset.armed = "1"; del.querySelector("span").textContent = "Yes, delete it and its answers"; return; }
            const x = await W.post(`/work/standup/${s.standupId}/delete`);
            if (!x.ok) { W.toast(x.d.error || "Couldn't delete it.", "error"); return; }
            editDlg.close(); st.roll = null; load(st.day); return;
        }
        const save = e.target.closest("[data-su-save]");
        if (!save) return;
        const name = C.get("suName");
        if (!name) { window.validateModernInput?.("#suName"); W.toast("Give the stand-up a name.", "warn"); return; }
        const days = []; for (let i = 0; i < 7; i++) if (C.get("suD" + i)) days.push(i);
        if (!days.length) { W.toast("Pick at least one day.", "warn"); return; }
        save.disabled = true;
        const x = await W.post("/work/standup/save", {
            standupId: s ? s.standupId : 0, name, departmentId: C.get("suTeam") || null, days, at: C.get("suAt") || "10:00",
            q1: C.get("suQ1"), q2: C.get("suQ2"), q3: C.get("suQ3"), isActive: s ? !!C.get("suActive") : true
        });
        save.disabled = false;
        if (!x.ok) { W.toast(x.d.error || "Not saved.", "error", "Stand-up"); return; }
        editDlg.close(); st.roll = x.d.standupId;
        W.toast(s ? "Saved." : "Stand-up started. People get a reminder at its time.", "success", "☀ Stand-up");
        load(st.day);
    });

    root.addEventListener("click", async (e) => {
        const t = e.target;
        const dn = t.closest("[data-day]"); if (dn) { load(shift(st.day, +dn.dataset.day)); return; }
        const rd = t.closest("[data-rday]"); if (rd) { st.rollDay = shift(st.rollDay, +rd.dataset.rday); loadRoll(); return; }
        const dp = t.closest("[data-dp-open]");
        if (dp) {
            const roll = dp.dataset.dpOpen === "roll";
            W.dayPick("suDayPick", dp, {
                value: roll ? (st.rollup?.day || st.rollDay) : st.day, max: st.data.today,
                onPick: (iso) => { if (roll) { st.rollDay = iso; loadRoll(); } else load(iso); }
            });
            return;
        }
        const rl = t.closest("[data-roll]"); if (rl) { st.roll = +rl.dataset.roll; loadRoll(); paintRoll(); return; }
        if (t.closest("[data-su-new]")) { editor(null); return; }
        if (t.closest("[data-su-edit-roll]")) { editor(st.data.standups.find((s) => s.standupId === st.roll) || st.rollup.standup); return; }
        const card = t.closest("[data-su]");
        if (card && t.closest("[data-su-answer]")) answer(st.data.mine.find((s) => s.standupId === +card.dataset.su));
    });
    const onAnswered = (e) => {
        if (!document.body.contains(root)) { document.removeEventListener("sn:standup-answered", onAnswered); return; }
        if (e.detail && e.detail.id === st.roll && e.detail.day === st.rollDay) loadRoll();
    };
    document.addEventListener("sn:standup-answered", onAnswered);
    load();
})();
