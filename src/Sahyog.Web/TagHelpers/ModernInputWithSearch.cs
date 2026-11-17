using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net;
using Microsoft.AspNetCore.Razor.TagHelpers;

namespace Sahyog.Web.TagHelpers
{
    /// <summary>
    /// Same as ModernInput (pill-shaped input, label, mandatory asterisk,
    /// validation icon, type-based character filtering) plus a magnifier
    /// icon INSIDE the input box's right edge (mirroring the left edit
    /// icon). Fires "mi:search" on the input element when the icon is
    /// clicked, passing the current value:
    ///   $("#Id").on("mi:search", function(e, value) {...});
    /// Uses an "mis-" prefix on its own classes so it coexists cleanly
    /// with ModernInput on the same page.
    ///
    /// ICON COLORS
    /// Every icon color option (SearchIconColor, OutsideSearchIconColor1/2,
    /// ImageBrowseIconColor, FileUploadIconColor) accepts either a solid
    /// value (named color / hex / var(--token)) or a CSS gradient
    /// (linear-/radial-/conic-gradient, incl. repeating-*). Gradients are
    /// auto-detected and painted with a mask on an INNER .mis-glyph span,
    /// so the outer button keeps its own round background, hover/press
    /// shading and tooltip in both color modes.
    ///
    /// OUTSIDE BUTTONS (round buttons to the right of the input box)
    ///   1) Search button 1 — ShowOutsideSearchButton1, fires "mi:search1"
    ///   2) Search button 2 — ShowOutsideSearchButton2, fires "mi:search2"
    ///   3) Image browse    — ShowImageBrowseButton (with ShowImageBox)
    ///   4) File upload     — ShowFileUploadButton (any file type, or
    ///                        filtered via FileUploadAccept)
    /// Any combination can be visible at once, in that order.
    ///
    ///   $("#Id").on("mi:search1", function(e, value) {...});
    ///   $("#Id").on("mi:search2", function(e, value) {...});
    ///
    /// OPTIONAL MODAL WIRING (search buttons 1 / 2)
    /// If OutsideSearchPartialView{n} is set, clicking that button does NOT
    /// fire mi:search{n}; it loads the partial into the site's single
    /// shared modal (#PopupWindow / #AddEditOverlay / #Title /
    /// #modalContainerHolder / #btnCloseModal in _Layout.cshtml) via
    /// FetchModernInputModalAndShow in modern-input-with-search.js.
    ///   - OutsideSearchModalTitle{n}: modal #Title text.
    ///   - OutsideSearchTargetController{n} / OutsideSearchTargetAction{n}:
    ///     rendered as data-controller / data-action-name only when set.
    ///   - OutsideSearchModalHeight{n} / Width{n}: e.g. "70%", "500px",
    ///     or bare "500" (auto-gets px). Unset = modal's own default.
    ///   - OutsideSearchModalIcon{n}: Font Awesome 4.7 class(es) for
    ///     #ModalIcon, e.g. "fa fa-user". Unset = modal's own default.
    ///   - OutsideSearchSaveBtnId{n}: id given to the shared modal's Save
    ///     button (found via its stable data-role='modal-save-btn').
    ///     Unset = default id 'btnSave'.
    ///   - OutsideSearchLoadDelay{n}: milliseconds to wait before the
    ///     TargetController/TargetAction call that fills the modal's
    ///     modern-table (e.g. 100 or 300). Unset/invalid = 300. While it
    ///     waits and loads, the table shows its loading pill (tableLoader.js)
    ///     and the search input shows a loading spinner.
    ///   - OutsideSearchValueField{n}: column of the modal's modern-table
    ///     whose value is put into the search input when the user selects a
    ///     row (e.g. "ACGroupCode"). Setting it turns row-pick on.
    ///   - OutsideSearchIdField{n}: optional column holding the row's key
    ///     (e.g. "ID"); kept on the input as data-selected-id.
    ///   - OutsideSearchIdTarget{n}: optional id of a page hidden input that
    ///     receives that key, so it posts with the form.
    ///   - OutsideSearchHideSaveButton{n}: hide the shared modal's Save
    ///     button for this open (e.g. a pick-only list window). It is shown
    ///     again when the modal closes / on the next open.
    ///   - OutsideSearchCloseOnSelect{n}: close the modal after picking
    ///     (default true).
    ///   The whole picked row is kept in $("#Id").data("selectedRow") and
    ///   "mi:rowselected" (e, row) fires on the input.
    ///
    /// IMAGE BOX (ShowImageBox + ShowImageBrowseButton)
    /// Preview box above the input row. The text input receives the file
    /// NAME only (browsers never expose a real OS path to page JS); the
    /// File object is kept in memory — getModernInputImageFile("#Id").
    /// Events: mi:imagechange (e, file), mi:imageclear (e).
    ///
    /// FILE UPLOAD (ShowFileUploadButton)
    /// Opens the native file picker for any file type. Optional filters:
    ///   - FileUploadAccept: "pdf, docx", ".xlsx,.csv", "image/*",
    ///     "application/pdf" — mixed allowed; bare extensions get a ".".
    ///   - FileUploadMultiple: allow several files.
    ///   - FileUploadMaxSizeMB: per-file size limit.
    /// The picker's accept filter is only a hint (the user can switch to
    /// "All files"), so the JS re-validates every chosen file.
    /// Events: mi:fileupload (e, files[]), mi:filerejected (e, [{file,
    /// reason: "type"|"size"}]), mi:fileclear (e).
    /// Retrieve: getModernInputUploadFiles("#Id") / getModernInputUploadFile("#Id").
    /// Always validate type/size again on the server.
    /// </summary>
    [HtmlTargetElement("modern-input-with-search")]
    public class ModernInputWithSearch : TagHelper
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string Label { get; set; }
        public bool Mandatory { get; set; } = false;
        public int? MaxLength { get; set; }
        public string InputType { get; set; } = "text";              // "text", "int"/"number", "phone", or "currency"
        public string Placeholder { get; set; } = "";
        public string Watermark { get; set; }                        // alias for Placeholder; if both are set, Watermark wins
        public string Value { get; set; } = "";
        public bool IsReadOnly { get; set; } = false;
        public string TooltipText { get; set; }                      // shown on hover of the mandatory icon
        public bool ShowSearchButton { get; set; } = true;           // false hides the INSIDE search icon entirely
        public bool Disabled { get; set; } = false;                  // disables the input, all icons/buttons, image drop and image clear
        public string BorderRadius { get; set; }                     // e.g. "4" or "999"; bare numbers auto-get "px"; unset keeps default (pill)
        public string InputBorderRadius { get; set; }                // overrides BorderRadius
        public string InputHeight { get; set; }                      // e.g. "46" or "46px"
        public bool IsLeftLabel { get; set; } = false;               // true: label sits left of the input, vertically centered
        public bool HideLabel { get; set; } = false;                 // true: label markup is omitted even if Label is set
        public string LabelFontSize { get; set; } = "16px";          // e.g. "14" or "14px"
        public string LabelFontWeight { get; set; } = "600";         // e.g. "500", "600", "bold"
        public string MandatorySize { get; set; }                    // font size of the mandatory "*"
        public string SuffixText { get; set; }                       // red text beside the label, shown only when SuffixVisible is true
        public string SuffixFontSize { get; set; } = "14px";
        public string SuffixFontWeight { get; set; }
        public bool SuffixVisible { get; set; } = false;
        public string SearchIconColor { get; set; }                  // INSIDE magnifier: solid color or gradient
        public string SearchIconSize { get; set; }                   // e.g. "18" or "18px"; default 16px
        public string SearchIconBoxSize { get; set; } = "28px";      // hoverable round box around the INSIDE icon
        public string SearchIconHoverColor { get; set; }             // box background on hover
        public string SearchIconActiveColor { get; set; }            // box background while pressed

