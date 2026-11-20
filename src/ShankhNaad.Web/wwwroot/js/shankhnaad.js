// ShankhNaad · small helpers the action-header buttons call (onclick="SN.…").
// Needs jQuery, modern-table.js and messagebox.js (all loaded by _Layout).
(function () {
    "use strict";

    const SN = (window.SN = window.SN || {});

    const token = () => document.querySelector('input[name="__RequestVerificationToken"]')?.value || "";

    /** The row currently selected in a <modern-table>, or null. */
    SN.selected = (tableId) => {
        const api = window.jQuery ? jQuery("#" + tableId).data("mt-api") : null;
        return api ? api.getSelected() || null : null;
    };

    /** Selected row, or a friendly message asking the user to pick one first. */
    /**
     * Turns a modern-table's plain title into the rich heading (icon tile, count badge, status line).
     * meta: [{ text: "2 live", dot: "live" | "up" | "ended" | "paused" | "admin" | "seat" | null }]
     */
    SN.tableHeading = (tableId, count, meta) => {
        const table = document.getElementById(tableId);
        const wrap = table && table.querySelector(".mt-title-wrap");
        if (!wrap || wrap.classList.contains("sn-title-pro")) return;
        const text = wrap.querySelector(".mt-title-text");
        if (!text) return;
        const stack = document.createElement("span"); stack.className = "sn-title-stack";
        const row = document.createElement("span"); row.className = "sn-title-row";
        const badge = document.createElement("span"); badge.className = "sn-title-count"; badge.textContent = String(count);
        text.after(stack);
        row.append(text, badge);
        stack.append(row);
        const items = (meta || []).filter((m) => m && m.text);
        if (items.length) {
            const line = document.createElement("span"); line.className = "sn-title-meta";
            items.forEach((m, i) => {
                if (i > 0) { const sep = document.createElement("span"); sep.className = "sn-tm-sep"; sep.textContent = "·"; line.append(sep); }
                if (m.dot) { const d = document.createElement("span"); d.className = "sn-tm-dot " + m.dot; line.append(d); }
                const t = document.createElement("span"); t.textContent = m.text; line.append(t);
            });
            stack.append(line);
        }
        wrap.classList.add("sn-title-pro");
    };

    /**
     * Message boxes above open windows.
     * A window opened with showModal() sits in the browser's top layer, so a normal page element
     * (the message box) is drawn behind it whatever its z-index. When a message box opens while a
     * window is open, move it into its own small top-layer <dialog>, which stacks above the window.
     */
    (() => {
        if (typeof window.openMessageBox !== "function" && typeof window.confirmMessageBox !== "function") return;
        let host = null;
        const ensureHost = () => {
            if (host) return host;
            host = document.createElement("dialog");
            host.className = "sn-mb-host";
            host.addEventListener("cancel", (e) => e.preventDefault());   // Esc is handled by the message box itself
            document.body.appendChild(host);
            // when the message box closes, close the host and put the box back on the page
            new MutationObserver(() => {
                if (!host.open || host.querySelector(".mb-overlay.mb-visible")) return;
                host.querySelectorAll(".mb-overlay").forEach((el) => document.body.appendChild(el));
                host.close();
            }).observe(host, { subtree: true, attributes: true, attributeFilter: ["class"] });
            return host;
        };
        const lift = () => {
            const windowOpen = [...document.querySelectorAll("dialog[open]")].some((d) => d !== host);
            if (!windowOpen) return;
            const boxes = [...document.querySelectorAll("body > .mb-overlay.mb-visible")];
            if (!boxes.length) return;
            const h = ensureHost();
            boxes.forEach((el) => h.appendChild(el));
            if (h.open) h.close();          // re-open so it lands on top of the newest window
            h.showModal();
        };
        ["openMessageBox", "confirmMessageBox"].forEach((name) => {
            const original = window[name];
            if (typeof original !== "function") return;
            const wrapped = function () {
                const result = original.apply(this, arguments);
                lift();
                return result;
            };
            // a message box belongs to the window, not to the page (it must keep working if the page changes)
            window[name] = window.SN?.nav ? SN.nav.unscoped(wrapped) : wrapped;
        });
    })();

    SN.need = (tableId, what) => {
        const row = SN.selected(tableId);
        if (!row) {
            Sahyog.toast(`Please select ${what || "a row"} in the list first.`, { kind: "info", title: "Select a row" });
        }
        return row;
    };

    /** Posts a small form (with the anti-forgery token) to the server. */
    SN.post = (url, fields) => {
        const form = document.createElement("form");
        form.method = "post";
        form.action = url;
        const add = (name, value) => {
            const input = document.createElement("input");
            input.type = "hidden";
            input.name = name;
            input.value = value;
            form.appendChild(input);
        };
        add("__RequestVerificationToken", token());
        Object.entries(fields || {}).forEach(([k, v]) => add(k, v));
        document.body.appendChild(form);
        form.submit();          // with partial page loads (sn-nav.js) this is sent in the background
        form.remove();
    };

    /** Asks first (Template 1 confirm box), then posts. */
    SN.confirmPost = (url, options) => {
        const o = options || {};
        confirmMessageBox({
            title: o.title || "Please confirm",
            text: o.text || "Are you sure?",
            confirmText: o.confirmText || "Yes",
            danger: !!o.danger,
            onConfirm: () => SN.post(url, o.fields)
        });
    };

    SN.open = (dialogId) => document.getElementById(dialogId)?.showModal();
    /** Opens a page: workspace pages load partially (sn-nav.js), anything else normally. */
    SN.go = (url, dir) => { if (SN.navigate) SN.navigate(url, { dir }); else window.location.href = url; };
    /** Loads the current page again (with the page arrival animation). */
    SN.reload = () => { if (SN.navigate && SN.nav.canGo(location.href)) SN.navigate(location.href, { push: false }); else window.location.reload(); };

    /** Downloads what the grid shows now (search, filters, sort and chosen columns) as a CSV file for Excel. */
    SN.exportTable = (tableId, fileName) => {
        const api = window.jQuery ? jQuery("#" + tableId).data("mt-api") : null;
        if (!api) return;
        const cols = api.getVisibleColumns().filter((c) => (c.type || c.Type) !== "image");
        const field = (c) => c.field ?? c.Field;
        const header = (c) => c.header ?? c.Header ?? field(c);
        const cell = (v) => {
            const s = v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const lines = [cols.map((c) => cell(header(c))).join(",")];
        api.getViewRows().forEach((r) => lines.push(cols.map((c) => cell(r[field(c)])).join(",")));
        const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = (fileName || "export") + ".csv";
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    };

    SN.print = () => window.print();

    /** Copies text to the clipboard and shows a toast. */
    SN.copy = (text, message) => {
        if (!text) return;
        navigator.clipboard?.writeText(text).then(() => window.Sahyog?.toast?.(message || "Copied"));
    };
})();

// ---------- top bar (strip-header): user menu, clock, connection ----------
(function () {
    "use strict";

    // Menu items of the strip-header user panel.
    document.addEventListener("strip-header:action", (e) => {
        if (e.target !== document) return;              // the event is sent twice (panel + document): handle it once
        switch (e.detail && e.detail.action) {
            case "help": document.getElementById("aboutDialog")?.showModal(); break;
            case "install": document.getElementById("installDialog")?.showModal(); break;
            case "logout": document.getElementById("logoutForm")?.submit(); break;
            // "fullscreen" is handled by the strip-header itself (Maximize / Minimize).
        }
    });

    // Live clock in the top bar.
    const clock = document.getElementById("snClock");
    if (clock) {
        const fmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
        const tick = () => { clock.textContent = fmt.format(new Date()).replace(",", " ·"); };
        tick();
        setInterval(tick, 30000);
    }

    // Connection pill: follows the real-time (SignalR) connection that site.js starts.
    const pill = document.getElementById("snConn");
    if (pill) {
        const set = (state, text) => { pill.dataset.state = state; pill.querySelector("span:last-child").textContent = text; };
        document.addEventListener("sahyog:connected", () => {
            set("on", "Connected");
            const hub = window.Sahyog && window.Sahyog.hub;
            if (hub && !hub.__snWatched) {
                hub.__snWatched = true;
                hub.onreconnecting(() => set("wait", "Reconnecting…"));
                hub.onreconnected(() => set("on", "Connected"));
                hub.onclose(() => set("off", "Offline"));
            }
        });
        window.addEventListener("offline", () => set("off", "Offline"));
    }
})();

// ---------- pop-up windows: animated close (slide down) ----------
(function () {
    "use strict";
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function closeAnimated(dialog) {
        if (!dialog || !dialog.open || dialog.classList.contains("sn-closing")) return;
        if (reduce) { dialog.close(); return; }
        dialog.classList.add("sn-closing");
        setTimeout(() => { dialog.classList.remove("sn-closing"); dialog.close(); }, 250);
    }
    window.SN = window.SN || {};
    window.SN.closeDialog = closeAnimated;

    // Capture phase: runs before site.js closes the dialog straight away.
    document.addEventListener("click", (e) => {
        const closer = e.target.closest && e.target.closest(".sn-dialog [data-close]");
        if (!closer) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        closeAnimated(closer.closest("dialog"));
    }, true);

    // Esc key (set up again for the windows of each page)
    const escToClose = () => document.querySelectorAll("dialog.sn-dialog").forEach((d) => {
        d.addEventListener("cancel", (e) => { e.preventDefault(); closeAnimated(d); });
    });
    if (window.SN.onPage) SN.onPage(escToClose); else escToClose();
})();

// ---------- themes: Light, Dark (very dark grey glass), CloudWheel (the blue dark) ----------
(function () {
    "use strict";
    window.SN = window.SN || {};
    const root = document.documentElement;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Both dark themes keep data-theme="dark" (all the dark styles); "Dark" adds sn-carbon (css/theme-dark.css).
    const THEMES = [
        { id: "light", name: "Light", note: "Bright glass", color: "#2563EB" },
        { id: "dark", name: "Dark", note: "Very dark grey glass", color: "#0E0E10" },
        { id: "cloudwheel", name: "CloudWheel", note: "Deep blue night", color: "#0B1020" }
    ];
    const current = () => root.getAttribute("data-skin") || (root.getAttribute("data-theme") === "dark" ? "cloudwheel" : "light");
    const nameOf = (id) => (THEMES.find((t) => t.id === id) || THEMES[0]).name;
    SN.theme = current;

    function apply(theme) {
        root.setAttribute("data-theme", theme === "light" ? "light" : "dark");
        root.setAttribute("data-skin", theme);
        root.classList.toggle("sn-carbon", theme === "dark");
        try { localStorage.setItem("sn-theme3", theme); localStorage.setItem("sn-theme", theme === "light" ? "light" : "dark"); } catch (e) { }
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute("content", (THEMES.find((t) => t.id === theme) || THEMES[0]).color);
        const label = document.querySelector("[data-sn-theme] .sn-theme-now");
        if (label) label.textContent = nameOf(theme);
        document.querySelectorAll(".sn-theme-pop [data-theme-id]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.themeId === theme)));
        document.dispatchEvent(new CustomEvent("sn:theme", { detail: { theme: root.getAttribute("data-theme"), skin: theme } }));
    }

    /** Switches to a theme with a circle that grows from where you clicked (falls back to a quick change). */
    SN.setTheme = (next, evt) => {
        if (next === current()) return;
        if (reduce || !document.startViewTransition) { apply(next); return; }
        const x = evt && evt.clientX ? evt.clientX : window.innerWidth - 80;
        const y = evt && evt.clientY ? evt.clientY : 40;
        const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
        root.classList.add("sn-theme-switching");
        const vt = document.startViewTransition(() => apply(next));
        vt.ready.then(() => {
            root.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
                { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)", pseudoElement: "::view-transition-new(root)" });
        }).catch(() => { });
        vt.finished.finally(() => root.classList.remove("sn-theme-switching"));
    };

    /** Cycles Light → Dark → CloudWheel (the user-menu item). */
    SN.toggleTheme = (evt) => {
        const i = THEMES.findIndex((t) => t.id === current());
        SN.setTheme(THEMES[(i + 1) % THEMES.length].id, evt);
    };

    /** The top-bar button: a small menu with the three themes. */
    let pop = null;
    const closePop = () => { if (!pop) return; const p = pop; pop = null; p.classList.remove("in"); setTimeout(() => p.remove(), 180); document.removeEventListener("pointerdown", outside, true); };
    const outside = (e) => { if (pop && !pop.contains(e.target) && !e.target.closest(".sn-theme-btn, [data-sn-theme]")) closePop(); };
    /** opts.side = "left": a submenu that opens beside the user menu (from its "Theme" item). */
    SN.themeMenu = (evt, opts) => {
        opts = opts || {};
        if (pop) { closePop(); return; }
        const btn = opts.anchor || (evt && evt.currentTarget ? evt.currentTarget : document.querySelector(".sn-theme-btn"));
        pop = document.createElement("div");
        pop.className = "sn-theme-pop";
        pop.setAttribute("role", "menu");
        pop.setAttribute("aria-label", "Theme");
        pop.innerHTML = `<div class="sn-theme-pop-t">Theme</div>` + THEMES.map((t) =>
            `<button type="button" role="menuitemradio" aria-checked="${t.id === current()}" data-theme-id="${t.id}">
                <span class="sn-theme-sw sn-sw-${t.id}" aria-hidden="true"><i></i><i></i></span>
                <span class="sn-theme-pop-n"><b>${t.name}</b><small>${t.note}</small></span>
                <i class="fa fa-check sn-theme-ok" aria-hidden="true"></i></button>`).join("");
        document.body.appendChild(pop);
        const r = btn ? btn.getBoundingClientRect() : { left: innerWidth - 60, right: innerWidth - 16, top: 20, bottom: 64 };
        const w = pop.offsetWidth || 250, h = pop.offsetHeight || 220;
        const menu = btn && btn.closest(".strip-user-dropdown");
        if (opts.side === "left" && menu && menu.getBoundingClientRect().left - w - 10 >= 8) {
            // a submenu: beside the user menu, level with the "Theme" item
            const m = menu.getBoundingClientRect();
            pop.classList.add("sn-theme-sub");
            pop.style.left = Math.round(m.left - w - 10) + "px";
            pop.style.top = Math.round(Math.min(Math.max(8, r.top - 44), innerHeight - h - 8)) + "px";
            pop.style.transformOrigin = "top right";
        } else {
            // under the button (or the item, on a narrow screen), kept inside the window
            pop.style.top = Math.round(Math.min(r.bottom + 8, innerHeight - h - 8)) + "px";
            pop.style.left = Math.round(Math.min(Math.max(8, r.right - w), innerWidth - w - 8)) + "px";
            pop.style.transformOrigin = (r.left + r.right) / 2 < innerWidth / 2 ? "top left" : "top right";
        }
        requestAnimationFrame(() => pop && pop.classList.add("in"));
        pop.addEventListener("click", (e) => {
            const b = e.target.closest("[data-theme-id]");
            if (!b) return;
            const id = b.dataset.themeId;
            closePop();
            SN.setTheme(id, e);
        });
        pop.addEventListener("keydown", (e) => {
            const items = [...pop.querySelectorAll("[data-theme-id]")];
            const i = items.indexOf(document.activeElement);
            if (e.key === "Escape") { closePop(); btn && btn.focus(); }
            if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
            if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
        });
        (pop.querySelector('[aria-checked="true"]') || pop.querySelector("button")).focus();
        document.addEventListener("pointerdown", outside, true);
    };

    // ---------- "Team chat · Calls · Meetings" right after the company name in the top bar (also shortcuts) ----------
    document.addEventListener("DOMContentLoaded", () => {
        const heading = document.querySelector(".sn-topbar .strip-heading");
        if (!heading || !document.body.dataset.me || heading.parentElement.classList.contains("sn-headrow")) return;
        const row = document.createElement("div");
        row.className = "sn-headrow";
        heading.parentNode.insertBefore(row, heading);
        row.appendChild(heading);
        const nav = document.createElement("nav");
        nav.className = "sn-app-tags";
        nav.setAttribute("aria-label", "ShankhNaad");
        nav.innerHTML = [["chat", "/chat", "Team chat", "fa-comments"], ["calls", "/calls", "Calls", "fa-phone"], ["meet", "/meetings", "Meetings", "fa-video-camera"]]
            .map(([k, href, label, icon]) => `<a href="${href}" class="sn-app-tag ${k}" title="${label}"><span class="sn-app-ic"><i class="fa ${icon}" aria-hidden="true"></i></span><span class="sn-app-lb">${label}</span></a>`)
            .join("");
        row.appendChild(nav);
        const mark = () => {
            const p = location.pathname.toLowerCase();
            nav.querySelectorAll("a").forEach((a) => {
                const on = p === a.getAttribute("href") || p.startsWith(a.getAttribute("href") + "/");
                a.classList.toggle("on", on);
                if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
            });
        };
        mark();
        if (SN.onPage) SN.onPage(mark);
        window.addEventListener("popstate", mark);
    });

    // "Theme  CloudWheel  ›" in the user menu: opens a submenu with the three themes (the menu stays open).
    // (No data-strip-action on it, so the menu's own click handler doesn't close the menu.)
    document.addEventListener("DOMContentLoaded", () => {
        const dd = document.querySelector(".strip-user-dropdown[data-strip-user-dropdown]");
        if (!dd || dd.querySelector("[data-sn-theme]")) return;
        const item = document.createElement("div");
        item.className = "strip-user-dropdown-item sn-theme-item";
        item.setAttribute("data-sn-theme", "");
        item.setAttribute("role", "menuitem");
        item.setAttribute("aria-haspopup", "menu");
        item.setAttribute("tabindex", "0");
        item.innerHTML = '<i class="fa fa-adjust" aria-hidden="true" style="width:18px;text-align:center;font-size:16px"></i><span class="sn-theme-label">Theme</span>'
            + '<span class="sn-theme-now"></span><i class="fa fa-chevron-right sn-theme-chev" aria-hidden="true"></i>';
        const logout = dd.querySelector("[data-strip-action='logout']");
        dd.insertBefore(item, logout);
        item.querySelector(".sn-theme-now").textContent = nameOf(current());
        const open = (e) => { e.preventDefault(); SN.themeMenu(e, { anchor: item, side: "left" }); };
        item.addEventListener("click", open);
        item.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " " || e.key === "ArrowLeft") open(e); });
        // close the submenu together with the menu
        new MutationObserver(() => { if (!dd.classList.contains("dropdown-open") && pop) closePop(); })
            .observe(dd, { attributes: true, attributeFilter: ["class"] });
    });

    // ---------- my status (like Teams): a dot on my picture in the top bar + choices at the top of the user menu ----------
    document.addEventListener("DOMContentLoaded", () => {
        const me = document.body.dataset.me;
        const dd = document.querySelector(".strip-user-dropdown[data-strip-user-dropdown]");
        const panel = document.querySelector(".sn-topbar [data-strip-user-panel]");
        if (!me || !dd || dd.querySelector(".sn-status-menu")) return;

        // the dot on my own picture (it reads my status like everyone else's)
        if (panel) {
            panel.setAttribute("data-presence", me);
            const dot = document.createElement("i");
            dot.className = "dot sn-my-dot";
            dot.setAttribute("aria-hidden", "true");
            panel.appendChild(dot);
        }

        const CHOICES = [
            ["available", "Available", "st-available"],
            ["busy", "Busy", "st-busy"],
            ["dnd", "Do not disturb", "st-dnd"],
            ["brb", "Be right back", "st-brb"],
            ["away", "Appear away", "st-away"],
            ["offline", "Appear offline", "st-offline"]
        ];
        const box = document.createElement("div");
        box.className = "sn-status-menu";
        box.innerHTML = `<div class="sn-status-now"><i class="dot" aria-hidden="true"></i><span><b class="sn-status-label">Available</b><small class="sn-status-why"></small></span></div>`
            + CHOICES.map(([v, label, cls]) => `<div class="strip-user-dropdown-item sn-status-item" data-strip-action="status" data-sn-status="${v}" role="menuitemradio">
                    <i class="dot ${cls}" aria-hidden="true"></i><span>${label}</span><i class="fa fa-check sn-status-tick" aria-hidden="true"></i></div>`).join("")
            + `<div class="strip-user-dropdown-item sn-status-item sn-ooo-item" data-strip-action="ooo" role="menuitem">
                    <i class="dot st-ooo" aria-hidden="true"></i><span class="sn-ooo-item-t">Out of office…</span></div>
               <div class="strip-user-dropdown-item sn-status-item sn-ooo-off" data-strip-action="ooo-off" role="menuitem" hidden>
                    <i class="fa fa-sign-in" aria-hidden="true"></i><span>I'm back: turn off out of office</span></div>`
            + `<div class="strip-user-dropdown-item sn-status-item sn-status-reset" data-strip-action="status" data-sn-status="auto" role="menuitem">
                    <i class="fa fa-refresh" aria-hidden="true"></i><span>Reset status</span><small>automatic</small></div>
               <div class="sn-status-sep" role="separator"></div>`;
        dd.prepend(box);
        // the menu's own handler closes it; this runs first and changes the status
        box.addEventListener("click", (e) => {
            const item = e.target.closest("[data-sn-status]");
            if (item && window.Sahyog?.setStatus) Sahyog.setStatus(item.dataset.snStatus);
            if (e.target.closest(".sn-ooo-item")) setTimeout(() => SN.outOfOffice(), 60);
            if (e.target.closest(".sn-ooo-off")) Sahyog.setOutOfOffice(false).then(() => Sahyog.toast?.("Welcome back. Out of office is off.", { kind: "success", title: "Out of office" }))
                .catch(() => Sahyog.toast?.("That didn't work. Try again.", { kind: "error" }));
        });

        const paint = () => {
            if (!window.Sahyog?.stateOf) return;
            const state = Sahyog.stateOf(me), st = Sahyog.status.get(me) || {};
            const info = Sahyog.STATES[state];
            const now = box.querySelector(".sn-status-now .dot");
            now.className = "dot " + info.cls;
            box.querySelector(".sn-status-label").textContent = info.label;
            const ooo = Sahyog.oooOf && Sahyog.oooOf(me);
            box.querySelector(".sn-ooo-item-t").textContent = ooo ? "Change out of office…" : "Out of office…";
            box.querySelector(".sn-ooo-off").hidden = !ooo;
            if (state === "ooo") { box.querySelector(".sn-status-why").textContent = SN.oooUntilText(ooo) + " · colleagues see your note"; return; }
            // why it shows that: picked by me, or set automatically
            const why = st.presenting ? "while you share your screen"
                : (state === "call" || state === "meeting") && st.manual !== "dnd" ? "set automatically"
                : st.manual ? "you set this · Reset to go back to automatic"
                : st.idle ? "no activity for 10 minutes" : "automatic";
            box.querySelector(".sn-status-why").textContent = why;
            box.querySelectorAll(".sn-status-item[data-sn-status]").forEach((i) =>
                i.classList.toggle("on", i.dataset.snStatus === (st.manual || "auto")));
        };
        document.addEventListener("sahyog:presence", paint);
        document.addEventListener("sahyog:ooo", paint);
        paint();
    });

    // ---------- out of office: a note and the day you're back; shown to everyone, even while you're offline ----------
    const dayName = (d) => d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
    /** "back Mon, 25 Nov" / "until you turn it off" */
    SN.oooUntilText = (o) => {
        if (!o || !o.untilUtc) return "until you turn it off";
        const d = new Date(o.untilUtc);
        return d.getHours() === 0 && d.getMinutes() === 0 ? "back " + dayName(d) : "back " + dayName(d) + ", " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    };
    const DEFAULT_NOTE = "I'm out of the office and will reply when I'm back.";
    const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    let oooDlg = null;
    SN.outOfOffice = () => {
        const me = document.body.dataset.me;
        if (!me || !window.Sahyog?.setOutOfOffice) return;
        const cur = Sahyog.oooOf && Sahyog.oooOf(me);
        if (!oooDlg) {
            oooDlg = document.createElement("dialog");
            oooDlg.className = "sn-dialog glass-strong sn-ooo-dlg";
            oooDlg.id = "oooDialog";
            oooDlg.setAttribute("aria-labelledby", "oooT");
            oooDlg.innerHTML = `
                <form method="dialog" id="oooForm" novalidate>
                    <div class="sn-dlg-head">
                        <div class="sn-dlg-title"><span class="sn-dlg-icon sn-ooo-ic"><i class="fa fa-plane" aria-hidden="true"></i></span>
                            <div><h2 id="oooT">Out of office</h2><p>Colleagues see a purple status and your note, even while you're offline.</p></div></div>
                        <button type="button" class="sn-close" data-close aria-label="Close"><i class="fa fa-times" aria-hidden="true"></i></button>
                    </div>
                    <div class="sn-dlg-body sn-ooo-body">
                        <label class="sn-field-label" for="oooMsg">Note for colleagues</label>
                        <textarea id="oooMsg" class="sn-textarea sn-ooo-msg" rows="3" maxlength="500"></textarea>
                        <div class="sn-field-label" id="oooWhenL">I'm back on</div>
                        <div class="sn-ooo-when" role="radiogroup" aria-labelledby="oooWhenL">
                            <button type="button" role="radio" data-when="tomorrow">Tomorrow</button>
                            <button type="button" role="radio" data-when="monday">Monday</button>
                            <button type="button" role="radio" data-when="pick">Pick a date</button>
                            <button type="button" role="radio" data-when="none">Until I turn it off</button>
                        </div>
                        <input type="date" id="oooDate" class="sn-textarea sn-ooo-date" aria-label="The day you're back" hidden />
                        <div class="sn-ooo-preview"><span class="sn-ooo-preview-l">Colleagues see</span>
                            <span class="sn-ooo-chip"><i class="dot st-ooo" aria-hidden="true"></i><b>Out of office</b> · <span id="oooPrevWhen"></span></span>
                            <q id="oooPrevMsg"></q></div>
                    </div>
                    <div class="sn-dlg-foot">
                        <button type="button" class="cee-btn sn-btn-danger-soft" id="oooOff" hidden><i class="fa fa-sign-in" aria-hidden="true"></i> I'm back: turn off</button>
                        <span style="display:flex;gap:10px;margin-left:auto">
                            <button type="button" class="cee-btn sn-btn-light" data-close>Cancel</button>
                            <button type="submit" class="cee-btn cee-btn-gradient" id="oooSave"><i class="fa fa-check" aria-hidden="true"></i> <span>Turn on</span></button>
                        </span>
                    </div>
                </form>`;
            document.body.appendChild(oooDlg);
            const q = (s) => oooDlg.querySelector(s);
            oooDlg.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => oooDlg.close()));
            const back = () => {
                const w = oooDlg.dataset.when, t = startOf(new Date());
                if (w === "tomorrow") return new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
                if (w === "monday") { const add = ((8 - t.getDay()) % 7) || 7; return new Date(t.getFullYear(), t.getMonth(), t.getDate() + add); }
                if (w === "pick" && q("#oooDate").value) { const [y, m, d] = q("#oooDate").value.split("-").map(Number); return new Date(y, m - 1, d); }
                return null;
            };
            oooDlg._back = back;
            const preview = () => {
                const b = back();
                q("#oooPrevWhen").textContent = b ? "back " + dayName(b) : oooDlg.dataset.when === "pick" ? "pick a day" : "until you turn it off";
                const m = q("#oooMsg").value.trim();
                q("#oooPrevMsg").textContent = m;
                q("#oooPrevMsg").hidden = !m;
            };
            oooDlg._preview = preview;
            const pickWhen = (w) => {
                oooDlg.dataset.when = w;
                oooDlg.querySelectorAll("[data-when]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.when === w)));
                q("#oooDate").hidden = w !== "pick";
                if (w === "pick") setTimeout(() => q("#oooDate").focus(), 30);
                preview();
            };
            oooDlg._pickWhen = pickWhen;
            oooDlg.querySelectorAll("[data-when]").forEach((b) => b.addEventListener("click", () => pickWhen(b.dataset.when)));
            q("#oooMsg").addEventListener("input", preview);
            q("#oooDate").addEventListener("input", preview);
            q("#oooDate").addEventListener("change", preview);   // Safari picker
            q("#oooForm").addEventListener("submit", async (e) => {
                e.preventDefault();
                if (oooDlg.dataset.when === "pick" && !back()) { Sahyog.toast?.("Pick the day you're back.", { kind: "warn" }); return; }
                const b = back();
                if (b && b <= new Date()) { Sahyog.toast?.("Pick a day after today.", { kind: "warn" }); return; }
                q("#oooSave").disabled = true;
                try {
                    await Sahyog.setOutOfOffice(true, q("#oooMsg").value.trim(), b ? b.toISOString() : null);
                    oooDlg.close();
                    Sahyog.toast?.("Out of office is on" + (b ? " until " + dayName(b) : "") + ". Colleagues see your note.", { kind: "success", title: "Out of office" });
                } catch (err) {
                    Sahyog.toast?.(String(err && err.message || "").replace(/^.*HubException: /, "") || "That didn't work. Try again.", { kind: "error", title: "Out of office" });
                }
                q("#oooSave").disabled = false;
            });
            q("#oooOff").addEventListener("click", async () => {
                try { await Sahyog.setOutOfOffice(false); oooDlg.close(); Sahyog.toast?.("Welcome back. Out of office is off.", { kind: "success", title: "Out of office" }); }
                catch { Sahyog.toast?.("That didn't work. Try again.", { kind: "error" }); }
            });
        }
        const q = (s) => oooDlg.querySelector(s);
        const tomorrow = startOf(new Date()); tomorrow.setDate(tomorrow.getDate() + 1);
        q("#oooDate").min = isoDay(tomorrow);
        q("#oooMsg").value = cur ? (cur.message || "") : DEFAULT_NOTE;
        if (cur && cur.untilUtc) { q("#oooDate").value = isoDay(new Date(cur.untilUtc)); oooDlg._pickWhen("pick"); }
        else oooDlg._pickWhen(cur ? "none" : "tomorrow");
        q("#oooOff").hidden = !cur;
        q("#oooSave span").textContent = cur ? "Save" : "Turn on";
        oooDlg.showModal();
        setTimeout(() => q("#oooMsg").focus(), 50);
    };

    // Follow the computer's setting until the person picks one.
    try {
        if (!localStorage.getItem("sn-theme3") && !localStorage.getItem("sn-theme") && window.matchMedia) {
            matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (m) => {
                if (!localStorage.getItem("sn-theme3")) {
                    root.setAttribute("data-theme", m.matches ? "dark" : "light");
                    root.setAttribute("data-skin", m.matches ? "cloudwheel" : "light");
                    root.classList.remove("sn-carbon");
                }
            });
        }
    } catch (e) { }
})();

