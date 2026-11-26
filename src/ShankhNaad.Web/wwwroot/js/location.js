// ---------- team location (only for companies the super admin switched it on for) ----------
// Each person decides: a card asks once ("Share your location with your team?"), and the user menu
// has "Share my location: on / off" at any time. While sharing, this browser checks in now and then:
// office or remote (from the internet address), plus a map position if the browser allows it.
// Only the latest location is kept on the server.
(function () {
    "use strict";
    const SN = (window.SN = window.SN || {});
    const me = document.body && document.body.dataset.me;
    if (!me || !window.fetch) return;                 // super admin: no workspace

    const EVERY = 10 * 60 * 1000;                     // a check-in every 10 minutes while a page is open
    const LAST = "sn-loc-last";                       // (shared by all tabs: one check-in for all of them)
    let state = null, timer = 0;
    const token = () => (window.Sahyog && Sahyog.antiforgery && Sahyog.antiforgery())
        || document.querySelector('input[name="__RequestVerificationToken"]')?.value || "";
    const toast = (text, kind, title) => window.Sahyog?.toast?.(text, { kind: kind || "info", title });

    // Why the last attempt gave no map position: "denied" (blocked for this site), "unavailable" (the computer
    // can't tell: e.g. Windows location switched off), "timeout", "unsupported", or null (it worked).
    let lastError = null;
    const position = () => new Promise((resolve) => {
        if (!navigator.geolocation || !window.isSecureContext) { lastError = "unsupported"; resolve(null); return; }
        const ok = (p) => { lastError = null; resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }); };
        const code = (e) => (e && e.code === 1 ? "denied" : e && e.code === 3 ? "timeout" : "unavailable");
        navigator.geolocation.getCurrentPosition(ok, (e) => {
            if (e && e.code === 1) { lastError = "denied"; resolve(null); return; }
            // no precise fix (desktops have no GPS): try again the quick way, from Wi-Fi / the network
            navigator.geolocation.getCurrentPosition(ok, (e2) => { lastError = code(e2); resolve(null); },
                { enableHighAccuracy: false, timeout: 20000, maximumAge: 30 * 60 * 1000 });
        }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 5 * 60 * 1000 });
    });
    /** What to tell the person when there's no map position (null when there's nothing to fix). */
    const mac = /Mac/.test(navigator.platform || navigator.userAgent);
    const howToFix = () => ({
        denied: "Your browser is blocking location for this site. Click the lock icon left of the web address → Location → Allow, then reload the page.",
        unavailable: mac
            ? "Your Mac couldn't find its location. Turn it on in System Settings → Privacy & Security → Location Services (also for your browser), then press Update my location now."
            : "Your computer couldn't find its location. On Windows: Settings → Privacy & security → Location → turn on Location services and \"Let desktop apps access your location\", then press Update my location now.",
        timeout: "Finding your location took too long. Press Update my location now to try again.",
        unsupported: "This browser can't share a map position here (it needs a secure https address). In office / Remote still works."
    })[lastError] || null;

    /** Sends a check-in. force: even if another tab did one a moment ago. */
    async function checkIn(force) {
        if (!state || !state.enabled || state.sharing !== true) return null;
        try {
            const last = Number(localStorage.getItem(LAST) || 0);
            if (!force && Date.now() - last < EVERY - 30000) return null;
            localStorage.setItem(LAST, String(Date.now()));
        } catch { }
        const pos = await position();
        try {
            const r = await fetch("/location/check-in", {
                method: "POST",
                headers: { "Content-Type": "application/json", "RequestVerificationToken": token() },
                body: JSON.stringify(pos || {})
            });
            const d = r.ok ? await r.json() : null;
            return d ? Object.assign(d, { position: !!pos, problem: howToFix() }) : null;
        } catch { return null; }
    }

    async function setSharing(on) {
        const fd = new FormData();
        fd.append("on", on ? "true" : "false");
        const r = await fetch("/location/sharing", { method: "POST", body: fd, headers: { "RequestVerificationToken": token() } });
        if (!r.ok) { toast("That didn't work. Try again.", "error", "Location"); return false; }
        state.sharing = on;
        paintMenu();
        closeAsk();
        if (on) {
            toast("You're sharing your location with your team. Turn it off any time in your menu (top right).", "success", "Location");
            checkIn(true);
            start();
        } else {
            stop();
            toast("You're not sharing your location. Nothing about where you are is stored.", "info", "Location");
        }
        return true;
    }
    SN.location = { checkIn, setSharing, howToFix, showMyData: () => showMyData(), get state() { return state; }, get lastError() { return lastError; } };

    const start = () => { clearInterval(timer); timer = setInterval(() => { if (!document.hidden) checkIn(false); }, 60 * 1000); };
    const stop = () => clearInterval(timer);

    // ---- the one-time question ----
    let ask = null;
    function closeAsk() { if (!ask) return; ask.classList.remove("in"); const a = ask; ask = null; setTimeout(() => a.remove(), 300); }
    function showAsk() {
        try { if (sessionStorage.getItem("sn-loc-later")) return; } catch { }
        ask = document.createElement("div");
        ask.className = "sn-loc-ask glass-strong";
        ask.setAttribute("role", "dialog");
        ask.setAttribute("aria-labelledby", "snLocAskT");
        ask.innerHTML = `
            <span class="sn-loc-ask-ic" aria-hidden="true"><i class="bi bi-geo-alt-fill"></i></span>
            <div class="sn-loc-ask-txt">
                <b id="snLocAskT">Share your location with your team?</b>
                <p>Your company uses team location in ShankhNaad. If you agree, your team sees whether you're <b>in the office or remote</b> and your <b>city</b>; your workspace admins also see it on a map.</p>
                <details class="sn-loc-notice">
                    <summary>What exactly is shared, and for how long</summary>
                    <ul>
                        <li><b>What:</b> your internet address (to tell office from remote) and, if your browser allows it, your map position and the address it points to.</li>
                        <li><b>Why:</b> so colleagues know whether you're in the office or working remotely.</li>
                        <li><b>Who sees it:</b> everyone in your company sees <i>In office / Remote</i> and your city; only workspace admins (and you) see the map and street address.</li>
                        <li><b>How long:</b> only your latest location is kept. It is erased automatically if it isn't refreshed for <b>${days()} days</b>, and straight away when you stop sharing.</li>
                        <li><b>Your choice:</b> saying no changes nothing else in ShankhNaad. You can change your mind any time from your menu (top right), where <i>My location data</i> shows everything stored about you.</li>
                    </ul>
                </details>
                <small>Only your latest location is kept, for ${days()} days at most. You can stop any time from your menu (top right).</small>
                <div class="sn-loc-ask-acts">
                    <button type="button" class="cee-btn cee-btn-gradient" data-a="yes"><i class="bi bi-geo-alt" aria-hidden="true"></i> Share my location</button>
                    <button type="button" class="cee-btn sn-btn-light" data-a="later">Not now</button>
                    <button type="button" class="sn-link" data-a="no">Don't share</button>
                </div>
            </div>`;
        document.body.appendChild(ask);
        requestAnimationFrame(() => ask && ask.classList.add("in"));
        ask.addEventListener("click", (e) => {
            const a = e.target.closest("[data-a]")?.dataset.a;
            if (a === "yes") setSharing(true);
            else if (a === "no") setSharing(false);
            else if (a === "later") { try { sessionStorage.setItem("sn-loc-later", "1"); } catch { } closeAsk(); }
        });
    }

    const days = () => (state && state.retentionDays) || 30;
    const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const when = (iso) => {
        if (!iso) return "—";
        const d = new Date(iso);
        return isNaN(d) ? "—" : d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    };

    // ---- "My location data": everything stored about me, my yes / no, and when it will be erased ----
    let dataDlg = null;
    async function showMyData() {
        let d = null;
        try { const r = await fetch("/location/mine", { headers: { Accept: "application/json" } }); d = r.ok ? await r.json() : null; } catch { }
        if (!d) { toast("Couldn't load your location data. Try again.", "error", "Location"); return; }
        if (!dataDlg) {
            dataDlg = document.createElement("dialog");
            dataDlg.className = "sn-dialog glass-strong sn-loc-data";
            dataDlg.setAttribute("aria-labelledby", "snLocDataT");
            document.body.appendChild(dataDlg);
            dataDlg.addEventListener("click", async (e) => {
                if (e.target === dataDlg || e.target.closest("[data-close]")) { dataDlg.close(); return; }
                const a = e.target.closest("[data-loc]")?.dataset.loc;
                if (a === "stop" && await setSharing(false)) dataDlg.close();
                if (a === "start" && await setSharing(true)) dataDlg.close();
            });
        }
        const sharing = d.sharing === true;
        const rows = [];
        const row = (label, value) => rows.push(`<div class="sn-loc-kv"><span>${label}</span><b>${value}</b></div>`);
        row("Your choice", sharing ? "Sharing" : d.sharing === false ? "Not sharing" : "Not decided yet");
        if (d.decidedUtc) row("Decided on", esc(when(d.decidedUtc)) + (d.noticeSeen ? ` · notice ${esc(d.noticeSeen)}` : ""));
        if (d.stored) {
            row("Office or remote", d.inOffice === true ? "In office" : d.inOffice === false ? "Remote" : "—");
            row("Internet address", esc(d.ip || "—"));
            row("City", esc([d.city, d.region, d.country].filter(Boolean).join(", ") || "—"));
            row("Street address", esc(d.address || "—"));
            row("Map position", d.lat != null ? `${Number(d.lat).toFixed(5)}, ${Number(d.lng).toFixed(5)}${d.accuracyM ? ` (± ${d.accuracyM} m)` : ""}` : "—");
            row("Map position taken", esc(when(d.preciseUtc)));
            row("Last check-in", esc(when(d.seenUtc)));
            row("Erased automatically on", esc(when(d.erasedOnUtc)) + " <small>(unless it's refreshed)</small>");
        }
        dataDlg.innerHTML = `
            <div class="sn-dlg-head">
                <div class="sn-dlg-title"><span class="sn-dlg-icon"><i class="bi bi-shield-lock-fill" aria-hidden="true"></i></span>
                    <div><h2 id="snLocDataT">My location data</h2><p>Everything ShankhNaad keeps about where you are.</p></div></div>
                <button type="button" class="sn-close" data-close aria-label="Close"><i class="fa fa-times" aria-hidden="true"></i></button>
            </div>
            <div class="sn-dlg-body">
                ${d.stored ? "" : `<p class="sn-loc-none"><i class="bi bi-check-circle-fill" aria-hidden="true"></i> Nothing about where you are is stored right now.</p>`}
                <div class="sn-loc-kvs">${rows.join("")}</div>
                <p class="sn-hint"><i class="fa fa-info-circle" aria-hidden="true"></i> Only your latest location is kept. Your company keeps it for <b>${d.retentionDays} days</b> without a new check-in, then it's erased. Stopping erases it straight away; your yes / no and its date are kept as a record of your choice.</p>
            </div>
            <div class="sn-dlg-foot">
                <span style="display:flex;gap:10px;margin-left:auto">
                    <button type="button" class="cee-btn sn-btn-light" data-close>Close</button>
                    ${sharing
                ? `<button type="button" class="cee-btn sn-btn-danger-soft" data-loc="stop"><i class="bi bi-geo-alt" aria-hidden="true"></i> Stop sharing and erase</button>`
                : `<button type="button" class="cee-btn cee-btn-gradient" data-loc="start"><i class="bi bi-geo-alt-fill" aria-hidden="true"></i> Share my location</button>`}
                </span>
            </div>`;
        if (!dataDlg.open) dataDlg.showModal();
    }

    // ---- "Share my location" in the user menu ----
    function paintMenu() {
        const dd = document.querySelector(".strip-user-dropdown[data-strip-user-dropdown]");
        if (!dd || !state || !state.enabled) return;
        let item = dd.querySelector("[data-strip-action='location']");
        if (!item) {
            item = document.createElement("div");
            item.className = "strip-user-dropdown-item sn-loc-menu";
            item.setAttribute("data-strip-action", "location");
            item.setAttribute("role", "menuitemcheckbox");
            item.innerHTML = '<i class="bi bi-geo-alt-fill" aria-hidden="true" style="width:18px;text-align:center;font-size:15px"></i><span class="sn-loc-menu-t">Share my location</span><span class="sn-loc-menu-sw" aria-hidden="true"><i></i></span>';
            const logout = dd.querySelector("[data-strip-action='logout']");
            dd.insertBefore(item, logout);
            const data = document.createElement("div");
            data.className = "strip-user-dropdown-item sn-loc-data-item";
            data.setAttribute("data-strip-action", "location-data");
            data.setAttribute("role", "menuitem");
            data.innerHTML = '<i class="bi bi-shield-lock" aria-hidden="true" style="width:18px;text-align:center;font-size:15px"></i><span>My location data</span>';
            dd.insertBefore(data, logout);
        }
        item.classList.toggle("on", state.sharing === true);
        item.setAttribute("aria-checked", state.sharing === true ? "true" : "false");
    }
    document.addEventListener("strip-header:action", (e) => {
        if (e.target !== document || !e.detail || !state) return;
        if (e.detail.action === "location") setSharing(state.sharing !== true);
        else if (e.detail.action === "location-data") showMyData();
    });

    async function init() {
        try {
            const r = await fetch("/location/me", { headers: { Accept: "application/json" } });
            state = r.ok ? await r.json() : null;
        } catch { state = null; }
        if (!state || !state.enabled) return;
        paintMenu();
        if (state.sharing === true) { checkIn(false); start(); }
        else if (state.sharing == null) setTimeout(showAsk, 2500);   // after the page has settled
        window.addEventListener("online", () => checkIn(true));
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
