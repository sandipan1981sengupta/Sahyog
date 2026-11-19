// Sahyog · shared page behaviour: real-time connection, presence, incoming calls, dialogs, toasts.
(function () {
    "use strict";

    const Sahyog = (window.Sahyog = window.Sahyog || {});

    Sahyog.antiforgery = () => document.querySelector('input[name="__RequestVerificationToken"]')?.value || "";

    Sahyog.escape = (text) =>
        String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    // Toasts come from toast.js (loaded first); keep a plain fallback just in case.
    Sahyog.toast = Sahyog.toast || ((message) => console.info(message));

    // ---------- dialogs, copy buttons, filters ----------
    document.addEventListener("click", (e) => {
        const opener = e.target.closest("[data-open]");
        if (opener) document.getElementById(opener.dataset.open)?.showModal();

        const closer = e.target.closest("[data-close]");
        if (closer) closer.closest("dialog")?.close();

        const copy = e.target.closest("[data-copy]");
        if (copy) {
            const source = document.querySelector(copy.dataset.copy);
            navigator.clipboard?.writeText(source?.value || source?.textContent || "").then(() => Sahyog.toast("Link copied"));
        }
    });
    // Set up for every page (also after a partial page load, see sn-nav.js).
    const onPage = (fn) => (window.SN && SN.onPage ? SN.onPage(fn) : fn());
    // Re-open a dialog only when the server says its form came back with errors.
    // Razor always writes data-* attributes (a false flag renders as "False"), so check the value, not just its presence.
    onPage(() => document.querySelectorAll("dialog[data-open-on-load]").forEach((d) => {
        if ((d.dataset.openOnLoad || "").toLowerCase() === "true") d.showModal();
    }));

    const filter = (inputId, itemSelector) => {
        const input = document.getElementById(inputId);
        input?.addEventListener("input", () => {
            const q = input.value.trim().toLowerCase();
            document.querySelectorAll(itemSelector).forEach((el) => {
                el.hidden = q.length > 0 && !(el.dataset.filter || "").toLowerCase().includes(q);
            });
        });
    };
    onPage(() => {
        filter("sideFilter", ".side-item[data-filter]");
        filter("tenantFilter", "tr[data-filter]");
    });

    // ---------- real-time connection (only on signed-in workspace pages) ----------
    if (!window.signalR || !document.querySelector(".rail")) return;

    const hub = new signalR.HubConnectionBuilder()
        .withUrl("/hubs/chat")
        .withAutomaticReconnect([0, 2000, 5000, 10000, 20000, 30000])
        .build();
    Sahyog.hub = hub;
    Sahyog.online = new Set();

    Sahyog.busy = new Set();      // people in a call or meeting right now
    Sahyog.status = new Map();    // userId → { manual, idle, presenting, call }  (see PresenceTracker.cs)

    // ---------- status, like Microsoft Teams ----------
    // What to show, most important first: Presenting › Do not disturb › In a call / meeting › Busy › Be right back › Away › Available.
    // "Appear offline" shows as Offline to everyone else.
    const STATES = {
        available: { label: "Available", cls: "st-available" },
        busy: { label: "Busy", cls: "st-busy" },
        dnd: { label: "Do not disturb", cls: "st-dnd" },
        brb: { label: "Be right back", cls: "st-brb" },
        away: { label: "Away", cls: "st-away" },
        call: { label: "In a call", cls: "st-call" },
        meeting: { label: "In a meeting", cls: "st-meeting" },
        presenting: { label: "Presenting", cls: "st-present" },
        offline: { label: "Offline", cls: "st-offline" }
    };
    Sahyog.STATES = STATES;
    const ALL_CLS = Object.values(STATES).map((x) => x.cls);
    const stateOf = (id) => {
        const st = Sahyog.status.get(id) || {};
        const busy = Sahyog.busy.has(id);
        if (!Sahyog.online.has(id) && !busy) return "offline";
        if (st.manual === "offline") return "offline";
        if (st.presenting) return "presenting";
        if (st.manual === "dnd") return "dnd";
        if (busy || st.call) return st.call === "meeting" ? "meeting" : "call";
        if (st.manual === "busy") return "busy";
        if (st.manual === "brb") return "brb";
        if (st.manual === "away" || st.idle) return "away";
        return "available";
    };
    Sahyog.stateOf = stateOf;

    const paintPresence = () => {
        document.querySelectorAll("[data-presence]").forEach((el) => {
            const id = el.dataset.presence, dot = el.querySelector(".dot");
            const state = stateOf(id), info = STATES[state];
            const inCall = state === "call" || state === "meeting" || state === "presenting";
            if (dot) {
                dot.classList.remove(...ALL_CLS);
                dot.classList.add(info.cls);
                // the older names still drive the existing green / red looks
                dot.classList.toggle("on", state === "available");
                dot.classList.toggle("busy", inCall);
            }
            el.classList.toggle("is-busy", inCall);
            el.classList.toggle("is-on", state === "available");
            el.setAttribute("data-state", state);
            el.setAttribute("data-status", info.label);
        });
        // the little "Online / Offline" words next to names (people pickers, members list)
        document.querySelectorAll("[data-pp-state-of]").forEach((el) => {
            const st = stateOf(el.dataset.ppStateOf);
            el.textContent = STATES[st].label;
            el.closest("[data-presence-row]")?.setAttribute("data-state", st);
        });
        // "N online" on the Chat page (people who appear offline don't count)
        const count = document.getElementById("teamOnline");
        if (count) {
            const me = document.body.dataset.me;
            const ids = new Set([...Sahyog.online, ...Sahyog.busy]);
            count.textContent = [...ids].filter((id) => id !== me && stateOf(id) !== "offline").length;
        }
        document.dispatchEvent(new CustomEvent("sahyog:presence"));
    };
    Sahyog.paintPresence = paintPresence;
    hub.on("BusyChanged", (userId, busy) => {
        if (busy) Sahyog.busy.add(userId); else Sahyog.busy.delete(userId);
        paintPresence();
    });

    hub.on("PresenceChanged", (userId, isOnline) => {
        if (isOnline) Sahyog.online.add(userId); else { Sahyog.online.delete(userId); Sahyog.status.delete(userId); }
        paintPresence();
    });

    hub.on("StatusChanged", (userId, st) => {
        Sahyog.status.set(userId, st || {});
        // my own status changed in another tab: remember it here too
        if (userId === document.body.dataset.me) {
            try { if (st && st.manual) localStorage.setItem("sn-status", st.manual); else localStorage.removeItem("sn-status"); } catch { }
        }
        paintPresence();
    });

    const loadStatuses = async () => {
        try {
            const all = await hub.invoke("Statuses");
            Sahyog.status = new Map(Object.entries(all || {}));
        } catch { /* older server */ }
    };
    // after (re)connecting, tell the server the status I picked last time (it only keeps it while I'm connected)
    const restoreMyStatus = () => {
        let mine = null;
        try { mine = localStorage.getItem("sn-status"); } catch { }
        if (mine && document.body.dataset.me) hub.invoke("SetStatus", mine).catch(() => { });
    };
    /** Picks a status ("available", "busy", "dnd", "brb", "away", "offline") or "auto" to reset. */
    Sahyog.setStatus = async (status) => {
        try { if (status && status !== "auto") localStorage.setItem("sn-status", status); else localStorage.removeItem("sn-status"); } catch { }
        try { await hub.invoke("SetStatus", status || "auto"); }
        catch { Sahyog.toast?.("Couldn't change your status. Check your connection.", { kind: "warn" }); }
    };

    // Away after 10 minutes without mouse, keyboard or touch (like Teams); back to normal on the next move.
    (() => {
        const IDLE_MS = 10 * 60 * 1000;
        let idle = false, last = Date.now();
        const wake = () => {
            last = Date.now();
            if (idle && hub.state === "Connected") { idle = false; hub.invoke("SetIdle", false).catch(() => { }); }
        };
        ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"].forEach((ev) => window.addEventListener(ev, wake, { passive: true }));
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") wake(); });
        setInterval(() => {
            if (!idle && Date.now() - last > IDLE_MS && hub.state === "Connected") { idle = true; hub.invoke("SetIdle", true).catch(() => { }); }
        }, 30 * 1000);
        document.addEventListener("sahyog:connected", () => { if (idle) hub.invoke("SetIdle", true).catch(() => { }); });
    })();

    const goTo = (url) => (window.SN && SN.go ? SN.go(url) : (location.href = url));
    // ---------- incoming call: ring (Teams-like tune) until answered, declined or 30 s ----------
    let ringTimer = null;
    let audioCtx = null;
    let dismissTimer = null;
    let titleTimer = null;
    let silenced = false;
    let ringingId = null;   // the call that is ringing on this screen
    let pageTitle = document.title;              // this page's own title (the tab shows unread counts in front of it)

    // Browsers only allow sound after the person has clicked or typed on the page once.
    // So we "unlock" sound on the first click / key press, and later calls can ring.
    const unlockAudio = () => {
        try {
            audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === "suspended") audioCtx.resume();
        } catch { /* no audio */ }
    };
    ["pointerdown", "keydown", "touchstart"].forEach((t) => document.addEventListener(t, unlockAudio, { once: true, capture: true }));

    const tone = (freq, at, len, vol, type) => {
        const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(vol, at + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + len);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(at);
        osc.stop(at + len + 0.05);
    };
    // ringtone "Harp rise": a soft harp sweeping upward (G B D F# G B D)
    const RING_EVERY_MS = 2800;
    const ringOnce = () => {
        if (silenced) return;
        try {
            unlockAudio();
            if (!audioCtx || audioCtx.state !== "running") return;
            const now = audioCtx.currentTime + 0.03;
            [392, 493.88, 587.33, 739.99, 783.99, 987.77, 1174.66].forEach((f, i) => {
                const at = now + i * 0.09;
                tone(f, at, 1.1, 0.18, "triangle");     // the string
                tone(f * 2, at, 0.6, 0.045, "sine");    // its shimmer
            });
        } catch { /* the card still shows */ }
    };
    Sahyog.chime = ringOnce;

    const callBox = () => document.getElementById("callOverlay");
    const stopRinging = () => {
        clearInterval(ringTimer); clearTimeout(dismissTimer); clearInterval(titleTimer);
        ringTimer = null;
        ringingId = null;
        silenced = false;
        document.title = pageTitle;
        Sahyog.paintUnread?.();
        const box = callBox();
        if (!box || box.hidden) return;
        box.classList.add("leaving");
        setTimeout(() => {
            box.classList.remove("leaving");
            box.hidden = true;
            try { if (box.matches(":popover-open")) box.hidePopover(); } catch { }
        }, 280);
    };

    // calls already answered, declined or timed out on this screen (so they don't ring a second time)
    const handledCalls = new Set();
    // The same card rings for three things (call.kind):
    //   "video" (or none)  a call from Chat           → Accept / Decline (with a message), 30 s, a missed call after
    //   "meeting"          someone started a meeting  → Join / Not now, 30 s
    //   "reminder"         a meeting starts soon/now  → Join / Dismiss; call.ring = false: one soft chime, 60 s
    const KINDS = {
        video: { icon: "fa-video-camera", app: "Incoming video call", accept: "Accept", decline: "Decline", ms: 30000 },
        meeting: { icon: "fa-calendar-check-o", app: "Meeting started", accept: "Join", decline: "Not now", ms: 30000 },
        reminder: { icon: "fa-bell", app: "Meeting reminder", accept: "Join", decline: "Dismiss", ms: 60000 }
    };
    // a meeting that has rung recently (its start reminder then stays quiet)
    const meetingRangAt = new Map();
    // Meeting pages open in this browser (js/room.js says so every 20 s). While you're in a call there,
    // that page shows calls and reminders itself (with "Hold & answer"), so this tab doesn't ring a second card.
    const roomsOpen = new Map();     // meetingId → last heard
    const callsChannel = "BroadcastChannel" in window ? new BroadcastChannel("sn-calls") : null;
    if (callsChannel) {
        callsChannel.onmessage = (e) => {
            const d = e.data || {};
            if (d.type === "in-call") roomsOpen.set(String(d.meetingId).toLowerCase(), Date.now());
            if (d.type === "left") roomsOpen.delete(String(d.meetingId).toLowerCase());
        };
        callsChannel.postMessage({ type: "who" });
    }
    const inCallElsewhere = () => [...roomsOpen.values()].some((t) => Date.now() - t < 45000);
    const showIncoming = (call) => {
        const box = callBox();
        if (!box || !call) return;
        const kind = KINDS[call.kind] ? call.kind : "video";
        const isCall = kind === "video";
        // you're in a call in another tab: it rings there (its own server connection got this too),
        // and a reminder is handed over to it
        if (inCallElsewhere()) {
            if (kind === "reminder" && callsChannel) callsChannel.postMessage({ type: "ring", call });
            return;
        }
        const K = KINDS[kind];
        const key = (isCall ? "" : kind + ":") + String(call.meetingId).toLowerCase() + (call.occurrence ? "@" + call.occurrence : "");
        if (handledCalls.has(key)) return;
        // the same call ringing again (the caller pressed Call again): just keep the card, don't stack a second one
        if (ringingId === call.meetingId && !box.hidden) return;
        // a call rings over a reminder, never the other way round
        if (!isCall && ringingId && !box.hidden && box.dataset.kind === "video") return;
        if (!isCall) meetingRangAt.set(String(call.meetingId).toLowerCase(), Date.now());
        clearInterval(ringTimer); clearTimeout(dismissTimer); clearInterval(titleTimer);
        silenced = false;
        box.dataset.kind = kind;
        box.querySelector(".sn-call-app").innerHTML = `<i class="fa ${K.icon}" aria-hidden="true"></i> ${K.app}`;
        box.querySelector("#callAccept span").textContent = K.accept;
        box.querySelector("#callDecline span").textContent = K.decline;
        box.querySelector("#callAccept i").className = "fa " + (isCall ? "fa-video-camera" : "fa-sign-in");
        box.querySelector("#callDecline i").className = "fa " + (isCall ? "fa-phone" : "fa-times");
        box.querySelector("#callAccept").title = isCall ? "Accept with video" : "Join the meeting";
        box.querySelector("#callDecline").title = K.decline;
        const avatar = document.getElementById("callAvatar");
        avatar.textContent = call.callerInitials;
        avatar.className = `avatar av-56 tone-${call.callerTone}`;
        if (call.callerId) { avatar.setAttribute("data-user", call.callerId); Sahyog.paintPhotos?.(box); }
        // reminder: the meeting's name in big, "starts in 5 minutes · Sandy" under it; the others: who, then what
        document.getElementById("callWho").textContent = kind === "reminder" ? call.title : call.callerName;
        document.getElementById("callTitle").textContent = isCall ? "is calling you…"
            : kind === "meeting" ? `started “${call.title}”`
            : [call.note, call.callerName ? `hosted by ${call.callerName}` : ""].filter(Boolean).join(" · ");
        document.getElementById("callAccept").href = call.roomUrl;
        const done = () => handledCalls.add(key);
        document.getElementById("callAccept").onclick = () => { done(); stopRinging(); };
        const decline = (note) => {
            done();
            stopRinging();
            if (!isCall) return;                       // a meeting or reminder: just put the card away
            hub.invoke("DeclineCall", call.meetingId, note || null).catch(() => { });
            if (note) Sahyog.toast(`Declined. ${call.callerName} sees your message: “${note}”`, { kind: "info", title: "Call declined" });
        };
        const replies = document.getElementById("callReplies"), more = document.getElementById("callDeclineMore");
        replies.hidden = true; more.setAttribute("aria-expanded", "false");
        more.hidden = !isCall;                          // "decline with a message" only for calls
        document.getElementById("callDecline").onclick = () => decline(null);
        more.onclick = () => {
            replies.hidden = !replies.hidden;
            more.setAttribute("aria-expanded", String(!replies.hidden));
            silenced = true; box.classList.add("silenced");   // quiet while you type
            clearTimeout(dismissTimer); box.classList.remove("counting");   // no time-out while you type
            if (!replies.hidden) setTimeout(() => document.getElementById("callReplyText").focus(), 50);
        };
        replies.querySelectorAll(".sn-call-reply").forEach((b) => (b.onclick = () => decline(b.textContent.trim())));
        const own = document.getElementById("callReplyText");
        own.value = "";
        const sendOwn = () => { if (own.value.trim()) decline(own.value.trim()); else own.focus(); };
        document.getElementById("callReplySend").onclick = sendOwn;
        own.onkeydown = (e) => { if (e.key === "Enter") sendOwn(); };
        document.getElementById("callSilence").onclick = () => { silenced = true; box.classList.add("silenced"); };
        box.classList.remove("silenced", "leaving");
        box.hidden = false;
        // top layer: above every window, dialog and page animation
        try { if (!box.hasAttribute("popover")) box.setAttribute("popover", "manual"); if (box.matches(":popover-open")) box.hidePopover(); box.showPopover(); } catch { }
        box.style.setProperty("--sn-call-ms", K.ms + "ms");
        box.classList.remove("counting"); void box.offsetWidth; box.classList.add("counting");

        // Do not disturb / presenting: meetings and reminders still show, but quietly
        const me = document.body.dataset.me;
        if (!isCall && me && Sahyog.stateOf && ["dnd", "presenting"].includes(Sahyog.stateOf(me))) { silenced = true; box.classList.add("silenced"); }
        ringOnce();
        if (call.ring !== false) ringTimer = setInterval(ringOnce, RING_EVERY_MS);   // a "soon" reminder chimes once
        // the tab title blinks while ringing
        let flip = false;
        const blink = isCall ? `📞 ${call.callerName} is calling…` : kind === "meeting" ? `📅 ${call.title} has started` : `🔔 ${call.title} ${call.note || ""}`.trim();
        titleTimer = setInterval(() => { flip = !flip; document.title = flip ? blink : pageTitle; }, 1000);
        ringingId = call.meetingId;
        dismissTimer = setTimeout(() => {
            done();
            stopRinging();
            if (kind === "meeting") {
                Sahyog.toast(`${call.callerName} started “${call.title}”.`, { kind: "info", title: "Meeting started", ms: 12000,
                    action: { text: "Join", onClick: () => { location.href = call.roomUrl; } } });
                return;
            }
            if (!isCall) return;
            hub.invoke("CallNotAnswered", call.meetingId).catch(() => { });
            Sahyog.addMissed?.();
            Sahyog.toast(`You missed a call from ${call.callerName}.`, { kind: "warn", title: "Missed call", ms: 10000,
                action: { text: "Call back", onClick: () => goTo("/chat") } });
        }, K.ms);

        if ("Notification" in window && Notification.permission === "granted" && (document.hidden || !document.hasFocus())) {
            const head = isCall ? `${call.callerName} is calling you` : kind === "meeting" ? `${call.callerName} started “${call.title}”` : `${call.title} ${call.note || ""}`.trim();
            const n = new Notification(head, { body: isCall ? "Click to answer." : "Click to join.", tag: `${kind}-${call.meetingId}`, requireInteraction: isCall || call.ring !== false });
            n.onclick = () => { window.focus(); location.href = call.roomUrl; };
        }
    };
    hub.on("IncomingCall", showIncoming);
    /** Shows the ringing card for a meeting reminder (js/meeting-alerts.js). */
    Sahyog.ringMeeting = (call) => {
        const id = String(call.meetingId).toLowerCase();
        // its start reminder stays quiet when the meeting has just rung ("Sandy started …")
        if (call.phase === "now" && Date.now() - (meetingRangAt.get(id) || 0) < 3 * 60 * 1000) return;
        showIncoming(Object.assign({ kind: "reminder" }, call));
    };

    // A call that started while this page was asleep, offline or reconnecting still rings when it wakes up
    // (the server keeps a call "ringing" for 45 s).
    const checkPending = async () => {
        if (hub.state !== "Connected") return;
        try { (await hub.invoke("PendingCalls") || []).forEach(showIncoming); } catch { /* older server */ }
    };
    Sahyog.checkPendingCalls = checkPending;

    // ---------- new messages: a pop-up with the sender's photo, a soft sound, counts on the Chat icon ----------
    const UNREAD_KEY = "sn-unread";
    const readUnread = () => { try { return JSON.parse(sessionStorage.getItem(UNREAD_KEY) || "{}"); } catch { return {}; } };
    const saveUnread = (u) => { try { sessionStorage.setItem(UNREAD_KEY, JSON.stringify(u)); } catch { } };
    // the chat open on screen (changes when another page is loaded partially)
    const openChannel = () => document.getElementById("chat")?.dataset.channel || null;

    const railChat = () => document.querySelector('.rail a[href="/chat"], .rail [data-key="chat"] a, .rail [href="/chat"]');
    Sahyog.paintUnread = () => {
        const total = Object.values(readUnread()).reduce((a, b) => a + b, 0);
        const link = railChat();
        if (link) {
            let b = link.querySelector(".sn-rail-badge");
            if (!b) { b = document.createElement("span"); b.className = "sn-rail-badge"; link.style.position = "relative"; link.appendChild(b); }
            b.textContent = total > 99 ? "99+" : String(total);
            b.hidden = total === 0;
            b.classList.remove("pop"); void b.offsetWidth; if (total) b.classList.add("pop");
        }
        if (!ringingId) document.title = total ? `(${total}) ${pageTitle}` : pageTitle;
    };
    // missed calls: a red count on the Calls icon until you open the Calls page
    const MISSED_KEY = "sn-missed";
    const missedCount = () => { try { return Number(localStorage.getItem(MISSED_KEY) || 0); } catch { return 0; } };
    Sahyog.paintMissed = () => {
        const link = document.querySelector('.rail [href="/calls"]');
        if (!link) return;
        let b = link.querySelector(".sn-rail-badge");
        if (!b) { b = document.createElement("span"); b.className = "sn-rail-badge"; link.style.position = "relative"; link.appendChild(b); }
        const n = missedCount();
        b.textContent = n > 99 ? "99+" : String(n);
        b.hidden = n === 0;
    };
    Sahyog.addMissed = () => { try { localStorage.setItem(MISSED_KEY, String(missedCount() + 1)); } catch { } Sahyog.paintMissed(); };

    // each page: its title, opening a chat reads it, opening Calls clears the missed count
    onPage(() => {
        if (!ringingId) pageTitle = document.title.replace(/^\(\d+\+?\) /, "");
        const open = openChannel();
        if (open) { const u = readUnread(); delete u[open]; saveUnread(u); }
        if (location.pathname.toLowerCase().startsWith("/calls")) { try { localStorage.removeItem(MISSED_KEY); } catch { } }
        Sahyog.paintUnread();
        Sahyog.paintMissed();
        if (hub.state === "Connected") paintPresence();
    });

    // a soft two-note "ding" (quieter than the call ring)
    const ding = () => {
        try {
            unlockAudio();
            if (!audioCtx || audioCtx.state !== "running") return;
            const t = audioCtx.currentTime + 0.02;
            tone(880, t, 0.35, 0.09, "sine");
            tone(1318.51, t + 0.11, 0.55, 0.08, "sine");
        } catch { }
    };
    Sahyog.ding = ding;

    hub.on("MessageReceived", (m) => {
        const me = document.body.dataset.me;
        if (!m || m.senderId === me || /^\[\[call:/.test(m.body || "")) return;   // calls ring instead
        const looking = openChannel() === m.channelId && document.visibilityState === "visible" && document.hasFocus();
        if (looking) return;   // you're reading this chat right now

        if (openChannel() !== m.channelId) {
            const u = readUnread(); u[m.channelId] = (u[m.channelId] || 0) + 1; saveUnread(u);
            Sahyog.paintUnread();
        }
        // Do not disturb or Presenting: the unread count still goes up, but no sound, pop-up or desktop notification
        const quiet = me && Sahyog.stateOf && ["dnd", "presenting"].includes(Sahyog.stateOf(me));
        if (quiet) return;
        ding();

        const preview = m.body ? (m.body.length > 90 ? m.body.slice(0, 90) + "…" : m.body) : "Sent a file";
        const av = document.createElement("span");
        av.className = `avatar av-38 tone-${m.senderTone}`;
        av.dataset.user = m.senderId;
        av.textContent = m.senderInitials;
        Sahyog.paintPhotos?.(av.parentElement || document);
        const go = () => goTo(`/chat/${m.channelId}`);
        Sahyog.toast(preview, {
            kind: "message",
            title: m.fromGroup ? `${m.senderName} · ${m.fromGroup}` : m.senderName,
            avatar: av, ms: 7000, onClick: go,
            action: { text: "Reply", onClick: go }
        });
        Sahyog.paintPhotos?.(document.getElementById("toasts") || document);

        if ("Notification" in window && Notification.permission === "granted" && (document.hidden || !document.hasFocus())) {
            const n = new Notification(m.senderName, { body: preview, tag: `msg-${m.channelId}` });
            n.onclick = () => { window.focus(); go(); };
        }
    });

    // answered on another device, or the caller hung up: stop ringing here
    hub.on("CallUpdated", (c) => {
        if (c && c.outcome !== 0) handledCalls.add(String(c.meetingId).toLowerCase());
        if (!ringingId || c.meetingId.toLowerCase() !== String(ringingId).toLowerCase() || c.outcome === 0) return;
        const caller = document.getElementById("callWho")?.textContent || "Someone";
        stopRinging();   // (answering on this screen already cleared ringingId, so we only get here for other cases)
        if (c.outcome === 5 || c.outcome === 3) Sahyog.addMissed?.();
        if (c.outcome === 5 || c.outcome === 3)
            Sahyog.toast(`You missed a call from ${caller}.`, { kind: "warn", title: "Missed call", ms: 10000 });
        else if (c.outcome === 1)
            Sahyog.toast("The call was answered on another device.", { kind: "info" });
    });

    hub.on("CallDeclined", (_meetingId, name, _userId, note) =>
        Sahyog.toast(note ? `“${note}”` : `${name} declined the call.`, { kind: "warn", title: note ? `${name} declined the call` : "Call declined", ms: note ? 9000 : 6000 }));

    // ---------- someone added you to a group ----------
    hub.on("AddedToGroup", (byName, groupName, url) => {
        Sahyog.toast(`${byName} added you to "${groupName}".`, {
            kind: "info", title: "New group", ms: 10000,
            action: { text: "Open", onClick: () => goTo(url) }
        });
    });

    // ---------- "Ping" from a teammate: two soft chimes, a pop-up with "Open chat", and a desktop alert in the background ----------
    hub.on("Pinged", (name, initials, tone, chatUrl) => {
        ringOnce();
        Sahyog.toast(`${name} pinged you`, {
            kind: "info", title: "👋 Ping", ms: 12000,
            action: { text: "Open chat", onClick: () => goTo(chatUrl) }
        });
        if (document.hidden && "Notification" in window && Notification.permission === "granted") {
            const n = new Notification(`${name} pinged you`, { body: "Click to open your chat.", tag: `ping-${chatUrl}` });
            n.onclick = () => { window.focus(); goTo(chatUrl); };
        }
    });

    // Desktop alerts bell (needed to see calls and messages when this tab is in the background).
    // Always shown, so people can see the state and find their way back after choosing "Block".
    const alertsBtn = document.getElementById("alertsBtn");
    if (alertsBtn && "Notification" in window) {
        const isSafari = /Safari/i.test(navigator.userAgent) && !/Chrome|Chromium|Edg\//i.test(navigator.userAgent);
        const isEdge = /Edg\//i.test(navigator.userAgent);
        const site = location.origin;
        const steps = isSafari
            ? `In Safari: Safari menu → Settings → Websites → Notifications → find ${location.host} → Allow. Then reload the page.`
            : isEdge
                ? `In Edge: click the padlock at the left of the address bar → "Permissions for this site" → Notifications → Allow, then reload the page. `
                  + `Or paste edge://settings/content/notifications into the address bar, find ${site} under "Block", click ⋯ → Allow.`
                : `In Chrome: click the padlock (or tune icon) at the left of the address bar → "Site settings" → Notifications → Allow, then reload the page. `
                  + `Or paste chrome://settings/content/notifications into the address bar, find ${site} under "Not allowed", click ⋮ → Allow.`;
        const paint = () => {
            const p = Notification.permission;          // "default", "granted" or "denied"
            alertsBtn.hidden = false;
            alertsBtn.dataset.state = p;
            const label = p === "granted" ? "Call alerts are on" : p === "denied" ? "Call alerts are blocked · click for how to turn them on" : "Turn on call alerts";
            alertsBtn.title = label;
            alertsBtn.setAttribute("aria-label", label);
            const icon = alertsBtn.querySelector("i");
            if (icon) icon.className = p === "granted" ? "fa fa-bell" : p === "denied" ? "fa fa-bell-slash-o" : "fa fa-bell-o";
        };
        alertsBtn.addEventListener("click", async () => {
            const p = Notification.permission;
            if (p === "default") {
                const result = await Notification.requestPermission();
                paint();
                Sahyog.toast(result === "granted" ? "Call alerts are on" : "Call alerts stay off. Click the bell any time to see how to turn them on.");
            } else if (p === "granted") {
                openMessageBox({ title: "Call alerts are on", text: "You'll get a desktop alert for calls and messages while this tab is in the background. To turn them off, use the same browser setting and choose Block: " + steps, type: "info" });
            } else {
                openMessageBox({ title: "Turn call alerts back on", text: "Your browser is blocking alerts for this site, and a website isn't allowed to ask again. " + steps, type: "info" });
            }
        });
        paint();
        // the person may change the browser setting while the page is open
        navigator.permissions?.query({ name: "notifications" }).then((s) => { s.onchange = paint; }).catch(() => { });
    }

    const start = async () => {
        try {
            await hub.start();
            (await hub.invoke("OnlineUsers")).forEach((id) => Sahyog.online.add(id));
            try { Sahyog.busy = new Set(await hub.invoke("BusyUsers")); } catch { /* older server */ }
            restoreMyStatus();
            await loadStatuses();
            paintPresence();
            document.dispatchEvent(new CustomEvent("sahyog:connected"));
            checkPending();
        } catch {
            setTimeout(start, 5000);
        }
    };
    // The automatic reconnect gives up after about a minute (e.g. the PC slept or the tab was frozen).
    // Keep trying, so calls and messages never silently stop arriving.
    hub.onclose(() => setTimeout(() => { if (hub.state === "Disconnected") start(); }, 3000));
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") return;
        if (hub.state === "Disconnected") start(); else checkPending();
    });
    window.addEventListener("online", () => { if (hub.state === "Disconnected") start(); });
    hub.onreconnected(async () => {
        Sahyog.online = new Set(await hub.invoke("OnlineUsers"));
        try { Sahyog.busy = new Set(await hub.invoke("BusyUsers")); } catch { /* older server */ }
        restoreMyStatus();
        await loadStatuses();
        paintPresence();
        document.dispatchEvent(new CustomEvent("sahyog:connected"));
        checkPending();
    });
    start();
})();

