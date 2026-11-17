// ===== Modern Sidebar =====
// Auto-initializes every .modern-sidebar on the page.

$(document).ready(function () {

    $(".modern-sidebar").each(function () {
        initSidebar($(this));
    });

    function initSidebar($sidebar) {
        // Any submenu rendered already-open (DefaultOpen="true") needs its
        // max-height set correctly on load too — the server-rendered HTML
        // only has the ms-open class, not the measured pixel height.
        $sidebar.find(".ms-submenu.ms-open").each(function () {
            var $submenu = $(this);
            $submenu.css("max-height", $submenu[0].scrollHeight + "px");
        });

        // Collapse/expand the whole sidebar to icon-only mode
        $sidebar.find(".ms-toggle-btn").on("click", function () {
            $sidebar.toggleClass("ms-collapsed");
        });

        // Fires on EVERY item click (leaf links and parent toggles alike),
        // so you can hook custom behavior — analytics, AJAX content
        // loading instead of a full page navigation, etc.
        // Usage: $("#MainNav").on("sidebar:itemclick", function (e, item) {
        //     console.log(item.label, item.href, item.isParent);
        //     e.preventDefault();   // call this to block the link's actual navigation
        // });
        $sidebar.find(".ms-item-link").on("click", function (e) {
            var $link = $(this);
            var $menuItem = $link.closest(".ms-menu-item");
            var label = $link.find(".ms-item-label").text().trim();
            var href = $link.attr("href") || null;
            var isParent = $menuItem.hasClass("ms-has-children");

            // No real navigation target (empty, "#", or missing href) —
            // block the browser's default behavior automatically, since
            // href="" specifically causes a full page reload otherwise.
            if (!isParent && (!href || href === "#" || href.trim() === "")) {
                e.preventDefault();
            }

            // Leaf items (no submenu) become the selected/active item on
            // click — clears whatever was previously active anywhere in
            // the sidebar first, so only one item is ever highlighted.
            if (!isParent) {
                $sidebar.find(".ms-menu-item.ms-active").removeClass("ms-active");
                $menuItem.addClass("ms-active");
            }

            var customEvent = $.Event("sidebar:itemclick");
            $sidebar.trigger(customEvent, [{
                label: label,
                href: href,
                isParent: isParent,
                element: $menuItem[0]
            }]);

            if (customEvent.isDefaultPrevented()) {
                e.preventDefault();   // also block the native link/toggle behavior
            }
        });

        // Submenu toggle — clicking a parent item closes any other open
        // sibling at the same level (accordion), and toggles this one.
        // Clicking an already-open item closes it; clicking it again reopens it.
        $sidebar.find(".ms-item-link[data-toggle='true']").on("click", function (e) {
            e.preventDefault();

            var $link = $(this);
            var $menuItem = $link.closest(".ms-menu-item");
            var $submenu = $menuItem.children(".ms-submenu");
            var isCurrentlyOpen = $menuItem.hasClass("ms-open");

            // Close sibling items at the SAME level before opening this one
            $menuItem.siblings(".ms-menu-item.ms-has-children").each(function () {
                var $sibling = $(this);
                $sibling.removeClass("ms-open");
                $sibling.children(".ms-submenu").removeClass("ms-open").css("max-height", "0px");
            });

            if (isCurrentlyOpen) {
                $menuItem.removeClass("ms-open");
                $submenu.removeClass("ms-open").css("max-height", "0px");
            } else {
                $menuItem.addClass("ms-open");
                $submenu.addClass("ms-open");
                // Measure the submenu's real content height so the
                // transition duration matches how tall it actually is,
                // instead of animating toward a fixed guessed value.
                var actualHeight = $submenu[0].scrollHeight;
                $submenu.css("max-height", actualHeight + "px");
            }
        });
    }

    // ----- Programmatic control -----
    // Usage: toggleModernSidebar("#MainNav")
    window.toggleModernSidebar = function (sidebarSelector) {
        $(sidebarSelector).toggleClass("ms-collapsed");
    };

    // Usage: setModernSidebarCollapsed("#MainNav", true)
    window.setModernSidebarCollapsed = function (sidebarSelector, collapsed) {
        var $sidebar = $(sidebarSelector);
        if (collapsed) {
            $sidebar.addClass("ms-collapsed");
        } else {
            $sidebar.removeClass("ms-collapsed");
        }
    };

    // Usage: setModernSidebarActiveItem("#MainNav", "Badges") — marks the
    // menu item with this exact label text as active, clearing any other
    // active item, and opens its parent submenu(s) if nested.
    window.setModernSidebarActiveItem = function (sidebarSelector, labelText) {
        var $sidebar = $(sidebarSelector);
        $sidebar.find(".ms-menu-item.ms-active").removeClass("ms-active");

        $sidebar.find(".ms-item-label").filter(function () {
            return $(this).text().trim() === labelText;
        }).each(function () {
            var $menuItem = $(this).closest(".ms-menu-item");
            $menuItem.addClass("ms-active");

            // open every ancestor submenu so the active item is visible
            $menuItem.parents(".ms-submenu").each(function () {
                var $ancestorSubmenu = $(this);
                $ancestorSubmenu.addClass("ms-open");
                $ancestorSubmenu.css("max-height", $ancestorSubmenu[0].scrollHeight + "px");
            });
            $menuItem.parents(".ms-menu-item.ms-has-children").addClass("ms-open");
        });
    };

});