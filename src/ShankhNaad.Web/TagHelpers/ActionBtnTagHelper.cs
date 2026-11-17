using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Text.Encodings.Web;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Razor.TagHelpers;


namespace ShankhNaad.Web.TagHelpers
{
    [HtmlTargetElement("action-btn", ParentTag = "action-header")]
    public class ActionBtnTagHelper : TagHelper
    {
        public string Text { get; set; } = string.Empty;
        public string IconCss { get; set; } = string.Empty;
        public string IconColor { get; set; } = "#333333";
        public string Tooltip { get; set; } = string.Empty;
        public string Action { get; set; } = string.Empty;
        public string OnClick { get; set; } = string.Empty;
        public string CssClass { get; set; } = string.Empty;
        public bool IsVisible { get; set; } = true;
        public bool HasSeparatorAfter { get; set; } = false;

        // Route this button to a real controller/action, e.g.
        // target-controller="Department" target-action="AddEdit"
        // renders as data-controller / data-action-name on the button, so
        // your existing $(this).data(...) switch handler can build
        // "/Department/AddEdit" without hardcoding it per page. Optional —
        // leave unset for buttons handled purely by data-action + JS switch.
        public string TargetController { get; set; } = string.Empty;
        public string TargetAction { get; set; } = string.Empty;

        // Optional static payload alongside the controller/action route —
        // e.g. a partial-view path to hand to FetchFullModalAndShow, so a
        // button can carry BOTH: a path for opening a modal AND a
        // controller/action for posting the save. Renders as data-partial-view.
        public string PartialView { get; set; } = string.Empty;

        public override void Process(TagHelperContext context, TagHelperOutput output)
        {
            output.SuppressOutput();
            if (IsVisible && context.Items["ActionButtons"] is List<ButtonModel> list)
            {
                list.Add(new ButtonModel
                {
                    Text = Text,
                    IconCss = IconCss,
                    IconColor = IconColor,
                    Tooltip = Tooltip,
                    Action = Action,
                    OnClick = OnClick,
                    CssClass = CssClass,
                    HasSeparatorAfter = HasSeparatorAfter,
                    TargetController = TargetController,
                    TargetAction = TargetAction,
                    PartialView = PartialView
                });
            }
        }
    }

    public class ButtonModel
    {
        public string Text { get; set; } = string.Empty;
        public string IconCss { get; set; } = string.Empty;
        public string IconColor { get; set; } = "#333333";
        public string Tooltip { get; set; } = string.Empty;
        public string Action { get; set; } = string.Empty;
        public string OnClick { get; set; } = string.Empty;
        public string CssClass { get; set; } = string.Empty;
        public bool HasSeparatorAfter { get; set; } = false;
        public bool IsImportUpload { get; set; } = false;
        public string TargetController { get; set; } = string.Empty;
        public string TargetAction { get; set; } = string.Empty;
        public string PartialView { get; set; } = string.Empty;
    }

    [HtmlTargetElement("action-header")]
    [RestrictChildren("action-btn")]
    public class ActionHeaderTagHelper : TagHelper
    {
        public string Heading { get; set; } = string.Empty;
        public string Subtitle { get; set; } = string.Empty;
        public int HeadingFontSize { get; set; } = 15;
        public string HeadingColor { get; set; } = "#101828";

        public string LeftIconCss { get; set; } = string.Empty;
        public int LeftIconSize { get; set; } = 30;
        public string LeftIconColor { get; set; } = "#005D8A";

        public string LeftIconMarginLeft { get; set; } = "3px";
        public string LeftIconMarginRight { get; set; } = "14px";

        public string? LeftIconGradientStart { get; set; } = "#006BF7";
        public string? LeftIconGradientMid { get; set; } = "#800080";
        public string? LeftIconGradientEnd { get; set; } = "#F000BC";
        public int LeftIconGradientAngle { get; set; } = 5;

        public string BackgroundColor { get; set; } = "#FFFFFF";
        public string Padding { get; set; } = "6px 12px";
        public string BoxShadow { get; set; } = "0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -12px rgba(15,23,42,0.10)";

        public bool AnimateHeadingEntrance { get; set; } = true;
        public int HeadingEntranceDistance { get; set; } = 40;
        public double HeadingEntranceDurationSec { get; set; } = 0.7;
        public int HeadingEntranceDelayMs { get; set; } = 0;

        // ───────────── Mobile / responsive ─────────────
        // At or below this width (px) the buttons hide behind a hamburger (☰) button.
        // Tapping it opens a small popup with ALL buttons in ONE horizontal row
        // (never wraps — if the row is wider than the screen it swipes sideways).
        public int MobileBreakpoint { get; set; } = 768;
        // At or below this width (px) extra-compact sizing is applied (small phones).
        public int SmallBreakpoint { get; set; } = 420;
        public string MobilePadding { get; set; } = "8px 10px";
        // Heading size on mobile; null = same as HeadingFontSize.
        public int? MobileHeadingFontSize { get; set; }

        public string MobileMenuIcon { get; set; } = "bi bi-list";
        public string MobileMenuCloseIcon { get; set; } = "bi bi-x-lg";
        public string MobileMenuColor { get; set; } = "#101828";
        public string MobileMenuTooltip { get; set; } = "Actions";
        // Close the popup automatically after a button inside it is tapped.
        public bool MobileMenuCloseOnAction { get; set; } = true;
        // Show icons only inside the popup (labels still read by screen readers via aria-label).
        public bool MobileHideLabels { get; set; } = false;

