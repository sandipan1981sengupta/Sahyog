// ShankhNaad · shared people picker (New group, Add people to a group, Schedule a meeting).
// Markup: Views/Shared/_PeoplePicker.cshtml.  Use: var p = snPicker(document.getElementById("…"));
//   p.count()  → how many are picked (and repaints the chips)
//   p.reset()  → search cleared, back to "All" (call when its dialog closes)
//   p.pickOnly(["id", …]) → tick exactly these people
//   p.focus()  → cursor in the search box
(function () {
    "use strict";
    function snPicker(root) {
        if (!root) return null;
        var q = function (sel) { return root.querySelector(sel); };
        var rows = Array.prototype.slice.call(root.querySelectorAll(".sn-pp-row"));
        var letters = Array.prototype.slice.call(root.querySelectorAll(".sn-pp-letter"));
        var search = q("[data-pp-search]"), chips = q("[data-pp-chips]"), none = q("[data-pp-none]"), counter = q("[data-pp-count]");
        var show = "all";
        var esc = function (t) { return String(t).replace(/[&<>"]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]; }); };
        var listBox = q("[data-pp-list]"), seg = q(".sn-pp-seg"), pill = q(".sn-pp-pill");
        // the list keeps the height it had with everyone in it, so the dialog doesn't jump while you filter
        function lockHeight() {
            if (listBox.dataset.locked || !listBox.offsetHeight) return;
            listBox.style.minHeight = listBox.offsetHeight + "px";
            listBox.dataset.locked = "1";
        }
        // the All / Online highlight slides to the picked button
        function movePill(instant) {
            var on = seg.querySelector("button.on");
            if (!on || !on.offsetWidth) return;
            if (instant) pill.style.transition = "none";
            pill.style.width = on.offsetWidth + "px";
            pill.style.transform = "translateX(" + (on.offsetLeft - 3) + "px)";
            seg.classList.add("pill-ready");
            if (instant) { void pill.offsetWidth; pill.style.transition = ""; }
        }
        function visible() { return rows.filter(function (r) { return !r.hidden; }); }
        function filter() {
            lockHeight();
            var text = search.value.trim().toLowerCase(), shown = 0;
            rows.forEach(function (r) {
                var ok = (!text || r.dataset.name.indexOf(text) >= 0) && (show === "all" || r.dataset.online === "1");
                r.hidden = !ok; if (ok) shown++;
            });
            letters.forEach(function (h) { h.hidden = !rows.some(function (r) { return !r.hidden && r.dataset.letter === h.dataset.letter; }); });
            if (none) { none.hidden = shown > 0 || rows.length === 0; none.querySelector("span").textContent = text || (show === "online" ? "online" : ""); }
            q("[data-pp-shown]").textContent = (text || show !== "all") ? ("Showing " + shown + " of " + rows.length) : (rows.length + (rows.length === 1 ? " person" : " people"));
        }
        function render() {
            var picked = rows.filter(function (r) { return r.querySelector("input").checked; });
            counter.textContent = picked.length + " picked";
            counter.classList.toggle("has", picked.length > 0);
            chips.querySelectorAll(".sn-pp-chip").forEach(function (x) { x.remove(); });
            chips.querySelector(".sn-pp-chips-empty").hidden = picked.length > 0;
            picked.forEach(function (r) {
                var name = r.querySelector(".sn-pp-name").textContent;
                var av = r.querySelector(".avatar").cloneNode(true);
                av.className = av.className.replace("av-34", "av-22");
                if (av.querySelector(".dot")) av.querySelector(".dot").remove();
                var chip = document.createElement("span");
                chip.className = "sn-pp-chip";
                chip.innerHTML = '<span class="sn-pp-chip-name">' + esc(name) + '</span><button type="button" aria-label="Remove ' + esc(name) + '" data-unpick="' + esc(r.querySelector("input").value) + '">&times;</button>';
                chip.prepend(av);
                chips.appendChild(chip);
            });
            return picked.length;
        }
        root.addEventListener("change", function (e) { if (e.target.closest(".sn-pp-row")) render(); });
        search.addEventListener("input", filter);
        search.addEventListener("keydown", function (e) {
            if (e.key !== "Enter") return;
            e.preventDefault();
            var first = visible()[0];
            if (!first || !search.value.trim()) return;
            first.querySelector("input").checked = true;
            search.value = ""; filter(); render();
            Sahyog.toast(first.querySelector(".sn-pp-name").textContent + " added", { kind: "success" });
        });
        chips.addEventListener("click", function (e) {
            var b = e.target.closest("[data-unpick]");
            if (!b) return;
            rows.forEach(function (r) { var i = r.querySelector("input"); if (i.value === b.dataset.unpick) i.checked = false; });
            render();
        });
        root.querySelectorAll("[data-pp-show]").forEach(function (b) {
            b.addEventListener("click", function () {
                if (b.classList.contains("on")) return;
                movePill(true);                 // start from where the highlight is now
                show = b.dataset.ppShow;
                root.querySelectorAll("[data-pp-show]").forEach(function (x) { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); });
                requestAnimationFrame(function () { movePill(false); });
                filter();
            });
        });
        search.addEventListener("focus", lockHeight);
        q("[data-pp-all]").addEventListener("click", function () { visible().forEach(function (r) { r.querySelector("input").checked = true; }); render(); });
        q("[data-pp-clear]").addEventListener("click", function () { rows.forEach(function (r) { r.querySelector("input").checked = false; }); render(); });
        // live status from the app (Available, Busy, In a call…); "Online" = anyone not offline
        document.addEventListener("sahyog:presence", function () {
            if (!window.Sahyog || !Sahyog.stateOf) return;
            rows.forEach(function (r) {
                var st = Sahyog.stateOf(r.querySelector("input").value);
                r.dataset.online = st === "offline" ? "0" : "1";
                r.dataset.state = st;
                var label = r.querySelector(".sn-pp-state");
                if (label) label.textContent = Sahyog.STATES[st].label;
            });
            if (show === "online") filter();
        });
        var form = root.closest("form");
        if (form) form.addEventListener("reset", function () { setTimeout(render, 0); });
        filter(); render();
        return {
            count: render,
            focus: function () { search.focus(); },
            reset: function () {
                search.value = ""; show = "all";
                root.querySelectorAll("[data-pp-show]").forEach(function (x) { x.classList.toggle("on", x.dataset.ppShow === "all"); });
                seg.classList.remove("pill-ready");
                listBox.style.minHeight = ""; delete listBox.dataset.locked;   // measured again next time
                filter();
            },
            pickOnly: function (ids) {
                rows.forEach(function (r) { var i = r.querySelector("input"); i.checked = ids.indexOf(i.value) >= 0; });
                render();
            }
        };
    }
    window.snPicker = snPicker;
})();
