// ===== Modern Input With Search — behavior =====
// Relies on modern-input.js already being loaded: this control reuses the
// same .mi-input-wrap structure, so mandatory-icon validation and
// type-based character filtering already apply automatically.
//
// Icons/buttons are <span role="button" tabindex="0">, not <button>, so
// disabled state is tracked via aria-disabled instead of a native
// "disabled" property.
//
// ----- Search events -----
//   $("#Code").on("mi:search",  function (e, value) { ... });  // inside icon / Enter in input
//   $("#Code").on("mi:search1", function (e, value) { ... });  // outside button 1
//   $("#Code").on("mi:search2", function (e, value) { ... });  // outside button 2
//
// ----- Outside button -> shared modal -----
// An outside search button rendered with OutsideSearchPartialView{n}
// carries data-partial-view; clicking it opens that partial in the ONE
// shared modal in _Layout.cshtml (#PopupWindow, #AddEditOverlay, #Title,
// #modalContainerHolder, #btnCloseModal) via FetchModernInputModalAndShow
// instead of firing mi:search{n}.
// If OutsideSearchTargetController{n} + OutsideSearchTargetAction{n} are also
// set, GET /{controller}/{action} is called once the partial's modern-table
// is ready and the returned JSON rows are bound to it automatically
// (keys matched to column fields case-insensitively).
// OutsideSearchLoadDelay{n} (ms, default 300) delays that call, like the
// loadDelay of InitActionHeaderTable. The table shows its loading pill
// (ShowTableLoader/HideTableLoader from tableLoader.js, if loaded) and the
// input shows a spinner + sweep bar until the rows are bound.
//
// ----- Row pick from the modal's table -----
// With OutsideSearchValueField{n} set (e.g. "ACGroupCode"), selecting a row
// in the modal's modern-table:
//   - puts that column's value into the search input
//   - keeps the whole row:  $("#Id").data("selectedRow")
//   - OutsideSearchIdField{n} -> $("#Id").data("selectedId") and the
//     attribute data-selected-id; OutsideSearchIdTarget{n} also fills that
//     hidden input (so the key posts with the form)
//   - fires  $("#Id").on("mi:rowselected", function (e, row) { ... })
//   - closes the modal unless OutsideSearchCloseOnSelect{n} is false
// Typing in the input afterwards drops the stored row/id (they would be stale).
//
// ----- Image box + browse button -----
//   $("#Code").on("mi:imagechange", function (e, file) { ... });
//   $("#Code").on("mi:imageclear",  function (e) { ... });
//   getModernInputImageFile("#Code")      -> File or null
//   clearModernInputImage("#Code")
// The text input receives the file NAME only — browsers never expose a
// selected file's real OS path to page JS.
//
// ----- File upload button (any file type, optional filter) -----
//   $("#Doc").on("mi:fileupload",   function (e, files) { ... });     // accepted File[]
//   $("#Doc").on("mi:filerejected", function (e, rejected) { ... });  // [{ file, reason: "type" | "size" }]
//   $("#Doc").on("mi:fileclear",    function (e) { ... });
//   getModernInputUploadFiles("#Doc")     -> File[] (empty if none)
//   getModernInputUploadFile("#Doc")      -> first File or null
//   clearModernInputUpload("#Doc")
//   disableFileUploadButton("#Doc") / enableFileUploadButton("#Doc")
// The picker's accept filter is only a hint (the user can switch the
// dialog to "All files"), so every chosen file is re-checked here
// against data-accept and data-max-size-mb. Validate again on the server.