        public bool ShowRefresh { get; set; } = true;
        public string RefreshText { get; set; } = "Refresh";
        public string RefreshIcon { get; set; } = "bi bi-arrow-counterclockwise";
        public string RefreshColor { get; set; } = "#008000";
        public string RefreshOnClick { get; set; } = string.Empty;
        public string RefreshTargetController { get; set; } = string.Empty;
        public string RefreshTargetAction { get; set; } = string.Empty;
        public string RefreshPartialView { get; set; } = string.Empty;

        public bool ShowAdd { get; set; } = true;
        public string AddText { get; set; } = "Add";
        public string AddIcon { get; set; } = "bi bi-plus-lg";
        public string AddColor { get; set; } = "#0066B2";
        public string AddOnClick { get; set; } = string.Empty;
        public string AddTargetController { get; set; } = string.Empty;
        public string AddTargetAction { get; set; } = string.Empty;
        // Shared with Edit — both buttons open the same modal partial, so
        // one property covers both instead of two that would always match.
        // Renders as data-partial-view on both the Add and Edit buttons.
        public string AddEditPartialView { get; set; } = string.Empty;

        public bool ShowEdit { get; set; } = true;
        public string EditText { get; set; } = "Edit";
        public string EditIcon { get; set; } = "bi bi-pencil-fill";
        public string EditColor { get; set; } = "#FF4500";
        public string EditOnClick { get; set; } = string.Empty;
        public string EditTargetController { get; set; } = string.Empty;
        public string EditTargetAction { get; set; } = string.Empty;

        public bool ShowDelete { get; set; } = true;
        public string DeleteText { get; set; } = "Delete";
        public string DeleteIcon { get; set; } = "bi bi-trash3-fill";
        public string DeleteColor { get; set; } = "#800000";
        public string DeleteOnClick { get; set; } = string.Empty;
        public string DeleteTargetController { get; set; } = string.Empty;
        public string DeleteTargetAction { get; set; } = string.Empty;
        public string DeletePartialView { get; set; } = string.Empty;

        public bool ShowImport { get; set; } = true;
        public string ImportText { get; set; } = "Import";
        public string ImportIcon { get; set; } = "bi bi-file-earmark-arrow-up-fill";
        public string ImportColor { get; set; } = "#6f42c1";
        public string ImportOnClick { get; set; } = string.Empty;
        public string ImportTargetController { get; set; } = string.Empty;
        public string ImportTargetAction { get; set; } = string.Empty;
        public string ImportPartialView { get; set; } = string.Empty;

        public string ImportUploadUrl { get; set; } = string.Empty;
        public string ImportAccept { get; set; } = ".xlsx,.xls,.csv,.pdf";
        public bool ImportAllowMultiple { get; set; } = false;
        public string ImportOnSuccess { get; set; } = string.Empty;
        public string ImportOnError { get; set; } = string.Empty;

        public bool ShowExport { get; set; } = true;
        public string ExportText { get; set; } = "Export";
        public string ExportIcon { get; set; } = "bi bi-file-earmark-arrow-down-fill";
        public string ExportColor { get; set; } = "#0d6efd";
        public string ExportOnClick { get; set; } = string.Empty;
        public string ExportTargetController { get; set; } = string.Empty;
        public string ExportTargetAction { get; set; } = string.Empty;
        public string ExportPartialView { get; set; } = string.Empty;

        public bool ShowSave { get; set; } = true;
        public string SaveText { get; set; } = "Save";
        public string SaveIcon { get; set; } = "bi bi-floppy-fill";
        public string SaveColor { get; set; } = "#198754";
        public string SaveOnClick { get; set; } = string.Empty;
        public string SaveTargetController { get; set; } = string.Empty;
        public string SaveTargetAction { get; set; } = string.Empty;
        public string SavePartialView { get; set; } = string.Empty;

        public bool ShowSubmit { get; set; } = true;
        public string SubmitText { get; set; } = "Submit";
        public string SubmitIcon { get; set; } = "bi bi-check-circle-fill";
        public string SubmitColor { get; set; } = "#20c997";
        public string SubmitOnClick { get; set; } = string.Empty;
        public string SubmitTargetController { get; set; } = string.Empty;
        public string SubmitTargetAction { get; set; } = string.Empty;
        public string SubmitPartialView { get; set; } = string.Empty;

        public bool ShowPrint { get; set; } = true;
        public string PrintText { get; set; } = "Print";
        public string PrintIcon { get; set; } = "bi bi-printer-fill";
        public string PrintColor { get; set; } = "#0000FF";
        public string PrintOnClick { get; set; } = string.Empty;
        public string PrintTargetController { get; set; } = string.Empty;
        public string PrintTargetAction { get; set; } = string.Empty;
        public string PrintPartialView { get; set; } = string.Empty;

