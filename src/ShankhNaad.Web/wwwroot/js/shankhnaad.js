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

// ---------- themes: Kesari (saffron, white, green), Light, Dark (very dark grey glass), CloudWheel (the blue dark) ----------
(function () {
    "use strict";
    window.SN = window.SN || {};
    const root = document.documentElement;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Both dark themes keep data-theme="dark" (all the dark styles); "Dark" adds sn-carbon (css/theme-dark.css).
    // Kesari is a light theme too: data-theme="light" + data-skin="kesari" (css/theme-kesari.css recolours it).
    const LIGHTS = ["light", "kesari"];
    const THEMES = [
        // color = the desktop app's title bar (− □ ×) and the phone browser bar, matching the page behind it
        { id: "kesari", name: "Kesari", note: "Saffron, white and green", color: "#FFF4E8" },
        { id: "light", name: "Light", note: "Bright glass", color: "#E6ECFB" },
        { id: "dark", name: "Dark", note: "Very dark grey glass", color: "#0B0B0C" },
        { id: "cloudwheel", name: "CloudWheel", note: "Deep blue night", color: "#0B1020" }
    ];
    const current = () => root.getAttribute("data-skin") || (root.getAttribute("data-theme") === "dark" ? "cloudwheel" : "light");
    const nameOf = (id) => (THEMES.find((t) => t.id === id) || THEMES[0]).name;
    SN.theme = current;

    function apply(theme) {
        const light = LIGHTS.includes(theme);
        root.setAttribute("data-theme", light ? "light" : "dark");
        root.setAttribute("data-skin", theme);
        root.classList.toggle("sn-carbon", theme === "dark");
        try { localStorage.setItem("sn-theme3", theme); localStorage.setItem("sn-theme", light ? "light" : "dark"); } catch (e) { }
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute("content", (THEMES.find((t) => t.id === theme) || THEMES[0]).color);
        // the tab / window icon: the saffron | green logo in Kesari
        const icon = document.querySelector('link[rel="icon"]');
        if (icon) icon.setAttribute("href", theme === "kesari" ? "/images/logo-kesari.svg" : "/favicon.svg");
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

    /** Cycles Kesari → Light → Dark → CloudWheel (the user-menu item). */
    SN.toggleTheme = (evt) => {
        const i = THEMES.findIndex((t) => t.id === current());
        SN.setTheme(THEMES[(i + 1) % THEMES.length].id, evt);
    };

    /** The top-bar button: a small menu with the four themes. */
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

    // ---------- "Team chat · Calls · Meetings · Files · Team · Org" right after the company name in the top bar (also shortcuts) ----------
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
        // Files, Team and Org only where the side rail has them (a super admin's rail doesn't)
        // same order as the side rail: Chat, Calls, Files, Meetings, Team, Work, Org
        const tags = [["chat", "/chat", "Team chat", "fa-comments"], ["calls", "/calls", "Calls", "fa-phone"], ["files", "/files", "Files", "fa-folder-open"],
            ["meet", "/meetings", "Meetings", "fa-video-camera"], ["team", "/team", "Team", "fa-users"], ["work", "/work", "Work", "fa-briefcase"], ["org", "/org", "Org", "fa-sitemap"]]
            .filter(([k, href]) => k === "chat" || k === "calls" || k === "meet" || document.querySelector('.rr-item-btn[href="' + href + '"], a[href="' + href + '"]'));
        nav.innerHTML = tags
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
            if (e.target.closest(".sn-ooo-off")) { const wasNow = !!(Sahyog.oooOf && Sahyog.oooOf(me)); Sahyog.setOutOfOffice(false).then(() => Sahyog.toast?.(wasNow ? "Welcome back. Out of office is off." : "Your planned out of office is cancelled.", { kind: "success", title: "Out of office" }))
                .catch(() => Sahyog.toast?.("That didn't work. Try again.", { kind: "error" })); }
        });

        const paint = () => {
            if (!window.Sahyog?.stateOf) return;
            const state = Sahyog.stateOf(me), st = Sahyog.status.get(me) || {};
            const info = Sahyog.STATES[state];
            const now = box.querySelector(".sn-status-now .dot");
            now.className = "dot " + info.cls;
            box.querySelector(".sn-status-label").textContent = info.label;
            const ooo = Sahyog.oooOf && Sahyog.oooOf(me);
            const plan = Sahyog.oooPlanOf ? Sahyog.oooPlanOf(me) : ooo;
            box.querySelector(".sn-ooo-item-t").textContent = ooo ? "Change out of office…" : plan ? "Out of office: " + SN.oooUntilText(plan) : "Out of office…";
            const off = box.querySelector(".sn-ooo-off");
            off.hidden = !plan;
            off.lastElementChild.textContent = ooo ? "I'm back: turn off out of office" : "Cancel planned out of office";
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

    // ---------- out of office: from a day to a day, a note, and who to tell by email; shown to everyone, even while you're offline ----------
    const dayName = (d) => d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
    const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    /** "Mon, 24 Nov – Fri, 28 Nov" / "Mon, 24 Nov" / "from Mon, 24 Nov" — first and last day away (local dates). */
    SN.oooRangeText = (first, last) => {
        if (!first) return "";
        if (!last) return "from " + dayName(first);
        return +startOf(first) === +startOf(last) ? dayName(first) : dayName(first) + " – " + dayName(last);
    };
    /** The days away of a saved out of office: { first, last } (last = null: until turned off). */
    SN.oooDays = (o) => {
        if (!o) return null;
        const first = startOf(new Date(o.startUtc || o.sinceUtc || Date.now()));
        const last = o.untilUtc ? addDays(startOf(new Date(new Date(o.untilUtc) - 1)), 0) : null;
        return { first, last };
    };
    const timeName = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const isMidnight = (d) => d.getHours() === 0 && d.getMinutes() === 0;
    SN.oooTimeName = timeName;
    /** True when it starts or ends partway through a day (e.g. 4:00 pm – 5:00 pm). */
    SN.oooHasHours = (o) => !!o && ((!!o.startUtc && !isMidnight(new Date(o.startUtc))) || (!!o.untilUtc && !isMidnight(new Date(o.untilUtc))));
    /** "Fri, 20 Nov, 4:00 pm – 5:00 pm" · "Fri, 20 Nov, 4:00 pm – Mon, 23 Nov, 10:00 am" · "Mon, 24 Nov – Fri, 28 Nov" · "from Mon, 24 Nov" */
    SN.oooWhenText = (o) => {
        if (!o) return "";
        const r = SN.oooDays(o);
        if (!SN.oooHasHours(o)) return SN.oooRangeText(r.first, r.last);
        const s = new Date(o.startUtc || o.sinceUtc || Date.now()), sTime = !!o.startUtc && !isMidnight(s);
        const left = sTime ? dayName(s) + ", " + timeName(s) : dayName(s);
        if (!o.untilUtc) return "from " + left;
        const e = new Date(o.untilUtc), eTime = !isMidnight(e);
        if (+r.last === +startOf(s)) return eTime ? (sTime ? left + " – " + timeName(e) : dayName(s) + ", until " + timeName(e)) : dayName(s) + ", from " + timeName(s);
        return left + " – " + (eTime ? dayName(e) + ", " + timeName(e) : dayName(r.last));
    };
    /** The hours away on one day: "4:00 pm – 5:00 pm" · "from 4:00 pm" · "until 10:00 am" · "" (the whole day). */
    SN.oooHoursOn = (o, day) => {
        if (!o) return "";
        const d0 = startOf(day), d1 = addDays(d0, 1);
        const s = new Date(o.startUtc || o.sinceUtc || Date.now()), e = o.untilUtc ? new Date(o.untilUtc) : null;
        const from = o.startUtc && s > d0 ? s : null, until = e && e < d1 ? e : null;
        if (from && until) return timeName(from) + " – " + timeName(until);
        if (from) return "from " + timeName(from);
        if (until) return "until " + timeName(until);
        return "";
    };
    /** "back Mon, 25 Nov" / "until you turn it off" (for out of office now); "planned · Mon, 24 Nov – Fri, 28 Nov" (later) */
    SN.oooUntilText = (o) => {
        if (!o) return "";
        if (o.startUtc && new Date(o.startUtc) > new Date()) return "planned · " + SN.oooWhenText(o);
        if (!o.untilUtc) return "until you turn it off";
        const d = new Date(o.untilUtc);
        return d.getHours() === 0 && d.getMinutes() === 0 ? "back " + dayName(d) : "back " + dayName(d) + ", " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    };
    const DEFAULT_NOTE = "I'm out of the office and will reply when I'm back.";
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    // the same date box as the meetings scheduler (TagHelper <modern-datepicker-with-label>)
    const datebox = (id, label, placeholder) => `
        <div class="mdpwl-outer sn-ooo-dp" style="--mdpwl-height: 42px;">
            <label class="mdpwl-label" for="${id}">${label}</label>
            <div class="mdpwl-field" data-required="false" style="--mdpwl-radius: 30px;">
                <input type="text" id="${id}" class="mdpwl-input" placeholder="${placeholder}" autocomplete="off" data-disabled-dates="[]" />
                <span class="mdpwl-icon-error" style="display:none;"></span>
                <span class="mdpwl-icon"><i class="bi bi-calendar3"></i></span>
            </div>
        </div>`;
    let oooDlg = null;
    SN.outOfOffice = () => {
        const me = document.body.dataset.me;
        if (!me || !window.Sahyog?.saveOutOfOffice) return;
        const cur = Sahyog.oooPlanOf ? Sahyog.oooPlanOf(me) : (Sahyog.oooOf && Sahyog.oooOf(me));
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
                      <div class="sn-ooo-col sn-ooo-left">
                        <div class="sn-ooo-sec-h"><span class="sn-ooo-step">1</span> When are you away?</div>
                        <div class="sn-field-label sr-only" id="oooWhenL">When are you away?</div>
                        <div class="sn-ooo-when" aria-labelledby="oooWhenL">
                            <button type="button" data-quick="today">Today</button>
                            <button type="button" data-quick="tomorrow">Tomorrow</button>
                            <button type="button" data-quick="week">Rest of this week</button>
                            <button type="button" data-quick="next">Next week</button>
                        </div>
                        <div class="sn-ooo-range">
                            ${datebox("oooFrom", "From", "First day away")}
                            <span class="sn-ooo-arrow" aria-hidden="true"><i class="fa fa-long-arrow-right"></i></span>
                            ${datebox("oooTo", "To", "Last day away")}
                        </div>
                        <div class="sn-ooo-range-foot">
                            <label class="sn-ooo-noend"><input type="checkbox" id="oooNoEnd" /> <span>No end date: until I turn it off</span></label>
                            <span class="sn-ooo-count" id="oooCount"></span>
                        </div>
                        <div class="sn-ooo-hours">
                            <label class="sn-ooo-noend"><input type="checkbox" id="oooPart" /> <span>Only part of the day: set the hours</span></label>
                            <div class="sn-ooo-range sn-ooo-times" id="oooTimes" hidden>
                                <div class="mdpwl-outer"><label class="mdpwl-label" for="oooFromTime">Leave at</label>
                                    <select id="oooFromTime" class="sn-ooo-tsel"></select></div>
                                <span class="sn-ooo-arrow" aria-hidden="true"><i class="fa fa-long-arrow-right"></i></span>
                                <div class="mdpwl-outer" id="oooToTimeBox"><label class="mdpwl-label" for="oooToTime">Back at</label>
                                    <select id="oooToTime" class="sn-ooo-tsel"></select></div>
                            </div>
                        </div>
                        <div class="sn-ooo-sec-h"><span class="sn-ooo-step">2</span> <label for="oooMsg">Note for colleagues</label></div>
                        <textarea id="oooMsg" class="sn-textarea sn-ooo-msg" rows="3" maxlength="500"></textarea>
                      </div>
                      <div class="sn-ooo-col sn-ooo-right">
                        <div class="sn-ooo-sec-h" id="oooMailL"><span class="sn-ooo-step">3</span> Tell people by email</div>
                        <div class="sn-ooo-seg" role="radiogroup" aria-labelledby="oooMailL">
                            <button type="button" role="radio" data-notify="none"><i class="fa fa-ban" aria-hidden="true"></i> Don't email</button>
                            <button type="button" role="radio" data-notify="all"><i class="fa fa-users" aria-hidden="true"></i> Whole team</button>
                            <button type="button" role="radio" data-notify="some"><i class="fa fa-user-plus" aria-hidden="true"></i> Pick people</button>
                        </div>
                        <p class="sn-ooo-mailnote" id="oooMailNote" hidden></p>
                        <div class="sn-ooo-nopick" id="oooNoPick"><i class="fa fa-envelope-o" aria-hidden="true"></i><b></b><span></span></div>
                        <div class="sn-ooo-people" id="oooPeople" hidden>
                            <div class="sn-ooo-people-top">
                                <label class="sn-ooo-search"><i class="fa fa-search" aria-hidden="true"></i><input type="search" id="oooSearch" placeholder="Search by name, title or department" aria-label="Search your team" autocomplete="off" /></label>
                                <div class="sn-ooo-people-bar">
                                    <span class="sn-ooo-pickn" id="oooPicked">0 picked</span>
                                    <span class="sn-ooo-people-acts">
                                        <button type="button" class="sn-ooo-linkbtn" id="oooAll"><i class="fa fa-check-square-o" aria-hidden="true"></i> Select shown</button>
                                        <button type="button" class="sn-ooo-linkbtn sn-ooo-clear" id="oooNone"><i class="fa fa-times" aria-hidden="true"></i> Clear</button>
                                    </span>
                                </div>
                            </div>
                            <div class="sn-ooo-list" id="oooList" role="listbox" aria-multiselectable="true"><p class="sn-ooo-empty">Loading your team…</p></div>
                        </div>
                        <div class="sn-ooo-preview"><span class="sn-ooo-preview-l">Colleagues see</span>
                            <span class="sn-ooo-chip"><i class="dot st-ooo" aria-hidden="true"></i><b>Out of office</b> · <span id="oooPrevWhen"></span></span>
                            <q id="oooPrevMsg"></q>
                            <span class="sn-ooo-prev-mail" id="oooPrevMail" hidden><i class="fa fa-envelope-o" aria-hidden="true"></i> <span></span></span></div>
                      </div>
                    </div>
                    <div class="sn-dlg-foot">
                        <button type="button" class="cee-btn sn-btn-danger-soft" id="oooOff" hidden><i class="fa fa-sign-in" aria-hidden="true"></i> <span>I'm back: turn off</span></button>
                        <span class="sn-ooo-footsum" id="oooFootSum"></span>
                        <span style="display:flex;gap:10px;margin-left:auto">
                            <button type="button" class="cee-btn sn-btn-light" data-close>Cancel</button>
                            <button type="submit" class="cee-btn cee-btn-gradient" id="oooSave"><i class="fa fa-check" aria-hidden="true"></i> <span>Turn on</span></button>
                        </span>
                    </div>
                </form>`;
            document.body.appendChild(oooDlg);
            const q = (s) => oooDlg.querySelector(s);
            oooDlg.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => oooDlg.close()));

            // ----- the two date boxes (flatpickr, like the scheduler) -----
            if (window.ModernDatePickerWithLabel) window.ModernDatePickerWithLabel.init(oooDlg);
            const fp = (id) => window.ModernDatePickerWithLabel?._instances?.[id] || null;
            const dayOf = (id) => {
                const f = fp(id);
                if (f) return f.selectedDates[0] ? startOf(f.selectedDates[0]) : null;
                const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(q("#" + id).value.trim());
                return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
            };
            const setDay = (id, d) => {
                const f = fp(id);
                if (f) { if (d) f.setDate(d, false); else f.clear(false); }
                else q("#" + id).value = d ? `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}` : "";
            };
            oooDlg._setDay = setDay;
            oooDlg._dayOf = dayOf;
            const sync = () => {
                const from = dayOf("oooFrom"), today = startOf(new Date());
                const fTo = fp("oooTo"), fFrom = fp("oooFrom");
                const to = dayOf("oooTo");   // read before changing the limit (the calendar drops a day outside it)
                if (fFrom) fFrom.set("minDate", today);
                if (from && to && to < from && !q("#oooNoEnd").checked) setDay("oooTo", from);
                if (fTo) fTo.set("minDate", from || today);
                oooDlg._fixTimes?.();
                preview();
            };
            oooDlg._sync = sync;
            ["oooFrom", "oooTo"].forEach((id) => {
                const f = fp(id);
                if (f) f.config.onChange.push(() => setTimeout(sync, 0));
                q("#" + id).addEventListener("change", sync);
                q("#" + id).addEventListener("blur", () => setTimeout(sync, 0));
            });
            q("#oooNoEnd").addEventListener("change", () => {
                const off = q("#oooNoEnd").checked, input = q("#oooTo");
                if (off) { setDay("oooTo", null); window.disableModernDatePickerWithLabel ? window.disableModernDatePickerWithLabel("#oooTo") : (input.disabled = true); }
                else { window.enableModernDatePickerWithLabel ? window.enableModernDatePickerWithLabel("#oooTo") : (input.disabled = false); }
                preview();
            });
            const setRange = (from, to) => {
                if (q("#oooNoEnd").checked && to) { q("#oooNoEnd").checked = false; q("#oooNoEnd").dispatchEvent(new Event("change")); }
                fp("oooTo")?.set("minDate", null);   // the old limit would refuse an earlier day
                setDay("oooFrom", from); setDay("oooTo", to); sync();
            };
            oooDlg.querySelectorAll("[data-quick]").forEach((b) => b.addEventListener("click", () => {
                const t = startOf(new Date()), dow = t.getDay();   // 0 Sun … 6 Sat
                const w = b.dataset.quick;
                if (w === "today") setRange(t, t);
                else if (w === "tomorrow") setRange(addDays(t, 1), addDays(t, 1));
                else if (w === "week") setRange(t, addDays(t, dow <= 5 ? 5 - dow : 6));                       // till Friday (Saturday on a Saturday)
                else if (w === "next") { const mon = addDays(t, ((8 - dow) % 7) || 7); setRange(mon, addDays(mon, 4)); }   // next Mon – Fri
            }));

            // ----- only part of the day: leave at (on the first day) → back at (on the last day) -----
            const pad = (n) => String(n).padStart(2, "0");
            const hhmm = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
            const minsOf = (v) => { const [h, m] = String(v || "0:0").split(":").map(Number); return h * 60 + (m || 0); };
            const timeOpts = (fromM, toM, endOfDay) => {
                let h = "";
                for (let m = fromM; m <= toM; m += 15) h += `<option value="${hhmm(m)}">${timeName(new Date(2000, 0, 1, Math.floor(m / 60), m % 60))}</option>`;
                return h + (endOfDay ? '<option value="24:00">End of day</option>' : "");
            };
            q("#oooFromTime").innerHTML = timeOpts(0, 23 * 60 + 45, false);
            q("#oooToTime").innerHTML = timeOpts(15, 23 * 60 + 45, true);
            const partOn = () => q("#oooPart").checked;
            const at = (day, v) => { const m = minsOf(v); return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(m / 60), m % 60); };
            /** The time away as chosen: { from, to, noEnd, part, start, end } (end = null: until I turn it off). */
            const span = () => {
                const from = dayOf("oooFrom"), noEnd = q("#oooNoEnd").checked, to = noEnd ? null : dayOf("oooTo"), part = partOn();
                if (!from) return { from, to, noEnd, part, start: null, end: null };
                return { from, to, noEnd, part, start: part ? at(from, q("#oooFromTime").value) : from, end: to ? (part ? at(to, q("#oooToTime").value) : addDays(to, 1)) : null };
            };
            oooDlg._span = span;
            const setTimes = (fromV, toV) => { q("#oooFromTime").value = fromV; q("#oooToTime").value = toV; };
            oooDlg._setTimes = setTimes;
            /** Leave at the next quarter hour (today) or 9:00 am, back an hour later. */
            const defaultTimes = () => {
                const from = dayOf("oooFrom"), now = new Date();
                const s = from && +from === +startOf(now) ? Math.min(Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 15) * 15, 22 * 60 + 45) : 9 * 60;
                setTimes(hhmm(s), hhmm(s + 60));
            };
            const fixTimes = () => {
                const { from, to } = span();
                q("#oooToTimeBox").hidden = q("#oooNoEnd").checked;
                // the same day: back has to be after leave
                if (from && to && +from === +to && minsOf(q("#oooToTime").value) <= minsOf(q("#oooFromTime").value))
                    q("#oooToTime").value = minsOf(q("#oooFromTime").value) >= 23 * 60 ? "24:00" : hhmm(minsOf(q("#oooFromTime").value) + 60);
            };
            oooDlg._fixTimes = fixTimes;
            q("#oooPart").addEventListener("change", () => {
                q("#oooTimes").hidden = !partOn();
                if (partOn()) defaultTimes();
                fixTimes(); preview();
            });
            q("#oooFromTime").addEventListener("change", () => { fixTimes(); preview(); });
            q("#oooToTime").addEventListener("change", () => { fixTimes(); preview(); });
            q("#oooNoEnd").addEventListener("change", () => fixTimes());

            // ----- who to tell by email -----
            let people = null, picked = new Set(), canEmail = true;
            const paintPicked = () => {
                q("#oooPicked").innerHTML = "<b>" + picked.size + "</b> picked";
                preview();
            };
            const paintList = () => {
                const list = q("#oooList");
                if (!people) return;
                const term = q("#oooSearch").value.trim().toLowerCase();
                const shown = people.filter((p) => !term || (p.name + " " + (p.title || "") + " " + (p.dept || "")).toLowerCase().includes(term));
                if (!shown.length) { list.innerHTML = `<p class="sn-ooo-empty">${people.length ? "Nobody matches." : "Nobody else in your team yet."}</p>`; return; }
                list.innerHTML = shown.map((p) => {
                    const on = picked.has(p.id);
                    return `<button type="button" class="sn-ooo-person${on ? " on" : ""}" role="option" aria-selected="${on}" data-id="${esc(p.id)}"${p.hasEmail ? "" : " disabled title=\"No email address\""}>
                        <span class="avatar av-28 sn-ooo-av tone-${+p.tone || 0}" data-user="${esc(p.id)}">${esc(p.initials)}</span>
                        <span class="sn-ooo-pname"><b>${esc(p.name)}</b><small>${p.hasEmail ? esc([p.title, p.dept].filter(Boolean).join(" · ")) : "no email address"}</small></span>
                        <i class="sn-ooo-tick fa fa-check" aria-hidden="true"></i></button>`;
                }).join("");
                window.Sahyog?.paintPhotos?.(list);
            };
            q("#oooList").addEventListener("click", (e) => {
                const b = e.target.closest(".sn-ooo-person");
                if (!b || b.disabled) return;
                const id = b.dataset.id;
                if (picked.has(id)) picked.delete(id); else picked.add(id);
                b.classList.toggle("on", picked.has(id)); b.setAttribute("aria-selected", String(picked.has(id)));
                paintPicked();
            });
            q("#oooSearch").addEventListener("input", paintList);
            q("#oooAll").addEventListener("click", () => {
                const term = q("#oooSearch").value.trim().toLowerCase();
                (people || []).filter((p) => p.hasEmail && (!term || (p.name + " " + (p.title || "") + " " + (p.dept || "")).toLowerCase().includes(term))).forEach((p) => picked.add(p.id));
                paintList(); paintPicked();
            });
            q("#oooNone").addEventListener("click", () => { picked.clear(); paintList(); paintPicked(); });
            const loadPeople = async () => {
                if (people) return;
                try {
                    const r = await fetch("/status/out-of-office/people", { headers: { Accept: "application/json" }, credentials: "same-origin" });
                    const d = await r.json();
                    people = d.people || []; canEmail = d.canEmail !== false;
                } catch { people = []; }
                paintList(); notifyNote(); preview();
                if (oooDlg.dataset.notify === "all") pickNotify("all");
            };
            const notifyNote = () => {
                const n = q("#oooMailNote"), w = oooDlg.dataset.notify;
                n.hidden = canEmail || w === "none";
                n.textContent = "Email isn't set up on the server yet, so no email can be sent. Your status still changes.";
            };
            const pickNotify = (w) => {
                oooDlg.dataset.notify = w;
                oooDlg.querySelectorAll("[data-notify]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.notify === w)));
                q("#oooPeople").hidden = w !== "some";
                const np = q("#oooNoPick");
                np.hidden = w === "some";
                np.dataset.kind = w;
                np.querySelector("b").textContent = w === "all" ? "Everyone in your team gets an email" : "No email is sent";
                np.querySelector("span").textContent = w === "all" ? (people ? people.filter((p) => p.hasEmail).length + " people with an email address. They also see your status in the app." : "Everyone with an email address. They also see your status in the app.")
                    : "Your status and note still show in the app. Pick “Whole team” or “Pick people” to email them too.";
                if (w !== "none") loadPeople();
                if (w === "some") setTimeout(() => q("#oooSearch").focus(), 30);
                notifyNote(); preview();
            };
            oooDlg._pickNotify = pickNotify;
            oooDlg._resetPeople = () => { picked = new Set(); q("#oooSearch").value = ""; paintList(); paintPicked(); };
            oooDlg.querySelectorAll("[data-notify]").forEach((b) => b.addEventListener("click", () => pickNotify(b.dataset.notify)));

            // ----- what colleagues will see -----
            const workDays = (a, b) => { let n = 0; for (let d = a; d <= b; d = addDays(d, 1)) if (d.getDay() % 6) n++; return n; };
            const preview = () => {
                const { from, to, noEnd, part, start, end } = span();
                const today = startOf(new Date());
                let when;
                if (!from) when = "pick your first day";
                else if (part) {
                    const o = { startUtc: start.toISOString(), untilUtc: end ? end.toISOString() : null };
                    if (noEnd) when = "from " + dayName(start) + ", " + timeName(start) + ", until you turn it off";
                    else if (!to) when = "pick your last day";
                    else when = SN.oooWhenText(o) + " · back " + (isMidnight(end) ? dayName(end) : (+startOf(end) === +startOf(start) ? "at " : dayName(end) + ", ") + timeName(end));
                }
                else if (noEnd) when = +from === +today ? "until you turn it off" : "from " + dayName(from) + ", until you turn it off";
                else if (!to) when = "pick your last day";
                else when = SN.oooRangeText(from, to) + " · back " + dayName((() => { let d = addDays(to, 1); while (!(d.getDay() % 6)) d = addDays(d, 1); return d; })());
                q("#oooPrevWhen").textContent = when;
                const c = q("#oooCount");
                const mins = part && start && end ? Math.round((end - start) / 6e4) : 0;
                if (part && mins > 0 && mins < 24 * 60) {
                    const h = Math.floor(mins / 60), m = mins % 60;
                    c.textContent = (h ? `${h} hour${h === 1 ? "" : "s"}` : "") + (h && m ? " " : "") + (m ? `${m} min` : "");
                } else if (from && to && !noEnd) {
                    const days = Math.round((to - from) / 864e5) + 1, wd = workDays(from, to);
                    c.textContent = `${days} day${days === 1 ? "" : "s"}` + (wd !== days ? ` · ${wd} working day${wd === 1 ? "" : "s"}` : "");
                } else c.textContent = "";
                const m = q("#oooMsg").value.trim();
                q("#oooPrevMsg").textContent = m; q("#oooPrevMsg").hidden = !m;
                const w = oooDlg.dataset.notify, pm = q("#oooPrevMail");
                const all = (people || []).filter((p) => p.hasEmail).length;
                pm.hidden = w === "none" || !canEmail;
                pm.querySelector("span").textContent = w === "all" ? `Email to the whole team${people ? ` (${all} ${all === 1 ? "person" : "people"})` : ""}`
                    : `Email to ${picked.size ? [...picked].map((id) => (people || []).find((p) => p.id === id)?.name).filter(Boolean).slice(0, 3).join(", ") + (picked.size > 3 ? ` and ${picked.size - 3} more` : "") : "nobody yet: pick people above"}`;
                // the footer sums it up
                const fs = q("#oooFootSum");
                if (fs) {
                    const startsNow = from && +from <= +today && (!part || !start || start <= new Date());
                    const n = w === "all" ? all : w === "some" ? picked.size : 0;
                    fs.textContent = (!from ? "Pick your first day" : startsNow ? "Turns on now" : "Starts " + dayName(from))
                        + " · " + (w === "none" || !canEmail ? "no email" : n === 1 ? "1 person gets an email" : n + " people get an email");
                }
            };
            oooDlg._preview = preview;
            q("#oooMsg").addEventListener("input", preview);

            // ----- save -----
            q("#oooForm").addEventListener("submit", async (e) => {
                e.preventDefault();
                const { from, to, noEnd, part, start, end } = span();
                const warn = (t) => Sahyog.toast?.(t, { kind: "warn", title: "Out of office" });
                if (!from) { warn("Pick the first day you're away."); fp("oooFrom")?.open(); return; }
                if (from < startOf(new Date())) { warn("The first day can't be in the past."); return; }
                if (!noEnd && !to) { warn("Pick the last day you're away, or tick “No end date”."); fp("oooTo")?.open(); return; }
                if (to && to < from) { warn("The last day can't be before the first day."); return; }
                if (part && end && end <= start) { warn("“Back at” has to be after “Leave at”."); q("#oooToTime").focus(); return; }
                if (part && end && end <= new Date()) { warn("That time has already passed. Pick a later time."); q("#oooFromTime").focus(); return; }
                const notify = oooDlg.dataset.notify;
                if (notify === "some" && !picked.size && canEmail) { warn("Pick who gets the email, or choose “Don't email”."); return; }
                q("#oooSave").disabled = true;
                try {
                    const r = await Sahyog.saveOutOfOffice({ message: q("#oooMsg").value.trim(), from: isoDay(from), to: to ? isoDay(to) : "", notify, people: [...picked],
                        fromTime: part ? q("#oooFromTime").value : "", toTime: part && to ? q("#oooToTime").value : "" });
                    oooDlg.close();
                    const planned = start > new Date();
                    const range = part ? (noEnd ? "from " + dayName(start) + ", " + timeName(start) : SN.oooWhenText({ startUtc: start.toISOString(), untilUtc: end.toISOString() })) : SN.oooRangeText(from, to);
                    let text = (planned ? "Out of office is planned: " : "Out of office is on: ") + (noEnd ? (planned ? (part ? range : "from " + dayName(from)) + ", until you turn it off" : "until you turn it off") : range) + ".";
                    if (r.mailed) text += ` Email sent to ${r.mailed} ${r.mailed === 1 ? "person" : "people"}.`;
                    Sahyog.toast?.(text, { kind: "success", title: "Out of office" });
                    if (r.mailNote) Sahyog.toast?.(r.mailNote, { kind: "warn", title: "Email" });
                } catch (err) {
                    Sahyog.toast?.(err && err.message || "That didn't work. Try again.", { kind: "error", title: "Out of office" });
                }
                q("#oooSave").disabled = false;
            });
            q("#oooOff").addEventListener("click", async () => {
                const planned = q("#oooOff").dataset.planned === "1";
                try {
                    await Sahyog.setOutOfOffice(false); oooDlg.close();
                    Sahyog.toast?.(planned ? "Your planned out of office is cancelled." : "Welcome back. Out of office is off.", { kind: "success", title: "Out of office" });
                } catch { Sahyog.toast?.("That didn't work. Try again.", { kind: "error" }); }
            });
            // the calendar pops out of the dialog: keep it on top, and close it with the dialog
            oooDlg.addEventListener("close", () => { fp("oooFrom")?.close(); fp("oooTo")?.close(); });
        }
        const q = (s) => oooDlg.querySelector(s);
        const today = startOf(new Date());
        q("#oooMsg").value = cur ? (cur.message || "") : DEFAULT_NOTE;
        const noEndBox = q("#oooNoEnd");
        window.ModernDatePickerWithLabel?._instances?.oooTo?.set("minDate", null);
        if (cur) {
            const r = SN.oooDays(cur);
            const first = r.first < today ? today : r.first;
            noEndBox.checked = !r.last; noEndBox.dispatchEvent(new Event("change"));
            oooDlg._setDay("oooFrom", first); oooDlg._setDay("oooTo", r.last);
        } else {
            noEndBox.checked = false; noEndBox.dispatchEvent(new Event("change"));
            oooDlg._setDay("oooFrom", today); oooDlg._setDay("oooTo", today);
        }
        // saved with hours (e.g. 4:00 pm – 5:00 pm): show them again
        const withHours = !!(cur && SN.oooHasHours(cur));
        q("#oooPart").checked = withHours;
        q("#oooTimes").hidden = !withHours;
        if (withHours) {
            const hm = (iso, fallback) => { if (!iso) return fallback; const d = new Date(iso); return isMidnight(d) ? fallback : `${String(d.getHours()).padStart(2, "0")}:${String(Math.floor(d.getMinutes() / 15) * 15).padStart(2, "0")}`; };
            const started = cur.startUtc && new Date(cur.startUtc) <= new Date();
            oooDlg._setTimes(started || !cur.startUtc ? "00:00" : hm(cur.startUtc, "00:00"), hm(cur.untilUtc, "24:00"));
        }
        oooDlg._resetPeople();
        oooDlg._pickNotify("none");
        oooDlg._sync();
        const planned = !!(cur && cur.startUtc && new Date(cur.startUtc) > new Date());
        q("#oooOff").hidden = !cur;
        q("#oooOff").dataset.planned = planned ? "1" : "";
        q("#oooOff span").textContent = planned ? "Cancel planned out of office" : "I'm back: turn off";
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
    // After a hard refresh the icons and fonts arrive a moment later and the tabs change size and move,
    // so put the highlight (and the side bar) back on the active tab whenever the tabs' layout settles.
    const resettle = () => {
        const a = active();
        if (a) put(rectOf(a), false);
        const bar = window.jQuery && jQuery(rail).data("rr-reposition");
        if (typeof bar === "function") bar(false);
    };
    window.addEventListener("resize", resettle);
    window.addEventListener("load", resettle);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(resettle);
    if ("ResizeObserver" in window) {
        let raf = 0;
        new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(resettle); }).observe(items);
    }

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

/* ---------- Desktop: drag any pop-up window by its header ----------
   Hold the header (title bar) of a window and move it anywhere inside the browser window (never past its edges). Buttons, links and fields in the header still work.
   Double-click the header to put the window back in the middle; it is also back in the middle the next time it opens.
   Phones and tablets keep their bottom-sheet windows, so this is only for a mouse / trackpad on a wide screen. */
(function () {
    "use strict";
    const HEAD = ".sn-dlg-head, .sn-md-head, .sn-about-head, .mb-header";
    const desk = () => window.matchMedia("(pointer: fine) and (min-width: 761px)").matches;
    let drag = null;

    const offsetOf = (dlg) => {
        const t = (dlg.style.translate || "0px 0px").split(" ");
        return { x: parseFloat(t[0]) || 0, y: parseFloat(t[1] || t[0]) || 0 };
    };
    const place = (dlg, x, y) => {
        // the whole window stays inside the browser window (8 px from each edge); a window taller or wider
        // than the browser keeps its top / left edge in view, so its header can always be grabbed
        const r = dlg.getBoundingClientRect(), cur = offsetOf(dlg), m = 8;
        const baseL = r.left - cur.x, baseT = r.top - cur.y;
        const minX = m - baseL, maxX = Math.max(minX, innerWidth - m - r.width - baseL);
        const minY = m - baseT, maxY = Math.max(minY, innerHeight - m - r.height - baseT);
        x = Math.min(Math.max(x, minX), maxX);
        y = Math.min(Math.max(y, minY), maxY);
        dlg.style.translate = Math.round(x) + "px " + Math.round(y) + "px";
    };
    const reset = (dlg) => { dlg.style.translate = ""; dlg.classList.remove("sn-dlg-moved"); };

    document.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || !desk()) return;
        const head = e.target.closest(HEAD);
        const dlg = head && head.closest("dialog[open]");
        if (!dlg || dlg.classList.contains("sn-no-drag")) return;
        if (e.target.closest("button, a, input, textarea, select, label, [role=button], [contenteditable], .sn-close, [data-close]")) return;
        const o = offsetOf(dlg);
        drag = { dlg, head, id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: o.x, oy: o.y, moved: false };
        e.preventDefault();   // no text selection while dragging
        head.setPointerCapture(e.pointerId);
    });
    document.addEventListener("pointermove", (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;   // a click is not a drag
        if (!drag.moved) { drag.moved = true; drag.dlg.classList.add("sn-dlg-dragging", "sn-dlg-moved"); }
        e.preventDefault();
        place(drag.dlg, drag.ox + dx, drag.oy + dy);
    });
    const end = (e) => {
        if (!drag || (e && e.pointerId !== drag.id)) return;
        drag.dlg.classList.remove("sn-dlg-dragging");
        try { drag.head.releasePointerCapture(drag.id); } catch (_) { }
        drag = null;
    };
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
    // double-click the header: back to the middle
    document.addEventListener("dblclick", (e) => {
        const head = e.target.closest(HEAD);
        const dlg = head && head.closest("dialog[open]");
        if (dlg && desk() && !e.target.closest("button, a, input, textarea, select")) reset(dlg);
    });
    // closing a window puts it back in the middle for next time ("close" doesn't bubble, so listen while it travels down)
    document.addEventListener("close", (e) => { if (e.target && e.target.tagName === "DIALOG") reset(e.target); }, true);
    // a smaller window (or a screen change) must not leave a moved window off screen
    window.addEventListener("resize", () => {
        document.querySelectorAll("dialog[open].sn-dlg-moved").forEach((d) => { if (!desk()) reset(d); else { const o = offsetOf(d); place(d, o.x, o.y); } });
    });
})();
