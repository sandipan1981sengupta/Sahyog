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
    const leave = () => {
        if (leaving) return;
        leaving = true;
        report("MeetingLeft");
        try { api.executeCommand("hangup"); } catch { }
        setTimeout(() => (location.href = cfg.leaveUrl), 900);
    };
    $("leaveBtn").onclick = leave;
    $("backBtn").onclick = leave;

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
    api.addListener("readyToClose", leave);
    api.addListener("videoConferenceLeft", () => { if (!leaving) leave(); });

    window.addEventListener("beforeunload", () => report("MeetingLeft"));
})();
