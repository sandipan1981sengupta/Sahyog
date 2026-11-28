// Sahyog · meeting room. JaaS (8x8) carries the live video; Sahyog draws its own glass controls around it.
(function () {
    "use strict";

    const cfg = JSON.parse(document.getElementById("roomConfig").textContent);
    // the side panel can be popped out into its own window: look there too
    const $ = (id) => document.getElementById(id) || (window.__snPopDoc ? window.__snPopDoc.getElementById(id) : null);

    const toast = (message) => {
        const el = document.createElement("div");
        el.className = "toast";
        el.textContent = message;
        $("toasts").appendChild(el);
        setTimeout(() => el.remove(), 4500);
    };
    // a richer notice: "Sandy left the call" + their note, with a coloured icon
    const notice = (title, note, kind, action) => {
        const el = document.createElement("div");
        el.className = `toast room-notice ${kind || "left"}`;
        el.innerHTML = `<span class="rn-ic">${kind === "declined" ? "&#128222;" : kind === "ring" ? "&#128276;" : kind === "chat" || kind === "msg" ? "&#128172;" : kind === "hand" ? "&#9995;" : kind === "joined" ? "&#128994;" : kind === "hold" ? "&#9208;&#65039;" : "&#128075;"}</span>`
            + `<span class="rn-txt"><b>${esc(title)}</b>${note ? `<q>${esc(note)}</q>` : ""}`
            + (action ? `<span class="rn-acts"><button type="button" class="rn-btn ok">${esc(action.text)}</button></span>` : "") + `</span>`;
        const close = () => { el.classList.add("out"); setTimeout(() => el.remove(), 350); };
        if (action) el.querySelector(".rn-btn").onclick = () => { close(); action.onClick(); };
        $("toasts").appendChild(el);
        setTimeout(close, action ? 12000 : note ? 9000 : 5000);
        return el;
    };

    if (typeof JitsiMeetExternalAPI === "undefined") {
        $("stageLoading").querySelector("p").textContent = "Video could not load. Check your internet connection and refresh.";
        return;
    }

    // ---------- optional real-time link (signed-in users only) for the plan's per-meeting limit ----------
    let hub = null;
    if (!cfg.isGuest && window.signalR) {
        hub = new signalR.HubConnectionBuilder().withUrl("/hubs/chat").withAutomaticReconnect().build();
    }
    const hubReady = hub ? hub.start().catch(() => { }) : Promise.resolve();
    const report = (method) => {
        if (hub && hub.state === "Connected") hub.invoke(method, cfg.meetingId).catch(() => { });
    };

    // ---------- team: photos and who is online / on a call / in this call (signed-in people only) ----------
    // People panel, top-bar faces and the Inbox use it. Avatars with data-user get the person's photo;
    // [data-st-user] dots and labels show Available (green), On a call (red), In this call (red), Offline (grey).
    const lcid = (x) => String(x ?? "").trim().toLowerCase();
    const team = { byName: new Map(), names: new Map(), inCall: new Set(), online: new Set(), busy: new Set(), photos: {}, loaded: false, listeners: [] };
    team.idForName = (name) => {
        const n = lcid(String(name || "").replace(/\s*\(guest\)/i, ""));
        if (!n) return "";
        if (n === lcid(String(cfg.displayName || "").replace(/\s*\(guest\)/i, "")) && cfg.userId) return lcid(cfg.userId);
        return team.byName.get(n) || "";
    };
    team.state = (id) => {
        id = lcid(id);
        if (!id) return ["off", "Offline"];
        if (team.inCall.has(id) || (id === lcid(cfg.userId))) return ["in", "In this call"];
        if (team.busy.has(id)) return ["busy", "On a call"];
        if (team.online.has(id)) return ["on", "Available"];
        return ["off", "Offline"];
    };
    team.paintPhotos = (root) => {
        const els = root ? root.querySelectorAll(".avatar[data-user]") : [...document.querySelectorAll(".avatar[data-user]"), ...(window.__snPopDoc?.querySelectorAll(".avatar[data-user]") || [])];
        const paint = (el) => {
            const id = lcid(el.getAttribute("data-user"));
            const v = id && team.photos[id];
            if (v) {
                el.style.setProperty("background-image", `url("/team/photo/${id}?v=${v}")`, "important");
                el.style.setProperty("background-size", "cover", "important");
                el.style.setProperty("background-position", "center", "important");
                el.classList.add("has-photo");
            } else if (el.classList.contains("has-photo")) {
                el.style.removeProperty("background-image"); el.classList.remove("has-photo");
            }
        };
        els.forEach(paint);
        if (root && root.matches && root.matches(".avatar[data-user]")) paint(root);
    };
    team.paintStatus = (root) => {
        (root ? [...root.querySelectorAll("[data-st-user]")] : [...document.querySelectorAll("[data-st-user]"), ...(window.__snPopDoc?.querySelectorAll("[data-st-user]") || [])]).forEach((el) => {
            const [st, label] = team.state(el.getAttribute("data-st-user"));
            if (el.classList.contains("st-label")) { el.textContent = label; ["on", "busy", "in", "off"].forEach((k) => el.classList.toggle(`st-${k}`, k === st)); }
            else { el.className = `st-dot ${st}`; el.title = label; }
        });
    };
    const teamChanged = () => { team.paintStatus(); team.listeners.forEach((f) => { try { f(); } catch { } }); };
    if (hub) {
        let peopleT = null;
        team.loadPeople = () => {
            clearTimeout(peopleT);
            peopleT = setTimeout(async () => {
                if (hub.state !== "Connected") return;
                try {
                    const list = await hub.invoke("PeopleForCall", cfg.meetingId) || [];
                    team.byName = new Map(); team.inCall = new Set();
                    list.forEach((p) => {
                        const id = lcid(p.userId);
                        team.byName.set(lcid(p.name), id);
                        team.names.set(id, p.name);
                        if (p.inCall) team.inCall.add(id);
                        if (p.online) team.online.add(id); else team.online.delete(id);
                        if (p.busy) team.busy.add(id); else team.busy.delete(id);
                    });
                    team.loaded = true;
                    window.__snRefreshPeople?.();
                    teamChanged();
                } catch { }
            }, 250);
        };
        const loadPresence = async () => {
            try {
                const [on, busy] = await Promise.all([hub.invoke("OnlineUsers"), hub.invoke("BusyUsers")]);
                team.online = new Set((on || []).map(lcid));
                team.busy = new Set((busy || []).map(lcid));
                teamChanged();
            } catch { }
        };
        hub.on("PresenceChanged", (id, isOnline) => {
            id = lcid(id);
            if (isOnline) team.online.add(id); else { team.online.delete(id); team.busy.delete(id); team.inCall.delete(id); }
            teamChanged();
        });
        hub.on("BusyChanged", (id, busy) => {
            id = lcid(id);
            if (busy) team.busy.add(id); else { team.busy.delete(id); team.inCall.delete(id); }
            teamChanged();
            team.loadPeople();          // joined or left a call: maybe this one
        });
        hub.on("PhotoChanged", (id, version) => {
            id = lcid(id);
            if (version) team.photos[id] = version; else delete team.photos[id];
            team.paintPhotos();
        });
        hubReady.then(() => { loadPresence(); team.loadPeople(); });
        hub.onreconnected?.(() => { loadPresence(); team.loadPeople(); });
        fetch("/team/photos", { headers: { Accept: "application/json" }, credentials: "same-origin" })
            .then((r) => (r.ok ? r.json() : {}))
            .then((map) => { Object.entries(map || {}).forEach(([k, v]) => { team.photos[lcid(k)] = v; }); team.paintPhotos(); })
            .catch(() => { });
        // avatars drawn later (people list, inbox, messages) get their photo and status as they appear
        team.observe = (root) => new MutationObserver((changes) => changes.forEach((c) => c.addedNodes.forEach((n) => {
            if (n.nodeType !== 1) return;
            if (Object.keys(team.photos).length) team.paintPhotos(n);
            if (n.matches?.("[data-st-user]") || n.querySelector?.("[data-st-user]")) team.paintStatus(n.parentNode || n);
        }))).observe(root, { childList: true, subtree: true });
        team.observe(document.body);
    } else { team.loadPeople = () => { }; team.observe = () => { }; }

    // ---------- long calls: pause every decoration while the tab or window is hidden (css/room-light.css) ----------
    const away = () => document.documentElement.classList.toggle("sn-away", document.hidden);
    document.addEventListener("visibilitychange", away); away();

    // ---------- JaaS ----------
    const api = new JitsiMeetExternalAPI(cfg.domain, {
        roomName: cfg.roomName,
        jwt: cfg.jwt,
        parentNode: $("jaas"),
        width: "100%",
        height: "100%",
        userInfo: { displayName: cfg.displayName },
        configOverwrite: {
            prejoinConfig: { enabled: false },
            // screen sharing (Chrome / Edge): this call's own tab isn't offered, a tab's sound can be shared,
            // the browser's window opens on "Window"
            screenShareSettings: { desktopDisplaySurface: "window", desktopSelfBrowserSurface: "exclude", desktopSystemAudio: "include", desktopSurfaceSwitching: "include", desktopPreferCurrentTab: false },
            prejoinPageEnabled: false,
            // calls start as sound only: the camera stays off until you press "Start video" (meetings start with video)
            startWithVideoMuted: !!cfg.startCameraOff,
            disableDeepLinking: true,
            toolbarButtons: [],               // hide Jitsi's toolbar: Sahyog's dock below replaces it
            hideConferenceSubject: true,
            hideConferenceTimer: true,
            disableInviteFunctions: true,
            disableProfile: true,
            resolution: cfg.maxHeight,
            // the plan's height (e.g. 720p) at up to 30 frames a second; never below 180p
            constraints: { video: { height: { ideal: cfg.maxHeight, max: cfg.maxHeight, min: 180 }, frameRate: { ideal: 30, max: 30 } } },
            // sharper picture for the same bandwidth: VP9 first on computers (VP8 / H.264 when a browser can't),
            // and on phones the codecs their chips handle best. Jitsi's own bitrates and adaptive quality stay as they are.
            videoQuality: {
                codecPreferenceOrder: ["VP9", "VP8", "H264"],
                mobileCodecPreferenceOrder: ["VP8", "H264", "VP9"],
                // when the computer is overloaded (long calls next to other apps), Jitsi lowers the video
                // (a lighter codec, resolution or frame rate) instead of letting the whole computer hang
                enableAdaptiveMode: true
            },
            disableShortcuts: false,
            enableNoisyMicDetection: true,
            // Jitsi's own pop-ups ("Sandy would like to participate", "… joined", lobby requests …) are off.
            // The room shows its own instead: raised hands, lobby Admit / Deny, joined / left (see below).
            notifications: [],
            disableJoinLeaveNotifications: true,
            // nothing of Jitsi's on top of the video: no info strip (its video-quality gauge) —
            // the top bar's signal bars replace it — and no thumbnail column, so no "‹" arrow to bring it back.
            // (Grid switches the column back on while it's showing: see "tileViewChanged".)
            conferenceInfo: { alwaysVisible: [], autoHide: [] },
            filmstrip: { disabled: true, disableResizable: true },
            // big calls: only the most recent speakers send video to everyone (Jitsi "last N").
            // From 10 people: the 6 latest speakers' video; from 30: 5; from 60: 4. Everyone else shows as a picture/initials.
            // Fewer people: everyone's video, as before. (See also "Big calls" below: the 720p limit.)
            channelLastN: -1,
            lastNLimits: { 10: 6, 30: 5, 60: 4 }
        },
        interfaceConfigOverwrite: {
            SHOW_JITSI_WATERMARK: false,
            SHOW_WATERMARK_FOR_GUESTS: false,
            SHOW_BRAND_WATERMARK: false,
            SHOW_POWERED_BY: false,
            TILE_VIEW_MAX_COLUMNS: 4,
            DISABLE_VIDEO_BACKGROUND: true,
            DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
            VIDEO_QUALITY_LABEL_DISABLED: true
        }
    });

    // ---------- timer & people ----------
    let joinedAt = null;
    setInterval(() => {
        if (!joinedAt) return;
        const s = Math.floor((Date.now() - joinedAt) / 1000);
        const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
        $("timer").textContent = (hh ? `${hh}:` : "") + `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
    }, 1000);

    const initials = (name) => {
        const parts = String(name || "?").replace(/\(guest\)/i, "").trim().split(/\s+/);
        return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)).toUpperCase();
    };
    const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    let speakerId = null, peopleById = new Map(), speakerT = null;
    const hands = new Map();          // participant id → when the hand went up
    const heldNames = new Set();      // names of people who have put this call on hold
    let myId = null;                  // my participant id in the video call
    async function refreshPeople() {
        let people = [];
        try {
            const info = await api.getRoomsInfo();
            people = info?.rooms?.find((r) => r.isMainRoom)?.participants || info?.rooms?.[0]?.participants || [];
        } catch {
            people = (api.getParticipantsInfo?.() || []).map((p) => ({ displayName: p.displayName || p.formattedDisplayName, id: p.participantId }));
        }
        // raised hands first (in the order they went up), like Teams
        people = people.map((p, i) => ({ ...p, _i: i }))
            .sort((a, b) => (hands.get(a.id) || Infinity) - (hands.get(b.id) || Infinity) || a._i - b._i);
        $("peopleCount").textContent = people.length || 1;
        $("peopleCount2").textContent = people.length || 1;
        const me = String(cfg.displayName || "").trim().toLowerCase();
        $("peopleList").innerHTML = people.map((p, i) => {
            const name = p.displayName || "Guest";
            const guest = /\(guest\)/i.test(name);
            const clean = name.replace(/\s*\(guest\)/i, "");
            const isMe = clean.trim().toLowerCase() === me;
            const uid = guest ? "" : isMe ? lcid(cfg.userId) : team.idForName(clean);
            const role = p.role === "moderator" ? '<span class="role host">Host</span>' : guest ? '<span class="role guest">Guest</span>' : "";
            const hand = hands.has(p.id) ? '<span class="pr-hand" title="Raised a hand" aria-label="Raised a hand">&#9995;</span>' : "";
            const canShow = p.id && !isMe;
            return `<div class="people-row ${speakerId && p.id === speakerId ? "speaking" : ""} ${hands.has(p.id) ? "hand-up" : ""} ${canShow ? "can-show" : ""}" data-pid="${esc(p.id || "")}" style="--i:${i}"${canShow ? ` role="button" tabindex="0" title="Show ${esc(clean)} on the big video"` : ""}>
                        <span class="pr-av"><span class="avatar av-36 tone-${guest ? 3 : i % 6}"${uid ? ` data-user="${esc(uid)}"` : ""}>${esc(initials(clean))}</span><i class="st-dot in" title="In this call"></i></span>
                        <span class="pr-name"><span class="pr-n">${esc(clean)}</span>${isMe ? '<small class="pr-you">You</small>' : ""}</span>
                        ${hand}
                        <span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>
                        ${heldNames.has(clean.trim().toLowerCase()) ? '<span class="role hold" title="On hold: can\'t hear or see the call right now">On hold</span>' : ""}
                        ${role}
                    </div>`;
        }).join("");
        // small stack of faces in the top bar
        const stack = $("avatarStack");
        if (stack) stack.innerHTML = people.slice(0, 3).map((p, i) => {
            const nm = (p.displayName || "Guest").replace(/\s*\(guest\)/i, "");
            const g = /\(guest\)/i.test(p.displayName || ""), uid = g ? "" : team.idForName(nm);
            return `<span class="avatar tone-${g ? 3 : i % 6}"${uid ? ` data-user="${esc(uid)}"` : ""} title="${esc(nm)}">${esc(initials(nm))}</span>`;
        }).join("");
        peopleById = new Map(people.map((p) => [p.id, (p.displayName || "Guest").replace(/\s*\(guest\)/i, "")]));
        team.paintPhotos($("peopleList")); if (stack) team.paintPhotos(stack);
    }
    window.__snRefreshPeople = () => refreshPeople();

    // ---------- dock ----------
    const setBtn = (id, on, cls, label, labelId, labelText) => {
        const b = $(id);
        b.classList.toggle(cls, on);
        b.setAttribute("aria-pressed", String(on));
        if (label) b.setAttribute("aria-label", label);
        if (labelId) $(labelId).textContent = labelText;
    };

    $("micBtn").onclick = () => api.executeCommand("toggleAudio");
    $("camBtn").onclick = () => api.executeCommand("toggleVideo");
    // =====================================================================
    // Share: straight to the browser's own window. While sharing: a pill in the top bar (how long, Change, Stop),
    // the Share button turns red, and a one-time tip about the browser's own bar.
    // =====================================================================
    let sharing = false, shareStarted = 0, shareTimer = null, reshareAfterStop = false;
    const store = { get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { } } };
    $("shareBtn").onclick = () => api.executeCommand("toggleShareScreen");
    $("shareStopBtn")?.addEventListener("click", () => { if (sharing) api.executeCommand("toggleShareScreen"); });
    $("shareChangeBtn")?.addEventListener("click", () => {
        // share something else: stop this one, then the browser's window opens again
        if (!sharing) { api.executeCommand("toggleShareScreen"); return; }
        reshareAfterStop = true;
        api.executeCommand("toggleShareScreen");
    });
    $("shareTipOk")?.addEventListener("click", () => { store.set("sn-share-tip", "1"); $("shareTip").hidden = true; });
    const paintShareTime = () => {
        const sec = Math.max(0, Math.floor((Date.now() - shareStarted) / 1000));
        const t = $("sharePillTime");
        if (t) t.textContent = `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
    };
    $("ccBtn").onclick = () => {
        api.executeCommand("toggleSubtitles");
        const on = $("ccBtn").getAttribute("aria-pressed") !== "true";
        setBtn("ccBtn", on, "active");
    };
    // Grid needs Jitsi's tiles: the thumbnail column is allowed while Grid is on, and switched off again after
    let tileOn = false;
    $("tileBtn").onclick = () => {
        if (!tileOn) { try { api.executeCommand("overwriteConfig", { filmstrip: { disabled: false } }); } catch { } }
        api.executeCommand("toggleTileView");
    };
    // ---------- side panel: hide / show (button, the arrow on the panel, the "in call" tab, or the P key) ----------
    const panel = $("roomPanel"), peek = $("panelPeek");
    let panelOpen = true, autoHidden = false;
    try { if (localStorage.getItem("sn-room-panel") === "0") panelOpen = false; } catch { }
    // on a phone or small tablet the panel opens over the video, so it starts closed
    const smallScreen = () => window.matchMedia("(max-width: 900px)").matches;
    // which view the panel shows (People, Chat, Inbox): its dock button is lit while it's open
    let pane = "people";
    const PANE_BTN = { people: "panelBtn", chat: "chatBtn", msgs: "inboxBtn" };
    const PANE_LABEL = { people: "People in the call", chat: "Chat with everyone in the call", msgs: "Inbox: your other chats" };
    function paintPaneBtns() {
        Object.entries(PANE_BTN).forEach(([name, id]) => {
            if (!$(id)) return;
            const on = panelOpen && pane === name;
            $(id).classList.toggle("active", on);
            $(id).setAttribute("aria-pressed", String(on));
            $(id).setAttribute("aria-label", on ? `Close ${name === "msgs" ? "Inbox" : name === "chat" ? "Chat" : "People"}` : PANE_LABEL[name]);
        });
    }
    if (smallScreen()) panelOpen = false;
    const paintPanel = (animate) => {
        document.body.classList.toggle("panel-off", !panelOpen);
        if (!animate) document.body.classList.add("no-anim"), requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove("no-anim")));
        paintPaneBtns();
        panel.setAttribute("aria-hidden", String(!panelOpen));
        peek.hidden = panelOpen;
    };
    const setPanel = (open, remember = true) => {
        panelOpen = open;
        if (!open) setMax(false);
        if (remember) { autoHidden = false; try { localStorage.setItem("sn-room-panel", open ? "1" : "0"); } catch { } }
        paintPanel(true);
    };
    // ---------- chat made bigger: the Chat or Inbox takes the room and the video shrinks to a corner ----------
    let panelMax = false;
    function setMax(on) {
        on = !!on && pane !== "people";
        if (on === panelMax) return;
        panelMax = on;
        document.body.classList.toggle("panel-max", on);
        const b = $("panelMaxBtn");
        if (b) {
            b.setAttribute("aria-pressed", String(on));
            b.setAttribute("aria-label", on ? "Make the chat smaller (back to the video)" : "Make the chat bigger");
            b.title = on ? "Make the chat smaller: back to the video (Esc)" : "Make the chat bigger (the video gets small)";
        }
    }
    window.__snSetMax = setMax;
    $("panelMaxBtn")?.addEventListener("click", () => setMax(!panelMax));
    $("stageRestore")?.addEventListener("click", () => setMax(false));
    peek.onclick = () => setPanel(true);
    $("panelScrim")?.addEventListener("click", () => setPanel(false, !smallScreen()));
    paintPanel(false);

    // ---------- full screen: the whole meeting fills the screen (Esc or the button to come back) ----------
    const fsOn = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
    $("fullBtn").onclick = async () => {
        try {
            if (fsOn()) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
            else await (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen).call(document.documentElement);
        } catch { toast("Full screen isn't available in this browser."); }
    };
    let panelBeforeFs = null;
    const onFs = () => {
        const on = fsOn();
        document.body.classList.toggle("is-full", on);
        setBtn("fullBtn", on, "active", on ? "Exit full screen (F)" : "Full screen (F)", "fullLabel", on ? "Exit full" : "Full screen");
        $("fullBtn").title = on ? "Exit full screen (F or Esc)" : "Full screen (F)";
        // full screen also tucks the panel away; it comes back afterwards if it was open
        if (on) { panelBeforeFs = panelOpen; if (panelOpen) { panelOpen = false; paintPanel(true); } }
        else if (panelBeforeFs !== null) { panelOpen = panelBeforeFs; panelBeforeFs = null; paintPanel(true); }
    };
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);

    // keys (when the page, not the video, has focus): P = panel, F = full screen
    document.addEventListener("keydown", (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest("input, textarea, [contenteditable]")) return;
        if (e.key === "p" || e.key === "P") { e.preventDefault(); setPanel(!panelOpen); }
        if (e.key === "f" || e.key === "F") { e.preventDefault(); $("fullBtn").click(); }
    });

    let handUp = false;
    const paintHand = () => setBtn("handBtn", handUp, "hand", handUp ? "Lower hand" : "Raise hand", "handLabel", handUp ? "Lower" : "Raise");
    $("handBtn").onclick = () => {
        api.executeCommand("toggleRaiseHand");
        handUp = !handUp;
        paintHand();
    };

    let leaving = false;
    const leave = (note, goTo) => {
        if (leaving) return;
        leaving = true;
        if (typeof note === "string" && note.trim() && hub && hub.state === "Connected")
            hub.invoke("LeaveCall", cfg.meetingId, note.trim()).catch(() => { });
        else report("MeetingLeft");
        try { api.executeCommand("hangup"); } catch { }
        setTimeout(() => (location.href = goTo || cfg.leaveUrl), 900);   // goTo: "End & answer" another call
    };

    // ---------- Leave: straight away, or with a short note for the others ----------
    const NOTES = ["Sorry, I have to drop. Will catch up later.", "Network issue, I'll rejoin soon.", "Another meeting is starting.", "Thanks all, bye!"];
    const sheet = document.createElement("div");
    sheet.className = "leave-sheet";
    sheet.hidden = true;
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-label", "Leave the call");
    sheet.innerHTML = `
        <p class="ls-title">Leave the call?</p>
        <button type="button" class="ls-now">Leave now</button>
        ${hub ? `<p class="ls-sub">or leave with a message</p>
        <div class="ls-chips">${NOTES.map((n) => `<button type="button" class="ls-chip">${esc(n)}</button>`).join("")}</div>
        <div class="ls-own"><input type="text" maxlength="300" placeholder="Write your own message…" aria-label="Your message" /><button type="button" class="ls-send">Send &amp; leave</button></div>
        <p class="ls-hint">The others see it in the call and in the chat.</p>` : ""}
        <button type="button" class="ls-cancel">Stay in the call</button>`;
    document.body.appendChild(sheet);
    const openSheet = () => { sheet.hidden = false; requestAnimationFrame(() => sheet.classList.add("open")); };
    const closeSheet = () => { sheet.classList.remove("open"); setTimeout(() => (sheet.hidden = true), 220); };
    sheet.querySelector(".ls-now").onclick = () => leave();
    sheet.querySelector(".ls-cancel").onclick = closeSheet;
    sheet.querySelectorAll(".ls-chip").forEach((b) => (b.onclick = () => leave(b.textContent)));
    const own = sheet.querySelector(".ls-own input");
    if (own) {
        const send = () => { if (own.value.trim()) leave(own.value); else own.focus(); };
        sheet.querySelector(".ls-send").onclick = send;
        own.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
    }
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheet.hidden) closeSheet(); });
    $("leaveBtn").onclick = () => (sheet.hidden ? openSheet() : closeSheet());
    $("backBtn").onclick = openSheet;

    // ---------- the call ends for me: a short "call ended" screen, then back to the chat ----------
    let ended = false;
    const endScreen = (title, note) => {
        if (ended || leaving) return;
        ended = true;
        closeSheet();
        const el = document.createElement("div");
        el.className = "call-ended";
        el.innerHTML = `<div class="ce-card"><span class="ce-ic">&#128222;</span><h2>${esc(title)}</h2>`
            + (note ? `<q>${esc(note)}</q>` : "")
            + `<p>Closing the call…</p><button type="button">Back to chat</button></div>`;
        document.body.appendChild(el);
        el.querySelector("button").onclick = () => leave();
        try { api.executeCommand("hangup"); } catch { }   // camera and microphone switch off now
        setTimeout(() => leave(), 4000);
    };
    // the most people this call has had at once (a one-to-one call with someone added becomes a group call)
    let maxPeople = 1;
    const notePeople = () => { try { maxPeople = Math.max(maxPeople, api.getNumberOfParticipants?.() || 1); } catch { } };
    api.addListener("participantJoined", () => setTimeout(notePeople, 300));
    const othersInCall = () => { try { return Math.max(0, (api.getNumberOfParticipants?.() || 1) - 1); } catch { return 0; } };

    // ---------- Big calls: from 10 people, video is limited to 720p (lighter on everyone's computer and the server) ----------
    // Turns on by itself when the 10th person joins, and back off when the call is down to 8 or fewer
    // (not 9, so it doesn't switch back and forth when someone hops in and out). Only matters on plans above 720p.
    (function bigCall() {
        const BIG_AT = 10, SMALL_AT = 8, BIG_HEIGHT = 720;
        const full = Number(cfg.maxHeight) || 720;
        if (full <= BIG_HEIGHT) return;
        let big = false;
        const check = () => {
            let n = 1;
            try { n = api.getNumberOfParticipants?.() || 1; } catch { }
            const want = big ? n > SMALL_AT : n >= BIG_AT;
            if (want === big) return;
            big = want;
            try { api.executeCommand("setVideoQuality", big ? BIG_HEIGHT : full); } catch { }
            if (big) toast(`Big call (${n} people): video is set to ${BIG_HEIGHT}p and only recent speakers' video is shown, so it stays smooth for everyone.`);
        };
        ["videoConferenceJoined", "participantJoined", "participantLeft"].forEach((ev) => api.addListener(ev, () => setTimeout(check, 500)));
    })();

    // ---------- Copy guest link: puts the link on the clipboard, to paste into WhatsApp, mail, Teams… ----------
    document.querySelectorAll("[data-copy]").forEach((btn) => {
        const label = btn.textContent;
        btn.addEventListener("click", async () => {
            const src = document.querySelector(btn.dataset.copy);
            const link = (src?.value || src?.textContent || "").trim();
            if (!link) return;
            let ok = false;
            try { await navigator.clipboard.writeText(link); ok = true; }
            catch {
                // older browsers / no permission: copy through a hidden text box
                const t = document.createElement("textarea");
                t.value = link; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
                document.body.appendChild(t); t.select();
                try { ok = document.execCommand("copy"); } catch { }
                t.remove();
            }
            if (ok) {
                btn.textContent = "Copied \u2713";
                btn.classList.add("copied");
                setTimeout(() => { btn.textContent = label; btn.classList.remove("copied"); }, 2200);
                notice("Guest link copied", `Paste it into WhatsApp, mail or chat. Anyone with it can join as a guest, no account needed. ${link}`, "ring");
            } else {
                window.prompt("Copy this guest link:", link);
            }
        });
    });


    // =====================================================================
    // Panel tabs (People / Chat), the call chat, and reactions
    // Team members talk through the server (messages are saved with the meeting);
    // guests have no account, so everything is also passed on through the video
    // service's own data channel, which reaches every browser in the call.
    // =====================================================================
    const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
    const seen = new Set();
    const myName = String(cfg.displayName || "Guest").replace(/\s*\(guest\)/i, "");
    const myTone = cfg.isGuest ? 3 : 1;

    // ---- the panel's views ----
    let unread = 0;
    const PANE_SUB = { people: "In this call", chat: "Everyone in the call sees these", msgs: "Your other chats" };
    const paintUnread = () => {
        const b = $("chatBadge"), t = $("chatUnread");
        [b, t, $("mxCallChatN")].forEach((x) => { if (!x) return; x.textContent = unread > 9 ? "9+" : String(unread); x.hidden = unread === 0; });
        if (b && unread) { b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); }
    };
    const showPane = (name) => {
        pane = name;
        panel.dataset.pane = name;
        if (name === "people") setMax(false);
        $("panePeople").hidden = name !== "people";
        $("paneChat").hidden = name !== "chat";
        if ($("paneMsgs")) $("paneMsgs").hidden = name !== "msgs";
        document.querySelectorAll(".panel-head .ph-t").forEach((h) => { h.hidden = h.dataset.for !== name; });
        if ($("paneSub")) $("paneSub").textContent = PANE_SUB[name] || "";
        paintPaneBtns();
        if (name === "chat") { unread = 0; paintUnread(); scrollChat(true); setTimeout(() => $("ccInput")?.focus(), 60); }
        if (name === "msgs") window.__snMsgsShown?.();
    };
    const panelShown = () => window.__snPopDoc ? !window.__snPopDoc.hidden : (panelOpen && !document.hidden);
    const chatVisible = () => pane === "chat" && panelShown();
    // a dock button opens its view; pressed again (while showing), it closes the panel
    const linkedChat = () => !!cfg.chatId && !cfg.isGuest && !window.__snPreferCallChat && !!window.__snOpenMessages;
    const togglePane = (name) => {
        // a call started from a chat: Chat opens that chat (all your messages with them); "Call chat" there switches
        if (name === "chat" && linkedChat()) {
            const showing = pane === "msgs" && (window.__snPopDoc || panelOpen) && window.__snOpenIs?.(cfg.chatId);
            if (showing && !window.__snPopDoc) { setPanel(false); return; }
            window.__snOpenMessages(cfg.chatId);
            if (window.__snPopDoc) { try { window.__snPopWin?.focus(); } catch { } }
            return;
        }
        if (window.__snPopDoc) { showPane(name); try { window.__snPopWin?.focus(); } catch { } return; }   // popped out: switch it there
        if (panelOpen && pane === name) { setPanel(false); return; }
        if (!panelOpen) setPanel(true);
        showPane(name);
    };
    window.__snTogglePane = togglePane;

    // ---------- the side panel in a separate window (Chat, Inbox, People), e.g. on another screen or while sharing ----------
    // Chrome / Edge: a small window that stays on top of others (Document Picture-in-Picture); elsewhere a normal pop-up.
    // The panel itself moves there (everything keeps working) and comes back when that window closes.
    let popHome = null;
    async function popOut() {
        if (window.__snPopDoc) { try { window.__snPopWin.focus(); } catch { } return; }
        const w = Math.min(460, screen.availWidth - 40), h = Math.min(760, screen.availHeight - 80);
        let win = null;
        try {
            if (window.documentPictureInPicture?.requestWindow) win = await window.documentPictureInPicture.requestWindow({ width: w, height: h });
        } catch { win = null; }
        if (!win) win = window.open("", "sn-room-panel", `popup=yes,width=${w},height=${h},left=${screen.availWidth - w - 30},top=60`);
        if (!win) { toast("Your browser blocked the new window. Allow pop-ups for this site and try again."); return; }
        const doc = win.document;
        doc.title = `${document.title} · ${pane === "msgs" ? "Inbox" : pane === "chat" ? "Chat" : "People"}`;
        if (!doc.head.querySelector("meta[charset]")) doc.head.insertAdjacentHTML("afterbegin", '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">');
        // the same look: copy the page's style sheets
        // (full addresses: the new window has no address of its own to resolve "/css/…" against)
        // our own style sheets are copied as text (shows at once, nothing to download); others (fonts) by address
        [...document.styleSheets].forEach((sh) => {
            try {
                const st = doc.createElement("style");
                st.textContent = [...sh.cssRules].map((r) => r.cssText).join("\n");
                doc.head.appendChild(st);
            } catch {
                if (!sh.href) return;
                const l = doc.createElement("link"); l.rel = "stylesheet"; l.href = sh.href; doc.head.appendChild(l);
            }
        });
        doc.body.className = "room-body sn-popout";
        // same theme as the call (Light, Kesari, Dark, CloudWheel)
        ["data-theme", "data-skin"].forEach((a) => { const v = document.documentElement.getAttribute(a); if (v) doc.documentElement.setAttribute(a, v); });
        doc.documentElement.classList.toggle("sn-carbon", document.documentElement.classList.contains("sn-carbon"));
        doc.body.innerHTML = "";
        // the panel moves into the new window; a marker keeps its place here
        popHome = document.createComment("side panel");
        panel.before(popHome);
        setMax(false);
        doc.body.appendChild(doc.adoptNode(panel));
        window.__snPopDoc = doc; window.__snPopWin = win;
        document.body.classList.add("panel-popped");
        panelOpen = true; paintPanel(true);
        // what this page listens for on its own document is needed there too
        doc.addEventListener("click", (e) => window.__snEmojiButton?.(e));
        window.SNEmoji?.prepare?.(doc);
        team.observe(doc.body);
        team.paintPhotos(); team.paintStatus();
        doc.addEventListener("keydown", (e) => { if (e.key === "Escape" && !e.defaultPrevented && !doc.querySelector(".sne")) e.stopPropagation(); });
        const pb = $("panelPopBtn");
        if (pb) { pb.title = "Bring it back into the call window"; pb.setAttribute("aria-label", "Bring it back into the call window"); }
        win.addEventListener("pagehide", popIn, { once: true });
        win.addEventListener("unload", popIn, { once: true });
        if (pane === "chat") scrollChat(true);
        notice("Opened in a separate window", "Close that window to bring it back here.", "chat");
    }
    function popIn() {
        const doc = window.__snPopDoc;
        if (!doc) return;
        window.__snPopDoc = null;
        const win = window.__snPopWin; window.__snPopWin = null;
        window.SNEmoji?.close();
        try { popHome.replaceWith(document.adoptNode(panel)); } catch { document.querySelector(".room-main")?.appendChild(document.adoptNode(panel)); }
        popHome = null;
        document.body.classList.remove("panel-popped");
        const pb = $("panelPopBtn");
        if (pb) { pb.title = "Open in a separate window (keep chatting while you share your screen)"; pb.setAttribute("aria-label", "Open in a separate window"); }
        panelOpen = true; paintPanel(true);
        try { if (!win.closed) win.close(); } catch { }
        if (pane === "chat") scrollChat(true);
    }
    $("panelPopBtn")?.addEventListener("click", () => window.__snPopDoc ? popIn() : popOut());
    window.addEventListener("pagehide", () => { try { window.__snPopWin?.close(); } catch { } });
    // Esc while working in the panel closes it (on a phone, tapping outside it does too)
    panel.addEventListener("keydown", (e) => {
        if (e.key !== "Escape" || !panelOpen || e.defaultPrevented) return;
        e.stopPropagation();
        if (panelMax) setMax(false); else setPanel(false);          // Esc: first back to the video, then close
    });
    panel.dataset.pane = pane;
    Object.entries(PANE_BTN).forEach(([name, id]) => { if ($(id)) $(id).onclick = () => togglePane(name); });
    // keep the buttons in step when the panel is hidden or shown some other way (P, full screen, a shared screen)
    new MutationObserver(paintPaneBtns).observe(document.body, { attributes: true, attributeFilter: ["class"] });

    // ---- the chat list ----
    const list = $("ccList");
    const fmtSize = (b) => b == null ? "" : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;
    const fmtTime = (d) => new Date(d).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    const fileIcon = (name, type) => {
        const ext = (name.split(".").pop() || "").toLowerCase();
        if ((type || "").startsWith("image/")) return "🖼️";
        if (ext === "pdf") return "📕";
        if (["doc", "docx", "txt", "rtf"].includes(ext)) return "📄";
        if (["xls", "xlsx", "csv"].includes(ext)) return "📊";
        if (["ppt", "pptx"].includes(ext)) return "📽️";
        if (["zip", "rar", "7z"].includes(ext)) return "🗜️";
        return "📎";
    };
    // View / Download icons for shared files (the room has no icon font for these)
    const FV_EYE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>`;
    const FV_DL = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v12M7 11l5 5 5-5M5 20h14" /></svg>`;
    let lastSender = null;
    function scrollChat(force) {
        const near = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
        if (force || near) list.scrollTop = list.scrollHeight;
    }
    function addMessage(m) {
        // m: { id, name, tone, mine, body, file: {id, name, type, size} | null, at, guest }
        if (m.id && seen.has(m.id)) return;
        if (m.id) seen.add(m.id);
        $("ccEmpty")?.remove();
        const same = lastSender === (m.mine ? "\u0001me" : m.name);
        lastSender = m.mine ? "\u0001me" : m.name;
        const el = document.createElement("div");
        el.className = `cc-msg ${m.mine ? "mine" : ""} ${same ? "same" : ""}`;
        let content = "";
        if (m.file) {
            // View (in the app, js/file-view.js) and Download, separately, like the Chat page
            const f = m.file, href = f.id ? `/meetings/chat/file/${f.id}` : null;
            const canView = !!href && !!window.SN?.canView?.(f.type);
            const isImg = canView && (f.type || "").startsWith("image/");
            const data = href ? ` data-fv-url="${href}" data-fv-name="${esc(f.name)}" data-fv-type="${esc(f.type || "")}" data-fv-size="${Number(f.size) || 0}"` : "";
            content = `<div class="cc-file"${data}>`
                + (isImg ? `<button type="button" class="cc-thumb" data-fv-view title="View ${esc(f.name)}"><img src="${href}" alt="${esc(f.name)}" loading="lazy" /></button>` : "")
                + `<span class="cc-fic" aria-hidden="true">${fileIcon(f.name, f.type)}</span>`
                + `<span class="cc-fmeta"><b>${esc(f.name)}</b><small>${fmtSize(f.size)}${href ? "" : " · open the call as a team member to download"}</small></span>`
                + (href ? `<span class="cc-fv">`
                    + (canView ? `<button type="button" class="cc-dl cc-view" data-fv-view title="View" aria-label="View ${esc(f.name)}">${FV_EYE}</button>` : "")
                    + `<a class="cc-dl" href="${href}?dl=1" download="${esc(f.name)}" title="Download" aria-label="Download ${esc(f.name)}">${FV_DL}</a>`
                    + `</span>` : "")
                + `</div>`;
        } else content = `<div class="cc-bubble">${linkify(m.body || "")}</div>`;
        el.innerHTML = (same ? "" : `<div class="cc-head">${m.mine ? "" : `<span class="avatar av-22 tone-${m.tone ?? 3}">${esc(initials(m.name))}</span>`}<b>${m.mine ? "You" : esc(m.name)}</b>${m.guest ? '<span class="cc-guest">Guest</span>' : ""}<time>${fmtTime(m.at || Date.now())}</time></div>`) + content;
        list.appendChild(el);
        scrollChat(m.mine);
        if (!m.mine && !m.history) {
            if (!chatVisible()) {
                unread++; paintUnread();
                notice(m.name, m.file ? `shared ${m.file.name}` : (m.body || "").slice(0, 140), "chat");
            }
        }
    }
    const fromServer = (m, history) => addMessage({
        id: "db" + m.messageId, name: m.senderName, tone: m.senderTone, mine: !!m.senderId && !!cfg.userId && String(m.senderId).toLowerCase() === String(cfg.userId).toLowerCase(),
        body: m.body, at: m.sentUtc, guest: !m.senderId, history,
        file: m.fileId ? { id: m.fileId, name: m.fileName, type: m.contentType, size: m.sizeBytes } : null
    });

    // ---- passing things to everyone through the video service (reaches guests too) ----
    const broadcast = (payload) => {
        try {
            const text = JSON.stringify({ k: "sn", ...payload });
            (api.getParticipantsInfo?.() || []).forEach((p) => {
                if (p.participantId) api.executeCommand("sendEndpointTextMessage", p.participantId, text);
            });
        } catch { /* the data channel isn't ready yet */ }
    };
    api.addListener("endpointTextMessageReceived", (e) => {
        let d = null;
        try { d = JSON.parse(e?.data?.eventData?.text || ""); } catch { return; }
        if (!d || d.k !== "sn") return;
        if (d.t === "r") showReaction(d.e, d.n, d.id);
        if (d.t === "m") {
            // team members already get team messages from the server; they only take guests' messages from here
            if (!cfg.isGuest && !d.g) return;
            addMessage({ id: d.id, name: d.n, tone: d.tone, body: d.body, file: d.file || null, at: Date.now(), guest: !!d.g });
        }
    });

    // ---- sending ----
    const input = $("ccInput");
    $("ccForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const body = input.value.trim();
        if (!body) return;
        input.value = "";
        if (cfg.isGuest || !hub) {
            const id = uid();
            addMessage({ id, name: myName, mine: true, body, at: Date.now(), guest: true });
            broadcast({ t: "m", id, n: myName, tone: 3, body, g: 1 });
            return;
        }
        try {
            const err = await hub.invoke("CallChatSend", cfg.meetingId, body);
            if (err) { toast(err); input.value = body; return; }
            broadcast({ t: "m", id: uid(), n: myName, tone: myTone, body, g: 0 });   // guests see it too
        } catch { toast("Couldn't send. Check your connection."); input.value = body; }
    });

    // files (team members): the paper clip, or drag a file onto the chat
    const uploadFile = (file) => {
        if (!file || cfg.isGuest) return;
        const row = document.createElement("div");
        row.className = "cc-msg mine cc-uploading";
        row.innerHTML = `<div class="cc-file"><span class="cc-fic" aria-hidden="true">${fileIcon(file.name, file.type)}</span><span class="cc-fmeta"><b>${esc(file.name)}</b><small>Sending… <span class="cc-pct">0%</span></small></span><i class="cc-bar"><i></i></i></div>`;
        $("ccEmpty")?.remove();
        list.appendChild(row); scrollChat(true);
        const fd = new FormData(); fd.append("file", file);
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/meetings/${cfg.meetingId}/chat/file`);
        const token = document.querySelector('input[name="__RequestVerificationToken"]')?.value || "";
        xhr.setRequestHeader("RequestVerificationToken", token);
        xhr.upload.onprogress = (ev) => {
            if (!ev.lengthComputable) return;
            const pct = Math.round(ev.loaded * 100 / ev.total);
            row.querySelector(".cc-pct").textContent = pct + "%";
            row.querySelector(".cc-bar i").style.width = pct + "%";
        };
        xhr.onload = () => {
            row.remove();
            let res = null; try { res = JSON.parse(xhr.responseText); } catch { }
            if (xhr.status >= 200 && xhr.status < 300 && res) {
                fromServer(res, false);
                broadcast({ t: "m", id: uid(), n: myName, tone: myTone, g: 0, file: { name: res.fileName, size: res.sizeBytes, type: res.contentType } });
            } else toast(res?.error || "Couldn't share the file.");
        };
        xhr.onerror = () => { row.remove(); toast("Couldn't share the file. Check your connection."); };
        xhr.send(fd);
    };
    $("ccFile")?.addEventListener("change", (e) => { [...e.target.files].forEach(uploadFile); e.target.value = ""; });
    const chatPane = $("paneChat"), drop = $("ccDrop");
    if (!cfg.isGuest) {
        let depth = 0;
        chatPane.addEventListener("dragenter", (e) => { if (e.dataTransfer?.types?.includes("Files")) { depth++; drop.hidden = false; e.preventDefault(); } });
        chatPane.addEventListener("dragover", (e) => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); });
        chatPane.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; drop.hidden = true; } });
        chatPane.addEventListener("drop", (e) => { e.preventDefault(); depth = 0; drop.hidden = true; [...(e.dataTransfer?.files || [])].forEach(uploadFile); });
        // paste a screenshot straight into the message box
        input.addEventListener("paste", (e) => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); fs.forEach(uploadFile); } });
    }

    // history and live messages (team members)
    if (hub) {
        hub.on("CallChat", (m) => {
            if (String(m.meetingId).toLowerCase() !== String(cfg.meetingId).toLowerCase()) return;
            fromServer(m, false);
        });
        const loadHistory = async () => {
            if (hub.state !== "Connected") return setTimeout(loadHistory, 800);
            try {
                const items = await hub.invoke("CallChatHistory", cfg.meetingId);
                if (items === null) { $("ccEmpty")?.querySelector("small")?.replaceChildren("Run database/25_CallChat.sql to turn on chat in calls."); return; }
                (items || []).forEach((m) => fromServer(m, true));
                scrollChat(true);
            } catch { }
        };
        loadHistory();
    }

    // ---- reactions: 👍 👏 ❤️ … float up over the video for everyone ----
    const tray = $("reactTray"), reactBtn = $("reactBtn");
    const layer = $("reactLayer");
    function showReaction(emoji, name, id) {
        if (id && seen.has(id)) return;
        if (id) seen.add(id);
        const el = document.createElement("div");
        el.className = "react-float";
        el.style.left = (6 + Math.random() * 22) + "%";
        el.style.setProperty("--drift", (Math.random() * 60 - 30).toFixed(0) + "px");
        el.style.setProperty("--spin", (Math.random() * 24 - 12).toFixed(0) + "deg");
        el.innerHTML = `<span class="rf-e">${esc(emoji)}</span><span class="rf-n">${esc(name)}</span>`;
        layer.appendChild(el);
        setTimeout(() => el.remove(), 3600);
        // a burst for applause and party
        if (emoji === "👏" || emoji === "🎉" || emoji === "🙌") {
            for (let i = 0; i < 5; i++) {
                const s = document.createElement("span");
                s.className = "react-spark";
                s.textContent = emoji;
                s.style.left = `calc(${el.style.left} + ${Math.round(Math.random() * 80 - 20)}px)`;
                s.style.animationDelay = (120 + i * 110) + "ms";
                s.style.setProperty("--drift", (Math.random() * 80 - 40).toFixed(0) + "px");
                layer.appendChild(s);
                setTimeout(() => s.remove(), 3400);
            }
        }
    }
    const openTray = (open) => {
        tray.hidden = !open;
        reactBtn.setAttribute("aria-expanded", String(open));
        reactBtn.classList.toggle("active", open);
        if (open) requestAnimationFrame(() => tray.classList.add("open")); else tray.classList.remove("open");
    };
    reactBtn.onclick = (e) => { e.stopPropagation(); openTray(tray.hidden); };
    document.addEventListener("click", (e) => { if (!tray.hidden && !e.target.closest(".react-wrap")) openTray(false); });
    let lastReact = 0;
    tray.querySelectorAll("[data-emoji]").forEach((b) => b.addEventListener("click", () => {
        const now = Date.now();
        if (now - lastReact < 450) return;   // no flooding
        lastReact = now;
        const emoji = b.dataset.emoji, id = uid();
        showReaction(emoji, "You", id);
        b.classList.remove("tap"); void b.offsetWidth; b.classList.add("tap");
        if (hub && hub.state === "Connected") hub.invoke("CallReact", cfg.meetingId, emoji, id).catch(() => { });
        broadcast({ t: "r", e: emoji, n: myName, id });
    }));
    if (hub) hub.on("CallReaction", (meetingId, emoji, name, id) => {
        if (String(meetingId).toLowerCase() !== String(cfg.meetingId).toLowerCase()) return;
        showReaction(emoji, name, id);
    });
    // keys: R = reactions, C = chat
    document.addEventListener("keydown", (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest("input, textarea, [contenteditable]")) return;
        if (e.key === "r" || e.key === "R") { e.preventDefault(); openTray(tray.hidden); }
        if (e.key === "c" || e.key === "C") { e.preventDefault(); $("chatBtn").click(); }
        if (e.key === "Escape" && !tray.hidden) openTray(false);
    });

    if (cfg.offlineNote) setTimeout(() => notice("Not online", cfg.offlineNote, "declined"), 1200);

    // ---------- Attendance sheet: who joined, when, for how long (AttendanceController) ----------
    (function () {
        if (cfg.isGuest) return;
        const base = `/meetings/${cfg.meetingId}/attendance`;
        const xsrf = () => document.querySelector('input[name="__RequestVerificationToken"]')?.value || "";

        // guests can't report themselves: people in the call send the guests' names every minute
        let guestTimer = 0;
        const sendGuests = () => {
            clearTimeout(guestTimer);
            guestTimer = setTimeout(() => {
                const fd = new FormData();
                (api.getParticipantsInfo?.() || []).forEach((p) => {
                    const n = p.displayName || p.formattedDisplayName || "";
                    if (/\(guest\)/i.test(n)) fd.append("names", n.replace(/\s*\(guest\)/i, "").trim() || "Guest");
                });
                fd.append("__RequestVerificationToken", xsrf());
                fetch(`${base}/guests`, { method: "POST", body: fd, headers: { RequestVerificationToken: xsrf() }, credentials: "same-origin" }).catch(() => { });
            }, 2500);
        };
        api.addListener("videoConferenceJoined", sendGuests);
        api.addListener("participantJoined", sendGuests);
        api.addListener("participantLeft", sendGuests);
        setInterval(sendGuests, 60000);

        const dlg = $("attDlg"), openBtn = $("attOpenBtn");
        if (!dlg || !openBtn) return;
        const list = $("attList"), chips = $("attChips"), sub = $("attSub"), share = $("attShare");
        $("attDownload").href = `${base}/xlsx`;
        let refresh = 0;
        const paint = async () => {
            try {
                const r = await fetch(base, { headers: { Accept: "application/json" }, credentials: "same-origin" });
                const x = await r.json();
                if (!x.ready) { list.innerHTML = `<p class="add-dlg-empty">${esc(x.error || "Not available yet.")}</p>`; share.disabled = true; return; }
                sub.textContent = `${x.title}${x.day ? " · " + x.day : ""}${x.started ? " · started " + x.started : ""}${x.ended ? " · ended " + x.ended : ""}`;
                const guests = x.rows.filter((p) => p.guest).length;
                chips.innerHTML = `<span class="att-chip"><b>${x.count}</b> joined</span><span class="att-chip live"><b>${x.inCall}</b> in the call now</span>` +
                    (guests ? `<span class="att-chip guest"><b>${guests}</b> ${guests === 1 ? "guest" : "guests"}</span>` : "");
                list.innerHTML = x.rows.length ? `<div class="att-row att-hd"><span>Name</span><span>Joined</span><span>Left</span><span>Time</span></div>` + x.rows.map((p, i) =>
                    `<div class="att-row${p.inCall ? " on" : ""}"><span class="att-who"><i class="att-n">${i + 1}</i><span><b>${esc(p.name)}</b><small>${p.guest ? "Guest" : esc(p.title || p.email)}</small></span></span>` +
                    `<span>${esc(p.joined)}</span><span>${p.inCall ? '<em class="att-live">In the call</em>' : esc(p.left)}</span>` +
                    `<span>${esc(p.time)}${p.joins > 1 ? `<small>${p.joins} times</small>` : ""}</span></div>`).join("")
                    : `<p class="add-dlg-empty">No one on the sheet yet.</p>`;
                share.disabled = !x.rows.length;
            } catch { list.innerHTML = `<p class="add-dlg-empty">The sheet couldn't be loaded. Try again.</p>`; }
        };
        const close = () => { clearInterval(refresh); dlg.classList.remove("open"); setTimeout(() => dlg.open && dlg.close(), 220); };
        openBtn.onclick = () => {
            sendGuests();
            dlg.showModal(); requestAnimationFrame(() => dlg.classList.add("open"));
            paint(); clearInterval(refresh); refresh = setInterval(paint, 15000);
        };
        dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest("[data-close]")) close(); });
        dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
        $("attPrint").onclick = () => window.open(`${base}/print?print=1`, "_blank", "noopener");
        share.onclick = async () => {
            share.disabled = true;
            const label = share.querySelector("span"), was = label.textContent;
            label.textContent = "Attaching…";
            try {
                const fd = new FormData(); fd.append("__RequestVerificationToken", xsrf());
                const r = await fetch(`${base}/share`, { method: "POST", body: fd, headers: { RequestVerificationToken: xsrf(), Accept: "application/json" }, credentials: "same-origin" });
                const x = await r.json();
                if (!r.ok) { toast(x.error || "The sheet couldn't be attached."); return; }
                notice("Attendance sheet attached", "Sent to " + x.sentTo.join(" and ") + ".", "chat");
                close();
            } catch { toast("The sheet couldn't be attached. Try again."); }
            finally { label.textContent = was; share.disabled = false; }
        };
    })();

    // ---------- Add people: ring team members into this call ----------
    const addDlg = $("addDlg");
    if (addDlg && hub) {
        let people = [], picked = new Set();
        const list = $("addList"), search = $("addSearch"), ringBtn = $("addRing");
        const stateOf = (p) => p.inCall ? ["in", "In this call"] : p.busy ? ["busy", "On another call"] : p.online ? ["on", "Available"] : ["off", "Offline · can't ring"];
        const paintPicked = () => {
            const n = picked.size;
            $("addPicked").textContent = n ? `${n} picked` : "Nobody picked yet";
            $("addRingText").textContent = n ? `Ring ${n}` : "Ring";
            ringBtn.disabled = n === 0;
        };
        const paintList = () => {
            const q = search.value.trim().toLowerCase();
            const shown = people.filter((p) => !q || p.name.toLowerCase().includes(q));
            list.innerHTML = shown.length ? shown.map((p) => {
                const [st, label] = stateOf(p);
                const can = !p.inCall && p.online;
                return `<label class="add-row ${st} ${picked.has(p.userId) ? "picked" : ""} ${can ? "" : "dim"}" role="option" aria-selected="${picked.has(p.userId)}">
                    <input type="checkbox" value="${p.userId}" ${picked.has(p.userId) ? "checked" : ""} ${can ? "" : "disabled"} />
                    <span class="add-av tone-${p.tone}" data-user="${p.userId}" style="background-image:url('/team/photo/${p.userId}')">${esc(p.initials)}<i class="add-dot ${st}"></i></span>
                    <span class="add-who"><b>${esc(p.name)}</b><small>${label}</small></span>
                    <span class="add-tick" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10" /></svg></span>
                </label>`;
            }).join("") : `<p class="add-dlg-empty">${people.length ? "Nobody matches that name." : "There's nobody else in your team yet."}</p>`;
            // photos that don't exist simply leave the initials showing
            list.querySelectorAll(".add-av").forEach((a) => {
                const img = new Image();
                img.onload = () => a.classList.add("has-photo");
                img.onerror = () => { a.style.backgroundImage = "none"; };
                img.src = `/team/photo/${a.dataset.user}`;
            });
        };
        list.addEventListener("change", (e) => {
            const c = e.target;
            if (!c.matches("input[type=checkbox]")) return;
            c.checked ? picked.add(c.value) : picked.delete(c.value);
            c.closest(".add-row").classList.toggle("picked", c.checked);
            paintPicked();
        });
        search.addEventListener("input", paintList);
        const openAdd = async () => {
            picked = new Set(); search.value = ""; paintPicked();
            list.innerHTML = '<p class="add-dlg-empty">Loading your team…</p>';
            addDlg.showModal();
            requestAnimationFrame(() => addDlg.classList.add("open"));
            try { people = await hub.invoke("PeopleForCall", cfg.meetingId) || []; } catch { people = []; }
            paintList();
            search.focus();
        };
        const closeAdd = () => { addDlg.classList.remove("open"); setTimeout(() => addDlg.open && addDlg.close(), 220); };
        $("addPeopleBtn").onclick = () => {
            if (hub.state !== "Connected") { toast("Still connecting… try again in a moment."); return; }
            openAdd();
        };
        addDlg.addEventListener("click", (e) => { if (e.target === addDlg || e.target.closest("[data-close]")) closeAdd(); });
        addDlg.addEventListener("cancel", (e) => { e.preventDefault(); closeAdd(); });
        ringBtn.onclick = async () => {
            if (!picked.size) return;
            ringBtn.disabled = true;
            try {
                const r = await hub.invoke("RingIntoCall", cfg.meetingId, [...picked]);
                closeAdd();
                if (r.rung && r.rung.length) notice(`Ringing ${r.rung.join(", ")}`, "They'll join as soon as they press Accept.", "ring");
                if (r.offline && r.offline.length) notice(`${r.offline.join(", ")} ${r.offline.length === 1 ? "is" : "are"} offline`, "They can't be rung right now.", "declined");
                if ((!r.rung || !r.rung.length) && (!r.offline || !r.offline.length)) toast("Nobody new to ring.");
            } catch { toast("Couldn't ring them. Try again."); ringBtn.disabled = false; }
        };
        // someone else in the call added people
        hub.on("PeopleRung", (meetingId, by, names) => {
            if (String(meetingId).toLowerCase() !== String(cfg.meetingId).toLowerCase()) return;
            notice(`${by} is adding ${names.join(", ")}`, null, "ring");
        });
    }

    if (hub) {
        // the person you called said no
        hub.on("CallDeclined", (meetingId, name, _userId, note) => {
            if (String(meetingId).toLowerCase() !== String(cfg.meetingId).toLowerCase()) return;
            if (cfg.oneToOne && othersInCall() === 0) endScreen(`${name} declined the call`, note);
            else notice(`${name} declined the call`, note, "declined");
        });
        // someone hung up: on a one-to-one call it ends for both; in a group, everyone sees who dropped
        hub.on("ParticipantLeft", (meetingId, _userId, name, note) => {
            if (String(meetingId).toLowerCase() !== String(cfg.meetingId).toLowerCase()) return;
            // a one-to-one call ends for both — unless more people were added, then it's a small group call
            if (cfg.oneToOne && maxPeople <= 2) endScreen(`${name} ended the call`, note);
            else {
                if (Date.now() - (window.__snLeftShown?.get(name) || 0) < 8000) return;
                window.__snLeftShown?.set(name, Date.now());
                notice(`${name} left the call`, note, "left");
            }
        });
        // nobody picked up in time
        hub.on("CallUpdated", (c) => {
            if (String(c.meetingId).toLowerCase() !== String(cfg.meetingId).toLowerCase()) return;
            if (cfg.oneToOne && c.outcome === 3 && othersInCall() === 0) endScreen("No answer", null);
        });
    }

    // ---------- JaaS events keep the dock in sync ----------
    api.addListener("videoConferenceJoined", ({ id }) => {
        myId = id || null;
        joinedAt = Date.now();
        hideFilmstrip();
        $("stageLoading").hidden = true;
        report("MeetingJoined");
        if (hub) hub.onreconnected(() => report("MeetingJoined"));
        if (cfg.isModerator && cfg.lobby) {
            try { api.executeCommand("toggleLobby", true); } catch { }
        }
        if (cfg.captions) $("ccBtn").click();
        refreshPeople();
    });
    api.addListener("audioMuteStatusChanged", ({ muted }) =>
        setBtn("micBtn", muted, "off", muted ? "Unmute microphone" : "Mute microphone", "micLabel", muted ? "Unmute" : "Mute"));
    api.addListener("videoMuteStatusChanged", ({ muted }) =>
        setBtn("camBtn", muted, "off", muted ? "Turn camera on" : "Turn camera off", "camLabel", muted ? "Start video" : "Stop video"));
    api.addListener("screenSharingStatusChanged", ({ on }) => {
        setBtn("shareBtn", on, "sharing", on ? "Stop sharing your screen" : "Share your screen", "shareLabel", on ? "Stop share" : "Share");
        // teammates see "Presenting" on your picture while you share
        if (hub && hub.state === "Connected") hub.invoke("SetPresenting", cfg.meetingId, !!on).catch(() => { });
        // the browser puts its own "…is sharing your screen · Stop sharing · Hide" bar at the bottom of the screen,
        // right over the controls: move the controls (and the panel's message box) up while you share
        document.body.classList.toggle("is-sharing", !!on);
        sharing = !!on;
        const pill = $("sharePill");
        if (on) {
            shareStarted = Date.now();
            if (pill) pill.hidden = false;
            paintShareTime(); clearInterval(shareTimer); shareTimer = setInterval(paintShareTime, 1000);
            // the tip about the browser's own bar, until "Got it"
            if ($("shareTip") && store.get("sn-share-tip", "0") !== "1") $("shareTip").hidden = false;
        } else {
            clearInterval(shareTimer);
            if (pill) pill.hidden = true;
            if ($("shareTip")) $("shareTip").hidden = true;
            if (reshareAfterStop) { reshareAfterStop = false; setTimeout(() => api.executeCommand("toggleShareScreen"), 300); }
        }
    });
    api.addListener("tileViewChanged", ({ enabled }) => {
        tileOn = !!enabled;
        setBtn("tileBtn", tileOn, "active");
        document.body.classList.toggle("tile-on", tileOn);
        if (!tileOn) { try { api.executeCommand("overwriteConfig", { filmstrip: { disabled: true } }); } catch { } hideFilmstrip?.(); }
        window.__snSelfView?.();
    });
    // who is talking: their row lights up with moving sound bars, and a chip on the video shows their name
    api.addListener("dominantSpeakerChanged", ({ id }) => {
        speakerId = id;
        document.querySelectorAll(".people-row").forEach((r) => r.classList.toggle("speaking", r.dataset.pid === id));
        const name = peopleById.get(id);
        const chip = $("speakerChip");
        const meTalking = !!myId && id === myId;
        $("micBtn").classList.toggle("talking", meTalking);
        if (chip && name && !meTalking) {
            $("speakerName").textContent = name;
            const av = $("speakerAv");
            if (av) { av.textContent = initials(name); av.className = `avatar av-28 tone-${[...peopleById.keys()].indexOf(id) % 6}`; }
            chip.hidden = false;
            chip.classList.add("show");
        } else if (chip && meTalking) {
            // you: the green ring on Mute shows it; the tag keeps the last other speaker for a moment
            clearTimeout(speakerT);
            speakerT = setTimeout(() => chip.classList.remove("show"), 6000);
        }
        $("jaas")?.parentElement.classList.add("talking");
        clearTimeout(window.__snTalk); window.__snTalk = setTimeout(() => $("jaas")?.parentElement.classList.remove("talking"), 1800);
    });
    // someone shares a screen: give it the whole width (the panel slides away, and comes back when sharing stops)
    api.addListener("contentSharingParticipantsChanged", ({ data }) => {
        const sharing = Array.isArray(data) && data.length > 0;
        if (sharing && panelOpen) { panelOpen = false; autoHidden = true; paintPanel(true); toast("Side panel hidden for the shared screen. Press People (or P) to bring it back."); }
        else if (!sharing && autoHidden) { autoHidden = false; panelOpen = true; paintPanel(true); }
    });
    // the small "N in call" tab shown while the panel is hidden
    new MutationObserver(() => { const n = $("peopleCount")?.textContent; if (n) $("peekCount").textContent = n; })
        .observe($("peopleCount"), { childList: true, characterData: true, subtree: true });
    ["participantJoined", "participantLeft", "displayNameChange", "participantRoleChanged"].forEach((ev) =>
        api.addListener(ev, refreshPeople));
    ["participantJoined", "participantLeft"].forEach((ev) => api.addListener(ev, () => setTimeout(team.loadPeople, 1200)));
    // ---------- joined / left (Jitsi's own pop-ups are off) ----------
    api.addListener("participantJoined", ({ displayName }) => displayName && notice(`${displayName.replace(/\s*\(guest\)/i, "")} joined`, null, "joined"));
    const leftShown = new Map();      // name → when "left the call" was shown (the server also says it, with a note)
    api.addListener("participantLeft", ({ id }) => {
        const name = peopleById.get(id);
        hands.delete(id);
        if (!name || (cfg.oneToOne && maxPeople <= 2)) return;      // a one-to-one call shows "… ended the call"
        setTimeout(() => {
            if (Date.now() - (leftShown.get(name) || 0) < 8000) return;
            leftShown.set(name, Date.now());
            notice(`${name} left the call`, null, "left");
        }, 1500);
    });
    window.__snLeftShown = leftShown;

    // ---------- raised hands: a notice, ✋ in the People list (hands first), and my own button ----------
    api.addListener("raiseHandUpdated", ({ id, handRaised }) => {
        const up = !!handRaised;
        const was = hands.has(id);
        if (up) hands.set(id, typeof handRaised === "number" && handRaised > 1 ? handRaised : Date.now()); else hands.delete(id);
        if (myId && id === myId) { handUp = up; paintHand(); }
        else if (up && !was) {
            notice(`${peopleById.get(id) || "Someone"} raised a hand`, null, "hand");
            if (!panelOpen) $("panelPeek")?.classList.add("has-hand");
        }
        if (!hands.size) $("panelPeek")?.classList.remove("has-hand");
        refreshPeople();
    });

    // ---------- lobby: Admit / Deny right in the room (only the host gets these) ----------
    api.addListener("knockingParticipant", ({ participant }) => {
        const p = participant || {};
        const el = document.createElement("div");
        el.className = "toast room-notice lobby";
        el.innerHTML = `<span class="rn-ic">&#128682;</span><span class="rn-txt"><b>${esc(p.name || "A guest")} is waiting in the lobby</b>`
            + `<span class="rn-acts"><button type="button" class="rn-btn ok">Admit</button><button type="button" class="rn-btn no">Deny</button></span></span>`;
        const close = () => { el.classList.add("out"); setTimeout(() => el.remove(), 350); };
        const answer = (ok) => {
            try { api.executeCommand("answerKnockingParticipant", p.id, ok); } catch { }
            close();
            toast(ok ? `${p.name || "The guest"} is joining` : `${p.name || "The guest"} was not let in`);
        };
        el.querySelector(".ok").onclick = () => answer(true);
        el.querySelector(".no").onclick = () => answer(false);
        $("toasts").appendChild(el);
        setTimeout(close, 3 * 60 * 1000);   // they've probably given up by then
    });

    // ---------- Jitsi's column of video thumbnails: kept hidden ----------
    // Everyone is in the People list (a name there puts that person on the big video), and Grid shows all videos.
    let filmVisible = true;           // Jitsi starts with it showing
    function hideFilmstrip() {
        if (!filmVisible) return;
        filmVisible = false;           // (set first: the change event below then confirms it)
        try { api.executeCommand("toggleFilmStrip"); } catch { filmVisible = true; }
    }
    api.addListener("filmstripDisplayChanged", ({ visible }) => {
        filmVisible = !!visible;
        if (visible && !tileOn) setTimeout(hideFilmstrip, 50);   // it came back (e.g. after Grid): hide it again
    });

    // ---------- People list: a name puts that person on the big video ----------
    const showOnStage = (row) => {
        const id = row?.dataset.pid;
        if (!id) return;
        try { api.executeCommand("setTileView", false); } catch { }
        try { api.executeCommand("setLargeVideoParticipant", id); } catch { }
        document.querySelectorAll(".people-row.on-stage").forEach((r) => r.classList.remove("on-stage"));
        row.classList.add("on-stage");
    };
    $("peopleList").addEventListener("click", (e) => { const row = e.target.closest(".people-row.can-show"); if (row) showOnStage(row); });
    $("peopleList").addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const row = e.target.closest(".people-row.can-show");
        if (row) { e.preventDefault(); showOnStage(row); }
    });
    api.addListener("readyToClose", () => { if (!ended) leave(); });
    api.addListener("videoConferenceLeft", () => { if (!leaving && !ended) leave(); });


    // =====================================================================
    // Hold: mic, camera and this call's sound off for a moment (e.g. to take another call).
    // The others see "Sandy put the call on hold" and "On hold" next to the name.
    // =====================================================================
    let held = false, beforeHold = null, otherCall = null, micOff = false, camOff = false;
    api.addListener("audioMuteStatusChanged", ({ muted }) => { micOff = !!muted; });
    api.addListener("videoMuteStatusChanged", ({ muted }) => { camOff = !!muted; });
    const HOLD_TEXT = "Your microphone, camera and this call's sound are off. The others see that you're on hold.";
    const holdBox = document.createElement("div");
    holdBox.className = "hold-screen";
    holdBox.hidden = true;
    holdBox.innerHTML = `<div class="hs-card"><span class="hs-ic" aria-hidden="true"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6v12M15 6v12" /></svg></span>`
        + `<h2>Call on hold</h2><p id="holdText">${HOLD_TEXT}</p><button type="button" class="hs-resume" id="holdResume">Resume the call</button></div>`;
    ($("jaas")?.parentElement || document.body).appendChild(holdBox);
    // everyone else's sound in this call: 0 = silent while on hold
    const volumeAll = (v) => peopleById.forEach((_, id) => {
        if (id && id !== myId) { try { api.executeCommand("setParticipantVolume", id, v); } catch { } }
    });
    function setHold(on, why) {
        if (on === held) return;
        held = on;
        if (on) {
            beforeHold = { mic: micOff, cam: camOff };
            if (!micOff) api.executeCommand("toggleAudio");
            if (!camOff) api.executeCommand("toggleVideo");
            volumeAll(0);
        } else {
            volumeAll(1);
            // back to how it was: only what was on before is switched on again
            if (beforeHold && !beforeHold.mic && micOff) api.executeCommand("toggleAudio");
            if (beforeHold && !beforeHold.cam && camOff) api.executeCommand("toggleVideo");
            otherCall = null;
        }
        $("holdText").textContent = why || HOLD_TEXT;
        holdBox.hidden = !on;
        document.body.classList.toggle("on-hold", on);
        if ($("holdBtn")) setBtn("holdBtn", on, "active", on ? "Resume the call" : "Put the call on hold", "holdLabel", on ? "Resume" : "Hold");
        if ($("holdBtn")) $("holdBtn").title = on ? "Resume the call" : "Put the call on hold";
        if (hub && hub.state === "Connected") hub.invoke("SetOnHold", cfg.meetingId, on).catch(() => { });
    }
    if ($("holdBtn")) $("holdBtn").onclick = () => setHold(!held);
    $("holdResume").onclick = () => setHold(false);
    // someone joins while I'm on hold: they're silent for me too
    api.addListener("participantJoined", ({ id }) => {
        if (held && id) setTimeout(() => { try { api.executeCommand("setParticipantVolume", id, 0); } catch { } }, 600);
    });
    if (hub) hub.on("ParticipantOnHold", (meetingId, _userId, name, on) => {
        if (String(meetingId).toLowerCase() !== String(cfg.meetingId).toLowerCase()) return;
        const key = String(name || "").trim().toLowerCase();
        if (on) heldNames.add(key); else heldNames.delete(key);
        notice(on ? `${name} put the call on hold` : `${name} is back`, null, on ? "hold" : "joined");
        refreshPeople();
    });

    // the meeting pages of this browser tell each other when they open and close
    // (the call I put this one on hold for has ended → offer to resume; the workspace tab doesn't ring a second card)
    const calls = "BroadcastChannel" in window ? new BroadcastChannel("sn-calls") : null;
    if (calls) {
        const hello = () => { if (!leaving) calls.postMessage({ type: "in-call", meetingId: cfg.meetingId }); };
        hello();
        setInterval(hello, 20000);       // (a tab that crashed stops saying so, and the workspace rings normally again)
        calls.onmessage = (e) => {
            const d = e.data || {};
            if (d.type === "who") hello();
            // a meeting reminder from the workspace tab (js/meeting-alerts.js), shown here instead
            if (d.type === "ring" && d.call) window.__snRoomRing?.(d.call);
            if (d.type === "left" && held && otherCall && String(d.meetingId).toLowerCase() === String(otherCall.meetingId).toLowerCase()) {
                $("holdText").textContent = "Your other call has ended. Resume this one when you're ready.";
                notice("Your other call has ended", null, "hold", { text: "Resume this call", onClick: () => setHold(false) });
            }
        };
        window.addEventListener("pagehide", () => calls.postMessage({ type: "left", meetingId: cfg.meetingId }));
    }

    // =====================================================================
    // Another call (or a meeting starting) while I'm in this one:
    // Hold & answer (this call waits; the new one opens in a new tab), End & answer, or Decline.
    // =====================================================================
    if (hub) {
        let ringing = null, ringTimer = 0, ringEnd = 0, audio = null;
        const card = document.createElement("div");
        card.className = "room-ring";
        card.hidden = true;
        card.setAttribute("role", "alertdialog");
        card.setAttribute("aria-live", "assertive");
        document.body.appendChild(card);
        const beep = () => {
            try {
                audio = audio || new (window.AudioContext || window.webkitAudioContext)();
                if (audio.state === "suspended") audio.resume();
                const t = audio.currentTime + 0.02;
                [659.25, 880].forEach((f, i) => {
                    const o = audio.createOscillator(), g = audio.createGain(), at = t + i * 0.18;
                    o.type = "sine"; o.frequency.value = f;
                    g.gain.setValueAtTime(0.0001, at);
                    g.gain.exponentialRampToValueAtTime(0.12, at + 0.01);
                    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
                    o.connect(g).connect(audio.destination); o.start(at); o.stop(at + 0.55);
                });
            } catch { }
        };
        const stopRing = () => { clearInterval(ringTimer); clearTimeout(ringEnd); ringing = null; card.hidden = true; };
        const isThis = (id) => String(id).toLowerCase() === String(cfg.meetingId).toLowerCase();
        const answer = (call, keep) => {
            stopRing();
            const label = call.kind === "meeting" ? `“${call.title}”` : call.callerName;
            if (!keep) { leave(null, call.roomUrl); return; }                // End & answer
            setHold(true, `You're in another call with ${label}. Your microphone, camera and this call's sound are off.`);
            otherCall = call;
            const w = window.open(call.roomUrl, "_blank");
            if (!w) notice("Your browser blocked the new window", "Allow pop-ups for this site, or open the call with the button.", "ring",
                { text: "Open the call", onClick: () => window.open(call.roomUrl, "_blank") });
        };
        const showRing = (call) => {
            if (!call || leaving || isThis(call.meetingId)) return;
            stopRing();
            ringing = call;
            const isCall = call.kind !== "meeting" && call.kind !== "reminder";
            const reminder = call.kind === "reminder";
            const verb = isCall ? "answer" : "join";
            const head = isCall ? "Incoming call" : reminder ? "Meeting reminder" : "Meeting started";
            const who = reminder ? call.title : call.callerName;
            const what = isCall ? "is calling you" : reminder ? [call.note, call.callerName ? `hosted by ${call.callerName}` : ""].filter(Boolean).join(" · ") : `started “${call.title}”`;
            card.innerHTML = `<div class="rr-top"><span>${head}</span><small>while you're in this call</small></div>`
                + `<div class="rr-who"><span class="avatar av-44 tone-${Number(call.callerTone) || 1}">${esc(call.callerInitials || "?")}</span>`
                + `<span><b>${esc(who || "")}</b><small>${esc(what)}</small></span></div>`
                + `<div class="rr-acts"><button type="button" class="rr-btn hold" title="This call waits (you can come back); the new one opens in a new tab">Hold &amp; ${verb}</button>`
                + `<button type="button" class="rr-btn end" title="Leave this call and go to the new one">End &amp; ${verb}</button>`
                + `<button type="button" class="rr-btn no">${isCall ? "Decline" : "Not now"}</button></div>`;
            card.querySelector(".hold").onclick = () => answer(call, true);
            card.querySelector(".end").onclick = () => answer(call, false);
            card.querySelector(".no").onclick = () => {
                stopRing();
                if (isCall) hub.invoke("DeclineCall", call.meetingId, null).catch(() => { });
            };
            card.hidden = false;
            beep();
            if (call.ring !== false) ringTimer = setInterval(beep, 2800);      // a "starts in 5 minutes" reminder chimes once
            ringEnd = setTimeout(() => {
                stopRing();
                if (!isCall) return;
                // not answered: it counts as a missed call (the Calls page and the red count on Calls)
                hub.invoke("CallNotAnswered", call.meetingId).catch(() => { });
                try { localStorage.setItem("sn-missed", String(Number(localStorage.getItem("sn-missed") || 0) + 1)); } catch { }
                notice(`You missed a call from ${call.callerName}`, null, "declined");
            }, reminder ? 60000 : 30000);
        };
        hub.on("IncomingCall", showRing);
        window.__snRoomRing = showRing;
        // answered on another device, or the caller gave up: the card goes
        hub.on("CallUpdated", (c) => {
            if (!ringing || !c || String(c.meetingId).toLowerCase() !== String(ringing.meetingId).toLowerCase() || c.outcome === 0) return;
            const who = ringing.callerName;
            stopRing();
            if (c.outcome === 5) {          // the caller gave up before you answered
                try { localStorage.setItem("sn-missed", String(Number(localStorage.getItem("sn-missed") || 0) + 1)); } catch { }
                notice(`You missed a call from ${who}`, null, "declined");
            }
        });
    }

    // =====================================================================
    // Messages: your other chats, without leaving the call (signed-in people only).
    // The list (unread counts), one chat opened to read and reply, live updates, and a pop-up for new messages.
    // =====================================================================
    if (hub && $("paneMsgs")) {
        const me = String(cfg.userId || "").toLowerCase();
        let chats = [], open = null, loaded = false;
        const shown = new Set();            // message ids on screen (my reply also comes back over the live connection)
        const isCallCard = (b) => /^\[\[call:/.test(b || "");
        const isGifCard = (b) => /^\[\[gif:/.test(b || "");
        const unFwd = (b) => (b || "").replace(/^\[\[fwd:([^\]\r\n]*)\]\]\n?/, "↪ ");   // forwarded: "↪ text"
        // the server's times are UTC but may come without the "Z": read them as UTC, not as local time
        const asDate = (iso) => new Date(typeof iso === "string" && /\d$/.test(iso) && !/[zZ]|[+-]\d\d:?\d\d$/.test(iso.slice(10)) ? iso + "Z" : iso);
        const when = (iso) => {
            const d = asDate(iso);
            if (isNaN(d)) return "";
            return d.toDateString() === new Date().toDateString()
                ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                : d.toLocaleDateString([], { day: "numeric", month: "short" });
        };
        const sameId = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
        const paintCounts = () => {
            const n = chats.reduce((a, c) => a + (c.unread || 0), 0);
            [$("msgsUnread"), $("msgsBadge")].forEach((x) => { if (x) { x.textContent = n > 99 ? "99+" : String(n); x.hidden = n === 0; } });
            if ($("msgsBadge") && panelOpen && pane === "msgs") $("msgsBadge").hidden = true;    // you're looking at them
        };
        // status of the person in a one-to-one chat: live (team) once known, else what the list said
        const stOf = (c) => {
            const id = lcid(c.userId);
            if (team.online.size || team.loaded) return team.state(id);
            return c.online ? ["on", "Available"] : ["off", "Offline"];
        };
        const paintList = () => {
            const el = $("mxList");
            el.innerHTML = !chats.length
                ? `<div class="mx-empty">${loaded ? "No chats yet." : "Loading your chats…"}</div>`
                : chats.map((c) => `<button type="button" class="mx-row ${c.unread ? "unread" : ""} ${open && sameId(open.id, c.id) ? "on" : ""}" data-id="${esc(c.id)}">`
                    + (c.isDirect && c.userId
                        ? `<span class="mx-av"><span class="avatar av-36 tone-${Number(c.tone) || 0}" data-user="${esc(lcid(c.userId))}">${esc(c.initials)}</span><i class="st-dot ${stOf(c)[0]}" data-st-user="${esc(lcid(c.userId))}" title="${stOf(c)[1]}"></i></span>`
                        : `<span class="mx-av"><span class="avatar av-36 tone-${Number(c.tone) || 0}">${esc(c.initials)}</span></span>`)
                    + `<span class="mx-n"><b>${esc(c.name)}</b>${c.isDirect && c.userId
                        ? `<small class="st-label st-${stOf(c)[0]}" data-st-user="${esc(lcid(c.userId))}">${stOf(c)[1]}</small>` : "<small>Group</small>"}</span>`
                    + `<span class="mx-t"><small>${when(c.lastUtc)}</small>${c.unread ? `<em>${c.unread > 99 ? "99+" : c.unread}</em>` : ""}</span></button>`).join("");
            paintCounts();
        };
        async function loadChats() {
            try {
                const r = await fetch("/chat/inbox", { headers: { Accept: "application/json" }, credentials: "same-origin" });
                if (r.ok) chats = await r.json();
            } catch { }
            loaded = true;
            paintList();
        }
        // ----- one message: reply quote, text, file, "Edited", reactions, and its actions (react · reply · edit · delete) -----
        const msgs = new Map();             // id → message, for reply / edit
        const reacts = new Map();           // id → [{ emoji, userId, name }]
        const QUICK = ["👍", "❤️", "😂", "😮", "😢", "🙏", "👏", "🎉"];
        const myNameLc = lcid(String(cfg.displayName || "").replace(/\s*\(guest\)/i, ""));
        const isMineMsg = (m) => (!!me && String(m.senderId || "").toLowerCase() === me)
            || (!!myNameLc && lcid(m.senderName) === myNameLc);          // same name as you in this call: yours too
        const plainOf = (m) => {
            const b = unFwd(m.body);
            return isCallCard(m.body) ? "📞 Call" : isGifCard(b.replace(/^↪ /, "")) ? "🎞️ GIF" : b || (m.attachment ? "📎 " + m.attachment.fileName : "");
        };
        const canEdit = (m) => isMineMsg(m) && !!m.body && !isCallCard(m.body) && !isGifCard(m.body) && !/^\[\[fwd:/.test(m.body);
        const ICON = {
            plus: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" aria-hidden="true"><path d="M12 4v16M4 12h16" /></svg>',
            react: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" /></svg>',
            reply: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 6 6v5" /></svg>',
            edit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>',
            fwd: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 0 0-6 6v5" /></svg>',
            del: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>'
        };
        // ----- drawn like the Chat page: picture, "Name · time" above, then a bubble / big emoji / GIF / call card -----
        const FWD_RE = /^\[\[fwd:([^\]\r\n]{1,80})\]\]\n?/;
        const GIF_RE = /^\[\[gif:([A-Za-z0-9]{4,64}):(\d{1,4})x(\d{1,4})\]\]$/;
        const CALL_RE = /^\[\[call:([0-9a-f-]{36})\]\]$/i;
        const EMOJI_ONE = /^(?:\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*|\p{Regional_Indicator}{2}|[#*0-9]️?⃣)$/u;
        const NOTO = "https://fonts.gstatic.com/s/e/notoemoji/latest/";
        const graphemes = (t) => (window.Intl && Intl.Segmenter)
            ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(t)].map((x) => x.segment) : Array.from(t);
        const emojiOnly = (text) => {
            const t = (text || "").trim();
            if (!t || t.length > 80) return null;
            const parts = graphemes(t).filter((g) => !/^\s+$/.test(g));
            if (!parts.length || parts.length > 5 || !parts.every((g) => EMOJI_ONE.test(g))) return null;
            if (parts.some((g) => [...g].length === 1 && !/\p{Emoji_Presentation}/u.test(g))) return null;
            return parts;
        };
        const notoCode = (g, keepVs) => [...g].map((c) => c.codePointAt(0)).filter((cp) => keepVs || cp !== 0xfe0f).map((cp) => cp.toString(16)).join("_");
        const emojiBig = (parts) => `<span class="mx-emo ${parts.length === 1 ? "e1" : parts.length <= 3 ? "e3" : "e5"}" role="img" aria-label="${esc(parts.join(" "))}">`
            + parts.map((g, i) => { const x = notoCode(g, true), y = notoCode(g, false);
                return `<span style="--i:${i}"><img src="${NOTO}${x}/512.webp" alt="${esc(g)}" data-alt2="${y !== x ? y : ""}" loading="lazy" decoding="async" draggable="false"></span>`; }).join("") + `</span>`;
        // a missing animation: try without the variation selector, then the plain emoji; a GIF: the .gif version
        $("mxMsgs").addEventListener("error", (e) => {
            const img = e.target;
            if (!img || img.tagName !== "IMG") return;
            if (img.closest(".mx-emo")) {
                if (img.dataset.alt2) { const y = img.dataset.alt2; img.dataset.alt2 = ""; img.src = `${NOTO}${y}/512.webp`; return; }
                const t = document.createElement("i"); t.className = "mx-emo-t"; t.textContent = img.alt; img.replaceWith(t);
            } else if (img.dataset.gifFallback) { const f = img.dataset.gifFallback; img.dataset.gifFallback = ""; img.src = f; }
        }, true);
        const gifHtml = (body) => {
            const g = GIF_RE.exec(body.trim());
            let w = Math.max(1, +g[2]), h = Math.max(1, +g[3]);
            const k = Math.min(180 / h, 260 / w); w = Math.round(w * k); h = Math.round(h * k);
            const base = `https://media.giphy.com/media/${g[1]}/`;
            return `<a class="mx-gif" href="https://giphy.com/gifs/${g[1]}" target="_blank" rel="noopener" title="Open on GIPHY"><img src="${base}200.webp" data-gif-fallback="${base}200.gif" width="${w}" height="${h}" alt="GIF" loading="lazy" decoding="async"><span>GIF</span></a>`;
        };
        const linkify = (h) => h.replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
        const tm = (iso) => { const d = asDate(iso); return isNaN(d) ? "" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); };
        const dayKey = (iso) => { const d = asDate(iso); return isNaN(d) ? "" : d.toDateString(); };
        const dayName = (iso) => {
            const d = asDate(iso), t = new Date(), y = new Date(); y.setDate(t.getDate() - 1);
            if (d.toDateString() === t.toDateString()) return "Today";
            if (d.toDateString() === y.toDateString()) return "Yesterday";
            return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === t.getFullYear() ? undefined : "numeric" });
        };
        // call cards: "Missed call from Sandy", "Call ended · 3m 49s" … (states from /meetings/calls)
        const callStates = new Map();
        let callQ = new Set(), callT = null;
        const dur = (a, b) => { const sec = Math.max(0, Math.round((asDate(b) - asDate(a)) / 1000)); const h = Math.floor(sec / 3600), mi = Math.floor((sec % 3600) / 60), sc = sec % 60; return h ? `${h}h ${mi}m` : mi ? `${mi}m ${sc}s` : `${sc}s`; };
        const PHONE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 15.5c-1.2 0-2.4-.2-3.6-.6a1 1 0 0 0-1 .25l-2.2 2.2a15 15 0 0 1-6.6-6.6l2.2-2.2a1 1 0 0 0 .25-1A11.4 11.4 0 0 1 9.5 4a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1 17 17 0 0 0 17 17 1 1 0 0 0 1-1v-3.5a1 1 0 0 0-1-1z"/></svg>';
        const callCard = (id, mine, who, at) => {
            const c = callStates.get(id), o = c ? c.outcome : -1, name = esc(who);
            let kind = "", title, sub = tm(at);
            switch (o) {
                case 0: kind = "ringing"; title = mine ? "Calling…" : `${name} is calling`; break;
                case 1: kind = "live"; title = "Call in progress"; sub = `Started ${tm(c.answeredUtc || at)}`; break;
                case 2: kind = "ended"; title = "Call ended"; sub = `${tm(at)} · ${dur(c.answeredUtc || at, c.endedUtc || at)}`; break;
                case 3: case 5: kind = mine ? "ended" : "missed"; title = mine ? (o === 5 ? "Call cancelled" : "No answer") : `Missed call from ${name}`; break;
                case 4: kind = mine ? "missed" : "ended"; title = mine ? "Call declined" : "You declined the call"; break;
                default: title = mine ? "You started a call" : `${name} started a call`;
            }
            return `<span class="mx-call-ic ${kind}">${PHONE}</span><span class="mx-call-t"><b>${title}</b><small>${sub}</small></span>`;
        };
        const paintCall = (id) => $("mxMsgs").querySelectorAll(`.mx-call[data-call="${id}"]`).forEach((b) => {
            b.innerHTML = callCard(id, b.dataset.mine === "1", b.dataset.who, b.dataset.at);
            b.className = `mx-call ${b.dataset.mine === "1" ? "mine" : ""} k${callStates.get(id)?.outcome ?? ""}`;
        });
        const queueCall = (id) => {
            callQ.add(id); clearTimeout(callT);
            callT = setTimeout(async () => {
                const ids = [...callQ]; callQ = new Set();
                try {
                    const r = await fetch(`/meetings/calls?ids=${ids.join(",")}`, { headers: { Accept: "application/json" }, credentials: "same-origin" });
                    if (r.ok) (await r.json()).forEach((c) => { const k = String(c.meetingId).toLowerCase(); callStates.set(k, c); paintCall(k); });
                } catch { }
            }, 120);
        };
        const contentHtml = (body, m, mine) => {
            if (!body) return "";
            const f = FWD_RE.exec(body);
            if (f) return `<span class="mx-fwdl">&#8618; Forwarded from ${esc(f[1])}</span>` + contentHtml(body.slice(f[0].length), m, mine);
            const call = CALL_RE.exec(body.trim());
            if (call) { const id = call[1].toLowerCase(); queueCall(id); return `<div class="mx-call ${mine ? "mine" : ""}" data-call="${id}" data-mine="${mine ? 1 : 0}" data-who="${esc(m.senderName || "")}" data-at="${esc(m.sentUtc)}">${callCard(id, mine, m.senderName || "", m.sentUtc)}</div>`; }
            if (GIF_RE.test(body.trim())) return gifHtml(body);
            const e = emojiOnly(body);
            if (e) return emojiBig(e);
            return `<div class="mx-bub">${linkify(esc(body)).replace(/\n/g, "<br>")}</div>`;
        };
        // a shared file: View (in the app, js/file-view.js) and Download, separately, like the Chat page
        const mxFileHtml = (a) => {
            const name = esc(a.fileName), url = esc(a.url), type = a.contentType || "";
            const canView = !!window.SN?.canView?.(type);
            const data = `data-fv-url="${url}" data-fv-name="${name}" data-fv-type="${esc(type)}" data-fv-size="${Number(a.sizeBytes) || 0}"`;
            const acts = `<span class="mx-fv">`
                + (canView ? `<button type="button" class="mx-fv-btn view" data-fv-view title="View" aria-label="View ${name}">${FV_EYE}<span>View</span></button>` : "")
                + `<a class="mx-fv-btn" href="${url}?dl=1" download="${name}" title="Download" aria-label="Download ${name}">${FV_DL}<span>Download</span></a>`
                + `</span>`;
            if (canView && /^image\//i.test(type))
                return `<div class="mx-img-card" ${data}><button type="button" class="mx-img" data-fv-view title="View ${name}"><img src="${url}" alt="${name}" loading="lazy" /></button>${acts}</div>`;
            return `<div class="mx-file" ${data}><span class="mx-file-ext">${esc((a.fileName.split(".").pop() || "file").slice(0, 4))}</span><span class="mx-file-n">${name}</span>${acts}</div>`;
        };
        const msgHtml = (m) => {
            const mine = isMineMsg(m);
            const file = m.attachment ? mxFileHtml(m.attachment) : "";
            const where = m.fromGroup && open && open.isDirect ? `<span class="mx-where">in ${esc(m.fromGroup)}</span>` : "";
            const quote = m.replyToId
                ? `<button type="button" class="mx-q" data-jump="${esc(m.replyToId)}" title="Show the message this replies to"><b>${esc(m.replyToSender || "Deleted message")}</b><span>${esc(m.replyToSender ? (m.replyToText || "") : "The original was deleted")}</span></button>` : "";
            const lbl = (t) => `<span class="mx-al">${t}</span>`;
            // like the Chat page: a reaction bar above the message (8 quick emoji, + for any emoji, reply, forward),
            // and for your own messages a blue pencil (edit) and a red bin (delete) beside it
            const call = isCallCard(m.body);
            const acts = `<span class="mx-quick" role="toolbar" aria-label="React or reply">`
                + QUICK.map((e) => `<button type="button" data-pick="${e}" aria-label="React ${e}">${e}</button>`).join("")
                + `<button type="button" class="mq-more" data-mx="more" title="More reactions" aria-label="More reactions">${ICON.plus}</button>`
                + (call ? "" : `<span class="mq-sep" aria-hidden="true"></span>`
                    + (m.fromGroup ? "" : `<button type="button" class="mq-reply" data-mx="reply" title="Reply" aria-label="Reply to this message">${ICON.reply}</button>`)
                    + `<button type="button" class="mq-fwd" data-mx="fwd" title="Forward" aria-label="Forward this message">${ICON.fwd}</button>`)
                + `</span>`
                + (canEdit(m) ? `<button type="button" class="mx-edit-btn" data-mx="edit" title="Edit message (↑ in an empty box edits your last one)" aria-label="Edit message">${ICON.edit}</button>` : "")
                + (mine ? `<button type="button" class="mx-del-btn" data-mx="del" title="Delete message" aria-label="Delete message">${ICON.del}</button>` : "");
            const sid = mine ? lcid(cfg.userId) : lcid(m.senderId);
            const ini = mine ? initials(myName) : (m.senderInitials || initials(m.senderName || "?"));
            const tone = mine ? myTone : Number(m.senderTone) || 0;
            const av = `<span class="mx-mav avatar av-36 tone-${tone}"${sid ? ` data-user="${esc(sid)}"` : ""} title="${esc(mine ? "You" : m.senderName)}">${esc(ini)}</span>`;
            const meta = `<div class="mx-meta">${mine ? "<b>You</b>" : `<b>${esc(m.senderName || "")}</b>`} · ${tm(m.sentUtc)}${where}</div>`;
            const content = contentHtml(m.body || "", m, mine);
            const kind = CALL_RE.test((m.body || "").trim()) ? "is-call" : emojiOnly(m.body || "") ? "is-emoji" : "";
            return `<div class="mx-m ${mine ? "mine" : ""} ${kind}" data-mid="${esc(m.id)}" data-sender="${esc(mine ? "me" : sid || lcid(m.senderName))}" data-at="${esc(m.sentUtc)}">`
                + av + `<div class="mx-col">${meta}${quote}<div class="mx-body">${content}${file}${m.editedUtc ? '<i class="mx-ed2" title="Edited">Edited</i>' : ""}${acts}</div>`
                + `<span class="mx-reacts" data-mid="${esc(m.id)}"></span></div></div>`;
        };
        const msgEl = (id) => $("mxMsgs").querySelector(`.mx-m[data-mid="${CSS.escape(String(id))}"]`);
        const paintReacts = (id, bump) => {
            const box = $("mxMsgs").querySelector(`.mx-reacts[data-mid="${CSS.escape(String(id))}"]`);
            if (!box) return;
            const groups = new Map();
            (reacts.get(Number(id)) || []).forEach((r) => { if (!groups.has(r.emoji)) groups.set(r.emoji, []); groups.get(r.emoji).push(r); });
            box.innerHTML = [...groups].map(([emoji, who]) => {
                const minePick = who.some((r) => lcid(r.userId) === me);
                const names = who.map((r) => lcid(r.userId) === me ? "You" : r.name).join(", ");
                return `<button type="button" class="mx-rc${minePick ? " mine" : ""}${bump ? " bump" : ""}" data-rc="${emoji}" title="${esc(names)}" aria-pressed="${minePick}"><span>${emoji}</span><b>${who.length}</b></button>`;
            }).join("");
            box.classList.toggle("has", groups.size > 0);
        };
        const loadReacts = async (ids) => {
            if (!ids.length) return;
            try {
                const r = await fetch(`/chat/reactions?ids=${ids.join(",")}`, { headers: { Accept: "application/json" }, credentials: "same-origin" });
                if (!r.ok) return;
                const by = new Map();
                (await r.json()).forEach((x) => { const k = Number(x.messageId); if (!by.has(k)) by.set(k, []); by.get(k).push(x); });
                by.forEach((list, id) => { reacts.set(id, list); paintReacts(id, false); });
            } catch { }
        };
        const react = async (id, emoji) => {
            id = Number(id);
            const list = (reacts.get(id) || []).slice();
            const i = list.findIndex((r) => r.emoji === emoji && lcid(r.userId) === me);
            if (i >= 0) list.splice(i, 1); else list.push({ messageId: id, emoji, userId: me, name: "You" });
            reacts.set(id, list); paintReacts(id, true);                 // straight away; the server's answer corrects it
            try {
                const err = await hub.invoke("ReactToMessage", id, emoji);
                if (err) { toast(err); loadReacts([id]); }
            } catch { loadReacts([id]); }
        };
        const append = (m) => {
            if (shown.has(m.id)) return;
            shown.add(m.id);
            msgs.set(Number(m.id), m);
            const box = $("mxMsgs");
            const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
            box.querySelector(".mx-empty")?.remove();
            let prev = [...box.querySelectorAll(".mx-m:not(.mx-up)")].pop();
            // a new day: "Today", "Yesterday", "Thu, 19 Nov" between the messages
            if (!prev || dayKey(prev.dataset.at) !== dayKey(m.sentUtc)) {
                box.insertAdjacentHTML("beforeend", `<div class="mx-day"><span>${dayName(m.sentUtc)}</span></div>`);
                prev = null;
            }
            box.insertAdjacentHTML("beforeend", msgHtml(m));
            // the same person again within 5 minutes: one group (name and picture once, like the Chat page)
            const el = box.lastElementChild;
            if (prev && box.lastElementChild.previousElementSibling === prev && prev.dataset.sender === el.dataset.sender
                && !el.classList.contains("is-call") && !prev.classList.contains("is-call")
                && Math.abs(asDate(el.dataset.at) - asDate(prev.dataset.at)) < 5 * 60000) el.classList.add("cont");
            if (atEnd || isMineMsg(m)) box.scrollTop = box.scrollHeight;
        };
        const removeMsg = (id) => {
            msgEl(id)?.remove();
            msgs.delete(Number(id)); reacts.delete(Number(id));
            if (ctx && Number(ctx.id) === Number(id)) setCtx(null);
            // replies to it now say the original was deleted
            $("mxMsgs").querySelectorAll(`.mx-q[data-jump="${CSS.escape(String(id))}"]`).forEach((q) => { q.innerHTML = "<b>Deleted message</b><span>The original was deleted</span>"; });
        };
        const applyEdit = (m) => {
            if (!shown.has(m.id)) return;
            const old = msgs.get(Number(m.id)) || {};
            const next = { ...old, ...m };
            msgs.set(Number(m.id), next);
            const el = msgEl(m.id);
            if (!el) return;
            const keep = el.querySelector(".mx-reacts")?.innerHTML || "";
            const cont = el.classList.contains("cont");
            el.outerHTML = msgHtml(next);
            const fresh = msgEl(m.id);
            if (cont) fresh?.classList.add("cont");
            const box = fresh?.querySelector(".mx-reacts");
            if (box) { box.innerHTML = keep; box.classList.toggle("has", !!keep.trim()); }
            fresh?.classList.add("flash");
        };

        // ----- reply / edit: a bar above the message box -----
        let ctx = null;                     // { kind: "reply" | "edit", id }
        const setCtx = (c) => {
            ctx = c;
            const bar = $("mxCtx"), input = $("mxInput");
            if (!c) {
                bar.hidden = true;
                if (input.dataset.editing) { input.value = ""; delete input.dataset.editing; }
                input.placeholder = "Reply…";
                return;
            }
            const m = msgs.get(Number(c.id));
            if (!m) { ctx = null; bar.hidden = true; return; }
            $("mxCtxTitle").textContent = c.kind === "edit" ? "Editing your message" : `Replying to ${isMineMsg(m) ? "yourself" : m.senderName}`;
            const t = plainOf(m);
            $("mxCtxText").textContent = t.length > 90 ? t.slice(0, 90) + "…" : t;
            bar.dataset.kind = c.kind;
            bar.hidden = false;
            if (c.kind === "edit") { input.value = unFwd(m.body); input.dataset.editing = "1"; input.placeholder = "Edit your message…"; }
            else { if (input.dataset.editing) { input.value = ""; delete input.dataset.editing; } input.placeholder = `Reply to ${isMineMsg(m) ? "yourself" : m.senderName}…`; }
            setTimeout(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 30);
        };
        $("mxCtxX").onclick = () => setCtx(null);
        $("mxInput").addEventListener("keydown", (e) => {
            if (e.key === "Escape" && ctx) { e.preventDefault(); e.stopPropagation(); setCtx(null); }
            if (e.key === "ArrowUp" && !e.target.value && !ctx) {        // ↑ in an empty box: edit your last message
                const last = [...msgs.values()].reverse().find(canEdit);
                if (last) { e.preventDefault(); startEdit(last.id); }
            }
        });
        const token = () => document.querySelector('input[name="__RequestVerificationToken"]')?.value || "";
        const postForm = async (url, fields) => {
            const fd = new FormData();
            Object.entries(fields || {}).forEach(([k, v]) => fd.append(k, v));
            fd.append("__RequestVerificationToken", token());
            const r = await fetch(url, { method: "POST", body: fd, headers: { RequestVerificationToken: token(), Accept: "application/json" }, credentials: "same-origin" });
            let d = null; try { d = await r.json(); } catch { }
            if (!r.ok) throw new Error(d?.error || "Something went wrong. Try again.");
            return d;
        };

        // ----- the quick emoji row (one at a time) -----
        const closePicker = () => $("mxMsgs").querySelectorAll(".mx-pick").forEach((p) => p.remove());
        const openPicker = (el) => {
            const had = el.querySelector(".mx-pick");
            closePicker();
            if (had) return;
            el.insertAdjacentHTML("beforeend", `<span class="mx-pick" role="menu" aria-label="Pick a reaction">${QUICK.map((e) => `<button type="button" data-pick="${e}" role="menuitem">${e}</button>`).join("")}<button type="button" class="mx-more" data-mx="more" role="menuitem" title="More emoji" aria-label="More emoji">+</button></span>`);
        };
        // ----- edit in place (like the Chat page): the text turns into a box with Cancel / Save -----
        function stopEdit(el) {
            if (!el) return;
            el.classList.remove("mx-editing");
            el.querySelector(".mx-editor")?.remove();
            const c = el.querySelector(".mx-bub");
            if (c) c.hidden = false;
        }
        function startEdit(id) {
            const el = msgEl(id), m = msgs.get(Number(id));
            if (!el || !m || !canEdit(m)) return;
            $("mxMsgs").querySelectorAll(".mx-m.mx-editing").forEach(stopEdit);
            const bub = el.querySelector(".mx-bub");
            if (!bub) return;
            el.classList.add("mx-editing");
            bub.hidden = true;
            const doc = el.ownerDocument;
            const ed = doc.createElement("form");
            ed.className = "mx-editor";
            ed.innerHTML = `<textarea rows="1" maxlength="4000" aria-label="Edit your message"></textarea>
                <div class="mx-editor-row"><small>Enter to save · Esc to cancel</small>
                    <span><button type="button" class="mx-editor-cancel">Cancel</button><button type="submit" class="mx-editor-save"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12l5 5L20 6" /></svg> Save</button></span></div>`;
            bub.after(ed);
            const ta = ed.querySelector("textarea");
            const original = m.body || "";
            ta.value = original;
            const size = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 220) + "px"; };
            size();
            ta.addEventListener("input", size);
            ta.focus();
            ta.setSelectionRange(ta.value.length, ta.value.length);
            const cancel = () => { stopEdit(el); $("mxInput")?.focus(); };
            ed.querySelector(".mx-editor-cancel").addEventListener("click", cancel);
            ta.addEventListener("keydown", (e) => {
                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); }
                if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); ed.requestSubmit(); }
            });
            ed.addEventListener("submit", async (e) => {
                e.preventDefault();
                const text = ta.value.trim();
                if (text === original.trim()) { cancel(); return; }
                if (!text) { toast("A message can't be empty. To remove it, delete it."); return; }
                const save = ed.querySelector(".mx-editor-save");
                save.disabled = true;
                try {
                    const upd = await postForm(`/chat/messages/${id}/edit`, { body: text });
                    if (upd) applyEdit(upd); else stopEdit(el);
                    $("mxInput")?.focus();
                } catch (err) { toast(err.message || "The message wasn't changed."); save.disabled = false; }
            });
        }
        $("mxMsgs").addEventListener("click", async (e) => {
            const el = e.target.closest(".mx-m");
            const pick = e.target.closest("[data-pick]");
            if (pick && el) { closePicker(); react(el.dataset.mid, pick.dataset.pick); return; }
            const chip = e.target.closest("[data-rc]");
            if (chip && el) { react(el.dataset.mid, chip.dataset.rc); return; }
            const jump = e.target.closest(".mx-q[data-jump]");
            if (jump) {
                const t = msgEl(jump.dataset.jump);
                if (t) { t.scrollIntoView({ block: "center", behavior: "smooth" }); t.classList.remove("flash"); void t.offsetWidth; t.classList.add("flash"); }
                else toast("That message is further back. Open the chat to see it.");
                return;
            }
            const act = e.target.closest("[data-mx]");
            if (!act || !el) {
                if (!e.target.closest(".mx-pick")) closePicker();
                // a tap on a message keeps its actions (Edit, Reply, …) showing; a tap elsewhere hides them
                const tapMsg = !e.target.closest("a, button") && e.target.closest(".mx-body") && el;
                $("mxMsgs").querySelectorAll(".mx-m.acts-on").forEach((x) => { if (x !== tapMsg) x.classList.remove("acts-on"); });
                if (tapMsg) tapMsg.classList.toggle("acts-on");
                return;
            }
            const id = el.dataset.mid, m = msgs.get(Number(id));
            if (!m) return;
            closePicker();
            if (act.dataset.mx === "more") {
                // the full emoji panel, right by the + (like the Chat page); the bar stays up while it's open
                el.classList.add("acts-open");
                window.SNEmoji?.open(act, { title: "React with any emoji", onPick: (emo) => react(id, emo), onClose: () => el.classList.remove("acts-open") });
                return;
            }
            if (act.dataset.mx === "fwd") { openForward(m); return; }
            if (act.dataset.mx === "reply") setCtx({ kind: "reply", id });
            else if (act.dataset.mx === "edit") startEdit(id);
            else if (act.dataset.mx === "del") {
                // like the Chat page: ask first
                askDelete(async () => {
                    el.classList.add("going");
                    try { await postForm(`/chat/messages/${id}/delete`); removeMsg(id); }
                    catch (err) { el.classList.remove("going"); toast(err.message || "The message could not be deleted."); }
                });
            }
        });
        function askDelete(onYes) {
            $("mxConfirm")?.remove();
            $("mxChat").insertAdjacentHTML("beforeend", `<div class="mx-confirm" id="mxConfirm" role="alertdialog" aria-modal="true" aria-labelledby="mxConfirmT">
                <div class="mx-confirm-card">
                    <span class="mx-confirm-ic" aria-hidden="true">${ICON.del}</span>
                    <b id="mxConfirmT">Delete message</b>
                    <p>Delete this message for everyone in the chat? A file attached to it is deleted too.</p>
                    <div class="mx-confirm-row"><button type="button" data-no>Cancel</button><button type="button" class="danger" data-yes>Delete</button></div>
                </div></div>`);
            const box = $("mxConfirm");
            const close = () => box.remove();
            box.querySelector("[data-no]").onclick = close;
            box.querySelector("[data-yes]").onclick = () => { close(); onYes(); };
            box.addEventListener("click", (e) => { if (e.target === box) close(); });
            box.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } });
            setTimeout(() => box.querySelector("[data-yes]").focus(), 30);
        }
        document.addEventListener("click", (e) => { if (!e.target.closest("#mxMsgs")) closePicker(); });

        // ----- forward: pick up to 10 of your chats, add a note if you like -----
        function openForward(m) {
            $("mxFwd")?.remove();
            const pickedF = new Set();
            const src = msgs.get(Number(m.id)) || m;
            const preview = plainOf(src);
            $("mxChat").insertAdjacentHTML("beforeend", `<div class="mx-fwd" id="mxFwd" role="dialog" aria-label="Forward message">
                <div class="mx-fwd-head"><b>Forward message</b><button type="button" class="mx-ctx-x" data-fwd-x aria-label="Close" title="Close (Esc)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button></div>
                <div class="mx-fwd-prev"><small>${esc(src.senderName || "")}</small><span>${esc(preview.length > 140 ? preview.slice(0, 140) + "…" : preview)}</span></div>
                <input type="search" class="mx-fwd-q" placeholder="Search your chats" aria-label="Search your chats" />
                <div class="mx-fwd-list" role="listbox" aria-multiselectable="true"></div>
                <input type="text" class="mx-fwd-note" maxlength="1000" placeholder="Add a note (optional)" aria-label="Add a note" />
                <div class="mx-fwd-foot"><small class="mx-fwd-n">Pick up to 10 chats</small><button type="button" class="mx-fwd-send" disabled>Forward</button></div>
            </div>`);
            const dlg = $("mxFwd"), list = dlg.querySelector(".mx-fwd-list"), q = dlg.querySelector(".mx-fwd-q"), send = dlg.querySelector(".mx-fwd-send");
            const paintF = () => {
                const t = q.value.trim().toLowerCase();
                const shownChats = chats.filter((c) => !t || c.name.toLowerCase().includes(t));
                list.innerHTML = shownChats.length ? shownChats.map((c) => `<label class="mx-fwd-row ${pickedF.has(c.id) ? "on" : ""}">
                    <input type="checkbox" value="${esc(c.id)}" ${pickedF.has(c.id) ? "checked" : ""} />
                    <span class="mx-av"><span class="avatar av-28 tone-${Number(c.tone) || 0}"${c.isDirect && c.userId ? ` data-user="${esc(lcid(c.userId))}"` : ""}>${esc(c.initials)}</span></span>
                    <span class="mx-fwd-nm">${esc(c.name)}<small>${c.isDirect ? "Person" : "Group"}</small></span></label>`).join("")
                    : `<p class="mx-empty">No chats match.</p>`;
                const n = pickedF.size;
                dlg.querySelector(".mx-fwd-n").textContent = n ? `${n} picked` : "Pick up to 10 chats";
                send.disabled = n === 0;
                send.textContent = n > 1 ? `Forward to ${n}` : "Forward";
            };
            list.addEventListener("change", (e) => {
                const c = e.target;
                if (!c.matches("input[type=checkbox]")) return;
                if (c.checked && pickedF.size >= 10) { c.checked = false; toast("You can forward to 10 chats at a time."); return; }
                c.checked ? pickedF.add(c.value) : pickedF.delete(c.value);
                paintF();
            });
            q.addEventListener("input", paintF);
            const closeF = () => dlg.remove();
            dlg.querySelector("[data-fwd-x]").onclick = closeF;
            dlg.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeF(); } });
            send.onclick = async () => {
                send.disabled = true; send.textContent = "Forwarding…";
                const fd = new FormData();
                fd.append("from", src.channelId || open.id);
                pickedF.forEach((id) => fd.append("to", id));
                fd.append("note", dlg.querySelector(".mx-fwd-note").value);
                fd.append("__RequestVerificationToken", token());
                try {
                    const r = await fetch(`/chat/messages/${src.id}/forward`, { method: "POST", body: fd, headers: { RequestVerificationToken: token(), Accept: "application/json" }, credentials: "same-origin" });
                    let d = null; try { d = await r.json(); } catch { }
                    if (!r.ok) throw new Error(d?.error || "Couldn't forward. Try again.");
                    closeF();
                    toast(d?.message || "Forwarded.");
                } catch (err) { toast(err.message); paintF(); }
            };
            if (!loaded) loadChats().then(paintF); else paintF();
            setTimeout(() => q.focus(), 40);
        }

        // ----- attach a file (the clip, or paste / drop a file onto the chat) -----
        function upload(file) {
            if (!file || !open) return;
            const c = open;
            const row = document.createElement("div");
            row.className = "mx-m mine mx-up";
            row.innerHTML = `<div class="mx-col"><div class="mx-meta"><b>You</b> · Uploading…</div><div class="mx-body"><div class="mx-bub">&#128206; ${esc(file.name)}<span class="mx-bar"><i></i></span></div></div></div>`;
            const box = $("mxMsgs");
            box.querySelector(".mx-empty")?.remove();
            box.appendChild(row); box.scrollTop = box.scrollHeight;
            const fd = new FormData();
            fd.append("file", file);
            fd.append("__RequestVerificationToken", token());
            const xhr = new XMLHttpRequest();
            xhr.open("POST", `/chat/${c.id}/upload`);
            xhr.setRequestHeader("RequestVerificationToken", token());
            xhr.setRequestHeader("Accept", "application/json");
            xhr.upload.onprogress = (e) => { if (e.lengthComputable) row.querySelector(".mx-bar i").style.width = `${Math.round(e.loaded * 100 / e.total)}%`; };
            xhr.onload = () => {
                let d = null; try { d = JSON.parse(xhr.responseText); } catch { }
                row.remove();
                if (xhr.status >= 200 && xhr.status < 300 && d && d.id) {
                    if (open === c) append(d);
                    c.lastUtc = d.sentUtc; toTop(c);
                } else toast(d?.error || (xhr.status === 413 ? "That file is too big." : "Couldn't upload the file. Try again."));
            };
            xhr.onerror = () => { row.remove(); toast("Couldn't upload the file. Check your connection."); };
            xhr.send(fd);
        }
        $("mxFile")?.addEventListener("change", (e) => { [...e.target.files].slice(0, 5).forEach(upload); e.target.value = ""; });
        $("mxInput").addEventListener("paste", (e) => {
            const files = [...(e.clipboardData?.files || [])];
            if (files.length) { e.preventDefault(); files.slice(0, 5).forEach(upload); }
        });
        const chatBox = $("mxChat");
        chatBox.addEventListener("dragover", (e) => { if (open && [...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); chatBox.classList.add("drop"); } });
        chatBox.addEventListener("dragleave", (e) => { if (!chatBox.contains(e.relatedTarget)) chatBox.classList.remove("drop"); });
        chatBox.addEventListener("drop", (e) => {
            chatBox.classList.remove("drop");
            const files = [...(e.dataTransfer?.files || [])];
            if (files.length && open) { e.preventDefault(); files.slice(0, 5).forEach(upload); }
        });
        const visible = () => pane === "msgs" && panelShown();
        const markRead = (c) => {
            if (c.unread) { c.unread = 0; paintList(); }
            if (hub.state === "Connected") hub.invoke("MarkRead", c.id).catch(() => { });
        };
        const toTop = (c) => { chats = [c, ...chats.filter((x) => x !== c)]; };
        // ----- earlier messages: scroll to the top (or press "Show earlier messages") for 50 more -----
        let older = { has: false, busy: false };
        const paintOlder = () => {
            const box = $("mxMsgs");
            let b = box.querySelector(".mx-older");
            if (!older.has) { b?.remove(); return; }
            if (!b) { box.insertAdjacentHTML("afterbegin", `<button type="button" class="mx-older">Show earlier messages</button>`); b = box.querySelector(".mx-older"); }
            else box.prepend(b);
            b.disabled = older.busy;
            b.textContent = older.busy ? "Loading earlier messages…" : "Show earlier messages";
        };
        async function loadOlder() {
            if (!open || !older.has || older.busy) return;
            const box = $("mxMsgs"), c = open;
            const ids = [...msgs.keys()];
            if (!ids.length) return;
            older.busy = true; paintOlder();
            try {
                const r = await fetch(`/chat/${c.id}/messages?before=${Math.min(...ids)}`, { headers: { Accept: "application/json" }, credentials: "same-origin" });
                const d = r.ok ? await r.json() : null;
                if (open !== c || !d) return;
                const fromBottom = box.scrollHeight - box.scrollTop;
                // all of it again, oldest first (days and groups stay right), then back to where you were
                const all = [...d.messages, ...[...msgs.values()].sort((a, b) => a.id - b.id)];
                const keepReacts = new Map(reacts);
                box.innerHTML = ""; shown.clear(); msgs.clear();
                all.forEach(append);
                keepReacts.forEach((list, id) => { reacts.set(id, list); paintReacts(id, false); });
                older.has = !!d.hasOlder;
                box.scrollTop = box.scrollHeight - fromBottom;
                loadReacts(d.messages.map((m) => m.id));
            } catch { toast("Couldn't load earlier messages. Try again."); }
            finally { older.busy = false; paintOlder(); }
        }
        $("mxMsgs").addEventListener("scroll", () => { if ($("mxMsgs").scrollTop < 60) loadOlder(); }, { passive: true });
        $("mxMsgs").addEventListener("click", (e) => { if (e.target.closest(".mx-older")) loadOlder(); });

        async function openChat(id) {
            if (!chats.length) await loadChats();
            const c = chats.find((x) => sameId(x.id, id));
            if (!c) return;
            open = c;
            shown.clear();
            $("mxList").hidden = true;
            $("mxChat").hidden = false;
            $("mxName").textContent = c.name;
            const av = $("mxAv");
            av.textContent = c.initials;
            av.className = `avatar av-32 tone-${Number(c.tone) || 0}`;
            av.style.removeProperty("background-image");
            if (c.isDirect && c.userId) { av.setAttribute("data-user", lcid(c.userId)); team.paintPhotos(av); } else av.removeAttribute("data-user");
            const hd = $("mxName").parentNode;
            hd.querySelector(".mx-hst")?.remove();
            if (c.isDirect && c.userId) $("mxName").insertAdjacentHTML("afterend", `<small class="mx-hst st-label" data-st-user="${esc(lcid(c.userId))}"></small>`), team.paintStatus(hd);
            msgs.clear(); reacts.clear(); setCtx(null);
            $("mxOpen").href = `/chat/${c.id}`;
            // the chat this call came from: say so, and offer the call's own chat
            const linked = !!cfg.chatId && sameId(c.id, cfg.chatId);
            if ($("mxCallChat")) $("mxCallChat").hidden = !linked;
            if (linked && $("paneSub")) $("paneSub").textContent = `Your chat with ${c.name}`;
            $("mxMsgs").innerHTML = `<div class="mx-empty">Loading…</div>`;
            try {
                const r = await fetch(`/chat/${c.id}/recent`, { headers: { Accept: "application/json" }, credentials: "same-origin" });
                const d = r.ok ? await r.json() : null;
                if (open !== c) return;
                $("mxMsgs").innerHTML = d && d.messages.length ? "" : `<div class="mx-empty">${d ? "No messages yet. Say hello!" : "Couldn't load the messages."}</div>`;
                older = { has: !!d?.hasOlder, busy: false };
                (d?.messages || []).forEach(append);
                paintOlder();
                $("mxMsgs").scrollTop = $("mxMsgs").scrollHeight;
                loadReacts((d?.messages || []).map((m) => m.id));
                if (older.has && $("mxMsgs").scrollHeight <= $("mxMsgs").clientHeight + 40) loadOlder();   // a short list: fill the space
            } catch { $("mxMsgs").innerHTML = `<div class="mx-empty">Couldn't load the messages.</div>`; }
            markRead(c);
            setTimeout(() => $("mxInput").focus(), 50);
        }
        const backToList = () => { $("mxFwd")?.remove(); setCtx(null); open = null; $("mxChat").hidden = true; $("mxList").hidden = false; paintList(); };
        $("mxBack").onclick = backToList;
        $("mxList").addEventListener("click", (e) => { const b = e.target.closest(".mx-row"); if (b) openChat(b.dataset.id); });
        $("mxForm").addEventListener("submit", async (e) => {
            e.preventDefault();
            const input = $("mxInput"), text = input.value.trim();
            if (!text || !open) return;
            if (ctx && ctx.kind === "edit") {
                const id = ctx.id, m = msgs.get(Number(id));
                if (m && text === unFwd(m.body).trim()) { setCtx(null); return; }     // nothing changed
                try { const upd = await postForm(`/chat/messages/${id}/edit`, { body: text }); setCtx(null); input.value = ""; if (upd) applyEdit(upd); }
                catch (err) { toast(err.message); }
                return;
            }
            const replyTo = ctx && ctx.kind === "reply" ? Number(ctx.id) : null;
            input.value = "";
            setCtx(null);
            try {
                const m = await hub.invoke("SendMessage", open.id, text, replyTo);
                if (!m) throw new Error();
                append(m);
                open.lastUtc = m.sentUtc;
                toTop(open);
            } catch { input.value = text; if (replyTo) setCtx({ kind: "reply", id: replyTo }); toast("Couldn't send. Check your connection and try again."); }
        });
        const openMessages = (id) => {
            if (!window.__snPopDoc) setPanel(true);
            showPane("msgs");
            if (id && !(open && sameId(open.id, id) && !$("mxChat").hidden)) openChat(id);
            else if (id && cfg.chatId && sameId(id, cfg.chatId) && $("paneSub")) $("paneSub").textContent = `Your chat with ${open.name}`;
        };
        window.__snOpenIs = (id) => !!open && sameId(open.id, id) && !$("mxChat").hidden;
        window.__snOpenMessages = openMessages;
        $("ccLinked")?.addEventListener("click", () => { if (!cfg.chatId) return; window.__snPreferCallChat = false; openMessages(cfg.chatId); });
        $("mxCallChat")?.addEventListener("click", () => { window.__snPreferCallChat = true; showPane("chat"); });
        window.__snMsgsShown = () => { if (!loaded) loadChats(); else paintList(); if (open) markRead(open); };
        hub.on("MessageReceived", (m) => {
            if (!m || isCallCard(m.body)) return;
            const mine = String(m.senderId).toLowerCase() === me;
            const c = chats.find((x) => sameId(x.id, m.channelId));
            if (open && sameId(open.id, m.channelId)) {
                append(m);
                if (visible()) markRead(open); else if (!mine) open.unread = (open.unread || 0) + 1;
            } else if (c && !mine) c.unread = (c.unread || 0) + 1;
            if (c) { c.lastUtc = m.sentUtc; toTop(c); paintList(); }
            else if (loaded) loadChats();                                       // a chat that's new to the list
            if (!mine && !(open && sameId(open.id, m.channelId) && visible())) {
                const plain = unFwd(m.body);
                const preview = isGifCard(plain.replace(/^↪ /, "")) ? "🎞️ Sent a GIF" : plain ? (plain.length > 80 ? plain.slice(0, 80) + "…" : plain) : "Sent a file";
                notice(m.fromGroup ? `${m.senderName} · ${m.fromGroup}` : m.senderName, preview, "msg",
                    { text: "Open", onClick: () => openMessages(m.channelId) });
            }
        });
        hub.on("MessageEdited", (m) => { if (m && open) applyEdit(m); });
        hub.on("MessageDeleted", (cid, mid) => { if (open && shown.has(Number(mid))) removeMsg(mid); });
        hub.on("MessageReactions", (id, list) => {
            if (!open || !shown.has(Number(id))) return;
            reacts.set(Number(id), list || []);
            paintReacts(Number(id), true);
        });
        team.listeners.push(() => { if (!$("mxList").hidden) paintList(); });

        // M opens Messages (when the page, not the video, has the keyboard)
        document.addEventListener("keydown", (e) => {
            if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest("input, textarea, [contenteditable]")) return;
            if (e.key === "m" || e.key === "M") { e.preventDefault(); openMessages(); }
        });
        document.addEventListener("visibilitychange", () => { if (!document.hidden) loadChats(); });
        loadChats();
    }


    // =====================================================================
    // Emoji: the 😊 by a message box (Chat and Inbox) opens the shared emoji panel (js/emoji-picker.js);
    // the emoji goes where you're typing and the panel stays open to pick a few.
    // =====================================================================
    const emojiPanel = {
        open(anchorEl, onPick, o = {}) {
            if (!window.SNEmoji) { toast("Emoji are still loading. Try again in a moment."); return; }
            window.SNEmoji.open(anchorEl, { onPick, keepOpen: !o.once, title: o.title });
        }
    };
    const onEmojiButton = (e) => {
        const btn = e.target.closest("[data-emoji-for]");
        if (!btn) return;
        const input = $(btn.dataset.emojiFor) || btn.closest("form")?.querySelector("input[type=text]");
        if (!input) return;
        emojiPanel.open(btn, (emo) => {
            const a = input.selectionStart ?? input.value.length, b = input.selectionEnd ?? input.value.length;
            if (input.value.length + emo.length > (input.maxLength > 0 ? input.maxLength : 1e9)) return;
            input.value = input.value.slice(0, a) + emo + input.value.slice(b);
            input.setSelectionRange(a + emo.length, a + emo.length);
        });
    };
    document.addEventListener("click", onEmojiButton);
    window.__snEmojiButton = onEmojiButton;
    document.addEventListener("submit", () => window.SNEmoji?.close(), true);

    // =====================================================================
    // Connection bars in the top bar (in place of Jitsi's quality badge):
    // how quickly this page reaches the server, every 15 s; offline = no bars.
    // =====================================================================
    const netLevel = { n: -1, ms: 0 };
    const paintSignal = () => {
        const el = $("signal");
        const words = ["offline", "poor", "fair", "good", "very good"];
        const text = netLevel.n < 0 ? "checking" : words[netLevel.n] + (netLevel.n > 0 ? ` (${netLevel.ms} ms)` : "");
        if (el) {
            el.dataset.level = String(Math.max(0, netLevel.n));
            el.setAttribute("aria-label", `Connection: ${text}`);
            el.title = `Connection: ${text}`;
        }
        if ($("chkNet")) { $("chkNet").textContent = `Network: ${netLevel.n < 0 ? "checking" : words[netLevel.n]}`; $("chkNet").classList.toggle("bad", netLevel.n >= 0 && netLevel.n < 2); }
    };
    async function pingServer() {
        if (!navigator.onLine) { netLevel.n = 0; paintSignal(); return; }
        const t = performance.now();
        try {
            await fetch(`/favicon.svg?ping=${Date.now()}`, { method: "HEAD", cache: "no-store", credentials: "omit" });
            const ms = Math.round(performance.now() - t);
            netLevel.ms = ms;
            netLevel.n = ms < 150 ? 4 : ms < 300 ? 3 : ms < 700 ? 2 : 1;
        } catch { netLevel.n = 0; }
        paintSignal();
    }
    pingServer();
    setInterval(pingServer, 15000);
    window.addEventListener("online", pingServer);
    window.addEventListener("offline", pingServer);

    // =====================================================================
    // Your own camera, small, over the video (Jitsi's thumbnail column is hidden).
    // Only when the browser has already allowed the camera here (no extra permission question),
    // only while your camera is on and Grid is off. Drag it to any corner; × hides it.
    // =====================================================================
    (function selfView() {
        const box = $("selfView"), video = $("selfVideo"), showBtn = $("selfShow");
        if (!box || !navigator.mediaDevices?.getUserMedia) return;
        let stream = null, starting = false, camIsOff = false, hiddenByUser = false, allowed = false;
        try { hiddenByUser = localStorage.getItem("sn-self-view") === "0"; } catch { }
        try { const c = localStorage.getItem("sn-self-corner"); if (c) box.dataset.corner = c; } catch { }
        if (!box.dataset.corner) box.dataset.corner = "br";
        const stop = () => { if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; video.srcObject = null; } };
        const want = () => allowed && joinedAt && !camIsOff && !tileOn && !document.body.classList.contains("on-hold") && !leaving && !hiddenByUser;
        async function update() {
            showBtn.hidden = !(hiddenByUser && allowed && joinedAt && !camIsOff && !tileOn);
            if (!want()) { box.hidden = true; stop(); return; }
            box.hidden = false;
            if (stream || starting) return;
            starting = true;
            try {
                stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 320 }, height: { ideal: 180 }, frameRate: { ideal: 15 } }, audio: false });
                if (!want()) { stop(); box.hidden = true; } else { video.srcObject = stream; video.play?.().catch(() => { }); }
            } catch { box.hidden = true; allowed = false; }
            starting = false;
        }
        window.__snSelfView = update;
        // ask the browser whether the camera is already allowed here (it never shows a question for this)
        (async () => {
            try { allowed = (await navigator.permissions.query({ name: "camera" })).state === "granted"; } catch { allowed = false; }
            update();
        })();
        api.addListener("videoConferenceJoined", () => setTimeout(update, 300));
        api.addListener("videoMuteStatusChanged", ({ muted }) => { camIsOff = !!muted; update(); });
        new MutationObserver(update).observe(document.body, { attributes: true, attributeFilter: ["class"] });
        $("selfHide").onclick = (e) => { e.stopPropagation(); hiddenByUser = true; try { localStorage.setItem("sn-self-view", "0"); } catch { } update(); };
        showBtn.onclick = () => { hiddenByUser = false; try { localStorage.setItem("sn-self-view", "1"); } catch { } update(); };
        window.addEventListener("pagehide", stop);
        // drag to a corner
        let drag = null;
        box.addEventListener("pointerdown", (e) => {
            if (e.target.closest("button")) return;
            const r = box.getBoundingClientRect(), stage = box.parentElement.getBoundingClientRect();
            drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, stage };
            box.setPointerCapture(e.pointerId);
            box.classList.add("dragging");
            box.style.left = `${r.left - stage.left}px`; box.style.top = `${r.top - stage.top}px`;
        });
        box.addEventListener("pointermove", (e) => {
            if (!drag) return;
            box.style.left = `${e.clientX - drag.stage.left - drag.dx}px`;
            box.style.top = `${e.clientY - drag.stage.top - drag.dy}px`;
        });
        const drop = (e) => {
            if (!drag) return;
            const r = box.getBoundingClientRect(), st = drag.stage;
            const corner = (r.top + r.height / 2 < st.top + st.height / 2 ? "t" : "b") + (r.left + r.width / 2 < st.left + st.width / 2 ? "l" : "r");
            drag = null;
            box.classList.remove("dragging");
            box.style.left = box.style.top = "";
            box.dataset.corner = corner;
            try { localStorage.setItem("sn-self-corner", corner); } catch { }
        };
        box.addEventListener("pointerup", drop);
        box.addEventListener("pointercancel", drop);
    })();

    // =====================================================================
    // Alone in the call: "Ringing Sandy…" (or "Waiting for others"), Ring again / Add people / Copy guest link,
    // and a quick check of mic, camera and network. Goes away as soon as someone joins.
    // =====================================================================
    (function waiting() {
        const box = $("stageWait");
        if (!box) return;
        const other = cfg.callWith;
        const av = $("waitAv");
        if (other) { av.textContent = other.initials || "?"; av.classList.add(`tone-${Number(other.tone) || 0}`); }
        else { av.innerHTML = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6" /></svg>'; av.classList.add("tone-1"); }
        $("waitRing").hidden = !(hub && cfg.canRingAgain);
        $("waitAdd").hidden = !$("addPeopleBtn");
        $("waitLink").hidden = !document.querySelector(".guest-btn");
        $("waitAdd").onclick = () => $("addPeopleBtn")?.click();
        $("waitLink").onclick = () => document.querySelector(".guest-btn")?.click();
        $("waitRing").onclick = async () => {
            const b = $("waitRing");
            b.disabled = true;
            try {
                const r = await hub.invoke("RingCallAgain", cfg.meetingId);
                ringStart = Date.now();
                if (r.rung && r.rung.length) notice(`Ringing ${r.rung.join(", ")}`, "They'll join as soon as they press Accept.", "ring");
                else if (r.offline && r.offline.length) notice(`${r.offline.join(", ")} ${r.offline.length === 1 ? "is" : "are"} offline`, "They can't be rung right now.", "declined");
                else toast("Nobody new to ring.");
            } catch { toast("Couldn't ring. Try again."); }
            setTimeout(() => { b.disabled = false; }, 4000);
        };
        let ringStart = Date.now(), wasAlone = null;
        const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
        let mic = true, cam = true;
        api.addListener("audioMuteStatusChanged", ({ muted }) => { mic = !muted; paint(); });
        api.addListener("videoMuteStatusChanged", ({ muted }) => { cam = !muted; paint(); });
        function paint() {
            const alone = !!joinedAt && !leaving && !ended && othersInCall() === 0;
            if (alone !== wasAlone) {
                wasAlone = alone;
                box.hidden = !alone;
                document.body.classList.toggle("alone", alone);
                if (alone) ringStart = Date.now();
            }
            if (!alone) return;
            const t = clock(Date.now() - ringStart);
            if (other && maxPeople <= 1) {
                $("waitTitle").textContent = `Ringing ${other.name}…`;
                $("waitNote").textContent = `Ringing for ${t}. They'll appear here as soon as they answer.`;
            } else {
                $("waitTitle").textContent = maxPeople > 1 ? "Everyone else has left" : "Waiting for others to join";
                $("waitNote").textContent = maxPeople > 1 ? "You're the only one here. Ring them again, or leave the call." : `Waiting for ${t}. They'll appear here as soon as they join.`;
            }
            $("chkMic").textContent = mic ? "Mic on" : "Mic off";
            $("chkMic").classList.toggle("bad", !mic);
            $("chkCam").textContent = cam ? "Camera on" : "Camera off";
            $("chkCam").classList.toggle("bad", !cam);
        }
        // the caller hears the same ringtone the other person hears ("Harp rise"), softer, while it rings
        // (30 s, like their ringing card; "Ring again" starts it once more). Stops as soon as someone joins.
        const RING_FOR_MS = 30000, RING_EVERY_MS = 2800;
        let ringCtx = null, ringTimer = 0;
        const ringOnce = () => {
            try {
                ringCtx = ringCtx || new (window.AudioContext || window.webkitAudioContext)();
                if (ringCtx.state === "suspended") ringCtx.resume();
                if (ringCtx.state !== "running") return;
                const now = ringCtx.currentTime + 0.03;
                const note = (f, at, len, vol, type) => {
                    const o = ringCtx.createOscillator(), g = ringCtx.createGain();
                    o.type = type; o.frequency.setValueAtTime(f, at);
                    g.gain.setValueAtTime(0.0001, at);
                    g.gain.exponentialRampToValueAtTime(vol, at + 0.004);
                    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
                    o.connect(g).connect(ringCtx.destination);
                    o.start(at); o.stop(at + len + 0.05);
                };
                [392, 493.88, 587.33, 739.99, 783.99, 987.77, 1174.66].forEach((f, i) => {
                    const at = now + i * 0.09;
                    note(f, at, 1.1, 0.11, "triangle");
                    note(f * 2, at, 0.6, 0.028, "sine");
                });
            } catch { /* no sound: the "Ringing…" card still shows */ }
        };
        const ringback = (on) => {
            if (on && !ringTimer) { ringOnce(); ringTimer = setInterval(ringOnce, RING_EVERY_MS); }
            else if (!on && ringTimer) { clearInterval(ringTimer); ringTimer = 0; }
        };
        // browsers may hold sound back until the page is touched once
        ["pointerdown", "keydown"].forEach((t) => document.addEventListener(t, () => { try { ringCtx && ringCtx.state === "suspended" && ringCtx.resume(); } catch { } }, { capture: true }));
        const ringTick = () => ringback(!!other && maxPeople <= 1 && !box.hidden && !leaving && !ended && Date.now() - ringStart < RING_FOR_MS);
        setInterval(paint, 1000);
        setInterval(ringTick, 500);
        ["videoConferenceJoined", "participantJoined", "participantLeft"].forEach((ev) => api.addListener(ev, () => setTimeout(() => { paint(); ringTick(); }, 250)));
        if (hub) hub.on("CallDeclined", (meetingId) => {
            if (String(meetingId).toLowerCase() === String(cfg.meetingId).toLowerCase() && cfg.oneToOne) { ringStart = 0; ringback(false); }
        });
        window.addEventListener("pagehide", () => ringback(false));
    })();

    window.addEventListener("beforeunload", () => report("MeetingLeft"));
})();
