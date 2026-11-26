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

    SN.wk = {
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
        /** A badge count on a Work tab. */
        badge(key, n) {
            document.querySelectorAll(`[data-work-n="${key}"]`).forEach((b) => { b.hidden = !n; b.textContent = n > 99 ? "99+" : n; });
        }
    };
})();
