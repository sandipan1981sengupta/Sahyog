// ShankhNaad · shared people picker (New group, Add people to a group, Schedule a meeting).
// Markup: Views/Shared/_PeoplePicker.cshtml.  Use: var p = snPicker(document.getElementById("…"));
//   p.count()  → how many are picked (and repaints the chips)
//   p.reset()  → search cleared, back to "All" (call when its dialog closes)
//   p.pickOnly(["id", …]) → tick exactly these people
//   p.focus()  → cursor in the search box
// Extras: "Picked" filter, one row of chips + "+N more", "Add a whole team", A–Z bar, people already in the group,
// and a submit button that counts: data-pp-count-for="<picker id>" data-none / data-one / data-many ("{n}").
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
                var hay = r.dataset.find || r.dataset.name;
                var ok = (!text || hay.indexOf(text) >= 0) &&
                    (show === "all" || (show === "online" && r.dataset.online === "1") || (show === "picked" && r.querySelector("input").checked));
                r.hidden = !ok; if (ok) shown++;
            });
            letters.forEach(function (h) { h.hidden = !rows.some(function (r) { return !r.hidden && r.dataset.letter === h.dataset.letter; }); });
            if (none) { none.hidden = shown > 0 || rows.length === 0; none.querySelector("span").textContent = text || (show === "online" ? "online" : show === "picked" ? "picked" : ""); }
            q("[data-pp-shown]").textContent = (text || show !== "all") ? ("Showing " + shown + " of " + rows.length) : (rows.length + (rows.length === 1 ? " person" : " people"));
        }
        var expanded = false;
        // many picked: one row of names and "+14 more" (click to see them all; the box then scrolls)
        function fitChips() {
            var all = Array.prototype.slice.call(chips.querySelectorAll(".sn-pp-chip"));
            var more = chips.querySelector(".sn-pp-more");
            if (more) more.remove();
            all.forEach(function (x) { x.hidden = false; });
            chips.classList.toggle("open", expanded);
            if (all.length < 2) { chips.classList.remove("one-row"); return; }
            if (expanded) {
                chips.classList.remove("one-row");
                var less = document.createElement("button");
                less.type = "button"; less.className = "sn-pp-more less"; less.textContent = "Show less";
                chips.appendChild(less);
                return;
            }
            chips.classList.add("one-row");
            if (!chips.offsetWidth) return;           // dialog not open yet: measured again when it opens
            var limit = chips.getBoundingClientRect().right - 96;   // room for "+N more"
            var hidden = 0;
            all.forEach(function (x) {
                if (hidden || x.getBoundingClientRect().right > limit) { x.hidden = true; hidden++; }
            });
            if (!hidden) { chips.classList.remove("one-row"); return; }
            var b = document.createElement("button");
            b.type = "button"; b.className = "sn-pp-more"; b.textContent = "+" + hidden + " more";
            b.setAttribute("aria-label", "Show all " + all.length + " people you picked");
            chips.appendChild(b);
        }
        // the submit button says how many: <button data-pp-count-for="groupPeople" data-none="Create new group" data-one="…1…" data-many="… {n} …">
        function label(n) {
            document.querySelectorAll('[data-pp-count-for="' + root.id + '"]').forEach(function (btn) {
                var t = n === 0 ? btn.dataset.none : n === 1 ? btn.dataset.one : (btn.dataset.many || "").replace("{n}", n);
                var span = btn.querySelector("[data-pp-label]") || btn;
                if (t) span.textContent = t;
            });
        }
        function render() {
            var picked = rows.filter(function (r) { return r.querySelector("input").checked; });
            counter.textContent = picked.length + " picked";
            counter.classList.toggle("has", picked.length > 0);
            var pn = q("[data-pp-picked-n]"); if (pn) pn.textContent = picked.length ? "· " + picked.length : "";
            var topClear = q(".sn-pp-clear-top"); if (topClear) topClear.hidden = picked.length < 2;
            if (!picked.length) expanded = false;
            label(picked.length);
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
            fitChips();
            if (show === "picked") filter();
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
            if (e.target.closest(".sn-pp-more")) { expanded = !expanded; fitChips(); return; }
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
        root.querySelectorAll("[data-pp-clear]").forEach(function (c) {
            c.addEventListener("click", function () { rows.forEach(function (r) { r.querySelector("input").checked = false; }); render(); });
        });
        // Add a whole team (a department from the Org page)
        root.querySelectorAll("[data-pp-team]").forEach(function (b) {
            b.addEventListener("click", function () {
                var team = b.dataset.ppTeam, n = 0;
                rows.forEach(function (r) { if (r.dataset.dept === team) { var i = r.querySelector("input"); if (!i.checked) { i.checked = true; n++; } } });
                render();
                if (window.Sahyog && Sahyog.toast) Sahyog.toast(n ? n + (n === 1 ? " person" : " people") + " from " + team + " added" : "Everyone in " + team + " is already picked", { kind: n ? "success" : "info" });
            });
        });
        // A–Z bar: jump down the list
        root.querySelectorAll("[data-pp-jump]").forEach(function (b) {
            b.addEventListener("click", function () {
                var h = root.querySelector('.sn-pp-letter[data-letter="' + b.dataset.ppJump + '"]:not([hidden])');
                if (h) listBox.scrollTo({ top: h.offsetTop - listBox.offsetTop, behavior: "smooth" });
            });
        });
        // people already in the group: "See who"
        var tog = q("[data-pp-already-toggle]");
        if (tog) tog.addEventListener("click", function () {
            var l = q("[data-pp-already-list]"), open = l.hidden;
            l.hidden = !open; tog.textContent = open ? "Hide" : "See who"; tog.setAttribute("aria-expanded", open);
        });
        // the chips row is measured when its dialog opens (and when the window changes size)
        var dlg = root.closest("dialog");
        if (dlg && "MutationObserver" in window) new MutationObserver(function () { if (dlg.open) requestAnimationFrame(fitChips); }).observe(dlg, { attributes: true, attributeFilter: ["open"] });
        window.addEventListener("resize", function () { if (root.offsetWidth) fitChips(); });
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
                search.value = ""; show = "all"; expanded = false;
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
