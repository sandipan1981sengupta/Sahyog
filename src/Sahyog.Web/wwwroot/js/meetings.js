// Sahyog · meetings page: day/time chips and a live "is everyone free?" check.
(function () {
    "use strict";

    const form = document.getElementById("scheduleForm");
    if (!form) return;

    const dateInput = document.getElementById("mDate");
    const timeInput = document.getElementById("mTime");
    const freeText = document.getElementById("freeText");
    const busy = JSON.parse(document.getElementById("busyJson")?.textContent || "[]");

    const press = (selector, attr, value) =>
        form.querySelectorAll(selector).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset[attr] === value)));

    form.querySelectorAll(".chip-day").forEach((b) =>
        b.addEventListener("click", () => { dateInput.value = b.dataset.date; sync(); }));
    form.querySelectorAll(".chip[data-time]").forEach((b) =>
        b.addEventListener("click", () => { timeInput.value = b.dataset.time; sync(); }));
    dateInput.addEventListener("change", sync);
    timeInput.addEventListener("change", sync);
    form.querySelectorAll('input[name="Form.DurationMinutes"]').forEach((r) => r.addEventListener("change", sync));

    function sync() {
        press(".chip-day", "date", dateInput.value);
        press(".chip[data-time]", "time", (timeInput.value || "").slice(0, 5));
        checkFree();
    }

    function checkFree() {
        const [h, m] = (timeInput.value || "0:0").split(":").map(Number);
        const start = h + m / 60;
        const duration = Number(form.querySelector('input[name="Form.DurationMinutes"]:checked')?.value || 30) / 60;
        const clash = busy.find((e) => e.date === dateInput.value && start < e.end && e.start < start + duration);
        freeText.className = `free-pill ${clash ? "clash" : "ok"}`;
        freeText.textContent = clash ? `Clashes with “${clash.title}” in your calendar` : "You're free at this time";
    }

    sync();
})();
