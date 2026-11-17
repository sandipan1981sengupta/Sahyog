// ===== Tab Panel Sidebar (rotated tab strip + slide-out panel) =====
// Initializes every .tab-strip and .tab-panel found within a given
// context (defaults to the whole document).
//
// window.TabPanelSidebar.init(context) can be called again after any
// AJAX/partial load to initialize newly-injected strips/panels. Safe
// to call repeatedly — already-initialized elements are skipped.
//
//   $(".main-panel").html(html);
//   window.TabPanelSidebar.init(".main-panel");
//
// Events fired (bubble, so you can listen on document):
//   tabpanel:open   -> { panelId }
//   tabpanel:close  -> { panelId }
//   tabpanel:loaded -> { panelId, url }   (only for panels using source-url,
//                                          fired once the AJAX content lands)
//
// Usage:
//   document.addEventListener("tabpanel:open", function (e) {
//       console.log("opened:", e.detail.panelId);
//   });
//
// Open/close staggered animations (badge -> title -> body) live entirely
// in tab-panel.css, keyed off the .tp-open class this file already
// toggles. No animation-specific JS is needed — every open naturally
// replays the CSS keyframes since .tp-open is removed then re-added.
//
// Each panel also gets its own backing "strip" element (created lazily,
// see ensureStrip below), sized to that panel's own width plus a small
// margin. This is what shows as the light-gray frame hugging the panel
// on the reference design.
//
// .tp-scrim is NOT a visual dimming overlay — it paints nothing. It's
// only an invisible click-catcher for optional outside-click-to-close,
// and is only made interactive when the currently open panel opted
// into that behavior (see closeOnOutsideClick / CloseOnOutsideClick on
// the tag helper). Panels that opt out leave the rest of the page
// fully clickable while open.

window.TabPanelSidebar = window.TabPanelSidebar || {};

