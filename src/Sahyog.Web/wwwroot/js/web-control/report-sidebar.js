// ===== Report Sidebar (icon rail + slide-out Report Details panel) =====
// Auto-initializes every .report-rail on the page.
//
// Events fired (all bubble, so you can listen on document or the rail):
//
//   report:railitemclick    -> { key, label, href, opensPanel, element }
//   report:navrowclick      -> { id, label, href, hasNestedPanel, panelId, element }
//                               Fired for every <report-nav-row> click.
//                               panelId identifies which <report-panel>
//                               this row belongs to — use it (or
//                               e.detail.element) to disambiguate rows
//                               that share the same id across different
//                               panels, since duplicate ids across
//                               separate panels are common when the same
//                               row labels (Accounts, Bank Book, etc.)
//                               repeat in each panel.
//                               If the row has a nested <report-panel> as
//                               its child content, that panel is opened
//                               automatically (hasNestedPanel: true) —
//                               otherwise it's just this event, so you can
//                               decide what to do from your own JS
//                               (open a modal, navigate, call an API, etc).
//   report:itemclick        -> { id, label, panelId, element }
//                               Fired when a leaf report row (inside a
//                               <report-section>) is clicked. The row is
//                               marked active automatically within its panel.
//   report:panelopen        -> { panelId }
//   report:panelclose       -> { panelId }
//
// Usage:
//   document.addEventListener("report:navrowclick", function (e) {
//       if (!e.detail.hasNestedPanel) {
//           console.log("handle navigation myself:", e.detail.id);
//       }
//   });

