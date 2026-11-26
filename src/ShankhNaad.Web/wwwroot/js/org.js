// ShankhNaad · Org page (Views/Org/Index.cshtml): Chart, Directory, Departments and Insights.
// Moved out of the view so it can be cached, checked and tested on its own. The view writes the page's data
// as JSON (<script type="application/json" id="orgData">) and loads this file; partial navigation (sn-nav.js)
// runs it again each time the Org page is opened. Every handler uses the ".snorg" namespace and is removed
// first, so opening the page twice never doubles them.
(function () {
    // the page's data, written by Views/Org/Index.cshtml into <script type="application/json" id="orgData">
    var DATA_EL = document.getElementById("orgData");
    if (!DATA_EL) return;
    var DATA = JSON.parse(DATA_EL.textContent || "{}");
    var people = DATA.people || [];
    var depts = DATA.depts || [];
    var ME = String(DATA.me || ""), IS_ADMIN = DATA.isAdmin === true;
    var qs = new URLSearchParams(location.search);
    var START = String(DATA.select || ""), START_VIEW = ({ dept: "dept", dir: "dir", ins: "ins" })[qs.get("view")] || "mgr";
    if (location.search) history.replaceState(null, "", location.pathname);

    // ---------- data ----------
    var byId = {}, kids = {};
    people.forEach(function (p) { byId[p.id] = p; });
    function rebuild() {
        kids = {};
        people.forEach(function (p) {
            if (p.mgr && !byId[p.mgr]) p.mgr = "";          // manager not active any more → top of the chart
            if (p.mgr) (kids[p.mgr] = kids[p.mgr] || []).push(p);
        });
    }
    rebuild();
    var deptById = {}; depts.forEach(function (d) { deptById[d.id] = d; });
    // one colour per department (by name), used on the card edge, the tags, the legend and the map
    var PAL = ["#3B82F6", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899", "#06B6D4", "#F97316", "#84CC16"];
    var dcol = {};
    depts.slice().sort(function (a, b) { return a.n.localeCompare(b.n); }).forEach(function (d, i) { dcol[d.id] = PAL[i % PAL.length]; });
    function colorOf(p) { return (p && dcol[p.deptId]) || "#94A3B8"; }
    function deptName(p) { return p.deptId && deptById[p.deptId] ? deptById[p.deptId].n : ""; }

    function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
    function av(p, size) {
        return '<span class="avatar av-' + size + ' tone-' + (p.t % 6) + '" data-presence="' + p.id + '">' + esc(p.i) + '<i class="dot' + (p.on ? " on" : "") + '"></i></span>';
    }
    function sub(p) { return p.title || deptName(p) || (p.admin ? "Admin" : "Team member"); }
    function dpill(p) {
        var d = deptName(p);
        return d ? '<span class="org-dp" style="--dc:' + colorOf(p) + '"><i aria-hidden="true"></i>' + esc(d) + '</span>' : "";
    }
    function teamSize(id) { var n = 0; (kids[id] || []).forEach(function (c) { n += 1 + teamSize(c.id); }); return n; }
    function descendants(id) {
        var out = {}, stack = [id];
        while (stack.length) { (kids[stack.pop()] || []).forEach(function (c) { if (!out[c.id]) { out[c.id] = 1; stack.push(c.id); } }); }
        return out;
    }
    function chainOf(p) {
        var chain = [], guard = 0;
        for (var m = p.mgr; m && byId[m] && guard < 50; m = byId[m].mgr, guard++) chain.unshift(byId[m]);
        return chain;
    }
    function text(p) { return (p.n + " " + p.title + " " + deptName(p) + " " + p.email).toLowerCase(); }
    function byName(a, b) { return a.n.localeCompare(b.n); }

    // ---------- filters (search, department, online, a "needs a look" list) ----------
    var q = "", deptFilter = "", onlineOnly = false, issue = null;   // issue: { label, ids }
    function passes(p) {
        if (deptFilter === "none" ? !!(p.deptId && deptById[p.deptId]) : (deptFilter && p.deptId !== deptFilter)) return false;
        if (onlineOnly && !p.on) return false;
        if (issue && !issue.ids[p.id]) return false;
        return true;
    }
    function filtering() { return !!(q || deptFilter || onlineOnly || issue); }

    // ---------- a person in the chart ----------
    function node(p, cls) {
        var n = (kids[p.id] || []).length;
        return '<div class="org-node' + (cls ? " " + cls : "") + (p.id === ME ? " me" : "") + (cpick[p.id] ? " cpick" : "") + '" aria-pressed="' + !!cpick[p.id] + '" style="--dc:' + colorOf(p) + '" data-id="' + p.id + '" role="button" tabindex="0" aria-label="' + esc(p.n + ", " + sub(p)) + '">' +
            '<i class="org-node-ck" aria-hidden="true"><i class="fa fa-check"></i></i>' + av(p, 38) + '<span class="org-node-t"><b>' + esc(p.n) + '</b><small>' + esc(p.title || (p.admin ? "Admin" : "Team member")) + '</small>' + dpill(p) + '</span>' +
            (n ? '<button type="button" class="org-badge" data-toggle="' + p.id + '" title="' + teamSize(p.id) + ' in ' + esc(p.n.split(" ")[0]) + '\'s team (' + n + ' direct). Click to show or hide them." aria-label="' + n + (n === 1 ? " report" : " reports") + ', show or hide"><i class="fa fa-users" aria-hidden="true"></i> ' + teamSize(p.id) + '</button>' : "") +
            '</div>';
    }

    // ---------- Chart: pick several people (Ctrl/⌘/Shift + click, or "Select several"), then drag them together ----------
    var cpick = {}, selMode = false;
    function cpickIds() { return Object.keys(cpick).filter(function (id) { return byId[id]; }); }
    // the people that actually move: a picked person inside another picked person's team moves with that team
    function cpickTops(ids) {
        return ids.filter(function (id) { return !chainOf(byId[id]).some(function (c) { return cpick[c.id]; }); });
    }
    function csel() {
        var bar = document.getElementById("orgChartSel"); if (!bar) return;
        var ids = cpickIds();
        bar.hidden = !usesCanvas() || !ids.length;
        $("#orgSelMode").toggleClass("on", selMode).attr("aria-pressed", selMode).prop("hidden", !usesCanvas())
            .find("span").text(selMode ? "Done picking" : "Select several");
        vp.classList.toggle("picking", selMode);
        if (!ids.length) return;
        document.getElementById("orgCselN").textContent = ids.length + (ids.length === 1 ? " person picked" : " people picked");
        document.getElementById("orgCselFaces").innerHTML = ids.slice(0, 4).map(function (id) { return av(byId[id], 28); }).join("") + (ids.length > 4 ? '<i>+' + (ids.length - 4) + '</i>' : "");
        Sahyog.paintPhotos && Sahyog.paintPhotos(bar);
    }
    function cToggle(id) {
        if (cpick[id]) delete cpick[id]; else cpick[id] = 1;
        var el = canvas.querySelector('.org-node[data-id="' + id + '"]');
        if (el) { el.classList.toggle("cpick", !!cpick[id]); el.setAttribute("aria-pressed", !!cpick[id]); }
        csel();
    }
    function cClear() { cpick = {}; $(canvas).find(".org-node.cpick").removeClass("cpick").attr("aria-pressed", "false"); csel(); }
    // ---------- Chart: a tree; people whose reports have no reports of their own get a compact column ----------
    var collapsed = {};
    function branch(p, depth) {
        var list = (kids[p.id] || []).slice().sort(byName);
        if (!list.length) return '<li>' + node(p) + '</li>';
        var leafy = list.every(function (c) { return !(kids[c.id] || []).length; });
        var shut = collapsed[p.id] === true || (collapsed[p.id] === undefined && depth >= 4);
        var inner = leafy
            ? '<ul class="org-stack">' + list.map(function (c) { return '<li>' + node(c, "small") + '</li>'; }).join("") + '</ul>'
            : '<ul>' + list.map(function (c) { return branch(c, depth + 1); }).join("") + '</ul>';
        return '<li class="' + (leafy ? "has-stack" : "") + (shut ? " shut" : "") + '" data-li="' + p.id + '">' + node(p) + inner + '</li>';
    }
    function tops() {
        var roots = people.filter(function (p) { return !p.mgr; }).sort(function (a, b) { return (teamSize(b.id) - teamSize(a.id)) || byName(a, b); });
        return { tops: roots.filter(function (p) { return (kids[p.id] || []).length; }), loose: roots.filter(function (p) { return !(kids[p.id] || []).length; }).sort(byName) };
    }
    function drawManagers() {
        var t = tops();
        var h = t.tops.length ? '<ul class="org-tree org-root">' + t.tops.map(function (p) { return branch(p, 1); }).join("") + '</ul>' : "";
        if (t.loose.length) {
            h += '<div class="org-loose"><div class="org-loose-h"><b>' + (t.tops.length ? "Not placed yet" : "Everyone") + '</b><small>' + t.loose.length +
                (t.loose.length === 1 ? " person" : " people") + ' without a manager' + (IS_ADMIN ? " · drag them onto their manager, or use Edit person" : "") + '</small></div>' +
                '<div class="org-loose-grid">' + t.loose.map(function (p) { return node(p, "small"); }).join("") + '</div></div>';
        }
        return h;
    }

    // ---------- Directory: the tree as a table, with tick boxes ----------
    var dirShut = {}, picked = {};
    function dirRows() {
        var out = [];
        if (filtering()) {
            people.filter(function (p) { return passes(p) && (!q || text(p).indexOf(q) >= 0); }).sort(byName).forEach(function (p) { out.push({ p: p, lv: 0, flat: true }); });
            return out;
        }
        function walk(p, lv) {
            out.push({ p: p, lv: lv });
            if (dirShut[p.id]) return;
            (kids[p.id] || []).slice().sort(byName).forEach(function (c) { walk(c, lv + 1); });
        }
        var t = tops();
        t.tops.forEach(function (p) { walk(p, 0); });
        t.loose.forEach(function (p) { walk(p, 0); });
        return out;
    }
    function drawDirectory() {
        var rows = dirRows();
        var allPicked = rows.length && rows.every(function (r) { return picked[r.p.id]; });
        var h = '<div class="org-dir-wrap"><table class="org-dir"><thead><tr>' +
            '<th class="org-dir-ck"><label class="org-ck"><input type="checkbox" data-dir-all' + (allPicked ? " checked" : "") + ' aria-label="Pick everyone shown" /><span></span></label></th>' +
            '<th>Name</th><th>Title</th><th>Department</th><th>Reports to</th><th class="num">Team</th><th>Status</th></tr></thead><tbody>';
        if (!rows.length) h += '<tr><td colspan="7" class="org-dir-empty">No one matches. Clear the search or the filters.</td></tr>';
        rows.forEach(function (r) {
            var p = r.p, n = (kids[p.id] || []).length, team = teamSize(p.id), m = byId[p.mgr];
            h += '<tr data-row="' + p.id + '" class="' + (picked[p.id] ? "picked" : "") + (p.id === selected ? " sel" : "") + '">' +
                '<td class="org-dir-ck"><label class="org-ck"><input type="checkbox" data-dir-pick="' + p.id + '"' + (picked[p.id] ? " checked" : "") + ' aria-label="Pick ' + esc(p.n) + '" /><span></span></label></td>' +
                '<td><div class="org-dir-name" style="padding-left:' + (r.lv * 22) + 'px">' +
                (!r.flat && n ? '<button type="button" class="org-dir-tog' + (dirShut[p.id] ? " shut" : "") + '" data-dir-tog="' + p.id + '" aria-label="' + (dirShut[p.id] ? "Show" : "Hide") + ' ' + esc(p.n.split(" ")[0]) + '\'s team" aria-expanded="' + !dirShut[p.id] + '"><i class="fa fa-angle-down" aria-hidden="true"></i></button>' : '<span class="org-dir-tog-sp"></span>') +
                av(p, 32) + '<span><b>' + esc(p.n) + (p.id === ME ? ' <em>(you)</em>' : "") + '</b><small>' + esc(p.email) + '</small></span></div></td>' +
                '<td>' + esc(p.title || "—") + '</td><td>' + (dpill(p) || '<span class="muted">—</span>') + '</td>' +
                '<td>' + (m ? '<button type="button" class="org-link" data-pick="' + m.id + '">' + esc(m.n) + '</button>' : '<span class="muted">—</span>') + '</td>' +
                '<td class="num">' + (team ? team + (n !== team ? ' <small class="muted">(' + n + ' direct)</small>' : "") : '<span class="muted">—</span>') + '</td>' +
                '<td><span class="org-st' + (p.on ? " on" : "") + '" data-presence-text="' + p.id + '"><i class="org-on-dot' + (p.on ? " on" : "") + '" aria-hidden="true"></i>' + (p.on ? "Online" : "Offline") + '</span></td></tr>';
        });
        h += '</tbody></table></div>';
        var shown = rows.length;
        h = '<div class="org-pane-note">' + shown + ' of ' + people.length + ' people' + (filtering() ? " · filtered, shown A–Z" : " · shown as a tree, managers first") + '</div>' + h;
        return h;
    }
    function bulk() {
        var ids = Object.keys(picked).filter(function (id) { return byId[id]; });
        var bar = document.getElementById("orgBulk");
        bar.hidden = view !== "dir" || !ids.length;
        document.getElementById("orgBulkN").textContent = ids.length + " picked";
        $('[data-org-bulk="mgr"]').prop("disabled", ids.length !== 1).attr("title", ids.length === 1 ? "Choose who " + byId[ids[0]].n.split(" ")[0] + " reports to" : "Pick one person to change their manager");
    }

    // ---------- Departments: one card per department ----------
    var deptOpen = {};
    function drawDeptCards() {
        var total = people.length || 1;
        var cols = depts.slice().sort(function (a, b) { return (b.count - a.count) || a.n.localeCompare(b.n); }).map(function (d) {
            return { id: d.id, n: d.n, head: d.head, list: people.filter(function (p) { return p.deptId === d.id; }) };
        });
        var none = people.filter(function (p) { return !p.deptId || !deptById[p.deptId]; });
        if (none.length) cols.push({ id: "", n: "No department", head: "", list: none });
        var list = issues();
        var top = kpis(list);
        var side = '<aside class="org-dview-side" aria-label="Needs a look"><div class="org-dview-side-h"><b>Needs a look</b>' + (list.length ? '<em class="org-ins-n">' + list.length + '</em>' : "") + '</div>' +
            '<p class="org-dview-side-p">Things that make the chart wrong or confusing. Fix them in one click.</p>' + issueCards(list) + '</aside>';
        if (!cols.length) return '<div class="org-dview"><div class="org-dview-main">' + top + '<p class="org-empty-chart">No departments yet.' + (IS_ADMIN ? " Add one with Departments in the bar above, or import a CSV." : "") + '</p></div>' + side + '</div>';
        return '<div class="org-dview"><div class="org-dview-main">' + top + '<div class="org-dcards">' + cols.map(function (c) {
            var color = c.id ? dcol[c.id] : "#94A3B8";
            var head = c.head && byId[c.head] ? byId[c.head] : null;
            var list = c.list.filter(passes).filter(function (p) { return !q || text(p).indexOf(q) >= 0; });
            var rest = list.filter(function (p) { return !head || p.id !== head.id; }).sort(byName);
            var open = deptOpen[c.id || "none"], showN = open ? rest.length : 5;
            var pct = Math.round(c.list.length / total * 100);
            var managers = c.list.filter(function (p) { return (kids[p.id] || []).length; }).length;
            return '<article class="org-dcard" data-dcol="' + c.id + '" style="--dc:' + color + '">' +
                '<header><span class="org-dcard-ic" aria-hidden="true"><i class="bi bi-briefcase-fill"></i></span><span class="org-dcard-t"><b>' + esc(c.n) + '</b><small>' +
                c.list.length + (c.list.length === 1 ? " person" : " people") + ' · ' + pct + '%' + (managers ? ' · ' + managers + (managers === 1 ? " team" : " teams") : "") + '</small></span>' +
                '<span class="org-dcard-faces" aria-hidden="true">' + c.list.slice().sort(byName).slice(0, 4).map(function (p) { return av(p, 28); }).join("") + (c.list.length > 4 ? '<i>+' + (c.list.length - 4) + '</i>' : "") + '</span>' +
                (IS_ADMIN && c.id ? '<button type="button" class="sn-org-dept-edit" data-dept-edit="' + c.id + '" aria-label="Edit ' + esc(c.n) + '" title="Rename, change head or delete"><i class="fa fa-pencil" aria-hidden="true"></i></button>' : "") + '</header>' +
                '<div class="org-dcard-bar" aria-hidden="true"><span style="width:' + Math.max(pct, 2) + '%"></span></div>' +
                (c.id ? (head ? '<button type="button" class="org-dcard-head' + (head.deptId !== c.id ? " away" : "") + '" data-pick="' + head.id + '">' + av(head, 34) + '<span><small>Head</small><b>' + esc(head.n) + '</b></span><em>' + esc(head.title || "") + '</em></button>' +
                    (head.deptId !== c.id ? '<p class="org-dcard-away"><i class="fa fa-exclamation-triangle" aria-hidden="true"></i><span>Head is in ' + (deptName(head) ? '<b>' + esc(deptName(head)) + '</b>' : "no department") + ', not a member of ' + esc(c.n) + '.</span></p>' : "")
                    : '<div class="org-dcard-head none"><i class="fa fa-user-o" aria-hidden="true"></i><span><small>Head</small><b>No head yet</b></span></div>') : "") +
                '<div class="org-dcard-list">' + rest.slice(0, showN).map(function (p) {
                    var m = byId[p.mgr];
                    return '<button type="button" class="org-dcard-row" data-pick="' + p.id + '">' + av(p, 28) + '<span><b>' + esc(p.n) + '</b><small>' + esc(p.title || "—") + '</small></span>' + (m ? '<em>→ ' + esc(m.n.split(" ")[0]) + '</em>' : "") + '</button>';
                }).join("") +
                (!list.length ? '<p class="org-dcol-empty">' + (c.list.length ? "No one here matches the filters." : "No one here yet.") + '</p>' : "") + '</div>' +
                (rest.length > 5 ? '<button type="button" class="org-link" data-dept-more="' + (c.id || "none") + '">' + (open ? "Show fewer" : "+" + (rest.length - 5) + " more") + '</button>' : "") +
                '</article>';
        }).join("") + '</div></div>' + side + '</div>';
    }

    // ---------- Insights: numbers and "Needs a look" ----------
    function issues() {
        var out = [];
        var t = tops();
        depts.forEach(function (d) {
            var n = people.filter(function (p) { return p.deptId === d.id; }).length;
            var hd = d.head && byId[d.head];
            if (!n && hd) out.push({ kind: "warn", title: "“" + d.n + "” is empty, but " + hd.n + " is its head", text: hd.n.split(" ")[0] + " is in " + (deptName(hd) || "no department") + ", not " + d.n + ", so the head isn't a member here. If “" + d.n + "” is really a job title, delete it and put the title on " + hd.n.split(" ")[0] + " instead. If it is a real department, move " + hd.n.split(" ")[0] + " into it.",
                acts: IS_ADMIN ? [{ t: "Delete it", a: "deldept", id: d.id }, { t: "Move " + hd.n.split(" ")[0] + " here", a: "headin", id: hd.id, dept: d.id }, { t: "Edit", a: "dept", id: d.id }] : [] });
            else if (!n) out.push({ kind: "warn", title: "“" + d.n + "” has nobody in it", text: "An empty department makes the chart and the filters harder to read. If it is really a job title, delete it and put the title on the person instead.", acts: IS_ADMIN ? [{ t: "Delete it", a: "deldept", id: d.id }, { t: "Edit", a: "dept", id: d.id }] : [] });
            else if (!d.head || !byId[d.head]) out.push({ kind: "info", title: d.n + " has no head", text: "Choose who leads it; they are shown first in the department.", acts: IS_ADMIN ? [{ t: "Choose a head", a: "dept", id: d.id }] : [] });
            else if (hd.deptId !== d.id) out.push({ kind: "warn", title: "Head isn't a member of " + d.n, text: hd.n + " leads " + d.n + " but is in " + (deptName(hd) || "no department") + ". Usually the head belongs to the department they lead.", acts: IS_ADMIN ? [{ t: "Move " + hd.n.split(" ")[0] + " here", a: "headin", id: hd.id, dept: d.id }, { t: "Choose another head", a: "dept", id: d.id }] : [] });
        });
        if (depts.length) {
            var noDept = people.filter(function (p) { return !p.deptId || !deptById[p.deptId]; });
            if (noDept.length) out.push({ kind: "warn", title: noDept.length + (noDept.length === 1 ? " person has" : " people have") + " no department", text: noDept.slice(0, 4).map(function (p) { return p.n; }).join(", ") + (noDept.length > 4 ? " and " + (noDept.length - 4) + " more" : "") + ".", acts: [{ t: "Show them", a: "list", ids: noDept, label: "No department" }] });
        }
        if (t.tops.length && t.loose.length) out.push({ kind: "warn", title: t.loose.length + (t.loose.length === 1 ? " person isn't" : " people aren't") + " placed in the chart", text: "They have no manager and no team, so they sit apart. " + (IS_ADMIN ? "Drag them onto their manager in the Chart, or pick them in Directory and use Change manager." : ""), acts: [{ t: "Show them", a: "list", ids: t.loose, label: "Not placed" }] });
        if (t.tops.length > 1) out.push({ kind: "info", title: t.tops.length + " people are at the top of the chart", text: t.tops.map(function (p) { return p.n; }).join(", ") + " have no manager. Most organizations have one person at the top.", acts: [{ t: "Show them", a: "list", ids: t.tops, label: "At the top" }] });
        var noTitle = people.filter(function (p) { return !p.title; });
        if (noTitle.length) out.push({ kind: "info", title: noTitle.length + (noTitle.length === 1 ? " person has" : " people have") + " no job title", text: "A title tells others what someone does, on the chart and in their card.", acts: [{ t: "Show them", a: "list", ids: noTitle, label: "No job title" }] });
        var wide = people.filter(function (p) { return (kids[p.id] || []).length > 10; });
        wide.forEach(function (p) { out.push({ kind: "info", title: p.n + " has " + kids[p.id].length + " direct reports", text: "That is a lot for one manager. A team lead in between can help.", acts: [{ t: "Show the team", a: "pick", id: p.id }] }); });
        return out;
    }
    function depth() {
        var max = 0;
        people.forEach(function (p) { max = Math.max(max, chainOf(p).length + 1); });
        return max;
    }
    function kpis(list) {
        var managers = people.filter(function (p) { return (kids[p.id] || []).length; });
        var avg = managers.length ? (people.filter(function (p) { return p.mgr; }).length / managers.length) : 0;
        var used = depts.filter(function (d) { return people.some(function (p) { return p.deptId === d.id; }); });
        var empty = depts.length - used.length;
        var deepest = people.slice().sort(function (a, b) { return chainOf(b).length - chainOf(a).length; })[0];
        var top = tops().tops[0];
        var online = people.filter(function (p) { return p.on; }).length;
        var now = new Date(), joined = people.filter(function (p) { var d = (p.joined || "").split("-"); return d.length === 3 && +d[1] === now.getMonth() + 1 && +d[2] === now.getFullYear(); }).length;
        var biggest = managers.slice().sort(function (a, b) { return kids[b.id].length - kids[a.id].length; })[0];
        var lv = people.length ? depth() : 0;
        var bars = function (vals, color) {
            var max = Math.max.apply(null, vals.concat([1]));
            return '<span class="org-kpi-bars" aria-hidden="true">' + vals.map(function (v, i) { return '<i style="height:' + Math.max(4, Math.round(v / max * 26)) + 'px;background:' + (typeof color === "function" ? color(i) : color) + '"></i>'; }).join("") + '</span>';
        };
        var kpi = function (icon, color, label, value, sub, viz, cls) {
            return '<div class="org-kpi ' + (cls || "") + '" style="--kc:' + color + '"><div class="org-kpi-h"><span class="org-kpi-ic" aria-hidden="true"><i class="' + icon + '"></i></span><small>' + label + '</small></div>' +
                '<div class="org-kpi-v"><b>' + value + '</b>' + (viz || "") + '</div><span class="org-kpi-s">' + sub + '</span></div>';
        };
        var split = used.length ? '<span class="org-kpi-split" aria-hidden="true">' + used.map(function (d) {
            var n = people.filter(function (p) { return p.deptId === d.id; }).length;
            return '<i style="width:' + (n / people.length * 100).toFixed(1) + '%;background:' + dcol[d.id] + '"></i>';
        }).join("") + '</span>' : "";
        var sizes = managers.map(function (m) { return kids[m.id].length; }).sort(function (a, b) { return b - a; }).slice(0, 6);
        var steps = []; for (var i = 1; i <= Math.min(lv, 8); i++) steps.push(i);
        var h = '<div class="org-kpis">' +
            kpi("bi bi-people", "#3B82F6", "People", people.length, joined ? "+" + joined + " joined this month" : online + " online now",
                '<span class="org-kpi-on"><i></i>' + online + ' online</span>') +
            kpi("bi bi-briefcase", "#10B981", "Departments", depts.length, used.length + " with people" + (empty ? " · " + empty + " empty" : ""), split) +
            kpi("bi bi-person-lines-fill", "#06B6D4", "Average team", avg ? avg.toFixed(1) : "—",
                managers.length + (managers.length === 1 ? " manager" : " managers") + (biggest ? " · largest: " + esc(biggest.n.split(" ")[0]) + " (" + kids[biggest.id].length + ")" : ""), sizes.length ? bars(sizes, "#22D3EE") : "") +
            kpi("bi bi-diagram-3", "#8B5CF6", "Levels", lv, top && deepest && deepest.id !== top.id ? esc(top.n.split(" ")[0]) + " → " + esc(deepest.n) : "from the top down",
                steps.length > 1 ? bars(steps, function (i) { return "hsl(" + (262 - i * 4) + ", 80%, " + (72 - i * 4) + "%)"; }) : "") +
            kpi("bi bi-exclamation-triangle", "#F59E0B", "Needs a look", list.length, list.length ? (list.length === 1 ? "1 thing to fix" : list.length + " things to fix") : "nothing to fix",
                list.length ? '<button type="button" class="org-kpi-fix" data-org-fix>Fix now <i class="fa fa-arrow-right" aria-hidden="true"></i></button>' : '<span class="org-kpi-on"><i></i>All good</span>', list.length ? "warn" : "ok") + '</div>';
        return h;
    }
    function issueCards(list) {
        lastIssues = list;
        if (!list.length) return '<div class="org-ok"><i class="fa fa-check" aria-hidden="true"></i> Everything looks right: every department has people and a head, and everyone has a place in the chart.</div>';
        return '<div class="org-issues">' + list.map(function (it, i) {
            return '<div class="org-issue ' + it.kind + '"><b><i class="fa ' + (it.kind === "warn" ? "fa-exclamation-triangle" : "fa-info-circle") + '" aria-hidden="true"></i>' + esc(it.title) + '</b><p>' + esc(it.text) + '</p>' +
                (it.acts.length ? '<div class="org-issue-acts">' + it.acts.map(function (a, j) { return '<button type="button" class="' + (j ? "sn-org-mini-btn" : "org-act") + '" data-issue="' + i + '" data-act="' + j + '">' + esc(a.t) + '</button>'; }).join("") + '</div>' : "") + '</div>';
        }).join("") + '</div>';
    }
    function drawInsights() {
        var list = issues();
        var h = kpis(list) + '<h3 class="org-ins-h">Needs a look</h3>';
        return h + issueCards(list);
    }
    var lastIssues = [];
    function insightCount() {
        var n = issues().length, t = document.querySelector('#orgTabs .tc-tab[data-tab-id="ins"]');
        if (!t) return;
        var b = t.querySelector(".tc-badge");
        if (!n) { if (b) b.remove(); return; }
        if (!b) { b = document.createElement("span"); b.className = "tc-badge warn"; t.appendChild(b); }
        b.textContent = n;
    }

    // ---------- a phone: step through the chart, one person at a time ----------
    function phone() { return window.matchMedia("(max-width: 700px)").matches; }
    function drawDrill() {
        if (q) {
            var hits = people.filter(function (p) { return passes(p) && text(p).indexOf(q) >= 0; }).sort(byName);
            return '<div class="org-drill"><div class="org-sec">' + hits.length + (hits.length === 1 ? " match" : " matches") + '</div>' +
                (hits.length ? hits.map(function (p) { return drillRow(p); }).join("") : '<p class="sn-org-empty">No one matches.</p>') + '</div>';
        }
        var p = byId[selected] || tops().tops[0] || people[0];
        if (!p) return '<p class="sn-org-empty">No one here yet.</p>';
        var m = byId[p.mgr], team = (kids[p.id] || []).slice().sort(byName);
        var peers = m ? (kids[m.id] || []).filter(function (c) { return c.id !== p.id; }) : [];
        var h = '<div class="org-drill">';
        if (m) h += '<button type="button" class="org-drill-up" data-pick="' + m.id + '"><i class="fa fa-level-up" aria-hidden="true"></i>' + av(m, 28) + '<span><small>Reports to</small><b>' + esc(m.n) + '</b></span></button>';
        h += '<div class="org-drill-focus" style="--dc:' + colorOf(p) + '"><div class="org-drill-who">' + av(p, 56) + '<span><b>' + esc(p.n) + (p.id === ME ? ' <em>(you)</em>' : "") + '</b><small>' + esc(p.title || "") + '</small>' + dpill(p) + '</span></div>' +
            '<div class="org-drill-acts">' + (p.id !== ME ? '<button type="button" data-org-chat="' + p.id + '"><i class="fa fa-comment" aria-hidden="true"></i> Chat</button><button type="button" data-org-call="' + p.id + '"><i class="fa fa-phone" aria-hidden="true"></i> Call</button>' : "") +
            '<button type="button" data-org-cardjump><i class="fa fa-id-card-o" aria-hidden="true"></i> Card</button></div></div>';
        h += '<div class="org-sec">Team · ' + team.length + ' direct' + (teamSize(p.id) !== team.length ? ", " + teamSize(p.id) + " in all" : "") + '</div>';
        h += team.length ? team.map(function (c) { return drillRow(c); }).join("") : '<p class="sn-org-empty">No one reports to ' + esc(p.n.split(" ")[0]) + '.</p>';
        if (peers.length) h += '<div class="org-sec">Works with · same manager</div><div class="org-drill-peers">' + peers.sort(byName).map(function (c) { return '<button type="button" data-pick="' + c.id + '">' + av(c, 26) + esc(c.n) + '</button>'; }).join("") + '</div>';
        return h + '</div>';
    }
    function drillRow(p) {
        var t = teamSize(p.id);
        return '<button type="button" class="org-drill-row" style="--dc:' + colorOf(p) + '" data-pick="' + p.id + '">' + av(p, 40) + '<span><b>' + esc(p.n) + '</b><small>' + esc(sub(p)) + '</small></span>' +
            (t ? '<em><i class="fa fa-users" aria-hidden="true"></i> ' + t + '</em>' : "") + '<i class="fa fa-angle-right" aria-hidden="true"></i></button>';
    }

    // ---------- draw the current view ----------
    var view = START_VIEW, selected = null;
    var vp = document.getElementById("orgViewport"), canvas = document.getElementById("orgCanvas"), pane = document.getElementById("orgPane");
    var main = document.querySelector(".sn-org-main");
    function usesCanvas() { return view === "mgr" && !phone(); }
    function draw(keepPos) {
        var chart = usesCanvas();
        main.setAttribute("data-view", chart ? "mgr" : view === "mgr" ? "drill" : view);
        vp.hidden = !chart; pane.hidden = chart;
        var tc = $("#orgTabs").data("tc-api");
        if (tc && tc.getActive() && tc.getActive().id !== view) tc.select(view);
        if (chart) {
            canvas.innerHTML = drawManagers();
            if (selected) markPath();
            applySearch();
            Sahyog.paintPhotos && Sahyog.paintPhotos(canvas);
            if (!keepPos) requestAnimationFrame(function () { fit(true); });
            else requestAnimationFrame(minimap);
        } else {
            var top = keepPos ? pane.scrollTop : 0;
            pane.innerHTML = view === "dir" ? drawDirectory() : view === "dept" ? drawDeptCards() : view === "ins" ? drawInsights() : drawDrill();
            pane.scrollTop = top;
            Sahyog.paintPhotos && Sahyog.paintPhotos(pane);
        }
        Sahyog.paintPresence && Sahyog.paintPresence();
        path(); legend(); filterUi(); bulk(); csel(); insightCount();
    }

    // ---------- the bar under the tabs: path, filters, colour key ----------
    function path() {
        var el = document.getElementById("orgPath"), p = byId[selected];
        if (!p || view === "ins" || view === "dept") { el.innerHTML = ""; return; }
        el.innerHTML = chainOf(p).map(function (c) { return '<button type="button" data-pick="' + c.id + '">' + esc(c.n) + '</button><i class="fa fa-angle-right" aria-hidden="true"></i>'; }).join("") + '<b>' + esc(p.n) + '</b>';
    }
    function legend() {
        var el = document.getElementById("orgLegend");
        var used = depts.filter(function (d) { return people.some(function (p) { return p.deptId === d.id; }); }).sort(function (a, b) { return a.n.localeCompare(b.n); });
        el.innerHTML = view === "mgr" || view === "dept" ? used.map(function (d) {
            return '<button type="button" class="org-dp' + (deptFilter === d.id ? " on" : "") + '" style="--dc:' + dcol[d.id] + '" data-legend="' + d.id + '" title="Show only ' + esc(d.n) + '"><i aria-hidden="true"></i>' + esc(d.n) + '</button>';
        }).join("") : "";
    }
    function filterUi() {
        var d = deptFilter === "none" ? "No department" : deptFilter && deptById[deptFilter] ? deptById[deptFilter].n : "All";
        $("#orgDeptFilter span").text("Department: " + d);
        $("#orgDeptFilter").toggleClass("on", !!deptFilter);
        $("#orgOnlineFilter").attr("aria-pressed", onlineOnly ? "true" : "false").toggleClass("on", onlineOnly);
        $("#orgIssueFilter").prop("hidden", !issue).addClass("on").find("span").text(issue ? issue.label : "");
        document.getElementById("orgSub").hidden = view === "ins";
        $(".org-filters").prop("hidden", view === "ins");
        // Expand all / Collapse: only where there is a tree (the Chart, and Directory when not filtered)
        var tree = (view === "mgr" && usesCanvas()) || (view === "dir" && !filtering());
        $("#orgTreeBtns").prop("hidden", !tree);
        $("[data-org-tree]").each(function () { var on = treeState === this.getAttribute("data-org-tree"); $(this).toggleClass("on", on).attr("aria-pressed", on); });
    }
    // ---------- open every team, or close everything below the first level ----------
    var treeState = null;
    function openTree(mode) {
        var tops1 = {};
        tops().tops.concat(tops().loose).forEach(function (p) { tops1[p.id] = 1; });
        people.forEach(function (p) {
            if (!(kids[p.id] || []).length) return;
            var shut = mode === "top" && !tops1[p.id];
            if (view === "dir") dirShut[p.id] = shut;
            else collapsed[p.id] = shut;
        });
        treeState = mode;
        draw(view !== "mgr");
        Sahyog.toast(mode === "all" ? "Every team is open." : "Showing the top of the chart and their direct reports.", { kind: "info", ms: 1800 });
    }

    // ---------- zoom and move ----------
    var z = 1, x = 0, y = 0;
    function apply() {
        canvas.style.transform = "translate(" + x + "px," + y + "px) scale(" + z + ")";
        document.getElementById("orgZoomText").textContent = Math.round(z * 100) + "%";
        miniView();
    }
    function zoomAt(nz, cx, cy) {
        nz = Math.max(.3, Math.min(1.8, nz));
        var r = vp.getBoundingClientRect();
        if (cx == null) { cx = r.width / 2; cy = r.height / 2; }
        x = cx - (cx - x) * nz / z; y = cy - (cy - y) * nz / z; z = nz; apply();
    }
    function fit(onlyShrink) {
        settle();
        var w = canvas.scrollWidth, h = canvas.scrollHeight, r = vp.getBoundingClientRect();
        if (!w || !h || !r.width) return;
        var s = Math.min((r.width - 40) / w, (r.height - 40) / h);
        z = Math.max(.3, Math.min(onlyShrink ? 1 : 1.4, s));
        x = (r.width - w * z) / 2; y = onlyShrink ? 16 : Math.max(16, (r.height - h * z) / 2);
        apply(); minimap();
    }
    // stop any glide first, so positions are read from where the chart really ends up
    function settle() { canvas.classList.remove("glide"); apply(); void canvas.offsetWidth; }
    function glide() { canvas.classList.add("glide"); apply(); clearTimeout(window.__snOrgGl); window.__snOrgGl = setTimeout(function () { canvas.classList.remove("glide"); }, 320); }
    function centerOn(id) {
        if (!usesCanvas()) return;
        var el = canvas.querySelector('.org-node[data-id="' + id + '"]');
        if (!el) return;
        settle();
        // a big chart fitted on screen is too small to read: going to someone zooms in to a readable size
        if (z < .85) { z = .85; apply(); }
        var r = vp.getBoundingClientRect(), e = el.getBoundingClientRect();
        x += (r.left + r.width / 2) - (e.left + e.width / 2);
        y += (r.top + r.height / 2) - (e.top + e.height / 2);
        glide();
    }

    // ---------- the small map of the whole chart (bottom right) ----------
    var mini = document.getElementById("orgMini"), miniScale = 1, miniPad = 8;
    function minimap() {
        if (!usesCanvas()) return;
        var cw = canvas.scrollWidth, ch = canvas.scrollHeight;
        var big = people.length > 6;
        mini.hidden = !big || !cw;
        if (mini.hidden) return;
        var W = 150, H = 96;
        miniScale = Math.min((W - miniPad * 2) / cw, (H - miniPad * 2) / ch);
        var cr = canvas.getBoundingClientRect(), h = "";
        canvas.querySelectorAll(".org-node").forEach(function (el) {
            var r = el.getBoundingClientRect(), p = byId[el.getAttribute("data-id")];
            var nx = (r.left - cr.left) / z, ny = (r.top - cr.top) / z;
            h += '<i style="left:' + (miniPad + nx * miniScale).toFixed(1) + 'px;top:' + (miniPad + ny * miniScale).toFixed(1) + 'px;width:' + Math.max(3, r.width / z * miniScale).toFixed(1) +
                'px;height:' + Math.max(2, r.height / z * miniScale).toFixed(1) + 'px;background:' + colorOf(p) + (el.classList.contains("sel") ? ";outline:1.5px solid #fff" : "") + '"></i>';
        });
        mini.innerHTML = h + '<b class="org-mini-view"></b>';
        miniView();
    }
    function miniView() {
        if (!mini || mini.hidden) return;
        var v = mini.querySelector(".org-mini-view"); if (!v) return;
        var r = vp.getBoundingClientRect();
        var l = miniPad + (-x / z) * miniScale, t = miniPad + (-y / z) * miniScale;
        v.style.left = l + "px"; v.style.top = t + "px";
        v.style.width = (r.width / z * miniScale) + "px"; v.style.height = (r.height / z * miniScale) + "px";
    }
    mini.addEventListener("click", function (e) {
        var mr = mini.getBoundingClientRect(), r = vp.getBoundingClientRect();
        var cx = (e.clientX - mr.left - miniPad) / miniScale, cy = (e.clientY - mr.top - miniPad) / miniScale;
        settle(); x = r.width / 2 - cx * z; y = r.height / 2 - cy * z; glide();
    });

    // ---------- move the chart by dragging the background; move a person by dragging them onto someone ----------
    var drag = null, pdrag = null, justDragged = 0;
    vp.addEventListener("pointerdown", function (e) {
        if (e.button !== 0) return;
        var nodeEl = e.target.closest(".org-node");
        if (nodeEl && IS_ADMIN && !e.target.closest(".org-badge")) { pdrag = { id: nodeEl.getAttribute("data-id"), sx: e.clientX, sy: e.clientY, on: false, pid: e.pointerId }; return; }
        if (e.target.closest(".org-node, button, a, input")) return;
        drag = { sx: e.clientX, sy: e.clientY, x: x, y: y, id: e.pointerId };
        vp.setPointerCapture(e.pointerId); vp.classList.add("dragging");
    });
    vp.addEventListener("pointermove", function (e) {
        if (pdrag && e.pointerId === pdrag.pid) { personMove(e); return; }
        if (!drag || e.pointerId !== drag.id) return;
        x = drag.x + e.clientX - drag.sx; y = drag.y + e.clientY - drag.sy; apply();
    });
    function endDrag() { drag = null; vp.classList.remove("dragging"); }
    vp.addEventListener("pointerup", function (e) { if (pdrag && e.pointerId === pdrag.pid) personDrop(e); endDrag(); });
    vp.addEventListener("pointercancel", function () { personCancel(); endDrag(); });
    vp.addEventListener("wheel", function (e) {
        var r = vp.getBoundingClientRect();
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomAt(z * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top); }
        else { e.preventDefault(); x -= e.deltaX; y -= e.deltaY; apply(); }
    }, { passive: false });

    var ghost = null, below = {}, target = null;
    function personMove(e) {
        if (!pdrag.on) {
            if (Math.abs(e.clientX - pdrag.sx) + Math.abs(e.clientY - pdrag.sy) < 8) return;
            pdrag.on = true;
            vp.setPointerCapture(e.pointerId);
            var p = byId[pdrag.id];
            // dragging a picked person carries every picked person; dragging anyone else carries just them
            pdrag.ids = cpick[p.id] && cpickIds().length > 1 ? cpickTops(cpickIds()) : [p.id];
            if (pdrag.ids.indexOf(p.id) < 0) pdrag.ids.unshift(p.id);
            below = {}; pdrag.self = {};
            pdrag.ids.forEach(function (id) { pdrag.self[id] = 1; var d = descendants(id); Object.keys(d).forEach(function (k) { below[k] = id; }); });
            var many = pdrag.ids.length > 1;
            ghost = document.createElement("div");
            ghost.className = "org-ghost" + (many ? " many" : "");
            ghost.innerHTML = (many ? '<span class="org-ghost-faces">' + pdrag.ids.slice(0, 3).map(function (id) { return av(byId[id], 30); }).join("") + '</span>' : av(p, 30)) +
                '<span><b>' + (many ? pdrag.ids.length + " people" : esc(p.n)) + '</b><small>Drop on their new manager</small></span>';
            document.body.appendChild(ghost);
            Sahyog.paintPhotos && Sahyog.paintPhotos(ghost);
            pdrag.ids.forEach(function (id) { var el = canvas.querySelector('.org-node[data-id="' + id + '"]'); if (el) el.classList.add("lifted"); });
            vp.classList.add("moving");
        }
        ghost.style.left = (e.clientX + 14) + "px"; ghost.style.top = (e.clientY + 10) + "px";
        ghost.style.display = "none";
        var hit = document.elementFromPoint(e.clientX, e.clientY);
        ghost.style.display = "";
        var t = hit && hit.closest && hit.closest("#orgCanvas .org-node");
        var id = t ? t.getAttribute("data-id") : null;
        var ids = pdrag.ids, one = ids.length === 1, first = byId[ids[0]].n.split(" ")[0];
        var already = id && ids.every(function (k) { return byId[k].mgr === id; });
        var ok = id && !pdrag.self[id] && !below[id] && !already;
        if (target && target !== t) target.classList.remove("drop", "nodrop");
        target = t || null;
        if (t) t.classList.add(ok ? "drop" : "nodrop");
        var who = one ? first : ids.length + " people";
        ghost.querySelector("small").textContent = !t ? "Drop on their new manager" : ok ? who + (one ? " will report to " : " will report to ") + byId[id].n
            : pdrag.self[id] ? "Drop on someone else" : already ? (one ? "Already their manager" : "Already manager of all of them")
            : "Can't: " + byId[id].n.split(" ")[0] + " is in " + byId[below[id]].n.split(" ")[0] + "'s team";
    }
    function personCancel() {
        if (ghost) ghost.remove(); ghost = null;
        if (target) target.classList.remove("drop", "nodrop"); target = null;
        $(canvas).find(".org-node.lifted").removeClass("lifted");
        vp.classList.remove("moving");
        pdrag = null;
    }
    function personDrop() {
        var was = pdrag, t = target;
        var ok = was && was.on && t && t.classList.contains("drop");
        if (was && was.on) justDragged = Date.now();
        personCancel();
        if (ok) {
            var to = t.getAttribute("data-id");
            var ids = was.ids.filter(function (k) { return byId[k].mgr !== to; });
            move(ids, { mgr: to }).then(function () { if (was.ids.length > 1) { selMode = false; cClear(); } });
        }
    }

    // ---------- change manager / department, with Undo ----------
    function post(url, fields) {
        var fd = new FormData();
        Object.keys(fields).forEach(function (k) { [].concat(fields[k]).forEach(function (v) { fd.append(k, v); }); });
        fd.append("__RequestVerificationToken", token());
        return fetch(url, { method: "POST", body: fd, headers: { RequestVerificationToken: token() } }).then(function (r) { return r.json(); });
    }
    function move(ids, to, quiet) {
        var before = ids.map(function (id) { return { id: id, mgr: byId[id].mgr, dept: byId[id].deptId }; });
        var fields = { ids: ids };
        if ("mgr" in to) fields.managerId = to.mgr || "";
        if ("dept" in to) fields.departmentId = to.dept || "";
        return post("/org/move", fields).then(function (res) {
            if (!res.ok) { Sahyog.toast((res.errors && res.errors[0]) || res.error || "Nothing was changed.", { kind: "error", title: "Not moved" }); return; }
            ids.forEach(function (id) { if ("mgr" in to) byId[id].mgr = to.mgr || ""; if ("dept" in to) byId[id].deptId = to.dept || ""; });
            rebuild(); recount(); draw(true); card();
            if (quiet) return;
            var who = ids.length === 1 ? byId[ids[0]].n : ids.length + " people";
            var what = "mgr" in to ? (to.mgr ? (ids.length === 1 ? " now reports to " : " now report to ") + byId[to.mgr].n : (ids.length === 1 ? " is" : " are") + " now at the top of the chart")
                : (to.dept ? (ids.length === 1 ? " is" : " are") + " now in " + deptById[to.dept].n : (ids.length === 1 ? " has" : " have") + " no department now");
            Sahyog.toast(who + what + "." + (res.errors && res.errors.length ? " " + res.errors.length + " couldn't be moved: " + res.errors[0] : ""), {
                kind: res.errors && res.errors.length ? "warn" : "success", title: "Moved", ms: 10000,
                action: { text: "Undo", onClick: function () { undo(before, "mgr" in to); } }
            });
        }).catch(function () { Sahyog.toast("The change couldn't be saved. Check your connection and try again.", { kind: "error", title: "Not moved" }); });
    }
    function undo(before, mgr) {
        // one request per old value, so everyone goes back to where they were
        var groups = {};
        before.forEach(function (b) { var k = mgr ? b.mgr : b.dept; (groups[k] = groups[k] || []).push(b.id); });
        var jobs = Object.keys(groups).map(function (k) { return move(groups[k], mgr ? { mgr: k } : { dept: k }, true); });
        Promise.all(jobs).then(function () { Sahyog.toast("Put back as it was.", { kind: "success" }); });
    }
    function recount() { depts.forEach(function (d) { d.count = people.filter(function (p) { return p.deptId === d.id; }).length; }); }

    // ---------- search ----------
    function applySearch() {
        if (!usesCanvas()) return;
        canvas.querySelectorAll(".org-node").forEach(function (el) {
            var p = byId[el.getAttribute("data-id")];
            var hit = q && p && text(p).indexOf(q) >= 0;
            el.classList.toggle("hit", !!hit);
            el.classList.toggle("dim", !!p && ((!!q && !hit) || !passes(p)));
        });
    }
    function openTo(match) {
        people.forEach(function (p) {
            if (!match(p)) return;
            for (var m = p.mgr, guard = 0; m && guard < 100; m = (byId[m] || {}).mgr, guard++) collapsed[m] = false;
        });
    }
    $(document).off(".snorg");
    // move to department
    $(document).on("click.snorg", "#mdList [data-md]", function () { var id = this.getAttribute("data-md"); md.pick = md.pick === id ? undefined : id; var t = document.getElementById("mdList").scrollTop; mdRender(); document.getElementById("mdList").scrollTop = t; });
    $(document).on("input.snorg", "#mdFind", function () { mdRender(); });
    $(document).on("change.snorg", "#mdTeam", function () { md.team = this.checked; mdRender(); });
    // chart picks (pick several, then drag them together)
    $(document).on("click.snorg", "#orgSelMode", function () { selMode = !selMode; if (!selMode && !cpickIds().length) cClear(); csel(); });
    $(document).on("click.snorg", "[data-csel]", function () {
        var a = this.getAttribute("data-csel");
        if (a === "clear") { selMode = false; cClear(); }
        if (a === "dept") openMove(cpickIds(), "dept");
    });
    $(document).on("keydown.snorg", function (e) {
        if (e.key === "Escape" && usesCanvas() && cpickIds().length && !document.querySelector("dialog[open]")) { selMode = false; cClear(); }
    });

    $(document).on("input.snorg", "#orgSearch", function () {
        q = this.value.trim().toLowerCase();
        if (usesCanvas()) {
            if (q) { openTo(function (p) { return text(p).indexOf(q) >= 0; }); draw(true); } else applySearch();
            var first = canvas.querySelector(".org-node.hit");
            if (first) centerOn(first.getAttribute("data-id"));
        } else draw(true);
    });
    $(document).on("keydown.snorg", "#orgSearch", function (e) {
        if (e.key !== "Enter") return;
        var hit = people.filter(function (p) { return q && passes(p) && text(p).indexOf(q) >= 0; }).sort(byName)[0];
        if (hit) { if (phone() && view === "mgr") { this.value = ""; q = ""; } select(hit.id, true); }
    });
    $(document).on("click.snorg", "[data-org-zoom]", function () {
        var v = this.getAttribute("data-org-zoom");
        if (v === "fit") fit(false); else zoomAt(z * (v === "1" ? 1.2 : 1 / 1.2));
    });
    // ---------- changing tab: the old view slides out, the new one slides in (like changing page), cards rise one by one ----------
    var ORDER = { mgr: 0, dir: 1, dept: 2, ins: 3 }, going = null;
    function still() { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
    function slideIn(el, dir) {
        if (still() || !el) return;
        el.classList.remove("org-in-next", "org-in-prev", "org-out-next", "org-out-prev");
        void el.offsetWidth;
        el.classList.add("org-in-" + dir);
        clearTimeout(el.__snIn); el.__snIn = setTimeout(function () { el.classList.remove("org-in-next", "org-in-prev"); }, 1100);
    }
    function go(v, after) {
        if (v === view) { if (after) after(); return; }
        var dir = ORDER[v] > ORDER[view] ? "next" : "prev", from = usesCanvas() ? vp : pane;
        var swap = function () {
            from.classList.remove("org-out-next", "org-out-prev");
            view = v; draw();
            slideIn(usesCanvas() ? vp : pane, dir);
            if (selected && usesCanvas()) setTimeout(function () { centerOn(selected); }, 80);
            if (after) setTimeout(after, 120);
        };
        clearTimeout(going);
        if (still()) { swap(); return; }
        from.classList.remove("org-in-next", "org-in-prev");
        from.classList.add("org-out-" + dir);
        // swap when the slide-out has really played (a busy first frame can delay it), at most 320 ms
        var done = false, once = function (e) {
            if (done || (e && e.target !== from)) return;
            done = true; from.removeEventListener("animationend", once); clearTimeout(going); swap();
        };
        from.addEventListener("animationend", once);
        going = setTimeout(once, 320);
    }
    $(document).on("tabcontrol:select.snorg", "#orgTabs", function (e, v) {
        if (!v || v === view) return;
        go(v);
    });

    // ---------- filters ----------
    function refilter() {
        if (usesCanvas()) { if (filtering()) openTo(passes); draw(true); } else draw(true);
    }
    $(document).on("click.snorg", "#orgDeptFilter", function () {
        var items = [{ label: "All departments", icon: "fa fa-th-large", run: function () { deptFilter = ""; refilter(); } }, "sep"];
        depts.slice().sort(function (a, b) { return a.n.localeCompare(b.n); }).forEach(function (d) {
            items.push({ label: d.n, sub: d.count + (d.count === 1 ? " person" : " people"), icon: "fa fa-circle", kind: "", run: function () { deptFilter = d.id; refilter(); } });
        });
        items.push({ label: "No department", icon: "fa fa-circle-o", run: function () { deptFilter = "none"; refilter(); } });
        SN.openMenu(this, { name: "Show a department", sub: "Others are dimmed in the chart" }, items);
    });
    $(document).on("click.snorg", "#orgOnlineFilter", function () { onlineOnly = !onlineOnly; refilter(); });
    $(document).on("click.snorg", "#orgIssueFilter", function () { issue = null; refilter(); });
    $(document).on("click.snorg", "[data-legend]", function () { var id = this.getAttribute("data-legend"); deptFilter = deptFilter === id ? "" : id; refilter(); });

    // ---------- select a person → profile card ----------
    function miniP(p, extra) {
        return '<button type="button" class="org-mini" data-pick="' + p.id + '">' + av(p, 32) + '<span><b>' + esc(p.n) + '</b><small>' + esc(sub(p)) + (extra || "") + '</small></span></button>';
    }
    function tenure(p) {
        if (!p.joined) return "";
        var parts = p.joined.split("-"); if (parts.length !== 3) return "";
        var d = new Date(+parts[2], +parts[1] - 1, +parts[0]), now = new Date();
        var months = (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth();
        if (months < 1) return "new";
        return months < 12 ? months + (months === 1 ? " month" : " months") : Math.floor(months / 12) + (months >= 24 ? " years" : " year");
    }
    function card() {
        var el = document.getElementById("orgCard"), p = byId[selected];
        if (!p) { el.innerHTML = '<p class="sn-org-empty">Click a person to see their card.</p>'; return; }
        var chain = chainOf(p);
        var peers = p.mgr ? (kids[p.mgr] || []).filter(function (c) { return c.id !== p.id; }).sort(byName) : [];
        var reports = (kids[p.id] || []).slice().sort(byName);
        var line = [p.title, deptName(p)].filter(Boolean).join(" · ") || (p.admin ? "Admin" : "Team member");
        var h = '<div class="org-card-cover" style="--dc:' + colorOf(p) + '"></div><div class="org-card-top">' + av(p, 64) + '</div>' +
            '<div class="org-card-who"><div class="org-card-name"><b>' + esc(p.n) + (p.id === ME ? ' <em>(you)</em>' : "") + '</b>' +
            (IS_ADMIN ? '<button type="button" class="org-card-edit" data-org-edit="' + p.id + '" title="Edit ' + esc(p.n) + '" aria-label="Edit ' + esc(p.n) + '"><i class="fa fa-pencil" aria-hidden="true"></i> Edit</button>' : "") + '</div><span>' + esc(line) + '</span><div class="org-card-tags">' +
            '<span class="org-st' + (p.on ? " on" : "") + '" data-presence-text="' + p.id + '"><i class="org-on-dot' + (p.on ? " on" : "") + '" aria-hidden="true"></i>' + (p.on ? "Online" : "Offline") + '</span>' +
            (p.admin ? '<span class="org-tag">Workspace admin</span>' : "") + '</div></div>';
        h += '<div class="org-quick">';
        if (p.id !== ME) h += '<button type="button" data-org-chat="' + p.id + '"><i class="fa fa-comment" aria-hidden="true"></i><span>Chat</span></button>' +
            '<button type="button" data-org-call="' + p.id + '" title="Sound only; turn video on any time"><i class="fa fa-phone" aria-hidden="true"></i><span>Call</span></button>' +
            '<button type="button" data-org-video="' + p.id + '"><i class="fa fa-video-camera" aria-hidden="true"></i><span>Video</span></button>';
        h += '<a href="mailto:' + esc(p.email) + '"><i class="fa fa-envelope" aria-hidden="true"></i><span>Email</span></a></div>';
        h += '<div class="org-sec">Reporting line</div>';
        h += '<div class="org-line">' + chain.map(function (c, i) { return miniP(c, i === chain.length - 1 ? " · manager" : ""); }).join("") +
            '<div class="org-line-me">' + av(p, 32) + '<span><b>' + esc(p.n) + '</b><small>' + (chain.length ? "Level " + (chain.length + 1) : "Top of the chart") + '</small></span></div>' +
            (reports.length ? '<div class="org-line-down"><i class="fa fa-level-down" aria-hidden="true"></i> ' + reports.length + ' direct' + (teamSize(p.id) !== reports.length ? " · " + teamSize(p.id) + " in the team" : "") + '</div>' : "") + '</div>';
        if (reports.length) h += '<div class="org-sec">Direct reports · ' + reports.length + '</div><div class="org-minis">' + reports.slice(0, 8).map(function (c) { return miniP(c); }).join("") + (reports.length > 8 ? '<span class="org-more">+' + (reports.length - 8) + ' more</span>' : "") + '</div>';
        var fact = function (label, value) { return '<div class="org-fact"><small>' + label + '</small><b>' + value + '</b></div>'; };
        h += '<div class="org-sec">Details</div><div class="org-facts">' +
            fact("Email", '<a href="mailto:' + esc(p.email) + '">' + esc(p.email) + '</a>') +
            fact("Phone", p.phone ? '<a href="tel:' + esc(p.phone.replace(/\s+/g, "")) + '">' + esc(p.phone) + '</a>' : '<span class="muted">—</span>') +
            fact("Employee ID", p.emp ? esc(p.emp) : '<span class="muted">—</span>') +
            fact("Joined", p.joinedText ? esc(p.joinedText) + (tenure(p) ? ' <span class="muted">· ' + tenure(p) + '</span>' : "") : '<span class="muted">—</span>') + '</div>';
        h += '<div class="org-sec">Works with · same manager</div>';
        h += peers.length ? '<div class="org-minis">' + peers.slice(0, 6).map(function (c) { return miniP(c); }).join("") + (peers.length > 6 ? '<span class="org-more">+' + (peers.length - 6) + ' more</span>' : "") + '</div>'
            : '<p class="sn-org-empty">' + (p.mgr ? "No one else reports to " + esc(byId[p.mgr].n) + "." : "No manager set, so no teammates to show.") + '</p>';
        el.innerHTML = h;
        Sahyog.paintPhotos && Sahyog.paintPhotos(el);
        if (el.getAttribute("data-who") !== p.id) {   // another person: their card rises in
            el.setAttribute("data-who", p.id);
            if (!still()) { el.classList.remove("org-card-in"); void el.offsetWidth; el.classList.add("org-card-in"); }
        }
    }
    var sideNow = "card";
    function side(which) {
        var dir = which === sideNow ? "" : which === "depts" ? "next" : "prev";
        sideNow = which;
        $("[data-side]").each(function () { this.setAttribute("aria-selected", this.getAttribute("data-side") === which ? "true" : "false"); });
        $("[data-side-pane]").each(function () { this.hidden = this.getAttribute("data-side-pane") !== which; });
        var body = document.getElementById("orgSideBody"); if (body) body.scrollTop = 0;
        if (dir) slideIn(document.querySelector('[data-side-pane="' + which + '"]'), dir);
        fade();
    }
    // a soft fade at the bottom tells there is more, instead of a scrollbar
    function fade() {
        var b = document.getElementById("orgSideBody"); if (!b) return;
        b.classList.toggle("more", b.scrollHeight - b.scrollTop - b.clientHeight > 8);
    }
    $(document).on("click.snorg", "[data-side]", function () { side(this.getAttribute("data-side")); });
    $("#orgSideBody").on("scroll", fade);
    function markPath() {
        $(canvas).find(".org-node.sel, .org-node.path").removeClass("sel path");
        var p = byId[selected]; if (!p) return;
        chainOf(p).forEach(function (c) { var e = canvas.querySelector('.org-node[data-id="' + c.id + '"]'); if (e) e.classList.add("path"); });
        var el = canvas.querySelector('.org-node[data-id="' + p.id + '"]'); if (el) el.classList.add("sel");
    }
    function select(id, center) {
        if (!byId[id]) return;
        selected = id;
        if (usesCanvas()) {
            var el = canvas.querySelector('.org-node[data-id="' + id + '"]');
            if (!el) { for (var m = byId[id].mgr, g = 0; m && g < 100; m = (byId[m] || {}).mgr, g++) collapsed[m] = false; draw(true); }
            markPath(); minimap();
            if (center) centerOn(id);
        } else if (view === "mgr") { draw(); }
        else { $(pane).find("tr.sel").removeClass("sel"); $(pane).find('tr[data-row="' + id + '"]').addClass("sel"); }
        path(); card(); side("card");
    }
    $(document).on("click.snorg", "#orgCanvas .org-node", function (e) {
        if (e.target.closest(".org-badge") || Date.now() - justDragged < 300) return;
        if (IS_ADMIN && (selMode || e.ctrlKey || e.metaKey || e.shiftKey)) { e.preventDefault(); cToggle(this.getAttribute("data-id")); return; }
        select(this.getAttribute("data-id"));
    });
    $(document).on("keydown.snorg", "#orgCanvas .org-node", function (e) {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (IS_ADMIN && (selMode || e.ctrlKey || e.metaKey || e.shiftKey)) cToggle(this.getAttribute("data-id")); else select(this.getAttribute("data-id"));
        }
    });
    $(document).on("dblclick.snorg", "#orgCanvas .org-node", function () { if (IS_ADMIN && !selMode) snOrgEdit(this.getAttribute("data-id")); });
    $(document).on("click.snorg", "#orgCanvas .org-badge", function (e) {
        e.stopPropagation();
        var id = this.getAttribute("data-toggle"), li = canvas.querySelector('li[data-li="' + id + '"]');
        collapsed[id] = !(li && li.classList.contains("shut")); treeState = null;
        // keep the clicked person where they are on screen while the branch opens or closes
        settle();
        var before = canvas.querySelector('.org-node[data-id="' + id + '"]').getBoundingClientRect();
        draw(true);
        var after = canvas.querySelector('.org-node[data-id="' + id + '"]').getBoundingClientRect();
        x += before.left - after.left; y += before.top - after.top; apply(); minimap();
    });
    $(document).on("click.snorg", "#orgCard [data-pick], #orgPath [data-pick], #orgPane [data-pick]", function (e) {
        e.stopPropagation();
        var id = this.getAttribute("data-pick");
        if (view === "dept" || view === "ins") { select(id); if (window.innerWidth < 1100) document.getElementById("orgCard").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
        select(id, true);
    });
    function chatWith(id) { var f = document.getElementById("orgChatForm"); f.action = "/chat/direct/" + id; f.submit(); }
    function callWith(id, video) { document.getElementById("orgCallUser").value = id; document.getElementById("orgCallVideo").value = video ? "true" : "false"; document.getElementById("orgCallForm").submit(); }
    $(document).on("click.snorg", "[data-org-chat]", function () { chatWith(this.getAttribute("data-org-chat")); });
    $(document).on("click.snorg", "[data-org-call]", function () { callWith(this.getAttribute("data-org-call"), false); });
    $(document).on("click.snorg", "[data-org-video]", function () { callWith(this.getAttribute("data-org-video"), true); });
    $(document).on("click.snorg", "[data-org-cardjump]", function () { document.getElementById("orgCard").scrollIntoView({ behavior: "smooth", block: "start" }); });
    $(document).on("click.snorg", "#orgCard [data-org-edit]", function () { snOrgEdit(this.getAttribute("data-org-edit")); });
    $(document).on("click.snorg", "[data-dept-show]", function () {
        var id = this.getAttribute("data-dept-show");
        go("dept", function () {
            var col = pane.querySelector('[data-dcol="' + id + '"]');
            if (!col) return;
            $(pane).find(".org-dcard.flash").removeClass("flash");
            col.scrollIntoView({ behavior: "smooth", block: "nearest" }); col.classList.add("flash");
        });
    });
    $(document).on("click.snorg", "[data-dept-more]", function () { var k = this.getAttribute("data-dept-more"); deptOpen[k] = !deptOpen[k]; draw(true); });

    // ---------- Directory: open/close, pick, act on the picked people ----------
    $(document).on("click.snorg", "[data-dir-tog]", function (e) { e.stopPropagation(); var id = this.getAttribute("data-dir-tog"); dirShut[id] = !dirShut[id]; treeState = null; draw(true); });
    $(document).on("click.snorg", "[data-org-tree]", function () { openTree(this.getAttribute("data-org-tree")); });
    $(document).on("change.snorg", "[data-dir-pick]", function () {
        var id = this.getAttribute("data-dir-pick");
        if (this.checked) picked[id] = 1; else delete picked[id];
        $(this).closest("tr").toggleClass("picked", this.checked);
        bulk();
        // keep the side card on the person you just ticked, so the card and the tick never disagree
        if (this.checked && id !== selected) { selected = id; $(pane).find("tr.sel").removeClass("sel"); $(this).closest("tr").addClass("sel"); path(); card(); side("card"); }
    });
    $(document).on("change.snorg", "[data-dir-all]", function () {
        var on = this.checked;
        dirRows().forEach(function (r) { if (on) picked[r.p.id] = 1; else delete picked[r.p.id]; });
        draw(true);
    });
    $(document).on("click.snorg", "#orgPane tr[data-row]", function (e) {
        if (e.target.closest("button, a, label, input")) return;
        select(this.getAttribute("data-row"));
    });
    function pickedIds() { return Object.keys(picked).filter(function (id) { return byId[id]; }); }
    $(document).on("click.snorg", "[data-org-bulk]", function () {
        var a = this.getAttribute("data-org-bulk"), ids = pickedIds();
        if (a === "clear") { picked = {}; draw(true); return; }
        if (!ids.length) return;
        if (a === "export") { exportCsv(ids.map(function (id) { return byId[id]; })); return; }
        if (a === "group") { openGroup(ids); return; }
        if (a === "mgr" && ids.length !== 1) { Sahyog.toast("Pick one person to change their manager.", { kind: "info" }); return; }
        if (a === "mgr" || a === "dept") openMove(ids, a);
    });
    // ---------- Change manager (one person) and Move to department (one or more) ----------
    var moveIds = [], moveKind = "mgr", cm = { id: null, pick: undefined, chip: "sug", more: 0 };
    var CM_PAGE = 60, cmCache = { ts: {}, desc: null };
    function cmTs(id) { return id in cmCache.ts ? cmCache.ts[id] : (cmCache.ts[id] = teamSize(id)); }
    function cmDesc() { return cmCache.desc || (cmCache.desc = descendants(cm.id)); }
    function openMove(ids, kind) {
        moveIds = ids; moveKind = kind;
        var names = ids.slice(0, 3).map(function (id) { return byId[id].n; }).join(", ") + (ids.length > 3 ? " and " + (ids.length - 3) + " more" : "");
        $("#orgMoveH").text(kind === "mgr" ? "Change manager" : "Move to department");
        $("#orgMoveMgrWrap").prop("hidden", kind !== "mgr");
        $("#orgMoveDeptWrap").prop("hidden", kind !== "dept");
        $("#orgMoveDialog").addClass("org-cm-dlg");
        if (kind === "mgr") {
            var p = byId[ids[0]];
            cm = { id: p.id, pick: undefined, chip: "sug", more: 0 }; cmCache = { ts: {}, desc: null };
            $("#orgMoveSub").text(p.n + (p.title ? " · " + p.title : "") + " · " + (p.mgr ? "now under " + byId[p.mgr].n : "now at the top of the chart"));
            $("#cmFind").val("").attr("placeholder", "Search " + people.length + " people by name, title or department");
            cmRender();
            SN.open("orgMoveDialog");
            setTimeout(function () { var f = document.getElementById("cmFind"); if (f && window.matchMedia("(min-width: 761px)").matches) f.focus(); }, 80);
            return;
        }
        md = { pick: undefined, team: false };
        $("#orgMoveSub").text(ids.length === 1 ? byId[ids[0]].n + (byId[ids[0]].title ? " · " + byId[ids[0]].title : "") + " · now in " + (deptName(byId[ids[0]]) || "no department") : names);
        $("#mdFind").val(""); $("#mdTeam").prop("checked", false);
        mdRender();
        SN.open("orgMoveDialog");
    }
    // ---------- Move to department ----------
    var md = { pick: undefined, team: false };
    function first(p) { return p.n.split(" ")[0]; }
    function mdTeamIds() {
        var all = {}; moveIds.forEach(function (id) { all[id] = 1; });
        var extra = [];
        moveIds.forEach(function (id) { Object.keys(descendants(id)).forEach(function (k) { if (!all[k]) { all[k] = 1; extra.push(k); } }); });
        return extra;
    }
    function mdIds() { return md.team ? moveIds.concat(mdTeamIds()) : moveIds.slice(); }
    function dPill(id) {
        if (!id || !deptById[id]) return '<span class="org-cm-c">No department</span>';
        return '<span class="org-cm-c org-md-c" style="--dc:' + dcol[id] + '"><i></i>' + esc(deptById[id].n) + '</span>';
    }
    function mdRender() {
        var ps = moveIds.map(function (id) { return byId[id]; }), one = ps.length === 1, p = ps[0];
        var fq = String($("#mdFind").val() || "").trim().toLowerCase();
        // who is moving
        if (one) {
            $("#mdWho").html(av(p, 48) + '<span><b>' + esc(p.n) + '</b><small>' + esc(p.title || "—") + '</small><small>Reports to ' + (p.mgr ? esc(byId[p.mgr].n) : "no one (top of the chart)") + '</small></span>');
        } else {
            $("#mdWho").html('<span class="org-csel-faces">' + ps.slice(0, 4).map(function (x) { return av(x, 36); }).join("") + (ps.length > 4 ? '<i>+' + (ps.length - 4) + '</i>' : "") + '</span>' +
                '<span><b>' + ps.length + ' people</b><small>' + esc(ps.slice(0, 3).map(first).join(", ") + (ps.length > 3 ? " and " + (ps.length - 3) + " more" : "")) + '</small></span>');
        }
        // now → after
        var now = {}; ps.forEach(function (x) { var k = x.deptId && deptById[x.deptId] ? x.deptId : ""; now[k] = (now[k] || 0) + 1; });
        var nowH = Object.keys(now).map(function (k) { return dPill(k) + (one ? "" : '<small class="org-md-n">' + now[k] + '</small>'); }).join(" ");
        var h = '<div class="org-cm-pl"><small>Now</small><span class="org-cm-cs">' + nowH + '</span></div>';
        if (md.pick === undefined) h += '<div class="org-cm-pl"><small>After</small><span class="org-cm-hint">Pick a department below.</span></div>';
        else h += '<div class="org-cm-pl after"><small>After</small><span class="org-cm-cs">' + dPill(md.pick).replace("org-cm-c", "org-cm-c new") + '</span></div>';
        h += '<p class="org-cm-note">Only the department changes. ' + (one ? first(p) + (p.mgr ? " keeps reporting to " + esc(byId[p.mgr].n) + "." : " stays where they are in the chart.") : "Everyone keeps their manager.") + '</p>';
        $("#mdPath").html(h);
        // team option
        var extra = mdTeamIds();
        $("#mdTeamWrap").prop("hidden", !extra.length);
        $("#mdTeamT").text(extra.length ? "Also move " + (one ? first(p) + "'s" : "their") + " team (" + extra.length + (extra.length === 1 ? " person" : " people") + ")" : "");
        // list
        $("#mdFindWrap").prop("hidden", depts.length < 8);
        var curOnly = Object.keys(now).length === 1 ? Object.keys(now)[0] : null;
        var rows = depts.slice().sort(function (a, b) { return a.n.localeCompare(b.n); }).filter(function (d) { return !fq || d.n.toLowerCase().indexOf(fq) >= 0; }).map(function (d) {
            var n = people.filter(function (x) { return x.deptId === d.id; }).length, head = byId[d.head];
            return mdRow(d.id, d.n, n + (n === 1 ? " person" : " people") + (head ? " · head " + head.n : ""), dcol[d.id], curOnly === d.id);
        });
        if (!fq || "no department".indexOf(fq) >= 0) rows.push(mdRow("", "No department", "Take them out of any department", "#94A3B8", curOnly === ""));
        $("#mdList").html(rows.join("") || '<p class="org-cm-more-t">No department matches “' + esc(fq) + '”.</p>');
        $("#mdSub").text(depts.length + (depts.length === 1 ? " department" : " departments"));
        Sahyog.paintPhotos && Sahyog.paintPhotos(document.getElementById("orgMoveDialog"));
        // footer
        var ids = mdIds(), changes = md.pick !== undefined && ids.some(function (id) { return (byId[id].deptId || "") !== md.pick; });
        var who = ids.length === 1 ? first(byId[ids[0]]) : ids.length + " people";
        var to = md.pick === undefined ? "" : md.pick ? deptById[md.pick].n : "no department";
        $("#cmGo").prop("disabled", !changes).find("span").text(md.pick === undefined ? "Choose a department" : md.pick ? "Move " + who + " to " + to : "Remove " + who + " from department");
        $("#cmFoot").html(md.pick === undefined ? "Nothing changes until you press Move." : !changes ? (ids.length === 1 ? "Already in " : "Already all in ") + esc(to) + "." :
            "<b>" + esc(who) + "</b> " + (md.pick ? (ids.length === 1 ? "will be in " : "will be in ") + "<b>" + esc(to) + "</b>." : (ids.length === 1 ? "will have" : "will have") + " no department.") + " Undo is offered for 10 seconds.");
    }
    function mdRow(id, name, sub2, col, cur) {
        var sel = md.pick === id;
        return '<button type="button" role="radio" class="org-md-row' + (sel ? " sel" : "") + '" data-md="' + id + '" aria-checked="' + sel + '" style="--dc:' + col + '">' +
            '<span class="org-cm-radio" aria-hidden="true">' + (sel ? '<i class="fa fa-check"></i>' : "") + '</span>' +
            '<span class="org-md-ic" aria-hidden="true"><i class="bi ' + (id ? "bi-briefcase-fill" : "bi-slash-circle") + '"></i></span>' +
            '<span class="org-cm-t"><b>' + esc(name) + '</b><small>' + esc(sub2) + '</small></span>' + (cur ? '<em class="org-cm-tag">Now</em>' : "") + '</button>';
    }
    function cmBlocked(mid) { return mid !== "" && (mid === cm.id || !!cmDesc()[mid]); }
    function cmWhy(mid) {
        if (mid === cm.id) return "This is " + byId[cm.id].n.split(" ")[0];
        var m = byId[mid]; return m && m.mgr === cm.id ? "Reports to " + byId[cm.id].n.split(" ")[0] : "In " + byId[cm.id].n.split(" ")[0] + "'s team";
    }
    function cmCrumbs(list, newId) {
        return list.map(function (x) {
            var cls = x.id === cm.id ? " me" : x.id === newId ? " new" : "";
            return '<span class="org-cm-c' + cls + '">' + esc(x.n) + '</span>';
        }).join('<i class="fa fa-angle-right" aria-hidden="true"></i>');
    }
    function cmPathHtml() {
        var p = byId[cm.id];
        var now = chainOf(p).concat([p]);
        var h = '<div class="org-cm-pl"><small>Now</small><span class="org-cm-cs">' + cmCrumbs(now) + '</span></div>';
        if (cm.pick === undefined) return h + '<div class="org-cm-pl"><small>After</small><span class="org-cm-hint">Pick a manager below to see where ' + esc(p.n.split(" ")[0]) + ' will sit.</span></div>';
        var m = cm.pick ? byId[cm.pick] : null;
        var after = m ? chainOf(m).concat([m, p]) : [p];
        var diff = after.length - now.length, team = cmTs(p.id);
        h += '<div class="org-cm-pl after"><small>After</small><span class="org-cm-cs">' + cmCrumbs(after, m && m.id) + '</span></div>';
        h += '<p class="org-cm-note">' + esc(p.n.split(" ")[0]) + (diff > 0 ? " goes " + diff + (diff === 1 ? " level down" : " levels down") : diff < 0 ? " goes " + (-diff) + (diff === -1 ? " level up" : " levels up") : " stays on the same level") +
            (team ? " · " + (team === 1 ? "the 1 person" : "the " + team + " people") + " in " + (p.n.split(" ")[0]) + "'s team stay under them." : ".") + '</p>';
        return h;
    }
    function cmRow(p, extra) {
        var bad = p ? cmBlocked(p.id) : false, id = p ? p.id : "";
        var sel = cm.pick === id, cur = (byId[cm.id].mgr || "") === id;
        var t = p ? cmTs(p.id) : 0;
        return '<button type="button" role="option" class="org-cm-row' + (sel ? " sel" : "") + (bad ? " bad" : "") + '" data-cm="' + id + '" aria-selected="' + sel + '"' + (bad ? ' aria-disabled="true"' : "") + '>' +
            (bad ? '<span class="org-cm-x" aria-hidden="true"><i class="fa fa-times"></i></span>' : '<span class="org-cm-radio" aria-hidden="true">' + (sel ? '<i class="fa fa-check"></i>' : "") + '</span>') +
            (p ? av(p, 34) : '<span class="org-cm-topic" aria-hidden="true"><i class="fa fa-level-up"></i></span>') +
            '<span class="org-cm-t"><b>' + (p ? esc(p.n) : "No manager") + '</b><small>' + (p ? esc(p.title || "—") : "Top of the chart") + '</small></span>' +
            (bad ? '<em class="org-cm-why">' + esc(cmWhy(id)) + '</em>' : "") +
            (cur ? '<em class="org-cm-tag">Now</em>' : extra ? '<em class="org-cm-tag">' + esc(extra) + '</em>' : "") +
            (p ? dpill(p) : "") + '<span class="org-cm-team">' + (t ? "team " + t : "") + '</span></button>';
    }
    function cmGroup(t) { return '<div class="org-cm-g">' + esc(t) + '</div>'; }
    function cmRender() {
        var p = byId[cm.id], q2 = String($("#cmFind").val() || "").trim().toLowerCase();
        $("#cmEsc").prop("hidden", !q2);
        $("#cmWho").html(av(p, 48) + '<span><b>' + esc(p.n) + '</b><small>' + esc(p.title || deptName(p) || "") + '</small>' +
            (cmTs(p.id) ? '<em><i class="fa fa-users" aria-hidden="true"></i> ' + (cmTs(p.id) === 1 ? "Their 1 report moves with them" : "Their team of " + cmTs(p.id) + " moves with them") + '</em>' : "") + '</span>');
        $("#cmPath").html(cmPathHtml());
        var others = people.filter(function (x) { return x.id !== cm.id; });
        var matches = q2 ? others.filter(function (x) { return text(x).indexOf(q2) >= 0; }) : others;
        if (q2 && cm.chip === "sug") cm.chip = "all";
        // chips: Suggested · All · each department (biggest first) · No department
        var dcount = {}; matches.forEach(function (x) { var k = x.deptId && deptById[x.deptId] ? x.deptId : "none"; dcount[k] = (dcount[k] || 0) + 1; });
        var chips = (q2 ? "" : chipB("sug", "Suggested")) + chipB("all", "All", q2 ? matches.length + (matches.length === 1 ? " match" : " matches") : matches.length);
        depts.slice().sort(function (a, b) { return (dcount[b.id] || 0) - (dcount[a.id] || 0) || a.n.localeCompare(b.n); }).forEach(function (d) { if (dcount[d.id]) chips += chipB(d.id, d.n, dcount[d.id], dcol[d.id]); });
        if (dcount.none) chips += chipB("none", "No department", dcount.none, "#94A3B8");
        $("#cmChips").html(chips);
        $("#cmSub").text(q2 ? "Results are grouped by department" : cm.chip === "sug" ? "Suggestions first · or search all " + people.length + " people" : "Biggest teams first");
        var h = "";
        if (cm.chip === "sug" && !q2) {
            var used = {}, add = function (x) { if (!x || used[x.id] || x.id === cm.id) return null; used[x.id] = 1; return x; };
            var mgr = byId[p.mgr], up = mgr && byId[mgr.mgr];
            if (up) { add(up); h += cmGroup("Up one level") + cmRow(up, mgr.n.split(" ")[0] + "'s manager"); }
            if (mgr) used[mgr.id] = 1;
            var heads = depts.map(function (d) { return byId[d.head]; }).filter(function (x) { return x && !cmBlocked(x.id); }).filter(add)
                .sort(function (a, b) { return cmTs(b.id) - cmTs(a.id); });
            if (heads.length) h += cmGroup("Department heads") + heads.map(function (x) { return cmRow(x); }).join("");
            var same = people.filter(function (x) { return x.deptId && x.deptId === p.deptId && (kids[x.id] || []).length && !cmBlocked(x.id); }).filter(add)
                .sort(function (a, b) { return cmTs(b.id) - cmTs(a.id) || byName(a, b); }).slice(0, 8);
            if (same.length) h += cmGroup("Other managers in " + deptName(p)) + same.map(function (x) { return cmRow(x); }).join("");
            h += cmGroup("Other choices") + (mgr ? cmRow(mgr) : "") + (p.mgr ? cmRow(null) : "");
            var below = Object.keys(descendants(p.id)).map(function (id) { return byId[id]; }).filter(Boolean).sort(byName);
            if (below.length) h += cmGroup("Not possible · in " + p.n.split(" ")[0] + "'s own team") + below.slice(0, 3).map(function (x) { return cmRow(x); }).join("") +
                (below.length > 3 ? '<p class="org-cm-more-t">and ' + (below.length - 3) + ' more in ' + esc(p.n.split(" ")[0]) + '\'s team</p>' : "");
            h += '<p class="org-cm-more-t">Not here? Search above, or open All.</p>';
        } else {
            var list = cm.chip === "all" ? matches : matches.filter(function (x) { return cm.chip === "none" ? !(x.deptId && deptById[x.deptId]) : x.deptId === cm.chip; });
            list = list.slice().sort(function (a, b) { return (cmBlocked(a.id) - cmBlocked(b.id)) || (cmTs(b.id) - cmTs(a.id)) || byName(a, b); });
            var limit = CM_PAGE * (cm.more + 1), shown = list.slice(0, limit);
            if (!q2 && cm.chip === "all" && p.mgr) h += cmRow(null);
            var groups = {}, order = [];
            shown.forEach(function (x) { var k = x.deptId && deptById[x.deptId] ? x.deptId : "none"; if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(x); });
            if (cm.chip === "all") order.sort(function (a, b) { return groups[b].length - groups[a].length; });
            order.forEach(function (k) {
                if (cm.chip === "all") h += cmGroup((k === "none" ? "No department" : deptById[k].n) + " · " + (dcount[k] || groups[k].length));
                h += groups[k].map(function (x) { return cmRow(x); }).join("");
            });
            if (!list.length) h += '<p class="org-cm-more-t">No one matches “' + esc(q2) + '”.</p>';
            else if (list.length > shown.length) h += '<p class="org-cm-more-t">Showing ' + shown.length + ' of ' + list.length + (q2 ? "" : " · type to narrow it down") + ' <button type="button" class="org-link" data-cm-more>Show ' + Math.min(CM_PAGE, list.length - shown.length) + ' more</button></p>';
        }
        $("#cmList").html(h);
        Sahyog.paintPhotos && Sahyog.paintPhotos(document.getElementById("orgMoveDialog"));
        var ok = cm.pick !== undefined && cm.pick !== (p.mgr || "");
        $("#cmGo").prop("disabled", !ok).find("span").text(cm.pick === undefined ? "Choose a manager" : cm.pick === "" ? "Move to the top" : "Move under " + byId[cm.pick].n);
        $("#cmFoot").html(cm.pick === undefined ? "Nothing changes until you press Move." : !ok ? "That is already their manager." :
            esc(p.n) + (cm.pick ? " will report to <b>" + esc(byId[cm.pick].n) + "</b>." : " will be at the top of the chart.") + " Undo is offered for 10 seconds.");
    }
    function chipB(k, t, n, col) {
        return '<button type="button" role="tab" class="org-cm-chip' + (cm.chip === k ? " on" : "") + '" data-cm-chip="' + k + '" aria-selected="' + (cm.chip === k) + '">' +
            (col ? '<i style="background:' + col + '"></i>' : "") + esc(t) + (n != null ? ' <span>' + n + '</span>' : "") + '</button>';
    }
    $(document).on("input.snorg", "#cmFind", function () { cm.more = 0; if (!this.value.trim() && cm.chip === "all") cm.chip = "sug"; cmRender(); });
    $(document).on("keydown.snorg", "#cmFind", function (e) { if (e.key === "Escape" && this.value) { e.preventDefault(); e.stopPropagation(); this.value = ""; cm.chip = "sug"; cmRender(); } });
    $(document).on("click.snorg", "[data-cm-chip]", function () { cm.chip = this.getAttribute("data-cm-chip"); cm.more = 0; cmRender(); document.getElementById("cmList").scrollTop = 0; });
    $(document).on("click.snorg", "[data-cm-more]", function () { cm.more++; cmRender(); });
    $(document).on("click.snorg", "#cmList [data-cm]", function () {
        var id = this.getAttribute("data-cm");
        if (cmBlocked(id)) { Sahyog.toast(cmWhy(id) + ", so " + byId[cm.id].n.split(" ")[0] + " can't report to them.", { kind: "info", title: "Not possible" }); return; }
        cm.pick = cm.pick === id ? undefined : id;
        var top = document.getElementById("cmList").scrollTop; cmRender(); document.getElementById("cmList").scrollTop = top;
    });
    $(document).on("submit.snorg", "#orgMoveForm", function (e) {
        e.preventDefault();
        if (moveKind === "dept") {
            if (md.pick === undefined) return;
            var v = md.pick, ids = mdIds().filter(function (id) { return (byId[id].deptId || "") !== v; });
            if (!ids.length) return;
            document.getElementById("orgMoveDialog").close();
            move(ids, { dept: v }).then(function () { picked = {}; cpick = {}; selMode = false; draw(true); });
            return;
        }
        if (cm.pick === undefined || cm.pick === (byId[cm.id].mgr || "")) return;
        document.getElementById("orgMoveDialog").close();
        move([cm.id], { mgr: cm.pick }).then(function () { picked = {}; draw(true); });
    });
    function openGroup(ids) {
        var mine = ids.filter(function (id) { return id !== ME; });
        if (!mine.length) { Sahyog.toast("Pick at least one other person.", { kind: "info" }); return; }
        var common = mine.map(function (id) { return deptName(byId[id]); });
        var same = common.every(function (d) { return d && d === common[0]; });
        $("#orgGroupName").val(same ? common[0] + " team" : "").trigger("input");
        $("#orgGroupSub").text("With " + mine.length + (mine.length === 1 ? " person" : " people") + " you picked, and you");
        $("#orgGroupMembers").html(mine.map(function (id) { return '<input type="hidden" name="members" value="' + id + '" />'; }).join(""));
        $("#orgGroupFaces").html(mine.slice(0, 12).map(function (id) { return av(byId[id], 30); }).join("") + (mine.length > 12 ? '<span class="org-more">+' + (mine.length - 12) + '</span>' : ""));
        Sahyog.paintPhotos && Sahyog.paintPhotos(document.getElementById("orgGroupFaces"));
        SN.open("orgGroupDialog");
    }
    $(document).on("submit.snorg", "#orgGroupForm", function (e) {
        var n = $("#orgGroupName").val().trim();
        if (n.length < 2) { e.preventDefault(); Sahyog.toast("Give the group a name (2–60 characters).", { kind: "error", title: "Name needed" }); }
    });

    // ---------- export as CSV (opens in Excel) ----------
    function exportCsv(list) {
        var cell = function (v) { v = String(v == null ? "" : v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        var rows = [["name", "email", "title", "department", "manager_email", "manager", "phone", "employee_id", "joined"]];
        list.slice().sort(byName).forEach(function (p) {
            var m = byId[p.mgr];
            rows.push([p.n, p.email, p.title, deptName(p), m ? m.email : "", m ? m.n : "", p.phone, p.emp, p.joined]);
        });
        // the same columns as Import CSV, so the file can be edited and imported again
        var blob = new Blob(["﻿" + rows.map(function (r) { return r.map(cell).join(","); }).join("\r\n")], { type: "text/csv;charset=utf-8" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = "organization-" + new Date().toISOString().slice(0, 10) + ".csv";
        document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
        Sahyog.toast(list.length + (list.length === 1 ? " person" : " people") + " exported. The file opens in Excel and can be imported again.", { kind: "success" });
    }
    window.snOrgExport = function () {
        var ids = view === "dir" ? pickedIds() : [];
        exportCsv(ids.length ? ids.map(function (id) { return byId[id]; }) : people);
    };

    $(document).on("click.snorg", "[data-org-fix]", function () {
        var t = pane.querySelector(".org-dview-side") || pane.querySelector(".org-ins-h");
        if (!t) return;
        t.scrollIntoView({ behavior: "smooth", block: "nearest" });
        var box = pane.querySelector(".org-dview-side, .org-issues");
        if (box) { box.classList.remove("flash"); void box.offsetWidth; box.classList.add("flash"); }
    });
    // ---------- Insights: the buttons on each item ----------
    $(document).on("click.snorg", "[data-issue]", function () {
        var it = lastIssues[+this.getAttribute("data-issue")], a = it && it.acts[+this.getAttribute("data-act")];
        if (!a) return;
        if (a.a === "dept") openDept(deptById[a.id]);
        else if (a.a === "edit") snOrgEdit(a.id);
        else if (a.a === "pick") { go("mgr", function () { select(a.id, true); }); }
        else if (a.a === "headin") move([a.id], { dept: a.dept });
        else if (a.a === "deldept") {
            var d = deptById[a.id];
            SN.confirmPost("/org/departments/" + d.id + "/delete", { title: "Delete " + d.n + "?", text: "No one is in it, so nothing else changes.", confirmText: "Delete department", danger: true });
        } else if (a.a === "list") {
            var ids = {}; a.ids.forEach(function (p) { ids[p.id] = 1; });
            issue = { label: a.label + " · " + a.ids.length, ids: ids };
            deptFilter = ""; go("dir");
        }
    });

    // ---------- admin: edit person ----------
    window.snOrgEdit = function (id) {
        if (!IS_ADMIN) return;
        var p = byId[id || selected];
        if (!p) { Sahyog.toast("Click a person in the chart first.", { kind: "info", title: "Select a person" }); return; }
        var isMe = p.id === ME;
        $("#orgEditForm").attr("action", "/org/person/" + p.id);
        $("#oTitleH").text(isMe ? "Edit your details" : "Edit " + p.n);
        $("#oName").val(p.n).trigger("input");
        $("#oEmail").val(p.email).trigger("input");
        $("#oJob").val(p.title).trigger("input");
        $("#oPhone").val(p.phone).trigger("input");
        $("#oEmp").val(p.emp).trigger("input");
        var top = 0;
        people.forEach(function (x) { var m = /^EMP-(\d+)$/i.exec(x.emp || ""); if (m) top = Math.max(top, +m[1]); });
        $("#oEmpNext").text("The next new person gets EMP-" + String(top + 1).padStart(6, "0") + ".");
        setModernDropdownWithLabelValue("#oDept", p.deptId && deptById[p.deptId] ? p.deptId : "");
        // the manager list leaves out this person and everyone below them
        var below = descendants(p.id);
        $("#oMgr .ddwl-option").each(function () {
            var v = String($(this).data("value") || "");
            $(this).toggleClass("sn-ddx", v === p.id || !!below[v]);
        });
        setModernDropdownWithLabelValue("#oMgr", p.mgr || "");
        $("#oMgrHint").text("The list leaves out " + (isMe ? "you" : p.n) + (Object.keys(below).length ? " and the " + Object.keys(below).length + " " + (Object.keys(below).length === 1 ? "person" : "people") + " below" : "") + ", so the chart can't go round in a circle.");
        var di = document.getElementById("oJoined");
        if (di && di._flatpickr) { if (p.joined) di._flatpickr.setDate(p.joined, true, "d-m-Y"); else di._flatpickr.clear(); }
        else if (di) di.value = p.joined;
        $("#oAdmin").prop("checked", p.admin).trigger("change");
        $("#oAdminWrap").prop("hidden", isMe);   // you can't take away your own admin role
        SN.open("orgEditDialog");
    };
    $(document).on("submit.snorg", "#orgEditForm", function (e) {
        if (!$("#oName").val().trim() || !$("#oEmail").val().trim()) {
            e.preventDefault();
            Sahyog.toast("Name and email are needed.", { kind: "error", title: "Not saved" });
        }
    });

    // ---------- admin: departments ----------
    window.snOrgNewDept = function () { openDept(null); };
    function openDept(d) {
        if (!IS_ADMIN) return;
        $("#dId").val(d ? d.id : "");
        $("#dTitleH").text(d ? "Edit " + d.n : "New department");
        $("#dName").val(d ? d.n : "").trigger("input");
        if (d && d.head) setModernDropdownWithLabelValue("#dHead", d.head); else setModernDropdownWithLabelValue("#dHead", "");
        $("#dDelete").prop("hidden", !d).data("dept", d);
        SN.open("orgDeptDialog");
    }
    $(document).on("click.snorg", "[data-dept-edit]", function () { openDept(deptById[this.getAttribute("data-dept-edit")]); });
    $(document).on("click.snorg", "#dDelete", function () {
        var d = $(this).data("dept"); if (!d) return;
        document.getElementById("orgDeptDialog").close();
        SN.confirmPost("/org/departments/" + d.id + "/delete", {
            title: "Delete " + d.n + "?",
            text: d.count ? "Its " + d.count + " " + (d.count === 1 ? "person stays" : "people stay") + " in the workspace, just without a department. Who reports to whom doesn't change." : "No one is in it.",
            confirmText: "Delete department", danger: true
        });
    });

    // ---------- admin: CSV import ----------
    var impFile = null, impPlan = null;
    function token() { var t = document.querySelector('#orgForms input[name="__RequestVerificationToken"]'); return t ? t.value : ""; }
    function step(n) {
        $("#impSteps li").each(function () {
            var s = +this.getAttribute("data-step");
            this.classList.toggle("on", s === n); this.classList.toggle("done", s < n);
        });
        $("[data-imp-pane]").each(function () { this.hidden = +this.getAttribute("data-imp-pane") !== n; });
        $("#impBack").prop("hidden", n !== 2);
        $("#impGo").prop("hidden", n !== 2);
        $("#impCancel").text(n === 3 ? "Close" : "Cancel");
    }
    window.snOrgImport = function () {
        if (!IS_ADMIN) return;
        impFile = null; impPlan = null; document.getElementById("impFile").value = "";
        step(1); SN.open("orgImportDialog");
    };
    function chip(kind, text) {
        var icon = { new: "fa-check", update: "fa-refresh", warn: "fa-exclamation-triangle", bad: "fa-times" }[kind];
        return '<span class="org-chip ' + kind + '"><i class="fa ' + icon + '" aria-hidden="true"></i>' + esc(text) + '</span>';
    }
    function check(file) {
        if (!file) return;
        if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") { Sahyog.toast("Choose a .csv file. In Excel: File → Save As → CSV (comma delimited).", { kind: "error", title: "Not a CSV file" }); return; }
        impFile = file;
        var fd = new FormData(); fd.append("file", file); fd.append("__RequestVerificationToken", token());
        $("#impDrop").addClass("busy");
        fetch("/org/import/check", { method: "POST", body: fd, headers: { RequestVerificationToken: token() } })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                $("#impDrop").removeClass("busy");
                if (!res.ok) { Sahyog.toast(res.error || "The file couldn't be read.", { kind: "error", title: "Can't import" }); return; }
                impPlan = res;
                $("#impName").text(res.file);
                $("#impCols").text(res.total + (res.total === 1 ? " row" : " rows") + " · columns found: " + res.columns.join(", "));
                var c = res.counts, chips = "";
                if (c["new"]) chips += chip("new", c["new"] + (c["new"] === 1 ? " new person" : " new people"));
                if (c.update) chips += chip("update", c.update + (c.update === 1 ? " update" : " updates"));
                if (c.warn) chips += chip("warn", c.warn + " to check");
                if (c.bad) chips += chip("bad", c.bad + " with problems");
                chips += '<span class="org-seats">Seats after import: ' + res.seatsAfter + ' of ' + res.maxUsers + '</span>';
                $("#impChips").html(chips);
                $("#impRows").html(res.rows.map(function (r) {
                    return '<tr class="' + r.kind + '"><td>' + r.line + '</td><td><b>' + esc(r.name || "—") + '</b></td><td class="' + (r.email ? "" : "bad-t") + '">' + esc(r.email || "(empty)") +
                        '</td><td>' + esc(r.title) + '</td><td>' + esc(r.department) + '</td><td class="' + (r.kind === "warn" && /Manager/.test(r.status) ? "warn-t" : "") + '">' + esc(r.managerShown) +
                        '</td><td>' + chip(r.kind, r.status) + '</td></tr>';
                }).join(""));
                var go = c["new"] + c.update;
                $("#impGo").prop("disabled", !go).find("span").text(go ? "Import " + go + (go === 1 ? " person" : " people") : "Nothing to import");
                step(2);
            })
            .catch(function () { $("#impDrop").removeClass("busy"); Sahyog.toast("The file couldn't be checked. Try again.", { kind: "error" }); });
    }
    $(document).on("change.snorg", "#impFile", function () { check(this.files && this.files[0]); });
    $(document).on("dragover.snorg", "#impDrop", function (e) { e.preventDefault(); this.classList.add("over"); });
    $(document).on("dragleave.snorg drop.snorg", "#impDrop", function () { this.classList.remove("over"); });
    $(document).on("drop.snorg", "#impDrop", function (e) {
        e.preventDefault();
        var f = e.originalEvent.dataTransfer && e.originalEvent.dataTransfer.files[0];
        check(f);
    });
    $(document).on("click.snorg", "#impAgain, #impBack", function () { document.getElementById("impFile").value = ""; step(1); });
    $(document).on("click.snorg", "#impGo", function () {
        if (!impFile || !impPlan) return;
        var btn = this; btn.disabled = true;
        var fd = new FormData(); fd.append("file", impFile); fd.append("__RequestVerificationToken", token());
        var inv = document.getElementById("impInvite");
        fd.append("sendInvites", inv ? (inv.checked ? "true" : "false") : "false");
        fetch("/org/import/run", { method: "POST", body: fd, headers: { RequestVerificationToken: token() } })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                btn.disabled = false;
                if (!res.ok) { Sahyog.toast(res.error || "The import didn't run.", { kind: "error", title: "Can't import" }); return; }
                var h = '<span class="org-done-ic" aria-hidden="true"><i class="fa fa-check"></i></span><b>Import finished</b><p>' +
                    res.added + ' added · ' + res.updated + ' updated' + (res.skipped ? ' · ' + res.skipped + ' skipped' : "") +
                    (res.added ? (res.emailed ? ' · ' + res.emailed + ' welcome email' + (res.emailed === 1 ? "" : "s") + ' sent' : ' · no welcome emails sent') : "") + '</p>';
                if (res.problems && res.problems.length) h += '<ul class="org-problems">' + res.problems.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join("") + '</ul>';
                $("#impDone").html(h);
                step(3);
                $("#orgImportDialog").one("close", function () { SN.reload(); });
            })
            .catch(function () { btn.disabled = false; Sahyog.toast("The import couldn't finish. Refresh and check what was added.", { kind: "error" }); });
    });

    // ---------- start ----------
    (function syncTabs(n) {   // the tab bar is built when the page is ready: wait for it, then show the right tab and the Insights count
        if (!$("#orgTabs").data("tc-api") && window.TabControl && TabControl.init) TabControl.init(document.getElementById("orgTabs"));
        var tc = $("#orgTabs").data("tc-api");
        if (!tc) { if (n < 40) setTimeout(function () { syncTabs(n + 1); }, 25); return; }
        if (view !== tc.getActive().id) tc.select(view);
        insightCount();
    })(0);
    $("[data-dept-color]").each(function () { var c = dcol[this.getAttribute("data-dept-color")]; if (c) this.style.setProperty("--dc", c); });
    draw();
    var startId = byId[START] ? START : byId[ME] ? ME : (people[0] || {}).id;
    if (startId) setTimeout(function () {
        if (usesCanvas() && z < .6) { z = .75; apply(); select(startId, true); }   // a big chart: start readable, around the person
        else select(startId, !!byId[START]);
    }, 40);
    else card();
    var wasPhone = phone();
    $(window).off("resize.snorg").on("resize.snorg", function () {
        clearTimeout(window.__snOrgRz);
        window.__snOrgRz = setTimeout(function () {
            if (phone() !== wasPhone) { wasPhone = phone(); draw(); if (selected) select(selected, true); return; }
            if (usesCanvas()) fit(true);
        }, 150);
    });
})();
