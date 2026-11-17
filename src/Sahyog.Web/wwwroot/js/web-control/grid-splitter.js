/* ==========================================================================
   TGSPC Grid Splitter
   Makes .TGSPC-Grid-panel-middle a draggable divider between
   .TGSPC-Grid-panel-upper and .TGSPC-Grid-panel-lower.

   Works with any number of rows ABOVE the splitter (e.g. the 45px box-Top):
   it reads the grid's current rows, and only changes the three rows
   [upper] [handle] [lower]. Every other row keeps its size.

   - Keeps upper + lower total constant while dragging (no page jump)
   - Rescales proportionally when the window is resized
   - Clears itself when crossing the mobile breakpoint, so the
     stylesheet's media-query layout takes over again
   ========================================================================== */

(function () {
    'use strict';

    var MOBILE_QUERY = '(max-width: 950px)'; // keep in sync with mobile-drawer.css
    var MIN_UPPER = 10;   // px floor for the upper grid
    var MIN_LOWER = 10;   // px floor for the lower grid

    /* Row index of an element inside the grid (0-based), from its rendered position */
    function rowIndexOf(grid, el) {
        var rows = trackSizes(grid);
        var gridTop = grid.getBoundingClientRect().top + parseFloat(getComputedStyle(grid).paddingTop || 0);
        var gap = parseFloat(getComputedStyle(grid).rowGap) || 0;
        var elTop = el.getBoundingClientRect().top;

        var y = gridTop;
        for (var i = 0; i < rows.length; i++) {
            if (elTop < y + rows[i] - 0.5) return i;
            y += rows[i] + gap;
        }
        return rows.length - 1;
    }

    /* Current row sizes in px, as the browser resolved them */
    function trackSizes(grid) {
        return getComputedStyle(grid).gridTemplateRows
            .split(' ')
            .map(function (v) { return parseFloat(v) || 0; });
    }

    function initTGSPCSplitters(root) {
        var scope = root || document;
        var splitters = scope.querySelectorAll('.TGSPC-Grid-panel-middle');

        splitters.forEach(function (handle) {
            if (handle.dataset.tgspcBound === '1') return;
            handle.dataset.tgspcBound = '1';

            var grid = handle.closest('.TGSPC-grid-panel');
            if (!grid) return;

            var mq = window.matchMedia(MOBILE_QUERY);

            var dragging = false;
            var startY = 0;
            var startRows = null;   // array of px sizes at drag start
            var hIdx = -1;          // index of the handle row
            var ratio = null;       // upper / (upper + lower), kept for resize

            handle.style.cursor = 'row-resize';
            handle.style.userSelect = 'none';
            handle.style.touchAction = 'none';

            function getY(e) {
                if (e.touches && e.touches.length) return e.touches[0].clientY;
                if (e.changedTouches && e.changedTouches.length) return e.changedTouches[0].clientY;
                return e.clientY;
            }

            function applyRows(rows) {
                grid.style.gridTemplateRows = rows.map(function (v) { return v + 'px'; }).join(' ');
            }

            function onPointerDown(e) {
                startRows = trackSizes(grid);
                hIdx = rowIndexOf(grid, handle);

                // Need a row above and below the handle
                if (hIdx < 1 || hIdx > startRows.length - 2) return;

                dragging = true;
                startY = getY(e);

                document.body.style.cursor = 'row-resize';
                document.body.style.userSelect = 'none';

                window.addEventListener('mousemove', onPointerMove);
                window.addEventListener('mouseup', onPointerUp);
                window.addEventListener('touchmove', onPointerMove, { passive: false });
                window.addEventListener('touchend', onPointerUp);

                e.preventDefault();
            }

            function onPointerMove(e) {
                if (!dragging) return;
                var y = getY(e);
                if (y === undefined) return;

                var upper0 = startRows[hIdx - 1];
                var lower0 = startRows[hIdx + 1];
                var total = upper0 + lower0;

                var minLower = Math.min(MIN_LOWER, total / 2);
                var minUpper = Math.min(MIN_UPPER, total / 2);

                var newUpper = upper0 + (y - startY);
                if (newUpper < minUpper) newUpper = minUpper;
                if (newUpper > total - minLower) newUpper = total - minLower;

                var rows = startRows.slice();
                rows[hIdx - 1] = newUpper;
                rows[hIdx + 1] = total - newUpper;
                applyRows(rows);

                ratio = newUpper / total;
                e.preventDefault();
            }

            function onPointerUp() {
                dragging = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';

                window.removeEventListener('mousemove', onPointerMove);
                window.removeEventListener('mouseup', onPointerUp);
                window.removeEventListener('touchmove', onPointerMove);
                window.removeEventListener('touchend', onPointerUp);
            }

            /* Window resized: go back to the stylesheet sizes, then re-apply the drag ratio */
            var resizeTimer = null;
            function onResize() {
                if (ratio === null) return;
                clearTimeout(resizeTimer);
                resizeTimer = setTimeout(function () {
                    grid.style.gridTemplateRows = '';
                    var rows = trackSizes(grid);
                    var idx = rowIndexOf(grid, handle);
                    if (idx < 1 || idx > rows.length - 2) return;
                    var total = rows[idx - 1] + rows[idx + 1];
                    rows[idx - 1] = Math.round(total * ratio);
                    rows[idx + 1] = total - rows[idx - 1];
                    applyRows(rows);
                }, 100);
            }

            /* Crossing the mobile breakpoint: drop the drag so the media query applies */
            function onBreakpoint() {
                ratio = null;
                grid.style.gridTemplateRows = '';
            }

            // Double-click the divider to reset to the default split
            handle.addEventListener('dblclick', onBreakpoint);

            handle.addEventListener('mousedown', onPointerDown);
            handle.addEventListener('touchstart', onPointerDown, { passive: false });
            window.addEventListener('resize', onResize);
            if (mq.addEventListener) mq.addEventListener('change', onBreakpoint);
            else mq.addListener(onBreakpoint);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { initTGSPCSplitters(document); });
    } else {
        initTGSPCSplitters(document);
    }

    window.initTGSPCSplitters = initTGSPCSplitters;
})();