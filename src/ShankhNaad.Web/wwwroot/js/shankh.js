// ---------- Shankh: an urgent alert that rings every screen until each person presses Seen ----------
// Everyone: a full-screen red card with a conch sound, on every page and every open device, until "Seen — I'm on it".
// Workspace admins: "Sound the Shankh" (top bar 🐚 and the profile menu) → who / what / kind / reminders,
// then a live board of who has seen it, with "Remind their managers now" and "Close alert for everyone".
// Server: Controllers/ShankhController.cs · reminders: Infrastructure/ShankhReminders.cs · database: 45_Shankh.sql
(function () {
    "use strict";
    const me = document.body && document.body.dataset.me;
    if (!me || !window.fetch) return;                              // super admin: no workspace
    const IS_ADMIN = document.body.dataset.admin === "1";
    const SN = (window.SN = window.SN || {});
    const S = () => window.Sahyog || {};
    const token = () => (S().antiforgery && S().antiforgery()) || document.querySelector('input[name="__RequestVerificationToken"]')?.value || "";
    const toast = (text, kind, title, extra) => S().toast?.(text, Object.assign({ kind: kind || "info", title }, extra || {}));
    const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const KIND = {
        outage: { icon: "🚨", name: "Outage" }, drill: { icon: "🔥", name: "Fire drill" },
        client: { icon: "📣", name: "Client issue" }, other: { icon: "⚠", name: "Alert" }
    };
    const kindOf = (k) => KIND[k] || KIND.other;
    const time = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }); };
    const ago = (iso) => {
        const s = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000));
        return s < 60 ? s + "s" : s < 3600 ? Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") : Math.floor(s / 3600) + " h";
    };
    const post = (url, body) => fetch(url, {
        method: "POST",
        headers: Object.assign({ "RequestVerificationToken": token(), Accept: "application/json" }, body ? { "Content-Type": "application/json" } : {}),
        body: body ? JSON.stringify(body) : undefined
    }).then((r) => r.json().catch(() => ({})).then((d) => ({ ok: r.ok, d })));

    // =================================================================
    // the conch sound (Web Audio; no file to download). Browsers only play sound after the person has
    // clicked or typed once on the page: until then the card still shows, without sound.
    // =================================================================
    let ac = null;
    const audio = () => {
        try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === "suspended") ac.resume(); } catch { ac = null; }
        return ac;
    };
    ["pointerdown", "keydown"].forEach((e) => document.addEventListener(e, () => audio(), { once: true, capture: true }));
    function conch() {
        const a = audio();
        if (!a || a.state !== "running") return;
        const now = a.currentTime + 0.02, len = 1.9;
        const filter = a.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(500, now);
        filter.frequency.linearRampToValueAtTime(1600, now + 0.7);
        filter.frequency.linearRampToValueAtTime(700, now + len);
        const gain = a.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.32, now + 0.55);
        gain.gain.setValueAtTime(0.32, now + 1.2);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + len);
        filter.connect(gain).connect(a.destination);
        // a low horn note that bends up, like a conch, with a softer octave above
        [[233.08, "sawtooth", 1], [466.16, "triangle", 0.35]].forEach(([f, type, v]) => {
            const o = a.createOscillator(), g = a.createGain();
            o.type = type;
            o.frequency.setValueAtTime(f * 0.94, now);
            o.frequency.exponentialRampToValueAtTime(f, now + 0.5);
            const vib = a.createOscillator(), vg = a.createGain();
            vib.frequency.value = 5.2; vg.gain.value = f * 0.006;
            vib.connect(vg).connect(o.frequency);
            g.gain.value = v;
            o.connect(g).connect(filter);
            o.start(now); vib.start(now);
            o.stop(now + len + 0.1); vib.stop(now + len + 0.1);
        });
    }

    // =================================================================
    // the ringing card
    // =================================================================
    const open = new Map();          // alertId → alert (still ringing on this screen)
    let box = null, soundTimer = 0, titleTimer = 0, baseTitle = document.title;
    function paint() {
        const list = [...open.values()].sort((a, b) => new Date(b.sentUtc) - new Date(a.sentUtc));
        if (!list.length) { stopRing(); return; }
        const a = list[0], k = kindOf(a.kind);
        if (!box) {
            box = document.createElement("div");
            box.className = "sn-shankh";
            box.setAttribute("role", "alertdialog");
            box.setAttribute("aria-modal", "true");
            box.setAttribute("aria-labelledby", "snShankhT");
            document.body.appendChild(box);
            box.addEventListener("click", (e) => { if (e.target.closest("[data-shankh-seen]")) seen(e.target.closest("[data-shankh-seen]").dataset.shankhSeen); });
            requestAnimationFrame(() => box && box.classList.add("in"));
        }
        box.innerHTML = `
            <div class="sn-shankh-card">
                <div class="sn-shankh-pulse" aria-hidden="true">🐚</div>
                <small class="sn-shankh-kind">SHANKH · URGENT · ${esc(k.name.toUpperCase())} · from ${esc(a.senderName)}</small>
                <h2 id="snShankhT">${k.icon} ${esc(a.body.split("\n")[0])}</h2>
                ${a.body.includes("\n") ? `<p>${esc(a.body.split("\n").slice(1).join("\n")).replace(/\n/g, "<br>")}</p>` : ""}
                <button type="button" class="sn-shankh-seen" data-shankh-seen="${esc(a.alertId)}"><i class="fa fa-check" aria-hidden="true"></i> Seen — I'm on it</button>
                <span class="sn-shankh-sub">Sent ${esc(time(a.sentUtc))} to ${esc(a.audience)} · it rings until you press Seen${list.length > 1 ? ` · ${list.length - 1} more after this` : ""}</span>
            </div>`;
        box.querySelector(".sn-shankh-seen")?.focus({ preventScroll: true });
        startRing(a);
    }
    function startRing(a) {
        if (!soundTimer) { conch(); soundTimer = setInterval(conch, 3800); }
        if (!titleTimer) {
            let on = false;
            titleTimer = setInterval(() => { on = !on; document.title = on ? "🐚 URGENT · " + (a.body.slice(0, 40)) : baseTitle; }, 900);
        }
        if (navigator.vibrate) try { navigator.vibrate([400, 200, 400]); } catch { }
        if (document.hidden && "Notification" in window && Notification.permission === "granted") {
            try {
                const n = new Notification("🐚 URGENT: " + a.body.slice(0, 80), { body: "From " + a.senderName + ". Open ShankhNaad and press Seen.", tag: "shankh-" + a.alertId, requireInteraction: true });
                n.onclick = () => { window.focus(); n.close(); };
            } catch { }
        }
    }
    function stopRing() {
        clearInterval(soundTimer); soundTimer = 0;
        clearInterval(titleTimer); titleTimer = 0;
        document.title = baseTitle;
        if (box) { const b = box; box = null; b.classList.remove("in"); setTimeout(() => b.remove(), 300); }
    }
    function ring(alert) {
        if (!alert || !alert.alertId || alert.senderId === me) return;
        if (!open.size) baseTitle = document.title;
        open.set(String(alert.alertId), alert);
        paint();
    }
    function drop(id) { if (open.delete(String(id))) paint(); }
    async function seen(id) {
        const btn = box && box.querySelector(".sn-shankh-seen");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa fa-circle-o-notch fa-spin" aria-hidden="true"></i> Sending…'; }
        let x = null;
        try { x = await post(`/shankh/${encodeURIComponent(id)}/seen`); } catch { }
        if (!x || !x.ok) {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa fa-check" aria-hidden="true"></i> Seen — I\'m on it'; }
            toast("That didn't go through. Check your connection and press Seen again.", "error", "Shankh");
            return;
        }
        drop(id);
        toast("Thanks. The sender can see you've seen it.", "success", "Shankh");
    }

    // =================================================================
    // admins: "Sound the Shankh"
    // =================================================================
    let sendDlg = null, audienceData = null;
    async function openSend() {
        if (!IS_ADMIN) return;
        try { audienceData = await (await fetch("/shankh/audience", { headers: { Accept: "application/json" } })).json(); }
        catch { toast("Couldn't load your team. Try again.", "error", "Shankh"); return; }
        let recent = [];
        try { recent = await (await fetch("/shankh/recent", { headers: { Accept: "application/json" } })).json(); } catch { }
        if (!sendDlg) {
            sendDlg = document.createElement("dialog");
            sendDlg.className = "sn-dialog glass-strong sn-shankh-dlg";
            sendDlg.setAttribute("aria-labelledby", "snShankhSendT");
            document.body.appendChild(sendDlg);
        }
        const st = { to: "all", dept: null, people: new Set(), kind: "outage", remind: 5, email: true, q: "", armed: false };
        const d = audienceData;
        const deptChips = () => d.departments.map((x) => `<button type="button" class="sn-shk-chip${st.dept === x.id ? " on" : ""}" data-dept="${esc(x.id)}">${esc(x.name)} <span>${x.count}</span></button>`).join("") || '<span class="muted small">No departments yet (Org page).</span>';
        const peopleRows = () => d.people.filter((p) => !st.q || (p.name + " " + p.dept + " " + p.title).toLowerCase().includes(st.q))
            .map((p) => `<label class="sn-shk-person"><input type="checkbox" data-person="${esc(p.id)}"${st.people.has(p.id) ? " checked" : ""}> <span class="sn-shk-av t${p.tone % 8}">${esc(p.initials)}</span><span><b>${esc(p.name)}</b><small>${esc([p.title, p.dept].filter(Boolean).join(" · "))}</small></span></label>`).join("");
        const count = () => st.to === "all" ? d.everyone : st.to === "dept" ? (d.departments.find((x) => x.id === st.dept)?.count || 0) : st.people.size;
        function render() {
            const n = count();
            sendDlg.innerHTML = `
            <form method="dialog" novalidate>
            <div class="sn-dlg-head">
                <div class="sn-dlg-title"><span class="sn-dlg-icon sn-shk-ic" aria-hidden="true">🐚</span>
                    <div><h2 id="snShankhSendT">Sound the Shankh</h2><p>Rings every screen until each person presses Seen. For real emergencies only.</p></div></div>
                <button type="button" class="sn-close" data-close aria-label="Close"><i class="fa fa-times" aria-hidden="true"></i></button>
            </div>
            <div class="sn-dlg-body sn-shk-body">
                <div class="sn-field-label">Who</div>
                <div class="sn-shk-seg" role="radiogroup">
                    ${[["all", `Everyone · ${d.everyone}`], ["dept", "A department"], ["people", "Pick people"]].map(([k, t]) => `<button type="button" role="radio" aria-checked="${st.to === k}" class="${st.to === k ? "on" : ""}" data-to="${k}">${t}</button>`).join("")}
                </div>
                ${st.to === "dept" ? `<div class="sn-shk-chips">${deptChips()}</div>` : ""}
                ${st.to === "people" ? `<label class="sn-shk-search"><i class="fa fa-search" aria-hidden="true"></i><input type="search" placeholder="Search by name, title or department" value="${esc(st.q)}" data-q></label><div class="sn-shk-people sn-glass-scroll">${peopleRows()}</div>` : ""}
                <label class="sn-field-label" for="shkBody">Message</label>
                <textarea id="shkBody" class="sn-textarea" rows="3" maxlength="1000" placeholder="What's happening, and what should people do? E.g. Client portal is down. Engineering: join the bridge now.">${esc(st.body || "")}</textarea>
                <div class="sn-field-label">Kind</div>
                <div class="sn-shk-kinds">${Object.entries(KIND).map(([k, v]) => `<button type="button" class="sn-shk-kind${st.kind === k ? " on" : ""}" data-kind="${k}">${v.icon} ${v.name}</button>`).join("")}</div>
                <div class="sn-shk-opts">
                    <label>Remind their managers if not seen in
                        <select data-remind>${[[0, "never"], [2, "2 minutes"], [5, "5 minutes"], [10, "10 minutes"], [15, "15 minutes"]].map(([v, t]) => `<option value="${v}"${st.remind === v ? " selected" : ""}>${t}</option>`).join("")}</select></label>
                    <label class="sn-shk-ck"><input type="checkbox" data-email${st.email ? " checked" : ""}> Also send an email (for anyone not in ShankhNaad right now)</label>
                </div>
                ${recent.length ? `<details class="sn-shk-recent"><summary>Recent alerts (${recent.length})</summary>${recent.slice(0, 6).map((r) => `<button type="button" class="sn-shk-rec" data-board="${esc(r.alertId)}"><span>${kindOf(r.kind).icon}</span><span><b>${esc(r.body.slice(0, 70))}</b><small>${esc(new Date(r.sentUtc).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))} · ${esc(r.audience)} · ${r.seen} of ${r.people - 1 < 0 ? 0 : r.people - 1} seen${r.closedUtc ? " · closed" : ""}</small></span></button>`).join("")}</details>` : ""}
            </div>
            <div class="sn-dlg-foot">
                <span class="muted small">${n ? `${n} ${n === 1 ? "person" : "people"} will be rung` : "Pick who to ring"}</span>
                <span style="display:flex;gap:10px;margin-left:auto">
                    <button type="button" class="cee-btn sn-btn-light" data-close>Cancel</button>
                    <button type="button" class="cee-btn sn-shk-go${st.armed ? " armed" : ""}" data-go${n ? "" : " disabled"}>🐚 ${st.armed ? `Yes, ring ${n} ${n === 1 ? "person" : "people"} now` : "Sound the Shankh"}</button>
                </span>
            </div></form>`;
            const ta = sendDlg.querySelector("#shkBody");
            ta.addEventListener("input", () => { st.body = ta.value; });
            const qi = sendDlg.querySelector("[data-q]");
            if (qi) qi.addEventListener("input", () => { st.q = qi.value.trim().toLowerCase(); const pos = qi.selectionStart; render(); const q2 = sendDlg.querySelector("[data-q]"); q2.focus(); q2.setSelectionRange(pos, pos); });
        }
        sendDlg.onclick = async (e) => {
            const t = e.target;
            if (t.closest("[data-close]")) { sendDlg.close(); return; }
            const to = t.closest("[data-to]"); if (to) { st.to = to.dataset.to; st.armed = false; render(); return; }
            const dp = t.closest("[data-dept]"); if (dp) { st.dept = dp.dataset.dept; st.armed = false; render(); return; }
            const kd = t.closest("[data-kind]"); if (kd) { st.kind = kd.dataset.kind; render(); return; }
            const bd = t.closest("[data-board]"); if (bd) { sendDlg.close(); openBoard(bd.dataset.board); return; }
            const go = t.closest("[data-go]");
            if (go) {
                st.body = (sendDlg.querySelector("#shkBody").value || "").trim();
                if (!st.body) { toast("Write what's happening and what people should do.", "warn", "Shankh"); sendDlg.querySelector("#shkBody").focus(); return; }
                if (!st.armed) { st.armed = true; render(); setTimeout(() => { if (st.armed && sendDlg.open) { st.armed = false; render(); } }, 5000); return; }
                go.disabled = true;
                const x = await post("/shankh/send", {
                    kind: st.kind, body: st.body, to: st.to, departmentId: st.dept, people: [...st.people],
                    remindAfter: st.remind || null, email: st.email
                });
                if (!x.ok) { st.armed = false; render(); toast(x.d.error || "Not sent. Try again.", "error", "Shankh"); return; }
                sendDlg.close();
                toast(`Ringing ${x.d.people} ${x.d.people === 1 ? "person" : "people"}.${x.d.mailed ? ` Email sent to ${x.d.mailed}.` : ""}${x.d.mailNote ? " " + x.d.mailNote : ""}`, "success", "Shankh sounded");
                openBoard(x.d.alertId);
            }
        };
        sendDlg.onchange = (e) => {
            const t = e.target;
            if (t.matches("[data-person]")) { t.checked ? st.people.add(t.dataset.person) : st.people.delete(t.dataset.person); st.armed = false; render(); }
            if (t.matches("[data-remind]")) st.remind = +t.value;
            if (t.matches("[data-email]")) st.email = t.checked;
        };
        render();
        if (!sendDlg.open) sendDlg.showModal();
        setTimeout(() => sendDlg.querySelector("#shkBody")?.focus(), 60);
    }

    // =================================================================
    // the live board
    // =================================================================
    let boardDlg = null, board = null, boardFilter = "waiting", boardTick = 0;
    async function openBoard(id) {
        let d = null;
        try { const r = await fetch(`/shankh/${encodeURIComponent(id)}`, { headers: { Accept: "application/json" } }); d = r.ok ? await r.json() : null; } catch { }
        if (!d) { toast("Couldn't open the board.", "error", "Shankh"); return; }
        board = d;
        boardFilter = d.total - d.seen > 0 ? "waiting" : "all";
        if (!boardDlg) {
            boardDlg = document.createElement("dialog");
            boardDlg.className = "sn-dialog glass-strong sn-shankh-dlg sn-shk-board";
            boardDlg.setAttribute("aria-labelledby", "snShkBoardT");
            document.body.appendChild(boardDlg);
            boardDlg.addEventListener("close", () => { clearInterval(boardTick); board = null; });
            boardDlg.addEventListener("click", async (e) => {
                const t = e.target;
                if (t.closest("[data-close]")) { boardDlg.close(); return; }
                const f = t.closest("[data-f]"); if (f) { boardFilter = f.dataset.f; paintBoard(); return; }
                if (t.closest("[data-remind-now]") && board) {
                    const x = await post(`/shankh/${board.alert.alertId}/remind`);
                    toast(x.ok ? `Rang ${x.d.rang} again${x.d.managers ? ` and told ${x.d.managers} ${x.d.managers === 1 ? "manager" : "managers"}` : ""}.` : (x.d.error || "Didn't work."), x.ok ? "success" : "error", "Shankh");
                }
                if (t.closest("[data-close-alert]") && board) {
                    const x = await post(`/shankh/${board.alert.alertId}/close`);
                    if (x.ok) { board.alert.closedUtc = new Date().toISOString(); paintBoard(); toast("Closed. It stopped ringing everywhere.", "success", "Shankh"); }
                }
            });
        }
        clearInterval(boardTick);
        boardTick = setInterval(() => board && paintBoard(true), 1000);
        paintBoard();
        if (!boardDlg.open) boardDlg.showModal();
    }
    function paintBoard(timesOnly) {
        if (!board || !boardDlg) return;
        const a = board.alert, k = kindOf(a.kind);
        const waiting = board.people.filter((p) => !p.seenUtc), seenN = board.people.length - waiting.length;
        const pct = board.people.length ? Math.round(seenN * 100 / board.people.length) : 100;
        if (timesOnly) { const el = boardDlg.querySelector("[data-elapsed]"); if (el) el.textContent = ago(a.sentUtc); return; }
        const list = board.people.filter((p) => boardFilter === "all" || (boardFilter === "waiting" ? !p.seenUtc : !!p.seenUtc));
        const row = (p) => `<div class="sn-shk-row${p.seenUtc ? "" : " waiting"}"><span class="sn-shk-av t${p.tone % 8}">${esc(p.initials)}</span>
            <span class="sn-shk-who"><b>${esc(p.name)}</b><small>${esc(p.dept || "")}</small></span>
            ${p.seenUtc ? `<span class="sn-shk-ok">✓ Seen · ${esc(time(p.seenUtc))}</span>`
                : `<span class="sn-shk-wait">${a.closedUtc ? "Not seen" : "Ringing…"}</span>${p.manager ? `<small class="sn-shk-mgr">${p.remindedUtc ? "Reminded " : "Manager: "}${esc(p.manager)}</small>` : ""}`}</div>`;
        boardDlg.innerHTML = `
            <div class="sn-dlg-head">
                <div class="sn-dlg-title"><span class="sn-dlg-icon sn-shk-ic" aria-hidden="true">📋</span>
                    <div><h2 id="snShkBoardT">${k.icon} ${esc(a.body.split("\n")[0].slice(0, 90))}</h2><p>Shankh board · sent ${esc(time(a.sentUtc))} by ${esc(a.senderName)} to ${esc(a.audience)}${a.closedUtc ? " · <b>closed</b>" : " · live"}</p></div></div>
                <button type="button" class="sn-close" data-close aria-label="Close"><i class="fa fa-times" aria-hidden="true"></i></button>
            </div>
            <div class="sn-dlg-body sn-shk-body">
                <div class="sn-shk-meter"><div class="sn-shk-bar"><i style="width:${pct}%"></i></div><b>${seenN} of ${board.people.length} seen</b><small>${pct}% · <span data-elapsed>${esc(ago(a.sentUtc))}</span></small></div>
                <div class="sn-shk-filters">
                    <button type="button" class="sn-shk-chip${boardFilter === "waiting" ? " on" : ""}" data-f="waiting">Not seen <span>${waiting.length}</span></button>
                    <button type="button" class="sn-shk-chip${boardFilter === "seen" ? " on" : ""}" data-f="seen">Seen <span>${seenN}</span></button>
                    <button type="button" class="sn-shk-chip${boardFilter === "all" ? " on" : ""}" data-f="all">Everyone <span>${board.people.length}</span></button>
                </div>
                <div class="sn-shk-list sn-glass-scroll">${list.map(row).join("") || `<p class="sn-shk-empty">${boardFilter === "waiting" ? "🎉 Everyone has seen it." : "Nobody here yet."}</p>`}</div>
            </div>
            <div class="sn-dlg-foot">
                <span class="sn-shk-foot">
                    ${a.closedUtc ? `<button type="button" class="cee-btn sn-btn-light" data-close>Close</button>` : `
                    <button type="button" class="cee-btn sn-btn-light" data-remind-now title="Rings everyone who has not seen it again and tells their managers"${waiting.length ? "" : " disabled"}>Ring again</button>
                    <button type="button" class="cee-btn cee-btn-gradient" data-close-alert>Close for everyone</button>`}
                </span>
            </div>`;
    }

    // =================================================================
    // admins: the 🐚 button in the top bar, and "Sound the Shankh" in the profile menu
    // =================================================================
    function addAdminButtons() {
        if (!IS_ADMIN) return;
        const theme = document.querySelector(".sn-theme-btn");
        if (theme && !document.querySelector(".sn-shankh-btn")) {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "sn-shankh-btn";
            b.title = "Sound the Shankh: an urgent alert that rings everyone's screen";
            b.setAttribute("aria-label", "Sound the Shankh (urgent alert)");
            b.innerHTML = '<span aria-hidden="true">🐚</span>';
            b.addEventListener("click", openSend);
            theme.parentNode.insertBefore(b, theme);
        }
        const dd = document.querySelector(".strip-user-dropdown[data-strip-user-dropdown]");
        if (dd && !dd.querySelector("[data-strip-action='shankh']")) {
            const item = document.createElement("div");
            item.className = "strip-user-dropdown-item sn-shankh-item";
            item.setAttribute("data-strip-action", "shankh");
            item.setAttribute("role", "menuitem");
            item.innerHTML = '<span aria-hidden="true" style="width:18px;text-align:center;font-size:15px">🐚</span><span>Sound the Shankh</span>';
            dd.insertBefore(item, dd.querySelector("[data-strip-action='logout']"));
        }
    }
    document.addEventListener("strip-header:action", (e) => { if (e.target === document && e.detail && e.detail.action === "shankh") openSend(); });
    SN.shankh = { send: openSend, board: openBoard, ring, get open() { return [...open.values()]; } };

    // =================================================================
    // live messages
    // =================================================================
    function hook() {
        const hub = S().hub;
        if (!hub || hook.done) return;
        hook.done = true;
        hub.on("Shankh", ring);
        hub.on("ShankhClosed", (id) => {
            drop(id);
            if (board && String(board.alert.alertId) === String(id) && !board.alert.closedUtc) { board.alert.closedUtc = new Date().toISOString(); paintBoard(); }
        });
        hub.on("ShankhSeen", (id, userId, seenUtc) => {
            if (!board || String(board.alert.alertId) !== String(id)) return;
            const p = board.people.find((x) => String(x.id) === String(userId));
            if (p && !p.seenUtc) { p.seenUtc = seenUtc; paintBoard(); }
        });
        hub.on("ShankhReminded", (id, ids) => {
            if (!board || String(board.alert.alertId) !== String(id)) return;
            ids.forEach((uid) => { const p = board.people.find((x) => String(x.id) === String(uid)); if (p) p.remindedUtc = new Date().toISOString(); });
            paintBoard();
        });
        hub.on("ShankhRemind", (id, names, body) => {
            const who = names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
            toast(`${who} ${names.length === 1 ? "hasn't" : "haven't"} seen the urgent alert: “${String(body).slice(0, 90)}”. Please check on them.`, "warn", "🐚 Shankh: your team", { ms: 20000 });
        });
        // after a reconnect, catch up on anything that rang while offline
        hub.onreconnected?.(() => loadOpen());
    }
    async function loadOpen() {
        try {
            const r = await fetch("/shankh/open", { headers: { Accept: "application/json" } });
            if (!r.ok) return;
            (await r.json()).forEach(ring);
        } catch { }
    }
    function init() {
        addAdminButtons();
        loadOpen();
        if (S().hub) hook(); else document.addEventListener("sahyog:connected", hook, { once: true });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