        public override async Task ProcessAsync(TagHelperContext context, TagHelperOutput output)
        {
            var customButtons = new List<ButtonModel>();
            context.Items["ActionButtons"] = customButtons;

            await output.GetChildContentAsync();

            output.TagName = "div";
            output.TagMode = TagMode.StartTagAndEndTag;

            var customId = output.Attributes.ContainsName("id")
                ? output.Attributes["id"].Value?.ToString()
                : null;

            var uniqueId = !string.IsNullOrWhiteSpace(customId)
                ? customId
                : "act-hdr-" + Guid.NewGuid().ToString("N")[..8];

            output.Attributes.SetAttribute("id", uniqueId);
            output.Attributes.SetAttribute("class", $"action-header-wrapper {uniqueId}");

            var allButtons = new List<ButtonModel>();

            if (ShowRefresh) allButtons.Add(new ButtonModel { Action = "refresh", Text = RefreshText, IconCss = RefreshIcon, IconColor = RefreshColor, OnClick = RefreshOnClick, Tooltip = RefreshText, TargetController = RefreshTargetController, TargetAction = RefreshTargetAction, PartialView = RefreshPartialView });
            if (ShowAdd) allButtons.Add(new ButtonModel { Action = "add", Text = AddText, IconCss = AddIcon, IconColor = AddColor, OnClick = AddOnClick, Tooltip = AddText, TargetController = AddTargetController, TargetAction = AddTargetAction, PartialView = AddEditPartialView });
            if (ShowEdit) allButtons.Add(new ButtonModel { Action = "edit", Text = EditText, IconCss = EditIcon, IconColor = EditColor, OnClick = EditOnClick, Tooltip = EditText, TargetController = EditTargetController, TargetAction = EditTargetAction, PartialView = AddEditPartialView });
            if (ShowDelete) allButtons.Add(new ButtonModel { Action = "delete", Text = DeleteText, IconCss = DeleteIcon, IconColor = DeleteColor, OnClick = DeleteOnClick, Tooltip = DeleteText, TargetController = DeleteTargetController, TargetAction = DeleteTargetAction, PartialView = DeletePartialView });
            if (ShowImport) allButtons.Add(new ButtonModel { Action = "import", Text = ImportText, IconCss = ImportIcon, IconColor = ImportColor, OnClick = ImportOnClick, Tooltip = ImportText, IsImportUpload = !string.IsNullOrWhiteSpace(ImportUploadUrl), TargetController = ImportTargetController, TargetAction = ImportTargetAction, PartialView = ImportPartialView });
            if (ShowExport) allButtons.Add(new ButtonModel { Action = "export", Text = ExportText, IconCss = ExportIcon, IconColor = ExportColor, OnClick = ExportOnClick, Tooltip = ExportText, TargetController = ExportTargetController, TargetAction = ExportTargetAction, PartialView = ExportPartialView });
            if (ShowSave) allButtons.Add(new ButtonModel { Action = "save", Text = SaveText, IconCss = SaveIcon, IconColor = SaveColor, OnClick = SaveOnClick, Tooltip = SaveText, TargetController = SaveTargetController, TargetAction = SaveTargetAction, PartialView = SavePartialView });
            if (ShowSubmit) allButtons.Add(new ButtonModel { Action = "submit", Text = SubmitText, IconCss = SubmitIcon, IconColor = SubmitColor, OnClick = SubmitOnClick, Tooltip = SubmitText, TargetController = SubmitTargetController, TargetAction = SubmitTargetAction, PartialView = SubmitPartialView });

            if (ShowPrint && allButtons.Count > 0)
            {
                allButtons[^1].HasSeparatorAfter = true;
            }

            if (ShowPrint) allButtons.Add(new ButtonModel { Action = "print", Text = PrintText, IconCss = PrintIcon, IconColor = PrintColor, OnClick = PrintOnClick, Tooltip = PrintText, TargetController = PrintTargetController, TargetAction = PrintTargetAction, PartialView = PrintPartialView });

            allButtons.AddRange(customButtons);

            var iconGradientCss = BuildGradient(LeftIconGradientAngle, LeftIconGradientStart, LeftIconGradientMid, LeftIconGradientEnd);
            var useIconGradient = !string.IsNullOrWhiteSpace(LeftIconGradientStart) && !string.IsNullOrWhiteSpace(LeftIconGradientEnd);

            // Responsive settings
            var hasButtons = allButtons.Count > 0;
            var mobileHeadingSize = MobileHeadingFontSize ?? HeadingFontSize;
            var smallIconSize = Math.Max(14, LeftIconSize - 2);
            var mobileBp = Math.Max(0, MobileBreakpoint);
            var smallBp = Math.Max(0, SmallBreakpoint);
            var menuColor = string.IsNullOrWhiteSpace(MobileMenuColor) ? "#101828" : MobileMenuColor;

            var sb = new StringBuilder();

            sb.Append($@"
<style>
  @keyframes global-hdr-ripple {{
    from {{ transform: scale(0); opacity: 0.35; }}
    to   {{ transform: scale(2.6); opacity: 0; }}
  }}

  #{uniqueId} {{
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 16px;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    background: {BackgroundColor};
    padding: {Padding};
    border-radius: 12px;
    box-sizing: border-box;
    position: relative;
    border: 1px solid rgba(15, 23, 42, 0.06);
    box-shadow: {BoxShadow};
  }}
  #{uniqueId} *, #{uniqueId} *::before, #{uniqueId} *::after {{
    box-sizing: border-box;
  }}
  #{uniqueId} .hdr-left {{
    display: flex;
    align-items: center;
    gap: 14px;
    flex: 1 1 auto;
    min-width: 0;
    {(AnimateHeadingEntrance ? $@"
    opacity: 0;
    animation: {uniqueId}-heading-enter {HeadingEntranceDurationSec.ToString(CultureInfo.InvariantCulture)}s cubic-bezier(0.16, 1, 0.3, 1) {HeadingEntranceDelayMs}ms forwards;" : "")}
  }}
  {(AnimateHeadingEntrance ? $@"
  @keyframes {uniqueId}-heading-enter {{
    from {{ opacity: 0; transform: translateX({HeadingEntranceDistance}px); }}
    to   {{ opacity: 1; transform: translateX(0); }}
  }}" : "")}

  #{uniqueId} .hdr-icon-wrap {{
    position: relative;
    width: {LeftIconSize + 18}px;
    height: {LeftIconSize + 18}px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-left: {LeftIconMarginLeft};
    margin-right: {LeftIconMarginRight};
  }}
  {(useIconGradient ? $@"
  #{uniqueId} .hdr-icon-wrap::before {{
    content: """";
    position: absolute;
    inset: -3px;
    border-radius: 12px;
    background: {iconGradientCss};
    background-size: 220% 220%;
    opacity: 0.16;
    filter: blur(6px);
    animation: {uniqueId}-glow-drift 6s ease-in-out infinite;
    z-index: 0;
  }}" : "")}
  #{uniqueId} .hdr-left i.hdr-main-icon {{
    position: relative;
    z-index: 1;
    font-size: {LeftIconSize}px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    {(useIconGradient ? $@"
    background-image: {iconGradientCss};
    background-size: 220% 220%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: {uniqueId}-glow-drift 6s ease-in-out infinite;" : $"color: {LeftIconColor};")}
  }}
  @keyframes {uniqueId}-glow-drift {{
    0%, 100% {{ background-position: 0% 50%; }}
    50% {{ background-position: 100% 50%; }}
  }}

  #{uniqueId} .hdr-title-wrap {{
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }}
  #{uniqueId} .hdr-title {{
    font-size: {HeadingFontSize}px;
    color: {HeadingColor};
    font-weight: 650;
    margin: 0;
    letter-spacing: -0.01em;
    display: inline-block;
    width: fit-content;
    max-width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: opacity 0.3s ease;
  }}
  #{uniqueId} .hdr-subtitle {{
    font-size: 12px;   /* was 10px: a little larger for the report subtitles */
    color: #94A0B3;
    font-weight: 500;
    max-width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }}

  #{uniqueId} .hdr-right {{
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 6px;
    padding: 2px;
    min-width: 0;
  }}

  /* Hamburger toggle — hidden on desktop */
  #{uniqueId} .hdr-menu-toggle {{
    display: none;
  }}

  #{uniqueId} .hdr-btn {{
    position: relative;
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: linear-gradient(180deg, #FFFFFF 0%, #FAFBFC 100%);
    border: 1px solid rgba(15, 23, 42, 0.3);
    border-radius: 7px;
    padding: 4px 9px;
    min-width: 44px;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    overflow: hidden;
    box-shadow: 0 1px 1px rgba(15,23,42,0.04), inset 0 1px 0 rgba(255,255,255,0.9);
    transition: transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.28s cubic-bezier(0.34, 1.56, 0.64, 1), border-color 0.25s ease, background 0.25s ease;
    opacity: 0;
    animation: {uniqueId}-btn-enter 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }}
  #{uniqueId} .hdr-btn:focus-visible {{
    outline: 2px solid color-mix(in srgb, var(--btn-color) 60%, transparent);
    outline-offset: 2px;
  }}
  #{uniqueId} .hdr-btn::before {{
    content: """";
    position: absolute;
    inset: 0;
    background: linear-gradient(120deg, transparent 30%, color-mix(in srgb, var(--btn-color) 18%, transparent) 50%, transparent 70%);
    background-size: 250% 100%;
    background-position: 150% 0;
    opacity: 0;
    transition: opacity 0.25s ease;
    pointer-events: none;
  }}

  /* Hover effects only on devices with a real mouse — avoids sticky hover on touch */
  @media (hover: hover) and (pointer: fine) {{
    #{uniqueId} .hdr-btn:hover {{
      border-color: color-mix(in srgb, var(--btn-color) 45%, rgba(15,23,42,0.10));
      transform: translateY(-3px);
      box-shadow: 0 10px 20px -6px color-mix(in srgb, var(--btn-color) 28%, transparent), 0 3px 8px -2px rgba(15,23,42,0.08), inset 0 1px 0 rgba(255,255,255,0.9);
    }}
    #{uniqueId} .hdr-btn:hover::before {{
      opacity: 1;
      animation: {uniqueId}-sheen-sweep 0.9s ease forwards;
    }}
    #{uniqueId} .hdr-btn:hover i {{
      transform: scale(1.16) rotate(-3deg);
    }}
  }}
  @keyframes {uniqueId}-sheen-sweep {{
    from {{ background-position: 150% 0; }}
    to   {{ background-position: -50% 0; }}
  }}
  #{uniqueId} .hdr-btn:active {{
    transform: translateY(-1px) scale(0.96);
    box-shadow: 0 2px 6px -2px color-mix(in srgb, var(--btn-color) 30%, transparent), inset 0 1px 0 rgba(255,255,255,0.7);
  }}
  #{uniqueId} .hdr-btn.is-pressed {{
    transform: translateY(0px) scale(0.92) !important;
    transition: transform 0.12s cubic-bezier(0.4, 0, 0.2, 1) !important;
  }}
  #{uniqueId} .hdr-btn i {{
    position: relative;
    z-index: 1;
    font-size: 16px;
    line-height: 1;
    margin-bottom: 3px;
    font-weight: 700;
    color: var(--btn-color);
    display: inline-block;
    transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  }}
  #{uniqueId} .hdr-btn span {{
    position: relative;
    z-index: 1;
    font-size: 9px;
    color: #475467;
    font-weight: 600;
    letter-spacing: 0.02em;
    line-height: 1;
    white-space: nowrap;
  }}
  #{uniqueId} .hdr-btn .hdr-ripple {{
    position: absolute;
    border-radius: 50%;
    background: var(--btn-color);
    opacity: 0.35;
    transform: scale(0);
    animation: global-hdr-ripple 0.6s ease-out;
    pointer-events: none;
    z-index: 0;
  }}

  #{uniqueId} .hdr-separator {{
    flex: 0 0 1px;
    width: 1px;
    height: 30px;
    background: linear-gradient(180deg, transparent, rgba(15,23,42,0.14) 50%, transparent);
    margin: 0 6px;
    opacity: 0;
    animation: {uniqueId}-btn-enter 0.4s ease forwards;
  }}

  @keyframes {uniqueId}-btn-enter {{
    from {{ opacity: 0; transform: translateY(6px) scale(0.9); }}
    to   {{ opacity: 1; transform: translateY(0) scale(1); }}
  }}
  @keyframes {uniqueId}-pop-item {{
    from {{ opacity: 0; transform: translateX(10px) scale(0.92); }}
    to   {{ opacity: 1; transform: translateX(0) scale(1); }}
  }}

  /* ───────────── Mobile: hamburger + popup ───────────── */
  @media (max-width: {mobileBp}px) {{
    #{uniqueId} {{
      flex-wrap: nowrap;
      padding: {MobilePadding};
      gap: 10px;
      border-radius: 10px;
    }}
    #{uniqueId} .hdr-left {{
      gap: 10px;
    }}
    #{uniqueId} .hdr-title {{
      font-size: {mobileHeadingSize}px;
    }}

    #{uniqueId} .hdr-menu-toggle {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      width: 42px;
      height: 42px;
      margin: 0;
      padding: 0;
      border: 1px solid rgba(15, 23, 42, 0.18);
      border-radius: 10px;
      background: linear-gradient(180deg, #FFFFFF 0%, #F6F8FA 100%);
      color: {menuColor};
      font-size: 22px;
      line-height: 1;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
      transition: background 0.2s ease, border-color 0.2s ease, transform 0.15s ease;
    }}
    #{uniqueId} .hdr-menu-toggle:active {{
      transform: scale(0.94);
    }}
    #{uniqueId} .hdr-menu-toggle:focus-visible {{
      outline: 2px solid color-mix(in srgb, {menuColor} 55%, transparent);
      outline-offset: 2px;
    }}
    #{uniqueId} .hdr-menu-toggle[aria-expanded=""true""] {{
      background: color-mix(in srgb, {menuColor} 8%, #FFFFFF);
      border-color: color-mix(in srgb, {menuColor} 35%, transparent);
    }}
    #{uniqueId} .hdr-menu-toggle i {{
      line-height: 1;
      display: inline-block;
    }}
    #{uniqueId} .hdr-menu-toggle .hdr-menu-close {{
      display: none;
      font-size: 18px;
    }}
    #{uniqueId} .hdr-menu-toggle[aria-expanded=""true""] .hdr-menu-open {{
      display: none;
    }}
    #{uniqueId} .hdr-menu-toggle[aria-expanded=""true""] .hdr-menu-close {{
      display: inline-block;
    }}

    /* The button bar becomes a small popup under the hamburger — ONE row, never wraps */
    #{uniqueId} .hdr-right {{
      position: absolute;
      top: calc(100% + 6px);
      right: 6px;
      z-index: 1060;
      width: max-content;
      max-width: calc(100% - 12px);
      flex-wrap: nowrap;
      justify-content: flex-start;
      gap: 6px;
      padding: 8px;
      background: {BackgroundColor};
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 12px;
      box-shadow: 0 14px 32px -8px rgba(15, 23, 42, 0.24), 0 2px 6px rgba(15, 23, 42, 0.08);
      overflow-x: auto;
      overflow-y: hidden;
      -webkit-overflow-scrolling: touch;
      overscroll-behavior-x: contain;
      scroll-snap-type: x proximity;
      scrollbar-width: none;
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transform: translateY(-6px) scale(0.97);
      transform-origin: top right;
      transition: opacity 0.18s ease, transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), visibility 0s linear 0.22s;
    }}
    #{uniqueId} .hdr-right.is-open {{
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transform: none;
      transition: opacity 0.18s ease, transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), visibility 0s;
    }}
    #{uniqueId} .hdr-right::-webkit-scrollbar {{
      display: none;
    }}
    /* Soft fade on the edge(s) when the row is wider than the screen and can be swiped */
    #{uniqueId} .hdr-right.can-scroll-right {{
      -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent);
      mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent);
    }}
    #{uniqueId} .hdr-right.can-scroll-left {{
      -webkit-mask-image: linear-gradient(to right, transparent, #000 28px);
      mask-image: linear-gradient(to right, transparent, #000 28px);
    }}
    #{uniqueId} .hdr-right.can-scroll-left.can-scroll-right {{
      -webkit-mask-image: linear-gradient(to right, transparent, #000 28px, #000 calc(100% - 28px), transparent);
      mask-image: linear-gradient(to right, transparent, #000 28px, #000 calc(100% - 28px), transparent);
    }}
    /* Buttons pop in one after another each time the popup opens */
    #{uniqueId} .hdr-right.is-open .hdr-btn,
    #{uniqueId} .hdr-right.is-open .hdr-separator {{
      animation-name: {uniqueId}-pop-item;
      animation-duration: 0.32s;
    }}

    #{uniqueId} .hdr-btn {{
      min-width: {(MobileHideLabels ? 44 : 54)}px;
      min-height: 44px;              /* finger-friendly tap target */
      padding: {(MobileHideLabels ? "6px" : "6px 10px")};
      scroll-snap-align: start;
    }}
    #{uniqueId} .hdr-btn i {{
      font-size: 18px;
      {(MobileHideLabels ? "margin-bottom: 0;" : "")}
    }}
    #{uniqueId} .hdr-btn span {{
      font-size: 10px;
      {(MobileHideLabels ? "display: none;" : "")}
    }}
    #{uniqueId} .hdr-separator {{
      height: 28px;
      margin: 0 2px;
    }}
  }}

  /* ───────────── Small phones ───────────── */
  @media (max-width: {smallBp}px) {{
    #{uniqueId} .hdr-icon-wrap {{
      width: {smallIconSize + 14}px;
      height: {smallIconSize + 14}px;
    }}
    #{uniqueId} .hdr-left i.hdr-main-icon {{
      font-size: {smallIconSize}px;
    }}
    #{uniqueId} .hdr-menu-toggle {{
      width: 40px;
      height: 40px;
    }}
    #{uniqueId} .hdr-right {{
      padding: 6px;
      gap: 5px;
    }}
    #{uniqueId} .hdr-btn {{
      min-width: {(MobileHideLabels ? 42 : 48)}px;
      padding: {(MobileHideLabels ? "6px" : "6px 8px")};
    }}
  }}

  /* ───────────── Reduced motion ───────────── */
  @media (prefers-reduced-motion: reduce) {{
    #{uniqueId} .hdr-left,
    #{uniqueId} .hdr-btn,
    #{uniqueId} .hdr-separator,
    #{uniqueId} .hdr-right.is-open .hdr-btn,
    #{uniqueId} .hdr-right.is-open .hdr-separator {{
      animation: none !important;
      opacity: 1 !important;
    }}
    #{uniqueId} .hdr-icon-wrap::before,
    #{uniqueId} .hdr-left i.hdr-main-icon {{
      animation: none !important;
    }}
    #{uniqueId} .hdr-btn,
    #{uniqueId} .hdr-btn i,
    #{uniqueId} .hdr-right,
    #{uniqueId} .hdr-menu-toggle {{
      transition: none !important;
    }}
  }}
