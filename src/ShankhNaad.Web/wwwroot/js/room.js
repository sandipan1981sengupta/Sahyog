// Sahyog · meeting room. JaaS (8x8) carries the live video; Sahyog draws its own glass controls around it.
(function () {
    "use strict";

    const cfg = JSON.parse(document.getElementById("roomConfig").textContent);
    const $ = (id) => document.getElementById(id);

    const toast = (message) => {
        const el = document.createElement("div");
        el.className = "toast";
        el.textContent = message;
        $("toasts").appendChild(el);
        setTimeout(() => el.remove(), 4500);
    };
    // a richer notice: "Sandy left the call" + their note, with a coloured icon
    const notice = (title, note, kind) => {
        const el = document.createElement("div");
        el.className = `toast room-notice ${kind || "left"}`;
        el.innerHTML = `<span class="rn-ic">${kind === "declined" ? "&#128222;" : "&#128075;"}</span>`
            + `<span class="rn-txt"><b>${esc(title)}</b>${note ? `<q>${esc(note)}</q>` : ""}</span>`;
        $("toasts").appendChild(el);
        setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 350); }, note ? 9000 : 5000);
    };

    if (typeof JitsiMeetExternalAPI === "undefined") {
        $("stageLoading").querySelector("p").textContent = "Video could not load. Check your internet connection and refresh.";
        return;
    }

    // ---------- optional real-time link (signed-in users only) for the plan's per-meeting limit ----------
    let hub = null;
    if (!cfg.isGuest && window.signalR) {
        hub = new signalR.HubConnectionBuilder().withUrl("/hubs/chat").withAutomaticReconnect().build();
        hub.start().catch(() => { });
    }
    const report = (method) => {
        if (hub && hub.state === "Connected") hub.invoke(method, cfg.meetingId).catch(() => { });
    };

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
            prejoinPageEnabled: false,
            disableDeepLinking: true,
            toolbarButtons: [],               // hide Jitsi's toolbar: Sahyog's dock below replaces it
            hideConferenceSubject: true,
            hideConferenceTimer: true,
            disableInviteFunctions: true,
            disableProfile: true,
            resolution: cfg.maxHeight,
            constraints: { video: { height: { ideal: cfg.maxHeight, max: cfg.maxHeight, min: 180 } } },
            disableShortcuts: false,
            enableNoisyMicDetection: true
        },
        interfaceConfigOverwrite: {
            SHOW_JITSI_WATERMARK: false,
            SHOW_WATERMARK_FOR_GUESTS: false,
            SHOW_BRAND_WATERMARK: false,
            SHOW_POWERED_BY: false,
            TILE_VIEW_MAX_COLUMNS: 4,
            DISABLE_VIDEO_BACKGROUND: true
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

    async function refreshPeople() {
        let people = [];
        try {
            const info = await api.getRoomsInfo();
            people = info?.rooms?.find((r) => r.isMainRoom)?.participants || info?.rooms?.[0]?.participants || [];
        } catch {
            people = (api.getParticipantsInfo?.() || []).map((p) => ({ displayName: p.displayName || p.formattedDisplayName, id: p.participantId }));
        }
        $("peopleCount").textContent = people.length || 1;
        $("peopleCount2").textContent = people.length || 1;
        $("peopleList").innerHTML = people.map((p, i) => {
            const name = p.displayName || "Guest";
            const guest = /\(guest\)/i.test(name);
            return `<div class="people-row">
                        <span class="avatar av-36 tone-${guest ? 3 : i % 6}">${esc(initials(name))}</span>
                        <span>${esc(name.replace(/\s*\(guest\)/i, ""))}</span>
                        <span class="tag">${p.role === "moderator" ? "Host" : guest ? "Guest" : ""}</span>
                    </div>`;
        }).join("");
    }

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
    $("shareBtn").onclick = () => api.executeCommand("toggleShareScreen");
    $("ccBtn").onclick = () => {
        api.executeCommand("toggleSubtitles");
        const on = $("ccBtn").getAttribute("aria-pressed") !== "true";
        setBtn("ccBtn", on, "active");
    };
    $("tileBtn").onclick = () => api.executeCommand("toggleTileView");
    $("panelBtn").onclick = () => {
        const panel = $("roomPanel");
        panel.classList.toggle("hidden-panel");
        setBtn("panelBtn", !panel.classList.contains("hidden-panel"), "active");
    };

    let handUp = false;
    $("handBtn").onclick = () => {
        api.executeCommand("toggleRaiseHand");
        handUp = !handUp;
        setBtn("handBtn", handUp, "hand", handUp ? "Lower hand" : "Raise hand", "handLabel", handUp ? "Lower" : "Raise");
    };

    let leaving = false;
    const leave = (note) => {
        if (leaving) return;
        leaving = true;
        if (typeof note === "string" && note.trim() && hub && hub.state === "Connected")
            hub.invoke("LeaveCall", cfg.meetingId, note.trim()).catch(() => { });
        else report("MeetingLeft");
        try { api.executeCommand("hangup"); } catch { }
        setTimeout(() => (location.href = cfg.leaveUrl), 900);
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
    const othersInCall = () => { try { return Math.max(0, (api.getNumberOfParticipants?.() || 1) - 1); } catch { return 0; } };

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
            if (cfg.oneToOne) endScreen(`${name} ended the call`, note);
            else notice(`${name} left the call`, note, "left");
        });
        // nobody picked up in time
        hub.on("CallUpdated", (c) => {
            if (String(c.meetingId).toLowerCase() !== String(cfg.meetingId).toLowerCase()) return;
            if (cfg.oneToOne && c.outcome === 3 && othersInCall() === 0) endScreen("No answer", null);
        });
    }

    // ---------- JaaS events keep the dock in sync ----------
    api.addListener("videoConferenceJoined", () => {
        joinedAt = Date.now();
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
    api.addListener("screenSharingStatusChanged", ({ on }) =>
        setBtn("shareBtn", on, "sharing", on ? "Stop sharing your screen" : "Share your screen", "shareLabel", on ? "Stop share" : "Share"));
    api.addListener("tileViewChanged", ({ enabled }) => setBtn("tileBtn", enabled, "active"));
    ["participantJoined", "participantLeft", "displayNameChange", "participantRoleChanged"].forEach((ev) =>
        api.addListener(ev, refreshPeople));
    api.addListener("participantJoined", ({ displayName }) => displayName && toast(`${displayName} joined`));
    api.addListener("knockingParticipant", ({ participant }) =>
        toast(`${participant?.name || "A guest"} is waiting in the lobby`));
    api.addListener("readyToClose", () => { if (!ended) leave(); });
    api.addListener("videoConferenceLeft", () => { if (!leaving && !ended) leave(); });

    window.addEventListener("beforeunload", () => report("MeetingLeft"));
})();