// ---------- profile photos on every avatar (people without a photo keep their initials) ----------
(function () {
    "use strict";
    const Sahyog = (window.Sahyog = window.Sahyog || {});
    const me = document.body.dataset.me || "";
    if (!me) return;                       // CloudWheel super admin: no workspace photos
    Sahyog.photos = {};
    const url = (id) => `/team/photo/${id}?v=${Sahyog.photos[id]}`;
    const idOf = (el) => el.getAttribute("data-user") || el.getAttribute("data-presence")
        || (el.classList.contains("strip-user-avatar") ? me : "");
    const paintOne = (el) => {
        const id = idOf(el);
        if (!id) return;
        if (Sahyog.photos[id]) {
            el.style.setProperty("background-image", `url("${url(id)}")`, "important");   // beats themed avatar colours
            el.style.setProperty("background-size", "cover", "important");                  // whole photo fills the circle
            el.style.setProperty("background-position", "center", "important");
            el.style.setProperty("background-repeat", "no-repeat", "important");
            el.classList.add("has-photo");
        } else if (el.classList.contains("has-photo")) {
            ["background-image", "background-size", "background-position", "background-repeat"].forEach((p) => el.style.removeProperty(p));
            el.classList.remove("has-photo");
        }
    };
    const SELECTOR = ".avatar[data-user], .avatar[data-presence], [data-presence].avatar, .strip-user-avatar, .sn-photo-big[data-user]";
    Sahyog.paintPhotos = (root) => {
        (root || document).querySelectorAll(SELECTOR).forEach(paintOne);
        if (root && root.matches && root.matches(SELECTOR)) paintOne(root);
    };
    Sahyog.setPhoto = (id, version) => {
        if (version) Sahyog.photos[id] = version; else delete Sahyog.photos[id];
        Sahyog.paintPhotos();
    };
    fetch("/team/photos", { headers: { Accept: "application/json" } })
        .then((r) => (r.ok ? r.json() : {}))
        .then((map) => { Sahyog.photos = map || {}; Sahyog.paintPhotos(); })
        .catch(() => { });
    // someone changed their photo: show it right away
    const hookHub = () => Sahyog.hub?.on("PhotoChanged", (id, version) => Sahyog.setPhoto(id, version));
    if (Sahyog.hub) hookHub(); else document.addEventListener("sahyog:connected", hookHub, { once: true });
    // avatars added later (new messages, lists) get their photo too
    new MutationObserver((changes) => {
        if (!Object.keys(Sahyog.photos).length) return;
        changes.forEach((c) => c.addedNodes.forEach((n) => { if (n.nodeType === 1) Sahyog.paintPhotos(n); }));
    }).observe(document.body, { childList: true, subtree: true });
})();
