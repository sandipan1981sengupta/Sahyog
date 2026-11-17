// ===== ModernToolbar — Add/Edit/Save button click wiring =====
//
// ModernToolbar (the <modern-toolbar /> tag helper) renders its Add and
// Edit buttons as plain <a> elements. When a *PartialView is configured
// for one of them (AddPartialView / EditPartialView), that button also
// carries data-partial-view (plus data-modal-title, data-modal-icon,
// data-modal-height, data-modal-width, data-save-btn-id,
// data-controller, data-action-name as configured) and
// data-toolbar-modal-btn='true'.
//
// This file calls window.FetchModernInputModalAndShow directly — that
// function is defined in modern-input-with-search.js and put on
// window there, so it's reachable from here. (Its sibling helper,
// tryOpenModernInputModal, is NOT reachable from this file — in the
// currently-deployed modern-input-with-search.js it's declared as a
// plain local function inside that file's own closure, not attached to
// window — so this file reads the button's data-* attributes itself
// instead of depending on that private helper.)
//
// Load modern-input-with-search.js BEFORE this file in your layout,
// since window.FetchModernInputModalAndShow must already exist by the
// time a click can happen.
//
// ----- Save button -----
// When show-save="true", the toolbar renders:
//   <a id="btnToolbarSave{IdSuffix}" class="btnToolbar btnToolbarSave ..."
//      data-id-suffix="{IdSuffix}" data-controller="..." data-action-name="...">
// This file does NOT wire a click for it — bind it from your page JS
// (see the commented examples below). The id is btnToolbarSave{Suffix},
// not btnSave{Suffix}, so it never collides with the modal's Save
// button id (e.g. AddSaveBtnId="btnSaveDoc").
//
// Delete, Upload, and Download buttons from ModernToolbar are NOT
// touched by this file — they render with no click behavior wired in
// (Upload keeps its native file-input/label behavior; Delete/Download
// are left for the page's own JS, exactly as the original
// _ToolbarPartial.cshtml worked).


// ----- Example page-level handlers (copy into your page JS) -----
//
// // Modal Save (Add flow) — id set via add-save-btn-id="btnSaveDoc"
// $(document).off("click", "#btnSaveDoc").on("click", "#btnSaveDoc", function () {
//     // Add-flow save logic
//     CloseAddEditModalNow();
// });
//
// // Modal Save (Edit flow) — id set via edit-save-btn-id="btnSaveDocEdit"
// $(document).off("click", "#btnSaveDocEdit").on("click", "#btnSaveDocEdit", function () {
//     // Edit-flow save logic
//     CloseAddEditModalNow();
// });
//
// // Toolbar Save — <modern-toolbar show-save="true" id-suffix="Doc" ... />
// $(document).off("click", "#btnToolbarSaveDoc").on("click", "#btnToolbarSaveDoc", function (e) {
//     e.preventDefault();
//     var controller = $(this).attr("data-controller");   // from save-target-controller
//     var action = $(this).attr("data-action-name");      // from save-target-action
//     // Toolbar save logic, e.g.:
//     // ModernToolbar.setSaveBusy("Doc", true);
//     // $.post("/" + controller + "/" + action, { ... })
//     //     .always(function () { ModernToolbar.setSaveBusy("Doc", false); });
// });


(function ($, window) {

    // ----- Small public helpers for the toolbar Save button -----
    // Usage from any page JS:
    //   ModernToolbar.getSaveButton("Doc")          -> jQuery object for #btnToolbarSaveDoc
    //   ModernToolbar.showSave("Doc", false)        -> hide it (true to show)
    //   ModernToolbar.setSaveEnabled("Doc", false)  -> disable it (true to enable)
    //   ModernToolbar.setSaveBusy("Doc", true)      -> disable + spinner icon while saving
    function getSaveButton(suffix) {
        return $("#btnToolbarSave" + (suffix || ""));
    }

    function showSave(suffix, visible) {
        getSaveButton(suffix).toggle(visible !== false);
    }

    function setSaveEnabled(suffix, enabled) {
        var $btn = getSaveButton(suffix);
        var on = enabled !== false;
        $btn.toggleClass("btnToolbarDisabled", !on)
            .attr("aria-disabled", on ? null : "true")
            .css({ "pointer-events": on ? "" : "none", "opacity": on ? "" : "0.5" });
    }

    function setSaveBusy(suffix, busy) {
        var $icon = getSaveButton(suffix).find("span.fa");
        if (busy) {
            $icon.removeClass("fa-floppy-o").addClass("fa-spinner fa-spin");
        } else {
            $icon.removeClass("fa-spinner fa-spin").addClass("fa-floppy-o");
        }
        setSaveEnabled(suffix, !busy);
    }

    window.ModernToolbar = window.ModernToolbar || {};
    window.ModernToolbar.getSaveButton = getSaveButton;
    window.ModernToolbar.showSave = showSave;
    window.ModernToolbar.setSaveEnabled = setSaveEnabled;
    window.ModernToolbar.setSaveBusy = setSaveBusy;


    $(document).ready(function () {

        // ----- Add / Edit: open the shared modal -----
        $(document).on("click", "[data-toolbar-modal-btn='true']", function (e) {
            e.preventDefault(); // these are <a> tags with no href; keep clicks from navigating

            var $btn = $(this);
            var partialView = $btn.attr("data-partial-view");
            if (!partialView) return;

            var title = $btn.attr("data-modal-title") || "";
            var controller = $btn.attr("data-controller") || null;
            var action = $btn.attr("data-action-name") || null;
            var height = $btn.attr("data-modal-height") || null;
            var width = $btn.attr("data-modal-width") || null;
            var iconClass = $btn.attr("data-modal-icon") || null;
            var saveBtnId = $btn.attr("data-save-btn-id") || null;

            window.FetchModernInputModalAndShow(partialView, title, controller, action, height, width, iconClass, saveBtnId);
        });

        // ----- Save: only stop the <a> from navigating; the page's own
        // handler on #btnToolbarSave{Suffix} does the actual save. -----
        $(document).on("click", ".btnToolbarSave", function (e) {
            e.preventDefault();
        });
    });

})(jQuery, window);