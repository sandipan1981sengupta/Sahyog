// ShankhNaad · Schedule dialog: live "are you free?" check against your own meetings this week.
// Works with the Template 1 controls: modern-datepicker-with-label (#mDate, dd-MM-yyyy)
// and modern-dropdown-with-label (hidden inputs #mTime_value and #mDuration_value).
(function () {
    "use strict";

    const form = document.getElementById("scheduleForm");
    if (!form) return;

    const freeText = document.getElementById("freeText");
    const busy = JSON.parse(document.getElementById("busyJson")?.textContent || "[]");
    const val = (id) => (document.getElementById(id)?.value || "").trim();

    const allDayBox = document.getElementById("mAllDay");
    const isAllDay = () => !!(allDayBox && allDayBox.checked);
    const showAsFree = () => (document.querySelector('input[name="Form.ShowAs"]:checked') || {}).value === "free";

    let last = "";
    function check() {
        const date = val("mDate");
        const allDay = isAllDay();
        const time = allDay ? "00:00" : (val("mTime_value") || "00:00");
        const minutes = allDay ? 24 * 60 : Number(val("mDuration_value") || 30);
        const key = `${date}|${time}|${minutes}|${allDay}|${showAsFree()}`;
        if (key === last) return;
        last = key;

        const [h, m] = time.split(":").map(Number);
        const start = h + (m || 0) / 60;
        const end = start + minutes / 60;
        // a "free" all-day event never clashes; anything else on that day does
        const clash = allDay && showAsFree() ? null : busy.find((e) => e.date === date && start < e.end && e.start < end);

        freeText.className = `sn-free ${clash ? "clash" : "ok"}`;
        freeText.innerHTML = clash
            ? '<i class="fa fa-exclamation-triangle"></i> '
            : '<i class="fa fa-check-circle"></i> ';
        freeText.appendChild(document.createTextNode(clash
            ? `Clashes with “${clash.title}”${clash.allDay ? " (all day)" : ""}`
            : allDay ? (showAsFree() ? "Shown as free: others can still book you" : "Your whole day is free") : "You're free at this time"));
    }

    // ---- all-day: hide start time + duration, show Busy / Free ----
    const timeFields = document.getElementById("timeFields");
    const showAsFields = document.getElementById("showAsFields");
    function applyAllDay() {
        const on = isAllDay();
        timeFields?.classList.toggle("is-collapsed", on);
        showAsFields?.classList.toggle("is-collapsed", !on);
        if (timeFields) timeFields.inert = on;
        if (showAsFields) showAsFields.inert = !on;
        last = "";
        check();
    }
    window.snSetAllDay = (on) => {
        if (!allDayBox || allDayBox.checked === on) return;
        allDayBox.checked = on;
        allDayBox.dispatchEvent(new Event("change", { bubbles: true }));
    };
    allDayBox?.addEventListener("change", applyAllDay);
    document.querySelectorAll('input[name="Form.ShowAs"]').forEach((r) => r.addEventListener("change", () => { last = ""; check(); }));
    applyAllDay();

    // ---- people: search, select all, count ----
    const people = document.getElementById("peopleList");
    if (people) {
        const search = document.getElementById("peopleSearch");
        const none = people.querySelector(".sn-pick-none");
        const count = document.getElementById("peopleCount");
        const boxes = () => Array.from(people.querySelectorAll('input[type="checkbox"][name="Form.InviteeIds"]'));
        const update = () => {
            const n = boxes().filter((b) => b.checked).length;
            count.textContent = n === 0 ? "No one picked yet" : `${n} ${n === 1 ? "person" : "people"} invited`;
        };
        search?.addEventListener("input", () => {
            const q = search.value.trim().toLowerCase();
            let shown = 0;
            people.querySelectorAll(".sn-pick-row").forEach((row) => {
                const hit = !q || row.dataset.name.includes(q);
                row.hidden = !hit;
                if (hit) shown++;
            });
            if (none) none.hidden = shown > 0;
        });
        document.getElementById("peopleAll")?.addEventListener("click", (e) => {
            const visible = boxes().filter((b) => !b.closest(".sn-pick-row").hidden);
            const all = visible.every((b) => b.checked);
            visible.forEach((b) => { if (b.checked === all) b.click(); });
            e.currentTarget.textContent = all ? "Select all" : "Clear";
            update();
        });
        people.addEventListener("change", update);
        update();
    }

    // ---- guests: email chips (posted as one comma list in Form.GuestEmails) ----
    const guestBox = document.getElementById("guestBox");
    const guestEntry = document.getElementById("guestEntry");
    const guestHidden = document.getElementById("mGuests");
    if (guestBox && guestEntry && guestHidden) {
        const emailOk = (v) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(v);
        let guests = (guestHidden.value || "").split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
        const sync = () => { guestHidden.value = guests.join(", "); };
        const render = () => {
            guestBox.querySelectorAll(".sn-gchip").forEach((c) => c.remove());
            guests.forEach((g) => {
                const chip = document.createElement("span");
                chip.className = "sn-gchip";
                chip.innerHTML = '<i class="fa fa-envelope-o" aria-hidden="true"></i><span></span><button type="button" aria-label="Remove">&times;</button>';
                chip.querySelector("span").textContent = g;
                chip.querySelector("button").addEventListener("click", () => { guests = guests.filter((x) => x !== g); render(); sync(); });
                guestBox.insertBefore(chip, guestEntry);
            });
        };
        const add = () => {
            const parts = guestEntry.value.split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
            let bad = null;
            parts.forEach((v) => { if (!emailOk(v)) bad = v; else if (!guests.includes(v)) guests.push(v); });
            guestEntry.value = bad || "";
            guestBox.classList.toggle("bad", !!bad);
            render(); sync();
        };
        guestEntry.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === "," || e.key === ";") { e.preventDefault(); add(); }
            else if (e.key === "Backspace" && !guestEntry.value && guests.length) { guests.pop(); render(); sync(); }
            else guestBox.classList.remove("bad");
        });
        guestEntry.addEventListener("blur", add);
        guestBox.addEventListener("click", (e) => { if (e.target === guestBox) guestEntry.focus(); });
        form.addEventListener("submit", add);
        render(); sync();
    }

    // ---- repeat: Once / Weekly / Weekdays / Pick days, plus an optional last day ----
    const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const MON_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const parseDmy = (v) => { const p = (v || "").split("-").map(Number); return p.length === 3 && p[2] ? new Date(p[2], p[1] - 1, p[0]) : null; };
    const fmt = (d) => `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MON_SHORT[d.getMonth()]} ${d.getFullYear()}`;
    const repeatFields = document.getElementById("repeatFields");
    const repeatDaysFields = document.getElementById("repeatDaysFields");
    const untilFields = document.getElementById("repeatUntilFields");
    const endsBox = document.getElementById("mRepeatEnds");
    const summary = document.getElementById("repeatSummary");
    const repeatMode = () => (document.querySelector('input[name="Form.Recurrence"]:checked') || {}).value || "None";
    const dayBoxes = () => Array.from(document.querySelectorAll('input[name="Form.RepeatDays"]'));
    const pickedDays = () => dayBoxes().filter((b) => b.checked).map((b) => Number(b.value));

    function setReveal(el, on) {
        if (!el) return;
        el.classList.toggle("is-collapsed", !on);
        el.inert = !on;
    }
    function applyRepeat() {
        const mode = repeatMode();
        setReveal(repeatFields, mode !== "None");
        setReveal(repeatDaysFields, mode === "Custom");
        setReveal(untilFields, !!(endsBox && endsBox.checked));
        // "Pick days" with nothing picked yet: start with the chosen date's weekday
        if (mode === "Custom" && pickedDays().length === 0) {
            const start = parseDmy(val("mDate"));
            if (start) { const box = dayBoxes().find((b) => Number(b.value) === start.getDay()); if (box) box.checked = true; }
        }
        lastRepeat = "";
        updateRepeat();
    }

    // which weekdays a pattern uses (0 = Sun … 6 = Sat)
    function patternDays(mode, start) {
        if (mode === "Weekly") return start ? [start.getDay()] : [];
        if (mode === "Daily") return [1, 2, 3, 4, 5];
        if (mode === "Custom") return pickedDays();
        return [];
    }

    let lastRepeat = "";
    function updateRepeat() {
        if (!summary) return;
        const mode = repeatMode();
        const start = parseDmy(val("mDate"));
        const ends = !!(endsBox && endsBox.checked);
        const until = ends ? parseDmy(val("mUntil")) : null;
        const days = patternDays(mode, start);
        const key = `${mode}|${val("mDate")}|${ends}|${val("mUntil")}|${days.join(",")}`;
        if (key === lastRepeat) return;
        lastRepeat = key;

        // the last day can't be before the start
        const untilInput = document.getElementById("mUntil");
        if (untilInput && untilInput._flatpickr && start) untilInput._flatpickr.set("minDate", start);

        summary.className = "sn-repeat-summary";
        if (mode === "None" || !start) { summary.textContent = ""; return; }
        if (days.length === 0) { summary.classList.add("warn"); summary.textContent = "Pick at least one day."; return; }

        // first meeting = first matching day on or after the chosen date
        const first = new Date(start);
        for (let i = 0; i < 7 && !days.includes(first.getDay()); i++) first.setDate(first.getDate() + 1);

        const ordered = [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d)).map((d) => DAY_SHORT[d]);
        const every = mode === "Daily" ? "every weekday" : `every ${ordered.join(", ")}`;

        if (ends && !until) { summary.classList.add("warn"); summary.textContent = `Repeats ${every} from ${fmt(first)}. Pick the last day.`; return; }
        if (until && until < first) { summary.classList.add("warn"); summary.textContent = `The last day must be on or after ${fmt(first)}.`; return; }

        if (!until) { summary.textContent = `Repeats ${every} from ${fmt(first)}, with no end.`; return; }
        let count = 0;
        for (const d = new Date(first); d <= until; d.setDate(d.getDate() + 1)) if (days.includes(d.getDay())) count++;
        const tooLong = until > new Date(first.getFullYear() + 1, first.getMonth(), first.getDate());
        if (tooLong) summary.classList.add("warn");
        summary.textContent = tooLong
            ? "A meeting can repeat for up to one year. Pick an earlier last day."
            : `Repeats ${every} · ${fmt(first)} to ${fmt(until)} · ${count} ${count === 1 ? "meeting" : "meetings"}`;
    }

    // bound through jQuery so changes made by the Template 1 controls (.trigger("change")) are seen too
    jQuery(document).on("change", 'input[name="Form.Recurrence"]', applyRepeat);
    jQuery(document).on("change", "#mRepeatEnds", () => {
        applyRepeat();
        const until = document.getElementById("mUntil");
        if (endsBox.checked && until && !until.value) setTimeout(() => until._flatpickr?.open(), 380);
    });
    document.querySelector(".sn-daypick")?.addEventListener("change", () => { lastRepeat = ""; updateRepeat(); });
    document.querySelectorAll(".sn-day-presets [data-days]").forEach((b) => b.addEventListener("click", () => {
        const want = b.dataset.days ? b.dataset.days.split(",").map(Number) : [];
        dayBoxes().forEach((box) => { box.checked = want.includes(Number(box.value)); });
        lastRepeat = "";
        updateRepeat();
    }));
    applyRepeat();

    ["mDate", "mTime_value", "mDuration_value"].forEach((id) => document.getElementById(id)?.addEventListener("change", check));
    // The pickers set their values from script, so also re-check every half second while the dialog is open.
    setInterval(() => { if (document.getElementById("scheduleDialog")?.open) { check(); updateRepeat(); } }, 500);
    check();
})();