        // ----- Outside search button 1 -----
        public bool ShowOutsideSearchButton1 { get; set; } = false;
        public string OutsideSearchTooltip1 { get; set; }
        public string OutsideSearchIconColor1 { get; set; }          // solid color or gradient
        public string OutsideSearchIconSize1 { get; set; }           // default 16px
        public string OutsideSearchButtonSize1 { get; set; }         // default 40px
        public string OutsideSearchButtonColor1 { get; set; }        // default gray
        public string OutsideSearchHoverColor1 { get; set; }
        public string OutsideSearchActiveColor1 { get; set; }
        public string OutsideSearchPartialView1 { get; set; }        // e.g. "/Views/Shared/AddEditPartial/_add-edit-acDepositSlip-partial.cshtml"
        public string OutsideSearchModalTitle1 { get; set; }
        public string OutsideSearchTargetController1 { get; set; }
        public string OutsideSearchTargetAction1 { get; set; }
        public string OutsideSearchModalHeight1 { get; set; }        // e.g. "70%", "500px", "500"
        public string OutsideSearchModalWidth1 { get; set; }         // e.g. "60%", "800px", "800"
        public string OutsideSearchModalIcon1 { get; set; }          // Font Awesome 4.7 syntax, e.g. "fa fa-user"
        public string OutsideSearchSaveBtnId1 { get; set; }          // e.g. "btnSaveAgent"
        public int? OutsideSearchLoadDelay1 { get; set; }            // ms before the table data call, default 300
        public string OutsideSearchValueField1 { get; set; }         // table column copied into the input on row select, e.g. "ACGroupCode"
        public string OutsideSearchIdField1 { get; set; }            // optional key column, e.g. "ID"
        public string OutsideSearchIdTarget1 { get; set; }           // optional id of a hidden input that receives the key
        public bool OutsideSearchCloseOnSelect1 { get; set; } = true;
        public bool OutsideSearchHideSaveButton1 { get; set; } = false;  // true: no Save button in the modal for this button