$(document).ready(function () {

    $(".report-rail").each(function () {
        initRail($(this));
    });

    // All panels (top-level and nested) share the same init logic.
    $(".report-panel").each(function () {
        initPanel($(this));
    });

    // ----- Handle open panels on window resize -----
    //
    // This runs in two parts:
    //
    // 1. IMMEDIATE, un-debounced repositioning — every resize tick, every
    //    currently open panel (pinned or not) is kept glued to the rail's
    //    actual current position. This runs with no delay specifically so
    //    a panel never visibly drifts apart from the rail while the user
    //    is actively dragging the window size — that gap-then-vanish
    //    effect was happening because the OLD code only repositioned
    //    (or closed) after a 150ms debounce, leaving a stale position
    //    on screen for the whole debounce window during an active drag.
    //
    // 2. DEBOUNCED close decision — once resizing has settled (150ms of
    //    no further resize events), any panel that ISN'T pinned closes.
    //    This part stays debounced because closing plays a close
    //    animation, which should only happen once, after resizing has
    //    actually finished — not on every intermediate tick.
    function repositionAllOpenPanels() {
        var $openPanels = $(".report-panel.rp-open");
        if ($openPanels.length === 0) return;

        $openPanels.each(function () {
            var $panel = $(this);
            if ($panel.hasClass("rp-nested")) {
                var $parent = $openPanels.not($panel).first();
                if ($parent.length) {
                    repositionNestedPanel($panel, $parent);
                }
            } else {
                positionPanelNextToRail($panel);
            }
        });
    }

    var resizeCloseTimer = null;
    $(window).on("resize", function () {
        repositionAllOpenPanels();

        clearTimeout(resizeCloseTimer);
        resizeCloseTimer = setTimeout(function () {
            $(".report-panel.rp-open").each(function () {
                var $panel = $(this);
                if (!$panel.hasClass("rp-pinned")) {
                    closePanel($panel);
                }
            });
        }, 150);
    });

    function fire(el, name, detail) {
        el.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail }));
    }

    function initRail($rail) {
        var $indicator = $rail.find("> .rr-active-indicator");

        // Moves the shared indicator bar to sit against whichever item is
        // currently active, matching that item's own top/height exactly
        // (same proportions as the old per-item ::before: 6px inset top
        // and bottom). Uses getBoundingClientRect so this stays correct
        // regardless of scrolling, since positions are measured relative
        // to the rail itself, and the indicator lives inside the same
        // scrollable container so it scrolls together with the list.
        function positionIndicator(animate) {
            var $active = $rail.find("> .rr-items > .rr-item.rr-active").first();
            if ($active.length === 0 || $indicator.length === 0) {
                $indicator.removeClass("rr-indicator-visible");
                return;
            }

            var railRect = $rail[0].getBoundingClientRect();
            var itemRect = $active[0].getBoundingClientRect();
            var scrollTop = $rail[0].scrollTop;

            // The indicator's un-transformed position is fixed at top:0
            // (set once in CSS/here); movement between items happens
            // purely via transform: translateY(...), which is the
            // property actually declared in the CSS transition — moving
            // "top" directly cannot be animated by that transition, so
            // translateY is required for the slide to actually animate.
            var offsetY = (itemRect.top - railRect.top) + scrollTop + 6;
            var height = itemRect.height - 12;

            if (!animate) {
                $indicator[0].style.transition = "none";
            }
            $indicator.css({
                top: "0px",
                height: height + "px",
                transform: "translateY(" + offsetY + "px)"
            });
            $indicator.addClass("rr-indicator-visible");
            $rail.addClass("rr-indicator-active");

            if (!animate) {
                // force layout flush, then restore the transition so the
                // *next* move (a real click) animates normally — this
                // initial placement should never animate in from top:0.
                void $indicator[0].offsetHeight;
                $indicator[0].style.transition = "";
            }
        }

        // Initial placement (no animation — it should just appear where
        // the server-rendered active item already is, not slide in from
        // the top of the rail on page load).
        positionIndicator(false);

        // Widen the shared indicator bar specifically when the CURRENTLY
        // ACTIVE item is hovered (not just any item) — delegated on the
        // rail so it keeps working correctly even after the active item
        // changes.
        $rail.on("mouseenter", ".rr-item-btn", function () {
            var $item = $(this).closest(".rr-item");
            if ($item.hasClass("rr-active")) {
                $indicator.addClass("rr-indicator-hover");
            }
        });
        $rail.on("mouseleave", ".rr-item-btn", function () {
            $indicator.removeClass("rr-indicator-hover");
        });

        // Reposition on window resize too, since item heights/positions
        // can change (e.g. label wrapping at a narrower width).
        $(window).on("resize", function () {
            positionIndicator(false);
        });

        $rail.find(".rr-item-btn").on("click", function (e) {
            var $btn = $(this);
            var $item = $btn.closest(".rr-item");
            var key = $item.data("key");
            var label = $btn.find(".rr-item-label").text().trim();
            var href = $btn.attr("href") || null;
            var opensPanel = $item.data("opens-panel") === true || $item.data("opens-panel") === "true";
            var targetPanelId = $item.data("panel-target");

            if (!href || href === "#") {
                e.preventDefault();
            }

            // Highlight this item as active, clearing any other active
            // item in the rail — same convention as modern-sidebar.
            // Also clear the per-icon/per-label gradient classes from
            // whichever item was previously active, since those are
            // tied to the active state, not to the item itself.
            $rail.find(".rr-item.rr-active").removeClass("rr-active rr-active-gradient rr-icon-gradient rr-label-gradient");

            var useGradient = $rail.data("use-gradient-active") === true;
            var newClasses = "rr-active" + (useGradient ? " rr-active-gradient" : "");

            // Whether THIS item's icon/label should render as a gradient
            // once it becomes active is baked in server-side (since it
            // depends on this item's own or the rail's ActiveIconColor /
            // ActiveLabelColor, including the actual gradient CSS value
            // already sitting on this element as --rr-active-icon-color /
            // --rr-active-label-color). Read those flags here so a
            // gradient set only on <report-rail> (or on this specific
            // <rail-item>) still applies correctly when the item becomes
            // active via a click, not just when it's server-rendered
            // active="true" on first page load.
            var iconGradient = $item.data("icon-gradient") === true || $item.data("icon-gradient") === "true";
            var labelGradient = $item.data("label-gradient") === true || $item.data("label-gradient") === "true";
            if (iconGradient) newClasses += " rr-icon-gradient";
            if (labelGradient) newClasses += " rr-label-gradient";

            $item.addClass(newClasses);

            // Slide the shared indicator bar to the newly active item.
            positionIndicator(true);

            if (opensPanel && targetPanelId) {
                openPanelById(targetPanelId);
            } else {
                // Clicking a rail item that does NOT open its own panel
                // (Config, Member, Society, etc.) still means the user
                // has navigated away from whatever panel was open —
                // e.g. the Report Details panel should close if you
                // click Config next. openPanelById already closes other
                // open panels when IT is the one being opened; this
                // covers the remaining case where no panel is being
                // opened at all, so nothing else would have closed it.
                $(".report-panel.rp-open").each(function () {
                    closePanel($(this), true);
                });
            }

            fire(this, "report:railitemclick", {
                key: key,
                label: label,
                href: href,
                opensPanel: !!opensPanel,
                element: $item[0]
            });
        });
    }

    function initPanel($panel) {
        var panelId = $panel.attr("id");

        // Sections that start open (DefaultOpen="true" server-side) get
        // max-height:none immediately so they render at their natural
        // height with no animation on page load, and are ready to
        // measure correctly the first time they're closed.
        $panel.find("> .rp-body > .rp-section > .rp-section-items.rp-open").css("max-height", "none");

        // Close button
        $panel.find("> .rp-header .rp-close-btn").on("click", function () {
            closePanel($panel, true); // explicit close always works, even while pinned
        });

        // Back button (nested panels only)
        $panel.find("> .rp-header .rp-back-btn").on("click", function () {
            closePanel($panel, true);
        });

        // Pin button — while pinned, this panel ignores auto-close
        // triggers (scrim/outside click, window resize, another rail
        // item opening a different panel). The explicit Close button
        // above still always works regardless of pinned state.
        $panel.find("> .rp-header .rp-pin-btn").on("click", function () {
            var $btn = $(this);
            var isPinned = $panel.hasClass("rp-pinned");
            if (isPinned) {
                $panel.removeClass("rp-pinned");
                $btn.attr("aria-pressed", "false");
            } else {
                $panel.addClass("rp-pinned");
                $btn.attr("aria-pressed", "true");
            }
            fire($panel[0], "report:panelpin", { panelId: panelId, pinned: !isPinned });
        });

        // Scrim tied to this panel (top-level panels only — nested panels
        // sit on top of the same scrim as their parent)
        var $scrim = $panel.data("scrim-el");

        // ---- Collapsible sections ----
        // Measures the section's real content height and animates to that
        // exact pixel value (rather than a fixed large max-height ceiling),
        // so the transition timing always matches the actual content —
        // a 3-item section and a 10-item section both feel equally smooth,
        // and closing eases back down from the true height instead of an
        // oversized one.
        $panel.find("> .rp-body > .rp-section > .rp-section-header").on("click", function () {
            var $header = $(this);
            var $items = $header.next(".rp-section-items");
            var isOpen = $items.hasClass("rp-open");

            if (isOpen) {
                // Set an explicit starting height (from the current
                // rendered height) before collapsing, so the transition
                // has a real value to animate from rather than jumping
                // straight from "auto"/measured to 0.
                $items.css("max-height", $items[0].scrollHeight + "px");
                void $items[0].offsetHeight; // flush layout
                $items.removeClass("rp-open");
                $items.css("max-height", "0px");
                $header.attr("aria-expanded", "false");
            } else {
                $items.addClass("rp-open");
                $items.css("max-height", $items[0].scrollHeight + "px");
                $header.attr("aria-expanded", "true");

                // Once the expand transition finishes, release the fixed
                // pixel height back to "none" so content that changes
                // size later (e.g. a row wrapping after a resize) isn't
                // clipped by a stale measured value.
                $items.one("transitionend", function (e) {
                    if (e.target === $items[0] && $items.hasClass("rp-open")) {
                        $items.css("max-height", "none");
                    }
                });
            }
        });

        // Resolves whether clicking this specific row should close the
        // panel afterward: the row's own data-close-on-select wins if
        // set, otherwise falls back to the panel's own default
        // (data-close-on-select on the panel element itself, written by
        // ReportPanel's CloseOnSelect attribute).
        function resolveCloseOnSelect($row) {
            var rowSetting = $row.attr("data-close-on-select");
            if (rowSetting === "true") return true;
            if (rowSetting === "false") return false;
            return $panel.attr("data-close-on-select") === "true";
        }

        // ---- Leaf item rows: select + fire event ----
        $panel.find(".rp-item-row").on("click", function (e) {
            var $row = $(this);
            var href = $row.attr("href");
            if (!href || href === "#") {
                e.preventDefault();
            }

            // Clear active state across this whole panel only — including
            // any currently-active plain nav-row, since a report-item and
            // a nav-row-without-nested-panel share one "current selection"
            // within the panel, not two independent ones.
            $panel.find(".rp-item-row.rp-active, .rp-nav-row.rp-active").removeClass("rp-active");
            $row.addClass("rp-active");

            fire(this, "report:itemclick", {
                id: $row.data("id"),
                label: $row.data("label"),
                panelId: panelId,
                element: $row[0]
            });

            if (resolveCloseOnSelect($row) && !$panel.hasClass("rp-pinned")) {
                closePanel($panel);
            }
        });

        // ---- Flat nav rows: nested panel OR plain event ----
        $panel.find("> .rp-body > .rp-nav-row").each(function () {
            var $row = $(this);
            var nestedPanelId = $row.data("nested-panel");
            var $nestedPanel = nestedPanelId ? $("#" + nestedPanelId) : $();
            var hasNestedPanel = $nestedPanel.length > 0;

            $row.on("click", function (e) {
                var href = $row.attr("href");
                if (!href || href === "#") {
                    e.preventDefault();
                }

                if (hasNestedPanel) {
                    openPanelAsNested($nestedPanel, $panel);
                } else {
                    // A plain nav-row (no nested panel) behaves as a
                    // selectable row, same as a report-item — it becomes
                    // the panel's current selection, clearing whatever
                    // was active before (report-item OR nav-row). A row
                    // that drills into a sub-panel never gets marked
                    // active — it's a navigation action, not a choice
                    // that persists visually.
                    $panel.find(".rp-item-row.rp-active, .rp-nav-row.rp-active").removeClass("rp-active");
                    $row.addClass("rp-active");
                }

                fire(this, "report:navrowclick", {
                    id: $row.data("id"),
                    label: $row.data("label"),
                    href: href || null,
                    hasNestedPanel: hasNestedPanel,
                    panelId: panelId,
                    element: $row[0]
                });

                // Only a plain nav-row (no nested panel) can close its own
                // panel on click — one that drills into a sub-panel is
                // navigating deeper, not finishing a selection, so
                // close-on-select never applies to it.
                if (!hasNestedPanel && resolveCloseOnSelect($row) && !$panel.hasClass("rp-pinned")) {
                    closePanel($panel);
                }
            });
        });
    }

    // ----- Panel open/close plumbing -----

    function ensureScrim() {
        var $scrim = $(".rp-scrim");
        if ($scrim.length === 0) {
            $scrim = $("<div class='rp-scrim'></div>").appendTo("body");
            $scrim.on("click", function () {
                // close the top-most open panel
                var $open = $(".report-panel.rp-open").last();
                if ($open.length) closePanel($open);
            });
        }
        return $scrim;
    }

    // Finds the rail this panel "belongs to" so the panel can sit right
    // next to it, on whichever side the rail actually is (left or right
    // edge of the viewport) — supports RTL-style layouts where the rail
    // is docked on the right, as well as the usual left-docked rail.
    function positionPanelNextToRail($panel) {
        var $rail = $(".report-rail").first();
        if ($rail.length === 0) return;

        var railRect = $rail[0].getBoundingClientRect();
        var viewportWidth = window.innerWidth;
        var railIsOnRight = railRect.left > viewportWidth / 2;

        if (railIsOnRight) {
            var rightOffset = viewportWidth - railRect.left;
            $panel.css({ left: "auto", right: rightOffset + "px" });
            $panel[0].style.setProperty("--rp-slide-offset", "12px"); // slides in from the right
        } else {
            $panel.css({ left: railRect.right + "px", right: "auto" });
            $panel[0].style.setProperty("--rp-slide-offset", "-12px"); // slides in from the left
        }
    }

    function openPanelById(panelId) {
        var $panel = $("#" + panelId);
        if ($panel.length === 0) return;

        // Opening a panel from the rail always starts a fresh "top-level"
        // view — close any other top-level panel (and anything nested
        // inside it) first, so Society/Agent/Report panels never stack.
        // This is a deliberate navigation action, so it force-closes even
        // a pinned panel — pinning only protects against ambient/passive
        // close triggers (window resize, clicking outside), not against
        // the user actively choosing to go somewhere else.
        $(".report-panel.rp-open").not($panel).each(function () {
            closePanel($(this), true);
        });

        // If the panel we're about to open was itself left pinned open
        // from a previous visit, unpin it now so it starts this fresh
        // visit in its normal (non-pinned) state.
        $panel.removeClass("rp-pinned");
        $panel.find("> .rp-header .rp-pin-btn").attr("aria-pressed", "false");

        positionPanelNextToRail($panel);
        $panel.removeClass("rp-nested"); // in case it was previously opened as a nested drill-in
        openPanel($panel);
    }

    function openPanel($panel) {
        var $scrim = ensureScrim();
        $scrim.addClass("rp-scrim-visible");
        // Force layout flush so the transform transition actually plays
        // (adding rp-open in the same tick as a style change can get
        // batched by the browser and skip the animation).
        void $panel[0].offsetWidth;
        $panel.addClass("rp-open");
        fire($panel[0], "report:panelopen", { panelId: $panel.attr("id") });
    }

    // Pure positioning math for a nested (drill-in) panel against its
    // parent's current on-screen position — shared by openPanelAsNested
    // (initial open) and the resize handler (repositioning a pinned
    // nested panel after the layout shifts).
    function repositionNestedPanel($nestedPanel, $parentPanel) {
        var rect = $parentPanel[0].getBoundingClientRect();
        var viewportWidth = window.innerWidth;
        var parentIsOnRight = rect.left > viewportWidth / 2;

        if (parentIsOnRight) {
            var rightOffset = viewportWidth - rect.left - rect.width;
            $nestedPanel.css({ left: "auto", right: rightOffset + "px", width: rect.width + "px" });
        } else {
            $nestedPanel.css({ left: rect.left + "px", right: "auto", width: rect.width + "px" });
        }
    }

    function openPanelAsNested($nestedPanel, $parentPanel) {
        // Position the nested panel directly on top of its parent so it
        // reads as "drilling in" rather than a second independent panel.
        repositionNestedPanel($nestedPanel, $parentPanel);

        var rect = $parentPanel[0].getBoundingClientRect();
        var viewportWidth = window.innerWidth;
        var parentIsOnRight = rect.left > viewportWidth / 2;
        $nestedPanel[0].style.setProperty("--rp-slide-offset", parentIsOnRight ? "12px" : "-12px");

        $nestedPanel.addClass("rp-nested");
        openPanel($nestedPanel);
    }

    function closePanel($panel, force) {
        // Pinned panels ignore non-forced close requests (outside click,
        // resize, another rail item opening a different panel). The
        // explicit Close button always passes force=true, so it works
        // regardless of pin state.
        if ($panel.hasClass("rp-pinned") && !force) {
            return;
        }

        $panel.removeClass("rp-open");
        fire($panel[0], "report:panelclose", { panelId: $panel.attr("id") });

        // Hide the scrim only if no panels remain open
        if ($(".report-panel.rp-open").length === 0) {
            $(".rp-scrim").removeClass("rp-scrim-visible");
        }
    }

    // ----- Programmatic control -----
    // Usage: openReportPanel("ReportDetailsPanel")
    window.openReportPanel = function (panelId) {
        openPanelById(panelId);
    };

    // Usage: closeReportPanel("ReportDetailsPanel")
    window.closeReportPanel = function (panelId) {
        var $panel = $("#" + panelId);
        if ($panel.length) closePanel($panel);
    };

    // Usage: setReportActiveItem("ReportDetailsPanel", "General ledger HFormat")
    window.setReportActiveItem = function (panelId, labelText) {
        var $panel = $("#" + panelId);
        $panel.find(".rp-item-row.rp-active").removeClass("rp-active");
        $panel.find(".rp-item-row").filter(function () {
            return $(this).data("label") === labelText;
        }).each(function () {
            $(this).addClass("rp-active");
            var $section = $(this).closest(".rp-section-items");
            $section.addClass("rp-open");
            $section.prev(".rp-section-header").attr("aria-expanded", "true");
        });
    };

});

