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
            // the plan's height (e.g. 720p) at up to 30 frames a second; never below 180p
            constraints: { video: { height: { ideal: cfg.maxHeight, max: cfg.maxHeight, min: 180 }, frameRate: { ideal: 30, max: 30 } } },
            // sharper picture for the same bandwidth: VP9 first on computers (VP8 / H.264 when a browser can't),
            // and on phones the codecs their chips handle best. Jitsi's own bitrates and adaptive quality stay as they are.
            videoQuality: {
                codecPreferenceOrder: ["VP9", "VP8", "H264"],
                mobileCodecPreferenceOrder: ["VP8", "H264", "VP9"]
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
            filmstrip: { disabled: true, disableResizable: true }
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
            const role = p.role === "moderator" ? '<span class="role host">Host</span>' : guest ? '<span class="role guest">Guest</span>' : "";
            const hand = hands.has(p.id) ? '<span class="pr-hand" title="Raised a hand" aria-label="Raised a hand">&#9995;</span>' : "";
            const canShow = p.id && !isMe;
            return `<div class="people-row ${speakerId && p.id === speakerId ? "speaking" : ""} ${hands.has(p.id) ? "hand-up" : ""} ${canShow ? "can-show" : ""}" data-pid="${esc(p.id || "")}" style="--i:${i}"${canShow ? ` role="button" tabindex="0" title="Show ${esc(clean)} on the big video"` : ""}>
                        <span class="pr-av"><span class="avatar av-36 tone-${guest ? 3 : i % 6}">${esc(initials(clean))}</span></span>
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
            return `<span class="avatar tone-${/\(guest\)/i.test(p.displayName || "") ? 3 : i % 6}">${esc(initials(nm))}</span>`;
        }).join("");
        peopleById = new Map(people.map((p) => [p.id, (p.displayName || "Guest").replace(/\s*\(guest\)/i, "")]));
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
        if (remember) { autoHidden = false; try { localStorage.setItem("sn-room-panel", open ? "1" : "0"); } catch { } }
        paintPanel(true);
    };
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
        [b, t].forEach((x) => { if (!x) return; x.textContent = unread > 9 ? "9+" : String(unread); x.hidden = unread === 0; });
        if (b && unread) { b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); }
    };
    const showPane = (name) => {
        pane = name;
        $("panePeople").hidden = name !== "people";
        $("paneChat").hidden = name !== "chat";
        if ($("paneMsgs")) $("paneMsgs").hidden = name !== "msgs";
        document.querySelectorAll(".panel-head .ph-t").forEach((h) => { h.hidden = h.dataset.for !== name; });
        if ($("paneSub")) $("paneSub").textContent = PANE_SUB[name] || "";
        paintPaneBtns();
        if (name === "chat") { unread = 0; paintUnread(); scrollChat(true); setTimeout(() => $("ccInput")?.focus(), 60); }
        if (name === "msgs") window.__snMsgsShown?.();
    };
    const chatVisible = () => panelOpen && pane === "chat" && !document.hidden;
    // a dock button opens its view; pressed again (while showing), it closes the panel
    const togglePane = (name) => {
        if (panelOpen && pane === name) { setPanel(false); return; }
        if (!panelOpen) setPanel(true);
        showPane(name);
    };
    window.__snTogglePane = togglePane;
    // Esc while working in the panel closes it (on a phone, tapping outside it does too)
    panel.addEventListener("keydown", (e) => { if (e.key === "Escape" && panelOpen) { e.stopPropagation(); setPanel(false); } });
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
            const isImg = (m.file.type || "").startsWith("image/") && m.file.id;
            const href = m.file.id ? `/meetings/chat/file/${m.file.id}` : null;
            content = `<div class="cc-file">`
                + (isImg ? `<a class="cc-thumb" href="${href}" target="_blank" rel="noopener"><img src="${href}" alt="${esc(m.file.name)}" loading="lazy" /></a>` : "")
                + `<span class="cc-fic" aria-hidden="true">${fileIcon(m.file.name, m.file.type)}</span>`
                + `<span class="cc-fmeta"><b>${esc(m.file.name)}</b><small>${fmtSize(m.file.size)}${href ? "" : " · open the call as a team member to download"}</small></span>`
                + (href ? `<a class="cc-dl" href="${href}" download title="Download"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v12M7 11l5 5 5-5M5 20h14" /></svg></a>` : "")
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
        input.addEventListener("paste", (e) => { const f = [...(e.clipboardData?.files || [])][0]; if (f) { e.preventDefault(); uploadFile(f); } });
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
        const when = (iso) => {
            const d = new Date(iso);
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
        const paintList = () => {
            const el = $("mxList");
            el.innerHTML = !chats.length
                ? `<div class="mx-empty">${loaded ? "No chats yet." : "Loading your chats…"}</div>`
                : chats.map((c) => `<button type="button" class="mx-row ${c.unread ? "unread" : ""} ${open && sameId(open.id, c.id) ? "on" : ""}" data-id="${esc(c.id)}">`
                    + `<span class="avatar av-36 tone-${Number(c.tone) || 0}">${esc(c.initials)}</span>`
                    + `<span class="mx-n"><b>${esc(c.name)}</b><small>${c.isDirect ? (c.online ? "Online" : "Offline") : "Group"}</small></span>`
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
        const msgHtml = (m) => {
            const mine = String(m.senderId).toLowerCase() === me;
            const body = isCallCard(m.body) ? "&#128222; Call" : isGifCard(unFwd(m.body).replace(/^↪ /, "")) ? "&#127902;&#65039; GIF" : esc(unFwd(m.body)).replace(/\n/g, "<br>");
            const file = m.attachment ? `<a class="mx-file" href="${esc(m.attachment.url)}" target="_blank" rel="noopener">&#128206; ${esc(m.attachment.fileName)}</a>` : "";
            const who = !mine && open && !open.isDirect ? `<small class="mx-who">${esc(m.senderName)}</small>` : "";
            const where = m.fromGroup && open && open.isDirect ? `<small class="mx-who">in ${esc(m.fromGroup)}</small>` : "";
            return `<div class="mx-m ${mine ? "mine" : ""}" data-mid="${esc(m.id)}">${who}${where}${body ? `<span class="mx-b">${body}</span>` : ""}${file}<small class="mx-time">${when(m.sentUtc)}</small></div>`;
        };
        const append = (m) => {
            if (shown.has(m.id)) return;
            shown.add(m.id);
            const box = $("mxMsgs");
            box.querySelector(".mx-empty")?.remove();
            box.insertAdjacentHTML("beforeend", msgHtml(m));
            box.scrollTop = box.scrollHeight;
        };
        const visible = () => panelOpen && pane === "msgs" && !document.hidden;
        const markRead = (c) => {
            if (c.unread) { c.unread = 0; paintList(); }
            if (hub.state === "Connected") hub.invoke("MarkRead", c.id).catch(() => { });
        };
        const toTop = (c) => { chats = [c, ...chats.filter((x) => x !== c)]; };
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
            $("mxOpen").href = `/chat/${c.id}`;
            $("mxMsgs").innerHTML = `<div class="mx-empty">Loading…</div>`;
            try {
                const r = await fetch(`/chat/${c.id}/recent`, { headers: { Accept: "application/json" }, credentials: "same-origin" });
                const d = r.ok ? await r.json() : null;
                if (open !== c) return;
                $("mxMsgs").innerHTML = d && d.messages.length ? "" : `<div class="mx-empty">${d ? "No messages yet. Say hello!" : "Couldn't load the messages."}</div>`;
                (d?.messages || []).forEach(append);
            } catch { $("mxMsgs").innerHTML = `<div class="mx-empty">Couldn't load the messages.</div>`; }
            markRead(c);
            setTimeout(() => $("mxInput").focus(), 50);
        }
        const backToList = () => { open = null; $("mxChat").hidden = true; $("mxList").hidden = false; paintList(); };
        $("mxBack").onclick = backToList;
        $("mxList").addEventListener("click", (e) => { const b = e.target.closest(".mx-row"); if (b) openChat(b.dataset.id); });
        $("mxForm").addEventListener("submit", async (e) => {
            e.preventDefault();
            const input = $("mxInput"), text = input.value.trim();
            if (!text || !open) return;
            input.value = "";
            try {
                const m = await hub.invoke("SendMessage", open.id, text, null);
                append(m);
                open.lastUtc = m.sentUtc;
                toTop(open);
            } catch { input.value = text; toast("Couldn't send. Check your connection and try again."); }
        });
        const openMessages = (id) => { setPanel(true); showPane("msgs"); if (id) openChat(id); };
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
        // M opens Messages (when the page, not the video, has the keyboard)
        document.addEventListener("keydown", (e) => {
            if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest("input, textarea, [contenteditable]")) return;
            if (e.key === "m" || e.key === "M") { e.preventDefault(); openMessages(); }
        });
        document.addEventListener("visibilitychange", () => { if (!document.hidden) loadChats(); });
        loadChats();
    }


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
        setInterval(paint, 1000);
        ["videoConferenceJoined", "participantJoined", "participantLeft"].forEach((ev) => api.addListener(ev, () => setTimeout(paint, 250)));
    })();

    window.addEventListener("beforeunload", () => report("MeetingLeft"));
})();