        // ----- Outside search button 2 -----
        public bool ShowOutsideSearchButton2 { get; set; } = false;
        public string OutsideSearchTooltip2 { get; set; }
        public string OutsideSearchIconColor2 { get; set; }
        public string OutsideSearchIconSize2 { get; set; }
        public string OutsideSearchButtonSize2 { get; set; }
        public string OutsideSearchButtonColor2 { get; set; }
        public string OutsideSearchHoverColor2 { get; set; }
        public string OutsideSearchActiveColor2 { get; set; }
        public string OutsideSearchPartialView2 { get; set; }
        public string OutsideSearchModalTitle2 { get; set; }
        public string OutsideSearchTargetController2 { get; set; }
        public string OutsideSearchTargetAction2 { get; set; }
        public string OutsideSearchModalHeight2 { get; set; }
        public string OutsideSearchModalWidth2 { get; set; }
        public string OutsideSearchModalIcon2 { get; set; }
        public string OutsideSearchSaveBtnId2 { get; set; }
        public int? OutsideSearchLoadDelay2 { get; set; }
        public string OutsideSearchValueField2 { get; set; }
        public string OutsideSearchIdField2 { get; set; }
        public string OutsideSearchIdTarget2 { get; set; }
        public bool OutsideSearchCloseOnSelect2 { get; set; } = true;
        public bool OutsideSearchHideSaveButton2 { get; set; } = false;

        // ----- Image box + browse button -----
        public bool ShowImageBox { get; set; } = false;              // image preview box above the input row
        public string ImageBoxLabel { get; set; } = "No image";      // text under the placeholder icon
        public string ImageBoxWidth { get; set; }                    // default 280px
        public string ImageBoxHeight { get; set; }                   // default 170px
        public bool ShowImageBrowseButton { get; set; } = false;     // round button that opens the image picker
        public string ImageBrowseTooltip { get; set; }
        public string ImageBrowseIconColor { get; set; }
        public string ImageBrowseIconSize { get; set; }
        public string ImageBrowseButtonSize { get; set; }
        public string ImageBrowseButtonColor { get; set; }
        public string ImageBrowseHoverColor { get; set; }
        public string ImageBrowseActiveColor { get; set; }

        // ----- Generic file upload button (new) -----
        public bool ShowFileUploadButton { get; set; } = false;      // round button that opens the file picker for any file type
        public string FileUploadTooltip { get; set; }                // e.g. "Upload file"
        public string FileUploadAccept { get; set; }                 // unset = any file; e.g. "pdf, docx", ".xlsx,.csv", "image/*", "application/pdf"
        public bool FileUploadMultiple { get; set; } = false;        // allow selecting several files at once
        public double? FileUploadMaxSizeMB { get; set; }             // optional per-file size limit in MB
        public string FileUploadIconColor { get; set; }              // solid color or gradient
        public string FileUploadIconSize { get; set; }               // default 16px
        public string FileUploadButtonSize { get; set; }             // default 40px
        public string FileUploadButtonColor { get; set; }            // default gray
        public string FileUploadHoverColor { get; set; }
        public string FileUploadActiveColor { get; set; }

