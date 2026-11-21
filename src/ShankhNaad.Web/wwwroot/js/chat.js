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

    // ---------- a message that is only emoji: no bubble, big, animated ----------
    // Animated pictures come from Google's Noto animated emoji; if one can't load, the normal emoji shows (with a little bounce).
    const EMOJI_ONE = /^(?:\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*|\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3)$/u;
    const graphemes = (t) => (window.Intl && Intl.Segmenter)
        ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(t)].map((x) => x.segment)
        : Array.from(t);
    /** The emoji of a message made only of 1–5 emoji (spaces allowed), else null. */
    function emojiOnly(text) {
        const t = (text || "").trim();
        if (!t || t.length > 80) return null;
        const parts = graphemes(t).filter((g) => !/^\s+$/.test(g));
        if (!parts.length || parts.length > 5 || !parts.every((g) => EMOJI_ONE.test(g))) return null;
        // a lone symbol like © or ™ (text unless it carries the emoji marker) stays normal text
        if (parts.some((g) => [...g].length === 1 && !/\p{Emoji_Presentation}/u.test(g))) return null;
        return parts;
    }
    const NOTO = "https://fonts.gstatic.com/s/e/notoemoji/latest/";
    const notoCode = (g, keepVs) => [...g].map((c) => c.codePointAt(0)).filter((cp) => keepVs || cp !== 0xfe0f).map((cp) => cp.toString(16)).join("_");
    function emojiHtml(parts) {
        const size = parts.length === 1 ? "e1" : parts.length <= 3 ? "e3" : "e5";
        const imgs = parts.map((g, i) => {
            const a = notoCode(g, true), b = notoCode(g, false);
            return `<span class="be" style="--i:${i}"><img src="${NOTO}${a}/512.webp" alt="${S.escape(g)}" data-alt2="${b !== a ? b : ""}" loading="lazy" decoding="async" draggable="false"></span>`;
        }).join("");
        return `<p class="bubble bubble-emoji ${size}" role="img" aria-label="${S.escape(parts.join(" "))}">${imgs}</p>`;
    }
    // a missing animation: try without the variation selector, then show the plain emoji
    list?.addEventListener("error", (e) => {
        const img = e.target;
        if (!(img instanceof HTMLImageElement)) return;
        if (img.closest(".bubble-emoji")) {
            const b = img.dataset.alt2;
            if (b) { img.dataset.alt2 = ""; img.src = `${NOTO}${b}/512.webp`; return; }
            const t = document.createElement("span");
            t.className = "be-text";
            t.textContent = img.alt;
            img.replaceWith(t);
        } else if (img.dataset.gifFallback) {
            const f = img.dataset.gifFallback;
            img.dataset.gifFallback = "";
            if (f) img.src = f;
        }
    }, true);

    // ---------- GIFs (GIPHY): the message is "[[gif:ID:WIDTHxHEIGHT]]" ----------
    const GIF_RE = /^\[\[gif:([A-Za-z0-9]{4,64}):(\d{1,4})x(\d{1,4})\]\]$/;
    const isGif = (body) => GIF_RE.test((body || "").trim());
    function gifHtml(body) {
        const g = GIF_RE.exec((body || "").trim());
        const id = g[1];
        let w = Math.max(1, +g[2]), h = Math.max(1, +g[3]);
        // shown 200 px tall (narrower screens: at most 280 px wide)
        const scale = Math.min(200 / h, 280 / w);
        w = Math.round(w * scale); h = Math.round(h * scale);
        const base = `https://media.giphy.com/media/${id}/`;
        return `<div class="bubble bubble-gif"><a href="https://giphy.com/gifs/${id}" target="_blank" rel="noopener" title="Open on GIPHY">`
            + `<img src="${base}200.webp" data-gif-fallback="${base}200.gif" width="${w}" height="${h}" alt="GIF" loading="lazy" decoding="async"></a><span class="gif-badge">GIF</span></div>`;
    }
    // ---------- forwarded messages: "[[fwd:NAME]]" then the original text ----------
    const FWD_RE = /^\[\[fwd:([^\]\r\n]{1,80})\]\]\n?/;
    const fwdOf = (body) => { const f = FWD_RE.exec(body || ""); return f ? { from: f[1], rest: (body || "").slice(f[0].length) } : null; };
    /** The message's text part: a GIF, big emoji, or a normal bubble (forwarded: with "Forwarded from" above). */
    function bodyHtml(body) {
        if (!body) return "";
        const f = fwdOf(body);
        if (f) return `<span class="msg-fwd"><i class="fa fa-share" aria-hidden="true"></i> Forwarded from ${S.escape(f.from)}</span>` + bodyHtml(f.rest);
        if (isGif(body)) return gifHtml(body);
        const e = emojiOnly(body);
        return e ? emojiHtml(e) : `<p class="bubble">${linkify(S.escape(body))}</p>`;
    }
    const shortText = (body) => fwdOf(body) ? "↪ " + (fwdOf(body).rest ? shortText(fwdOf(body).rest) : "Forwarded") : isGif(body) ? "🎞️ GIF" : /^\[\[call:/i.test(body || "") ? "📞 Call" : (body || "").replace(/\s+/g, " ").trim();

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
    // the "+" panel and the 😊 button in the message box; keep in step with ReactionEmojis.More in ReactionService.cs
    const EMOJI_GROUPS = [
        ["Smileys", "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😜 🤪 😎 🤓 🥳 😏 😌 😴 🤗 🤔 🤭 🤫 😶 😐 😑 😬 🙄 😮 😯 😲 😳 🥺 😢 😭 😤 😡 🤯 😱 🤒 🤧 😷".split(" ")],
        ["Hands", "👍 👎 👌 ✌️ 🤞 🤟 🤘 👏 🙌 👐 🙏 🤝 💪 👋 ✋ 👊 ✊ 🫡 👀 🧠".split(" ")],
        ["Hearts & fun", "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💯 💥 ✨ 🔥 ⭐ 🌟 🎉 🎊 🎁 🏆 🥇".split(" ")],
        ["Work & more", "✅ ❌ ⚠️ ❓ ❗ 💡 📌 📎 📅 ⏰ 📞 💻 📊 📈 🚀 ☕ 🍕 🍰 🌹 🌞".split(" ")]
    ];
    // words for the emoji panel's search box (English, a few per emoji)
    const EMOJI_WORDS = {"😀": "grin smile happy", "😃": "smile happy joy", "😄": "smile happy laugh", "😁": "grin beam happy", "😆": "laugh lol happy", "😅": "sweat laugh nervous phew", "🤣": "rofl laugh lol", "😂": "joy laugh tears lol", "🙂": "slight smile ok", "😉": "wink", "😊": "blush smile happy", "😇": "angel innocent halo", "🥰": "love hearts adore", "😍": "heart eyes love", "🤩": "star struck wow amazing", "😘": "kiss love", "😋": "yum tasty delicious", "😜": "wink tongue silly crazy", "🤪": "zany crazy silly", "😎": "cool sunglasses", "🤓": "nerd geek glasses", "🥳": "party celebrate birthday", "😏": "smirk", "😌": "relieved calm peace", "😴": "sleep tired zzz", "🤗": "hug hugging", "🤔": "think thinking hmm", "🤭": "oops giggle hand", "🤫": "shush quiet secret", "😶": "no mouth silent speechless", "😐": "neutral meh", "😑": "expressionless meh", "😬": "grimace awkward", "🙄": "eye roll whatever", "😮": "wow surprised open mouth", "😯": "hushed surprised", "😲": "astonished shocked wow", "😳": "flushed embarrassed", "🥺": "pleading please puppy", "😢": "cry sad tear", "😭": "sob cry sad", "😤": "triumph huff angry", "😡": "angry mad rage", "🤯": "mind blown explode", "😱": "scream fear shock", "🤒": "sick fever ill", "🤧": "sneeze sick cold", "😷": "mask sick", "👍": "thumbs up like yes ok good", "👎": "thumbs down dislike no bad", "👌": "ok perfect fine", "✌️": "peace victory", "🤞": "fingers crossed luck hope", "🤟": "love you", "🤘": "rock horns", "👏": "clap applause bravo well done", "🙌": "raise hands celebrate hooray", "👐": "open hands", "🙏": "pray thanks please namaste", "🤝": "handshake deal agree", "💪": "strong muscle flex power", "👋": "wave hello hi bye", "✋": "hand stop high five", "👊": "fist bump punch", "✊": "fist power", "🫡": "salute respect yes sir", "👀": "eyes look see watching", "🧠": "brain smart think", "❤️": "heart love red", "🧡": "orange heart", "💛": "yellow heart", "💚": "green heart", "💙": "blue heart", "💜": "purple heart", "🖤": "black heart", "🤍": "white heart", "💔": "broken heart sad", "💯": "hundred perfect 100", "💥": "boom bang", "✨": "sparkles shine new", "🔥": "fire hot lit", "⭐": "star", "🌟": "glowing star shine", "🎉": "party tada celebrate congrats", "🎊": "confetti celebrate", "🎁": "gift present", "🏆": "trophy win award winner", "🥇": "gold medal first winner", "✅": "check done yes tick complete", "❌": "cross no wrong cancel", "⚠️": "warning alert caution", "❓": "question what", "❗": "exclamation important", "💡": "idea bulb light", "📌": "pin pushpin important", "📎": "paperclip attach file", "📅": "calendar date schedule meeting", "⏰": "alarm clock time reminder", "📞": "phone call", "💻": "laptop computer work", "📊": "chart bar stats report", "📈": "chart up growth trend", "🚀": "rocket launch fast ship", "☕": "coffee tea break", "🍕": "pizza food", "🍰": "cake birthday dessert", "🌹": "rose flower", "🌞": "sun sunny morning"};
    const msgInfo = new Map();      // message id → { name, text } (for replies)
    const bodies = new Map();       // message id → its text (for editing your own messages)
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
        if (!b || !b.closest(".msg, .msg-more-panel")) return;
        e.preventDefault();
        const inPanel = b.closest(".msg-more-panel");
        react(Number(b.dataset.mid), b.dataset.react, inPanel ? null : b);
        if (inPanel) closeMorePanel();
    });

    // ---------- "+" : all the other reactions in a small panel ----------
    let morePanel = null;
    function closeMorePanel() {
        if (!morePanel) return;
        morePanel.owner?.closest(".msg")?.classList.remove("acts-open");
        morePanel.remove(); morePanel = null;
    }
    // btn.dataset.more = message id → reacts to that message; btn.dataset.emojiFor = "composer" → types into the box
    function openMorePanel(btn) {
        const mid = btn.dataset.more || "";
        const forBox = !mid;
        const key = mid || "composer";
        if (morePanel && morePanel.dataset.key === key) { closeMorePanel(); return; }
        closeMorePanel();
        const panel = document.createElement("div");
        panel.className = "msg-more-panel";
        panel.dataset.key = key;
        if (mid) panel.dataset.mid = mid;
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-label", forBox ? "Emoji" : "More reactions");
        panel.innerHTML = `<label class="mmp-search"><i class="fa fa-search" aria-hidden="true"></i><input type="search" placeholder="Search emoji (happy, thumbs, fire…)" aria-label="Search emoji" autocomplete="off" /></label>`
            + EMOJI_GROUPS.map(([name, list]) => `<div class="mmp-head" data-group="${name}">${name}</div>` + list.map((e) => {
                const words = S.escape(`${EMOJI_WORDS[e] || ""} ${name}`.toLowerCase());
                return forBox
                    ? `<button type="button" data-insert="${e}" data-words="${words}" data-group="${name}" aria-label="${e}" title="${S.escape(EMOJI_WORDS[e] || "")}">${e}</button>`
                    : `<button type="button" data-react="${e}" data-mid="${mid}" data-words="${words}" data-group="${name}" aria-label="React ${e}" title="${S.escape(EMOJI_WORDS[e] || "")}">${e}</button>`;
            }).join("")).join("")
            + `<div class="mmp-none" hidden>No emoji found</div>`;
        // search: matches any word that starts with what you type ("thu" → 👍 👎), group headings hide when empty
        const findBox = panel.querySelector(".mmp-search input");
        findBox.addEventListener("input", () => {
            const q = findBox.value.trim().toLowerCase();
            let any = 0;
            const shown = {};
            panel.querySelectorAll("button[data-words]").forEach((b) => {
                const ok = !q || b.dataset.words.split(" ").some((w) => w.startsWith(q)) || b.textContent === q;
                b.hidden = !ok;
                if (ok) { any++; shown[b.dataset.group] = true; }
            });
            panel.querySelectorAll(".mmp-head").forEach((h) => { h.hidden = !shown[h.dataset.group]; });
            panel.querySelector(".mmp-none").hidden = any > 0;
        });
        // Enter picks the first match
        findBox.addEventListener("keydown", (e) => {
            if (e.key === "Escape") { e.stopPropagation(); closeMorePanel(); return; }
            if (e.key !== "Enter") return;
            e.preventDefault();
            panel.querySelector("button[data-words]:not([hidden])")?.click();
        });
        document.body.appendChild(panel);
        panel.owner = btn;
        btn.closest(".msg")?.classList.add("acts-open");
        // above the button, kept inside the window; below it if there's no room above
        const r = btn.getBoundingClientRect(), w = panel.offsetWidth, h = panel.offsetHeight;
        const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
        let top = r.top - h - 8;
        if (top < 8) top = Math.min(r.bottom + 8, window.innerHeight - h - 8);
        panel.style.left = `${left}px`; panel.style.top = `${Math.max(8, top)}px`;
        morePanel = panel;
        requestAnimationFrame(() => { panel.classList.add("show"); findBox.focus({ preventScroll: true }); });
    }
    // an emoji picked for the message box goes where the cursor is; the panel stays open for more
    document.addEventListener("click", (e) => {
        const b = e.target.closest(".msg-more-panel [data-insert]");
        if (!b || !box) return;
        e.preventDefault();
        const start = box.selectionStart ?? box.value.length, end = box.selectionEnd ?? box.value.length;
        box.value = box.value.slice(0, start) + b.dataset.insert + box.value.slice(end);
        const at = start + b.dataset.insert.length;
        box.focus(); box.setSelectionRange(at, at);
        box.dispatchEvent(new Event("input"));
    });
    document.addEventListener("click", (e) => {
        const more = e.target.closest("[data-more], [data-emoji-for]");
        if (more) { e.preventDefault(); openMorePanel(more); return; }
        if (morePanel && !e.target.closest(".msg-more-panel")) closeMorePanel();
    });
    scroller?.addEventListener("scroll", closeMorePanel);
    window.addEventListener("resize", closeMorePanel);

    // ---------- reply to a particular message ----------
    let replyTo = null;   // { id, name, text }
    const replyBar = document.createElement("div");
    replyBar.className = "reply-bar";
    replyBar.hidden = true;
    replyBar.innerHTML = `<i class="fa fa-reply" aria-hidden="true"></i>
        <div class="reply-bar-txt"><b></b><span></span></div>
        <button type="button" class="reply-bar-x" aria-label="Cancel reply" title="Cancel reply">&times;</button>`;
    form?.parentNode.insertBefore(replyBar, form);
    function startReply(id) {
        const info = msgInfo.get(Number(id));
        if (!info || !box) return;
        replyTo = { id: Number(id), ...info };
        replyBar.querySelector("b").textContent = `Replying to ${info.name}`;
        replyBar.querySelector("span").textContent = info.text;
        replyBar.hidden = false;
        box.focus();
    }
    function cancelReply() { replyTo = null; replyBar.hidden = true; }
    replyBar.querySelector(".reply-bar-x").addEventListener("click", () => { cancelReply(); box?.focus(); });
    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        if (morePanel) closeMorePanel(); else if (replyTo) cancelReply();
    });
    list?.addEventListener("click", (e) => {
        const rep = e.target.closest("[data-reply]");
        if (rep) { e.preventDefault(); startReply(rep.dataset.reply); return; }
        const fw = e.target.closest("[data-fwd]");
        if (fw) { e.preventDefault(); openForward(Number(fw.dataset.fwd)); return; }
        // the quote in a reply: jump to the original and make it glow for a moment
        const q = e.target.closest(".msg-quote[data-jump]");
        if (!q) return;
        const target = list.querySelector(`.msg[data-id="${q.dataset.jump}"]`);
        if (!target) { S.toast("That message is further up. Press \"Load older messages\" to see it."); return; }
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.remove("msg-flash"); void target.offsetWidth; target.classList.add("msg-flash");
    });
    // ---------- forward a message to other chats ----------
    // (a window from an earlier visit to this page lost its listeners when the page was left: start fresh)
    document.querySelectorAll(".sn-fwd-dlg, .gif-panel").forEach((x) => x.remove());
    let fwdDlg = null;
    function openForward(id) {
        const el = list.querySelector(`.msg[data-id="${id}"]`);
        if (!el) return;
        const b = bodies.get(id);
        const text = b ? shortText(b) : "📎 " + ((el.querySelector(".msg-line a")?.textContent || "").trim() || "a file");
        if (!fwdDlg) {
            fwdDlg = document.createElement("dialog");
            fwdDlg.className = "sn-dialog glass-strong sn-fwd-dlg";
            fwdDlg.setAttribute("aria-labelledby", "fwdT");
            fwdDlg.innerHTML = `<div class="sn-dlg-head"><div class="sn-dlg-title"><span class="sn-dlg-icon sn-fwd-ic"><i class="fa fa-share" aria-hidden="true"></i></span>`
                + `<div><h2 id="fwdT">Forward message</h2><p>Pick up to 10 chats (people or groups)</p></div></div>`
                + `<button type="button" class="sn-close" data-close aria-label="Close"><i class="fa fa-times" aria-hidden="true"></i></button></div>`
                + `<div class="sn-dlg-body sn-fwd-body"><blockquote class="sn-fwd-preview"></blockquote>`
                + `<label class="gif-search sn-fwd-search"><i class="fa fa-search" aria-hidden="true"></i><input type="search" placeholder="Search people or groups" aria-label="Search chats" autocomplete="off"></label>`
                + `<div class="sn-fwd-list" role="listbox" aria-multiselectable="true"></div>`
                + `<input type="text" class="sn-fwd-note" maxlength="1000" placeholder="Add a message (optional)" aria-label="Add a message"></div>`
                + `<div class="sn-dlg-foot"><span class="sn-fwd-count muted small">Nobody picked yet</span><span style="display:flex;gap:10px;margin-left:auto">`
                + `<button type="button" class="cee-btn sn-btn-light" data-close>Cancel</button>`
                + `<button type="button" class="cee-btn cee-btn-gradient sn-fwd-go" disabled><i class="fa fa-share" aria-hidden="true"></i> <span>Forward</span></button></span></div>`;
            document.body.appendChild(fwdDlg);
            fwdDlg.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) fwdDlg.close(); });
            const listEl = fwdDlg.querySelector(".sn-fwd-list");
            const count = () => {
                const n = listEl.querySelectorAll("input:checked").length;
                fwdDlg.querySelector(".sn-fwd-count").textContent = n ? `${n} picked` : "Nobody picked yet";
                fwdDlg.querySelector(".sn-fwd-go").disabled = n === 0;
                listEl.querySelectorAll("input:not(:checked)").forEach((i) => { i.disabled = n >= 10; });
            };
            listEl.addEventListener("change", count);
            fwdDlg.querySelector(".sn-fwd-search input").addEventListener("input", (e) => {
                const q = e.target.value.trim().toLowerCase();
                listEl.querySelectorAll(".sn-fwd-row").forEach((r) => { r.hidden = !!q && !r.dataset.name.toLowerCase().includes(q); });
            });
            fwdDlg._count = count;
        }
        // the chats you're in, from the list on the left (not this one)
        const listEl = fwdDlg.querySelector(".sn-fwd-list");
        const seen = new Set();
        listEl.innerHTML = [...document.querySelectorAll(".sn-person-row[data-channel]")].filter((r) => {
            const ch = r.dataset.channel;
            if (!ch || ch === channelId || seen.has(ch)) return false;
            seen.add(ch); return true;
        }).map((r) => {
            const av = r.querySelector(".avatar")?.outerHTML || "";
            const name = r.dataset.filter || r.querySelector(".grow")?.textContent || "Chat";
            return `<label class="sn-fwd-row" data-name="${S.escape(name)}"><input type="checkbox" value="${S.escape(r.dataset.channel)}">${av}<span class="grow ellipsis">${S.escape(name)}</span><i class="fa fa-check sn-fwd-tick" aria-hidden="true"></i></label>`;
        }).join("") || `<p class="muted small" style="margin:12px">No other chats yet. Start one from the list on the left.</p>`;
        fwdDlg.querySelector(".sn-fwd-preview").textContent = text.length > 160 ? text.slice(0, 160) + "…" : text;
        fwdDlg.querySelector(".sn-fwd-search input").value = "";
        fwdDlg.querySelector(".sn-fwd-note").value = "";
        fwdDlg._count();
        const go = fwdDlg.querySelector(".sn-fwd-go");
        go.lastElementChild.textContent = "Forward";
        go.onclick = async () => {
            const picked = [...listEl.querySelectorAll("input:checked")].map((i) => i.value);
            if (!picked.length) return;
            go.disabled = true; go.lastElementChild.textContent = "Forwarding…";
            const fd = new FormData();
            fd.append("from", channelId);
            picked.forEach((c) => fd.append("to", c));
            fd.append("note", fwdDlg.querySelector(".sn-fwd-note").value.trim());
            try {
                const r = await fetch(`/chat/messages/${id}/forward`, { method: "POST", body: fd, headers: { RequestVerificationToken: S.antiforgery() }, credentials: "same-origin" });
                const d = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(d.error || "Not forwarded. Try again.");
                fwdDlg.close();
                S.toast(d.message || "Forwarded.", { kind: "success", title: "Forwarded" });
            } catch (err) {
                go.disabled = false; go.lastElementChild.textContent = "Forward";
                S.toast(err.message, { kind: "warn", title: "Not forwarded" });
            }
        };
        fwdDlg.showModal();
        setTimeout(() => fwdDlg.querySelector(".sn-fwd-search input").focus(), 60);
    }

    const snippet = (m) => {
        if (/^\[\[call:/i.test(m.body || "")) return "📞 Call";
        if (fwdOf(m.body)) return shortText(m.body);
        if (isGif(m.body)) return "🎞️ GIF";
        if (m.attachment) return `📎 ${m.attachment.fileName}`;
        const t = (m.body || "").replace(/\s+/g, " ").trim();
        return t.length > 120 ? `${t.slice(0, 120)}…` : t;
    };
    function quoteHtml(m) {
        if (!m.replyToId) return "";
        if (!m.replyToSender) return `<div class="msg-quote gone"><i class="fa fa-reply" aria-hidden="true"></i><span>Original message was deleted</span></div>`;
        let t = shortText(m.replyToText);
        if (t.length > 120) t = `${t.slice(0, 120)}…`;
        return `<button type="button" class="msg-quote" data-jump="${m.replyToId}" title="Go to the original message">
                    <b>${S.escape(m.replyToSender)}</b><span>${S.escape(t)}</span></button>`;
    }

    function messageEl(m, previous) {
        const mine = m.senderId === me;
        const grouped = previous && previous.senderId === m.senderId && previous.day === dayKey(m.sentUtc)
            && new Date(m.sentUtc) - new Date(previous.sentUtc) < 5 * 60 * 1000;
        const el = document.createElement("div");
        el.className = `msg${mine ? " mine" : ""}${grouped ? " grouped" : ""}${m.isCopied ? " msg-copied" : ""}`;
        el.dataset.id = m.id;
        if (mine && m.channelId === channelId) el.dataset.sent = m.sentUtc;
        // a call started from this chat: ONE card per call that changes as the call goes on
        const call = /^\[\[call:([0-9a-f-]{36})\]\]$/i.exec(m.body || "");
        if (call) { el.classList.add("msg-is-call"); el.dataset.call = call[1].toLowerCase(); }
        const body = call
            ? `<div class="bubble msg-call" data-call="${call[1].toLowerCase()}" data-mine="${mine ? 1 : 0}" data-ch="${S.escape(m.channelId)}" data-who="${S.escape(m.senderName)}" data-at="${S.escape(m.sentUtc)}">${callCardHtml(call[1].toLowerCase(), mine, m.senderName, m.sentUtc)}</div>`
            : bodyHtml(m.body);
        if (call) queueCallState(call[1].toLowerCase());
        const file = m.attachment ? attachmentHtml(m.attachment) : "";
        // only your own messages can be deleted (an admin can't delete other people's either)
        const canDelete = mine;
        msgInfo.set(Number(m.id), { name: mine ? "yourself" : m.senderName, text: snippet(m) });
        // a group message shown in a person's chat
        const fromGroup = m.channelId !== channelId ? (m.fromGroup || "a group") : null;
        // your own text messages can be edited (not calls, not a file without text)
        const canEdit = mine && !call && !!m.body && !isGif(m.body) && !fwdOf(m.body);
        if (!call && isGif(m.body)) el.classList.add("msg-is-gif");
        if (!call && emojiOnly(m.body)) el.classList.add("msg-is-emoji");
        if (!call) bodies.set(Number(m.id), m.body || "");
        const edited = m.editedUtc ? ` <span class="msg-edited" title="Edited ${S.escape(time(m.editedUtc))}">· Edited</span>` : "";
        el.innerHTML = `
            <span class="avatar av-38 tone-${m.senderTone}" data-user="${S.escape(m.senderId)}">${S.escape(m.senderInitials)}</span>
            <div class="msg-body">
                <span class="msg-meta">${mine ? "You" : `<strong>${S.escape(m.senderName)}</strong>`} · ${time(m.sentUtc)}${edited}${fromGroup ? ` <span class="msg-from" title="Written in the group ${S.escape(fromGroup)}"><i class="fa fa-users" aria-hidden="true"></i> in ${S.escape(fromGroup)}</span>` : ""}</span>
                <div class="msg-line">${quoteHtml(m)}${body}${file}${mine && !fromGroup ? ticksHtml(m.sentUtc) : ""}${canEdit ? `<button type="button" class="msg-edit" data-edit="${m.id}" title="Edit message (↑ in an empty box edits your last one)" aria-label="Edit message"><i class="fa fa-pencil" aria-hidden="true"></i></button>` : ""}${canDelete ? `<button type="button" class="msg-del" data-del="${m.id}" title="Delete message" aria-label="Delete message"><i class="fa fa-trash-o" aria-hidden="true"></i></button>` : ""}
                    <span class="msg-quick" role="toolbar" aria-label="React or reply">${REACTS.map((e) => `<button type="button" data-react="${e}" data-mid="${m.id}" aria-label="React ${e}">${e}</button>`).join("")}<button type="button" class="mq-more" data-more="${m.id}" title="More reactions" aria-label="More reactions"><i class="fa fa-plus" aria-hidden="true"></i></button>${call ? "" : `<span class="mq-sep" aria-hidden="true"></span><button type="button" class="mq-reply" data-reply="${m.id}" title="Reply" aria-label="Reply to this message"><i class="fa fa-reply" aria-hidden="true"></i></button><button type="button" class="mq-fwd" data-fwd="${m.id}" title="Forward" aria-label="Forward this message"><i class="fa fa-share" aria-hidden="true"></i></button>`}</span>
                </div>
                <div class="msg-reacts" data-mid="${m.id}"></div>
            </div>`;
        queueReactions(m.id);
        return el;
    }

    function historySep(text, icon) {
        const el = document.createElement("div");
        el.className = "history-sep";
        el.innerHTML = `<span><i class="fa ${icon}" aria-hidden="true"></i> ${S.escape(text)}</span>`;
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
        // copied history (a group made from a one-to-one chat): a line where it starts and where the group's own messages begin
        const wasCopied = !!lastRendered?.copied;
        if (m.isCopied && !wasCopied) list.appendChild(historySep("Shared history from a one-to-one chat", "fa-history"));
        if (!m.isCopied && wasCopied) list.appendChild(historySep("New messages in this group", "fa-users"));
        if (!lastRendered || lastRendered.day !== dayKey(m.sentUtc)) list.appendChild(daySep(m.sentUtc));
        list.appendChild(messageEl(m, lastRendered && !!lastRendered.copied === !!m.isCopied ? lastRendered : null));
        lastRendered = { senderId: m.senderId, sentUtc: m.sentUtc, day: dayKey(m.sentUtc), copied: !!m.isCopied };
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
        list.querySelectorAll(`.msg-quote[data-jump="${id}"]`).forEach((q) => {
            q.outerHTML = `<div class="msg-quote gone"><i class="fa fa-reply" aria-hidden="true"></i><span>Original message was deleted</span></div>`;
        });
        if (replyTo && replyTo.id === Number(id)) cancelReply();
        msgInfo.delete(Number(id));
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

    // ---------- edit your own message ----------
    // Click ✏️ (or press ↑ in an empty box): the bubble becomes a small editor. Enter saves, Shift+Enter = new line, Esc cancels.
    function applyEdit(m) {
        const id = Number(m.id);
        bodies.set(id, m.body || "");
        const info = msgInfo.get(id);
        if (info) info.text = snippet(m);
        // replies quoting it show the new text
        list.querySelectorAll(`.msg-quote[data-jump="${id}"] span`).forEach((sp) => {
            const t = shortText(m.body);
            sp.textContent = t.length > 120 ? `${t.slice(0, 120)}…` : t;
        });
        const el = list.querySelector(`.msg[data-id="${id}"]`);
        if (!el) return;
        if (el.classList.contains("msg-editing")) stopEdit(el);
        const p = el.querySelector(".msg-line > .bubble:not(.msg-call)");
        if (p) {
            // the edited text may now be only emoji (or no longer): draw it again
            p.insertAdjacentHTML("afterend", bodyHtml(m.body || ""));
            p.remove();
            el.classList.toggle("msg-is-emoji", !!emojiOnly(m.body));
        }
        const meta = el.querySelector(".msg-meta");
        if (meta && m.editedUtc && !meta.querySelector(".msg-edited")) {
            const sp = document.createElement("span");
            sp.className = "msg-edited";
            sp.title = `Edited ${time(m.editedUtc)}`;
            sp.textContent = "· Edited";
            const from = meta.querySelector(".msg-from");
            meta.insertBefore(document.createTextNode(" "), from);
            meta.insertBefore(sp, from);
        }
        el.classList.remove("msg-flash"); void el.offsetWidth; el.classList.add("msg-flash");
    }
    function stopEdit(el) {
        el.classList.remove("msg-editing");
        el.querySelector(".msg-editor")?.remove();
        const p = el.querySelector(".msg-line > .bubble");
        if (p) p.hidden = false;
    }
    function startEdit(id) {
        id = Number(id);
        const el = list.querySelector(`.msg[data-id="${id}"]`);
        if (!el || !el.classList.contains("mine")) return;
        list.querySelectorAll(".msg.msg-editing").forEach(stopEdit);
        const p = el.querySelector(".msg-line > .bubble");
        if (!p) return;
        el.classList.add("msg-editing");
        p.hidden = true;
        const ed = document.createElement("form");
        ed.className = "msg-editor";
        ed.innerHTML = `<textarea rows="1" maxlength="4000" aria-label="Edit your message"></textarea>
            <div class="msg-editor-row"><small>Enter to save · Esc to cancel</small>
                <span><button type="button" class="msg-editor-cancel">Cancel</button><button type="submit" class="msg-editor-save"><i class="fa fa-check" aria-hidden="true"></i> Save</button></span></div>`;
        p.after(ed);
        const ta = ed.querySelector("textarea");
        const original = bodies.get(id) || "";
        ta.value = original;
        const size = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 220) + "px"; };
        size();
        ta.addEventListener("input", size);
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
        const cancel = () => { stopEdit(el); box?.focus(); };
        ed.querySelector(".msg-editor-cancel").addEventListener("click", cancel);
        ta.addEventListener("keydown", (e) => {
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); }
            if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); ed.requestSubmit(); }
        });
        ed.addEventListener("submit", async (e) => {
            e.preventDefault();
            const text = ta.value.trim();
            if (text === original.trim()) { cancel(); return; }
            if (!text) { S.toast("A message can't be empty. To remove it, delete it."); return; }
            const save = ed.querySelector(".msg-editor-save");
            save.disabled = true;
            try {
                const fd = new FormData();
                fd.append("body", text);
                const res = await fetch(`/chat/messages/${id}/edit`, { method: "POST", body: fd, headers: { "RequestVerificationToken": S.antiforgery() } });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) { S.toast(data.error || "The message wasn't changed."); save.disabled = false; return; }
                applyEdit(data);
                box?.focus();
            } catch {
                S.toast("The message wasn't changed. Check your connection.");
                save.disabled = false;
            }
        });
    }
    list?.addEventListener("click", (e) => {
        const b = e.target.closest(".msg-edit");
        if (b) startEdit(b.dataset.edit);
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
        // someone edited a message (also one of theirs shown here from a group)
        hub.on("MessageEdited", (m) => { if (m) applyEdit(m); });

        // someone read this conversation: their read time moves on and your ticks update
        hub.on("ChannelRead", (cid, userId, readUtc) => {
            if (cid !== channelId || userId === me || !readers[userId]) return;
            readers[userId].at = new Date(readUtc);
            refreshTicks();
        });

        // A chat was deleted: a one-to-one chat (by you in another tab, or the other person) or a channel (by an admin).
        // you were removed from a group: it leaves your list (and the page, if it's open)
        hub.on("RemovedFromGroup", (cid, name) => {
            S.toast(`You were removed from "${name}".`, { kind: "info", title: "Removed from group" });
            if (cid === channelId) { setTimeout(() => { window.SN?.go ? SN.go("/chat") : (window.location.href = "/chat"); }, 1400); return; }
            document.querySelectorAll(`.side-item[data-channel="${cid}"]`).forEach((x) => x.remove());
        });

        hub.on("ChannelDeleted", (cid) => {
            if (cid === channelId) { window.SN?.go ? SN.go("/chat") : (window.location.href = "/chat"); return; }
            const item = document.querySelector(`.side-item[data-channel="${cid}"]`);
            if (item) item.remove();
        });

        document.addEventListener("sahyog:connected", () => {
            if (channelId) hub.invoke("WatchChannel", channelId).catch(() => { });
        });
        // opened by a partial page load: the live connection is already up
        if (channelId && hub.state === "Connected") hub.invoke("WatchChannel", channelId).catch(() => { });
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible" && channelId && hub.state === "Connected")
                hub.invoke("MarkRead", channelId).catch(() => { });
        });
    }

    // ---------- composer ----------
    if (!form || !channelId) return;

    // ---------- the person you're writing to is out of office: their note above the box ----------
    const otherName = root.dataset.otherName || "They";
    const oooBar = document.createElement("div");
    oooBar.className = "sn-ooo-bar";
    oooBar.hidden = true;
    oooBar.setAttribute("role", "status");
    form.parentNode.insertBefore(oooBar, form);
    const paintOoo = () => {
        const now = other && S.oooOf ? S.oooOf(other) : null;
        // planned in the next two weeks: say so too ("will be out of office Mon, 24 Nov – Fri, 28 Nov")
        let o = now, soon = null;
        if (!o && other && S.oooPlanOf) {
            const p = S.oooPlanOf(other);
            if (p && p.startUtc && new Date(p.startUtc) - Date.now() < 14 * 864e5) { o = p; soon = p; }
        }
        oooBar.hidden = !o;
        if (!o) return;
        let text;
        if (soon && window.SN && SN.oooDays) { const r = SN.oooDays(soon); text = `will be out of office · ${SN.oooWhenText ? SN.oooWhenText(soon) : SN.oooRangeText(r.first, r.last)}${r.last ? "" : ", until further notice"}`; }
        else text = "is out of office · " + (window.SN && SN.oooUntilText ? SN.oooUntilText(o).replace("until you turn it off", "until further notice") : "");
        oooBar.classList.toggle("planned", !!soon);
        oooBar.innerHTML = `<i class="dot st-ooo" aria-hidden="true"></i><span class="sn-ooo-bar-t"><b>${S.escape(otherName)}</b> ${S.escape(text)}`
            + `${o.message ? `<q>${S.escape(o.message)}</q>` : ""}</span>`;
    };
    document.addEventListener("sahyog:ooo", paintOoo);
    paintOoo();

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
        // ↑ in an empty box: edit your last message
        if (e.key === "ArrowUp" && !box.value && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
            const last = [...list.querySelectorAll(".msg.mine .msg-edit")].pop();
            if (last) { e.preventDefault(); startEdit(last.dataset.edit); return; }
        }
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
        const reply = replyTo;
        box.value = "";
        autosize();
        cancelReply();
        try {
            const sent = await hub.invoke("SendMessage", channelId, text, reply ? reply.id : null);
            append(sent);
        } catch (err) {
            box.value = text;
            if (reply) startReply(reply.id);
            S.toast(err?.message?.replace(/^.*HubException: /, "") || "Message not sent.");
        }
    });

    // ---------- GIFs: search GIPHY (through our server, which keeps the API key) and send one ----------
    const gifBtn = document.getElementById("gifBtn");
    if (gifBtn) {
        let panel = null, q = "", offset = 0, more = true, loading = false, timer = 0, seq = 0;
        const close = () => { if (!panel) return; panel.hidden = true; gifBtn.setAttribute("aria-expanded", "false"); };
        const place = () => {
            const r = form.getBoundingClientRect();
            panel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - panel.offsetWidth - 8)) + "px";
            panel.style.bottom = (window.innerHeight - r.top + 8) + "px";
        };
        const tile = (g) => `<button type="button" class="gif-tile" data-id="${S.escape(g.id)}" data-w="${g.w}" data-h="${g.h}" title="${S.escape(g.title || "GIF")}" style="aspect-ratio:${g.pw}/${g.ph}">`
            + `<img src="${S.escape(g.preview)}" alt="${S.escape(g.title || "GIF")}" loading="lazy" decoding="async"></button>`;
        async function load(reset) {
            if (loading || (!more && !reset)) return;
            if (reset) { offset = 0; more = true; }
            loading = true;
            const my = ++seq;
            const grid = panel.querySelector(".gif-grid"), note = panel.querySelector(".gif-note");
            if (reset) { grid.innerHTML = ""; note.textContent = "Loading…"; note.hidden = false; }
            try {
                const r = await fetch(`/chat/gifs?q=${encodeURIComponent(q)}&offset=${offset}`, { headers: { Accept: "application/json" }, credentials: "same-origin" });
                const d = await r.json();
                if (my !== seq) return;                       // a newer search started
                if (d.configured === false) { note.innerHTML = "GIFs aren't set up yet. An admin adds a free GIPHY API key in <code>appsettings.json</code> → <code>Gifs:GiphyApiKey</code>."; more = false; return; }
                if (!r.ok) throw new Error(d.error || "");
                grid.insertAdjacentHTML("beforeend", (d.items || []).map(tile).join(""));
                offset = d.next ?? (offset + (d.items || []).length);
                more = !!d.more;
                note.hidden = grid.childElementCount > 0;
                if (!grid.childElementCount) note.textContent = q ? `No GIFs found for “${q}”.` : "No GIFs right now.";
            } catch (err) {
                if (my === seq) { note.hidden = false; note.textContent = err?.message || "Couldn't load GIFs. Try again."; }
            } finally { if (my === seq) loading = false; }
        }
        function open() {
            if (!panel) {
                panel = document.createElement("div");
                panel.className = "gif-panel glass-strong";
                panel.setAttribute("role", "dialog");
                panel.setAttribute("aria-label", "Send a GIF");
                panel.innerHTML = `<label class="gif-search"><i class="fa fa-search" aria-hidden="true"></i><input type="search" placeholder="Search GIFs (party, thanks, coffee…)" aria-label="Search GIFs" autocomplete="off" /></label>`
                    + `<div class="gif-scroll"><div class="gif-grid"></div><p class="gif-note" hidden></p></div>`
                    + `<div class="gif-foot"><span>Trending</span><b>Powered by GIPHY</b></div>`;
                document.body.appendChild(panel);
                const input = panel.querySelector("input");
                input.addEventListener("input", () => {
                    clearTimeout(timer);
                    timer = setTimeout(() => {
                        q = input.value.trim();
                        panel.querySelector(".gif-foot span").textContent = q ? `Results for “${q}”` : "Trending";
                        load(true);
                    }, 350);
                });
                input.addEventListener("keydown", (e) => { if (e.key === "Escape") { close(); box.focus(); } });
                panel.querySelector(".gif-scroll").addEventListener("scroll", (e) => {
                    const el = e.currentTarget;
                    if (el.scrollTop + el.clientHeight > el.scrollHeight - 220) load(false);
                });
                panel.addEventListener("click", async (e) => {
                    const t = e.target.closest(".gif-tile");
                    if (!t) return;
                    if (!hub || hub.state !== "Connected") { S.toast("Reconnecting… try again in a moment."); return; }
                    close();
                    const reply = replyTo;
                    cancelReply();
                    try {
                        const sent = await hub.invoke("SendMessage", channelId, `[[gif:${t.dataset.id}:${t.dataset.w}x${t.dataset.h}]]`, reply ? reply.id : null);
                        append(sent);
                    } catch (err) {
                        if (reply) startReply(reply.id);
                        S.toast(err?.message?.replace(/^.*HubException: /, "") || "GIF not sent.");
                    }
                    box.focus();
                });
                document.addEventListener("pointerdown", (e) => {
                    if (panel.hidden || panel.contains(e.target) || gifBtn.contains(e.target)) return;
                    close();
                });
                window.addEventListener("resize", () => { if (!panel.hidden) place(); });
                load(true);
            }
            panel.hidden = false;
            gifBtn.setAttribute("aria-expanded", "true");
            place();
            setTimeout(() => panel.querySelector("input").focus(), 30);
        }
        gifBtn.addEventListener("click", () => (panel && !panel.hidden ? close() : open()));
    }

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

// ShankhNaad · chat details: find a member in a long member list (the grid on the right)
(function () {
    "use strict";
    const input = document.getElementById("memSearch");
    const grid = document.getElementById("memGrid");
    if (!input || !grid) return;
    input.addEventListener("input", () => {
        const q = input.value.trim().toLowerCase();
        let shown = 0;
        grid.querySelectorAll(".person-chip").forEach((c) => {
            const hit = !q || (c.dataset.name || "").toLowerCase().includes(q);
            c.hidden = !hit;
            if (hit) shown++;
        });
        const none = document.getElementById("memNone");
        if (none) none.hidden = shown > 0;
        grid.scrollTop = 0;
    });
})();
