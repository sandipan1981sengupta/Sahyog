// =======================================================================================
// Help Center page (Views/Help/HelpPage.cshtml)
// Loads the list from /Help/Videos (wwwroot/HelpVideos/help-videos.json), shows it as cards per menu,
// and plays a video in the player window: chapters, previous / next, autoplay next, resume where you left off.
// Progress is kept in this browser only (localStorage).
// =======================================================================================
(function () {
    "use strict";

    var MENU_STYLE = {
        "Get started":       { icon: "fa-flag",      color: "#2563eb" },
        "Talk":              { icon: "fa-comments",  color: "#db2777" },
        "Meetings":          { icon: "fa-calendar",  color: "#7c3aed" },
        "People":            { icon: "fa-users",     color: "#0891b2" },
        "Work":              { icon: "fa-briefcase", color: "#ea580c" },
        "Alerts & settings": { icon: "fa-bell",      color: "#d97706" },
        "Admin":             { icon: "fa-shield",    color: "#16a34a" }
    };
    var KEY = "shankhnaad.help.progress";
    var NS = ".snh";

    var all = [], menus = [], current = -1, activeMenu = "All", query = "", upNextTimer = null;

    // ---------------- helpers ----------------
    function style(menu) { return MENU_STYLE[menu] || { icon: "fa-play-circle", color: "#7c3aed" }; }
    function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
    function mmss(sec) { sec = Math.max(0, Math.round(sec || 0)); return Math.floor(sec / 60) + ":" + ("0" + (sec % 60)).slice(-2); }
    function total(sec) { var m = Math.round(sec / 60); return m >= 60 ? Math.floor(m / 60) + "h " + (m % 60) + "m" : m + " min"; }
    function mark(text) {
        var t = esc(text); if (!query) return t;
        var q = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return t.replace(new RegExp("(" + q + ")", "ig"), "<mark>$1</mark>");
    }
    function loadProgress() { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; } }
    function saveProgress(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { } }
    function progressOf(v) { var p = loadProgress()[v.id]; return p || { t: 0, done: false }; }
    function setProgress(v, t, done) {
        var p = loadProgress(); var o = p[v.id] || {};
        o.t = t; o.at = Date.now(); if (done) o.done = true; p[v.id] = o; saveProgress(p);
    }
    function matches(v) {
        if (activeMenu !== "All" && v.menu !== activeMenu) return false;
        if (!query) return true;
        var hay = (v.title + " " + v.description + " " + v.menu + " " + (v.topics || []).join(" ")).toLowerCase();
        return query.toLowerCase().split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
    }

    // ---------------- render ----------------
    var counted = false;
    function countUp(sel, to, fmt) {
        var el = $(sel), t0 = null, dur = 900;
        function step(ts) {
            if (t0 === null) t0 = ts;
            var k = Math.min(1, (ts - t0) / dur), e = 1 - Math.pow(1 - k, 3);
            el.text(fmt(Math.round(to * e)));
            if (k < 1) requestAnimationFrame(step);
        }
        el.text(fmt(0)); requestAnimationFrame(step);
    }
    // fade an image in once it has loaded (cards and the feature preview)
    function fadeImgs(scope) {
        $(scope).find("img").each(function () {
            var im = this, $t = $(im);
            if (im.complete && im.naturalWidth) $t.addClass("ld");
            else $t.removeClass("ld").one("load error", function () { $t.addClass("ld"); });
        });
    }

    function renderStats() {
        var p = loadProgress(), done = all.filter(function (v) { return p[v.id] && p[v.id].done; }).length;
        var secs = all.reduce(function (s, v) { return s + (v.duration || 0); }, 0), pc0 = all.length ? Math.round(done * 100 / all.length) : 0;
        if (!counted) {
            counted = true;
            countUp("#snhStatVideos", all.length, function (n) { return n; });
            countUp("#snhStatMenus", menus.length, function (n) { return n; });
            countUp("#snhStatTime", secs, function (n) { return total(n); });
            countUp("#snhStatWatched", pc0, function (n) { return n + "%"; });
        } else {
            $("#snhStatVideos").text(all.length); $("#snhStatMenus").text(menus.length);
            $("#snhStatTime").text(total(secs)); $("#snhStatWatched").text(pc0 + "%");
        }

        var pct = all.length ? Math.round(done * 100 / all.length) : 0, C = 2 * Math.PI * 18;
        $("#snhRing").css({ "stroke-dasharray": C, "stroke-dashoffset": C * (1 - pct / 100) });

        // feature card: the most recent video started but not finished, otherwise the next one not yet watched
        var last = all.filter(function (v) { return p[v.id] && !p[v.id].done && p[v.id].t > 5; })
                      .sort(function (a, b) { return (p[b.id].at || 0) - (p[a.id].at || 0); })[0];
        var label = "Continue watching", tgt = last;
        if (!tgt) { tgt = all.filter(function (v) { return !(p[v.id] && p[v.id].done); })[0]; label = done ? "Up next" : "Start here"; }
        if (!tgt) { tgt = all[0]; label = "Watch again"; }
        var $c = $("#snhContinue");
        if (tgt) {
            var t = last ? p[last.id].t : 0, w = Math.min(100, t * 100 / (tgt.duration || 1));
            $c.find("img").attr("src", tgt.poster);
            $c.find(".snh-feature-label").text(label);
            $c.find(".snh-feature-title").text(tgt.title);
            $c.find(".snh-feature-dur").text(mmss(tgt.duration));
            $c.find(".snh-feature-meta").html(esc(tgt.menu) + " menu · " + (tgt.chapters || []).length + " chapters" + (last ? " · resume at " + mmss(t) : ""));
            $c.find(".snh-continue-bar").toggle(!!last).find("span").css("width", w + "%");
            $c.data("idx", all.indexOf(tgt)).show();
            var fim = $c.find("img")[0], unskel = function () { $c.removeClass("is-skel"); };
            if (fim.complete && fim.naturalWidth) unskel(); else { $(fim).one("load error", unskel); setTimeout(unskel, 1200); }
            $("#snhStartText").text(last ? "Resume watching" : done ? "Continue learning" : "Start watching");
            $("#snhStart").data("idx", all.indexOf(tgt));
        } else $c.hide();
    }

    function renderTabs() {
        var counts = { All: all.length };
        all.forEach(function (v) { counts[v.menu] = (counts[v.menu] || 0) + 1; });
        var html = tab("All", "fa-th-large", "#7c3aed", counts.All);
        menus.forEach(function (m) { if (counts[m]) html += tab(m, style(m).icon, style(m).color, counts[m]); });
        $("[data-snh-tabs]").html(html);
        function tab(name, icon, color, n) {
            return '<button type="button" role="tab" class="snh-tab' + (name === activeMenu ? " on" : "") + '" data-menu="' + esc(name) + '" style="--c:' + color + '">' +
                '<i class="fa ' + icon + '"></i>' + (name === "All" ? "All guides" : esc(name)) + "<em>" + n + "</em></button>";
        }
    }

    function card(v, i, feat) {
        var s = style(v.menu), pr = progressOf(v), pct = pr.done ? 100 : Math.min(100, (pr.t || 0) * 100 / (v.duration || 1));
        var tp = v.topics || [], ACT = { "Add a record": "fa-plus", "Edit a record": "fa-pencil", "Delete a record": "fa-trash", "Print to Excel": "fa-print", "Save settings": "fa-check" };
        var acts = tp.filter(function (t) { return ACT[t]; }).map(function (t) {
            return '<span class="snh-act" title="' + esc(t) + '"><i class="fa ' + ACT[t] + '"></i>' + esc(t.replace(" a record", "").replace(" to Excel", "").replace(" settings", "")) + "</span>";
        }).join("");
        var extra = tp.filter(function (t) { return !ACT[t]; });
        var panels = extra.filter(function (t) { return / panel$/.test(t); }).length, ledger = extra.some(function (t) { return /Ledger/.test(t); });
        var xtra = (ledger ? '<span class="snh-x" title="Ledger lines &amp; Account Summary"><i class="fa fa-list-alt"></i>Ledger &amp; summary</span>' : "") +
            (panels ? '<span class="snh-x" title="' + esc(extra.filter(function (t) { return / panel$/.test(t); }).join(", ")) + '"><i class="fa fa-columns"></i>' + panels + (panels === 1 ? " side panel" : " side panels") + "</span>" : "");
        var nch = (v.chapters || []).length;
        var fx = "";
        if (feat) {
            fx = '<div class="snh-fch"><h5><i class="fa fa-list-ol"></i> In this guide</h5><ol>' + (v.chapters || []).filter(function (c) { return c.title !== "Introduction" && c.title !== "Summary"; }).map(function (c) {
                return '<li data-t="' + c.time + '"><span>' + esc(c.title) + "</span><time>" + mmss(c.time) + "</time></li>";
            }).join("") + "</ol></div>";
        }
        return '<article class="snh-card' + (feat ? " feat" : "") + (pr.done ? " watched" : "") + (v.available === false ? " soon" : "") + '" tabindex="0" data-idx="' + i + '" style="--c:' + s.color + ';animation-delay:' + Math.min(i % 12, 11) * 45 + 'ms">' +
            '<div class="snh-thumb"><img loading="lazy" src="' + esc(v.poster) + '" alt="" /><i class="snh-tint"></i><i class="snh-shine"></i>' +
            (feat ? '<span class="snh-ribbon"><i class="fa fa-star"></i> ' + feat + "</span>" : "") +
            '<span class="snh-no">' + ("0" + v.no).slice(-2) + '</span>' +
            '<span class="snh-done"><i class="fa fa-check"></i> Watched</span>' +
            '<span class="snh-play"><i class="fa fa-play"></i></span>' +
            '<span class="snh-dur"><i class="fa fa-clock-o"></i> ' + (v.available === false ? "Coming soon" : mmss(v.duration)) + '</span>' +
            (nch ? '<span class="snh-chn"><i class="fa fa-bookmark-o"></i> ' + nch + " chapters</span>" : "") +
            (pct > 0 && !pr.done ? '<div class="snh-prog"><span style="width:' + pct + '%"></span></div>' : "") + "</div>" +
            '<div class="snh-cbody"><span class="snh-tag"><i class="fa ' + s.icon + '"></i>' + esc(v.menu) + " menu</span><h4>" + mark(v.title) + "</h4><p>" + mark(v.description) + "</p>" +
            '<div class="snh-acts">' + acts + "</div>" + (xtra ? '<div class="snh-xtra">' + xtra + "</div>" : "") + fx +
            '<div class="snh-cfoot"><span>' + (pr.done ? '<i class="fa fa-repeat"></i> Watch again' : pct > 0 ? '<i class="fa fa-play-circle"></i> Resume' : '<i class="fa fa-play-circle"></i> Watch guide') + '</span><i class="fa fa-arrow-right"></i></div>' +
            "</div></article>";
    }

    function renderLibrary(quiet) {
        if (!quiet) { var rt = document.getElementById("snhRoot"); if (rt) rt.classList.remove("no-anim"); }
        var html = "", shown = 0, shelf = activeMenu === "All" && !query;
        menus.forEach(function (m) {
            var list = [], idxs = [];
            all.forEach(function (v, i) { if (v.menu === m && matches(v)) idxs.push(i); });
            var featIdx = -1, featLabel = "";
            if (false) {
                var pp = loadProgress(), anyDone = idxs.some(function (i) { return pp[all[i].id] && pp[all[i].id].done; });
                featIdx = idxs.filter(function (i) { return !(pp[all[i].id] && pp[all[i].id].done); })[0];
                if (featIdx == null) { featIdx = idxs[0]; featLabel = "Watch again"; } else featLabel = anyDone ? "Up next" : "Start here";
            }
            if (featIdx >= 0) list.push(card(all[featIdx], featIdx, featLabel));
            idxs.forEach(function (i) { if (i !== featIdx) list.push(card(all[i], i)); });
            if (!list.length) return;
            shown += list.length;
            var s = style(m), secs = all.filter(function (v) { return v.menu === m && matches(v); }).reduce(function (a, v) { return a + (v.duration || 0); }, 0);
            html += '<section class="snh-section" style="--c:' + s.color + '"><div class="snh-shead"><div class="snh-sicon"><i class="fa ' + s.icon + '"></i></div>' +
                "<div class=\"snh-stitle\"><h3>" + esc(m) + " menu</h3><span>" + list.length + (list.length === 1 ? " video" : " videos") + " · " + total(secs) + '</span></div><div class="snh-sline"></div>' +
                (shelf ? '<div class="snh-shnav"><button type="button" class="snh-arw" data-dir="-1" aria-label="Scroll left"><i class="fa fa-chevron-left"></i></button><button type="button" class="snh-arw" data-dir="1" aria-label="Scroll right"><i class="fa fa-chevron-right"></i></button></div>' : "") +
                '<button type="button" class="snh-playall" data-first="' + all.indexOf(all.filter(function (v) { return v.menu === m && matches(v); })[0]) + '"><i class="fa fa-play"></i> Play all</button></div>' +
                '<div class="snh-shelfwrap"><div class="snh-grid' + (shelf ? " shelf" : "") + '">' + list.join("") + "</div></div></section>";
        });
        $("#snhLibrary").html(html);
        fadeImgs("#snhLibrary");
        $("#snhLibrary .snh-grid.shelf").each(function () { var g = this; $(g).on("scroll", function () { shelfState(g); }); shelfState(g); });
        $("#snhEmpty").toggle(shown === 0);
    }

    function shelfState(g) {
        var $s = $(g).closest(".snh-section"), max = g.scrollWidth - g.clientWidth - 2;
        $s.find(".snh-arw[data-dir=-1]").prop("disabled", g.scrollLeft <= 2);
        $s.find(".snh-arw[data-dir=1]").prop("disabled", g.scrollLeft >= max);
        $s.find(".snh-shelfwrap").toggleClass("at-start", g.scrollLeft <= 2).toggleClass("at-end", g.scrollLeft >= max);
    }

    // refresh progress (watched badges, resume, hero) without replaying entrance animations or losing shelf scroll
    function quietRefresh() {
        var root = document.getElementById("snhRoot"); if (!root) return;
        var keep = {};
        $("#snhLibrary .snh-section").each(function (k) { var g = $(this).find(".snh-grid")[0]; if (g) keep[k] = g.scrollLeft; });
        root.classList.add("no-anim");
        renderStats(); renderLibrary(true);
        $("#snhLibrary .snh-section").each(function (k) { var g = $(this).find(".snh-grid")[0]; if (g && keep[k]) { g.style.scrollBehavior = "auto"; g.scrollLeft = keep[k]; g.style.scrollBehavior = ""; shelfState(g); } });
        $("#snhLibrary img").addClass("ld");
    }

    function renderAll() { renderStats(); renderTabs(); renderLibrary(); }

    // ---------------- player ----------------
    var $player, video, closeTimer, openTimer, ambiTimer = null, lastFocus = null, prevSrc = "";

    // ambient light: a tiny canvas copy of the picture, blurred behind the video
    function ambiDraw(src) {
        var c = document.getElementById("snhAmbi"); if (!c) return;
        try { c.getContext("2d").drawImage(src, 0, 0, c.width, c.height); } catch (e) { }
    }
    function ambiPoster(url) { var im = new Image(); im.onload = function () { ambiDraw(im); }; im.src = url; }
    function ambiLoop(on) {
        clearInterval(ambiTimer); ambiTimer = null;
        if (on) ambiTimer = setInterval(function () { if (video && video.readyState >= 2) ambiDraw(video); }, 140);
    }

    // chapter list, chapter timeline, top bar and clock follow the playhead
    function trackProgress() {
        var v = all[current]; if (!v || !video) return;
        var t = video.currentTime, D = video.duration || v.duration || 1, ch = v.chapters || [];
        $("#snhPTopBar").css("width", Math.min(100, t * 100 / D) + "%");
        $("#snhPClock").text(mmss(t) + " / " + mmss(D));
        var $li = $("#snhChapters li"), $seg = $("#snhTimeline .snh-seg");
        ch.forEach(function (c, k) {
            var end = k < ch.length - 1 ? ch[k + 1].time : D, f = t <= c.time ? 0 : t >= end ? 1 : (t - c.time) / Math.max(0.1, end - c.time);
            var cur = t + 0.3 >= c.time && t < end;
            $li.eq(k).toggleClass("on", cur).toggleClass("done", f >= 1 && !cur).find(".snh-chfill").css("width", (cur ? f * 100 : 0) + "%");
            $seg.eq(k).toggleClass("on", cur).find("span").css("width", f * 100 + "%");
            if (cur && k !== lastChap) {
                var first = lastChap === -1; lastChap = k; $("#snhCChap").text(c.title);
                if (!first || t > 1.5) {
                    var $toast = $("#snhChToast"); $toast.find("small").text("Chapter " + ("0" + (k + 1)).slice(-2)); $toast.find("b").text(c.title);
                    $toast.removeClass("go"); void $toast[0].offsetWidth; $toast.addClass("go");
                }
            }
        });
    }

    function open(i, startAt, fromEl) {
        var v = all[i]; if (!v || v.available === false) return;
        hideUpNext();
        if (window.SnhMini && window.SnhMini.active()) window.SnhMini.hide(true);
        var wasOpen = $player.hasClass("on") && !$player.hasClass("closing");
        current = i;
        var pwin = $player.find(".snh-pwin")[0];
        if (!wasOpen) {
            var ox = 0, oy = 0;
            if (fromEl && fromEl.getBoundingClientRect) {
                var r = fromEl.getBoundingClientRect();
                ox = (r.left + r.width / 2) - window.innerWidth / 2; oy = (r.top + r.height / 2) - window.innerHeight / 2;
            }
            pwin.style.setProperty("--ox", ox + "px"); pwin.style.setProperty("--oy", oy + "px");
        } else {
            var $sw = $("#snhStageWrap, #snhPTitle, .snh-pside"); $sw.removeClass("swap"); void pwin.offsetWidth; $sw.addClass("swap");
        }
        $("#snhPMenu").text(v.menu + " menu");
        $("#snhPNo").text("Video " + v.no + " of " + all.length);
        $("#snhPTitle").text(v.title);
        $("#snhPDesc").text(v.description);
        var ch = v.chapters || [], D = v.duration || 1;
        $("#snhChapters").html(ch.map(function (c, k) {
            return '<li data-t="' + c.time + '" data-k="' + k + '" style="--i:' + k + '"><i class="snh-chdot"><em>' + ("0" + (k + 1)).slice(-2) + '</em><i class="fa fa-check"></i></i><b>' + esc(c.title) + "</b><time>" + mmss(c.time) + '</time><span class="snh-chfill"></span></li>';
        }).join(""));
        $("#snhTimeline").html(ch.map(function (c, k) {
            var end = k < ch.length - 1 ? ch[k + 1].time : D, w = Math.max(0.5, end - c.time);
            return '<button type="button" class="snh-seg" data-t="' + c.time + '" style="flex:' + w.toFixed(2) + ' 1 0" data-title="' + esc(c.title) + " · " + mmss(c.time) + '"><span></span></button>';
        }).join(""));
        var pv = all[i - 1], nx = all[i + 1];
        $("#snhPrev").prop("disabled", !pv).toggleClass("has-thumb", !!pv).find(".snh-navtxt > span").text(pv ? pv.title : "Previous");
        $("#snhPrev .snh-navthumb").attr("src", pv ? pv.poster : "");
        $("#snhNext").prop("disabled", !nx).toggleClass("has-thumb", !!nx).find(".snh-navtxt > span").text(nx ? nx.title : "Next");
        $("#snhNext .snh-navthumb").attr("src", nx ? nx.poster : "");
        $("#snhPTopBar").css("width", "0%"); $("#snhPClock").text("0:00 / " + mmss(D));
        ambiPoster(v.poster);
        lastChap = -1; buildScrub(v); loadCaptions(v); $("#snhKeys").removeClass("on"); $("#snhSpeedMenu").removeClass("on");
        $("#snhStage").removeClass("ended playing").addClass("ui"); $("#snhCTime").text("0:00 / " + mmss(D)); $("#snhCChap").text("");
        prevSrc = v.video; var pvEl = document.getElementById("snhPrevVid"); if (pvEl && pvEl.getAttribute("src")) { pvEl.removeAttribute("src"); pvEl.load(); }

        var pr = progressOf(v);
        video.poster = v.poster;
        video.src = v.video;
        video.load();
        $(video).one("loadedmetadata", function () {
            video.playbackRate = rate; video.volume = vol; video.muted = muted;
            if (startAt != null) video.currentTime = startAt + 0.05;
            else if (!pr.done && pr.t > 5 && pr.t < (video.duration || v.duration) - 5) video.currentTime = pr.t;
            var p = video.play(); if (p && p.catch) p.catch(function () { });
        });
        if (!wasOpen) {
            clearTimeout(closeTimer); clearTimeout(openTimer);
            // step 1: lay the window out invisibly; step 2 (two frames later): start the zoom, so the heavy first frame isn't part of the animation
            $player.removeClass("closing").addClass("on opening prep").attr("aria-hidden", "false"); $("body").css("overflow", "hidden");
            requestAnimationFrame(function () { requestAnimationFrame(function () {
                $player.removeClass("prep");
                openTimer = setTimeout(function () { $player.removeClass("opening"); }, 700);
            }); });
            lastFocus = document.activeElement; pwin.setAttribute("tabindex", "-1"); try { pwin.focus({ preventScroll: true }); } catch (e) { }
        }
    }

    function close() {
        hideUpNext();
        if (video && !video.paused && !video.ended && video.currentTime > 0 && window.SnhMini && all[current]) {
            var v = all[current];
            window.SnhMini.show({ id: v.id, title: v.title, menu: v.menu, video: v.video, poster: v.poster, t: video.currentTime, muted: video.muted, volume: video.volume, rate: video.playbackRate });
        }
        if (document.fullscreenElement) document.exitFullscreen().catch(function () { });
        if (video) { video.pause(); }
        $player.addClass("closing").attr("aria-hidden", "true");
        clearTimeout(closeTimer);
        closeTimer = setTimeout(function () { $player.removeClass("on closing"); quietRefresh(); }, 380);
        if (lastFocus && document.body.contains(lastFocus)) { try { lastFocus.focus({ preventScroll: true }); } catch (e) { } }
        $("body").css("overflow", "");
    }

    function highlightChapter() {
        var t = video.currentTime, $li = $("#snhChapters li"), on = -1;
        $li.each(function (k) { if (t + 0.3 >= parseFloat($(this).data("t"))) on = k; });
        $li.removeClass("on"); if (on >= 0) $li.eq(on).addClass("on");
    }

    function showUpNext() {
        var v = all[current]; if (!v) return;
        var nx = all[current + 1], p = loadProgress();
        var inMenu = all.filter(function (x) { return x.menu === v.menu; }), doneN = inMenu.filter(function (x) { return p[x.id] && p[x.id].done; }).length;
        $("#snhDoneMenu").text(doneN >= inMenu.length ? "You have finished every guide in the " + v.menu + " menu." : v.menu + " menu · " + doneN + " of " + inMenu.length + " guides watched");
        var $bar = $("#snhDoneBar").css({ transition: "none", width: "0%" }); $bar[0].getBoundingClientRect();
        $("#snhUpNextBox").toggle(!!nx); $("#snhUpNextPlay").toggle(!!nx);
        var $u = $("#snhUpNext").addClass("on"); $("#snhStage").addClass("ended");
        setTimeout(function () { $bar.css({ transition: "", width: Math.round(doneN * 100 / inMenu.length) + "%" }); }, 200);
        confetti();
        if (!nx) return;
        $("#snhUpNextTitle").text(nx.title); $("#snhUpNextImg").attr("src", nx.poster);
        var auto = $("#snhAuto").is(":checked"), sec = 6, ring = $u.find(".snh-ring")[0];
        $u.toggleClass("counting", auto); $("#snhUpNextSec").text(sec);
        ring.style.transition = "none"; ring.style.strokeDashoffset = "0"; ring.getBoundingClientRect(); ring.style.transition = "";
        if (!auto) return;
        upNextTimer = setInterval(function () {
            sec--; $("#snhUpNextSec").text(Math.max(sec, 0)); ring.style.strokeDashoffset = String(119.4 * (6 - sec) / 6);
            if (sec <= 0) { hideUpNext(); open(current + 1); }
        }, 1000);
    }

    // confetti burst over the video in the ShankhNaad colours
    function confetti() {
        var c = document.getElementById("snhConfetti"); if (!c || (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
        var r = c.parentNode.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
        c.width = r.width * dpr; c.height = r.height * dpr; var g = c.getContext("2d"); g.scale(dpr, dpr);
        var cols = ["#f000bc", "#ff7ad9", "#8b5cf6", "#006bf7", "#22d3ee", "#facc15", "#ffffff"], P = [];
        [[0.18, 1], [0.82, -1], [0.5, 0]].forEach(function (o) {
            for (var i = 0; i < 70; i++) {
                var ang = -Math.PI / 2 + (Math.random() - .5) * 1.3 + o[1] * 0.35, sp = 7 + Math.random() * 9;
                P.push({ x: r.width * o[0], y: r.height * 0.95, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, w: 6 + Math.random() * 6, h: 3 + Math.random() * 5,
                    a: Math.random() * 6, va: (Math.random() - .5) * .35, c: cols[(Math.random() * cols.length) | 0], s: Math.random() < .25 });
            }
        });
        var t0 = performance.now();
        (function frame(now) {
            var k = (now - t0) / 2600; g.clearRect(0, 0, r.width, r.height); if (k >= 1) return;
            P.forEach(function (p) {
                p.vy += 0.28; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx; p.y += p.vy; p.a += p.va;
                g.save(); g.globalAlpha = Math.max(0, 1 - k * k); g.translate(p.x, p.y); g.rotate(p.a); g.fillStyle = p.c;
                if (p.s) { g.beginPath(); g.arc(0, 0, p.h / 1.4, 0, 6.3); g.fill(); } else g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.a * 2)) + 1);
                g.restore();
            });
            requestAnimationFrame(frame);
        })(t0);
    }
    function hideUpNext() { clearInterval(upNextTimer); upNextTimer = null; $("#snhUpNext").removeClass("on counting"); $("#snhStage").removeClass("ended"); }

    // ================= custom controls, scrubber, captions, transcript =================
    var caps = [], capIdx = -1, lastChap = -1, idleTimer = null, raf = null, transUserScroll = 0, prevBusy = false, prevWant = null, dragging = false;
    function pref(k, d) { try { var x = localStorage.getItem("shankhnaad.help." + k); return x === null ? d : JSON.parse(x); } catch (e) { return d; } }
    function setPref(k, x) { try { localStorage.setItem("shankhnaad.help." + k, JSON.stringify(x)); } catch (e) { } }
    var ccOn = pref("cc", true), rate = pref("rate", 1), vol = pref("vol", 1), muted = pref("muted", false);

    function buildScrub(v) {
        var ch = v.chapters || [], D = v.duration || 1;
        $("#snhScrubSegs").html((ch.length ? ch : [{ time: 0 }]).map(function (c, k) {
            var end = k < ch.length - 1 ? ch[k + 1].time : D;
            return '<i class="snh-sseg" style="flex:' + Math.max(0.5, end - c.time).toFixed(2) + ' 1 0"><b class="buf"></b><b class="pl"></b></i>';
        }).join(""));
    }
    function paintScrub(t) {
        var v = all[current]; if (!v) return;
        var D = video.duration || v.duration || 1, ch = v.chapters || [{ time: 0 }], $s = $("#snhScrubSegs .snh-sseg"), buf = 0;
        try { for (var i = 0; i < video.buffered.length; i++) if (video.buffered.start(i) <= t + 0.5) buf = Math.max(buf, video.buffered.end(i)); } catch (e) { }
        ch.forEach(function (c, k) {
            var st = c.time, end = k < ch.length - 1 ? ch[k + 1].time : D, len = Math.max(0.1, end - st);
            var f = Math.min(1, Math.max(0, (t - st) / len)), fb = Math.min(1, Math.max(0, (buf - st) / len));
            var el = $s[k]; if (!el) return; el.children[0].style.width = fb * 100 + "%"; el.children[1].style.width = f * 100 + "%";
            el.classList.toggle("on", t >= st && t < end);
        });
        $("#snhKnob").css("left", Math.min(100, t * 100 / D) + "%");
        $("#snhCTime").text(mmss(t) + " / " + mmss(D));
    }
    function tick() { if (!video) return; if (!dragging) paintScrub(video.currentTime); syncCaptions(false); raf = requestAnimationFrame(tick); }
    function startRaf() { cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); }
    function stopRaf() { cancelAnimationFrame(raf); raf = null; }

    function loadCaptions(v) {
        caps = []; capIdx = -1; $("#snhCC").removeClass("on").find("span").text("");
        if (!v.captions) { $("#snhTrans").html('<li class="snh-trans-empty">No transcript for this video.</li>'); return; }
        $("#snhTrans").html('<li class="snh-trans-empty"><i class="fa fa-circle-o-notch fa-spin"></i> Loading transcript…</li>');
        $.ajax({ url: v.captions, dataType: "json", cache: true }).done(function (r) {
            if (all[current] !== v) return;
            caps = r || [];
            $("#snhTrans").html(caps.map(function (c, k) { return '<li data-t="' + c.s + '" style="--i:' + Math.min(k, 20) + '"><time>' + mmss(c.s) + "</time><span>" + esc(c.t) + "</span></li>"; }).join(""));
            syncCaptions(true);
        }).fail(function () { $("#snhTrans").html('<li class="snh-trans-empty">Transcript not available.</li>'); });
    }
    function syncCaptions(force) {
        if (!video || !caps.length) return;
        var t = video.currentTime, k = -1;
        for (var i = 0; i < caps.length; i++) { if (caps[i].s > t + 0.05) break; if (t <= caps[i].e + 0.3) k = i; }
        if (k === capIdx && !force) return;
        capIdx = k;
        var $cc = $("#snhCC"), sp = $cc.find("span")[0];
        if (k >= 0 && ccOn) { sp.textContent = caps[k].t; sp.classList.remove("pop"); void sp.offsetWidth; sp.classList.add("pop"); $cc.addClass("on"); }
        else $cc.removeClass("on");
        var $li = $("#snhTrans li");
        $li.each(function (j) { this.classList.toggle("on", j === k); this.classList.toggle("past", j < k); });
        if (k >= 0 && Date.now() - transUserScroll > 3500 && $(".snh-pane[data-pane=tr]").hasClass("on")) {
            var li = $li[k], box = document.querySelector(".snh-player .snh-pane[data-pane=tr]");
            if (li && box) box.scrollTo({ top: Math.max(0, li.offsetTop - box.clientHeight / 2 + li.offsetHeight / 2), behavior: "smooth" });
        }
    }

    function flash(icon) {
        var f = document.getElementById("snhFlash"); if (!f) return;
        f.innerHTML = '<i class="fa ' + icon + '"></i>'; f.classList.remove("go"); void f.offsetWidth; f.classList.add("go");
    }
    function seekBy(d) {
        if (!video) return; video.currentTime = Math.max(0, Math.min((video.duration || 0) - 0.1, video.currentTime + d));
        var fx = document.getElementById("snhSeekFx"); fx.textContent = (d > 0 ? "+" : "−") + Math.abs(d) + " s";
        fx.className = "snh-seekfx " + (d > 0 ? "r" : "l"); void fx.offsetWidth; fx.classList.add("go"); wake();
    }
    function togglePlay() {
        if (!video) return;
        if (video.paused || video.ended) { var p = video.play(); if (p && p.catch) p.catch(function () { }); flash("fa-play"); } else { video.pause(); flash("fa-pause"); }
    }
    function wake() {
        var st = document.getElementById("snhStage"); if (!st) return;
        st.classList.add("ui"); clearTimeout(idleTimer);
        idleTimer = setTimeout(function () { if (video && !video.paused && !dragging && !$("#snhSpeedMenu").hasClass("on")) st.classList.remove("ui"); }, 2600);
    }
    function setVol(x) {
        vol = Math.max(0, Math.min(1, x)); video.volume = vol; if (vol > 0) { video.muted = false; muted = false; }
        setPref("vol", vol); setPref("muted", muted); volUI();
    }
    function volUI() {
        var m = video.muted || video.volume === 0;
        $("#snhCMute i").attr("class", "fa " + (m ? "fa-volume-off" : video.volume < .5 ? "fa-volume-down" : "fa-volume-up"));
        $("#snhCVol").val(m ? 0 : video.volume)[0].style.setProperty("--p", (m ? 0 : video.volume) * 100 + "%");
    }
    function setCC(on) { ccOn = on; setPref("cc", on); $("#snhCCBtn").toggleClass("on", on); syncCaptions(true); if (!on) $("#snhCC").removeClass("on"); }
    function setRate(r) {
        rate = r; setPref("rate", r); if (video) video.playbackRate = r;
        $("#snhCSpeed").text(r + "×").toggleClass("on", r !== 1); $("#snhSpeedMenu button").each(function () { $(this).toggleClass("on", +$(this).data("r") === r); });
    }
    function toggleTheatre(on) {
        if (on == null) on = !$player.hasClass("theatre");
        $player.toggleClass("theatre", on); setPref("theatre", on); $("#snhCTheatre").toggleClass("on", on).find("i").attr("class", "fa " + (on ? "fa-compress" : "fa-arrows-h"));
    }
    function toggleFull() {
        var el = document.getElementById("snhStageWrap");
        if (document.fullscreenElement) document.exitFullscreen(); else if (el && el.requestFullscreen) el.requestFullscreen().catch(function () { });
    }
    function scrubTime(e) {
        var r = document.getElementById("snhScrub").getBoundingClientRect(), D = video.duration || (all[current] || {}).duration || 1;
        return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * D;
    }
    function showTip(e) {
        var v = all[current]; if (!v) return;
        var t = scrubTime(e), r = document.getElementById("snhScrub").getBoundingClientRect(), x = e.clientX - r.left;
        var ch = v.chapters || [], name = ""; ch.forEach(function (c) { if (t >= c.time) name = c.title; });
        var $t = $("#snhTip").addClass("on"); $("#snhStage").addClass("tipping"); $t.find("b").text(name); $t.find("span").text(mmss(t));
        $t.css("left", Math.max(100, Math.min(r.width - 100, x)) + "px");
        var pv = document.getElementById("snhPrevVid");
        if (pv && prevSrc && pv.getAttribute("src") !== prevSrc) { pv.src = prevSrc; prevBusy = false; prevWant = t; $(pv).one("loadedmetadata", function () { if (prevWant != null) { prevBusy = true; pv.currentTime = prevWant; prevWant = null; } }); return; }
        if (pv && pv.readyState >= 1) { if (prevBusy) prevWant = t; else { prevBusy = true; pv.currentTime = t; } }
    }



    // ---------------- init ----------------
    function bind() {
        $(document).off(NS); $(window).off(NS);
        $(document).on("click" + NS, ".snh-tab", function () {
            var pinned = $(this).closest(".snh-pin").length > 0;
            activeMenu = $(this).data("menu"); renderTabs(); renderLibrary();
            var $r = $(".snh"); if (pinned) $r.scrollTop($(".snh-win").outerHeight() - 4);
        });
        $(document).on("input" + NS, "#snhSearch", function () { query = $.trim(this.value); renderLibrary(); });
        $(document).on("click" + NS, ".snh-arw", function (e) {
            e.stopPropagation(); var g = $(this).closest(".snh-section").find(".snh-grid")[0];
            g.scrollBy({ left: (+$(this).data("dir")) * Math.max(300, g.clientWidth * 0.85), behavior: "smooth" });
        });
        $(window).on("resize" + NS, function () { $("#snhLibrary .snh-grid.shelf").each(function () { shelfState(this); }); });
        $(document).on("click" + NS, ".snh-fch li", function (e) { e.stopPropagation(); open(+$(this).closest(".snh-card").data("idx"), parseFloat($(this).data("t"))); });
        $(document).on("click" + NS, ".snh-card", function () { open(+$(this).data("idx"), null, $(this).find(".snh-thumb")[0] || this); });
        $(document).on("click" + NS, "#snhTimeline .snh-seg", function () { video.currentTime = parseFloat($(this).data("t")) + 0.05; video.play(); });
        $(document).on("click" + NS, ".snh-playall", function (e) { e.stopPropagation(); $("#snhAuto").prop("checked", true).trigger("change"); open(+$(this).data("first")); });
        $(document).on("keydown" + NS, ".snh-card", function (e) { if ($player.hasClass("on")) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(+$(this).data("idx")); } });
        $(document).on("click" + NS, "#snhContinue, #snhStart", function () { open(+$(this).data("idx"), null, document.querySelector("#snhContinue .snh-feature-thumb")); });
        $(document).on("keydown" + NS, "#snhContinue", function (e) { if ($player.hasClass("on")) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(+$(this).data("idx")); } });
        $(document).on("click" + NS, "#snhPClose", close);
        $(document).on("click" + NS, "#snhPlayer", function (e) { if (e.target === this) close(); });
        $(document).on("click" + NS, "#snhPrev", function () { if (current > 0) open(current - 1); });
        $(document).on("click" + NS, "#snhNext", function () { if (current < all.length - 1) open(current + 1); });
        $(document).on("click" + NS, "#snhChapters li", function () { video.currentTime = parseFloat($(this).data("t")) + 0.05; video.play(); });
        $(document).on("click" + NS, "#snhUpNextPlay", function () { hideUpNext(); open(current + 1); });
        $(document).on("click" + NS, "#snhUpNextCancel", hideUpNext);
        $(document).on("click" + NS, "#snhReplay", function () { hideUpNext(); video.currentTime = 0; video.play(); });
        // custom controls
        $(document).on("click" + NS, "#snhVClick, #snhBigPlay, #snhCPlay", function () { togglePlay(); wake(); });
        $(document).on("dblclick" + NS, "#snhVClick", toggleFull);
        $(document).on("click" + NS, "#snhCBack", function () { seekBy(-10); });
        $(document).on("click" + NS, "#snhCFwd", function () { seekBy(10); });
        $(document).on("click" + NS, "#snhCMute", function () { video.muted = !video.muted; muted = video.muted; if (!muted && video.volume === 0) video.volume = vol = .6; setPref("muted", muted); volUI(); });
        $(document).on("input" + NS, "#snhCVol", function () { setVol(parseFloat(this.value)); });
        $(document).on("click" + NS, "#snhCCBtn", function () { setCC(!ccOn); });
        $(document).on("click" + NS, "#snhCSpeed", function (e) { e.stopPropagation(); $("#snhSpeedMenu").toggleClass("on"); wake(); });
        $(document).on("click" + NS, "#snhSpeedMenu button", function (e) { e.stopPropagation(); setRate(+$(this).data("r")); $("#snhSpeedMenu").removeClass("on"); });
        $(document).on("click" + NS, function (e) { if (!$(e.target).closest(".snh-speed").length) $("#snhSpeedMenu").removeClass("on"); });
        $(document).on("click" + NS, "#snhCTheatre", function () { toggleTheatre(); });
        $(document).on("click" + NS, "#snhCPip", function () {
            if (document.pictureInPictureElement) document.exitPictureInPicture().catch(function () { });
            else if (video.requestPictureInPicture) video.requestPictureInPicture().catch(function () { });
        });
        $(document).on("click" + NS, "#snhCFull", toggleFull);
        $(document).on("fullscreenchange" + NS, function () { var fs = !!document.fullscreenElement; $("#snhStageWrap").toggleClass("fs", fs); $("#snhCFull i").attr("class", "fa " + (fs ? "fa-compress" : "fa-expand")); });
        $(document).on("click" + NS, "#snhCKeys", function () { $("#snhKeys").toggleClass("on"); });
        $(document).on("click" + NS, "#snhKeys", function () { $(this).removeClass("on"); });
        $(document).on("mousemove" + NS, "#snhStage", wake);
        $(document).on("mouseleave" + NS, "#snhStage", function () { if (video && !video.paused) { clearTimeout(idleTimer); this.classList.remove("ui"); } });
        // scrubber: hover preview, click and drag to seek
        $(document).on("pointermove" + NS, "#snhScrub", function (e) { showTip(e); if (dragging) { var t = scrubTime(e); paintScrub(t); } });
        $(document).on("pointerleave" + NS, "#snhScrub", function () { if (!dragging) { $("#snhTip").removeClass("on"); $("#snhStage").removeClass("tipping"); } });
        $(document).on("pointerdown" + NS, "#snhScrub", function (e) {
            dragging = true; this.setPointerCapture(e.pointerId); $(this).addClass("drag"); paintScrub(scrubTime(e)); wake();
        });
        $(document).on("pointerup" + NS + " pointercancel" + NS, "#snhScrub", function (e) {
            if (!dragging) return; dragging = false; $(this).removeClass("drag"); video.currentTime = scrubTime(e); $("#snhTip").removeClass("on"); $("#snhStage").removeClass("tipping"); wake();
        });
        // sidebar tabs and transcript
        $(document).on("click" + NS, ".snh-stabs button", function () {
            var pane = $(this).data("pane"); $(".snh-stabs button").removeClass("on"); $(this).addClass("on");
            $(".snh-stabs").attr("data-on", pane); $(".snh-pane").removeClass("on").filter("[data-pane=" + pane + "]").addClass("on");
            if (pane === "tr") { transUserScroll = 0; syncCaptions(true); }
        });
        $(document).on("click" + NS, "#snhTrans li[data-t]", function () { video.currentTime = parseFloat($(this).data("t")) + 0.02; video.play(); transUserScroll = 0; });
        $(document).on("wheel" + NS + " touchmove" + NS, ".snh-player .snh-pside", function () { transUserScroll = Date.now(); });
        $(document).on("keydown" + NS, function (e) {
            if (!document.getElementById("snhRoot")) { $(document).off(NS); $(window).off(NS); return; }
            var open_ = $player.hasClass("on") && !$player.hasClass("closing");
            if (open_ && !$(e.target).is("input[type=text],textarea,select") && !e.ctrlKey && !e.altKey && !e.metaKey) {
                var k = e.key, handled = true;
                if (k === " " || k === "k" || k === "K") { if ($(e.target).is("button") && !$(e.target).closest("#snhCtrl").length && $(e.target).closest("#snhPlayer").length) { handled = false; } else togglePlay(); }
                else if (k === "ArrowLeft") seekBy(-5); else if (k === "ArrowRight") seekBy(5);
                else if (k === "j" || k === "J") seekBy(-10); else if (k === "l" || k === "L") seekBy(10);
                else if (k === "ArrowUp") { setVol(video.volume + 0.1); flash("fa-volume-up"); } else if (k === "ArrowDown") { setVol(video.volume - 0.1); flash(video.volume <= 0.05 ? "fa-volume-off" : "fa-volume-down"); }
                else if (k === "m" || k === "M") $("#snhCMute").trigger("click");
                else if (k === "c" || k === "C") setCC(!ccOn);
                else if (k === "t" || k === "T") toggleTheatre();
                else if (k === "f" || k === "F") toggleFull();
                else if (k === "n" || k === "N") { if (current < all.length - 1) open(current + 1); }
                else if (k === "p" || k === "P") { if (current > 0) open(current - 1); }
                else if (k === "?") $("#snhKeys").toggleClass("on");
                else handled = false;
                if (handled) { e.preventDefault(); wake(); return; }
            }
            if (e.key === "Escape" && $("#snhKeys").hasClass("on")) { $("#snhKeys").removeClass("on"); }
            else if (e.key === "Escape" && document.fullscreenElement) { }
            else if (e.key === "Escape" && $player.hasClass("on")) { close(); }
            else if (e.key === "/" && !$player.hasClass("on") && !$(e.target).is("input,textarea")) { e.preventDefault(); $("#snhSearch").focus(); }
        });

        // pin the tabs at the top once the hero window's footer has scrolled out of view
        var root = document.getElementById("snhRoot"), foot = root && root.querySelector(".snh-win-foot");
        if (root && foot) {
            $(root).off("scroll" + NS).on("scroll" + NS, function () {
                var r = foot.getBoundingClientRect(), top = root.getBoundingClientRect().top;
                $("#snhPin").toggleClass("on", r.bottom < top + 6);
            });
        }

        var lastSave = 0;
        $(video).off(NS)
            .on("timeupdate" + NS, function () {
                trackProgress();
                if (current >= 0 && Date.now() - lastSave > 2000) { lastSave = Date.now(); setProgress(all[current], video.currentTime, false); }
            })
            .on("ended" + NS, function () { if (current >= 0) setProgress(all[current], 0, true); showUpNext(); })
            .on("play" + NS, function () { hideUpNext(); $("#snhStageWrap").addClass("is-playing"); $("#snhStage").addClass("playing"); $("#snhCPlay i").attr("class", "fa fa-pause"); ambiLoop(true); startRaf(); wake(); })
            .on("pause" + NS + " ended" + NS, function () { $("#snhStageWrap").removeClass("is-playing"); $("#snhStage").removeClass("playing").addClass("ui"); $("#snhCPlay i").attr("class", "fa fa-play"); ambiLoop(false); stopRaf(); paintScrub(video.currentTime); })
            .on("progress" + NS + " loadedmetadata" + NS, function () { paintScrub(video.currentTime); })
            .on("volumechange" + NS, volUI)
            .on("seeked" + NS, function () { trackProgress(); paintScrub(video.currentTime); syncCaptions(true); if (video.readyState >= 2) ambiDraw(video); });
        // hover preview frames come from a hidden muted copy of the video
        var pv = document.getElementById("snhPrevVid");
        if (pv) $(pv).off(NS).on("seeked" + NS, function () {
            var c = document.querySelector("#snhTip canvas"); try { c.getContext("2d").drawImage(pv, 0, 0, c.width, c.height); } catch (e) { }
            prevBusy = false; if (prevWant != null) { var w = prevWant; prevWant = null; prevBusy = true; pv.currentTime = w; }
        });
        setCC(ccOn); setRate(rate); toggleTheatre(pref("theatre", false)); video.volume = vol; video.muted = muted; volUI();
    }

    function reveal() {
        var root = document.getElementById("snhRoot"), links = document.querySelectorAll('link[href*="help-page.css"]'), done = false;
        function show() { if (done || !root) return; done = true; requestAnimationFrame(function () { requestAnimationFrame(function () { root.classList.add("is-shown"); root.classList.remove("is-boot"); setTimeout(function () { root.classList.add("settled"); }, 1600); }); }); }
        var pending = Array.prototype.filter.call(links, function (l) { try { return !l.sheet || !l.sheet.cssRules; } catch (e) { return false; } });
        if (!pending.length) show(); else { pending.forEach(function (l) { l.addEventListener("load", show); l.addEventListener("error", show); }); }
        setTimeout(show, 1500);
    }

    // the "liquid" ripple used by the player glass (SVG filter referenced from CSS), added once
    function liquidFilter() {
        if (document.getElementById("snhLiquidSvg")) return;
        var d = document.createElement("div"); d.id = "snhLiquidSvg"; d.setAttribute("aria-hidden", "true");
        d.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
        d.innerHTML = '<svg width="0" height="0"><filter id="snhLiquid" x="0" y="0" width="100%" height="100%">' +
            '<feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves="2" seed="7" result="n"/>' +
            '<feGaussianBlur in="n" stdDeviation="2" result="nb"/>' +
            '<feDisplacementMap in="SourceGraphic" in2="nb" scale="38" xChannelSelector="R" yChannelSelector="G"/></filter></svg>';
        document.body.appendChild(d);
    }
    // specular highlight follows the pointer across the glass
    function sheen() {
        var w = $player && $player.find(".snh-pwin")[0], pend = false, ev = null; if (!w) return;
        w.addEventListener("pointermove", function (e) {
            ev = e; if (pend) return; pend = true;
            requestAnimationFrame(function () { pend = false; var r = w.getBoundingClientRect();
                w.style.setProperty("--mx", ((ev.clientX - r.left) / r.width * 100).toFixed(1) + "%"); w.style.setProperty("--my", ((ev.clientY - r.top) / r.height * 100).toFixed(1) + "%"); });
        });
    }

    function init() {
        // The player is position:fixed; move it to <body> so no parent panel can clip or transform it.
        $("body > #snhPlayer").remove();
        $player = $("#snhPlayer").appendTo("body");
        video = document.getElementById("snhVideo");
        sheen();
        bind();
        reveal();

        $.ajax({ url: "/help/videos", type: "GET", dataType: "json", cache: false })
            .done(function (r) {
                if (!r || !r.success) {
                    $("#snhLibrary").html(""); $("#snhEmpty").show().find("b").text((r && r.message) || "No help videos found.");
                    $("#snhEmpty span").text("Copy the HelpVideos folder into wwwroot to install the videos.");
                    return;
                }
                menus = r.menus || [];
                all = (r.videos || []).sort(function (a, b) { return a.no - b.no; });
                renderAll();
                if (window.SnhMini) window.SnhMini.onExpand = function (id, t) { var k = all.findIndex(function (x) { return x.id === id; }); if (k >= 0) open(k, t); };
                var rq = null; try { rq = JSON.parse(sessionStorage.getItem("shankhnaad.help.resume") || "null"); sessionStorage.removeItem("shankhnaad.help.resume"); } catch (e) { }
                if (rq) { var k = all.findIndex(function (x) { return x.id === rq.id; }); if (k >= 0) setTimeout(function () { open(k, rq.t); }, 700); }
            })
            .fail(function () {
                $("#snhLibrary").html(""); $("#snhEmpty").show().find("b").text("Could not load the help videos.");
            });
    }

    // Page scripts run when the page is injected into .main-panel (loadIntoMainPanel) or on a full load.
    if (document.readyState === "loading") $(init); else init();

    // Leaving the page (another menu item loads into .main-panel): stop the video and remove the player.
    $(document).off("ajaxComplete.snhLeave").on("ajaxComplete.snhLeave", function () {
        if ($player && !document.getElementById("snhRoot")) {
            if (video) video.pause();
            $player.remove(); $player = null; $(document).off(NS).off("ajaxComplete.snhLeave"); $(window).off(NS); $("body").css("overflow", "");
        }
    });
})();

