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

    let last = "", oooStamp = 0;
    const parseDay = (s) => { const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s || ""); return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null; };
    // invite list: people who are out of office during the meeting (its hours, or the whole day for an all-day event) get a purple tag
    const awayDuring = (id, start, end) => (start && id && window.Sahyog?.oooDuring ? Sahyog.oooDuring(id, start, end) : null);
    const awayText = (o, day) => {
        const hours = window.SN?.oooHoursOn ? SN.oooHoursOn(o, day) : "";
        if (hours) return "Out of office " + hours;
        const r = window.SN?.oooDays ? SN.oooDays(o) : null;
        return "Out of office that day" + (r && r.last && window.SN?.oooWhenText ? " · " + SN.oooWhenText(o) : "");
    };
    function markInvitees(start, end, day) {
        document.querySelectorAll("#invitePeople .sn-pp-row").forEach((row) => {
            const id = row.querySelector("input")?.value;
            const o = awayDuring(id, start, end);
            let tag = row.querySelector(".sn-pp-ooo");
            row.classList.toggle("is-ooo", !!o);
            if (!o) { tag?.remove(); return; }
            if (!tag) { tag = document.createElement("span"); tag.className = "sn-pp-ooo"; row.querySelector(".sn-pp-who")?.appendChild(tag); }
            tag.innerHTML = '<i class="dot st-ooo" aria-hidden="true"></i> ';
            tag.appendChild(document.createTextNode(awayText(o, day)));
            tag.title = o.message || "";
        });
    }
    document.addEventListener("sahyog:ooo", () => { oooStamp++; check(); });
    // you can't book yourself while you're out of office: stop Save (the server checks again)
    form.addEventListener("submit", (e) => {
        last = ""; check();
        if (form.dataset.oooBlocked !== "1") return;
        e.preventDefault(); e.stopImmediatePropagation();
        window.Sahyog?.toast?.("You're out of office at this time. Pick another time, or change or turn off your out of office first.", { kind: "warn", title: "Out of office" });
        freeText?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, true);
    function check() {
        const date = val("mDate");
        const allDay = isAllDay();
        const time = allDay ? "00:00" : (val("mTime_value") || "00:00");
        const minutes = allDay ? 24 * 60 : Number(val("mDuration_value") || 30);
        const key = `${date}|${time}|${minutes}|${allDay}|${showAsFree()}|${oooStamp}`;
        if (key === last) return;
        last = key;
        const day = parseDay(date);
        const [h, m] = time.split(":").map(Number);
        // the meeting's own window (local time): an all-day event covers the whole day
        const mStart = day ? new Date(day.getFullYear(), day.getMonth(), day.getDate(), h || 0, m || 0) : null;
        const mEnd = mStart ? new Date(+mStart + minutes * 6e4) : null;
        markInvitees(mStart, mEnd, day);
        // my own out of office at that time comes first
        const me = document.body.dataset.me;
        const away = awayDuring(me, mStart, mEnd);
        form.dataset.oooBlocked = away ? "1" : "";
        if (away) {
            const hours = window.SN?.oooHoursOn ? SN.oooHoursOn(away, day) : "";
            const r = window.SN?.oooDays ? SN.oooDays(away) : null;
            freeText.className = "sn-free clash ooo";
            freeText.innerHTML = '<i class="fa fa-plane"></i> ';
            freeText.appendChild(document.createTextNode((hours ? `You're out of office ${hours} that day`
                : "You're out of office that day" + (r && window.SN?.oooWhenText ? ` (${r.last ? SN.oooWhenText(away) : SN.oooWhenText(away) + ", no end date"})` : ""))
                + ". Pick another time, or change your out of office."));
            return;
        }

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

    // ---- people: the shared picker (search, Enter to pick, All / Online, chips) — js/people-picker.js ----
    const invite = window.snPicker ? snPicker(document.getElementById("invitePeople")) : null;
    if (invite) document.getElementById("scheduleDialog")?.addEventListener("close", () => invite.reset());

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

// ShankhNaad · Meetings calendar: who is out of office (you and your colleagues), on every view.
// Month: your days get a purple band, colleagues a small chip each. Week / day: hours away are drawn at their time.
(function () {
    "use strict";
    const views = document.querySelector(".sn-views");
    if (!views) return;
    const parseDay = (s) => { const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s || ""); return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null; };
    let team = [];
    try { team = JSON.parse(document.getElementById("teamJson")?.textContent || "[]"); } catch { team = []; }
    const MAX_CHIPS = 2;   // month cells are small: two names, then "+N more"
    const chip = (name, hours, title) => {
        const c = document.createElement("span");
        c.className = "sn-ooo-who";
        c.innerHTML = '<i class="fa fa-plane" aria-hidden="true"></i>';
        const n = document.createElement("span");
        n.textContent = name;
        if (hours) { const sm = document.createElement("small"); sm.textContent = " · " + hours; n.appendChild(sm); }
        c.appendChild(n);
        c.title = title;
        return c;
    };
    const hoursOn = (o, day) => (window.SN?.oooHoursOn ? SN.oooHoursOn(o, day) : "");
    const titleOf = (name, o) => name + " · out of office" + (window.SN?.oooWhenText ? " · " + SN.oooWhenText(o) : "") + (o.message ? "\n“" + o.message + "”" : "");
    function mark() {
        const me = document.body.dataset.me;
        const S = window.Sahyog;
        if (!S?.oooOn) return;
        views.querySelectorAll(".sn-ooo-whos, .sn-ooo-block").forEach((x) => x.remove());
        views.querySelectorAll(".sn-mcell[data-date], .sn-sched-col[data-date], .sn-sched-dayhead[data-date], .sn-allday-cell[data-date]").forEach((el) => {
            const day = parseDay(el.dataset.date);
            if (!day) return;
            const mine = me ? S.oooOn(me, day) : null;
            const myHours = mine ? hoursOn(mine, day) : "";
            const wholeDay = !!mine && !myHours;   // your hours-only absence is drawn like a colleague's (as a block / chip)
            el.classList.toggle("sn-ooo-day", wholeDay);
            let band = el.querySelector(":scope > .sn-ooo-band");
            if (!wholeDay) band?.remove();
            else {
                if (!band) {
                    band = document.createElement("span");
                    band.className = "sn-ooo-band";
                    band.innerHTML = '<i class="fa fa-plane" aria-hidden="true"></i><span>Out of office</span>';
                    const top = el.classList.contains("sn-mcell") ? el.querySelector(".sn-mcell-top") : null;
                    if (top) top.after(band); else el.appendChild(band);
                }
                band.title = "Out of office" + (mine.message ? ": " + mine.message : "");
            }
            if (!el.matches(".sn-mcell, .sn-sched-col")) return;
            // everyone else away that day (and you, when it's only some hours)
            const away = [];
            if (mine && myHours) away.push({ name: "You", o: mine });
            team.forEach((p) => { const o = S.oooOn(p.id, day); if (o) away.push({ name: p.name, o }); });
            if (!away.length) return;
            const isMonth = el.classList.contains("sn-mcell");
            const box = document.createElement("div");
            box.className = "sn-ooo-whos";
            away.forEach((a, i) => {
                const hours = hoursOn(a.o, day);
                if (!isMonth && hours) {
                    // week / day: a block from leave to back, at its time on the grid (--hr = one hour, the grid starts at 00:00)
                    const d0 = new Date(day.getFullYear(), day.getMonth(), day.getDate()), d1 = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + 1);
                    const s = new Date(Math.max(+d0, +new Date(a.o.startUtc || a.o.sinceUtc || Date.now())));
                    const e = new Date(Math.min(+d1, a.o.untilUtc ? +new Date(a.o.untilUtc) : +d1));
                    const top = (s - d0) / 36e5, len = Math.max(.35, (e - s) / 36e5);
                    const b = document.createElement("div");
                    b.className = "sn-ooo-block";
                    b.style.top = `calc(var(--hr) * ${top.toFixed(3)})`;
                    b.style.height = `calc(var(--hr) * ${len.toFixed(3)} - 2px)`;
                    const t = document.createElement("b");
                    t.innerHTML = '<i class="fa fa-plane" aria-hidden="true"></i> ';
                    t.appendChild(document.createTextNode(a.name + " · " + hours));
                    b.appendChild(t);
                    b.title = titleOf(a.name, a.o);
                    el.appendChild(b);
                    return;
                }
                if (isMonth && i >= MAX_CHIPS && away.length > MAX_CHIPS + 1) return;
                box.appendChild(chip(a.name, hours, titleOf(a.name, a.o)));
            });
            if (isMonth && away.length > MAX_CHIPS + 1) {
                const more = away.slice(MAX_CHIPS);
                box.appendChild(chip(`+${more.length} more away`, "", more.map((a) => titleOf(a.name, a.o)).join("\n")));
            }
            if (!box.childElementCount) return;
            if (isMonth) { const after = el.querySelector(":scope > .sn-ooo-band") || el.querySelector(".sn-mcell-top"); if (after) after.after(box); else el.prepend(box); }
            else el.appendChild(box);
        });
    }
    document.addEventListener("sahyog:ooo", mark);
    mark();
})();
