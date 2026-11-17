using System;
using Microsoft.AspNetCore.Razor.TagHelpers;

namespace Sahyog.Web.TagHelpers
{
    /// <summary>
    /// Renders the Add / Edit / Save / Delete / Upload / Download button strip
    /// that used to be _ToolbarPartial.cshtml, called via
    /// @await Html.PartialAsync("_ToolbarPartial", toolbarData) with a
    /// hand-built ViewDataDictionary. This tag helper is a drop-in
    /// replacement with the same visual result and the same button ids
    /// (btnAdd{IdSuffix}, btnEdit{IdSuffix}, btnDelete{IdSuffix},
    /// btnExcelUpload{IdSuffix} / UploadExcel{IdSuffix}, and
    /// btnExcelDownload{IdSuffix}) — any existing page JS wired to those
    /// ids keeps working unchanged.
    ///
    /// Usage — same shape as the ViewData call it replaces:
    ///
    ///   <modern-toolbar
    ///       show-add="true" show-edit="false" show-save="true" show-delete="true"
    ///       show-excel-upload="false" show-excel-download="true"
    ///       toolbar-margin-top="12px" id-suffix="Doc"
    ///       add-icon-color="#17139c" delete-icon-color="#8e3343" download-icon-color="#2eb872"
    ///       add-partial-view="/Views/Shared/AddEditPartial/_add-edit-Doc-partial.cshtml"
    ///       add-modal-title="Add Document"
    ///       save-target-controller="Document" save-target-action="SaveAll" />
    ///
    /// ----- Add / Edit: open the shared modal -----
    /// Unlike the rest of the buttons, Add and Edit are wired here: each
    /// gets its own AddPartialView / EditPartialView (and matching
    /// ModalTitle / ModalIcon / ModalHeight / ModalWidth / SaveBtnId),
    /// and clicking the button calls
    /// window.FetchModernInputModalAndShow(...) — the same function
    /// modern-input-with-search.js already exposes for
    /// OutsideSearchPartialView1/2 — to load that partial into the
    /// EXISTING shared modal shell (<modern-popup-modal />, i.e.
    /// #PopupWindow / #AddEditOverlay / #ModalIcon / #Title /
    /// #modalContainerHolder). This tag helper does not render or
    /// duplicate that shell — <modern-popup-modal /> must already be
    /// present once in the layout, exactly as it is for
    /// modern-input-with-search's outside search buttons.
    ///
    /// A button with no *PartialView set (e.g. Edit left unconfigured)
    /// renders normally but has no click behavior wired for it by this
    /// control — same as if AddPartialView/EditPartialView were never
    /// passed at all.
    ///
    /// Font Awesome note: this project loads Font Awesome 4.7, so any
    /// AddModalIcon / EditModalIcon value must use "fa fa-&lt;name&gt;"
    /// syntax with an icon that exists in FA 4.7 — see
    /// ModernInputWithSearch.OutsideSearchModalIcon1 for the same rule.
    ///
    /// ----- Save: plain button for page JS -----
    /// ShowSave defaults to false so existing toolbars are unchanged.
    /// Renders as id='btnToolbarSave{IdSuffix}' with class
    /// 'btnToolbarSave', a green floppy icon (fa fa-floppy-o), optional
    /// data-controller / data-action-name, and data-id-suffix. No click
    /// behavior is wired by this control — bind it from page JS, e.g.
    /// $(document).on("click", "#btnToolbarSaveDoc", ...).
    ///
    /// The id is deliberately NOT btnSave{IdSuffix}: with IdSuffix="Doc"
    /// that would be "btnSaveDoc", which collides with the id commonly
    /// passed as AddSaveBtnId for the modal's own Save button.
    ///
    /// ----- Delete / Upload / Download: unchanged from the partial -----
    /// Delete and Download render as plain <a> buttons with just their
    /// id and (optional) TargetController/TargetAction data attributes —
    /// no click behavior is wired by this control, exactly as the
    /// original partial relied on page JS bound to #btnDelete{Suffix} /
    /// #btnExcelDownload{Suffix}. Upload keeps its existing hidden
    /// &lt;input type='file'&gt; + &lt;label&gt; pattern, which opens the
    /// native OS file picker on click — nothing about Upload's behavior
    /// changes here.
    /// </summary>
    [HtmlTargetElement("modern-toolbar")]
    public class ModernToolbar : TagHelper
    {
        // ----- Visibility, same defaults as the partial -----
        public bool ShowAdd { get; set; } = true;
        public bool ShowEdit { get; set; } = true;
        public bool ShowSave { get; set; } = false;             // off by default so existing toolbars don't change
        public bool ShowDelete { get; set; } = true;
        public bool ShowExcelUpload { get; set; } = true;
        public bool ShowExcelDownload { get; set; } = true;

        // ----- Layout / id-namespacing, same as the partial -----
        public string ToolbarMarginTop { get; set; } = "0px";
        public string IdSuffix { get; set; } = "";