// ----- getReportRowElement / onReportRowClick -----
// Deliberately defined OUTSIDE the $(document).ready(...) block above, so
// they're available on window the instant this <script> tag runs — no
// need to wrap your own calls in $(document).ready(...) or
// DOMContentLoaded first. This works safely because these two functions
// only ever look up an element by id when actually called (they don't
// touch the DOM at definition time), and by the time your code calls
// them with a real id, that element already exists in the page's
// server-rendered HTML (Razor renders <report-item>/<nav-row> directly,
// they're not injected later by JS).

// Usage: const el = getReportRowElement("account-list")
// Returns the raw DOM element for a <report-item> or <nav-row> by the id
// you gave it in Razor (id="account-list"), or null if not found.
// Equivalent to document.getElementById(id), provided as a named helper
// for readability and so it's discoverable alongside the other
// report-sidebar APIs. Works for both leaf report rows and flat nav-row
// entries — they share the same id/data-id convention.
window.getReportRowElement = function (id) {
    return document.getElementById(id);
};

// Usage:
//   onReportRowClick("account-list", function (el) {
//       console.log("clicked:", el.dataset.label);
//   });
// Attaches your own click handler directly to a <report-item> or
// <nav-row> by id, in addition to (not instead of) this component's own
// click behavior (selection, navigation, opening nested panels, and the
// report:itemclick / report:navrowclick events already fired for every
// row). Returns true if the element was found and the handler attached,
// false if no element with that id exists on the page at all (a genuine
// typo or wrong id — not a timing issue, since this function itself has
// no timing requirement).
window.onReportRowClick = function (id, handler) {
    var el = document.getElementById(id);
    if (!el) return false;
    el.addEventListener("click", function () {
        handler(el);
    });
    return true;
};