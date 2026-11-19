// ShankhNaad · meeting reminders on every page.
//
//   5 minutes before a meeting  → the ringing card "Meeting reminder · Weekly review · starts in 5 minutes"
//                                  with one soft chime (Join / Dismiss)
//   when the meeting starts     → the card again, "starts now", and it rings like a call
//                                  (quiet if someone has just started it: that already rang, see ChatHub)
//
// The list of my meetings comes from /meetings/upcoming (next 26 hours, repeats included), fetched when the
// page opens, every 10 minutes, when the tab comes back, and after a page change. A small clock checks every
// 15 seconds what is due, so reminders also come after the computer has been asleep. Each reminder shows
// once per meeting time, also with several tabs open (remembered in localStorage).
(function () {
    "use strict";
    const S = window.Sahyog;
    if (!S || !document.querySelector(".rail") || !document.body.dataset.me) return;

    const SOON_MS = 5 * 60 * 1000;          // first reminder: 5 minutes before
    const SOON_LATEST_MS = 60 * 1000;        // …still shown until 1 minute before (e.g. the page opened late)
    const NOW_LATE_MS = 2 * 60 * 1000;       // "starts now" is still shown up to 2 minutes after the start
    const RELOAD_MS = 10 * 60 * 1000;
    const KEY = "sn-remind:";

    let meetings = [], loadedAt = 0, offset = 0, loading = null;

    const now = () => Date.now() + offset;   // server clock (a PC clock that is a few minutes off doesn't matter)

    // shown once per meeting time and phase, in any tab of this browser
    const shown = (m, phase) => { try { return !!localStorage.getItem(KEY + m.id + "@" + m.startUtc + ":" + phase); } catch { return false; } };
    const markShown = (m, phase) => {
        try {
            localStorage.setItem(KEY + m.id + "@" + m.startUtc + ":" + phase, String(Date.now()));
            // tidy up entries older than two days
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const k = localStorage.key(i);
                if (k && k.startsWith(KEY) && Date.now() - Number(localStorage.getItem(k) || 0) > 2 * 86400000) localStorage.removeItem(k);
            }
        } catch { }
    };

    async function load() {
        if (loading) return loading;
        loading = fetch("/meetings/upcoming", { headers: { Accept: "application/json" }, credentials: "same-origin" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (!d) return;
                const server = Date.parse(d.nowUtc);
                if (!isNaN(server)) offset = server - Date.now();
                meetings = (d.meetings || []).map((m) => Object.assign({}, m, { start: Date.parse(m.startUtc), end: Date.parse(m.endUtc) }));
                loadedAt = Date.now();
                check();
            })
            .catch(() => { })
            .finally(() => { loading = null; });
        return loading;
    }

    function ring(m, phase) {
        markShown(m, phase);
        const mins = Math.max(1, Math.round((m.start - now()) / 60000));
        S.ringMeeting?.({
            meetingId: m.id,
            occurrence: m.startUtc,
            phase,
            title: m.title,
            note: phase === "soon" ? `starts in ${mins} minute${mins === 1 ? "" : "s"}` : m.live ? "has started" : "starts now",
            callerName: m.isHost ? "you" : m.host,
            callerInitials: m.hostInitials,
            callerTone: m.hostTone,
            callerId: String(m.hostId),
            roomUrl: m.roomUrl,
            ring: phase === "now"                // "soon": one soft chime; "now": rings like a call
        });
    }

    function check() {
        const t = now();
        for (const m of meetings) {
            if (m.inIt || m.end <= t) continue;                    // I'm already in it, or it's over
            const toStart = m.start - t;
            if (toStart <= SOON_MS && toStart > SOON_LATEST_MS && !shown(m, "soon")) { ring(m, "soon"); return; }
            if (toStart <= 0 && -toStart < NOW_LATE_MS && !shown(m, "now")) { ring(m, "now"); return; }
        }
    }

    load();
    setInterval(() => { if (Date.now() - loadedAt > RELOAD_MS) load(); else check(); }, 15000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") load(); });
    // a page change (e.g. a meeting was just scheduled or deleted): fetch the list again
    document.addEventListener("sn:page", () => { if (Date.now() - loadedAt > 20000 || /^\/meetings/i.test(location.pathname)) load(); });
    window.addEventListener("online", load);
    // for the console / testing: SN.meetingAlerts.load()
    window.SN = window.SN || {};
    SN.meetingAlerts = { load, check, list: () => meetings };
})();
