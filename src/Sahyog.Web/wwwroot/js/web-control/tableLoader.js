// =======================================================================================
// tableLoader.js — page loading indicator
// A black pill at the top centre of the screen (Dynamic Island style) with a glowing colour
// orb and flowing light waves, plus a very slightly dark layer that blocks clicks while loading.
// Self-contained: the CSS is added to the page once, the first time it is needed.
//
// Public functions (used by actionHeaderTable.js, and usable from any page):
//     ShowTableLoader(tableId, text)   start a loading period (text is read by screen readers only)
//     HideTableLoader(tableId)         end it; the pill closes when every Show has had a Hide
//     LoaderSettings                   { showDelay, minVisible } timings in milliseconds
//
// Load this file BEFORE actionHeaderTable.js.
// =======================================================================================


var TableLoaders = {};                                   // keyed by tableId: number of running requests
var GlobalLoader = { count: 0, timer: null, closeTimer: null, shownAt: 0, text: null, $el: null, $backdrop: null }; // one pill + one backdrop for the whole page

function EnsureLoaderStyles() {
    if (document.getElementById("mt-loader-styles")) return;
    var slide = "cubic-bezier(.22,1,.36,1)";    // smooth glide that slows down gently at the end
    var ease = "cubic-bezier(.2,.9,.25,1.15)";  // slight overshoot for the width, like the iPhone island
    var css =
        // Full-screen backdrop: blocks every click on the page while loading, very slightly dark
        ".mt-backdrop{position:fixed;inset:0;z-index:2147482999;background:rgba(0,0,0,0);cursor:progress;" +
        "transition:background .25s ease}" +
        ".mt-backdrop.mt-open{background:rgba(0,0,0,.12)}" +

        // The pill: deep black with a faint glass sheen on top and a slowly shifting colour aura around it
        ".mt-island{position:fixed;top:14px;left:50%;z-index:2147483000;height:52px;width:52px;" +
        "border-radius:999px;background:linear-gradient(180deg,#1a1a1c 0%,#050505 55%,#000 100%);" +
        "box-shadow:inset 0 1px 0 rgba(255,255,255,.09),inset 0 -1px 0 rgba(255,255,255,.03)," +
        "0 0 0 1px rgba(255,255,255,.05),0 12px 32px rgba(0,0,0,.35);" +
        "display:flex;align-items:center;justify-content:center;overflow:hidden;pointer-events:none;" +
        "opacity:0;transform:translate(-50%,-90px);" +
        "transition:transform .45s " + slide + ",opacity .3s ease,width .45s " + ease + " .15s}" +
        ".mt-island.mt-open{width:236px;opacity:1;transform:translate(-50%,0);animation:mt-aura 4s ease-in-out infinite}" +
        ".mt-island.mt-closing{transition:width .3s " + slide + ",transform .4s " + slide + " .15s,opacity .3s ease .2s}" +

        // Content fades in from a soft blur once the pill has opened
        ".mt-island-content{display:flex;align-items:center;gap:14px;opacity:0;filter:blur(4px);transform:scale(.9);" +
        "transition:opacity .35s ease .22s,filter .4s ease .22s,transform .4s " + slide + " .22s}" +
        ".mt-island.mt-open .mt-island-content{opacity:1;filter:blur(0);transform:scale(1)}" +
        ".mt-island.mt-closing .mt-island-content{transition:opacity .15s ease,filter .15s ease;opacity:0;filter:blur(4px)}" +

        // Orb: glowing, two colour layers turning in opposite directions, shape gently morphing, colours drifting
        ".mt-orb{position:relative;width:30px;height:30px;flex:none;" +
        "filter:drop-shadow(0 0 6px rgba(124,77,255,.75)) drop-shadow(0 0 12px rgba(0,229,255,.25));" +
        "animation:mt-pulse 2s ease-in-out infinite}" +
        ".mt-orb i{position:absolute;inset:0;border-radius:50%}" +
        ".mt-orb .mt-orb-a{background:conic-gradient(from 0deg,#00e5ff,#7c4dff,#ff2d95,#ff9f0a,#00e5ff);" +
        "animation:mt-spin 2.6s linear infinite,mt-hue 6s ease-in-out infinite alternate}" +
        ".mt-orb .mt-orb-b{inset:3px;background:conic-gradient(from 180deg,#ff2d95,#00e5ff,#7c4dff,#ff2d95);" +
        "mix-blend-mode:screen;opacity:.8;filter:blur(1px);" +
        "animation:mt-spin 1.7s linear infinite reverse,mt-morph 2.6s ease-in-out infinite}" +
        ".mt-orb .mt-orb-c{inset:6px;background:radial-gradient(circle at 34% 28%,rgba(255,255,255,.95),rgba(255,255,255,.15) 45%,rgba(255,255,255,0) 70%);" +
        "animation:mt-morph 3.4s ease-in-out infinite reverse}" +

        // Waves: three glowing lines flowing sideways at different speeds, each gently rising and falling,
        // fading out at both ends
        ".mt-waves{display:block;width:132px;height:30px;overflow:visible;" +
        "-webkit-mask-image:linear-gradient(90deg,transparent,#000 18%,#000 82%,transparent);" +
        "mask-image:linear-gradient(90deg,transparent,#000 18%,#000 82%,transparent);" +
        "filter:drop-shadow(0 0 3px rgba(124,77,255,.8))}" +
        ".mt-waves g{transform-box:view-box;transform-origin:50% 50%}" +
        ".mt-waves path{fill:none;stroke-width:2;stroke-linecap:round;mix-blend-mode:screen}" +
        ".mt-waves .w1 g{animation:mt-breathe 2.2s ease-in-out infinite}" +
        ".mt-waves .w1 path{stroke:#00e5ff;animation:mt-flow-28 1.5s linear infinite}" +
        ".mt-waves .w2 g{animation:mt-breathe 2.9s ease-in-out infinite -.8s}" +
        ".mt-waves .w2 path{stroke:#8b5cf6;stroke-width:2.4;animation:mt-flow-42 2.3s linear infinite reverse}" +
        ".mt-waves .w3 g{animation:mt-breathe 1.8s ease-in-out infinite -.4s}" +
        ".mt-waves .w3 path{stroke:#ff2d95;opacity:.9;animation:mt-flow-21 1.1s linear infinite}" +

        // Screen-reader text (not visible)
        ".mt-island-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +

        "@keyframes mt-spin{to{transform:rotate(360deg)}}" +
        "@keyframes mt-hue{from{filter:hue-rotate(0deg)}to{filter:hue-rotate(45deg)}}" +
        "@keyframes mt-pulse{0%,100%{transform:scale(.93)}50%{transform:scale(1.05)}}" +
        "@keyframes mt-morph{0%,100%{border-radius:50%}33%{border-radius:42% 58% 55% 45%/48% 42% 58% 52%}" +
        "66%{border-radius:58% 42% 45% 55%/55% 58% 42% 45%}}" +
        "@keyframes mt-breathe{0%,100%{transform:scaleY(.45)}50%{transform:scaleY(1)}}" +
        "@keyframes mt-flow-21{to{transform:translateX(-21px)}}" +
        "@keyframes mt-flow-28{to{transform:translateX(-28px)}}" +
        "@keyframes mt-flow-42{to{transform:translateX(-42px)}}" +
        "@keyframes mt-aura{0%,100%{box-shadow:inset 0 1px 0 rgba(255,255,255,.09),0 0 0 1px rgba(255,255,255,.05)," +
        "0 12px 32px rgba(0,0,0,.35),0 0 22px rgba(124,77,255,.28)}" +
        "50%{box-shadow:inset 0 1px 0 rgba(255,255,255,.09),0 0 0 1px rgba(255,255,255,.05)," +
        "0 12px 32px rgba(0,0,0,.35),0 0 26px rgba(0,229,255,.22)}}" +
        "@media (prefers-reduced-motion:reduce){.mt-island,.mt-island.mt-closing{transition:opacity .2s ease}" +
        ".mt-orb,.mt-orb i,.mt-waves g,.mt-waves path,.mt-island.mt-open{animation-duration:4s!important}}";
    $("<style id='mt-loader-styles'>").text(css).appendTo("head");
}

