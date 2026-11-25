// ShankhNaad · what you can do with a teammate, the same on Chat, Calls and Files:
// Call (camera off, turn it on any time), Video call (camera on), Chat, Share a file, Pin, Organization chart.
//   SN.openMenu(button, head, items)  the ⋯ menu (glass pop-up next to the button; a sheet from the bottom on a phone)
//   SN.callPerson(id, video) · SN.callChannel(id, video) · SN.chatWith(id)
//   SN.orgCard(id)                    the organization chart pop-up
//   SN.shareWith(id, name)            send files (and a message) to one person
(function () {
    "use strict";
    window.SN = window.SN || {};
    const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const phone = () => window.matchMedia("(max-width: 760px)").matches;
    const token = () => (window.Sahyog && Sahyog.antiforgery ? Sahyog.antiforgery() : (document.querySelector('input[name="__RequestVerificationToken"]') || {}).value || "");
    const post = (url, fields) => {
        if (SN.post) return SN.post(url, fields);
        const f = document.createElement("form"); f.method = "post"; f.action = url;
        Object.entries(Object.assign({ __RequestVerificationToken: token() }, fields || {})).forEach(([k, v]) => {
            const i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = v; f.appendChild(i);
        });
        document.body.appendChild(f); f.submit(); f.remove();
    };
    const toast = (msg, o) => { if (window.Sahyog && Sahyog.toast) Sahyog.toast(msg, o); };

    SN.callPerson = (id, video) => post("/meetings/instant", video ? { userId: id, video: "true" } : { userId: id });
    SN.callChannel = (id, video) => post("/meetings/instant", video ? { channelId: id, video: "true" } : { channelId: id });
    SN.chatWith = (id) => post("/chat/direct/" + id, {});

    // ---------- the ⋯ menu ----------
    let open = null;
    const close = () => {
        if (!open) return;
        const { scrim, sheet, btn } = open; open = null;
        btn && btn.classList.remove("on");
        scrim.classList.remove("show"); sheet.classList.remove("show");
        setTimeout(() => { scrim.remove(); sheet.remove(); }, 300);
    };
    SN.closeMenu = close;
    /** head: { name, sub, avatar (element to copy) } · items: [{ kind, label, sub, icon, run } | "sep"] */
    SN.openMenu = (btn, head, items) => {
        close();
        const scrim = document.createElement("div"); scrim.className = "sn-sheet-scrim";
        const sheet = document.createElement("div"); sheet.className = "sn-sheet sn-people-menu"; sheet.setAttribute("role", "menu"); sheet.setAttribute("aria-label", head.name || "Options");
        sheet.innerHTML = '<div class="sn-sheet-grip"></div><div class="sn-sheet-head"><span class="sn-sheet-who"><b>' + esc(head.name) + "</b>" + (head.sub ? "<small>" + esc(head.sub) + "</small>" : "") + "</span></div>";
        if (head.avatar) { const a = head.avatar.cloneNode(true); a.querySelector(".dot") && a.querySelector(".dot").remove(); sheet.querySelector(".sn-sheet-head").prepend(a); }
        items.forEach((it) => {
            if (it === "sep") { const hr = document.createElement("hr"); hr.className = "sn-sheet-sep"; sheet.appendChild(hr); return; }
            const b = document.createElement("button");
            b.type = "button"; b.className = "sn-sheet-item " + (it.kind || ""); b.setAttribute("role", "menuitem");
            b.innerHTML = '<span class="sn-sheet-ic ' + esc(it.kind) + '"><i class="' + esc(it.icon) + '" aria-hidden="true"></i></span><span class="sn-sheet-t"><span>' + esc(it.label) + "</span>" + (it.sub ? "<small>" + esc(it.sub) + "</small>" : "") + "</span>";
            b.addEventListener("click", () => { close(); setTimeout(it.run, 60); });
            sheet.appendChild(b);
        });
        const cancel = document.createElement("button");
        cancel.type = "button"; cancel.className = "sn-sheet-cancel"; cancel.textContent = "Cancel";
        cancel.addEventListener("click", close);
        sheet.appendChild(cancel);
        scrim.addEventListener("click", close);
        const asPop = !phone();
        if (asPop) { sheet.classList.add("pop"); scrim.classList.add("pop"); btn && btn.classList.add("on"); }
        document.body.append(scrim, sheet);
        if (asPop && btn) {
            const r = btn.getBoundingClientRect(), h = sheet.offsetHeight, w = sheet.offsetWidth;
            const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
            let top = r.bottom + 6;
            if (top + h > window.innerHeight - 8) { top = Math.max(8, r.top - h - 6); sheet.classList.add("up"); }
            sheet.style.left = left + "px"; sheet.style.top = top + "px";
        }
        open = { scrim, sheet, btn };
        requestAnimationFrame(() => { scrim.classList.add("show"); sheet.classList.add("show"); });
        const first = sheet.querySelector(".sn-sheet-item"); first && first.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    window.addEventListener("resize", close);

    // buttons anywhere: data-call="userId" [data-video], data-call-channel="channelId" [data-video], data-org="userId"
    document.addEventListener("click", (e) => {
        const call = e.target.closest("[data-call]");
        if (call) { e.preventDefault(); SN.callPerson(call.getAttribute("data-call"), call.hasAttribute("data-video")); return; }
        const callCh = e.target.closest("[data-call-channel]");
        if (callCh) { e.preventDefault(); SN.callChannel(callCh.getAttribute("data-call-channel"), callCh.hasAttribute("data-video")); return; }
        const org = e.target.closest("[data-org]");
        if (org) { e.preventDefault(); SN.orgCard(org.getAttribute("data-org")); }
    });

    // ---------- organization chart pop-up ----------
    const avatar = (p, size) => '<span class="avatar av-' + size + " tone-" + (p.t % 6) + '" data-user="' + p.id + '" data-presence="' + p.id + '">' + esc(p.i) + '<i class="dot' + (p.on ? " on" : "") + '"></i></span>';
    const sub = (p) => [p.title, p.dept].filter(Boolean).join(" · ") || "Team member";
    const chip = (p, cls) => '<button type="button" class="sn-oc-person ' + (cls || "") + '" data-oc="' + p.id + '">' + avatar(p, cls === "me" ? 48 : 36) +
        '<span><b>' + esc(p.n) + "</b><small>" + esc(sub(p)) + "</small></span></button>";
    function dialog() {
        let d = document.getElementById("snOrgPop");
        if (d) return d;
        d = document.createElement("dialog");
        d.id = "snOrgPop"; d.className = "sn-dialog glass-strong sn-orgpop"; d.setAttribute("aria-labelledby", "snOcTitle");
        d.innerHTML = '<div class="sn-dlg-head"><div class="sn-dlg-title"><span class="sn-dlg-icon"><i class="fa fa-sitemap" aria-hidden="true"></i></span><div><h2 id="snOcTitle">Organization</h2><p>Who they report to, who they work with, who reports to them</p></div></div>' +
            '<button type="button" class="sn-close" data-oc-close aria-label="Close"><i class="fa fa-times" aria-hidden="true"></i></button></div>' +
            '<div class="sn-dlg-body" id="snOcBody"></div>' +
            '<div class="sn-dlg-foot"><span class="muted small">Click anyone to see their place instead</span><a class="cee-btn cee-btn-gradient" id="snOcFull" href="/org"><i class="fa fa-sitemap" aria-hidden="true"></i> Open full org chart</a></div>';
        document.body.appendChild(d);
        d.addEventListener("click", (e) => {
            if (e.target === d || e.target.closest("[data-oc-close]")) { d.close(); return; }
            const more = e.target.closest("[data-oc-expand]");
            if (more) {
                const part = d.querySelector('[data-oc-part="' + more.getAttribute("data-oc-expand") + '"]');
                if (part) { part.hidden = false; (more.closest(".sn-oc-morewrap") || more).remove(); }
                return;
            }
            const p = e.target.closest("[data-oc]");
            if (p) { load(p.getAttribute("data-oc")); return; }
            const act = e.target.closest("[data-oc-act]");
            if (act) {
                const id = act.getAttribute("data-id"), what = act.getAttribute("data-oc-act");
                d.close();
                if (what === "call") SN.callPerson(id, false);
                else if (what === "video") SN.callPerson(id, true);
                else if (what === "chat") SN.chatWith(id);
            }
            if (e.target.closest("#snOcFull")) d.close();
        });
        return d;
    }
    // a big team: the first 8, then "Show all 23"
    const FIRST = 8;
    const many = (list, part) => '<div class="sn-oc-grid">' + list.slice(0, FIRST).map((m) => chip(m)).join("") +
        (list.length > FIRST ? '<span class="sn-oc-hidden" data-oc-part="' + part + '" hidden>' + list.slice(FIRST).map((m) => chip(m)).join("") + "</span>" : "") + "</div>" +
        (list.length > FIRST ? '<button type="button" class="sn-oc-more" data-oc-expand="' + part + '">Show all ' + list.length + "</button>" : "");
    function load(id) {
        const d = dialog(), body = d.querySelector("#snOcBody");
        body.innerHTML = '<p class="sn-oc-empty">Loading…</p>';
        fetch("/org/card/" + id, { headers: { Accept: "application/json" } })
            .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
            .then((x) => {
                const p = x.person;
                d.querySelector("#snOcTitle").textContent = (x.me ? "You" : p.n.split(" ")[0]) + " in the organization";
                d.querySelector("#snOcFull").href = "/org?p=" + p.id;
                // a long line of managers: the top, "N more levels", and the two right above this person (click to see all)
                let h = '<div class="sn-oc-sec">Reports to' + (x.chain.length ? " (" + x.chain.length + (x.chain.length === 1 ? " level" : " levels") + ")" : "") + '</div><div class="sn-oc-chain">';
                const line = '<i class="sn-oc-line" aria-hidden="true"></i>';
                if (x.chain.length > 4) {
                    h += chip(x.chain[0]) + line +
                        '<span class="sn-oc-morewrap"><button type="button" class="sn-oc-more" data-oc-expand="chain"><i class="fa fa-ellipsis-v" aria-hidden="true"></i> ' + (x.chain.length - 3) + " more levels</button>" + line + "</span>" +
                        '<span class="sn-oc-hidden" data-oc-part="chain" hidden>' + x.chain.slice(1, -2).map((m) => chip(m) + line).join("") + "</span>" +
                        x.chain.slice(-2).map((m) => chip(m) + line).join("");
                } else x.chain.forEach((m) => { h += chip(m) + line; });
                h += '<div class="sn-oc-me">' + chip(p, "me") + (x.me ? "" :
                    '<span class="sn-oc-acts"><button type="button" class="cee-btn cee-btn-gradient" data-oc-act="call" data-id="' + p.id + '" title="Camera off · turn it on any time"><i class="fa fa-phone" aria-hidden="true"></i> Call</button>' +
                    '<button type="button" class="cee-btn sn-btn-light" data-oc-act="video" data-id="' + p.id + '"><i class="fa fa-video-camera" aria-hidden="true"></i> Video call</button>' +
                    '<button type="button" class="cee-btn sn-btn-light" data-oc-act="chat" data-id="' + p.id + '"><i class="fa fa-comment" aria-hidden="true"></i> Chat</button></span>') + "</div></div>";
                if (!x.chain.length) h += '<p class="sn-oc-empty">' + esc(p.n) + (x.ready ? " is at the top of the chart." : " has no manager set yet.") + "</p>";
                h += '<div class="sn-oc-sec">Works with · same manager' + (x.peers.length ? " (" + x.peers.length + ")" : "") + '</div>';
                h += x.peers.length ? many(x.peers, "peers") : '<p class="sn-oc-empty">No one else reports to the same manager.</p>';
                h += '<div class="sn-oc-sec">Direct reports' + (x.reports.length ? " (" + x.reports.length + ")" : "") + '</div>';
                h += x.reports.length ? many(x.reports, "reports") : '<p class="sn-oc-empty">No one reports to ' + esc(p.n.split(" ")[0]) + " yet.</p>";
                const contact = [x.email && '<a href="mailto:' + esc(x.email) + '"><i class="fa fa-envelope-o" aria-hidden="true"></i> ' + esc(x.email) + "</a>",
                    x.phone && '<a href="tel:' + esc(x.phone.replace(/\s+/g, "")) + '"><i class="fa fa-phone" aria-hidden="true"></i> ' + esc(x.phone) + "</a>",
                    x.emp && '<span><i class="fa fa-id-badge" aria-hidden="true"></i> ' + esc(x.emp) + "</span>",
                    x.joined && '<span><i class="fa fa-calendar-check-o" aria-hidden="true"></i> Joined ' + esc(x.joined) + "</span>"].filter(Boolean);
                if (contact.length) h += '<div class="sn-oc-sec">Contact</div><div class="sn-oc-contact">' + contact.join("") + "</div>";
                body.innerHTML = h;
                window.Sahyog && Sahyog.paintPhotos && Sahyog.paintPhotos(body);
            })
            .catch(() => { body.innerHTML = '<p class="sn-oc-empty">This person couldn\'t be loaded. They may have left the workspace.</p>'; });
    }
    SN.orgCard = (id) => { const d = dialog(); load(id); if (!d.open) d.showModal(); };

    // ---------- share files with one person ----------
    function shareDialog() {
        let d = document.getElementById("snSharePop");
        if (d) return d;
        d = document.createElement("dialog");
        d.id = "snSharePop"; d.className = "sn-dialog glass-strong sn-sharepop"; d.setAttribute("aria-labelledby", "snShTitle");
        d.innerHTML = '<div class="sn-dlg-head"><div class="sn-dlg-title"><span class="sn-dlg-icon"><i class="fa fa-upload" aria-hidden="true"></i></span><div><h2 id="snShTitle">Share a file</h2><p id="snShSub"></p></div></div>' +
            '<button type="button" class="sn-close" data-sh-close aria-label="Close"><i class="fa fa-times" aria-hidden="true"></i></button></div>' +
            '<div class="sn-dlg-body"><label class="sn-sh-drop" id="snShDrop"><input type="file" id="snShFile" multiple />' +
            '<span class="sn-sh-drop-ic" aria-hidden="true"><i class="fa fa-cloud-upload"></i></span><b>Drop files here, or click to choose</b><small>Up to 10 files at a time</small></label>' +
            '<div class="sn-sh-list" id="snShList"></div>' +
            '<label class="sn-sh-msg"><span>Message (optional)</span><input type="text" id="snShMsg" maxlength="500" placeholder="Here are the notes from today" /></label></div>' +
            '<div class="sn-dlg-foot"><span class="muted small" id="snShNote">It goes into your chat with them, and shows in Files for both of you.</span><span style="display:flex;gap:10px">' +
            '<button type="button" class="cee-btn sn-btn-light" data-sh-close>Cancel</button><button type="button" class="cee-btn cee-btn-gradient" id="snShGo" disabled><i class="fa fa-paper-plane" aria-hidden="true"></i> <span>Send</span></button></span></div>';
        document.body.appendChild(d);
        const input = d.querySelector("#snShFile"), drop = d.querySelector("#snShDrop");
        d.addEventListener("click", (e) => {
            if (e.target === d || e.target.closest("[data-sh-close]")) { d.close(); return; }
            const rm = e.target.closest("[data-sh-rm]");
            if (rm) { d._files.splice(+rm.getAttribute("data-sh-rm"), 1); paint(d); }
        });
        input.addEventListener("change", () => { add(d, input.files); input.value = ""; });
        drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
        drop.addEventListener("dragleave", () => drop.classList.remove("over"));
        drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); add(d, e.dataTransfer.files); });
        d.querySelector("#snShGo").addEventListener("click", () => send(d));
        return d;
    }
    const size = (b) => b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
    function add(d, list) {
        Array.prototype.forEach.call(list || [], (f) => { if (d._files.length < 10) d._files.push(f); });
        if ((list || []).length && d._files.length >= 10) toast("Up to 10 files at a time.", { kind: "info" });
        paint(d);
    }
    function paint(d) {
        d.querySelector("#snShList").innerHTML = d._files.map((f, i) =>
            '<div class="sn-sh-file"><i class="fa ' + (/^image\//.test(f.type) ? "fa-file-image-o" : "fa-file-o") + '" aria-hidden="true"></i><span><b>' + esc(f.name) + "</b><small>" + size(f.size) + '</small></span><button type="button" data-sh-rm="' + i + '" aria-label="Remove ' + esc(f.name) + '"><i class="fa fa-times" aria-hidden="true"></i></button></div>').join("");
        const n = d._files.length, go = d.querySelector("#snShGo");
        go.disabled = n === 0;
        go.querySelector("span").textContent = n ? "Send " + n + (n === 1 ? " file" : " files") + " to " + d._first : "Send";
    }
    function send(d) {
        const go = d.querySelector("#snShGo");
        go.disabled = true; go.classList.add("busy");
        const fd = new FormData();
        d._files.forEach((f) => fd.append("files", f));
        fd.append("message", d.querySelector("#snShMsg").value || "");
        fd.append("__RequestVerificationToken", token());
        fetch("/chat/share/" + d._to, { method: "POST", body: fd, headers: { RequestVerificationToken: token() } })
            .then((r) => r.json().then((x) => ({ ok: r.ok, x })))
            .then(({ ok, x }) => {
                go.classList.remove("busy");
                if (!ok) { go.disabled = false; toast(x.error || "The files weren't sent.", { kind: "warn", title: "Not sent" }); return; }
                d.close();
                if (x.problems && x.problems.length) toast(x.sent + " sent. Not sent: " + x.problems.join(" · "), { kind: "warn", title: "Some files weren't sent" });
                else toast(x.sent + (x.sent === 1 ? " file" : " files") + " sent to " + d._name + ".", { kind: "success", title: "Shared" });
                if (window.SN && SN.reload && /^\/files\/?$/.test(location.pathname)) setTimeout(SN.reload, 600);
            })
            .catch(() => { go.classList.remove("busy"); go.disabled = false; toast("The files weren't sent. Check your connection.", { kind: "error" }); });
    }
    SN.shareWith = (id, name, files) => {
        const d = shareDialog();
        d._to = id; d._name = name; d._first = String(name || "").split(" ")[0]; d._files = [];
        d.querySelector("#snShTitle").textContent = "Share a file with " + name;
        d.querySelector("#snShSub").textContent = "It goes into your chat with " + d._first + ", so you can talk about it there";
        d.querySelector("#snShMsg").value = "";
        if (files) add(d, files); else paint(d);
        if (!d.open) d.showModal();
    };

    // ---------- Team panel rows (Calls and Files): ⋯ menu, Share, drop a file on a name ----------
    document.addEventListener("click", (e) => {
        const more = e.target.closest("[data-tp-more]");
        if (more) {
            e.preventDefault();
            const row = more.closest(".sn-tp-row"), id = row.getAttribute("data-id"), name = row.getAttribute("data-name");
            const first = name.split(" ")[0], pinned = row.querySelector("[data-tp-pin]")?.getAttribute("aria-pressed") === "true";
            const share = !!row.querySelector("[data-tp-share]");
            const items = [];
            if (share) items.push({ kind: "chat", label: "Share a file", sub: "Sends it in your chat with " + first, icon: "fa fa-upload", run: () => SN.shareWith(id, name) });
            items.push({ kind: "chat", label: "Chat", sub: "Open your chat with " + first, icon: "fa fa-comment", run: () => SN.chatWith(id) }, "sep",
                { kind: "call", label: "Call", sub: "Camera off · turn it on any time", icon: "fa fa-phone", run: () => SN.callPerson(id, false) },
                { kind: "call", label: "Video call", sub: "Starts with your camera on", icon: "fa fa-video-camera", run: () => SN.callPerson(id, true) }, "sep",
                { kind: "pin", label: pinned ? "Unpin" : "Pin to the top", sub: pinned ? "" : "Keep " + first + " above everyone", icon: "fa fa-thumb-tack", run: () => row.querySelector("[data-tp-pin]")?.click() },
                { kind: "org", label: "Organization chart", sub: "Who " + first + " reports to and works with", icon: "fa fa-sitemap", run: () => SN.orgCard(id) });
            const sub = row.querySelector(".sn-tp-who small")?.textContent.trim() || "";
            SN.openMenu(more, { name, sub, avatar: row.querySelector(".avatar") }, items);
            return;
        }
        const sh = e.target.closest("[data-tp-share]");
        if (sh) { e.preventDefault(); const row = sh.closest(".sn-tp-row"); SN.shareWith(row.getAttribute("data-id"), row.getAttribute("data-name")); }
    });
    document.addEventListener("dragover", (e) => {
        const row = e.target.closest && e.target.closest(".sn-tp-row[data-drop]");
        if (!row || !e.dataTransfer || !Array.prototype.includes.call(e.dataTransfer.types || [], "Files")) return;
        e.preventDefault(); row.classList.add("drop-over");
    });
    document.addEventListener("dragleave", (e) => { const row = e.target.closest && e.target.closest(".sn-tp-row[data-drop]"); if (row) row.classList.remove("drop-over"); });
    document.addEventListener("drop", (e) => {
        const row = e.target.closest && e.target.closest(".sn-tp-row[data-drop]");
        if (!row || !e.dataTransfer || !e.dataTransfer.files.length) return;
        e.preventDefault(); row.classList.remove("drop-over");
        SN.shareWith(row.getAttribute("data-id"), row.getAttribute("data-name"), e.dataTransfer.files);
    });

    // ---------- Team panel: search (name or job title) and pins, saved for you on every device ----------
    function tpFilter() {
        const input = document.querySelector("[data-team-search]");
        const q = input ? input.value.trim().toLowerCase() : "";
        let shown = 0, pinShown = 0;
        document.querySelectorAll(".sn-tp-row").forEach((r) => {
            const hit = !q || (r.getAttribute("data-filter") || "").toLowerCase().indexOf(q) >= 0;
            r.hidden = !hit; if (hit) { shown++; if (r.parentNode.id === "tpPinned") pinShown++; }
        });
        const anyPinned = document.querySelectorAll("#tpPinned .sn-tp-row").length > 0;
        ["tpPinnedHead", "tpDivider", "tpRestHead"].forEach((id) => { const el = document.getElementById(id); if (el) el.hidden = !anyPinned || (!!q && !pinShown); });
        const none = document.querySelector("[data-team-none]");
        if (none) none.hidden = shown > 0 || !document.querySelector(".sn-tp-row");
    }
    document.addEventListener("input", (e) => { if (e.target.matches && e.target.matches("[data-team-search]")) tpFilter(); });
    function tpPlace(row, pinned) {
        const target = document.getElementById(pinned ? "tpPinned" : "tpRest");
        if (!target) return;
        if (pinned) target.appendChild(row);
        else {
            // back among everyone: online first, then by name
            const on = row.getAttribute("data-online") === "1", name = (row.getAttribute("data-name") || "").toLowerCase();
            const before = Array.prototype.find.call(target.querySelectorAll(".sn-tp-row"), (r) => {
                const rOn = r.getAttribute("data-online") === "1";
                return (on && !rOn) || (on === rOn && (r.getAttribute("data-name") || "").toLowerCase() > name);
            });
            target.insertBefore(row, before || null);
        }
        row.classList.toggle("pinned", pinned);
        const btn = row.querySelector("[data-tp-pin]"), n = row.getAttribute("data-name");
        btn.setAttribute("aria-pressed", pinned ? "true" : "false");
        btn.title = pinned ? "Unpin " + n : "Pin " + n + " to the top";
        btn.setAttribute("aria-label", btn.title);
        tpFilter();
    }
    document.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-tp-pin]");
        if (!btn) return;
        const row = btn.closest(".sn-tp-row"), id = btn.getAttribute("data-tp-pin");
        const pin = btn.getAttribute("aria-pressed") !== "true";
        tpPlace(row, pin);
        const fd = new FormData(); fd.append("pinned", pin ? "true" : "false");
        fetch("/calls/pin/" + id, { method: "POST", body: fd, headers: { RequestVerificationToken: token() } })
            .then((r) => r.json())
            .then((x) => { if (x.ok) return; tpPlace(row, !pin); toast(x.error || "The pin wasn't saved.", { kind: "warn", title: "Pin" }); })
            .catch(() => { tpPlace(row, !pin); toast("The pin wasn't saved. Check your connection.", { kind: "error" }); });
    });
    // "Online / Offline" under each name follows the live dots
    document.addEventListener("sahyog:presence", () => {
        document.querySelectorAll(".sn-tp-row").forEach((r) => {
            const on = !!r.querySelector(".avatar .dot.on"), st = r.querySelector("[data-tp-state]");
            r.setAttribute("data-online", on ? "1" : "0"); if (st) st.textContent = on ? "Online" : "Offline";
        });
    });
})();