window.TabPanelSidebar.init = function (context) {
    var $scope = context ? $(context) : $(document);

    function fire(el, name, detail) {
        el.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail }));
    }

    function initTabStrip($strip) {
        if ($strip.data("tps-inited")) return;
        $strip.data("tps-inited", true);

        $strip.find(".ts-tab").on("click", function () {
            var $tab = $(this);
            var targetPanelId = $tab.data("target-panel");
            if (!targetPanelId) return;

            // Only one tab in THIS strip is ever active at a time.
            $strip.find(".ts-tab.ts-active").removeClass("ts-active");
            $tab.addClass("ts-active");

            openTabPanel(targetPanelId);
        });
    }

    function initTabPanel($panel) {
        if ($panel.data("tps-inited")) return;
        $panel.data("tps-inited", true);

        $panel.find("> .tp-header .tp-close-btn").on("click", function () {
            closeTabPanel($panel);
        });
    }

    function ensureScrim() {
        var $scrim = $(".tp-scrim");
        if ($scrim.length === 0) {
            $scrim = $("<div class='tp-scrim'></div>").appendTo("body");
            $scrim.on("click", function () {
                var $open = $(".tab-panel.tp-open").last();
                if ($open.length === 0) return;
                // Only close on an outside click if THIS panel opted in.
                // See closeOnOutsideClick(panelId) below for how to read
                // or override the flag; default is true if unset.
                if (closeOnOutsideClick($open.attr("id"))) {
                    closeTabPanel($open);
                }
            });
        }
        return $scrim;
    }

    // Whether clicking outside a given panel should close it. Reads the
    // data-close-on-outside attribute set by the tag helper's
    // CloseOnOutsideClick property (true/false). Defaults to true when
    // the attribute is missing, so existing panels keep their current
    // behavior unless explicitly opted out.
    function closeOnOutsideClick(panelId) {
        var $panel = $("#" + panelId);
        var attr = $panel.attr("data-close-on-outside");
        if (attr === undefined) return true;
        return attr === "true";
    }

    // Each panel gets its own backing strip, created lazily on first
    // open and reused after that. The strip is sized to THIS panel's
    // own width (--tp-panel-w, read from the panel's resolved width so
    // it tracks whatever PanelWidth was set in Razor) rather than a
    // fixed size, so panels of different widths each get a correctly
    // sized strip instead of sharing one guessed dimension.
    //
    // Note: --tp-panel-w is ALSO set server-side directly on .tab-panel
    // itself (see the tag helper), so the corner badge — a genuine
    // descendant of .tab-panel — can read it via normal CSS inheritance
    // without depending on this JS-computed copy. The two stay in sync
    // since both derive from the same PanelWidth value; this JS copy
    // exists specifically for the STRIP, which lives outside the
    // panel's DOM subtree and has no other way to see that value.
    function ensureStrip($panel) {
        var panelId = $panel.attr("id");
        var $strip = $("#" + panelId + "-strip");
        if ($strip.length === 0) {
            var side = $panel.hasClass("tab-panel-left") ? "left" : "right";
            $strip = $("<div class='tp-strip tp-strip-" + side + "' id='" + panelId + "-strip'></div>").appendTo("body");
        }
        // Keep the strip's width in sync with the panel's actual
        // rendered width every time, in case PanelWidth is responsive
        // (e.g. the 100vw-minus-margin mobile override).
        $strip.css("--tp-panel-w", $panel.outerWidth() + "px");

        // --tp-strip-color, --tp-strip-extra, the four --tp-strip-radius-*
        // corners,
        // --tp-strip-margin-top, and --tp-strip-margin-bottom are set as
        // inline style vars on the PANEL element by the tag helper (so
        // Razor authors configure them right there on <tab-panel>), but
        // CSS custom properties don't inherit across sibling DOM nodes —
        // the strip lives directly under <body>, not inside the panel —
        // so copy them over explicitly here whenever the strip is
        // (re)used.
        var panelStyle = $panel[0].style;
        var stripVars = [
            "--tp-strip-color",
            "--tp-strip-extra",
            "--tp-strip-height",
            "--tp-strip-radius-tl",
            "--tp-strip-radius-tr",
            "--tp-strip-radius-br",
            "--tp-strip-radius-bl",
            "--tp-strip-shadow",
            "--tp-strip-margin-top",
            "--tp-strip-margin-bottom"
        ];
        stripVars.forEach(function (varName) {
            var value = panelStyle.getPropertyValue(varName);
            if (value) $strip.css(varName, value);
        });

        return $strip;
    }

    function openTabPanel(panelId) {
        var $panel = $("#" + panelId);
        if ($panel.length === 0) return;

        // Only one tab-panel open at a time — close any other before
        // opening this one, so panels from different tabs never stack.
        // Closing also clears that other panel's own tab's active state.
        $(".tab-panel.tp-open").not($panel).each(function () {
            closeTabPanel($(this));
        });

        // The scrim only intercepts clicks (and is only made visible/
        // interactive) when THIS panel wants outside-click-to-close.
        // Panels that opt out leave the page behind them fully
        // interactive — no invisible click-blocking layer at all.
        var $scrim = ensureScrim();
        if (closeOnOutsideClick(panelId)) {
            $scrim.addClass("tp-scrim-visible");
        } else {
            $scrim.removeClass("tp-scrim-visible");
        }

        var $strip = ensureStrip($panel);
        $strip.addClass("tp-strip-visible");

        void $panel[0].offsetWidth; // flush layout so the transition plays
        $panel.addClass("tp-open");

        loadPanelContentIfNeeded($panel);

        fire($panel[0], "tabpanel:open", { panelId: panelId });
    }

    function closeTabPanel($panel) {
        $panel.removeClass("tp-open");

        var panelId = $panel.attr("id");
        $(".ts-tab[data-target-panel='" + panelId + "']").removeClass("ts-active");

        $("#" + panelId + "-strip").removeClass("tp-strip-visible");

        fire($panel[0], "tabpanel:close", { panelId: panelId });

        if ($(".tab-panel.tp-open").length === 0) {
            $(".tp-scrim").removeClass("tp-scrim-visible");
        }
    }

    // Loads a panel's AJAX content (data-source-url) the first time it's
    // opened. Subsequent opens reuse the already-loaded content — it is
    // NOT re-fetched every time, so if you need fresh data on every open,
    // clear data-loaded back to "false" yourself before calling
    // openTabPanel again (see window.reloadTabPanelContent below).
    function loadPanelContentIfNeeded($panel) {
        var sourceUrl = $panel.attr("data-source-url");
        if (!sourceUrl) return;

        var alreadyLoaded = $panel.attr("data-loaded") === "true";
        if (alreadyLoaded) return;

        var $body = $panel.find("> .tp-body");
        $body.attr("data-loading", "true");

        $.ajax({
            url: sourceUrl,
            method: "GET",
            success: function (html) {
                var $loadingEl = $body.find("> .tp-loading");
                $body.html(html);
                $body.append($loadingEl); // keep the spinner element around, just hidden, in case of a future manual reload
                $body.attr("data-loading", "false");
                $panel.attr("data-loaded", "true");
                fire($panel[0], "tabpanel:loaded", { panelId: $panel.attr("id"), url: sourceUrl });
            },
            error: function () {
                $body.attr("data-loading", "false");
                $body.prepend("<div class='tp-load-error'>Couldn't load this content. Please try again.</div>");
            }
        });
    }

    // ----- Programmatic control -----
    window.openTabPanel = function (panelId) {
        openTabPanel(panelId);
    };

    window.closeTabPanel = function (panelId) {
        var $panel = $("#" + panelId);
        if ($panel.length) closeTabPanel($panel);
    };

    // Closes whichever panel is currently open, without needing to know
    // its id. Useful for "leaving the view" hooks (SPA route change, a
    // nav-menu click that swaps out .main-panel, etc.) where you just
    // want to guarantee nothing is left open behind you.
    //
    //   window.closeOpenTabPanel();
    //
    // No-op if nothing is open. Only one panel can ever be open at a
    // time (openTabPanel enforces that), so this always targets at most
    // one panel — but it's written as a loop for safety in case that
    // invariant is ever relaxed later.
    window.closeOpenTabPanel = function () {
        $(".tab-panel.tp-open").each(function () {
            closeTabPanel($(this));
        });
    };

    // Forces the next open of this panel to re-fetch its source-url
    // content instead of reusing what was already loaded.
    window.reloadTabPanelContent = function (panelId) {
        $("#" + panelId).attr("data-loaded", "false");
    };

    // ----- Actually run initialization for this scope -----
    var $strips = ($scope.is && $scope.is(".tab-strip")) ? $scope : $scope.find(".tab-strip");
    var $panels = ($scope.is && $scope.is(".tab-panel")) ? $scope : $scope.find(".tab-panel");

    $strips.each(function () {
        initTabStrip($(this));
    });

    $panels.each(function () {
        initTabPanel($(this));
    });
};

$(document).ready(function () {
    window.TabPanelSidebar.init();
});