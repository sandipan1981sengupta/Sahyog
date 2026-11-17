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
    // Re-open a dialog only when the server says its form came back with errors.
    // Razor always writes data-* attributes (a false flag renders as "False"), so check the value, not just its presence.
    document.querySelectorAll("dialog[data-open-on-load]").forEach((d) => {
        if ((d.dataset.openOnLoad || "").toLowerCase() === "true") d.showModal();
    });

    const filter = (inputId, itemSelector) => {
        const input = document.getElementById(inputId);
        input?.addEventListener("input", () => {
            const q = input.value.trim().toLowerCase();
            document.querySelectorAll(itemSelector).forEach((el) => {
                el.hidden = q.length > 0 && !(el.dataset.filter || "").toLowerCase().includes(q);
            });
        });
    };
    filter("sideFilter", ".side-item[data-filter]");
    filter("tenantFilter", "tr[data-filter]");

    // ---------- real-time connection (only on signed-in workspace pages) ----------
    if (!window.signalR || !document.querySelector(".rail")) return;

    const hub = new signalR.HubConnectionBuilder()
        .withUrl("/hubs/chat")
        .withAutomaticReconnect([0, 2000, 5000, 10000, 20000, 30000])
        .build();
    Sahyog.hub = hub;
    Sahyog.online = new Set();

    Sahyog.busy = new Set();      // people in a call or meeting right now
    // green = available, red = on a call, grey = offline
    const paintPresence = () => {
        document.querySelectorAll("[data-presence]").forEach((el) => {
            const id = el.dataset.presence, dot = el.querySelector(".dot");
            const busy = Sahyog.busy.has(id), on = Sahyog.online.has(id) || busy;
            if (dot) {
                dot.classList.toggle("on", on && !busy);
                dot.classList.toggle("busy", busy);
            }
            el.classList.toggle("is-busy", busy);
            el.classList.toggle("is-on", on && !busy);
            el.setAttribute("data-status", busy ? "On a call" : on ? "Available" : "Offline");
        });
    };
    Sahyog.paintPresence = paintPresence;
    hub.on("BusyChanged", (userId, busy) => {
        if (busy) Sahyog.busy.add(userId); else Sahyog.busy.delete(userId);
        paintPresence();
    });

    hub.on("PresenceChanged", (userId, isOnline) => {
        if (isOnline) Sahyog.online.add(userId); else Sahyog.online.delete(userId);
        paintPresence();
    });

    // ---------- incoming call: ring until answered ----------
    let ringTimer = null;
    let audioCtx = null;
    let dismissTimer = null;

    const ringOnce = () => {
        try {
            audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
            const now = audioCtx.currentTime;
            [0, 0.35].forEach((offset) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = "sine";
                osc.frequency.setValueAtTime(offset === 0 ? 880 : 1175, now + offset);
                gain.gain.setValueAtTime(0.0001, now + offset);
                gain.gain.exponentialRampToValueAtTime(0.18, now + offset + 0.03);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.3);
                osc.connect(gain).connect(audioCtx.destination);
                osc.start(now + offset);
                osc.stop(now + offset + 0.32);
            });
        } catch { /* browser blocked audio until the user clicks once; the pop-up still shows */ }
    };

    const stopRinging = () => {
        clearInterval(ringTimer);
        clearTimeout(dismissTimer);
        ringTimer = null;
        document.getElementById("callOverlay").hidden = true;
    };

    hub.on("IncomingCall", (call) => {
        const overlay = document.getElementById("callOverlay");
        const avatar = document.getElementById("callAvatar");
        avatar.textContent = call.callerInitials;
        avatar.className = `avatar av-96 tone-${call.callerTone}`;
        document.getElementById("callWho").textContent = call.callerName;
        document.getElementById("callTitle").textContent = call.title;
        document.getElementById("callAccept").href = call.roomUrl;
        document.getElementById("callDecline").onclick = () => {
            stopRinging();
            hub.invoke("DeclineCall", call.meetingId).catch(() => { });
        };
        document.getElementById("callAccept").onclick = stopRinging;
        overlay.hidden = false;

        ringOnce();
        ringTimer = setInterval(ringOnce, 2200);
        dismissTimer = setTimeout(() => {
            stopRinging();
            Sahyog.toast(`Missed call from ${call.callerName}`, 8000);
        }, 30000);

        if (document.hidden && "Notification" in window && Notification.permission === "granted") {
            const n = new Notification(`${call.callerName} is calling you`, { body: call.title, tag: `call-${call.meetingId}`, requireInteraction: true });
            n.onclick = () => { window.focus(); location.href = call.roomUrl; };
        }
    });

    hub.on("CallDeclined", (_meetingId, name) => Sahyog.toast(`${name} declined the call`));

    // ---------- someone added you to a group ----------
    hub.on("AddedToGroup", (byName, groupName, url) => {
        Sahyog.toast(`${byName} added you to "${groupName}".`, {
            kind: "info", title: "New group", ms: 10000,
            action: { text: "Open", onClick: () => { location.href = url; } }
        });
    });

    // ---------- "Ping" from a teammate: two soft chimes, a pop-up with "Open chat", and a desktop alert in the background ----------
    hub.on("Pinged", (name, initials, tone, chatUrl) => {
        ringOnce();
        Sahyog.toast(`${name} pinged you`, {
            kind: "info", title: "👋 Ping", ms: 12000,
            action: { text: "Open chat", onClick: () => { location.href = chatUrl; } }
        });
        if (document.hidden && "Notification" in window && Notification.permission === "granted") {
            const n = new Notification(`${name} pinged you`, { body: "Click to open your chat.", tag: `ping-${chatUrl}` });
            n.onclick = () => { window.focus(); location.href = chatUrl; };
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
            paintPresence();
            document.dispatchEvent(new CustomEvent("sahyog:connected"));
        } catch {
            setTimeout(start, 5000);
        }
    };
    hub.onreconnected(async () => {
        Sahyog.online = new Set(await hub.invoke("OnlineUsers"));
        try { Sahyog.busy = new Set(await hub.invoke("BusyUsers")); } catch { /* older server */ }
        paintPresence();
        document.dispatchEvent(new CustomEvent("sahyog:connected"));
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