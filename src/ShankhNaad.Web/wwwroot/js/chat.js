// Sahyog · chat page: render messages, send, typing, upload, load older, unread badges.
(function () {
    "use strict";

    const S = window.Sahyog;
    const root = document.getElementById("chat");
    if (!root || !S) return;

    const channelId = root.dataset.channel || null;
    const me = root.dataset.me;
    // in a person's chat: their id (messages either of you wrote in shared groups show here too)
    const other = root.dataset.other || null;
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

    // ---------- call cards ----------
    // Outcome: 0 ringing, 1 in progress, 2 ended, 3 not answered, 4 declined, 5 cancelled
    const callStates = new Map();
    const dur = (a, b) => {
        const sec = Math.max(0, Math.round((new Date(b) - new Date(a)) / 1000));
        const h = Math.floor(sec / 3600), mnt = Math.floor((sec % 3600) / 60), sc = sec % 60;
        return h ? `${h}h ${mnt}m` : mnt ? `${mnt}m ${sc}s` : `${sc}s`;
    };
    function callCardHtml(id, mine, who, at) {
        const c = callStates.get(id);
        const o = c ? c.outcome : -1;
        const name = S.escape(who);
        let kind = "", icon = "fa-video-camera", title, sub = time(at), btn = "";
        const join = `<a class="msg-call-join" href="/meetings/room/${id}"><i class="fa fa-video-camera" aria-hidden="true"></i> Join</a>`;
        const back = `<button type="button" class="msg-call-back" data-callback="1"><i class="fa fa-phone" aria-hidden="true"></i> Call back</button>`;
        switch (o) {
            case 0: kind = "ringing"; title = mine ? "Calling…" : `${name} is calling you`; btn = mine ? "" : join; break;
            case 1: kind = "live"; title = "Call in progress"; sub = `Started ${time(c.answeredUtc || at)}`; btn = join; break;
            case 2: kind = "ended"; icon = "fa-phone"; title = "Call ended"; sub = `${time(at)} · ${dur(c.answeredUtc || at, c.endedUtc || at)}`; break;
            case 3: case 5: kind = mine ? "ended" : "missed"; icon = "fa-phone"; title = mine ? (o === 5 ? "Call cancelled" : "No answer") : `Missed call from ${name}`; btn = mine && o === 5 ? "" : back; break;
            case 4: kind = mine ? "missed" : "ended"; icon = "fa-phone"; title = mine ? "Call declined" : "You declined the call"; btn = back; break;
            default: title = mine ? "You started a video call" : `${name} started a video call`;
        }
        return `<span class="msg-call-ic ${kind}"><i class="fa ${icon}" aria-hidden="true"></i></span>`
            + `<span class="msg-call-txt"><b>${title}</b><small>${sub}</small></span>${btn}`;
    }
    function paintCall(id) {
        document.querySelectorAll(`.msg-call[data-call="${id}"]`).forEach((b) => {
            b.innerHTML = callCardHtml(id, b.dataset.mine === "1", b.dataset.who, b.dataset.at);
            b.dataset.state = callStates.get(id)?.outcome ?? "";
        });
    }
    let callQueue = new Set(), callTimer = null;
    function queueCallState(id) {
        callQueue.add(id);
        clearTimeout(callTimer);
        callTimer = setTimeout(async () => {
            const ids = [...callQueue]; callQueue = new Set();
            try {
                const res = await fetch(`/meetings/calls?ids=${ids.join(",")}`, { headers: { Accept: "application/json" } });
                if (!res.ok) return;
                (await res.json()).forEach((c) => { callStates.set(c.meetingId.toLowerCase(), c); paintCall(c.meetingId.toLowerCase()); });
            } catch { /* cards keep their plain look */ }
        }, 120);
    }
    // "Call back" on a missed call: start a new call in that chat
    document.addEventListener("click", (e) => {
        const b = e.target.closest(".msg-call [data-callback]");
        if (!b) return;
        const f = document.createElement("form");
        f.method = "post"; f.action = "/meetings/instant"; f.hidden = true;
        f.innerHTML = `<input name="channelId" value="${S.escape(b.closest(".msg-call").dataset.ch)}"><input name="__RequestVerificationToken" value="${S.escape(S.antiforgery())}">`;
        document.body.appendChild(f);
        f.submit();
    });

    // ---------- reactions on messages (👍 ❤️ 😂 …), like Teams ----------
    const REACTS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "👏", "🎉"];
    const reactState = new Map();   // message id → [{ emoji, userId, name }]
    let reactQueue = new Set(), reactTimer = null;
    function queueReactions(id) {
        reactQueue.add(id);
        clearTimeout(reactTimer);
        reactTimer = setTimeout(async () => {
            const ids = [...reactQueue]; reactQueue = new Set();
            try {
                const res = await fetch(`/chat/reactions?ids=${ids.join(",")}`, { headers: { Accept: "application/json" } });
                if (!res.ok) return;
                const byMsg = new Map();
                (await res.json()).forEach((r) => { if (!byMsg.has(r.messageId)) byMsg.set(r.messageId, []); byMsg.get(r.messageId).push(r); });
                byMsg.forEach((list, id) => { reactState.set(id, list); paintReactions(id, false); });
            } catch { }
        }, 150);
    }
    function paintReactions(id, animate) {
        const box = document.querySelector(`.msg-reacts[data-mid="${id}"]`);
        if (!box) return;
        const list = reactState.get(id) || [];
        const groups = new Map();
        list.forEach((r) => { if (!groups.has(r.emoji)) groups.set(r.emoji, []); groups.get(r.emoji).push(r); });
        const before = new Map([...box.querySelectorAll("[data-react]")].map((b) => [b.dataset.react, b.dataset.n]));
        box.innerHTML = [...groups].map(([emoji, who]) => {
            const minePick = who.some((r) => String(r.userId).toLowerCase() === String(me).toLowerCase());
            const names = who.map((r) => String(r.userId).toLowerCase() === String(me).toLowerCase() ? "You" : r.name);
            const bump = animate && before.get(emoji) !== String(who.length) ? " bump" : "";
            return `<button type="button" class="react-chip${minePick ? " mine" : ""}${bump}" data-react="${emoji}" data-mid="${id}" data-n="${who.length}"
                        title="${S.escape(names.join(", "))} reacted ${emoji}" aria-pressed="${minePick}">
                        <span class="rc-e">${emoji}</span><span class="rc-n">${who.length}</span></button>`;
        }).join("");
        box.classList.toggle("has", groups.size > 0);
    }
    async function react(id, emoji, btn) {
        btn?.classList.remove("tap"); void btn?.offsetWidth; btn?.classList.add("tap");
        // show it straight away; the server's answer then corrects it
        const list = (reactState.get(id) || []).slice();
        const i = list.findIndex((r) => r.emoji === emoji && String(r.userId).toLowerCase() === String(me).toLowerCase());
        if (i >= 0) list.splice(i, 1); else list.push({ messageId: id, emoji, userId: me, name: "You" });
        reactState.set(id, list); paintReactions(id, true);
        try {
            const err = await hub.invoke("ReactToMessage", Number(id), emoji);
            if (err) { S.toast(err, { kind: "warn" }); queueReactions(id); }
        } catch { queueReactions(id); }
    }
    document.addEventListener("click", (e) => {
        const b = e.target.closest("[data-react][data-mid]");
        if (!b || !b.closest(".msg")) return;
        e.preventDefault();
        react(Number(b.dataset.mid), b.dataset.react, b);
    });

    function messageEl(m, previous) {
        const mine = m.senderId === me;
        const grouped = previous && previous.senderId === m.senderId && previous.day === dayKey(m.sentUtc)
            && new Date(m.sentUtc) - new Date(previous.sentUtc) < 5 * 60 * 1000;
        const el = document.createElement("div");
        el.className = `msg${mine ? " mine" : ""}${grouped ? " grouped" : ""}`;
        el.dataset.id = m.id;
        if (mine && m.channelId === channelId) el.dataset.sent = m.sentUtc;
        // a call started from this chat: ONE card per call that changes as the call goes on
        const call = /^\[\[call:([0-9a-f-]{36})\]\]$/i.exec(m.body || "");
        if (call) { el.classList.add("msg-is-call"); el.dataset.call = call[1].toLowerCase(); }
        const body = call
            ? `<div class="bubble msg-call" data-call="${call[1].toLowerCase()}" data-mine="${mine ? 1 : 0}" data-ch="${S.escape(m.channelId)}" data-who="${S.escape(m.senderName)}" data-at="${S.escape(m.sentUtc)}">${callCardHtml(call[1].toLowerCase(), mine, m.senderName, m.sentUtc)}</div>`
            : m.body ? `<p class="bubble">${linkify(S.escape(m.body))}</p>` : "";
        if (call) queueCallState(call[1].toLowerCase());
        const file = m.attachment ? attachmentHtml(m.attachment) : "";
        const canDelete = mine || isAdmin;
        // a group message shown in a person's chat
        const fromGroup = m.channelId !== channelId ? (m.fromGroup || "a group") : null;
        el.innerHTML = `
            <span class="avatar av-38 tone-${m.senderTone}" data-user="${S.escape(m.senderId)}">${S.escape(m.senderInitials)}</span>
            <div class="msg-body">
                <span class="msg-meta">${mine ? "You" : `<strong>${S.escape(m.senderName)}</strong>`} · ${time(m.sentUtc)}${fromGroup ? ` <span class="msg-from" title="Written in the group ${S.escape(fromGroup)}"><i class="fa fa-users" aria-hidden="true"></i> in ${S.escape(fromGroup)}</span>` : ""}</span>
                <div class="msg-line">${body}${file}${mine && !fromGroup ? ticksHtml(m.sentUtc) : ""}${canDelete ? `<button type="button" class="msg-del" data-del="${m.id}" title="Delete message" aria-label="Delete message"><i class="fa fa-trash-o" aria-hidden="true"></i></button>` : ""}
                    <span class="msg-quick" role="toolbar" aria-label="React to this message">${REACTS.map((e) => `<button type="button" data-react="${e}" data-mid="${m.id}" aria-label="React ${e}">${e}</button>`).join("")}</span>
                </div>
                <div class="msg-reacts" data-mid="${m.id}"></div>
            </div>`;
        queueReactions(m.id);
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

    // ---------- the list on the left, reloaded without reloading the page ----------
    let refreshing = null;
    function refreshSide(highlight) {
        if (refreshing) return refreshing;
        refreshing = fetch(location.pathname, { headers: { Accept: "text/html" } })
            .then((r) => r.ok ? r.text() : null)
            .then((html) => {
                if (!html) return;
                const fresh = new DOMParser().parseFromString(html, "text/html").querySelector(".chat-side .side-scroll");
                const now = document.querySelector(".chat-side .side-scroll");
                if (!fresh || !now) return;
                now.innerHTML = fresh.innerHTML;
                document.getElementById("sideFilter")?.dispatchEvent(new Event("input"));
                S.paintPhotos?.(now);
                S.paintPresence?.();
                const row = highlight && now.querySelector(`.sn-person-row[data-channel="${highlight}"]`);
                if (row) { row.classList.add("sn-new-msg"); setTimeout(() => row.classList.remove("sn-new-msg"), 1600); }
            })
            .catch(() => { })
            .finally(() => { refreshing = null; });
        return refreshing;
    }

    // ---------- real-time ----------
    const hub = S.hub;
    if (hub) {
        // newest conversation first: a chat with a new message moves to the top of "Chats" (pinned ones stay in Pinned)
        const bump = (cid, sentUtc) => {
            const row = document.querySelector(`.sn-person-row[data-channel="${cid}"]`);
            if (!row) return;
            row.dataset.last = sentUtc;
            const list = row.parentElement;
            if (list && list.firstElementChild !== row) list.prepend(row);
        };

        hub.on("MessageReceived", (m) => {
            bump(m.channelId, m.sentUtc);
            // in a person's chat, what they write in a group you share appears here too
            const showHere = m.channelId === channelId || (other && m.channelId !== channelId && m.fromGroup && m.senderId === other);
            if (showHere) {
                append(m);
                typing.hidden = true;
                if (document.visibilityState === "visible") hub.invoke("MarkRead", channelId).catch(() => { });
            } else {
                // a group message from someone you chat with lights up their row (the "Everyone" group isn't listed)
                const item = document.querySelector(`.side-item[data-channel="${m.channelId}"]`)
                    || (m.fromGroup ? document.querySelector(`.side-item[data-person="${m.senderId}"]`) : null);
                if (item) {
                    const badge = item.querySelector(".badge");
                    badge.textContent = String(Number(badge.textContent || 0) + 1);
                    badge.hidden = false;
                    item.classList.add("unread", "sn-new-msg");
                    setTimeout(() => item.classList.remove("sn-new-msg"), 1600);
                    if (item.parentElement) item.parentElement.insertBefore(item, item.parentElement.querySelector(".side-item"));
                } else if (m.senderId !== me) {
                    // someone started a new chat with you: reload just the list so it appears under Chats
                    refreshSide(m.channelId);
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
            if (title) { title.textContent = name; title.title = name; }
            const sub = document.querySelector("#ChatHeader .hdr-subtitle");
            if (sub) {
                const count = (sub.textContent || "").split(" · ")[0];
                sub.textContent = description ? `${count} · ${description}` : count;
            }
            const box = document.getElementById("messageBox");
            if (box) box.placeholder = "Message " + name;
            document.title = `${name} · ShankhNaad`;
        });

        // a call changed (answered, ended, missed, declined): its card in the chat changes with it
        hub.on("CallUpdated", (c) => {
            const id = c.meetingId.toLowerCase();
            callStates.set(id, c);
            paintCall(id);
        });

        // someone reacted to a message in this chat
        hub.on("MessageReactions", (id, list) => {
            reactState.set(Number(id), list || []);
            paintReactions(Number(id), true);
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
