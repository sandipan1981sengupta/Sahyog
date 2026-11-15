// Sahyog · shared page behaviour: real-time connection, presence, incoming calls, dialogs, toasts.
(function () {
    "use strict";

    const Sahyog = (window.Sahyog = window.Sahyog || {});

    Sahyog.antiforgery = () => document.querySelector('input[name="__RequestVerificationToken"]')?.value || "";

    Sahyog.escape = (text) =>
        String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    Sahyog.toast = (message, ms = 4500) => {
        const host = document.getElementById("toasts");
        if (!host) return;
        const el = document.createElement("div");
        el.className = "toast";
        el.textContent = message;
        host.appendChild(el);
        setTimeout(() => el.remove(), ms);
    };

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
    document.querySelectorAll("dialog[data-open-on-load]").forEach((d) => d.showModal());
    document.querySelectorAll("[data-toast-error]").forEach((el) => Sahyog.toast(el.dataset.toastError));

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

    const paintPresence = () => {
        document.querySelectorAll("[data-presence]").forEach((el) => {
            el.querySelector(".dot")?.classList.toggle("on", Sahyog.online.has(el.dataset.presence));
        });
    };

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

    // Offer desktop alerts once (needed to see calls when this tab is in the background).
    const alertsBtn = document.getElementById("alertsBtn");
    if (alertsBtn && "Notification" in window && Notification.permission === "default") {
        alertsBtn.hidden = false;
        alertsBtn.addEventListener("click", async () => {
            const result = await Notification.requestPermission();
            alertsBtn.hidden = true;
            Sahyog.toast(result === "granted" ? "Call alerts are on" : "Call alerts stay off. You can change this in browser settings.");
        });
    }

    const start = async () => {
        try {
            await hub.start();
            (await hub.invoke("OnlineUsers")).forEach((id) => Sahyog.online.add(id));
            paintPresence();
            document.dispatchEvent(new CustomEvent("sahyog:connected"));
        } catch {
            setTimeout(start, 5000);
        }
    };
    hub.onreconnected(async () => {
        Sahyog.online = new Set(await hub.invoke("OnlineUsers"));
        paintPresence();
        document.dispatchEvent(new CustomEvent("sahyog:connected"));
    });
    start();
})();