// ---------- smooth page changes ----------
(function () {
    "use strict";
    window.SN = window.SN || {};
    /** Goes to a URL; dir = "next" | "prev" makes the page slide that way (browsers with view transitions). */
    SN.goSmooth = (url, dir, delay) => {
        if (SN.navigate && SN.nav.canGo(url)) { SN.navigate(url, { dir, minLeave: delay || 0 }); return; }
        try { if (dir) sessionStorage.setItem("sn-dir", dir); } catch (e) { }
        setTimeout(() => { window.location.href = url; }, delay || 0);
    };
})();

// Coming back with the browser's Back button: undo the "leaving" fade.
window.addEventListener("pageshow", () => {
    document.documentElement.classList.remove("sn-leaving", "sn-leaving-next", "sn-leaving-prev");
});

// ---------- left rail: the highlight glides to the new tab instead of jumping ----------
// One shared highlight ("pill") sits behind the active tab. Clicking a tab doesn't snap the highlight;
// the page change carries it from the old tab to the new one (view transitions in Edge/Chrome/Safari 18+,
// a short slide in other browsers).
(function () {
    "use strict";
    const rail = document.querySelector(".sn-rail .report-rail");
    if (!rail) return;
    const items = rail.querySelector(".rr-items");
    const pill = document.createElement("span");
    pill.className = "sn-rail-pill";
    pill.setAttribute("aria-hidden", "true");
    rail.insertBefore(pill, items);
    rail.classList.add("sn-has-pill");

    const KEY = "sn-rail-from";
    const rectOf = (item) => {
        const r = rail.getBoundingClientRect(), i = item.getBoundingClientRect(), inset = 6;
        return { x: i.left - r.left + rail.scrollLeft + inset, y: i.top - r.top + rail.scrollTop + inset, w: i.width - inset * 2, h: i.height - inset * 2 };
    };
    const put = (b, animate) => {
        if (!animate) pill.style.transition = "none";
        pill.style.width = b.w + "px";
        pill.style.height = b.h + "px";
        pill.style.transform = `translate(${b.x}px, ${b.y}px)`;
        pill.style.opacity = "1";
        if (!animate) { void pill.offsetHeight; pill.style.transition = ""; }
    };
    const active = () => rail.querySelector(".rr-items > .rr-item.rr-active");

    // Where the highlight was on the previous page (only used by browsers without view transitions).
    let from = null;
    try { from = JSON.parse(sessionStorage.getItem(KEY) || "null"); sessionStorage.removeItem(KEY); } catch (e) { }

    const place = () => {
        const a = active();
        if (!a) { pill.style.opacity = "0"; return; }
        const to = rectOf(a);
        const noVt = document.documentElement.classList.contains("sn-no-vt");
        if (noVt && from && (from.x !== to.x || from.y !== to.y)) {
            put(from, false);
            requestAnimationFrame(() => put(to, true));
        } else {
            put(to, false);
        }
        from = null;
    };
    place();
    window.addEventListener("resize", () => { const a = active(); if (a) put(rectOf(a), false); });

    // Partial page loads: the rail stays, so take the active tab from the new page and move the highlight
    // (animate = slide it here; with view transitions the transition itself carries it over).
    window.SN = window.SN || {};
    SN.railSync = (doc, animate) => {
        const fresh = doc && doc.querySelector(".sn-rail .report-rail .rr-items");
        if (fresh) {
            rail.querySelectorAll(".rr-items > .rr-item").forEach((item) => {
                const key = item.getAttribute("data-key");
                const twin = key && fresh.querySelector(`.rr-item[data-key="${key}"]`);
                if (twin) item.className = twin.className;
            });
        }
        const a = active();
        if (a) put(rectOf(a), !!animate); else pill.style.opacity = "0";
        try { window.jQuery && jQuery(rail).data("rr-reposition")?.(!!animate); } catch (e) { }
    };
    // Back button (page restored from cache): just sit on the active tab.
    window.addEventListener("pageshow", (e) => { if (e.persisted) { const a = active(); if (a) put(rectOf(a), false); } });

    // Capture the click before the rail control snaps its own highlight; the link still navigates.
    rail.addEventListener("click", (e) => {
        const link = e.target.closest("a.rr-item-btn[href]");
        if (!link || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
        const item = link.closest(".rr-item");
        if (!item || item.classList.contains("rr-active")) return;
        e.stopPropagation();
        const cur = active();
        // Without view transitions, start the glide right away while the next page loads.
        if (document.documentElement.classList.contains("sn-no-vt")) put(rectOf(item), true);
        // the page itself loads partially (sn-nav.js): the rail, top bar and live connection stay
        if (window.SN?.navigate && SN.nav.canGo(link.href)) { e.preventDefault(); SN.navigate(link.href); return; }
        try { if (cur) sessionStorage.setItem(KEY, JSON.stringify(rectOf(cur))); } catch (x) { }
    }, true);
})();

// ---------- Chat: Details panel and the + button ----------
(function () {
    "use strict";
    window.SN = window.SN || {};
    const KEY = "sn-hide-details";
    const mark = () => {
        const hidden = document.body.classList.contains("sn-hide-info");
        document.querySelectorAll("#ChatHeader .hdr-btn").forEach((b) => {
            if ((b.textContent || "").trim() === "Details") {
                b.classList.toggle("sn-btn-on", !hidden);
                b.setAttribute("aria-pressed", hidden ? "false" : "true");
            }
        });
    };
    /** Shows / hides the Details panel with a slide, and remembers the choice on this device. */
    SN.toggleDetails = () => {
        const hidden = document.body.classList.toggle("sn-hide-info");
        // remember the choice only on a big screen (on tablets / phones Details always starts closed)
        if (window.innerWidth > 1100) { try { localStorage.setItem(KEY, hidden ? "1" : "0"); } catch (e) { } }
        mark();
    };
    const restoreDetails = () => {
        if (!document.querySelector(".chat-info")) return;
        let saved = null;
        try { saved = localStorage.getItem(KEY); } catch (e) { }
        if (saved === "1") {
            // restore without animating on page load
            document.documentElement.classList.add("sn-still");
            document.body.classList.add("sn-hide-info");
            requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove("sn-still")));
        }
        mark();
    };
    if (SN.onPage) SN.onPage(restoreDetails); else restoreDetails();

    // + (new channel): a burst ring on click
    document.addEventListener("click", (e) => {
        const plus = e.target.closest(".side-head .sn-icon-btn.grad");
        if (!plus) return;
        plus.classList.remove("sn-burst");
        void plus.offsetWidth;
        plus.classList.add("sn-burst");
        setTimeout(() => plus.classList.remove("sn-burst"), 600);
    });
})();