        // ----- Per-button icon colors, same defaults as the partial -----
        public string AddIconColor { get; set; } = "#2f7ed8";
        public string EditIconColor { get; set; } = "#2f7ed8";
        public string SaveIconColor { get; set; } = "#28a745";
        public string DeleteIconColor { get; set; } = "#c0392b";
        public string UploadIconColor { get; set; } = "#2f7ed8";
        public string DownloadIconColor { get; set; } = "#2eb872";

        // ----- Add: opens the shared modal -----
        public string AddPartialView { get; set; }              // e.g. "/Views/Shared/AddEditPartial/_add-edit-Doc-partial.cshtml"; unset = no modal wired for Add
        public string AddModalTitle { get; set; }
        public string AddModalIcon { get; set; }                // FA4 syntax — see class summary
        public string AddModalHeight { get; set; }               // "70%", "500px", or bare "500" (auto-gets px)
        public string AddModalWidth { get; set; }
        public string AddSaveBtnId { get; set; }                 // id to set on the modal's Save button (data-role='modal-save-btn') when Add opens it
        public string AddTargetController { get; set; }          // optional, rendered as data-controller
        public string AddTargetAction { get; set; }              // optional, rendered as data-action-name

        // ----- Edit: opens the shared modal (same shape as Add) -----
        public string EditPartialView { get; set; }
        public string EditModalTitle { get; set; }
        public string EditModalIcon { get; set; }
        public string EditModalHeight { get; set; }
        public string EditModalWidth { get; set; }
        public string EditSaveBtnId { get; set; }
        public string EditTargetController { get; set; }
        public string EditTargetAction { get; set; }

        // ----- Save: optional routing data only, no modal -----
        public string SaveTargetController { get; set; }         // optional, rendered as data-controller
        public string SaveTargetAction { get; set; }             // optional, rendered as data-action-name

        // ----- Delete / Download: optional routing data only, no modal -----
        public string DeleteTargetController { get; set; }
        public string DeleteTargetAction { get; set; }
        public string DownloadTargetController { get; set; }
        public string DownloadTargetAction { get; set; }

