// ShankhNaad · stand-in and "While you were away" (app bundle).
//  • Out of office window: "Who covers for you?" (saved after out of office is saved)
//  • A one-to-one chat with someone who is away and has a stand-in: "Neha Gupta is covering · Message Neha"
//  • Back from out of office (turned off, or its last day passed): a catch-up window
// Server: Controllers/AwayController.cs (48_StandIn.sql)
(function () {
    "use strict";
    const me = document.body && document.body.dataset.me;
    const SN = (window.SN = window.SN || {});
    if (!me || !SN.wk) return;
    const W = SN.wk, esc = W.esc;
    const S = () => window.Sahyog || {};
    const standIns = new Map();          // userId → { id, name, tone }
    const AWAY_KEY = "sn-away-since";

    async function load() {
        const x = await W.get("/away/standins");
        if (!x.ok || !Array.isArray(x.d)) return;
        standIns.clear();
        x.d.forEach((r) => standIns.set(r.userId, { id: r.standInId, name: r.standInName, tone: r.standInTone }));
        paintBar();
    }

    // =================================================================
    // the out-of-office window: "Who covers for you?"
    // =================================================================
    let pickedStandIn;            // undefined = untouched
    async function addField() {
        const dlg = document.querySelector(".sn-ooo-dlg");
        const left = dlg?.querySelector(".sn-ooo-left");
        if (!left) return;
        let box = left.querySelector(".sn-standin");
        if (!box) {
            box = document.createElement("div");
            box.className = "sn-standin";
            box.innerHTML = `<div class="sn-ooo-sec-h"><span class="sn-ooo-step"><i class="fa fa-handshake-o" aria-hidden="true"></i></span> <label for="oooStandIn">Who covers for you? <span class="muted">(optional)</span></label></div>
                <select id="oooStandIn" class="sn-standin-sel"><option value="">Nobody</option></select>
                <small class="sn-standin-hint">People who message you see “Ask them instead”, and requests to your roles go to them.</small>`;
            left.appendChild(box);
            box.querySelector("select").addEventListener("change", (e) => { pickedStandIn = e.target.value; });
        }
        const sel = box.querySelector("select");
        const people = (await (SN.nirnay?.people?.() || Promise.resolve([]))).filter((p) => p.id !== me);
        const cur = standIns.get(me)?.id || "";
        sel.innerHTML = `<option value="">Nobody</option>` + people.map((p) => `<option value="${esc(p.id)}"${p.id === cur ? " selected" : ""}>${esc(p.name)}${p.dept ? " · " + esc(p.dept) : ""}</option>`).join("");
        pickedStandIn = undefined;
    }
    function wrap() {
        if (SN.outOfOffice && !SN.outOfOffice.__standin) {
            const open = SN.outOfOffice;
            SN.outOfOffice = function () { const r = open.apply(this, arguments); setTimeout(addField, 30); return r; };
            SN.outOfOffice.__standin = true;
        }
        const s = S();
        if (s.saveOutOfOffice && !s.saveOutOfOffice.__standin) {
            const save = s.saveOutOfOffice;
            s.saveOutOfOffice = async function (args) {
                const r = await save.call(this, args);
                if (pickedStandIn !== undefined) {
                    const x = await W.post("/away/standin", { standInId: pickedStandIn || null });
                    if (x.ok) {
                        if (x.d.standInId) standIns.set(me, { id: x.d.standInId, name: x.d.standInName }); else standIns.delete(me);
                        if (x.d.standInName) W.toast(`${x.d.standInName} is covering for you.`, "success", "Stand-in");
                    } else W.toast(x.d.error || "Out of office is saved, but the stand-in wasn't.", "warn", "Stand-in");
                }
                remember();
                return r;
            };
            s.saveOutOfOffice.__standin = true;
        }
        if (s.setOutOfOffice && !s.setOutOfOffice.__away) {
            const set = s.setOutOfOffice;
            s.setOutOfOffice = async function (on) {
                const r = await set.apply(this, arguments);
                if (!on) setTimeout(checkBack, 800);
                return r;
            };
            s.setOutOfOffice.__away = true;
        }
    }

    // =================================================================
    // the bar in a chat with someone away who has a stand-in
    // =================================================================
    function paintBar() {
        const chat = document.getElementById("chat");
        const other = chat?.dataset.other;
        const composer = document.getElementById("composer");
        document.querySelectorAll(".sn-standin-bar").forEach((b) => { if (!other || b.dataset.for !== other) b.remove(); });
        if (!other || !composer) return;
        const away = S().oooOf?.(other);
        const cover = standIns.get(other);
        let bar = document.querySelector(".sn-standin-bar");
        if (!away || !cover || cover.id === me) { bar?.remove(); return; }
        if (!bar) { bar = document.createElement("div"); bar.className = "sn-standin-bar"; composer.parentElement.insertBefore(bar, composer); }
        bar.dataset.for = other;
        const until = away.untilUtc ? " until " + W.day(new Date(new Date(away.untilUtc) - 1)) : "";
        const name = (document.title || "").split(" · ")[0] || "They";
        bar.innerHTML = `<i class="fa fa-plane" aria-hidden="true"></i><span><b>${esc(name.split(" ")[0])}</b> is out of office${esc(until)}. <b>${esc(cover.name)}</b> is covering.</span>
            <button type="button" class="cee-btn sn-btn-light sn-btn-sm" data-standin-go="${esc(cover.id)}"><i class="fa fa-comment" aria-hidden="true"></i> Message ${esc(cover.name.split(" ")[0])}</button>`;
    }
    document.addEventListener("click", (e) => {
        const b = e.target.closest("[data-standin-go]");
        if (!b) return;
        // the same as starting a chat from the Team page: POST /chat/direct/{id} → the chat
        const f = document.createElement("form");
        f.method = "post"; f.action = `/chat/direct/${b.dataset.standinGo}`;
        f.innerHTML = `<input type="hidden" name="__RequestVerificationToken" value="${esc(W.token())}">`;
        document.body.appendChild(f);
        f.submit();
    });

    // =================================================================
    // "While you were away"
    // =================================================================
    function remember() {
        const o = S().oooOf?.(me);
        try {
            if (o) localStorage.setItem(AWAY_KEY, o.startUtc || o.sinceUtc || new Date().toISOString());
        } catch { }
    }
    let oooLoaded = false;        // the out-of-office list has arrived from the server (until then "not away" means "don't know")
    function checkBack() {
        if (!oooLoaded) return;
        let since = null;
        try { since = localStorage.getItem(AWAY_KEY); } catch { }
        if (S().oooOf?.(me)) { remember(); return; }
        if (!since) return;
        try { localStorage.removeItem(AWAY_KEY); } catch { }
        if (Date.now() - new Date(since) < 2 * 3600 * 1000) return;     // away for under two hours: nothing to catch up on
        openSummary(since);
    }
    async function openSummary(since) {
        const x = await W.get(`/away/summary?since=${encodeURIComponent(since)}`);
        if (!x.ok) { if (x.status !== 503) W.toast(x.d.error || "Couldn't load what you missed.", "warn"); return; }
        const d = x.d;
        const unread = d.chats.reduce((n, c) => n + (c.unreadCount || 0), 0);
        const sec = (title, n, body) => `<section class="sn-away-sec"><div class="sn-nir-lbl">${title} <span>${n}</span></div>${body}</section>`;
        const row = (icon, title, sub, href, extra) => `<a class="sn-away-row" href="${esc(href)}">${icon}<span><b>${title}</b>${sub ? `<small>${sub}</small>` : ""}</span>${extra || ""}</a>`;
        const html = `${W.head("fa-coffee", "Welcome back", `Here's what happened since ${esc(W.day(d.since))}`)}
        <div class="sn-dlg-body sn-away-body">
            <div class="sn-away-tiles">
                <div><b>${unread}</b><small>unread messages</small></div>
                <div><b>${d.decisions.length}</b><small>decisions</small></div>
                <div class="${d.actions.length ? "hot" : ""}"><b>${d.actions.length}</b><small>action items for you</small></div>
                <div><b>${d.meetings.length}</b><small>meetings you missed</small></div>
            </div>
            ${d.standIn && d.standIn.messages ? `<p class="sn-away-cover"><i class="fa fa-handshake-o" aria-hidden="true"></i> <b>${esc(d.standIn.standInName)}</b> covered for you and wrote ${d.standIn.messages} message${d.standIn.messages === 1 ? "" : "s"} in your chats.</p>` : ""}
            ${d.chats.length ? sec("Unread chats", d.chats.length, d.chats.map((c) => row(c.isDirect ? W.avatar(c.name, c.tone) : '<span class="avatar av-28 tone-0 group-avatar"><i class="fa fa-users"></i></span>',
                esc(c.name || "Chat"), W.ago(c.lastMessageUtc), `/chat/${c.channelId}`, `<span class="sn-away-n">${c.unreadCount}</span>`)).join("")) : ""}
            ${d.actions.length ? sec("Your action items", d.actions.length, d.actions.map((a) => row('<span class="sn-nir-cic act"><i class="fa fa-check-square-o"></i></span>',
                esc(a.title), [a.dueDate ? "due " + W.day(a.dueDate) : "", a.recordedByName ? "from " + esc(a.recordedByName) : ""].filter(Boolean).join(" · "), "/work/decisions?tab=mine")).join("")) : ""}
            ${d.decisions.length ? sec("Decisions", d.decisions.length, d.decisions.map((v) => row('<span class="sn-nir-cic"><i class="fa fa-balance-scale"></i></span>',
                esc(v.title), (v.messageId ? (v.channelIsDirect ? "a one-to-one chat" : esc(v.channelName || "a chat")) : v.meetingId ? esc(v.meetingTitle || "a meeting") : "Decisions page") + " · " + W.day(v.recordedUtc),
                v.messageId ? `/chat/${v.channelId}?m=${v.messageId}` : "/work/decisions")).join("")) : ""}
            ${d.meetings.length ? sec("Meetings you missed", d.meetings.length, d.meetings.map((m) => row('<span class="sn-away-mic"><i class="fa fa-calendar"></i></span>',
                esc(m.title), `${W.day(m.startUtc)}, ${W.time(m.startUtc)} · ${esc(m.hostName || "")}`, `/meetings/${m.meetingId}/view`)).join("")) : ""}
            ${!unread && !d.decisions.length && !d.actions.length && !d.meetings.length ? '<p class="sn-nir-empty">All quiet. Nothing waiting for you.</p>' : ""}
        </div>
        <div class="sn-dlg-foot"><span></span><button type="button" class="cee-btn cee-btn-gradient" data-close>Got it</button></div>`;
        const dlg = W.dialog("sn-away-dlg", html);
        dlg.addEventListener("click", (e) => { if (e.target.closest("a.sn-away-row")) dlg.close(); });
    }

    function hook() {
        const hub = S().hub;
        if (!hub || hook.done) return;
        hook.done = true;
        hub.on("StandIn", (userId, id, name) => { if (id) standIns.set(userId, { id, name }); else standIns.delete(userId); paintBar(); });
    }
    SN.away = { summary: openSummary, standIns };
    function init() {
        wrap();
        load();
        if (S().hub) hook(); else document.addEventListener("sahyog:connected", hook, { once: true });
    }
    document.addEventListener("sahyog:ooo", () => { oooLoaded = true; paintBar(); setTimeout(checkBack, 300); });
    document.addEventListener("sn:page", () => setTimeout(paintBar, 60));
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