        // NOTE: cannot be named/bound as "data-field" — Razor tag helpers are not
        // allowed to bind to any data-* attribute (RZ3004). Use field-name="..."
        // in markup instead; it still renders out as data-field='...' on the
        // actual <input> below, which is what JS (e.g. GridBinder) targets.
        public string FieldName { get; set; }

        public override void Process(TagHelperContext context, TagHelperOutput output)
        {
            output.TagName = "div";
            output.Attributes.SetAttribute("class", IsLeftLabel
                ? "modern-input-wrapper mis-left-label"
                : "modern-input-wrapper");

            // =========================================================
            // Shared helpers
            // =========================================================

            // HTML-encodes anything placed into markup or an attribute.
            string Enc(string raw) => WebUtility.HtmlEncode(raw ?? "");

            // A bare number like "4" or "1.5" becomes "4px" / "1.5px";
            // anything with a unit passes through. Parsed with the
            // invariant culture so "1.5" works on any server locale.
            string NormalizeUnit(string raw)
            {
                if (string.IsNullOrWhiteSpace(raw)) return raw;
                var trimmed = raw.Trim();
                return double.TryParse(trimmed, NumberStyles.Float, CultureInfo.InvariantCulture, out _)
                    ? trimmed + "px"
                    : trimmed;
            }

            bool IsGradient(string value)
            {
                var v = value?.TrimStart() ?? "";
                return v.StartsWith("linear-gradient", StringComparison.OrdinalIgnoreCase)
                    || v.StartsWith("radial-gradient", StringComparison.OrdinalIgnoreCase)
                    || v.StartsWith("conic-gradient", StringComparison.OrdinalIgnoreCase)
                    || v.StartsWith("repeating-linear-gradient", StringComparison.OrdinalIgnoreCase)
                    || v.StartsWith("repeating-radial-gradient", StringComparison.OrdinalIgnoreCase)
                    || v.StartsWith("repeating-conic-gradient", StringComparison.OrdinalIgnoreCase);
            }

            // Adds "name: value;" to a style list only when value is set.
            void AddCss(List<string> list, string property, string value)
            {
                if (!string.IsNullOrWhiteSpace(value)) list.Add($"{property}: {value};");
            }

            // style='...' from a list of declarations, "" when empty.
            // Encoded so a quote in a config value can't break out of the
            // attribute; the browser decodes &quot; back to " before the
            // CSS is parsed, so url("data:...") masks still work.
            string StyleAttr(List<string> parts) =>
                parts.Count > 0 ? $"style='{Enc(string.Join(" ", parts))}'" : "";

            // name='value' only when value is set, "" otherwise.
            string OptAttr(string name, string value) =>
                !string.IsNullOrWhiteSpace(value) ? $"{name}='{Enc(value)}'" : "";

            // CSS url() holding a glyph's SVG as a data URI, used as a mask
            // so a gradient can paint the glyph's exact shape.
            string MaskUrl(string svg) =>
                $"url(\"data:image/svg+xml,{Uri.EscapeDataString(svg)}\")";

            // =========================================================
            // Glyphs
            // =========================================================

            // One definition per glyph, used for both the visible <svg> and
            // (in gradient mode) the mask source, so the two never drift.
            string MagnifierSvg(string strokeAttr) =>
                $@"<svg width='16' height='16' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
                        <circle cx='10.5' cy='10.5' r='6.5' stroke='{strokeAttr}' stroke-width='2.2' stroke-linecap='round'/>
                        <path d='M15.5 15.5L20 20' stroke='{strokeAttr}' stroke-width='2.2' stroke-linecap='round'/>
                    </svg>";

            // Folder/upload glyph for the image browse button.
            string BrowseSvg(string strokeAttr) =>
                $@"<svg width='16' height='16' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
                        <path d='M4 8a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z' stroke='{strokeAttr}' stroke-width='1.8' stroke-linejoin='round'/>
                        <path d='M12 12v5M9.5 14.5L12 12l2.5 2.5' stroke='{strokeAttr}' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/>
                    </svg>";

            // Paperclip glyph for the generic file upload button — distinct
            // from the folder glyph so the two can sit side by side.
            string PaperclipSvg(string strokeAttr) =>
                $@"<svg width='16' height='16' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
                        <path d='M20.5 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9' stroke='{strokeAttr}' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/>
                    </svg>";

            // Placeholder "picture" glyph for the empty image box.
            string ImagePlaceholderSvg() =>
                @"<svg width='48' height='48' viewBox='0 0 48 48' fill='none' xmlns='http://www.w3.org/2000/svg'>
                        <rect x='4' y='8' width='40' height='32' rx='1' stroke='#8a8f98' stroke-width='2.2'/>
                        <circle cx='15' cy='18' r='3.2' fill='#8a8f98'/>
                        <path d='M6 34L18 22L26 30L34 20L44 32' stroke='#8a8f98' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/>
                    </svg>";

            // Small "x" for the image box's clear control.
            string ClearGlyphSvg() =>
                @"<svg width='12' height='12' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'>
                        <path d='M4 4L12 12M12 4L4 12' stroke='currentColor' stroke-width='1.8' stroke-linecap='round'/>
                    </svg>";

            // =========================================================
            // Common values
            // =========================================================
            var encId = Enc(Id);
            var ariaDisabledAttr = Disabled ? "aria-disabled='true'" : "";

            // =========================================================
            // Label: text -> mandatory "*" -> optional red suffix
            // =========================================================
            var labelStyle = new List<string>();
            AddCss(labelStyle, "font-size", NormalizeUnit(LabelFontSize));
            AddCss(labelStyle, "font-weight", LabelFontWeight);

            var mandatoryStyle = new List<string>();
            AddCss(mandatoryStyle, "font-size", NormalizeUnit(MandatorySize));

            var mandatoryHtml = Mandatory
                ? $" <span class='mi-required' {StyleAttr(mandatoryStyle)}>*</span>"
                : "";

            var suffixStyle = new List<string>();
            AddCss(suffixStyle, "font-size", NormalizeUnit(SuffixFontSize));
            AddCss(suffixStyle, "font-weight", SuffixFontWeight);

            // Gated on SuffixVisible, not just on text being present, so a
            // page can set SuffixText once and toggle it per render.
            var suffixHtml = (SuffixVisible && !string.IsNullOrWhiteSpace(SuffixText))
                ? $" <span class='mis-suffix-label' {StyleAttr(suffixStyle)}>{Enc(SuffixText)}</span>"
                : "";

            var labelHtml = (!HideLabel && !string.IsNullOrWhiteSpace(Label)) ? $@"
                <label class='mi-label' for='{encId}' {StyleAttr(labelStyle)}>
                    {Enc(Label)}{mandatoryHtml}{suffixHtml}
                </label>" : "";

            // =========================================================
            // Input attributes
            // =========================================================
            var maxLengthAttr = MaxLength.HasValue ? $"maxlength='{MaxLength.Value}'" : "";
            var readOnlyAttr = IsReadOnly ? "readonly" : "";
            var disabledAttr = Disabled ? "disabled" : "";
            var normalizedType = (InputType ?? "text").Trim().ToLowerInvariant();

            string inputModeAttr;
            switch (normalizedType)
            {
                case "int":
                case "number":
                    inputModeAttr = "inputmode='numeric' pattern='[0-9]*'";
                    break;
                case "phone":
                    inputModeAttr = "inputmode='tel'";
                    break;
                case "currency":
                    inputModeAttr = "inputmode='decimal'";
                    break;
                default:
                    inputModeAttr = "";
                    break;
            }

            var tooltipAttr = Mandatory ? OptAttr("data-tooltip", TooltipText) : "";
            var dataFieldAttr = OptAttr("data-field", FieldName);
            var resolvedPlaceholder = !string.IsNullOrEmpty(Watermark) ? Watermark : Placeholder;

            // =========================================================
            // Row-scoped CSS variables (input + INSIDE icon)
            // =========================================================
            var rowStyle = new List<string>();
            AddCss(rowStyle, "--mis-input-radius", NormalizeUnit(
                !string.IsNullOrWhiteSpace(InputBorderRadius) ? InputBorderRadius : BorderRadius));
            AddCss(rowStyle, "--mis-input-height", NormalizeUnit(InputHeight));
            AddCss(rowStyle, "--mis-icon-size", NormalizeUnit(SearchIconSize));
            AddCss(rowStyle, "--mis-icon-box-size", NormalizeUnit(SearchIconBoxSize));
            AddCss(rowStyle, "--mis-icon-hover-bg", SearchIconHoverColor);
            AddCss(rowStyle, "--mis-icon-active-bg", SearchIconActiveColor);

            var isGradientIcon = IsGradient(SearchIconColor);
            if (isGradientIcon)
            {
                AddCss(rowStyle, "--mis-icon-gradient", SearchIconColor);
                AddCss(rowStyle, "--mis-icon-mask", MaskUrl(MagnifierSvg("black")));
            }
            else
            {
                AddCss(rowStyle, "--mis-icon-color", SearchIconColor);
            }

            // =========================================================
            // INSIDE search icon
            // The glyph sits in an inner .mis-glyph span. In gradient mode
            // the mask + gradient go on that inner span only, so the outer
            // round box keeps its background and hover/press states.
            // =========================================================
            var searchIconHtml = ShowSearchButton ? $@"
                <span class='mis-search-icon{(isGradientIcon ? " mis-gradient-icon" : "")}' data-target='{encId}' role='button' tabindex='0' aria-label='Search' {ariaDisabledAttr}>
                    <span class='mis-glyph'>{MagnifierSvg("currentColor")}</span>
                </span>" : "";

            // =========================================================
            // OUTSIDE round buttons (search 1, search 2, browse, upload)
            // One builder so all four share identical markup shape; only
            // the per-button values differ. "action" becomes data-action,
            // which the JS uses to route the click (search / browse /
            // upload). Modal attributes are emitted only when set.
            // =========================================================
            string BuildOutsideButton(
                bool show,
                string eventName,
                string action,
                Func<string, string> glyph,
                string tooltip,
                string iconColor,
                string iconSize,
                string buttonSize,
                string buttonColor,
                string hoverColor,
                string activeColor,
                string partialView = null,
                string modalTitle = null,
                string targetController = null,
                string targetAction = null,
                string modalHeight = null,
                string modalWidth = null,
                string modalIcon = null,
                string saveBtnId = null,
                int? loadDelay = null,
                string valueField = null,
                string idField = null,
                string idTarget = null,
                bool closeOnSelect = true,
                bool hideSaveButton = false)
            {
                if (!show) return "";

                var btnStyle = new List<string>();
                AddCss(btnStyle, "--mis-outside-btn-size", NormalizeUnit(buttonSize));
                AddCss(btnStyle, "--mis-outside-icon-size", NormalizeUnit(iconSize));
                AddCss(btnStyle, "--mis-outside-btn-bg", buttonColor);
                AddCss(btnStyle, "--mis-outside-btn-hover-bg", hoverColor);
                AddCss(btnStyle, "--mis-outside-btn-active-bg", activeColor);

                var btnIsGradient = IsGradient(iconColor);
                if (btnIsGradient)
                {
                    AddCss(btnStyle, "--mis-outside-icon-gradient", iconColor);
                    AddCss(btnStyle, "--mis-outside-icon-mask", MaskUrl(glyph("black")));
                }
                else
                {
                    AddCss(btnStyle, "--mis-outside-icon-color", iconColor);
                }

                var ariaLabelFallback = action == "browse" ? "Browse image"
                                      : action == "upload" ? "Upload file"
                                      : "Search";
                var ariaLabel = !string.IsNullOrWhiteSpace(tooltip) ? tooltip : ariaLabelFallback;

                // Only data-tooltip is used (never title="...") — having
                // both shows two tooltips at once.
                var extraAttrs = string.Join(" ", new[]
                {
                    OptAttr("data-tooltip", tooltip),
                    StyleAttr(btnStyle),
                    OptAttr("data-partial-view", partialView),
                    OptAttr("data-modal-title", modalTitle),
                    OptAttr("data-controller", targetController),
                    OptAttr("data-action-name", targetAction),
                    OptAttr("data-modal-height", NormalizeUnit(modalHeight)),
                    OptAttr("data-modal-width", NormalizeUnit(modalWidth)),
                    OptAttr("data-modal-icon", modalIcon),
                    OptAttr("data-save-btn-id", saveBtnId),
                    (loadDelay.HasValue && loadDelay.Value >= 0)
                        ? OptAttr("data-load-delay", loadDelay.Value.ToString(CultureInfo.InvariantCulture))
                        : "",
                    OptAttr("data-value-field", valueField),
                    OptAttr("data-id-field", idField),
                    OptAttr("data-id-target", idTarget),
                    closeOnSelect ? "" : "data-close-on-select='false'",
                    hideSaveButton ? "data-hide-save-btn='true'" : "",
                    ariaDisabledAttr
                }.Where(a => a.Length > 0));

                return $@"
                    <span class='mis-outside-search-btn{(btnIsGradient ? " mis-outside-gradient-icon" : "")}'
                          data-target='{encId}' data-search-event='{eventName}' data-action='{action}'
                          role='button' tabindex='0' aria-label='{Enc(ariaLabel)}' {extraAttrs}>
                        <span class='mis-glyph'>{glyph("currentColor")}</span>
                    </span>";
            }

            var outsideButton1Html = BuildOutsideButton(
                ShowOutsideSearchButton1, "mi:search1", "search", MagnifierSvg, OutsideSearchTooltip1,
                OutsideSearchIconColor1, OutsideSearchIconSize1, OutsideSearchButtonSize1,
                OutsideSearchButtonColor1, OutsideSearchHoverColor1, OutsideSearchActiveColor1,
                OutsideSearchPartialView1, OutsideSearchModalTitle1, OutsideSearchTargetController1, OutsideSearchTargetAction1,
                OutsideSearchModalHeight1, OutsideSearchModalWidth1, OutsideSearchModalIcon1, OutsideSearchSaveBtnId1, OutsideSearchLoadDelay1,
                OutsideSearchValueField1, OutsideSearchIdField1, OutsideSearchIdTarget1, OutsideSearchCloseOnSelect1, OutsideSearchHideSaveButton1);

            var outsideButton2Html = BuildOutsideButton(
                ShowOutsideSearchButton2, "mi:search2", "search", MagnifierSvg, OutsideSearchTooltip2,
                OutsideSearchIconColor2, OutsideSearchIconSize2, OutsideSearchButtonSize2,
                OutsideSearchButtonColor2, OutsideSearchHoverColor2, OutsideSearchActiveColor2,
                OutsideSearchPartialView2, OutsideSearchModalTitle2, OutsideSearchTargetController2, OutsideSearchTargetAction2,
                OutsideSearchModalHeight2, OutsideSearchModalWidth2, OutsideSearchModalIcon2, OutsideSearchSaveBtnId2, OutsideSearchLoadDelay2,
                OutsideSearchValueField2, OutsideSearchIdField2, OutsideSearchIdTarget2, OutsideSearchCloseOnSelect2, OutsideSearchHideSaveButton2);

            var browseButtonHtml = BuildOutsideButton(
                ShowImageBrowseButton, "mi:browse", "browse", BrowseSvg, ImageBrowseTooltip,
                ImageBrowseIconColor, ImageBrowseIconSize, ImageBrowseButtonSize,
                ImageBrowseButtonColor, ImageBrowseHoverColor, ImageBrowseActiveColor);

            var uploadButtonHtml = BuildOutsideButton(
                ShowFileUploadButton, "mi:fileupload", "upload", PaperclipSvg, FileUploadTooltip,
                FileUploadIconColor, FileUploadIconSize, FileUploadButtonSize,
                FileUploadButtonColor, FileUploadHoverColor, FileUploadActiveColor);

            // =========================================================
            // Hidden native picker for the file upload button
            // =========================================================

            // "pdf, docx" -> ".pdf,.docx"; MIME types ("image/*",
            // "application/pdf") and dotted extensions pass through.
            string NormalizeAccept(string raw)
            {
                if (string.IsNullOrWhiteSpace(raw)) return "";
                var parts = raw.Split(',')
                    .Select(p => p.Trim())
                    .Where(p => p.Length > 0)
                    .Select(p => p.Contains("/") || p.StartsWith(".") ? p : "." + p);
                return string.Join(",", parts);
            }

            var normalizedAccept = NormalizeAccept(FileUploadAccept);

            // data-accept duplicates accept so the JS can re-validate the
            // chosen files (accept alone is only a hint to the dialog).
            var uploadInputAttrs = string.Join(" ", new[]
            {
                OptAttr("accept", normalizedAccept),
                OptAttr("data-accept", normalizedAccept),
                FileUploadMultiple ? "multiple" : "",
                (FileUploadMaxSizeMB.HasValue && FileUploadMaxSizeMB.Value > 0)
                    ? $"data-max-size-mb='{FileUploadMaxSizeMB.Value.ToString(CultureInfo.InvariantCulture)}'"
                    : ""
            }.Where(a => a.Length > 0));

            var uploadInputHtml = ShowFileUploadButton
                ? $"<input type='file' class='mis-file-upload-input' data-target='{encId}' {uploadInputAttrs} style='display:none;' />"
                : "";

            // =========================================================
            // Image box (rendered ABOVE the label + input row)
            // data-disabled blocks drag-drop and the clear "x" when the
            // control is disabled.
            // =========================================================
            var imageBoxStyle = new List<string>();
            AddCss(imageBoxStyle, "--mis-imagebox-width", NormalizeUnit(ImageBoxWidth));
            AddCss(imageBoxStyle, "--mis-imagebox-height", NormalizeUnit(ImageBoxHeight));

            var imageBoxHtml = ShowImageBox ? $@"
                <div class='mis-image-box-wrap'>
                    <div class='mis-image-box' data-target='{encId}' {StyleAttr(imageBoxStyle)} {(Disabled ? "data-disabled='true'" : "")}>
                        <img class='mis-image-box-preview' alt='' style='display:none;' />
                        <div class='mis-image-box-placeholder'>
                            {ImagePlaceholderSvg()}
                            <span>{Enc(ImageBoxLabel ?? "No image")}</span>
                        </div>
                        <span class='mis-image-box-clear' role='button' tabindex='0' aria-label='Remove image' style='display:none;'>
                            {ClearGlyphSvg()}
                        </span>
                    </div>
                    <input type='file' class='mis-image-file-input' data-target='{encId}' accept='image/*' style='display:none;' />
                </div>" : "";

            // =========================================================
            // Final markup
            // =========================================================
            output.Content.SetHtmlContent($@"
                {imageBoxHtml}
                {labelHtml}
                <div class='mis-row' {StyleAttr(rowStyle)}>
                    <div class='mi-input-wrap mis-has-search' data-input-type='{Enc(normalizedType)}' data-mandatory='{Mandatory.ToString().ToLowerInvariant()}' {(Disabled ? "data-disabled='true'" : "")}>
                        <span class='mi-icon-left'>
                            <svg width='15' height='15' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'>
                                <path d='M11.5 2.5L13.5 4.5L5 13H3V11L11.5 2.5Z' stroke='currentColor' stroke-width='1.3' stroke-linejoin='round'/>
                            </svg>
                        </span>
                        <input type='text' id='{encId}' name='{Enc(Name)}' class='mi-input'
                               placeholder='{Enc(resolvedPlaceholder)}' value='{Enc(Value)}' {maxLengthAttr} {inputModeAttr} {readOnlyAttr} {disabledAttr} {dataFieldAttr} />
                        <span class='mi-icon-error' style='display:none;' {tooltipAttr}>
                            <svg width='12' height='12' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'>
                                <circle cx='8' cy='8' r='8' fill='currentColor'/>
                                <rect x='7.25' y='4' width='1.5' height='5' rx='0.75' fill='white'/>
                                <circle cx='8' cy='11' r='0.9' fill='white'/>
                            </svg>
                        </span>
                        {searchIconHtml}
                    </div>
                    {outsideButton1Html}
                    {outsideButton2Html}
                    {browseButtonHtml}
                    {uploadButtonHtml}
                    {uploadInputHtml}
                </div>
            ");
        }
    }
}