$(document).ready(function () {

    // =========================================================
    // In-memory File storage, keyed by input id
    // (File objects can't live in a text input's value.)
    // =========================================================
    var modernInputImageFiles = {};
    var modernInputUploadFiles = {};

    window.getModernInputImageFile = function (inputSelector) {
        var $input = $(inputSelector);
        if ($input.length === 0) return null;
        return modernInputImageFiles[$input.attr("id")] || null;
    };

    window.getModernInputUploadFiles = function (inputSelector) {
        var $input = $(inputSelector);
        if ($input.length === 0) return [];
        return modernInputUploadFiles[$input.attr("id")] || [];
    };

    window.getModernInputUploadFile = function (inputSelector) {
        var files = window.getModernInputUploadFiles(inputSelector);
        return files.length ? files[0] : null;
    };

    // =========================================================
    // Shared helpers
    // =========================================================

    // Sets the input's value AND fires the events real typing would, so
    // modern-input.js's validation (the red mandatory/error icon) sees
    // the change. A bare .val(...) dispatches no events.
    function setInputValueAndNotify($input, value) {
        $input.val(value);
        $input.trigger("input").trigger("keyup").trigger("change");
    }

    // Setter used by GridBinder.populateFormFromSelection (see
    // gridbinder/site.js) when restoring a modern-input-with-search field
    // from a grid row's saved data, e.g. re-opening a record for EDIT.
    //
    // Only sets the visible TEXT value. A File object can never be
    // reconstructed from a stored string — File instances only ever come
    // from the user picking a file in the current browser session — so
    // this also clears any stale preview/File left over from an earlier
    // pick on this same page, rather than leaving it out of sync with the
    // newly-set text. After this call:
    //   - getModernInputImageFile(selector)  -> null
    //   - getModernInputUploadFiles(selector) -> []
    // even though the input's text shows the previously-saved name.
    //
    // If a grid row carries a real image URL for this field and you want
    // the preview box to actually show it on load, do that separately
    // after this call, e.g.:
    //   $(".mis-image-box[data-target='" + id + "']")
    //       .find(".mis-image-box-preview").attr("src", imageUrl).show();
    //   $(".mis-image-box[data-target='" + id + "']")
    //       .find(".mis-image-box-placeholder").hide();
    //   $(".mis-image-box[data-target='" + id + "']")
    //       .find(".mis-image-box-clear").show();
    window.setModernInputWithSearchDisplayValue = function (inputSelector, value) {
        var $input = $(inputSelector);
        if ($input.length === 0) return;

        setInputValueAndNotify($input, value != null ? value : "");

        if (window.clearModernInputImage) window.clearModernInputImage(inputSelector);

        var id = $input.attr("id");
        delete modernInputUploadFiles[id];
    };

    function isInputDisabled(targetId) {
        return $("#" + targetId).prop("disabled") === true;
    }

    // =========================================================
    // Search
    // =========================================================
    function triggerSearch($icon) {
        if ($icon.length === 0) return;
        if ($icon.attr("aria-disabled") === "true") return;

        var targetId = $icon.attr("data-target");
        var $input = $("#" + targetId);
        if ($input.length === 0) return;
        if ($input.prop("disabled")) return;   // readonly does not block search, only disabled does

        // Inside icon has no data-search-event, so it falls back to "mi:search".
        var eventName = $icon.attr("data-search-event") || "mi:search";
        $input.trigger(eventName, [$input.val()]);
    }

    // =========================================================
    // Outside button -> shared modal
    // =========================================================

    // Modal defaults, from its markup in _Layout.cshtml. Every open resets
    // to these unless the clicked button overrides them, so nothing leaks
    // from one button's open to the next. Icon uses Font Awesome 4.7
    // syntax ("fa fa-<name>").
    var MODERN_INPUT_MODAL_DEFAULT_HEIGHT = '70%';
    var MODERN_INPUT_MODAL_DEFAULT_WIDTH = '60%';
    var MODERN_INPUT_MODAL_DEFAULT_ICON_CLASS = 'fa fa-list';
    // The Save button is always found via its STABLE data-role attribute,
    // never by id, since the id is what gets changed on each open.
    var MODERN_INPUT_MODAL_DEFAULT_SAVE_BTN_ID = 'btnSave';

    // ---- Auto-bind the modal's modern-table from controller/action ----
    // Reads the table's column fields (from its .mt-columns-data script) and
    // its row-id field, then re-keys every returned row case-insensitively so
    // JSON like { acGroupCode: ".." } (MVC's default camelCase) still matches
    // a column declared as field="ACGroupCode".
    function getModernTableFieldNames($wrapper) {
        var names = [];
        try {
            var raw = $wrapper.find('script.mt-columns-data').first().text();
            var cols = raw ? JSON.parse(raw) : [];
            for (var i = 0; i < cols.length; i++) {
                var f = cols[i].field || cols[i].Field;
                if (f) names.push(String(f));
            }
        } catch (e) { /* fall through with whatever was collected */ }
        var idField = $wrapper.attr('data-row-id-field');
        if (idField && names.indexOf(idField) === -1) names.push(idField);
        return names;
    }

    function normalizeRowsForTable(rows, fieldNames) {
        if (!fieldNames.length) return rows;
        var lookup = {};
        for (var i = 0; i < fieldNames.length; i++) lookup[fieldNames[i].toLowerCase()] = fieldNames[i];

        return $.map(rows, function (row) {
            if (!row || typeof row !== 'object') return [row];
            var out = {};
            for (var k in row) {
                if (!Object.prototype.hasOwnProperty.call(row, k)) continue;
                var target = lookup[k.toLowerCase()];
                out[target || k] = row[k];
            }
            return [out];
        });
    }

    // ---- Columns from the rows themselves (data-dynamic-columns="true", no resp.columns) ----
    // One column per property of the first row. The row-id field and any property
    // ending in "ID"/"Id" are hidden; headers come from the names:
    //   "AccGrp_Code" -> "Acc Grp Code", "ledgerName" -> "Ledger Name".
    function headerFromField(field) {
        var s = String(field)
            .replace(/_/g, ' ')
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
            .replace(/\s+/g, ' ')
            .trim();
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    function buildColumnsFromRows(rows, rowIdField) {
        var first = null;
        for (var i = 0; i < rows.length; i++) {
            if (rows[i] && typeof rows[i] === 'object') { first = rows[i]; break; }
        }
        if (!first) return null;   // no rows: keep whatever columns the table has

        var idLower = String(rowIdField || 'ID').toLowerCase();
        var cols = [];
        for (var k in first) {
            if (!Object.prototype.hasOwnProperty.call(first, k)) continue;
            var v = first[k];
            if (v !== null && typeof v === 'object') continue;   // nested objects/arrays are not columns
            var hidden = k.toLowerCase() === idLower || /(ID|Id)$/.test(k);
            cols.push({ field: k, header: headerFromField(k), visible: !hidden, filterable: !hidden });
        }
        return cols;
    }

    function showModalBindError(text) {
        if (typeof openMessageBox === 'function') {
            openMessageBox({ title: 'Error', text: text, type: 'error', icon: 'error' });
        } else {
            alert(text);
        }
    }

    // ---- Loading indicator on the search input ----
    // Shows a spinner in place of the clicked button's glyph and a sweeping
    // bar along the input's bottom edge, from the click until the modal's
    // table data has arrived (or failed). Reference-counted per input so
    // overlapping calls cannot switch it off early.
    function setModernInputLoading(sourceInputId, $btn, on) {
        if (!sourceInputId) return;
        var $input = $('#' + sourceInputId);
        var $wrap = $input.closest('.mi-input-wrap');
        var count = ($wrap.data('mis-loading-count') || 0) + (on ? 1 : -1);
        if (count < 0) count = 0;
        $wrap.data('mis-loading-count', count);

        if (on) {
            $wrap.addClass('mis-loading');
            if (!$wrap.children('.mis-load-bar').length) $wrap.append('<span class="mis-load-bar" aria-hidden="true"></span>');
            if ($btn && $btn.length && !$btn.children('.mis-spinner').length) {
                $btn.addClass('mis-btn-loading').attr('aria-busy', 'true').append('<span class="mis-spinner" aria-hidden="true"></span>');
            }
        } else if (count === 0) {
            $wrap.removeClass('mis-loading').children('.mis-load-bar').remove();
            $wrap.parent().find('.mis-outside-search-btn.mis-btn-loading')
                .removeClass('mis-btn-loading').removeAttr('aria-busy').children('.mis-spinner').remove();
            if ($btn && $btn.length) {
                $btn.removeClass('mis-btn-loading').removeAttr('aria-busy').children('.mis-spinner').remove();
            }
        }
    }

    var MODERN_INPUT_DEFAULT_LOAD_DELAY = 300;   // ms, same default as LoadTableOnStart

    // Same rule as LoadTableOnStart: missing / invalid / negative -> 300 ms.
    function parseLoadDelay(delay) {
        var wait = Number(delay);
        if (delay === null || delay === undefined || delay === '' || isNaN(wait) || wait < 0) {
            return MODERN_INPUT_DEFAULT_LOAD_DELAY;
        }
        return wait;
    }

    // Waits `delay` ms, then waits (up to ~5 s) for the modal's modern-table
    // to have its mt-api, then GETs /{controller}/{action} and binds the
    // rows. The table's own loading pill (ShowTableLoader / HideTableLoader
    // from tableLoader.js) and the input's loading state run meanwhile.
    //
    // Response: { success, data } like the action header's SelectData, a bare
    // array, or an object holding the array in data/items/rows/result.
    function bindModalTableFromController(controller, action, $holder, delay, sourceInputId, $btn) {
        var hasTarget = !!(controller && action);
        var $wrapper = $holder.find('.modern-table-wrapper').first();

        // Nothing to load: no controller/action, or the partial has no table.
        if (!hasTarget || $wrapper.length === 0) {
            setModernInputLoading(sourceInputId, $btn, false);
            return;
        }

        var tableId = $wrapper.attr('id');
        var url = '/' + String(controller).replace(/^\/+|\/+$/g, '') +
            '/' + String(action).replace(/^\/+|\/+$/g, '');

        // The input is already in its loading state (set when the button
        // was clicked); show the table's pill too, right away.
        var loaderShown = false;
        function showTableLoader() {
            if (tableId && typeof ShowTableLoader === 'function') {
                try { ShowTableLoader(tableId, 'Loading...'); loaderShown = true; } catch (e) { }
            }
        }
        function finish() {
            if (loaderShown && typeof HideTableLoader === 'function') {
                try { HideTableLoader(tableId); } catch (e) { }
            }
            setModernInputLoading(sourceInputId, $btn, false);
        }
        showTableLoader();

        var tries = 0;
        function tryLoad() {
            // Modal closed (or replaced) while waiting: stop quietly.
            if (!$.contains(document.documentElement, $wrapper[0])) { finish(); return; }

            var api = $wrapper.data('mt-api');
            if (!api) {
                if (++tries < 50) { setTimeout(tryLoad, 100); return; }
                console.error('modern-input-with-search: modern-table in the modal is not initialized.');
                finish();
                return;
            }

            $.ajax({
                url: url,
                type: 'GET',
                dataType: 'json',
                cache: false,
                success: function (resp) {
                    if (resp && resp.success === false) {
                        showModalBindError(resp.message || 'Could not load data.');
                        return;
                    }
                    var rows = resp;
                    if (!$.isArray(rows) && resp && typeof resp === 'object') {
                        var keys = ['data', 'Data', 'items', 'Items', 'rows', 'Rows', 'result', 'Result'];
                        rows = [];
                        for (var i = 0; i < keys.length; i++) {
                            if ($.isArray(resp[keys[i]])) { rows = resp[keys[i]]; break; }
                        }
                    }
                    if (!$.isArray(rows)) rows = [];

                    // One shared list window: columns come with the data.
                    //   1) resp.columns from the action  -> used as given (headers set per action)
                    //   2) table marked data-dynamic-columns="true" and no resp.columns
                    //      -> built from the first row's property names
                    // A table without either keeps its own <column> tags, as before.
                    var newColumns = null;
                    if (resp && !$.isArray(resp)) {
                        newColumns = $.isArray(resp.columns) ? resp.columns : ($.isArray(resp.Columns) ? resp.Columns : null);
                    }
                    if (!newColumns && $wrapper.attr('data-dynamic-columns') === 'true') {
                        newColumns = buildColumnsFromRows(rows, $wrapper.attr('data-row-id-field'));
                    }
                    if (newColumns && typeof api.setColumns === 'function') {
                        api.setColumns(newColumns);
                    } else if (newColumns) {
                        console.error('modern-input-with-search: modern-table.js has no setColumns(); update modern-table.js.');
                    }

                    api.clearData();
                    api.setData(normalizeRowsForTable(rows, getModernTableFieldNames($wrapper)));
                    $wrapper.trigger('mi:tablebound', [rows]);
                },
                error: function (xhr) {
                    var msg = (xhr && xhr.responseText && xhr.responseText.length < 300 && xhr.responseText.indexOf('<') === -1)
                        ? xhr.responseText
                        : 'Failed to load data from ' + url + ' (HTTP ' + (xhr ? xhr.status : '?') + ').';
                    showModalBindError(msg);
                },
                complete: finish
            });
        }

        setTimeout(tryLoad, parseLoadDelay(delay));
    }

    // ---- Row pick: modal table selection -> search input ----
    function getRowValueCI(row, field) {
        if (!row || !field) return undefined;
        if (Object.prototype.hasOwnProperty.call(row, field)) return row[field];
        var lower = String(field).toLowerCase();
        for (var k in row) {
            if (Object.prototype.hasOwnProperty.call(row, k) && k.toLowerCase() === lower) return row[k];
        }
        return undefined;
    }

    function applyPickedRow(sourceInputId, row, sel) {
        var $source = $('#' + sourceInputId);
        if ($source.length === 0 || !row) return;

        var value = getRowValueCI(row, sel.valueField);
        $source.data('mis-setting', true);
        window.setModernInputWithSearchDisplayValue($source, value != null ? value : '');
        $source.data('mis-setting', false);

        $source.data('selectedRow', row);

        $source.removeData('selectedId').removeAttr('data-selected-id').removeData('mis-id-target');
        if (sel.idField) {
            var id = getRowValueCI(row, sel.idField);
            if (id !== undefined && id !== null) {
                $source.data('selectedId', id).attr('data-selected-id', id);
            }
            if (sel.idTarget) {
                $source.data('mis-id-target', sel.idTarget);
                $('#' + sel.idTarget).val(id != null ? id : '').trigger('change');
            }
        }

        $source.trigger('mi:rowselected', [row]);
        if (sel.closeOnSelect) window.CloseAddEditModalNow();
    }

    // Listens for table:select on the modal's table. Armed only once the
    // controller data is bound (mi:tablebound), so a selection made by the
    // binding itself can never pick a row; with no controller/action
    // (static table) it is armed straight away.
    function wireModalRowPick($holder, sourceInputId, sel, willBind) {
        if (!sel || !sel.valueField || !sourceInputId) return;
        var $wrapper = $holder.find('.modern-table-wrapper').first();
        if ($wrapper.length === 0) return;

        var armed = !willBind;
        $wrapper.off('mi:tablebound.mispick').on('mi:tablebound.mispick', function () { armed = true; });
        $wrapper.off('table:select.mispick').on('table:select.mispick', function (e, row) {
            if (!armed) return;
            var r = $.isArray(row) ? row[0] : row;
            if (!r) return;
            applyPickedRow(sourceInputId, r, sel);
        });
    }

    // A manual edit makes the stored row/id stale, so drop them.
    $(document).on('input', '.mis-row .mi-input', function () {
        var $in = $(this);
        if ($in.data('mis-setting')) return;
        if ($in.data('selectedRow') === undefined && $in.data('selectedId') === undefined) return;
        var target = $in.data('mis-id-target');
        $in.removeData('selectedRow').removeData('selectedId').removeAttr('data-selected-id').removeData('mis-id-target');
        if (target) $('#' + target).val('').trigger('change');
    });

    // FetchModernInputModalAndShow(partialViewPath, title, controller, action, height, width, iconClass, saveBtnId, sourceInputId, loadDelay, $triggerBtn, selectOpts)
    // Loads partialViewPath into #modalContainerHolder, then shows and
    // configures the shared modal. controller/action (optional) are
    // stashed on #PopupWindow's data for the modal's own Save logic:
    //   $('#PopupWindow').data('controller'), $('#PopupWindow').data('action-name')
    //
    // After the partial is injected, its modern-* widgets (modern-table,
    // dropdowns, ...) are initialized via window.initModernControls, then
    // "mi:modalloaded" is fired on the input whose button opened the
    // modal (sourceInputId). That is the moment to bind data:
    //   $("#txtAgentCode").on("mi:modalloaded", function (e, $holder) { ... });
    // The source input id is also kept on $('#PopupWindow').data('source-input')
    // so a Save/row-select handler knows which input to fill.
    //
    // AUTO-BIND: when controller AND action are given, and the partial holds
    // a modern-table, GET /{controller}/{action} is called after init and the
    // returned rows are bound with the table's setData(). "mi:tablebound"
    // fires on the table wrapper afterwards.
    window.FetchModernInputModalAndShow = function (partialViewPath, title, controller, action, height, width, iconClass, saveBtnId, sourceInputId, loadDelay, $triggerBtn, selectOpts) {
        if (!partialViewPath) return;

        // Loading state on the input from the click until the table is bound.
        setModernInputLoading(sourceInputId, $triggerBtn, true);

        $.ajax({
            url: '/LoadPartial/LoadPageOrWindow/',
            type: 'GET',
            data: {
                partialViewpath: partialViewPath
            },
            success: function (response) {
                // .html() (not raw innerHTML) so any <script> inside the
                // partial executes. Those scripts run NOW, before the
                // widgets are initialized below, so bind data in a
                // "mi:modalloaded" handler, not at the top of the partial.
                $('#modalContainerHolder').html(response);

                var $win = $('#PopupWindow');
                var $overlay = $('#AddEditOverlay');
                var $icon = $('#ModalIcon');
                var $saveBtn = $win.find("[data-role='modal-save-btn']");

                if (controller) { $win.data('controller', controller); } else { $win.removeData('controller'); }
                if (action) { $win.data('action-name', action); } else { $win.removeData('action-name'); }

                $win.css({
                    height: height || MODERN_INPUT_MODAL_DEFAULT_HEIGHT,
                    width: width || MODERN_INPUT_MODAL_DEFAULT_WIDTH
                });

                // Class fully replaced (not appended) on every open.
                $icon.attr('class', iconClass || MODERN_INPUT_MODAL_DEFAULT_ICON_CLASS);

                // Id fully replaced on every open, so a page can bind e.g.
                // $(document).on('click', '#btnSaveAgent', ...) per button.
                $saveBtn.attr('id', saveBtnId || MODERN_INPUT_MODAL_DEFAULT_SAVE_BTN_ID);

                // The footer Save button is shown only when the clicked button asks for one
                // (save-btn-id1="..."). A plain pick-a-row list window has no Save.
                // hide-save-button1="true" still hides it even when an id is set.
                var showSave = !!saveBtnId && !(selectOpts && selectOpts.hideSaveBtn);
                $saveBtn.css('display', showSave ? '' : 'none');

                if (sourceInputId) { $win.data('source-input', sourceInputId); } else { $win.removeData('source-input'); }

                LoadWindowContent($win, $overlay, '#Title', title || '', '');
                ModalDragFunction($win);
                CloseAddEditModal('#btnCloseModal', $win, '#AddEditOverlay');

                // Initialize the widgets that just arrived in the partial
                // (modern-table etc.). Without this a modern-table in the
                // partial is only markup and never becomes a working grid.
                if (window.initModernControls) window.initModernControls('#modalContainerHolder');

                // Row pick (value-field set): selecting a row fills the input.
                wireModalRowPick($('#modalContainerHolder'), sourceInputId, selectOpts, !!(controller && action));

                // Tell the page the partial is ready. Fired on the source
                // input (bubbles to document, so delegated handlers work too).
                var $source = sourceInputId ? $('#' + sourceInputId) : $();
                var $holder = $('#modalContainerHolder');
                if ($source.length) {
                    $source.trigger('mi:modalloaded', [$holder]);
                } else {
                    $(document).trigger('mi:modalloaded', [$holder]);
                }

                // If the button was given a controller + action, call it and
                // bind the result to the modal's modern-table automatically.
                bindModalTableFromController(controller, action, $holder, loadDelay, sourceInputId, $triggerBtn);
            },
            error: function () {
                setModernInputLoading(sourceInputId, $triggerBtn, false);
                alert("Failed to load modal content.");
            }
        });
    };

    // CloseAddEditModalNow(winSelector, contentSelector, overlaySelector)
    // Closes the shared modal IMMEDIATELY (CloseAddEditModal only wires a
    // handler for a future click). Use inside your own Save handler:
    //   $(document).off("click", "#btnSaveAgent").on("click", "#btnSaveAgent", function () {
    //       // ... save logic ...
    //       CloseAddEditModalNow();
    //   });
    // All arguments are optional and default to the shared modal's ids.
    // Hides the shared modal's footer Save button again (it is shown per open only
    // when the button that opened the modal set save-btn-id1).
    function restoreModalSaveButton() {
        $('#PopupWindow').find("[data-role='modal-save-btn']").css('display', 'none');
    }

    window.CloseAddEditModalNow = function (winSelector, contentSelector, overlaySelector) {
        var $win = $(winSelector || '#PopupWindow');
        var contentSel = contentSelector || '#modalContainerHolder';
        var overlaySel = overlaySelector || '#AddEditOverlay';

        $win.fadeOut(150, function () {
            restoreModalSaveButton();
            $(contentSel).empty();
            $(overlaySel).hide();
        });
    };

    // Opens the shared modal if the button has a partial view configured.
    // Returns true if it handled the click, false otherwise.
    function tryOpenModernInputModal($btn) {
        var partialView = $btn.attr("data-partial-view");
        if (!partialView) return false;

        window.FetchModernInputModalAndShow(
            partialView,
            $btn.attr("data-modal-title") || "",
            $btn.attr("data-controller") || null,
            $btn.attr("data-action-name") || null,
            $btn.attr("data-modal-height") || null,
            $btn.attr("data-modal-width") || null,
            $btn.attr("data-modal-icon") || null,
            $btn.attr("data-save-btn-id") || null,
            $btn.attr("data-target") || null,   // id of the input this button belongs to
            $btn.attr("data-load-delay"),       // ms to wait before the table data call (default 300)
            $btn,
            {
                valueField: $btn.attr("data-value-field") || null,
                idField: $btn.attr("data-id-field") || null,
                idTarget: $btn.attr("data-id-target") || null,
                closeOnSelect: $btn.attr("data-close-on-select") !== "false",
                hideSaveBtn: $btn.attr("data-hide-save-btn") === "true"
            }
        );
        return true;
    }

    // =========================================================
    // Single routing point for every icon/button activation
    //   browse  -> image picker
    //   upload  -> generic file picker
    //   partial view set -> shared modal
    //   otherwise -> mi:search / mi:search{n}
    // =========================================================
    function activateModernInputButton($btn) {
        if ($btn.attr("aria-disabled") === "true") return;

        var action = $btn.attr("data-action");
        if (action === "browse") {
            openImageBrowser($btn);
        } else if (action === "upload") {
            openFileUpload($btn);
        } else if (tryOpenModernInputModal($btn)) {
            // handled — modal opened, no mi:search{n} event fired
        } else {
            triggerSearch($btn);
        }
    }

    $(document).on("click", ".mis-search-icon, .mis-outside-search-btn", function () {
        activateModernInputButton($(this));
    });

    // Enter/Space on the span buttons, the way a native <button> would.
    $(document).on("keydown", ".mis-search-icon, .mis-outside-search-btn", function (e) {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            activateModernInputButton($(this));
        }
    });

    // Enter inside the input triggers the INSIDE icon's search. When the
    // control has no inside icon (ShowSearchButton = false), Enter is left
    // alone so it doesn't silently block normal form submission.
    $(document).on("keydown", ".mis-row .mi-input", function (e) {
        if (e.key !== "Enter") return;
        var $icon = $(this).closest(".mi-input-wrap").find(".mis-search-icon");
        if ($icon.length === 0) return;
        e.preventDefault();
        triggerSearch($icon);
    });

    // =========================================================
    // Enable / disable helpers
    // =========================================================

    // Inside icon: disableModernInputSearch("#Code") / enableModernInputSearch("#Code")
    window.disableModernInputSearch = function (inputSelector) {
        var $input = $(inputSelector);
        if ($input.length === 0) return;
        $input.closest(".mi-input-wrap").find(".mis-search-icon").attr("aria-disabled", "true");
    };

    window.enableModernInputSearch = function (inputSelector) {
        var $input = $(inputSelector);
        if ($input.length === 0) return;
        $input.closest(".mi-input-wrap").find(".mis-search-icon").removeAttr("aria-disabled");
    };

    // Outside search button 1 or 2:
    //   disableOutsideSearchButton("#Code", 1) / enableOutsideSearchButton("#Code", 2)
    function findOutsideButton($input, buttonNumber) {
        return $input.closest(".mis-row").find(
            ".mis-outside-search-btn[data-search-event='mi:search" + buttonNumber + "']"
        );
    }

    window.disableOutsideSearchButton = function (inputSelector, buttonNumber) {
        var $input = $(inputSelector);
        if ($input.length === 0) return;
        findOutsideButton($input, buttonNumber).attr("aria-disabled", "true");
    };

    window.enableOutsideSearchButton = function (inputSelector, buttonNumber) {
        var $input = $(inputSelector);
        if ($input.length === 0) return;
        findOutsideButton($input, buttonNumber).removeAttr("aria-disabled");
    };

    // File upload button: disableFileUploadButton("#Doc") / enableFileUploadButton("#Doc")
    function findUploadButton($input) {
        return $input.closest(".mis-row").find(".mis-outside-search-btn[data-action='upload']");
    }

    window.disableFileUploadButton = function (inputSelector) {
        var $input = $(inputSelector);
        if ($input.length === 0) return;
        findUploadButton($input).attr("aria-disabled", "true");
    };

    window.enableFileUploadButton = function (inputSelector) {
        var $input = $(inputSelector);
        if ($input.length === 0) return;
        findUploadButton($input).removeAttr("aria-disabled");
    };

    // =========================================================
    // Image box + browse button
    // =========================================================

    // Locked = rendered with Disabled (data-disabled on the box) or the
    // linked input has been disabled since. Blocks drop and clear.
    function isImageBoxLocked($box) {
        return $box.attr("data-disabled") === "true" || isInputDisabled($box.attr("data-target"));
    }

    // Finds the hidden file input via the shared data-target="{Id}",
    // since the image box sits above .mis-row and the button inside it.
    function openImageBrowser($btn) {
        var targetId = $btn.attr("data-target");
        if (isInputDisabled(targetId)) return;
        $("input.mis-image-file-input[data-target='" + targetId + "']").trigger("click");
    }

    // Shows the preview, reveals the clear "x", fills the text input with
    // the file name, and stores the File object.
    function applyImageFile(targetId, file) {
        var $input = $("#" + targetId);
        var $box = $(".mis-image-box[data-target='" + targetId + "']");
        if ($input.length === 0 || $box.length === 0 || !file) return;

        modernInputImageFiles[targetId] = file;

        var reader = new FileReader();
        reader.onload = function (e) {
            var $preview = $box.find(".mis-image-box-preview");
            $preview.attr("src", e.target.result).show();

            // Replay the CSS pop-in animation for every new image: remove
            // it, force a reflow, then restore it.
            $preview.css("animation", "none");
            void $preview[0].offsetWidth;
            $preview.css("animation", "");

            $box.find(".mis-image-box-placeholder").hide();
            $box.find(".mis-image-box-clear").show();
        };
        reader.readAsDataURL(file);

        setInputValueAndNotify($input, file.name);
        $input.trigger("mi:imagechange", [file]);
    }

    // Clears the preview, the stored File, and the text input together.
    function clearImageFile(targetId) {
        var $input = $("#" + targetId);
        var $box = $(".mis-image-box[data-target='" + targetId + "']");
        if ($box.length === 0) return;

        delete modernInputImageFiles[targetId];

        $box.find(".mis-image-box-preview").removeAttr("src").hide();
        $box.find(".mis-image-box-placeholder").show();
        $box.find(".mis-image-box-clear").hide();

        // Reset so choosing the same file again still fires "change".
        $("input.mis-image-file-input[data-target='" + targetId + "']").val("");

        if ($input.length > 0) {
            setInputValueAndNotify($input, "");
            $input.trigger("mi:imageclear");
        }
    }

    // A preview picture that cannot be loaded (broken link, deleted file, no picture saved):
    // show the box's own "No image" placeholder instead of a broken-image icon, and tell the page
    //   $("#Id").on("mi:imagebroken", function (e) { ... });
    // "error" does not bubble, so it is caught on the way down (capture) for every image box.
    document.addEventListener("error", function (e) {
        var el = e.target;
        if (!el || el.tagName !== "IMG" || !$(el).hasClass("mis-image-box-preview")) return;
        if (!el.getAttribute("src")) return;              // already cleared: nothing to do
        var $box = $(el).closest(".mis-image-box");
        $(el).removeAttr("src").hide();
        $box.find(".mis-image-box-placeholder").show();
        $box.find(".mis-image-box-clear").hide();
        $("#" + $box.attr("data-target")).trigger("mi:imagebroken");
    }, true);

    $(document).on("change", ".mis-image-file-input", function () {
        var targetId = $(this).attr("data-target");
        var file = this.files && this.files[0];
        if (file) {
            applyImageFile(targetId, file);
        }
    });

    $(document).on("click", ".mis-image-box-clear", function () {
        var $box = $(this).closest(".mis-image-box");
        if (isImageBoxLocked($box)) return;
        clearImageFile($box.attr("data-target"));
    });

    $(document).on("keydown", ".mis-image-box-clear", function (e) {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            var $box = $(this).closest(".mis-image-box");
            if (isImageBoxLocked($box)) return;
            clearImageFile($box.attr("data-target"));
        }
    });

    // Drag an image onto the box to select it. dragenter/dragleave also
    // fire for every child element (preview, clear "x"), so a depth
    // counter is used — the highlight only drops when the pointer has
    // really left the box, instead of flickering over its children.
    // preventDefault is always called on drop, even when locked, so the
    // browser never navigates away to open the dropped file.
    $(document)
        .on("dragenter", ".mis-image-box", function (e) {
            e.preventDefault();
            var $box = $(this);
            $box.data("mis-drag-depth", ($box.data("mis-drag-depth") || 0) + 1);
            if (!isImageBoxLocked($box)) {
                $box.addClass("mis-image-box-dragover");
            }
        })
        .on("dragover", ".mis-image-box", function (e) {
            e.preventDefault();
            var dt = e.originalEvent.dataTransfer;
            if (dt) dt.dropEffect = isImageBoxLocked($(this)) ? "none" : "copy";
        })
        .on("dragleave", ".mis-image-box", function () {
            var $box = $(this);
            var depth = Math.max(0, ($box.data("mis-drag-depth") || 0) - 1);
            $box.data("mis-drag-depth", depth);
            if (depth === 0) {
                $box.removeClass("mis-image-box-dragover");
            }
        })
        .on("drop", ".mis-image-box", function (e) {
            e.preventDefault();
            var $box = $(this);
            $box.data("mis-drag-depth", 0).removeClass("mis-image-box-dragover");
            if (isImageBoxLocked($box)) return;

            var dt = e.originalEvent.dataTransfer;
            var file = dt && dt.files && dt.files[0];
            if (file && file.type && file.type.indexOf("image/") === 0) {
                applyImageFile($box.attr("data-target"), file);
            }
        });

    // Programmatic clear for a page's own "reset form" logic.
    window.clearModernInputImage = function (inputSelector) {
        var $input = $(inputSelector);
        if ($input.length === 0) return;
        clearImageFile($input.attr("id"));
    };

    // =========================================================
    // Tooltip edge avoidance
    // The CSS centers a button's tooltip on the button by default. That
    // works in open space but overflows a narrow container (a modal near
    // its own edge, a tight column) when the button sits close to the
    // container's side. On hover/focus, measure where the centered
    // bubble WOULD land and, if it would clip past the viewport, add
    // .mis-tooltip-align-left or .mis-tooltip-align-right so the CSS
    // repositions the bubble (and its arrow) to hug that side instead.
    // A small margin keeps it off the viewport edge itself.
    // =========================================================
    var TOOLTIP_VIEWPORT_MARGIN = 8;

    function adjustTooltipPosition($btn) {
        $btn.removeClass("mis-tooltip-align-left mis-tooltip-align-right");

        var tooltipText = $btn.attr("data-tooltip");
        if (!tooltipText) return;

        var rect = $btn[0].getBoundingClientRect();
        var centerX = rect.left + rect.width / 2;

        // ::after has max-width: 220px and can be narrower depending on
        // content; measuring the actual rendered bubble (after adding
        // the class so max-width/padding apply) would need an extra
        // reflow per hover, so this uses the CSS max-width as a
        // conservative estimate — good enough to decide a side, and it
        // only ever makes the check MORE cautious, never less.
        var estimatedHalfWidth = 110;

        var wouldOverflowRight = (centerX + estimatedHalfWidth) > (window.innerWidth - TOOLTIP_VIEWPORT_MARGIN);
        var wouldOverflowLeft = (centerX - estimatedHalfWidth) < TOOLTIP_VIEWPORT_MARGIN;

        if (wouldOverflowRight && !wouldOverflowLeft) {
            $btn.addClass("mis-tooltip-align-left");   // bubble's right edge sits at the button's right edge
        } else if (wouldOverflowLeft && !wouldOverflowRight) {
            $btn.addClass("mis-tooltip-align-right");  // bubble's left edge sits at the button's left edge
        }
        // If both would overflow (viewport narrower than the tooltip),
        // fall back to centered — there's no side that fully avoids it.
    }

    $(document).on("mouseenter focus", ".mis-outside-search-btn[data-tooltip]", function () {
        adjustTooltipPosition($(this));
    });

    // Re-check on window resize while a tooltip might be open (cheap:
    // only runs the check on buttons currently hovered/focused).
    $(window).on("resize", function () {
        $(".mis-outside-search-btn[data-tooltip]:hover, .mis-outside-search-btn[data-tooltip]:focus").each(function () {
            adjustTooltipPosition($(this));
        });
    });

    // =========================================================
    // File upload button (any file type, optional filter)
    // =========================================================
    function openFileUpload($btn) {
        var targetId = $btn.attr("data-target");
        if (isInputDisabled(targetId)) return;
        $("input.mis-file-upload-input[data-target='" + targetId + "']").trigger("click");
    }

    // Mirrors the browser's own accept="" matching rules:
    //   ".pdf"     -> file name ends with .pdf (case-insensitive)
    //   "image/*"  -> MIME type starts with "image/"
    //   "text/csv" -> exact MIME type match
    // Empty/absent accept = every file allowed.
    function fileMatchesAccept(file, accept) {
        if (!accept) return true;
        var name = (file.name || "").toLowerCase();
        var type = (file.type || "").toLowerCase();
        var tokens = accept.toLowerCase().split(",");

        for (var i = 0; i < tokens.length; i++) {
            var t = $.trim(tokens[i]);
            if (!t) continue;

            if (t.charAt(0) === ".") {
                if (name.length >= t.length && name.slice(-t.length) === t) return true;
            } else if (t.slice(-2) === "/*") {
                if (type.indexOf(t.slice(0, -1)) === 0) return true;
            } else if (type === t) {
                return true;
            }
        }
        return false;
    }

    $(document).on("change", ".mis-file-upload-input", function () {
        var $fileInput = $(this);
        var targetId = $fileInput.attr("data-target");
        var $input = $("#" + targetId);
        if ($input.length === 0) return;

        var accept = $fileInput.attr("data-accept") || "";
        var maxMb = parseFloat($fileInput.attr("data-max-size-mb"));
        var maxBytes = maxMb > 0 ? maxMb * 1024 * 1024 : 0;

        var chosen = this.files ? Array.prototype.slice.call(this.files) : [];
        var accepted = [];
        var rejected = [];

        $.each(chosen, function (_, file) {
            if (!fileMatchesAccept(file, accept)) {
                rejected.push({ file: file, reason: "type" });
            } else if (maxBytes && file.size > maxBytes) {
                rejected.push({ file: file, reason: "size" });
            } else {
                accepted.push(file);
            }
        });

        // Reset the native input so picking the SAME file again still
        // fires "change". Safe: the accepted File objects are already
        // held in the array above and stored below.
        $fileInput.val("");

        if (rejected.length) {
            $input.trigger("mi:filerejected", [rejected]);
        }

        // Nothing valid chosen: keep any previous valid selection as-is.
        if (!accepted.length) return;

        modernInputUploadFiles[targetId] = accepted;
        setInputValueAndNotify($input, $.map(accepted, function (f) { return f.name; }).join(", "));
        $input.trigger("mi:fileupload", [accepted]);
    });

    // Programmatic clear: clearModernInputUpload("#Doc");
    window.clearModernInputUpload = function (inputSelector) {
        var $input = $(inputSelector);
        if ($input.length === 0) return;
        var id = $input.attr("id");

        delete modernInputUploadFiles[id];
        $("input.mis-file-upload-input[data-target='" + id + "']").val("");
        setInputValueAndNotify($input, "");
        $input.trigger("mi:fileclear");
    };

    // =========================================================
    // Image click-to-zoom
    // FLIP technique, transform-only: a CLONE is placed at the final
    // large/centered rect, visually shrunk onto the preview via
    // transform, then transitioned to transform: none. The real image
    // and page layout never move. Clicking the clone, the "x", the dim
    // scrim, or pressing Esc closes it.
    // =========================================================
    var $activeZoom = null;

    function closeImageZoom() {
        if (!$activeZoom) return;
        var $clone = $activeZoom;
        var originalRect = $clone.data("origin-rect");
        var targetRect = $clone.data("target-rect");
        var $btn = $clone.data("close-btn");

        if ($btn) {
            $btn.removeClass("mis-image-zoom-close-visible");
            $btn.remove();
        }

        // Reverse of the open: transform back onto the preview's rect.
        var scaleX = originalRect.width / targetRect.width;
        var scaleY = originalRect.height / targetRect.height;
        var translateX = originalRect.left - targetRect.left;
        var translateY = originalRect.top - targetRect.top;

        $clone.css({
            transform: "translate(" + translateX + "px, " + translateY + "px) scale(" + scaleX + ", " + scaleY + ")",
            borderRadius: originalRect.borderRadius
        });
        $("body").removeClass("mis-image-zoom-dim");

        var $realImg = $clone.data("source-img");
        var cleanupDone = false;
        var fallbackTimer = null;

        var cleanup = function () {
            if (cleanupDone) return;   // transitionend and the fallback may both fire
            cleanupDone = true;
            if (fallbackTimer !== null) {
                clearTimeout(fallbackTimer);
                fallbackTimer = null;
            }
            $clone.off("transitionend");
            $clone.remove();
            if ($realImg) $realImg.css("visibility", "");
        };
        $clone.one("transitionend", cleanup);
        fallbackTimer = setTimeout(cleanup, 400);   // e.g. reduced motion: no transitionend

        $activeZoom = null;
    }

    $(document).on("click", ".mis-image-box-preview", function () {
        var $img = $(this);
        if (!$img.attr("src")) return;   // empty preview
        if ($activeZoom) {
            closeImageZoom();
            return;
        }

        var rect = this.getBoundingClientRect();
        var computedRadius = window.getComputedStyle(this).borderRadius;

        // Hide the real image while its clone is on top, to avoid a ghost.
        $img.css("visibility", "hidden");

        // Large-but-safe target size that keeps the image's aspect ratio.
        var naturalRatio = this.naturalWidth && this.naturalHeight
            ? this.naturalWidth / this.naturalHeight
            : rect.width / rect.height;
        var maxW = window.innerWidth * 0.86;
        var maxH = window.innerHeight * 0.86;
        var targetW = maxW;
        var targetH = targetW / naturalRatio;
        if (targetH > maxH) {
            targetH = maxH;
            targetW = targetH * naturalRatio;
        }
        var targetTop = (window.innerHeight - targetH) / 2;
        var targetLeft = (window.innerWidth - targetW) / 2;

        // Invert step: transform that makes the final box look like the preview.
        var scaleX = rect.width / targetW;
        var scaleY = rect.height / targetH;
        var translateX = rect.left - targetLeft;
        var translateY = rect.top - targetTop;

        var $clone = $("<img class='mis-image-zoom-clone' alt=''/>")
            .attr("src", $img.attr("src"))
            .data("source-img", $img)
            .data("origin-rect", { top: rect.top, left: rect.left, width: rect.width, height: rect.height, borderRadius: computedRadius })
            .data("target-rect", { top: targetTop, left: targetLeft, width: targetW, height: targetH })
            .css({
                position: "fixed",
                top: targetTop + "px",
                left: targetLeft + "px",
                width: targetW + "px",
                height: targetH + "px",
                margin: 0,
                zIndex: 10000,
                borderRadius: computedRadius,
                transformOrigin: "top left",
                transform: "translate(" + translateX + "px, " + translateY + "px) scale(" + scaleX + ", " + scaleY + ")"
            });

        var $closeBtn = $("<span class='mis-image-zoom-close' role='button' tabindex='0' aria-label='Close'>" +
            "<svg width='16' height='16' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'>" +
            "<path d='M4 4L12 12M12 4L4 12' stroke='currentColor' stroke-width='1.8' stroke-linecap='round'/></svg>" +
            "</span>");

        $("body").append($clone).append($closeBtn.hide());
        $activeZoom = $clone;

        // Two rAFs so the clone is painted at its START transform before
        // switching to the END state (Play step).
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                $clone.css({
                    transform: "translate(0, 0) scale(1, 1)",
                    borderRadius: "12px"
                });
                $("body").addClass("mis-image-zoom-dim");
            });
        });

        // Close button at the final image's top-right corner, fading in
        // once the grow animation has mostly finished.
        $closeBtn.css({
            position: "fixed",
            top: (targetTop - 14) + "px",
            left: (targetLeft + targetW - 14) + "px",
            zIndex: 10001
        });
        setTimeout(function () { $closeBtn.addClass("mis-image-zoom-close-visible").show(); }, 200);

        $clone.data("close-btn", $closeBtn);
    });

    $(document).on("click", ".mis-image-zoom-clone", function () {
        closeImageZoom();
    });

    $(document).on("click keydown", ".mis-image-zoom-close", function (e) {
        if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        closeImageZoom();
    });

    // Click anywhere outside the zoomed image closes it.
    $(document).on("click", function (e) {
        if (!$activeZoom) return;
        var $target = $(e.target);
        if ($target.closest(".mis-image-zoom-clone").length) return;
        if ($target.closest(".mis-image-zoom-close").length) return;
        if ($target.closest(".mis-image-box-preview").length) return;   // handled by its own handler
        closeImageZoom();
    });

    $(document).on("keydown", function (e) {
        if (e.key === "Escape" && $activeZoom) {
            closeImageZoom();
        }
    });

});