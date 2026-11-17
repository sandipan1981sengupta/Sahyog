// ===== Tab Panel strip buttons (<tab-panel-nav> / <tab-nav-button>) =====
// Load AFTER tab-panel.js. Standalone — hooks into tab-panel.js only
// through its public "tabpanel:open" event, so tab-panel.js needs no edits.
//
// window.TabPanelNav.init(context) can be re-run after AJAX/partial loads,
// same as window.TabPanelSidebar.init. Already-initialized panels are skipped.
//
// Events fired (bubble, listen on document):
//   tabpanel:navchange -> { panelId, sectionId, label }
//   tabpanel:loaded    -> { panelId, sectionId, url }   (section source-url loaded)
//
// Programmatic control:
//   window.selectTabPanelSection("SecurityPanel", "VehicleSection");
//   window.reloadTabPanelSection("SecurityPanel", "VehicleSection"); // re-fetch next time it's shown

window.TabPanelNav = window.TabPanelNav || {};

(function ($) {
    function fire(el, name, detail) {
        el.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail }));
    }

    function sectionOf($panel, sectionId) {
        return sectionId ? $panel.find("> .tp-body").find("#" + sectionId) : $();
    }

    function selectNavButton($panel, $btn, silent) {
        var $buttons = $panel.find("> .tp-nav .tp-nav-btn");
        $buttons.removeClass("tp-nav-active").attr({ "aria-selected": "false", tabindex: "-1" });
        $btn.addClass("tp-nav-active").attr({ "aria-selected": "true", tabindex: "0" });

        var sectionId = $btn.attr("data-target-section");
        if (sectionId) {
            var $body = $panel.find("> .tp-body");
            $body.find(".tp-section.tp-section-active").removeClass("tp-section-active");
            sectionOf($panel, sectionId).addClass("tp-section-active");
            $body.scrollTop(0);
        }

        // Only fetch when the panel is actually visible; otherwise the
        // tabpanel:open listener below picks it up on open.
        if ($panel.hasClass("tp-open")) loadSectionIfNeeded($panel, $btn);

        if (!silent) {
            fire($panel[0], "tabpanel:navchange", {
                panelId: $panel.attr("id"),
                sectionId: sectionId || null,
                label: $.trim($btn.find(".tp-nav-label").text())
            });
        }
    }

    function loadSectionIfNeeded($panel, $btn) {
        var url = $btn.attr("data-source-url");
        var sectionId = $btn.attr("data-target-section");
        if (!url || !sectionId) return;

        var $section = sectionOf($panel, sectionId);
        if ($section.length === 0) return;

        var state = $section.attr("data-loaded");
        if (state === "true" || state === "loading") return;

        $section.attr("data-loaded", "loading")
                .html("<div class='tp-loading'><div class='tp-spinner'></div></div>");

        $.ajax({
            url: url,
            method: "GET",
            success: function (html) {
                $section.html(html).attr("data-loaded", "true");
                fire($panel[0], "tabpanel:loaded", { panelId: $panel.attr("id"), sectionId: sectionId, url: url });
            },
            error: function () {
                $section.attr("data-loaded", "false")
                        .html("<div class='tp-load-error'>Couldn't load this section. Close and reopen the panel to try again.</div>");
            }
        });
    }

    function initPanelNav($panel) {
        if ($panel.data("tpn-inited")) return;
        var $nav = $panel.find("> .tp-nav");
        if ($nav.length === 0) return;
        $panel.data("tpn-inited", true);

        var $buttons = $nav.find(".tp-nav-btn");

        // Mark every targeted element as a switchable section, so Razor
        // markup can stay a plain <div id="...">.
        $buttons.each(function () {
            sectionOf($panel, $(this).attr("data-target-section")).addClass("tp-section");
        });

        $nav.on("click", ".tp-nav-btn", function () {
            selectNavButton($panel, $(this), false);
        });

        // Up/Down arrows move between buttons (standard vertical tablist)
        $nav.on("keydown", ".tp-nav-btn", function (e) {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            var $all = $nav.find(".tp-nav-btn");
            var i = $all.index(this) + (e.key === "ArrowDown" ? 1 : -1);
            var $next = $all.eq((i + $all.length) % $all.length);
            $next.trigger("focus").trigger("click");
        });

        var $initial = $buttons.filter(".tp-nav-active").first();
        if ($initial.length === 0) $initial = $buttons.first();
        if ($initial.length) selectNavButton($panel, $initial, true);
    }

    window.TabPanelNav.init = function (context) {
        var $scope = context ? $(context) : $(document);
        var $panels = $scope.is(".tab-panel") ? $scope : $scope.find(".tab-panel");
        $panels.each(function () {
            initPanelNav($(this));
        });
    };

    // Lazy-load the active section's source-url when its panel opens.
    document.addEventListener("tabpanel:open", function (e) {
        var $panel = $("#" + e.detail.panelId);
        var $active = $panel.find("> .tp-nav .tp-nav-btn.tp-nav-active");
        if ($active.length) loadSectionIfNeeded($panel, $active);
    });

    window.selectTabPanelSection = function (panelId, sectionId) {
        var $panel = $("#" + panelId);
        var $btn = $panel.find("> .tp-nav .tp-nav-btn[data-target-section='" + sectionId + "']");
        if ($btn.length) selectNavButton($panel, $btn, false);
    };

    window.reloadTabPanelSection = function (panelId, sectionId) {
        var $panel = $("#" + panelId);
        sectionOf($panel, sectionId).attr("data-loaded", "false");
        var $btn = $panel.find("> .tp-nav .tp-nav-btn.tp-nav-active[data-target-section='" + sectionId + "']");
        if ($btn.length && $panel.hasClass("tp-open")) loadSectionIfNeeded($panel, $btn);
    };

    $(document).ready(function () {
        window.TabPanelNav.init();
    });
})(jQuery);