// =======================================================================================
// Floating mini player: when the player window is closed while a video is playing, the video carries on in a small
// glass player in the corner, even while you move to other pages of the application. It is created once per browser tab.
// =======================================================================================
(function () {
    "use strict";
    if (window.SnhMini) return;
    var KEY = "shankhnaad.help.progress", el, vid, cur = null, lastSave = 0, hideT;
    function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
    function save(t, done) {
        if (!cur) return;
        try { var p = JSON.parse(localStorage.getItem(KEY) || "{}"), o = p[cur.id] || {}; o.t = t; o.at = Date.now(); if (done) o.done = true; p[cur.id] = o; localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { }
    }
    function build() {
        // keep the styles once the Help page (and its <link>) is replaced by another page
        if (!document.getElementById("snhMiniCss")) {
            var src = document.querySelector('link[href*="help-page.css"]'), l = document.createElement("link");
            l.rel = "stylesheet"; l.id = "snhMiniCss"; l.href = src ? src.getAttribute("href") : "/css/help-page.css"; document.head.appendChild(l);
        }
        el = document.createElement("div"); el.className = "snh-mini"; el.id = "snhMini";
        el.innerHTML = '<div class="snh-mini-stage"><video id="snhMiniVideo" playsinline></video>' +
            '<button type="button" class="snh-mini-pp" title="Play / pause"><i class="fa fa-pause"></i></button>' +
            '<div class="snh-mini-tools"><button type="button" class="snh-mini-exp" title="Open in the player"><i class="fa fa-expand"></i></button>' +
            '<button type="button" class="snh-mini-x" title="Close"><i class="fa fa-times"></i></button></div>' +
            '<div class="snh-mini-done"><i class="fa fa-check"></i> Guide complete</div></div>' +
            '<div class="snh-mini-info"><span class="snh-mini-eq"><i></i><i></i><i></i></span><div><small></small><b></b></div></div><div class="snh-mini-bar"><span></span></div>';
        document.body.appendChild(el); vid = el.querySelector("video");
        el.querySelector(".snh-mini-pp").addEventListener("click", function () { if (vid.paused) vid.play(); else vid.pause(); });
        el.querySelector(".snh-mini-stage").addEventListener("dblclick", expand);
        el.querySelector(".snh-mini-exp").addEventListener("click", expand);
        el.querySelector(".snh-mini-x").addEventListener("click", function () { api.hide(); });
        vid.addEventListener("timeupdate", function () {
            el.querySelector(".snh-mini-bar span").style.width = (vid.currentTime * 100 / (vid.duration || 1)) + "%";
            if (Date.now() - lastSave > 2000) { lastSave = Date.now(); save(vid.currentTime, false); }
        });
        vid.addEventListener("play", function () { el.classList.add("playing"); el.querySelector(".snh-mini-pp i").className = "fa fa-pause"; });
        vid.addEventListener("pause", function () { el.classList.remove("playing"); el.querySelector(".snh-mini-pp i").className = "fa fa-play"; save(vid.currentTime, false); });
        vid.addEventListener("ended", function () { save(0, true); el.classList.add("done"); hideT = setTimeout(function () { api.hide(); }, 3500); });
    }
    function expand() {
        if (!cur) return;
        var st = { id: cur.id, t: vid.currentTime }; api.hide(true);
        if (document.getElementById("snhRoot") && typeof api.onExpand === "function") api.onExpand(st.id, st.t);
        else {
            try { sessionStorage.setItem("shankhnaad.help.resume", JSON.stringify(st)); } catch (e) { }
            if (typeof window.loadIntoMainPanel === "function") window.loadIntoMainPanel("/help"); else location.href = "/help";
        }
    }
    var api = {
        onExpand: null,
        active: function () { return !!(el && el.classList.contains("on")); },
        show: function (o) {
            if (!el) build();
            clearTimeout(hideT); cur = o; el.classList.remove("done");
            el.querySelector(".snh-mini-info small").textContent = o.menu + " menu";
            el.querySelector(".snh-mini-info b").textContent = o.title;
            vid.poster = o.poster || ""; vid.src = o.video; vid.muted = !!o.muted; vid.volume = o.volume == null ? 1 : o.volume;
            vid.addEventListener("loadedmetadata", function f() { vid.removeEventListener("loadedmetadata", f); vid.currentTime = o.t || 0; vid.playbackRate = o.rate || 1; var p = vid.play(); if (p && p.catch) p.catch(function () { }); });
            el.classList.remove("on"); void el.offsetWidth; el.classList.add("on");
        },
        hide: function (quick) {
            if (!el || !el.classList.contains("on")) return;
            save(vid.currentTime, vid.ended); vid.pause(); el.classList.remove("on"); cur = null;
            setTimeout(function () { if (!el.classList.contains("on")) { vid.removeAttribute("src"); vid.load(); } }, quick ? 50 : 450);
        }
    };
    window.SnhMini = api;
})();