        public override void Process(TagHelperContext context, TagHelperOutput output)
        {
            output.TagName = null;
            output.TagMode = TagMode.StartTagAndEndTag;

            string NormalizeUnit(string raw)
            {
                if (string.IsNullOrWhiteSpace(raw)) return raw;
                return double.TryParse(raw, out _) ? raw + "px" : raw;
            }

            static string Encode(string val) => System.Net.WebUtility.HtmlEncode(val ?? string.Empty);

            // Builds the modal-wiring data-* attributes shared by Add and
            // Edit — identical attribute names to the ones
            // ModernInputWithSearch.BuildOutsideButton already renders
            // (data-partial-view, data-modal-title, data-modal-height,
            // data-modal-width, data-modal-icon, data-save-btn-id,
            // data-controller, data-action-name), so the SAME click
            // handler / JS logic pattern applies to both controls without
            // needing to know which one rendered the button.
            string BuildModalAttrs(
                string partialView, string modalTitle, string modalIcon,
                string modalHeight, string modalWidth, string saveBtnId,
                string targetController, string targetAction)
            {
                if (string.IsNullOrWhiteSpace(partialView)) return "";

                var normalizedHeight = NormalizeUnit(modalHeight);
                var normalizedWidth = NormalizeUnit(modalWidth);

                var parts = new System.Collections.Generic.List<string>
                {
                    $"data-partial-view='{Encode(partialView)}'"
                };
                if (!string.IsNullOrWhiteSpace(modalTitle)) parts.Add($"data-modal-title='{Encode(modalTitle)}'");
                if (!string.IsNullOrWhiteSpace(modalIcon)) parts.Add($"data-modal-icon='{Encode(modalIcon)}'");
                if (!string.IsNullOrWhiteSpace(normalizedHeight)) parts.Add($"data-modal-height='{Encode(normalizedHeight)}'");
                if (!string.IsNullOrWhiteSpace(normalizedWidth)) parts.Add($"data-modal-width='{Encode(normalizedWidth)}'");
                if (!string.IsNullOrWhiteSpace(saveBtnId)) parts.Add($"data-save-btn-id='{Encode(saveBtnId)}'");
                if (!string.IsNullOrWhiteSpace(targetController)) parts.Add($"data-controller='{Encode(targetController)}'");
                if (!string.IsNullOrWhiteSpace(targetAction)) parts.Add($"data-action-name='{Encode(targetAction)}'");

                // Marks this button as modal-opening so the shared click
                // handler (see the accompanying JS) knows to route it to
                // FetchModernInputModalAndShow instead of leaving it for
                // page-level JS to wire up.
                parts.Add("data-toolbar-modal-btn='true'");

                return string.Join(" ", parts);
            }

            var addHtml = "";
            if (ShowAdd)
            {
                var addModalAttrs = BuildModalAttrs(
                    AddPartialView, AddModalTitle, AddModalIcon, AddModalHeight, AddModalWidth,
                    AddSaveBtnId, AddTargetController, AddTargetAction);

                addHtml = $@"
        <a id='btnAdd{Encode(IdSuffix)}' class='btnToolbar ripple AnimatedAppear' title='Add' style='--ripple-color:{Encode(AddIconColor)};' {addModalAttrs}>
            <span class='fa fa-plus' aria-hidden='true' style='color:{Encode(AddIconColor)};'></span>Add
        </a>";
            }

            var editHtml = "";
            if (ShowEdit)
            {
                var editModalAttrs = BuildModalAttrs(
                    EditPartialView, EditModalTitle, EditModalIcon, EditModalHeight, EditModalWidth,
                    EditSaveBtnId, EditTargetController, EditTargetAction);

                editHtml = $@"
        <a id='btnEdit{Encode(IdSuffix)}' class='btnToolbar ripple AnimatedAppear' title='Edit' style='--ripple-color:{Encode(EditIconColor)};' {editModalAttrs}>
            <span class='fa fa-pencil-square-o' aria-hidden='true' style='color:{Encode(EditIconColor)};'></span>Edit
        </a>";
            }

            var saveHtml = "";
            if (ShowSave)
            {
                var saveAttrs = "";
                if (!string.IsNullOrWhiteSpace(SaveTargetController)) saveAttrs += $" data-controller='{Encode(SaveTargetController)}'";
                if (!string.IsNullOrWhiteSpace(SaveTargetAction)) saveAttrs += $" data-action-name='{Encode(SaveTargetAction)}'";

                saveHtml = $@"
        <a id='btnToolbarSave{Encode(IdSuffix)}' class='btnToolbar btnToolbarSave ripple AnimatedAppear' title='Save' style='--ripple-color:{Encode(SaveIconColor)};' data-id-suffix='{Encode(IdSuffix)}'{saveAttrs}>
            <span class='fa fa-floppy-o' aria-hidden='true' style='color:{Encode(SaveIconColor)};'></span>Save
        </a>";
            }

            var deleteHtml = "";
            if (ShowDelete)
            {
                var deleteAttrs = "";
                if (!string.IsNullOrWhiteSpace(DeleteTargetController)) deleteAttrs += $" data-controller='{Encode(DeleteTargetController)}'";
                if (!string.IsNullOrWhiteSpace(DeleteTargetAction)) deleteAttrs += $" data-action-name='{Encode(DeleteTargetAction)}'";

                deleteHtml = $@"
        <a id='btnDelete{Encode(IdSuffix)}' class='btnToolbar btnDelete ripple AnimatedAppear' title='Delete' style='--ripple-color:{Encode(DeleteIconColor)};'{deleteAttrs}>
            <span class='fa fa-trash-o' aria-hidden='true' style='color:{Encode(DeleteIconColor)};'></span>Delete
        </a>";
            }

            var uploadHtml = "";
            if (ShowExcelUpload)
            {
                uploadHtml = $@"
        <a id='btnExcelUpload{Encode(IdSuffix)}' class='btnToolbar ripple AnimatedAppear' title='Upload' style='--ripple-color:{Encode(UploadIconColor)};'>
            <input id='UploadExcel{Encode(IdSuffix)}' class='InputFileClass' style='border-radius:10px;' type='file' accept='.xlsx' />
            <label for='UploadExcel{Encode(IdSuffix)}' style='margin:0; cursor:pointer; display:inline-flex; align-items:center; gap:8px;'>
                <span class='fa fa-upload' aria-hidden='true' style='color:{Encode(UploadIconColor)};'></span>Upload
            </label>
        </a>";
            }

            var downloadHtml = "";
            if (ShowExcelDownload)
            {
                var downloadAttrs = "";
                if (!string.IsNullOrWhiteSpace(DownloadTargetController)) downloadAttrs += $" data-controller='{Encode(DownloadTargetController)}'";
                if (!string.IsNullOrWhiteSpace(DownloadTargetAction)) downloadAttrs += $" data-action-name='{Encode(DownloadTargetAction)}'";

                downloadHtml = $@"
        <a id='btnExcelDownload{Encode(IdSuffix)}' class='btnToolbar ripple AnimatedAppear' title='Excel format download' style='--ripple-color:{Encode(DownloadIconColor)};'{downloadAttrs}>
            <span class='fa fa-cloud-download' aria-hidden='true' style='color:{Encode(DownloadIconColor)};'></span>Download
        </a>";
            }

            var normalizedMarginTop = NormalizeUnit(ToolbarMarginTop);

            output.Content.SetHtmlContent($@"
<div class='toolbarstrip toolbar notranslate' style='margin-top:{Encode(normalizedMarginTop)};'>
{addHtml}{editHtml}{saveHtml}{deleteHtml}{uploadHtml}{downloadHtml}
</div>
");
        }
    }
}