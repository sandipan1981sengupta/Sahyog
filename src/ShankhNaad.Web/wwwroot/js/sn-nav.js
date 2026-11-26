// ShankhNaad · partial page loads ("instant" page changes, like Teams or Gmail).
//
// Clicking a link (left rail, a chat, a tab…) or sending a form no longer reloads the whole page.
// The new page is fetched in the background and only its middle part (.sn-body-row) is swapped in.
// The rail, the top bar, the live connection (calls, messages, presence), styles and scripts stay.
// The page change looks exactly as before:
//   Edge / Chrome   → the same view transition (slide, rail highlight glide), now within the page
//   Safari, Firefox → the same CSS slide-out / slide-in
// and then the same staged arrival (cards rise, rows fade in).
//
// Each page's own scripts still run as if the page had just loaded. Everything they hook onto the
// window, the document, the live connection or a timer belongs to that page (a "page scope") and is
// removed when you leave it, exactly as a full page load would have thrown it away.
//
// Loaded in <head> of _Layout (and _AuthLayout, where it only provides SN.onPage).
(function () {
    "use strict";
    if (window.SN && window.SN.nav) return;
    const SN = (window.SN = window.SN || {});
    const root = document.documentElement;

    // =====================================================================
    // 1. Page scopes
    // =====================================================================
    let cur = null;                               // the page whose code is running right now
    function Scope(loaded) {
        this.loaded = loaded;                     // false only for the page the browser loaded itself
        this.listeners = []; this.jq = []; this.hub = []; this.observers = [];
        this.timers = new Set(); this.intervals = new Set();
        this.dead = false;
    }
    function run(scope, fn, self, args) {
        const prev = cur; cur = scope;
        try { return fn.apply(self, args); } finally { cur = prev; }
    }
    const wrapIn = (scope, fn) => function () { if (scope.dead) return; return run(scope, fn, this, arguments); };

    // --- event listeners (window, document, elements, media queries…) ---
    const ET = EventTarget.prototype, addEL = ET.addEventListener, remEL = ET.removeEventListener;
    const byListener = new WeakMap();
    const capOf = (o) => (typeof o === "boolean" ? o : !!(o && o.capture));
    ET.addEventListener = function (type, listener, options) {
        const s = cur;
        if (!s || !listener) return addEL.call(this, type, listener, options);
        const target = this;
        // "when the page has loaded" asked by a page that arrived without a page load: run it now (soon)
        if (s.loaded && ((type === "DOMContentLoaded" && target === document) || (type === "load" && target === window))) {
            window.setTimeout(() => {
                const ev = new Event(type);
                typeof listener === "function" ? listener.call(target, ev) : listener.handleEvent(ev);
            }, 0);
            return;
        }
        const fn = typeof listener === "function" ? listener : function (e) { return listener.handleEvent(e); };
        const rec = { t: target, type, cap: capOf(options), w: wrapIn(s, fn) };
        let list = byListener.get(listener);
        if (!list) byListener.set(listener, (list = []));
        list.push(rec);
        s.listeners.push(rec);
        return addEL.call(target, type, rec.w, options);
    };
    ET.removeEventListener = function (type, listener, options) {
        const list = listener && byListener.get(listener);
        if (list) {
            const cap = capOf(options);
            for (let i = list.length - 1; i >= 0; i--) {
                const r = list[i];
                if (r.t === this && r.type === type && r.cap === cap) { remEL.call(this, type, r.w, options); list.splice(i, 1); }
            }
        }
        return remEL.call(this, type, listener, options);
    };

    // --- timers ---
    const sT = window.setTimeout, cT = window.clearTimeout, sI = window.setInterval, cI = window.clearInterval;
    const rAF = window.requestAnimationFrame;
    window.setTimeout = function (fn, ms) {
        const s = cur, args = Array.prototype.slice.call(arguments, 2);
        if (!s || typeof fn !== "function") return sT.apply(window, arguments);
        let id = 0;
        id = sT(function () { s.timers.delete(id); if (!s.dead) run(s, fn, window, args); }, ms);
        s.timers.add(id);
        return id;
    };
    window.setInterval = function (fn, ms) {
        const s = cur, args = Array.prototype.slice.call(arguments, 2);
        if (!s || typeof fn !== "function") return sI.apply(window, arguments);
        const id = sI(function () { if (!s.dead) run(s, fn, window, args); }, ms);
        s.intervals.add(id);
        return id;
    };
    if (rAF) window.requestAnimationFrame = function (fn) {
        const s = cur;
        if (!s || typeof fn !== "function") return rAF.call(window, fn);
        return rAF.call(window, function (t) { if (!s.dead) run(s, fn, window, [t]); });
    };

    // --- observers (MutationObserver, ResizeObserver, IntersectionObserver) ---
    ["MutationObserver", "ResizeObserver", "IntersectionObserver"].forEach((name) => {
        const C = window[name];
        if (!C || !C.prototype.observe) return;
        const observe = C.prototype.observe;
        C.prototype.observe = function () { if (cur) cur.observers.push(this); return observe.apply(this, arguments); };
    });

    // --- jQuery handlers and $(fn) (patched as soon as jQuery is there) ---
    function patchJQ() {
        const $ = window.jQuery;
        if (!$ || $.__snPatched || !$.event) return;
        $.__snPatched = true;
        const add = $.event.add;
        $.event.add = function (elem, types, handler, data, selector) {
            const s = cur;
            if (s && typeof handler === "function") {
                if (!handler.guid) handler.guid = $.guid++;
                const w = wrapIn(s, handler);
                w.guid = handler.guid;                    // .off(original) still finds it
                s.jq.push([elem, types, w, selector]);
                return add.call(this, elem, types, w, data, selector);
            }
            return add.apply(this, arguments);
        };
        const ready = $.fn.ready;
        $.fn.ready = function (fn) { return ready.call(this, cur && typeof fn === "function" ? wrapIn(cur, fn) : fn); };
    }

    // --- live connection handlers (SignalR hub.on) ---
    function patchHub() {
        const hub = window.Sahyog && window.Sahyog.hub;
        if (!hub || hub.__snPatched) return;
        hub.__snPatched = true;
        const on = hub.on.bind(hub), off = hub.off.bind(hub);
        hub.on = function (name, fn) {
            const s = cur;
            if (!s || typeof fn !== "function") return on(name, fn);
            const w = wrapIn(s, fn);
            s.hub.push([name, w]);
            return on(name, w);
        };
        hub.__snOff = off;
        // calls to the server belong to the connection, not to the page (its keep-alive timers must survive a page change)
        ["invoke", "send", "stream", "start", "stop"].forEach((m) => {
            if (typeof hub[m] === "function") hub[m] = nav.unscoped(hub[m].bind(hub));
        });
    }

    function kill(s) {
        if (!s || s.dead) return;
        s.dead = true;
        s.listeners.forEach((r) => { try { remEL.call(r.t, r.type, r.w, { capture: r.cap }); } catch (e) { } });
        const $ = window.jQuery;
        if ($ && $.event) s.jq.forEach((a) => { try { $.event.remove(a[0], a[1], a[2], a[3]); } catch (e) { } });
        const hub = window.Sahyog && window.Sahyog.hub;
        if (hub) s.hub.forEach(([n, w]) => { try { (hub.__snOff || hub.off.bind(hub))(n, w); } catch (e) { } });
        s.timers.forEach((id) => cT(id));
        s.intervals.forEach((id) => cI(id));
        s.observers.forEach((o) => { try { o.disconnect(); } catch (e) { } });
        s.listeners = []; s.jq = []; s.hub = []; s.observers = [];
    }

    let page = null;                              // the page on screen now
    const nav = (SN.nav = {});
    /** Runs fn outside any page (for things that must outlive the page, like toasts). */
    nav.unscoped = (fn) => function () {
        const prev = cur; cur = null;
        try { return fn.apply(this, arguments); } finally { cur = prev; }
    };
    // markers written by _Layout around the page's own markup and scripts
    nav.begin = () => { patchJQ(); patchHub(); page = page || new Scope(false); cur = page; };
    nav.pause = () => { cur = null; };
    nav.resume = () => { patchJQ(); patchHub(); page = page || new Scope(false); cur = page; };
    nav.endSync = () => { cur = null; };
    addEL.call(window, "load", () => { if (page) page.loaded = true; });

    // =====================================================================
    // 2. SN.onPage(fn): layout code that has to set up each page (dialogs, filters, Details panel…)
    //    Runs once when the page loads, and again after every partial page change.
    // =====================================================================
    const pageFns = [];
    let firstDone = false;
    SN.onPage = (fn) => {
        pageFns.push(fn);
        if (firstDone) { try { run(page, fn, window, []); } catch (e) { console.error(e); } }
    };
    const runPageFns = () => pageFns.forEach((fn) => { try { run(page, fn, window, []); } catch (e) { console.error(e); } });
    addEL.call(document, "DOMContentLoaded", () => {
        patchJQ(); patchHub();
        page = page || new Scope(false);
        firstDone = true;
        runPageFns();
    });

    // =====================================================================
    // 3. Which addresses load partially
    // =====================================================================
    const PAGE_RE = /^\/(?:|chat(?:\/[0-9a-f-]{36})?|calls|files|meetings|team|org|admin|work(?:\/(?:decisions|standup|approvals|roles|visitors))?)\/?$/i;
    const PREFETCH_RE = /^\/(?:chat|calls|files|meetings|team|org|admin|work(?:\/(?:decisions|standup|approvals|roles|visitors))?)\/?$/i;
    const hasShell = () => !!document.querySelector(".sn-body-row") && !!document.getElementById("sn-page-scripts");
    const toUrl = (u) => (u instanceof URL ? u : new URL(u, location.href));
    nav.canGo = (u) => {
        u = toUrl(u);
        return hasShell() && u.origin === location.origin && PAGE_RE.test(u.pathname);
    };
    const reduce = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const useVT = () => !!document.startViewTransition && !root.classList.contains("sn-no-vt") && !reduce();

    // =====================================================================
    // 4. Fetching a page
    // =====================================================================
    const prefetched = new Map();                 // href → { at, promise }
    async function fetchPage(u, opts, signal) {
        const res = await fetch(u.href, {
            method: opts.method || "GET",
            body: opts.body || undefined,
            headers: { "X-SN-Nav": "1", "Accept": "text/html" },
            credentials: "same-origin",
            cache: "no-store",
            signal
        });
        // the server turns redirects into a header for these requests (see Program.cs)
        const redirect = res.headers.get("X-SN-Redirect");
        if (redirect) {
            const r = new URL(redirect, u);
            if (opts.hash && !r.hash) r.hash = opts.hash;
            if (!nav.canGo(r)) return { full: r.href };
            return fetchPage(r, { hash: r.hash }, signal);
        }
        const type = res.headers.get("content-type") || "";
        if (!type.includes("text/html")) return opts.method === "POST" ? { error: true } : { full: u.href };
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        const finalUrl = new URL(res.url || u.href);
        if (opts.hash && !finalUrl.hash) finalUrl.hash = opts.hash;
        if (u.hash && !finalUrl.hash) finalUrl.hash = u.hash;
        if (!doc.querySelector(".sn-body-row") || !doc.getElementById("sn-page-scripts"))
            return opts.method === "POST" ? { html } : { full: finalUrl.href };
        // a form answered with a page straight away (e.g. it shows what to fix): stay on this address
        if (opts.method === "POST") return { doc, url: location.href, ok: res.ok, stay: true };
        return { doc, url: finalUrl.href, ok: res.ok };
    }
    function prefetch(u) {
        const key = u.href, hit = prefetched.get(key);
        if (hit && Date.now() - hit.at < 10000) return;
        const promise = fetchPage(u, {}, undefined).catch(() => null);
        prefetched.set(key, { at: Date.now(), promise });
    }

    // scripts: page scripts are fetched as text and run in their page; libraries load once
    const LIB_RE = /^\/(?:lib|js\/web-control)\//i;
    const scriptText = new Map();
    let libs = null;                              // libraries already in this window (kept across page changes)
    const loadedSrc = () => {
        if (!libs) libs = new Set();
        [...document.scripts].forEach((s) => { if (s.src) libs.add(new URL(s.src).pathname.toLowerCase()); });
        return libs;
    };
    function getText(src) {
        if (!scriptText.has(src)) scriptText.set(src, fetch(src, { credentials: "same-origin" }).then((r) => (r.ok ? r.text() : "")).catch(() => ""));
        return scriptText.get(src);
    }
    function loadLib(src) {
        return new Promise((resolve) => {
            const s = document.createElement("script");
            s.src = src; s.async = false;
            s.onload = s.onerror = () => resolve();
            nav.unscoped(() => document.head.appendChild(s))();
        });
    }
    const isCode = (s) => !s.type || /^(text|application)\/(javascript|ecmascript)$|^module$/i.test(s.type);
    // a fresh <script> runs when inserted; one copied from a parsed page would not
    function runInline(code, holder, label, before) {
        const s = document.createElement("script");
        s.text = code + (label ? "\n//# sourceURL=" + label : "");
        if (before) holder.insertBefore(s, before); else holder.appendChild(s);
    }

    // =====================================================================
    // 5. Swapping a page in
    // =====================================================================
    const sleep = (ms) => new Promise((r) => sT(r, ms));
    const nextFrame = () => new Promise((r) => (rAF ? rAF.call(window, () => r()) : sT(r, 16)));
    let seq = 0, ctrl = null, shown = location.pathname + location.search;

    function scrollState(row) {
        const out = [];
        row.querySelectorAll("*").forEach((el, i) => { if (el.scrollTop > 0) out.push([el.id || "", el.className || "", i, el.scrollTop]); });
        return out;
    }
    function restoreScroll(row, state) {
        const all = row.querySelectorAll("*");
        state.forEach(([id, cls, i, top]) => {
            const el = (id && document.getElementById(id)) || (all[i] && all[i].className === cls ? all[i] : null);
            if (el) el.scrollTop = top;
        });
    }

    async function swap(res, opts, prep) {
        const row = document.querySelector(".sn-body-row");
        const doc = res.doc;
        const quiet = !!opts.quiet;
        const keepScroll = quiet ? scrollState(row) : null;

        // the page we are leaving: everything it hooked onto is removed
        kill(page);
        page = new Scope(true);

        // address, title, page-specific classes on <body>
        const url = new URL(res.url);
        if (opts.push === false) history.replaceState({ sn: 1 }, "", url.href);
        else history.pushState({ sn: 1 }, "", url.href);
        shown = url.pathname + url.search;
        document.title = doc.title;
        document.body.className = doc.body.className;
        root.removeAttribute("data-arrived");

        // the new middle part
        const fresh = doc.querySelector(".sn-body-row");
        const nodes = [...fresh.childNodes].map((n) => document.adoptNode(n));
        row.replaceChildren(...nodes);
        if (!quiet) { row.scrollTop = 0; document.querySelector(".sn-page")?.scrollTo?.(0, 0); }

        // left rail: the new page's tab is the active one
        SN.railSync?.(doc, !opts.vt);

        cur = page;
        try {
            // 1) scripts inside the page markup (control set-up written by the tag helpers)
            row.querySelectorAll("script").forEach((old) => {
                if (old.hasAttribute("data-sn-skip") || !isCode(old)) return;
                const code = old.src ? null : old.textContent;
                if (code !== null) { const holder = old.parentNode; runInline(code, holder, null, old); old.remove(); }
            });
            // 2) layout code that sets up every page
            runPageFns();
            // 3) the page's own scripts (@section Scripts), in order
            const holder = document.getElementById("sn-page-scripts");
            holder.replaceChildren();
            for (const item of prep.scripts) {
                if (item.lib) continue;                     // already loaded before the swap
                runInline(item.code, holder, item.label);
            }
            // 4) controls in the new part (on a full load their own "page ready" code does this)
            const $ = window.jQuery;
            ["ModernTable", "ModernInput", "ModernDropdownWithLabel", "ModernDatePickerWithLabel",
             "ModernRadio", "ModernCheckbox", "TabControl", "ModernDonutChart"].forEach((name) => {
                const c = window[name];
                if (c && typeof c.init === "function") { try { c.init($ ? $(row) : row); } catch (e) { console.error(e); } }
            });
            if (row.querySelector(".mb-overlay.mb-visible")) document.body.style.overflow = "hidden";
        } finally { cur = null; }

        window.Sahyog?.paintPhotos?.(row);
        window.Sahyog?.paintPresence?.();
        window.Sahyog?.paintUnread?.();
        document.querySelector(".sn-topbar")?.querySelectorAll("[data-sn-page-title]").forEach((el) => { el.textContent = doc.title; });

        if (quiet) {
            restoreScroll(row, keepScroll);
            root.setAttribute("data-arrived", "1");
            document.dispatchEvent(new Event("sn:arrived"));
        }
        if (url.hash) { try { document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView(); } catch (e) { } }
        document.dispatchEvent(new CustomEvent("sn:page", { detail: { url: url.href } }));
    }

    // gets the page's scripts ready before the swap (so the swap itself is instant)
    async function prepare(doc) {
        const list = [...doc.getElementById("sn-page-scripts").querySelectorAll("script")].filter(isCode);
        const have = loadedSrc();
        const out = [];
        for (const s of list) {
            const src = s.getAttribute("src");
            if (!src) { out.push({ code: s.textContent }); continue; }
            const u = new URL(src, location.href);
            const path = u.pathname.toLowerCase();
            if (u.origin !== location.origin || LIB_RE.test(u.pathname)) {
                if (!have.has(path)) { await loadLib(u.href); have.add(path); await sleep(20); }   // let its own start-up finish
                out.push({ lib: true });
                continue;
            }
            out.push({ code: await getText(u.href), label: u.pathname });
        }
        return { scripts: out };
    }

    /**
     * Goes to a page without reloading. opts:
     *   push (default true) · dir "next" | "prev" (slide direction) · quiet (refresh in place, no animation)
     *   method "POST" + body (FormData) · minLeave (ms the old page takes to leave) · hash (keep #part after a form post)
     */
    async function navigate(href, opts) {
        opts = opts || {};
        const u = toUrl(href);
        if (opts.method !== "POST" && !nav.canGo(u)) { location.assign(u.href); return; }
        const my = ++seq;
        if (ctrl) ctrl.abort();
        ctrl = new AbortController();
        const signal = ctrl.signal;

        const quiet = !!opts.quiet;
        const vt = !quiet && useVT();
        const leaving = !quiet && !vt && !reduce();
        const dir = opts.dir || "";
        if (leaving) {
            root.classList.add("sn-leaving");
            if (dir) root.classList.add("sn-leaving-" + dir);
        }

        let res;
        try {
            const hit = !opts.method && prefetched.get(u.href);
            const p = hit && Date.now() - hit.at < 10000 ? hit.promise : fetchPage(u, opts, signal);
            prefetched.delete(u.href);
            const wait = leaving ? sleep(Math.max(opts.minLeave || 0, 240)) : Promise.resolve();
            res = await p;
            if (!res && hit) res = await fetchPage(u, opts, signal);
            if (my !== seq) return;
            if (res && res.doc) res.prep = await prepare(res.doc);
            await wait;
        } catch (e) {
            if (e && e.name === "AbortError") return;
            res = null;
        }
        if (my !== seq) return;
        if (res && res.stay) opts = Object.assign({}, opts, { push: false });

        const undoLeave = () => root.classList.remove("sn-leaving", "sn-leaving-next", "sn-leaving-prev");
        if (!res || res.error) {
            undoLeave();
            if (opts.method === "POST") window.Sahyog?.toast?.("That didn't go through. Check your connection and try again.", { kind: "error" });
            else location.assign(u.href);
            return;
        }
        if (res.full) { location.assign(res.full); return; }
        if (res.html) {                                   // a form answered with a page of another kind
            document.open(); document.write(res.html); document.close();
            return;
        }

        if (quiet) { root.classList.add("sn-quiet"); await swap(res, { quiet: true, push: false }, res.prep); undoLeave(); await nextFrame(); await nextFrame(); root.classList.remove("sn-quiet"); return; }

        if (vt) {
            root.classList.add("sn-arrive");
            let transition = null;
            const update = async () => {
                await swap(res, { push: opts.push, vt: true }, res.prep);
                undoLeave();          // a page may have set "leaving" itself (Meetings view / week buttons); never keep it on the new page
                SN._arrive?.(transition);
            };
            try { transition = document.startViewTransition({ update, types: dir ? [dir] : [] }); }
            catch (e) {
                transition = document.startViewTransition(update);
                if (dir && transition.types) try { transition.types.add(dir); } catch (x) { }
            }
            try { await transition.finished; } catch (e) { }
            return;
        }

        // Safari, Firefox: the old page has slid out; slide the new one in (same CSS as a full load)
        await swap(res, { push: opts.push }, res.prep);
        undoLeave();
        const row = document.querySelector(".sn-body-row");
        if (!reduce()) {
            root.classList.add("sn-no-vt");
            row.style.animation = "none"; void row.offsetWidth; row.style.animation = "";
        }
        SN._arrive?.(null);
    }
    SN.navigate = navigate;
    nav.go = navigate;

    // =====================================================================
    // 6. Links, forms, Back / Forward, hover prefetch
    // =====================================================================
    function linkTarget(e) {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
        const a = e.target.closest && e.target.closest("a[href]");
        if (!a || a.hasAttribute("download") || a.hasAttribute("data-sn-full")) return null;
        if (a.target && a.target !== "_self") return null;
        const u = new URL(a.href, location.href);
        if (u.pathname === location.pathname && u.search === location.search && u.hash) return null;   // a jump within the page
        return nav.canGo(u) ? { a, u } : null;
    }
    // on window (bubbling): runs after the page's own click handlers, so they can still cancel a click
    addEL.call(window, "click", (e) => {
        const t = linkTarget(e);
        if (!t) return;
        e.preventDefault();
        navigate(t.u.href, { dir: t.a.dataset.snDir || "" });
    });

    nav.wantsForm = (form, submitter) => {
        if (!hasShell() || !(form instanceof HTMLFormElement) || form.hasAttribute("data-sn-full")) return false;
        const method = ((submitter && submitter.getAttribute("formmethod")) || form.getAttribute("method") || "get").toLowerCase();
        if (method === "dialog") return false;
        const target = (submitter && submitter.getAttribute("formtarget")) || form.getAttribute("target");
        if (target && target !== "_self") return false;
        const action = new URL((submitter && submitter.getAttribute("formaction")) || form.getAttribute("action") || location.href, location.href);
        if (action.origin !== location.origin || /^\/account\//i.test(action.pathname) || action.pathname === "/" && method === "post") return false;
        return method === "post" ? true : nav.canGo(action);
    };
    function submitForm(form, submitter) {
        const method = ((submitter && submitter.getAttribute("formmethod")) || form.getAttribute("method") || "get").toLowerCase();
        const action = new URL((submitter && submitter.getAttribute("formaction")) || form.getAttribute("action") || location.href, location.href);
        let data;
        try { data = submitter ? new FormData(form, submitter) : new FormData(form); }
        catch (e) { data = new FormData(form); if (submitter && submitter.name) data.append(submitter.name, submitter.value); }
        if (method === "get") {
            action.search = new URLSearchParams(data).toString();
            return navigate(action.href);
        }
        return navigate(action.href, { method: "POST", body: data, hash: action.hash });
    }
    nav.submit = submitForm;
    addEL.call(window, "submit", (e) => {
        if (e.defaultPrevented) return;
        const form = e.target;
        if (!nav.wantsForm(form, e.submitter)) return;
        e.preventDefault();
        submitForm(form, e.submitter);
    });
    // form.submit() from code (Meet now, Call back, SN.post…) goes the same way
    const nativeSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
        if (nav.wantsForm(this)) { submitForm(this); return; }
        return nativeSubmit.call(this);
    };

    addEL.call(window, "popstate", () => {
        const here = location.pathname + location.search;
        if (here === shown) return;                       // only the #part changed
        // a page that switches its own parts (the Work tabs) may handle it without a page change
        if (nav.onPop) { let done = false; try { done = !!nav.onPop(new URL(location.href)); } catch (e) { console.error(e); } if (done) { shown = here; return; } }
        if (!nav.canGo(location.href)) { location.reload(); return; }
        navigate(location.href, { push: false, dir: "prev" });
    });
    try { history.replaceState(Object.assign({}, history.state || {}, { sn: 1 }), ""); } catch (e) { }

    // fetch the rail pages when the pointer rests on their link (Safari has no built-in prefetch)
    let hoverTimer = 0;
    addEL.call(document, "pointerover", (e) => {
        const a = e.target.closest && e.target.closest("a[href]");
        if (!a) return;
        const u = new URL(a.href, location.href);
        if (!PREFETCH_RE.test(u.pathname) || u.search || !nav.canGo(u)) return;
        if (u.pathname === location.pathname) return;
        cT(hoverTimer);
        hoverTimer = sT(() => prefetch(u), 70);
    });
    addEL.call(document, "pointerout", () => cT(hoverTimer));
    /** Fetch a page ahead of a click that isn't a link (e.g. the Work tabs). */
    nav.prefetch = (href) => { const u = toUrl(href); if (PREFETCH_RE.test(u.pathname) && !u.search && nav.canGo(u) && u.pathname !== location.pathname) prefetch(u); };

    /**
     * For pages that switch their own parts (the Work tabs, js/work-kit.js):
     * nav.paneUrl(url, push) changes the address without a page change; nav.onPop(url) → true when such a page handled Back/Forward;
     * nav.mount(nodes, srcs) sets up markup fetched for part of this page: its inline scripts, then the script files (in order),
     * then its controls — all tied to this page, so they are cleaned up when the page is left.
     */
    nav.onPop = null;
    nav.paneUrl = (href, push) => {
        const u = toUrl(href);
        const st = Object.assign({}, history.state || {}, { sn: 1 });
        if (push) history.pushState(st, "", u.href); else history.replaceState(st, "", u.href);
        shown = u.pathname + u.search;
    };
    nav.mount = async (nodes, srcs) => {
        const codes = [];
        for (const src of srcs || []) {
            const u = toUrl(src);
            if (u.origin !== location.origin) continue;
            codes.push({ code: await getText(u.href), label: u.pathname });
        }
        const mine = page;
        if (!mine || mine.dead) return false;
        const prev = cur; cur = mine;
        const els = nodes.filter((n) => n.nodeType === 1);
        try {
            els.forEach((el) => {
                [...(el.matches("script") ? [el] : []), ...el.querySelectorAll("script")].forEach((old) => {
                    if (old.hasAttribute("data-sn-skip") || !isCode(old) || old.src || !old.parentNode) return;
                    runInline(old.textContent, old.parentNode, null, old); old.remove();
                });
            });
            const holder = document.getElementById("sn-page-scripts") || document.body;
            codes.forEach((c) => { if (c.code) runInline(c.code, holder, c.label); });
            const $ = window.jQuery;
            ["ModernTable", "ModernInput", "ModernDropdownWithLabel", "ModernDatePickerWithLabel",
             "ModernRadio", "ModernCheckbox", "TabControl", "ModernDonutChart"].forEach((name) => {
                const c = window[name];
                if (c && typeof c.init === "function") els.forEach((el) => { try { c.init($ ? $(el) : el); } catch (e) { console.error(e); } });
            });
        } finally { cur = prev; }
        els.forEach((el) => window.Sahyog?.paintPhotos?.(el));
        window.Sahyog?.paintPresence?.();
        return true;
    };

    /** Reloads the current page in place (no animation, scroll kept): used for live updates. */
    nav.refresh = () => navigate(location.href, { push: false, quiet: true });
})();