// Builds a smooth repeating wave (SVG path) that is one wavelength longer than the visible area,
// so sliding it left by exactly one wavelength loops without a visible jump.
function BuildWavePath(width, height, amplitude, wavelength) {
    var cy = height / 2, half = wavelength / 2;
    var d = "M0," + cy + " Q" + (wavelength / 4) + "," + (cy - amplitude) + " " + half + "," + cy;
    for (var x = half; x < width + wavelength * 2; x += half) {
        d += " T" + (x + half) + "," + cy;
    }
    return d;
}

// Loader timing (milliseconds)
//   showDelay  - wait before the pill appears (0 = straight away, on every load)
//   minVisible - once shown, the pill stays at least this long, so a very fast refresh
//                still shows a clean slide in and out instead of a flicker
var LoaderSettings = { showDelay: 0, minVisible: 700 };

/**
 * Shows the loading pill at the top of the screen while a request for this table runs,
 * and covers the whole page with a very slightly dark layer so nothing can be clicked.
 * Requests are counted (per table and for the page), so the pill stays until every
 * running request has finished.
 * tableId - id of the <modern-table> element
 * text    - optional text for screen readers (not shown on screen), default "Loading..."
 */
function ShowTableLoader(tableId, text) {
    EnsureLoaderStyles();

    TableLoaders[tableId] = (TableLoaders[tableId] || 0) + 1;
    $("#" + tableId).attr("aria-busy", "true");

    GlobalLoader.count++;
    if (GlobalLoader.count > 1) {
        if (GlobalLoader.$el) GlobalLoader.$el.find(".mt-island-sr").text(text || "Loading...");
        return; // already showing (or about to)
    }

    // A new load started while the pill was waiting to close: keep the same pill open
    if (GlobalLoader.closeTimer) {
        clearTimeout(GlobalLoader.closeTimer);
        GlobalLoader.closeTimer = null;
        if (GlobalLoader.$el) {
            GlobalLoader.$el.find(".mt-island-sr").text(text || "Loading...");
            return;
        }
    }

    // Block clicks straight away, so no row can be selected while loading
    var $backdrop = $("<div class='mt-backdrop' aria-hidden='true'></div>");
    $("body").append($backdrop);
    GlobalLoader.$backdrop = $backdrop;
    if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur(); // stops keyboard actions on the focused button or row
    }

    GlobalLoader.text = text || "Loading...";
    GlobalLoader.timer = setTimeout(OpenLoaderPill, LoaderSettings.showDelay);
}

