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
        el.innerHTML = `<span class="rn-ic">${kind === "declined" ? "&#128222;" : kind === "ring" ? "&#128276;" : kind === "chat" ? "&#128172;" : "&#128075;"}</span>`
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

    let speakerId = null, peopleById = new Map(), speakerT = null;
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
        const me = String(cfg.displayName || "").trim().toLowerCase();
        $("peopleList").innerHTML = people.map((p, i) => {
            const name = p.displayName || "Guest";
            const guest = /\(guest\)/i.test(name);
            const clean = name.replace(/\s*\(guest\)/i, "");
            const isMe = clean.trim().toLowerCase() === me;
            const role = p.role === "moderator" ? '<span class="role host">Host</span>' : guest ? '<span class="role guest">Guest</span>' : "";
            return `<div class="people-row ${speakerId && p.id === speakerId ? "speaking" : ""}" data-pid="${esc(p.id || "")}" style="--i:${i}">
                        <span class="pr-av"><span class="avatar av-36 tone-${guest ? 3 : i % 6}">${esc(initials(clean))}</span></span>
                        <span class="pr-name"><span class="pr-n">${esc(clean)}</span>${isMe ? '<small class="pr-you">You</small>' : ""}</span>
                        <span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>
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
    $("tileBtn").onclick = () => api.executeCommand("toggleTileView");
    // ---------- side panel: hide / show (button, the arrow on the panel, the "in call" tab, or the P key) ----------
    const panel = $("roomPanel"), peek = $("panelPeek");
    let panelOpen = true, autoHidden = false;
    try { if (localStorage.getItem("sn-room-panel") === "0") panelOpen = false; } catch { }
    const paintPanel = (animate) => {
        document.body.classList.toggle("panel-off", !panelOpen);
        if (!animate) document.body.classList.add("no-anim"), requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove("no-anim")));
        setBtn("panelBtn", panelOpen, "active", panelOpen ? "Hide the side panel (P)" : "Show the side panel (P)", "panelLabel", panelOpen ? "Hide panel" : "Show panel");
        $("panelBtn").title = panelOpen ? "Hide the side panel (P)" : "Show the side panel (P)";
        panel.setAttribute("aria-hidden", String(!panelOpen));
        peek.hidden = panelOpen;
    };
    const setPanel = (open, remember = true) => {
        panelOpen = open;
        if (remember) { autoHidden = false; try { localStorage.setItem("sn-room-panel", open ? "1" : "0"); } catch { } }
        paintPanel(true);
    };
    $("panelBtn").onclick = () => setPanel(!panelOpen);
    $("panelClose").onclick = () => setPanel(false);
    peek.onclick = () => setPanel(true);
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

    // ---- tabs ----
    let pane = "people", unread = 0;
    const tabsEl = document.querySelector(".pane-tabs");
    const movePill = () => {
        const on = tabsEl?.querySelector("button.on"), pill = tabsEl?.querySelector(".pt-pill");
        if (on && pill) { pill.style.width = on.offsetWidth + "px"; pill.style.transform = `translateX(${on.offsetLeft - 4}px)`; }
    };
    const paintUnread = () => {
        const b = $("chatBadge"), t = $("chatUnread");
        [b, t].forEach((x) => { if (!x) return; x.textContent = unread > 9 ? "9+" : String(unread); x.hidden = unread === 0; });
        if (b && unread) { b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); }
    };
    const showPane = (name) => {
        pane = name;
        $("panePeople").hidden = name !== "people";
        $("paneChat").hidden = name !== "chat";
        tabsEl?.querySelectorAll("[data-pane]").forEach((b) => { const on = b.dataset.pane === name; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });
        setBtn("chatBtn", name === "chat" && panelOpen, "active");
        movePill();
        if (name === "chat") { unread = 0; paintUnread(); scrollChat(true); setTimeout(() => $("ccInput")?.focus(), 60); }
    };
    tabsEl?.querySelectorAll("[data-pane]").forEach((b) => b.addEventListener("click", () => showPane(b.dataset.pane)));
    requestAnimationFrame(movePill);
    window.addEventListener("resize", movePill);
    const chatVisible = () => panelOpen && pane === "chat" && !document.hidden;
    $("chatBtn").onclick = () => {
        if (panelOpen && pane === "chat") { setPanel(false); setBtn("chatBtn", false, "active"); return; }
        if (!panelOpen) setPanel(true);
        showPane("chat");
    };
    // keep the Chat button in step when the panel is hidden or shown some other way
    new MutationObserver(() => setBtn("chatBtn", panelOpen && pane === "chat", "active"))
        .observe(document.body, { attributes: true, attributeFilter: ["class"] });

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
    // who is talking: their row lights up with moving sound bars, and a chip on the video shows their name
    api.addListener("dominantSpeakerChanged", ({ id }) => {
        speakerId = id;
        document.querySelectorAll(".people-row").forEach((r) => r.classList.toggle("speaking", r.dataset.pid === id));
        const name = peopleById.get(id);
        const chip = $("speakerChip");
        if (chip && name) {
            $("speakerName").textContent = name;
            chip.hidden = false;
            chip.classList.remove("show"); void chip.offsetWidth; chip.classList.add("show");
            clearTimeout(speakerT);
            speakerT = setTimeout(() => chip.classList.remove("show"), 4000);
        }
        $("jaas")?.parentElement.classList.add("talking");
        clearTimeout(window.__snTalk); window.__snTalk = setTimeout(() => $("jaas")?.parentElement.classList.remove("talking"), 1800);
    });
    // someone shares a screen: give it the whole width (the panel slides away, and comes back when sharing stops)
    api.addListener("contentSharingParticipantsChanged", ({ data }) => {
        const sharing = Array.isArray(data) && data.length > 0;
        if (sharing && panelOpen) { panelOpen = false; autoHidden = true; paintPanel(true); toast("Side panel hidden for the shared screen. Press Show panel (or P) to bring it back."); }
        else if (!sharing && autoHidden) { autoHidden = false; panelOpen = true; paintPanel(true); }
    });
    // the small "N in call" tab shown while the panel is hidden
    new MutationObserver(() => { const n = $("peopleCount")?.textContent; if (n) $("peekCount").textContent = n; })
        .observe($("peopleCount"), { childList: true, characterData: true, subtree: true });
    ["participantJoined", "participantLeft", "displayNameChange", "participantRoleChanged"].forEach((ev) =>
        api.addListener(ev, refreshPeople));
    api.addListener("participantJoined", ({ displayName }) => displayName && toast(`${displayName} joined`));
    api.addListener("knockingParticipant", ({ participant }) =>
        toast(`${participant?.name || "A guest"} is waiting in the lobby`));
    api.addListener("readyToClose", () => { if (!ended) leave(); });
    api.addListener("videoConferenceLeft", () => { if (!leaving && !ended) leave(); });

    window.addEventListener("beforeunload", () => report("MeetingLeft"));
})();
