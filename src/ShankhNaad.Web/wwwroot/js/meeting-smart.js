// ShankhNaad · Schedule window extras (Meetings page), under "Availability":
//  • the cost of the meeting: "You + 3 people × 1 h = 4 working hours", and how full your week already is
//  • "Find a time": the next times when you and everyone invited are free (meetings, out of office, weekends, holidays)
//  • admins: the workspace's holidays
// Server: Controllers/SchedulingController.cs (/meetings/smart/…). The page's toolbar is not touched.
(function () {
    "use strict";
    const form = document.getElementById("scheduleForm");
    const W = window.SN && SN.wk;
    const free = document.getElementById("freeText");
    if (!form || !W || !free) return;
    const esc = W.esc;
    const isAdmin = document.body.dataset.admin === "1";
    const box = document.createElement("div");
    box.className = "full sn-smart";
    box.innerHTML = `<div class="sn-cost" aria-live="polite"><i class="fa fa-users" aria-hidden="true"></i><span><b data-cost></b><small data-load></small></span></div>
        <p class="sn-smart-nudge" data-nudge hidden></p>
        <div class="sn-smart-bar"><button type="button" class="sn-smart-go" data-smart-go><i class="fa fa-magic" aria-hidden="true"></i> Find a time when everyone's free</button>
            ${isAdmin ? '<button type="button" class="sn-link" data-holidays><i class="fa fa-calendar-times-o" aria-hidden="true"></i> Holidays</button>' : ""}</div>
        <div class="sn-smart-slots" data-slots hidden></div>`;
    free.closest(".full").insertAdjacentElement("afterend", box);

    const val = (id) => (document.getElementById(id)?.value || "").trim();
    const invitees = () => [...form.querySelectorAll('#invitePeople input[type="checkbox"]:checked')].map((i) => i.value);
    const guests = () => val("mGuests").split(/[,;\s]+/).filter((x) => x.includes("@")).length;
    const allDay = () => !!document.getElementById("mAllDay")?.checked;
    const minutes = () => Number(val("mDuration_value") || 30);
    const hours = (m) => m % 60 === 0 ? `${m / 60} h` : m < 60 ? `${m} min` : `${(m / 60).toFixed(1).replace(/\.0$/, "")} h`;
    let load = null;

    function paintCost() {
        const n = invitees().length + 1, g = guests(), m = minutes();
        const cost = box.querySelector("[data-cost]");
        if (allDay()) { cost.textContent = "All-day event"; box.querySelector("[data-nudge]").hidden = true; return; }
        cost.textContent = n === 1 ? `Just you · ${hours(m)}` : `You + ${n - 1} ${n === 2 ? "person" : "people"} × ${hours(m)} = ${hours(n * m)} of working time`;
        if (g) cost.textContent += ` (+ ${g} guest${g === 1 ? "" : "s"})`;
        const nudge = box.querySelector("[data-nudge]");
        const big = n * m >= 8 * 60;
        const heavy = load && load.thisWeek.percent >= 40;
        nudge.hidden = !(big || heavy);
        nudge.innerHTML = big ? `<i class="fa fa-lightbulb-o" aria-hidden="true"></i> That's a full working day between everyone. Could fewer people come, or could it be shorter?`
            : heavy ? `<i class="fa fa-lightbulb-o" aria-hidden="true"></i> Your week is already ${load.thisWeek.percent}% meetings. Could this be a message instead?` : "";
    }
    async function loadWeek() {
        const x = await W.get("/meetings/smart/load");
        if (!x.ok) return;
        load = x.d;
        const t = x.d.thisWeek;
        box.querySelector("[data-load]").textContent = ` · Your week: ${hours(t.minutes)} in ${t.meetings} meeting${t.meetings === 1 ? "" : "s"} (${t.percent}%)`;
        paintCost();
    }

    async function suggest() {
        const slots = box.querySelector("[data-slots]");
        slots.hidden = false;
        slots.innerHTML = '<span class="muted small"><i class="fa fa-spinner fa-spin" aria-hidden="true"></i> Checking everyone\'s calendar…</span>';
        const d = val("mDate"); const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(d);
        const from = m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
        const x = await W.get(`/meetings/smart/suggest?minutes=${allDay() ? 60 : minutes()}&from=${from}&people=${invitees().join(",")}`);
        if (!x.ok) { slots.innerHTML = `<span class="muted small">${esc(x.d.error || "Couldn't check calendars just now.")}</span>`; return; }
        const r = x.d;
        const label = (s) => { const dt = new Date(s.iso); return `${dt.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}, ${dt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`; };
        slots.innerHTML = r.slots.length ? `<small class="sn-smart-h">${r.people > 1 ? `Free for you and the ${r.people - 1} invited` : "When you're free"} · ${esc(r.hours)}, weekdays${r.holidays.length ? ` · skipping ${r.holidays.map((h) => esc(h.name)).join(", ")}` : ""}</small>`
            + r.slots.map((s) => `<button type="button" class="sn-smart-slot${s.busy.length ? " part" : ""}" data-date="${s.date}" data-time="${s.time}">
                <b>${esc(label(s))}</b><small>${s.busy.length ? `${s.free} of ${s.total} free · ${esc(s.busy.slice(0, 2).join(", "))}${s.busy.length > 2 ? " +" + (s.busy.length - 2) : ""} ${s.away.length ? "away" : "busy"}` : s.total > 1 ? `All ${s.total} free` : "You're free"}</small></button>`).join("")
            : '<span class="muted small">No free time in the next two weeks of working hours. Try fewer people or a shorter meeting.</span>';
    }
    function useSlot(b) {
        const [dd, mm, yy] = b.dataset.date.split("-").map(Number);
        const input = document.getElementById("mDate");
        if (input && input._flatpickr) input._flatpickr.setDate(new Date(yy, mm - 1, dd), true); else if (input) input.value = b.dataset.date;
        if (window.snSetAllDay && allDay()) snSetAllDay(false);
        const opt = [...document.querySelectorAll("#mTime .ddwl-option")].find((o) => String(o.dataset.value) === b.dataset.time);
        if (opt) { opt.click(); document.getElementById("mTime")?.classList.remove("open"); }
        box.querySelectorAll(".sn-smart-slot").forEach((x) => x.classList.toggle("on", x === b));
        W.toast(`Set to ${b.querySelector("b").textContent}.`, "success", "Meeting time");
    }

    async function holidays() {
        const year = new Date().getFullYear();
        const draw = async (y) => {
            const x = await W.get(`/meetings/smart/holidays?year=${y}`);
            if (!x.ok) { W.toast(x.d.error || "Couldn't load holidays.", "warn"); return; }
            const dlg = W.dialog("sn-hol-dlg", `${W.head("fa-calendar-times-o", "Holidays", "Suggested meeting times skip these days. For the whole workspace.")}
                <div class="sn-dlg-body sn-nir-body">
                    <div class="sn-wk-daynav"><button type="button" data-y="${y - 1}" aria-label="Year before"><i class="fa fa-chevron-left"></i></button><b>${y}</b><button type="button" data-y="${y + 1}" aria-label="Next year"><i class="fa fa-chevron-right"></i></button></div>
                    <div class="sn-hol-list">${x.d.holidays.map((h) => `<div class="sn-nir-mrow"><span class="sn-hol-day">${esc(W.day(h.day))}</span><span class="sn-nir-cmain"><b>${esc(h.name)}</b></span>
                        <button type="button" class="sn-hbtn del" data-hdel="${h.holidayId}" aria-label="Remove ${esc(h.name)}"><i class="fa fa-trash-o"></i></button></div>`).join("") || '<p class="sn-nir-empty">No holidays added for this year.</p>'}</div>
                    <div class="sn-hol-add"><input type="date" class="sn-wk-input" data-hday value="${y}-01-26"><input class="sn-wk-input" data-hname maxlength="100" placeholder="Republic Day">
                        <button type="button" class="cee-btn cee-btn-gradient" data-hadd><i class="fa fa-plus" aria-hidden="true"></i> Add</button></div>
                </div>
                <div class="sn-dlg-foot"><span></span><button type="button" class="cee-btn sn-btn-light" data-close>Done</button></div>`);
            dlg.onclick = async (e) => {
                const yb = e.target.closest("[data-y]"); if (yb) { draw(+yb.dataset.y); return; }
                const del = e.target.closest("[data-hdel]");
                if (del) { const z = await W.post(`/meetings/smart/holidays/${del.dataset.hdel}/delete`); if (z.ok) draw(y); return; }
                if (e.target.closest("[data-hadd]")) {
                    const z = await W.post("/meetings/smart/holidays", { day: dlg.querySelector("[data-hday]").value, name: dlg.querySelector("[data-hname]").value });
                    if (!z.ok) { W.toast(z.d.error || "Not added.", "warn"); return; }
                    draw(y);
                }
            };
        };
        draw(year);
    }

    box.addEventListener("click", (e) => {
        if (e.target.closest("[data-smart-go]")) { suggest(); return; }
        if (e.target.closest("[data-holidays]")) { holidays(); return; }
        const s = e.target.closest(".sn-smart-slot"); if (s) useSlot(s);
    });
    form.addEventListener("change", () => { paintCost(); box.querySelector("[data-slots]").hidden = true; });
    // the duration and time controls keep their value in hidden inputs: look now and then while the window is open
    const dlg = document.getElementById("scheduleDialog");
    let tick = 0;
    const watch = () => { clearInterval(tick); if (dlg?.open) tick = setInterval(() => { if (!dlg.open || !document.body.contains(dlg)) { clearInterval(tick); return; } paintCost(); }, 700); };
    new MutationObserver(() => { if (dlg.open) { loadWeek(); watch(); } }).observe(dlg, { attributes: true, attributeFilter: ["open"] });
    paintCost();
    if (dlg?.open) { loadWeek(); watch(); }
})();