</style>
");

            sb.Append("<div class=\"hdr-left\">");
            if (!string.IsNullOrWhiteSpace(LeftIconCss))
            {
                sb.Append("<div class=\"hdr-icon-wrap\">");
                sb.Append($"<i class=\"{Encode(LeftIconCss)} hdr-main-icon\" aria-hidden=\"true\"></i>");
                sb.Append("</div>");
            }
            sb.Append("<div class=\"hdr-title-wrap\">");
            sb.Append($"<h3 class=\"hdr-title\" title=\"{Encode(Heading)}\">{Encode(Heading)}</h3>");
            sb.Append($"<span class=\"hdr-subtitle\"{(string.IsNullOrWhiteSpace(Subtitle) ? " style=\"display:none;\"" : "")}>{Encode(Subtitle)}</span>");
            sb.Append("</div>");
            sb.Append("</div>");

            // Hamburger toggle (only visible on mobile via CSS)
            if (hasButtons)
            {
                sb.Append($"<button type=\"button\" class=\"hdr-menu-toggle\" " +
                          $"aria-label=\"{Encode(MobileMenuTooltip)}\" title=\"{Encode(MobileMenuTooltip)}\" " +
                          $"aria-expanded=\"false\" aria-controls=\"{uniqueId}-actions\">");
                sb.Append($"<i class=\"{Encode(MobileMenuIcon)} hdr-menu-open\" aria-hidden=\"true\"></i>");
                sb.Append($"<i class=\"{Encode(MobileMenuCloseIcon)} hdr-menu-close\" aria-hidden=\"true\"></i>");
                sb.Append("</button>");
            }

            sb.Append($"<div class=\"hdr-right\" id=\"{uniqueId}-actions\" role=\"toolbar\">");
            var animDelayMs = 0;
            const int stepMs = 45;
            const int sepStepMs = 40;

            foreach (var btn in allButtons)
            {
                var isUploadBtn = btn.IsImportUpload;
                var onclickAttr = (!isUploadBtn && !string.IsNullOrWhiteSpace(btn.OnClick)) ? $"onclick=\"{btn.OnClick}\"" : "";
                var tooltipAttr = !string.IsNullOrWhiteSpace(btn.Tooltip) ? $"title=\"{Encode(btn.Tooltip)}\"" : "";
                var ariaText = !string.IsNullOrWhiteSpace(btn.Text) ? btn.Text : btn.Tooltip;
                var ariaAttr = !string.IsNullOrWhiteSpace(ariaText) ? $"aria-label=\"{Encode(ariaText)}\"" : "";
                var actionAttr = !string.IsNullOrWhiteSpace(btn.Action) ? $"data-action=\"{Encode(btn.Action)}\"" : "";
                var uploadAttr = isUploadBtn ? $"data-import-upload=\"true\" data-import-target=\"{uniqueId}-file-input\"" : "";
                var color = string.IsNullOrWhiteSpace(btn.IconColor) ? "#333333" : btn.IconColor;

                // Rendered only when set on the button — lets the page's own
                // data-action click handler read $(this).data('controller') /
                // $(this).data('action-name') and build "/Controller/Action"
                // itself, instead of the URL being hardcoded per page.
                var controllerAttr = !string.IsNullOrWhiteSpace(btn.TargetController)
                    ? $"data-controller=\"{Encode(btn.TargetController)}\""
                    : "";
                var targetActionAttr = !string.IsNullOrWhiteSpace(btn.TargetAction)
                    ? $"data-action-name=\"{Encode(btn.TargetAction)}\""
                    : "";

                // Optional static payload alongside controller/action — e.g. a
                // partial-view path for FetchFullModalAndShow. Only rendered
                // when set, so it never conflicts with the routable pair above.
                var partialViewAttr = !string.IsNullOrWhiteSpace(btn.PartialView)
                    ? $"data-partial-view=\"{Encode(btn.PartialView)}\""
                    : "";

                sb.Append($"<button type=\"button\" class=\"hdr-btn {Encode(btn.CssClass)} hdr-ripple-target\" " +
                          $"style=\"--btn-color:{Encode(color)}; animation-delay:{animDelayMs}ms;\" " +
                          $"{actionAttr} {tooltipAttr} {ariaAttr} {onclickAttr} {uploadAttr} {controllerAttr} {targetActionAttr} {partialViewAttr}>");
                if (!string.IsNullOrWhiteSpace(btn.IconCss))
                {
                    sb.Append($"<i class=\"{Encode(btn.IconCss)}\" aria-hidden=\"true\"></i>");
                }
                if (!string.IsNullOrWhiteSpace(btn.Text))
                {
                    sb.Append($"<span>{Encode(btn.Text)}</span>");
                }
                sb.Append("</button>");
                animDelayMs += stepMs;

                if (btn.HasSeparatorAfter)
                {
                    sb.Append($"<div class=\"hdr-separator\" aria-hidden=\"true\" style=\"animation-delay:{animDelayMs}ms;\"></div>");
                    animDelayMs += sepStepMs;
                }
            }
            sb.Append("</div>");

            // Look up import upload button configuration BEFORE rendering script sections
            var importBtnForUpload = allButtons.Find(b => b.IsImportUpload);

            if (importBtnForUpload != null)
            {
                var acceptAttr = !string.IsNullOrWhiteSpace(ImportAccept) ? $"accept=\"{Encode(ImportAccept)}\"" : "";
                var multipleAttr = ImportAllowMultiple ? "multiple" : "";
                sb.Append($"<input type=\"file\" id=\"{uniqueId}-file-input\" class=\"hdr-file-input\" " +
                          $"style=\"display:none;\" {acceptAttr} {multipleAttr} />");
            }

            // NOTE: e.target.closest(...) is guarded with a nodeType === 1 check below.
            // closest() only exists on Element.prototype — if a click/mousedown/touch event
            // ever bubbles up with e.target being something other than an Element (e.g. the
            // document itself, or certain synthetic/programmatic dispatches), calling
            // .closest() directly throws "e.target.closest is not a function" and aborts
            // the handler for every click on the page. The guard makes handlePress and the
            // click listener no-ops in that case instead of throwing.
            sb.Append($@"
<script>
(function() {{
  if (!window.__actionHeaderDelegated) {{
    window.__actionHeaderDelegated = true;

    var handlePress = function(e, isPressed) {{
      var btn = (e.target && e.target.nodeType === 1) ? e.target.closest('.hdr-ripple-target') : null;
      if (btn) {{
        if (isPressed) btn.classList.add('is-pressed');
        else btn.classList.remove('is-pressed');
      }}
    }};

    document.addEventListener('mousedown', function(e) {{ handlePress(e, true); }});
    document.addEventListener('mouseup', function(e) {{ handlePress(e, false); }});
    document.addEventListener('mouseleave', function(e) {{ handlePress(e, false); }}, true);
    document.addEventListener('touchstart', function(e) {{ handlePress(e, true); }}, {{ passive: true }});
    document.addEventListener('touchend', function(e) {{ handlePress(e, false); }});
    document.addEventListener('touchcancel', function(e) {{ handlePress(e, false); }});

    document.addEventListener('click', function(e) {{
      var btn = (e.target && e.target.nodeType === 1) ? e.target.closest('.hdr-ripple-target') : null;
      if (!btn) return;

      var rect = btn.getBoundingClientRect();
      var ripple = document.createElement('span');
      ripple.className = 'hdr-ripple';
      var size = Math.max(rect.width, rect.height);
      // Keyboard-triggered clicks have clientX/Y = 0 — ripple from the centre instead
      var cx = (e.clientX || e.clientY) ? e.clientX - rect.left : rect.width / 2;
      var cy = (e.clientX || e.clientY) ? e.clientY - rect.top : rect.height / 2;
      ripple.style.width = ripple.style.height = size + 'px';
      ripple.style.left = (cx - size / 2) + 'px';
      ripple.style.top = (cy - size / 2) + 'px';
      btn.appendChild(ripple);

      setTimeout(function() {{ ripple.remove(); }}, 650);

      if (btn.getAttribute('data-import-upload') === 'true') {{
        var targetId = btn.getAttribute('data-import-target');
        var fileInput = targetId ? document.getElementById(targetId) : null;
        if (fileInput) fileInput.click();
      }}
    }});
  }}
}})();
</script>");

            // Per-instance: hamburger toggle + popup behaviour (mobile only)
            if (hasButtons)
            {
                var closeOnAction = MobileMenuCloseOnAction ? "true" : "false";

                sb.Append($@"
<script>
(function() {{
  var root = document.getElementById('{uniqueId}');
  if (!root || root.__menuBound) return;
  root.__menuBound = true;

  var toggle = root.querySelector('.hdr-menu-toggle');
  var panel = root.querySelector('.hdr-right');
  if (!toggle || !panel) return;

  var mq = window.matchMedia('(max-width: {mobileBp}px)');
  var closeOnAction = {closeOnAction};

  var updateFade = function() {{
    var max = panel.scrollWidth - panel.clientWidth;
    var scrollable = mq.matches && max > 2;
    panel.classList.toggle('can-scroll-left', scrollable && panel.scrollLeft > 2);
    panel.classList.toggle('can-scroll-right', scrollable && panel.scrollLeft < max - 2);
  }};

  var isOpen = function() {{ return panel.classList.contains('is-open'); }};

  var setOpen = function(open) {{
    panel.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {{
      panel.scrollLeft = 0;
      requestAnimationFrame(updateFade);
    }}
  }};

  toggle.addEventListener('click', function() {{
    setOpen(!isOpen());
  }});

  // Tap a button inside the popup -> close it (after the ripple shows)
  panel.addEventListener('click', function(e) {{
    if (!closeOnAction || !mq.matches || !isOpen()) return;
    var b = (e.target && e.target.nodeType === 1) ? e.target.closest('.hdr-btn') : null;
    if (b) setTimeout(function() {{ setOpen(false); }}, 180);
  }});

  // Tap anywhere outside the header -> close
  document.addEventListener('click', function(e) {{
    if (!isOpen()) return;
    if (e.target && e.target.nodeType === 1 && root.contains(e.target)) return;
    setOpen(false);
  }});

  // Escape key -> close
  document.addEventListener('keydown', function(e) {{
    if (e.key === 'Escape' && isOpen()) {{
      setOpen(false);
      toggle.focus();
    }}
  }});

  // Rotating / resizing back to desktop -> close and reset
  var onMq = function() {{
    if (!mq.matches) setOpen(false);
    updateFade();
  }};
  if (mq.addEventListener) mq.addEventListener('change', onMq);
  else if (mq.addListener) mq.addListener(onMq);

  panel.addEventListener('scroll', updateFade, {{ passive: true }});
  window.addEventListener('resize', updateFade);
}})();
</script>");
            }

            if (importBtnForUpload != null)
            {
                var successFn = !string.IsNullOrWhiteSpace(ImportOnSuccess) ? ImportOnSuccess : "null";
                var errorFn = !string.IsNullOrWhiteSpace(ImportOnError) ? ImportOnError : "null";

                sb.Append($@"
<script>
(function() {{
  var fileInput = document.getElementById('{uniqueId}-file-input');
  if (!fileInput || fileInput.__uploadBound) return;
  fileInput.__uploadBound = true;

  fileInput.addEventListener('change', function() {{
    if (!fileInput.files || fileInput.files.length === 0) return;

    var formData = new FormData();
    for (var i = 0; i < fileInput.files.length; i++) {{
      formData.append('files', fileInput.files[i]);
    }}

    var onSuccess = (typeof {successFn} === 'function') ? {successFn} : null;
    var onError = (typeof {errorFn} === 'function') ? {errorFn} : null;

    $.ajax({{
      url: '{Encode(ImportUploadUrl)}',
      type: 'POST',
      data: formData,
      contentType: false,
      processData: false,
      success: function(response) {{
        if (onSuccess) onSuccess(response, fileInput);
        fileInput.value = '';
      }},
      error: function(xhr) {{
        if (onError) onError(xhr, fileInput);
        fileInput.value = '';
      }}
    }});
  }});
}})();
</script>");
            }

            output.Content.SetHtmlContent(sb.ToString());
        }

        private static string BuildGradient(int angle, string? start, string? mid, string? end)
        {
            if (string.IsNullOrWhiteSpace(start) || string.IsNullOrWhiteSpace(end)) return string.Empty;

            if (!string.IsNullOrWhiteSpace(mid))
            {
                return $"linear-gradient({angle}deg, {start} 0%, {mid} 50%, {end} 100%)";
            }
            return $"linear-gradient({angle}deg, {start} 0%, {end} 100%)";
        }

        private static string Encode(string val) => HtmlEncoder.Default.Encode(val ?? string.Empty);
    }
}