// Creates the pill and starts its slide-in animation
function OpenLoaderPill() {
    GlobalLoader.timer = null;
    if (GlobalLoader.$el) return;

    var W = 132, H = 30;
    var waves =
        "<svg class='mt-waves' viewBox='0 0 " + W + " " + H + "' width='" + W + "' height='" + H + "' aria-hidden='true'>" +
        "<g class='w2'><g><path d='" + BuildWavePath(W, H, 11, 42) + "'/></g></g>" +
        "<g class='w1'><g><path d='" + BuildWavePath(W, H, 8, 28) + "'/></g></g>" +
        "<g class='w3'><g><path d='" + BuildWavePath(W, H, 6, 21) + "'/></g></g>" +
        "</svg>";
    var $el = $("<div class='mt-island' role='status' aria-live='polite'>" +
        "<div class='mt-island-content'>" +
        "<span class='mt-orb'><i class='mt-orb-a'></i><i class='mt-orb-b'></i><i class='mt-orb-c'></i></span>" +
        waves +
        "</div><span class='mt-island-sr'></span></div>");
    $el.find(".mt-island-sr").text(GlobalLoader.text || "Loading...");
    $("body").append($el);
    GlobalLoader.$el = $el;
    GlobalLoader.shownAt = Date.now();

    var $backdrop = GlobalLoader.$backdrop;
    // two frames so the browser paints the closed state first, then animates it open
    requestAnimationFrame(function () {
        requestAnimationFrame(function () {
            $el.addClass("mt-open");
            if ($backdrop) $backdrop.addClass("mt-open"); // darken the screen slightly together with the pill
        });
    });
}

/**
 * Closes the pill once every ShowTableLoader call has been matched by a HideTableLoader call.
 * If the pill has been visible for less than LoaderSettings.minVisible, it waits the rest first.
 */
function HideTableLoader(tableId) {
    if (!TableLoaders[tableId]) return;
    TableLoaders[tableId]--;
    if (TableLoaders[tableId] === 0) $("#" + tableId).removeAttr("aria-busy");

    GlobalLoader.count--;
    if (GlobalLoader.count > 0) return;

    // Loading finished before the pill was even created: show it now so the user still sees it
    if (!GlobalLoader.$el) {
        clearTimeout(GlobalLoader.timer);
        OpenLoaderPill();
    }

    var shownFor = Date.now() - (GlobalLoader.shownAt || 0);
    var wait = Math.max(0, LoaderSettings.minVisible - shownFor);
    GlobalLoader.closeTimer = setTimeout(CloseLoaderPill, wait);
}

// Slides the pill back up and removes the click-blocking layer
function CloseLoaderPill() {
    GlobalLoader.closeTimer = null;
    var $el = GlobalLoader.$el, $backdrop = GlobalLoader.$backdrop;
    GlobalLoader.$el = null;
    GlobalLoader.$backdrop = null;
    if ($backdrop) {
        $backdrop.css("pointer-events", "none").removeClass("mt-open"); // page is clickable again right away
        setTimeout(function () { $backdrop.remove(); }, 300);
    }
    if ($el) {
        $el.addClass("mt-closing").removeClass("mt-open"); // narrow back to a dot, then slide up out of view
        setTimeout(function () { $el.remove(); }, 600);
    }
}
