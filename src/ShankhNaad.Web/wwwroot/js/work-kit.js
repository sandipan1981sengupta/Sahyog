// ShankhNaad · small helpers shared by the Work pages and live cards (stand-up, roles, approvals, visitors, away, languages).
(function () {
    "use strict";
    const SN = (window.SN = window.SN || {});
    const S = () => window.Sahyog || {};
    const token = () => (S().antiforgery && S().antiforgery()) || document.querySelector('input[name="__RequestVerificationToken"]')?.value || "";
    const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const initials = (n) => String(n || "?").trim().split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+/u, "")).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
    const ask = (url, method, body) => fetch(url, {
        method, credentials: "same-origin",
        headers: Object.assign({ Accept: "application/json" }, method === "POST" ? { "RequestVerificationToken": token() } : {}, body ? { "Content-Type": "application/json" } : {}),
        body: body ? JSON.stringify(body) : undefined
    }).then((r) => r.json().catch(() => ({})).then((d) => ({ ok: r.ok, status: r.status, d })))
      .catch(() => ({ ok: false, status: 0, d: { error: "No connection. Try again." } }));
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const parseYmd = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };

    // Work section tabs (Views/Work/_WorkHead.cshtml): open the page
    // ---------- Work tabs (Views/Work/_WorkLayout.cshtml) ----------
    // One page. The section the page opened with is drawn by the server; another section is fetched the first time its
    // tab is picked (just that section: header "X-SN-Pane: 1") and then kept, hidden, so coming back to it is instant
    // and keeps your filters and scroll. Back / Forward switch tabs too. Hovering a tab fetches its section early.
    const WORK_TABS = ["decisions", "standup", "approvals", "roles", "visitors"];
    const WORK_INFO = {
        decisions: ["Decisions", "What your team decided, and who's doing what"],
        standup: ["Stand-up", "Three short questions, answered when it suits you"],
        approvals: ["Approvals", "Leave, expenses and purchases, approved in chat"],
        roles: ["Roles", "Message a team or a job, not a person"],
        visitors: ["Visitors", "Who's coming to the office, and who's here"]
    };
    const workHost = () => document.getElementById("workHost");
    const tabOfPath = (path) => { const m = /^\/work(?:\/([a-z]+))?\/?$/i.exec(path || ""); const t = m ? (m[1] || "decisions").toLowerCase() : ""; return WORK_TABS.indexOf(t) >= 0 ? t : ""; };
    const paneOf = (host, id) => host.querySelector(`:scope > .sn-wk-pane[data-pane="${id}"]`);
    const fetching = new Map();                                    // tab → Promise<{ nodes, srcs } | null>

    function fetchPane(id) {
        if (fetching.has(id)) return fetching.get(id);
        const p = fetch("/work/" + id, { credentials: "same-origin", headers: { "X-SN-Pane": "1", "Accept": "text/html" }, cache: "no-store" })
            .then((r) => (r.ok && !r.redirected ? r.text() : ""))
            .then((html) => {
                if (!html) return null;
                const t = document.createElement("template");
                t.innerHTML = html.trim();
                if (!t.content.querySelector(`.sn-wk-pane[data-pane="${id}"]`)) return null;   // signed out, an error page…
                const srcs = [];
                [...t.content.children].forEach((el) => {
                    if (el.matches("script[src]")) { srcs.push(el.getAttribute("src")); el.remove(); }
                });
                return { nodes: [...t.content.childNodes], srcs };
            })
            .catch(() => null);
        fetching.set(id, p);
        p.then((r) => { if (!r) fetching.delete(id); });
        return p;
    }

    function setHead(host, id) {
        const info = WORK_INFO[id] || WORK_INFO.decisions;
        const sub = host.querySelector(".sn-head .hdr-subtitle");
        if (sub) sub.textContent = info[1];
        const tail = document.title.indexOf(" · "); document.title = info[0] + (tail >= 0 ? document.title.slice(tail) : " · ShankhNaad");
        document.querySelector(".sn-topbar")?.querySelectorAll("[data-sn-page-title]").forEach((el) => { el.textContent = info[0]; });
    }
    function markTab(id) {
        // Back / Forward: move the tab highlight (its "select" comes back to showWork, which sees the tab is already on show)
        const $ = window.jQuery;
        if (!$) return;
        const $w = $("#workTabs"), api = ($w.hasClass("tab-control-wrapper") ? $w : $w.find(".tab-control-wrapper")).data("tc-api") || $w.data("tc-api");
        if (api && api.getActive()?.id !== id) api.select(id);
    }

    let showing = 0, hoverT = 0;
    async function showWork(id, opts) {
        opts = opts || {};
        const host = workHost();
        if (!host || WORK_TABS.indexOf(id) < 0) return false;
        const from = host.dataset.tab || "";
        if (from === id && paneOf(host, id) && !paneOf(host, id).hidden) return true;
        const my = ++showing;
        const dir = WORK_TABS.indexOf(id) > WORK_TABS.indexOf(from) ? "next" : "prev";
        let pane = paneOf(host, id);
        let wait = null;
        if (!pane) {
            // a light placeholder while the section comes (only if it takes a moment)
            const t = setTimeout(() => {
                if (my !== showing || paneOf(host, id)) return;
                wait = document.createElement("div");
                wait.className = "sn-wk-pane sn-wk-pane-wait glass";
                wait.innerHTML = '<span aria-label="Loading"></span>';
                host.querySelectorAll(":scope > .sn-wk-pane").forEach((p) => { p.hidden = true; });
                host.appendChild(wait);
            }, 120);
            const got = await fetchPane(id);
            clearTimeout(t);
            if (wait) wait.remove();
            if (!host.isConnected) return true;                     // left the page meanwhile
            if (my !== showing) return true;                        // another tab was picked meanwhile
            if (!got) { location.href = "/work/" + id; return true; }
            pane = paneOf(host, id);
            if (!pane) {
                fetching.delete(id);
                const nodes = got.nodes;
                host.querySelectorAll(":scope > .sn-wk-pane").forEach((p) => { p.hidden = true; });
                nodes.forEach((n) => host.appendChild(n));
                pane = paneOf(host, id);
                host.dataset.tab = id;                              // before its script runs (it may read the address)
                if (!opts.fromPop) SN.nav?.paneUrl ? SN.nav.paneUrl("/work/" + id, true) : history.pushState(history.state, "", "/work/" + id);
                const ok = SN.nav?.mount ? await SN.nav.mount(nodes, got.srcs) : false;
                if (!ok && !SN.nav?.mount) { location.href = "/work/" + id; return true; }
            }
        }
        if (my !== showing) return true;
        host.querySelectorAll(":scope > .sn-wk-pane").forEach((p) => { if (p !== pane) p.hidden = true; });
        pane.hidden = false;
        pane.classList.remove("sn-wk-in", "from-next", "from-prev");
        void pane.offsetWidth;
        pane.classList.add("sn-wk-in", "from-" + dir);
        host.dataset.tab = id;
        host.classList.toggle("sn-page-fixed", id === "standup");
        host.scrollTop = 0;
        setHead(host, id);
        markTab(id);
        if (!opts.fromPop && location.pathname.toLowerCase() !== "/work/" + id) {
            SN.nav?.paneUrl ? SN.nav.paneUrl("/work/" + id, true) : history.pushState(history.state, "", "/work/" + id);
        }
        document.dispatchEvent(new CustomEvent("sn:worktab", { detail: { tab: id } }));
        return true;
    }
    SN.workTab = showWork;

    if (window.jQuery) jQuery(document).on("tabcontrol:select", "#workTabs", (e, id) => {
        if (!workHost()) { SN.go ? SN.go("/work/" + id) : (location.href = "/work/" + id); return; }
        clearTimeout(hoverT);
        showWork(id);
    });
    // Back / Forward between Work tabs (js/sn-nav.js asks first)
    if (window.SN && SN.nav) SN.nav.onPop = (u) => {
        const id = tabOfPath(u.pathname);
        if (!id || u.search || !workHost()) return false;
        showWork(id, { fromPop: true });
        return true;
    };
    // fetch a section early when the pointer rests on its tab
    document.addEventListener("pointerover", (e) => {
        const t = e.target.closest?.("#workTabs [data-tab-id]");
        if (!t) return;
        const id = t.getAttribute("data-tab-id"), host = workHost();
        if (!host || WORK_TABS.indexOf(id) < 0 || paneOf(host, id)) return;
        clearTimeout(hoverT);
        hoverT = setTimeout(() => { const h = workHost(); if (h && !paneOf(h, id)) fetchPane(id); }, 80);
    });
    // leaving the Work page (or reloading it) starts fresh
    document.addEventListener("sn:page", () => fetching.clear());

    // ---------- the day pill's calendar (‹ Today ›): a tag-helper date picker kept hidden in the view
    // (<div class="sn-daypick"><modern-datepicker-with-label …></div>), opened under the middle button.
    function dayPick(id, anchor, o) {
        const input = document.getElementById(id);
        const fp = input && window.ModernDatePickerWithLabel?._instances?.[id];
        if (!fp || !anchor) return false;
        const box = input.closest(".sn-daypick") || input.parentElement;
        // put the (invisible) field exactly over the button, so the calendar opens under it
        const r = anchor.getBoundingClientRect();
        Object.assign(box.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
        const b = box.getBoundingClientRect();
        if (Math.abs(b.left - r.left) > 1 || Math.abs(b.top - r.top) > 1) { box.style.left = (2 * r.left - b.left) + "px"; box.style.top = (2 * r.top - b.top) + "px"; }
        try { fp.set("minDate", o.min ? parseYmd(o.min) : null); fp.set("maxDate", o.max ? parseYmd(o.max) : null); } catch { }
        fp.setDate(parseYmd(o.value) || new Date(), false);
        input._snPick = o.onPick;
        if (!input._snWired) {
            input._snWired = true;
            fp.config.onChange.push((dates) => { const f = input._snPick; if (dates && dates[0] && f) f(ymd(dates[0])); });
            fp.config.onClose.push(() => { document.querySelectorAll("[data-dp-open][aria-expanded='true']").forEach((x) => x.setAttribute("aria-expanded", "false")); });
        }
        anchor.setAttribute("aria-expanded", "true");
        fp.open();
        return true;
    }
    /** The day pill: ‹ [Today] › — the middle opens the calendar. key = what the page calls this pill (data-dp-open). */
    const dayPill = (key, day, today, opts) => {
        opts = opts || {};
        const label = day === today ? "Today" : SN.wk.day(day);
        const nextOff = opts.max && day >= opts.max;
        return `<div class="sn-wk-daynav sn-daypill" data-daypill="${key}">
            <button type="button" class="sn-dp-arrow" data-${opts.attr || "day"}="-1" aria-label="Day before"><i class="bi bi-chevron-left" aria-hidden="true"></i></button>
            <button type="button" class="sn-dp-mid" data-dp-open="${key}" aria-haspopup="dialog" aria-expanded="false" title="Pick a day"><span>${esc(label)}</span></button>
            <button type="button" class="sn-dp-arrow" data-${opts.attr || "day"}="1" aria-label="Next day"${nextOff ? " disabled" : ""}><i class="bi bi-chevron-right" aria-hidden="true"></i></button>
        </div>`;
    };

    SN.wk = {
        dayPick, dayPill,
        esc, initials, token, ymd, parseYmd,
        get: (url) => ask(url, "GET"),
        post: (url, body) => ask(url, "POST", body),
        toast: (text, kind, title, extra) => S().toast?.(text, Object.assign({ kind: kind || "info", title }, extra || {})),
        /** A round avatar (tone 0–5 like the rest of the app). */
        avatar: (name, tone, id, size) => `<span class="avatar av-${size || 28} tone-${(Number(tone) || 0) % 6}"${id ? ` data-user="${esc(id)}"` : ""}>${esc(initials(name))}</span>`,
        /** "Tue 24 Nov" */
        day: (d) => { d = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? parseYmd(d) : new Date(d); return isNaN(d) ? "" : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }); },
        time: (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); },
        /** "5 min ago", "2 h ago", "Tue" */
        ago: (iso) => {
            const s = (Date.now() - new Date(iso)) / 1000;
            if (s < 60) return "just now";
            if (s < 3600) return Math.floor(s / 60) + " min ago";
            if (s < 86400) return Math.floor(s / 3600) + " h ago";
            return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
        },
        /** A glass window (one per class), shown modal. Returns the <dialog>. */
        dialog(cls, html) {
            let d = document.querySelector(`dialog.${cls.split(" ")[0]}`);
            if (!d) { d = document.createElement("dialog"); d.className = `sn-dialog glass-strong sn-wk-dlg ${cls}`; document.body.appendChild(d); }
            d.innerHTML = html;
            d.onclick = null; d.onchange = null; d.oninput = null;
            d.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) d.close(); });
            if (!d.open) d.showModal();
            return d;
        },
        /** The standard window head. */
        head: (icon, title, sub, cls) => `<div class="sn-dlg-head"><div class="sn-dlg-title"><span class="sn-dlg-icon sn-wk-ic ${cls || ""}" aria-hidden="true"><i class="fa ${icon}"></i></span>
            <div><h2>${esc(title)}</h2>${sub ? `<p>${sub}</p>` : ""}</div></div>
            <button type="button" class="sn-close" data-close aria-label="Close"><i class="fa fa-times" aria-hidden="true"></i></button></div>`,
        /** A searchable person picker (single). Calls onPick(person). people: [{id,name,dept,title,tone}] */
        personPicker(box, people, selected, onPick, placeholder) {
            const st = { q: "", sel: selected || null };
            const paint = () => {
                const p = people.find((x) => x.id === st.sel);
                if (p && !st.open) {
                    box.innerHTML = `<div class="sn-nir-who">${SN.wk.avatar(p.name, p.tone)}<span><b>${esc(p.name)}</b><small>${esc([p.title, p.dept].filter(Boolean).join(" · "))}</small></span><button type="button" class="sn-link" data-pp-change>Change</button></div>`;
                    return;
                }
                const q = st.q.toLowerCase();
                const hits = people.filter((x) => !q || (x.name + " " + (x.dept || "") + " " + (x.title || "")).toLowerCase().includes(q)).slice(0, 7);
                box.innerHTML = `<label class="sn-nir-search"><i class="fa fa-search" aria-hidden="true"></i><input type="search" data-pp-q placeholder="${esc(placeholder || "Type a name")}" value="${esc(st.q)}" autocomplete="off"></label>
                    <div class="sn-nir-hits sn-glass-scroll">${hits.map((x) => `<button type="button" class="sn-nir-hit" data-pp="${esc(x.id)}">${SN.wk.avatar(x.name, x.tone)}<span><b>${esc(x.name)}</b><small>${esc([x.title, x.dept].filter(Boolean).join(" · "))}</small></span></button>`).join("") || '<p class="muted small" style="padding:8px">Nobody matches.</p>'}</div>`;
                const qi = box.querySelector("[data-pp-q]");
                if (st.open) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
            };
            box.onclick = (e) => {
                if (e.target.closest("[data-pp-change]")) { st.open = true; st.q = ""; paint(); return; }
                const b = e.target.closest("[data-pp]");
                if (b) { st.sel = b.dataset.pp; st.open = false; paint(); onPick && onPick(people.find((x) => x.id === st.sel)); }
            };
            box.oninput = (e) => { if (e.target.matches("[data-pp-q]")) { st.q = e.target.value; st.open = true; paint(); } };
            box.onkeydown = (e) => { if (e.key === "Enter" && e.target.matches("[data-pp-q]")) { e.preventDefault(); box.querySelector("[data-pp]")?.click(); } };
            paint();
            return { get value() { return st.sel; } };
        },
        /** The tag-helper controls (Views/…: modern-input, modern-dropdown-with-label, modern-datepicker-with-label,
         *  modern-checkbox, modern-radio-group): start them in a part added later, read and set them by id. */
        ctl: {
            init(root) {
                const $ = window.jQuery;
                ["ModernInput", "ModernDropdownWithLabel", "ModernDatePickerWithLabel", "ModernRadio", "ModernCheckbox"].forEach((n) => {
                    const c = window[n];
                    if (c && typeof c.init === "function") { try { c.init($ ? $(root) : root); } catch (e) { console.error(e); } }
                });
            },
            /** yyyy-mm-dd ⇄ the date picker's dd-mm-yyyy */
            toDmy: (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? `${m[3]}-${m[2]}-${m[1]}` : ""; },
            toIso: (dmy) => { const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec((dmy || "").trim()); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : ""; },
            get(id) {
                const dd = document.getElementById(id + "_value");
                if (dd) return dd.value || "";
                const el = document.getElementById(id);
                if (!el) return "";
                if (el.type === "checkbox") return el.checked;
                if (el.classList.contains("mdpwl-input")) return SN.wk.ctl.toIso(el.value);
                return (el.value || "").trim();
            },
            set(id, v) {
                const el = document.getElementById(id);
                if (!el) return;
                if (el.classList.contains("modern-dropdown-with-label")) {
                    if (v == null || v === "") { window.clearModernDropdownWithLabel ? clearModernDropdownWithLabel("#" + id) : null; }
                    else if (!(window.setModernDropdownWithLabelValue && setModernDropdownWithLabelValue("#" + id, v))) window.clearModernDropdownWithLabel?.("#" + id);
                    return;
                }
                if (el.type === "checkbox") { window.setModernCheckboxValue ? setModernCheckboxValue("#" + id, !!v) : (el.checked = !!v); return; }
                if (el.classList.contains("mdpwl-input")) {
                    if (!v) { window.clearModernDatePickerWithLabel ? clearModernDatePickerWithLabel("#" + id) : (el.value = ""); }
                    else window.setModernDatePickerWithLabelValue ? setModernDatePickerWithLabelValue("#" + id, SN.wk.ctl.toDmy(v)) : (el.value = SN.wk.ctl.toDmy(v));
                    return;
                }
                if (window.setModernInputValue) setModernInputValue("#" + id, v == null ? "" : v); else el.value = v == null ? "" : v;
            },
            radio: (name) => (document.querySelector(`input[type="radio"][name="${name}"]:checked`) || {}).value || "",
            setRadio(name, v) {
                if (window.setModernRadioGroupValue) setModernRadioGroupValue(name, v);
                else { const r = document.querySelector(`input[type="radio"][name="${name}"][value="${v}"]`); if (r) r.checked = true; }
            },
            /** Replace a dropdown's choices: items [{ value, text }] */
            options(id, items, selected) { window.setModernDropdownWithLabelData?.("#" + id, items, selected); },
            /** The label text of a control (keeps the red * of a required one). */
            label(id, text) {
                const l = document.querySelector(`label[for="${id}"]`);
                if (!l) return;
                const t = [...l.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
                if (t) t.textContent = text + " "; else l.insertBefore(document.createTextNode(text + " "), l.firstChild);
            },
            /** Show a Razor window: back in the middle of the screen, then open. */
            open(dlg) {
                if (!dlg) return;
                dlg.style.translate = "";
                if (!dlg.open) dlg.showModal();
            },
            /** Clicks on [data-close] close it (once per window). */
            wire(dlg) {
                if (!dlg || dlg.__wired) return;
                dlg.__wired = true;
                dlg.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) dlg.close(); });
            }
        },
        /** A count on a tab of a tab-control (the glass tabs): tabBadge("apTabs", "todo", 3). 0 hides it unless keep. */
        tabBadge(ctlId, tabId, n, keep, kind, tries) {
            const t = document.querySelector(`#${ctlId} .tc-tab[data-tab-id="${tabId}"]`);
            if (!t) {
                // the tab-control builds its tabs when the page is ready: try again shortly
                if (document.getElementById(ctlId) && (tries || 0) < 25) setTimeout(() => SN.wk.tabBadge(ctlId, tabId, n, keep, kind, (tries || 0) + 1), 80);
                return;
            }
            let b = t.querySelector(".tc-badge");
            if (!n && !keep) { b?.remove(); }
            else {
                if (!b) { b = document.createElement("span"); t.appendChild(b); }
                b.className = "tc-badge" + (kind ? " " + kind : "");
                b.textContent = n > 99 ? "99+" : String(n || 0);
            }
            clearTimeout(SN.wk._tcT);
            SN.wk._tcT = setTimeout(() => window.jQuery && jQuery(window).trigger("resize"), 30);    // the sliding pill follows the new width
        },
        /** fn(tabId) when a tab of that tab-control is picked. */
        onTab(ctlId, fn) {
            const el = document.getElementById(ctlId);
            if (el && window.jQuery) jQuery(el).on("tabcontrol:select", (e, id) => fn(id));
        },
        /** Pick a tab from code (e.g. ?tab=mine). */
        pickTab(ctlId, tabId) {
            const go = () => { const t = document.querySelector(`#${ctlId} .tc-tab[data-tab-id="${tabId}"]`); if (t) { t.click(); return true; } return false; };
            if (!go()) setTimeout(go, 120);
        },
        /** A count on a Work section tab (Roles, Approvals …). */
        badge(key, n) { SN.wk.tabBadge("workTabs", key, n, false, n ? "bad" : ""); }
    };
})();
