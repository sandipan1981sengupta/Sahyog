// ShankhNaad · a meeting's details: who's coming, my answer (Accept / Maybe / Decline), Join / Start.
// Used by the calendar (click a meeting: the details open in a window) and by /meetings/{id}/view (a page of its own).
(function () {
    "use strict";
    const S = window.Sahyog || {};
    const token = () => (S.antiforgery ? S.antiforgery() : document.querySelector('input[name="__RequestVerificationToken"]')?.value || "");
    const toast = (text, kind, title) => (S.toast ? S.toast(text, { kind: kind || "info", title }) : alert(text));

    // The app swaps pages without reloading (sn-nav.js) and removes a page's listeners when you leave it; this script
    // runs again when the page comes back. So nothing here is "once per load": a window left over from the last visit
    // (its listeners are gone) is removed, and everything below is set up again for this visit.
    document.getElementById("detailsDialog")?.remove();

    /** Opens the details of one date of a meeting in the calendar's window. el = the meeting on the calendar (data-id, data-occ). */
    window.snShowDetails = async function (id, occ) {
        let dlg = document.getElementById("detailsDialog");
        if (!dlg) {
            dlg = document.createElement("dialog");
            dlg.id = "detailsDialog";
            dlg.className = "sn-dialog glass-strong sn-details-dlg";
            dlg.setAttribute("aria-label", "Meeting details");
            dlg.innerHTML = '<div class="sn-md-load"><span class="sn-md-spin"></span> Loading…</div>';
            document.body.appendChild(dlg);
            dlg.addEventListener("click", (e) => {
                if (e.target === dlg || e.target.closest("[data-close]")) dlg.close();   // a click outside the box, or ✕
            });
        }
        dlg.dataset.id = id;
        dlg.dataset.occ = occ || "";
        if (!dlg.open) {
            dlg.innerHTML = '<div class="sn-md-load"><span class="sn-md-spin"></span> Loading…</div>';
            dlg.showModal();
        }
        try {
            const r = await fetch(`/meetings/${id}/details${occ ? "?date=" + encodeURIComponent(occ) : ""}`, { credentials: "same-origin", headers: { Accept: "text/html" } });
            if (!r.ok) throw new Error();
            dlg.innerHTML = await r.text();
        } catch {
            dlg.innerHTML = '<div class="sn-md-load">Couldn\'t load this meeting. <button type="button" class="sn-link" data-close>Close</button></div>';
        }
    };

    // my answer: Accept saves straight away; Maybe / Decline first ask why (optional), then save
    async function sendAnswer(md, answer, note) {
        const fd = new FormData();
        fd.append("response", answer);
        fd.append("date", md.dataset.occ || "");
        fd.append("scope", md.querySelector('input[name="mdScope"]:checked')?.value || "all");
        fd.append("note", (note || "").trim());
        const busy = md.querySelectorAll("[data-respond], [data-reason-send]");
        busy.forEach((x) => { x.disabled = true; });
        try {
            const r = await fetch(`/meetings/${md.dataset.id}/respond`, { method: "POST", body: fd, credentials: "same-origin", headers: { RequestVerificationToken: token() } });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(d.error || "Your answer wasn't saved. Try again.");
            toast(d.message || "Saved.", "success", "Answer saved");
            const dlg = md.closest("#detailsDialog");
            if (dlg) window.snShowDetails(md.dataset.id, md.dataset.occ); else location.reload();
        } catch (err) {
            busy.forEach((x) => { x.disabled = false; });
            toast(err.message, "warn", "Not saved");
        }
    }
    function askWhy(md, answer) {
        const box = md.querySelector(".sn-md-reason");
        if (!box) { sendAnswer(md, answer, ""); return; }
        md.dataset.answer = answer;
        box.hidden = false;
        box.dataset.answer = answer;
        box.querySelectorAll(".sn-md-chips").forEach((c) => { c.hidden = c.dataset.for !== answer; });
        box.querySelector("[data-reason-send] span").textContent = answer === "no" ? "Send decline" : "Send maybe";
        md.querySelectorAll("[data-respond]").forEach((b) => b.classList.toggle("asking", b.dataset.respond === answer));
        const input = box.querySelector("input");
        setTimeout(() => input?.focus(), 30);
    }
    document.addEventListener("click", (e) => {
        const b = e.target.closest(".sn-md [data-respond]");
        if (b) {
            const md = b.closest(".sn-md");
            if (b.dataset.respond === "yes") sendAnswer(md, "yes", "");
            else askWhy(md, b.dataset.respond);
            return;
        }
        const chip = e.target.closest(".sn-md [data-reason-chip]");
        if (chip) {
            const box = chip.closest(".sn-md-reason");
            box.querySelector("input").value = chip.textContent.trim();
            box.querySelectorAll("[data-reason-chip]").forEach((c) => c.classList.toggle("on", c === chip));
            return;
        }
        if (e.target.closest(".sn-md [data-reason-cancel]")) {
            const md = e.target.closest(".sn-md");
            md.querySelector(".sn-md-reason").hidden = true;
            md.querySelectorAll("[data-respond]").forEach((x) => x.classList.remove("asking"));
            return;
        }
        const send = e.target.closest(".sn-md [data-reason-send]");
        if (send) {
            const md = send.closest(".sn-md");
            sendAnswer(md, md.dataset.answer || "no", md.querySelector(".sn-md-reason input")?.value || "");
        }
    });
    document.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        const input = e.target.closest(".sn-md-reason input");
        if (!input) return;
        e.preventDefault();
        const md = input.closest(".sn-md");
        sendAnswer(md, md.dataset.answer || "no", input.value);
    });

    // Edit / Cancel (the host): the calendar page's own windows do the work
    document.addEventListener("click", (e) => {
        const b = e.target.closest(".sn-md [data-dact]");
        if (!b) return;
        const md = b.closest(".sn-md");
        document.getElementById("detailsDialog")?.close();
        window.snMeetingFromDetails?.(b.dataset.dact, md.dataset.id, md.dataset.occ, md.dataset.series === "1");
    });

    // find a person in a long list
    document.addEventListener("input", (e) => {
        const input = e.target.closest(".sn-md-search input");
        if (!input) return;
        const q = input.value.trim().toLowerCase();
        const md = input.closest(".sn-md");
        md.querySelectorAll(".sn-md-person").forEach((p) => { p.hidden = !!q && !p.dataset.name.toLowerCase().includes(q); });
        md.querySelectorAll(".sn-md-group").forEach((h) => {
            let n = h.nextElementSibling, any = false;
            while (n && !n.classList.contains("sn-md-group")) { if (!n.hidden) any = true; n = n.nextElementSibling; }
            h.hidden = !any;
        });
    });

    // someone answered (the pop-up itself comes from site.js on every page): an open window of that meeting refreshes
    S.hub?.on?.("MeetingResponse", (meetingId) => {
        const dlg = document.getElementById("detailsDialog");
        if (dlg?.open && dlg.dataset.id === meetingId) window.snShowDetails(meetingId, dlg.dataset.occ);
    });
})();
