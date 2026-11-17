// Sahyog · chat page: render messages, send, typing, upload, load older, unread badges.
(function () {
    "use strict";

    const S = window.Sahyog;
    const root = document.getElementById("chat");
    if (!root || !S) return;

    const channelId = root.dataset.channel || null;
    const me = root.dataset.me;
    const isAdmin = root.dataset.admin === "true";
    const maxMb = Number(root.dataset.maxMb || 50);
    const list = document.getElementById("messageList");
    const scroller = document.getElementById("messages");
    const box = document.getElementById("messageBox");
    const form = document.getElementById("composer");
    const typing = document.getElementById("typing");
    const typingText = document.getElementById("typingText");
    const loadOlderBtn = document.getElementById("loadOlder");

    const seen = new Set();
    let oldestId = null;
    let lastRendered = null;   // { senderId, sentUtc, day }

    const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const dayKey = (iso) => new Date(iso).toDateString();
    const dayLabel = (iso) => {
        const d = new Date(iso);
        const today = new Date();
        const yesterday = new Date(Date.now() - 86400000);
        if (d.toDateString() === today.toDateString()) return "Today";
        if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
        return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
    };
    const formatBytes = (b) => {
        const u = ["B", "KB", "MB", "GB"];
        let i = 0;
        while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
        return `${i === 0 ? b : b.toFixed(1)} ${u[i]}`;
    };
    const linkify = (escaped) =>
        escaped.replace(/(https?:\/\/[^\s<]+)/g, (url) => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`);

    function attachmentHtml(a) {
        const name = S.escape(a.fileName);
        if (a.contentType.startsWith("image/")) {
            return `<a class="file-card img-card" href="${a.url}" target="_blank" rel="noopener"><img src="${a.url}" alt="${name}" loading="lazy"></a>`;
        }
        const ext = S.escape((a.fileName.split(".").pop() || "file").slice(0, 4));
        return `<a class="file-card" href="${a.url}" target="_blank" rel="noopener">
                    <span class="ext">${ext}</span>
                    <span class="grow"><span class="ellipsis" style="display:block;font-weight:500">${name}</span><span class="muted tiny">${formatBytes(a.sizeBytes)}</span></span>
                </a>`;
    }

    // ---------- read ticks on your own messages: ✓ sent, ✓✓ grey read by some, ✓✓ blue read by everyone ----------
    const readers = {};          // userId → { name, at: Date }
    try {
        JSON.parse(document.getElementById("readState")?.textContent || "[]")
            .forEach((r) => { if (r.id !== me) readers[r.id] = { name: r.name, at: new Date(r.lastReadUtc) }; });
    } catch { /* no ticks */ }
    const ticksOn = Object.keys(readers).length > 0;

    function tickState(sentUtc) {
        const sent = new Date(sentUtc), ids = Object.keys(readers);
        const read = ids.filter((id) => readers[id].at >= sent);
        if (read.length === 0) return { cls: "sent", title: "Sent", icon: 1 };
        if (read.length === ids.length) return { cls: "read", title: ids.length === 1 ? "Read" : "Read by everyone", icon: 2, who: read };
        return { cls: "some", title: `Read by ${read.length} of ${ids.length}`, icon: 2, who: read };
    }
    function ticksHtml(sentUtc) {
        if (!ticksOn) return "";
        const t = tickState(sentUtc);
        const names = t.who ? ": " + t.who.map((id) => readers[id].name).join(", ") : "";
        return `<span class="msg-ticks ${t.cls}" title="${S.escape(t.title + (Object.keys(readers).length > 1 ? names : ""))}" aria-label="${S.escape(t.title)}">`
            + `<i class="fa fa-check" aria-hidden="true"></i>${t.icon === 2 ? '<i class="fa fa-check" aria-hidden="true"></i>' : ""}</span>`;
    }
    function refreshTicks() {
        if (!ticksOn) return;
        list.querySelectorAll(".msg.mine[data-sent]").forEach((el) => {
            const old = el.querySelector(".msg-ticks");
            if (!old) return;
            const wrap = document.createElement("span");
            wrap.innerHTML = ticksHtml(el.dataset.sent);
            const next = wrap.firstChild;
            if (old.className !== next.className) next.classList.add("changed");
            old.replaceWith(next);
        });
    }

    function messageEl(m, previous) {
        const mine = m.senderId === me;
        const grouped = previous && previous.senderId === m.senderId && previous.day === dayKey(m.sentUtc)
            && new Date(m.sentUtc) - new Date(previous.sentUtc) < 5 * 60 * 1000;
        const el = document.createElement("div");
        el.className = `msg${mine ? " mine" : ""}${grouped ? " grouped" : ""}`;
        el.dataset.id = m.id;
        if (mine) el.dataset.sent = m.sentUtc;
        const body = m.body ? `<p class="bubble">${linkify(S.escape(m.body))}</p>` : "";
        const file = m.attachment ? attachmentHtml(m.attachment) : "";
        const canDelete = mine || isAdmin;
        el.innerHTML = `
            <span class="avatar av-38 tone-${m.senderTone}">${S.escape(m.senderInitials)}</span>
            <div class="msg-body">
                <span class="msg-meta">${mine ? "You" : `<strong>${S.escape(m.senderName)}</strong>`} · ${time(m.sentUtc)}</span>
                <div class="msg-line">${body}${file}${mine ? ticksHtml(m.sentUtc) : ""}${canDelete ? `<button type="button" class="msg-del" data-del="${m.id}" title="Delete message" aria-label="Delete message"><i class="fa fa-trash-o" aria-hidden="true"></i></button>` : ""}</div>
            </div>`;
        return el;
    }

    function daySep(iso) {
        const el = document.createElement("div");
        el.className = "day-sep";
        el.textContent = dayLabel(iso);
        return el;
    }

    function append(m) {
        if (seen.has(m.id)) return;
        seen.add(m.id);
        if (oldestId === null || m.id < oldestId) oldestId = m.id;
        const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 160;
        if (!lastRendered || lastRendered.day !== dayKey(m.sentUtc)) list.appendChild(daySep(m.sentUtc));
        list.appendChild(messageEl(m, lastRendered));
        lastRendered = { senderId: m.senderId, sentUtc: m.sentUtc, day: dayKey(m.sentUtc) };
        if (nearBottom || m.senderId === me) scroller.scrollTop = scroller.scrollHeight;
    }

    function prepend(messages) {
        const before = scroller.scrollHeight;
        const frag = document.createDocumentFragment();
        let prev = null;
        messages.filter((m) => !seen.has(m.id)).forEach((m) => {
            seen.add(m.id);
            if (!prev || prev.day !== dayKey(m.sentUtc)) frag.appendChild(daySep(m.sentUtc));
            frag.appendChild(messageEl(m, prev));
            prev = { senderId: m.senderId, sentUtc: m.sentUtc, day: dayKey(m.sentUtc) };
            if (oldestId === null || m.id < oldestId) oldestId = m.id;
        });
        list.prepend(frag);
        scroller.scrollTop = scroller.scrollHeight - before;
    }

    // ---------- delete a message ----------
    function removeMessage(id) {
        const el = list.querySelector(`.msg[data-id="${id}"]`);
        if (!el) return;
        el.classList.add("msg-removing");
        setTimeout(() => {
            const prev = el.previousElementSibling, next = el.nextElementSibling;
            el.remove();
            // drop a day label that has nothing under it any more
            if (prev && prev.classList.contains("day-sep") && (!next || next.classList.contains("day-sep"))) prev.remove();
            // the next message from the same person shows its name and picture again
            if (next && next.classList.contains("grouped") && (!prev || !prev.classList.contains("msg"))) next.classList.remove("grouped");
        }, 260);
    }
    list?.addEventListener("click", (e) => {
        const btn = e.target.closest(".msg-del");
        if (!btn) return;
        const id = btn.dataset.del;
        confirmMessageBox({
            title: "Delete message",
            text: "Delete this message for everyone in the chat? A file attached to it is deleted too.",
            confirmText: "Delete",
            danger: true,
            onConfirm: async () => {
                const res = await fetch(`/chat/messages/${id}/delete`, {
                    method: "POST",
                    headers: { "RequestVerificationToken": S.antiforgery() }
                });
                if (res.ok) removeMessage(id);
                else {
                    const data = await res.json().catch(() => ({}));
                    S.toast(data.error || "The message could not be deleted.");
                }
            }
        });
    });

    // initial page of messages (rendered by the server as JSON)
    const initial = JSON.parse(document.getElementById("initialMessages")?.textContent || "[]");
    initial.forEach(append);
    if (scroller) scroller.scrollTop = scroller.scrollHeight;

    loadOlderBtn?.addEventListener("click", async () => {
        if (!channelId || oldestId === null) return;
        loadOlderBtn.disabled = true;
        const res = await fetch(`/chat/${channelId}/messages?before=${oldestId}`);
        if (res.ok) {
            const data = await res.json();
            prepend(data.messages);
            loadOlderBtn.hidden = !data.hasOlder;
        }
        loadOlderBtn.disabled = false;
    });

    // ---------- real-time ----------
    const hub = S.hub;
    if (hub) {
        hub.on("MessageReceived", (m) => {
            if (m.channelId === channelId) {
                append(m);
                typing.hidden = true;
                if (document.visibilityState === "visible") hub.invoke("MarkRead", channelId).catch(() => { });
            } else {
                const item = document.querySelector(`.side-item[data-channel="${m.channelId}"]`);
                if (item) {
                    const badge = item.querySelector(".badge");
                    badge.textContent = String(Number(badge.textContent || 0) + 1);
                    badge.hidden = false;
                    item.classList.add("unread");
                    if (item.parentElement) item.parentElement.insertBefore(item, item.parentElement.querySelector(".side-item"));
                }
                if (document.hidden && "Notification" in window && Notification.permission === "granted") {
                    new Notification(m.senderName, { body: m.body || "Sent a file", tag: `msg-${m.channelId}` });
                }
            }
        });

        let typingHide = null;
        hub.on("Typing", (cid, name) => {
            if (cid !== channelId) return;
            typingText.textContent = `${name} is typing…`;
            typing.hidden = false;
            clearTimeout(typingHide);
            typingHide = setTimeout(() => (typing.hidden = true), 3500);
        });

        hub.on("ChannelCreated", () => { /* sidebar refreshes on next navigation */ });

        // A channel was renamed (by an admin or its creator): update the list, header and composer straight away.
        hub.on("ChannelUpdated", (cid, name, description) => {
            const item = document.querySelector(`.side-item[data-channel="${cid}"]`);
            if (item) {
                item.dataset.filter = name;
                const label = item.querySelector(".grow");
                if (label) label.textContent = name;
            }
            if (cid !== channelId) return;
            const title = document.querySelector("#ChatHeader .hdr-title");
            if (title) { title.textContent = "#" + name; title.title = "#" + name; }
            const sub = document.querySelector("#ChatHeader .hdr-subtitle");
            if (sub) {
                const count = (sub.textContent || "").split(" · ")[0];
                sub.textContent = description ? `${count} · ${description}` : count;
            }
            const box = document.getElementById("messageBox");
            if (box) box.placeholder = "Message #" + name;
            document.title = `#${name} · ShankhNaad`;
        });

        hub.on("MessageDeleted", (cid, mid) => { if (cid === channelId) removeMessage(mid); });

        // someone read this conversation: their read time moves on and your ticks update
        hub.on("ChannelRead", (cid, userId, readUtc) => {
            if (cid !== channelId || userId === me || !readers[userId]) return;
            readers[userId].at = new Date(readUtc);
            refreshTicks();
        });

        // A chat was deleted: a one-to-one chat (by you in another tab, or the other person) or a channel (by an admin).
        hub.on("ChannelDeleted", (cid) => {
            if (cid === channelId) { window.location.href = "/chat"; return; }
            const item = document.querySelector(`.side-item[data-channel="${cid}"]`);
            if (item) item.remove();
        });

        document.addEventListener("sahyog:connected", () => {
            if (channelId) hub.invoke("WatchChannel", channelId).catch(() => { });
        });
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible" && channelId && hub.state === "Connected")
                hub.invoke("MarkRead", channelId).catch(() => { });
        });
    }

    // ---------- composer ----------
    if (!form || !channelId) return;

    const autosize = () => {
        box.style.height = "auto";
        box.style.height = Math.min(box.scrollHeight, 160) + "px";
    };

    let lastTyping = 0;
    box.addEventListener("input", () => {
        autosize();
        if (hub && hub.state === "Connected" && Date.now() - lastTyping > 2500) {
            lastTyping = Date.now();
            hub.invoke("Typing", channelId).catch(() => { });
        }
    });
    box.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            form.requestSubmit();
        }
    });

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const text = box.value.trim();
        if (!text) return;
        if (!hub || hub.state !== "Connected") {
            S.toast("Reconnecting… your message was not sent yet.");
            return;
        }
        box.value = "";
        autosize();
        try {
            const sent = await hub.invoke("SendMessage", channelId, text);
            append(sent);
        } catch (err) {
            box.value = text;
            S.toast(err?.message?.replace(/^.*HubException: /, "") || "Message not sent.");
        }
    });

    // ---------- upload ----------
    const fileInput = document.getElementById("fileInput");
    const progress = document.getElementById("uploadProgress");
    const bar = document.getElementById("uploadBar");
    document.getElementById("attachBtn").addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", () => {
        const file = fileInput.files[0];
        fileInput.value = "";
        if (!file) return;
        if (file.size > maxMb * 1024 * 1024) {
            S.toast(`Files can be up to ${maxMb} MB.`);
            return;
        }
        const data = new FormData();
        data.append("file", file);
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/chat/${channelId}/upload`);
        xhr.setRequestHeader("RequestVerificationToken", S.antiforgery());
        document.getElementById("uploadName").textContent = `Uploading ${file.name}…`;
        bar.style.width = "0";
        progress.hidden = false;
        xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) bar.style.width = `${(ev.loaded / ev.total) * 100}%`; };
        xhr.onload = () => {
            progress.hidden = true;
            if (xhr.status >= 200 && xhr.status < 300) append(JSON.parse(xhr.responseText));
            else {
                let msg = "Upload failed.";
                try { msg = JSON.parse(xhr.responseText).error || msg; } catch { }
                S.toast(msg);
            }
        };
        xhr.onerror = () => { progress.hidden = true; S.toast("Upload failed. Check your connection."); };
        xhr.send(data);
    });
})();
