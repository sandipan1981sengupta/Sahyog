using System;
using System.Globalization;
using System.Text;
using System.Text.Encodings.Web;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Razor.TagHelpers;

namespace ShankhNaad.Web.TagHelpers
{
    [HtmlTargetElement("strip-header")]
    public class StripHeaderTagHelper : TagHelper
    {
        // ---- Text content ----------------------------------------------------
        public string Heading { get; set; } = string.Empty;
        public string Subheading { get; set; } = string.Empty;

        // ---- Icon --------------------------------------------------------------
        public string? IconSrc { get; set; }
        public string IconAlt { get; set; } = "logo";
        public int IconSize { get; set; } = 74;
        public string IconBackgroundColor { get; set; } = "#DDE0E3";
        public double IconBorderWidth { get; set; } = 2.5;
        public string IconBorderColor { get; set; } = "#FFFFFF";
        public string IconImageSize { get; set; } = "70%";
        public int IconImageMargin { get; set; } = 4;

        // ---- Heading typography -------------------------------------------------
        public int HeadingFontSize { get; set; } = 34;
        public string HeadingFontWeight { get; set; } = "800";
        public string HeadingFontFamily { get; set; } = "'Segoe UI', Arial, sans-serif";

        // ---- Subheading typography -----------------------------------------------
        public int SubheadingFontSize { get; set; } = 15;
        public string SubheadingFontWeight { get; set; } = "700";
        public string SubheadingFontFamily { get; set; } = "'Segoe UI', Arial, sans-serif";

        // ---- Heading gradient ---------------------------------------------------
        public string HeadingGradientStart { get; set; } = "#005D8A";
        public string? HeadingGradientMid { get; set; } = "#6D3581";
        public string HeadingGradientEnd { get; set; } = "#FF4599";
        public int HeadingGradientAngle { get; set; } = 90;
        public int HeadingGradientMidStopPercent { get; set; } = 78;
        public int HeadingGradientStartHoldPercent { get; set; } = 48;
        public string HeadingFallbackColor { get; set; } = "#663082";

        // ---- Subheading gradient ------------------------------------------------
        public string SubheadingGradientStart { get; set; } = "#D10000";
        public string? SubheadingGradientMid { get; set; } = null;
        public string SubheadingGradientEnd { get; set; } = "#D10000";
        public int SubheadingGradientAngle { get; set; } = 90;
        public int SubheadingGradientMidStopPercent { get; set; } = 50;
        public int SubheadingGradientStartHoldPercent { get; set; } = 0;
        public string SubheadingFallbackColor { get; set; } = "#D10000";

        // ---- Background --------------------------------------------------------
        public bool BackgroundTransparent { get; set; } = true;
        public string BackgroundGradientStart { get; set; } = "#E9EBEE";
        public string? BackgroundGradientMid { get; set; } = null;
        public string BackgroundGradientEnd { get; set; } = "#C7CBD1";
        public int BackgroundGradientAngle { get; set; } = 90;

        // ---- Layout ------------------------------------------------------------
        public int Height { get; set; } = 0;
        public string Padding { get; set; } = "14px 28px";
        public string BorderRadius { get; set; } = "6px";
        public string MaxWidth { get; set; } = "100%";
        public string? CssClass { get; set; }

        // ---- User panel (right side) --------------------------------------------
        public string? UserName { get; set; }
        public string? UserImageSrc { get; set; }
        public string LoginTime { get; set; } = string.Empty;
        public int UserAvatarSize { get; set; } = 40;

        // ---- Secondary round icon (right side, beside the avatar) --------------
        public string? SideIconSrc { get; set; }
        public string SideIconAlt { get; set; } = "icon";
        public int? SideIconWidth { get; set; } = null;
        public int? SideIconHeight { get; set; } = null;
        public string SideIconBorderRadius { get; set; } = "50%";
        public string SideIconBackgroundColor { get; set; } = "#DDE0E3";
        public double SideIconBorderWidth { get; set; } = 0;
        public string SideIconBorderColor { get; set; } = "#FFFFFF";
        public string? SideIconClass { get; set; }
        public string SideIconColor { get; set; } = "#FFFFFF";
        public string? SideIconFontSize { get; set; } = null;

        // ---- ShankhNaad additions ---------------------------------------------------
        // Text of the first menu item (was always "Help"). Its action stays "help".
        public string HelpText { get; set; } = "Help";
        // Adds an "Install desktop app" item (action "install") above Log out.
        public bool ShowInstall { get; set; } = false;
        public string InstallText { get; set; } = "Install desktop app";
        // Shown in the round avatar when there is no UserImageSrc.
        public string? UserInitials { get; set; }

        // ---- Chevron -------------------------------------------------------------
        public string ChevronBackgroundColor { get; set; } = "#1F3B73";
        public string ChevronIconColor { get; set; } = "#FFFFFF";

        public override async Task ProcessAsync(TagHelperContext context, TagHelperOutput output)
        {
            // ShankhNaad: anything written between <strip-header> and </strip-header>
            // is shown on the right, just before the user panel.
            var childHtml = (await output.GetChildContentAsync()).GetContent();

            output.TagName = "div";
            output.TagMode = TagMode.StartTagAndEndTag;

            var uniqueId = "strip-" + Guid.NewGuid().ToString("N").Substring(0, 8);

            var headingGradientCss = BuildGradient(HeadingGradientAngle, HeadingGradientStart, HeadingGradientMid, HeadingGradientEnd, HeadingGradientMidStopPercent, HeadingGradientStartHoldPercent);
            var subheadingGradientCss = BuildGradient(SubheadingGradientAngle, SubheadingGradientStart, SubheadingGradientMid, SubheadingGradientEnd, SubheadingGradientMidStopPercent, SubheadingGradientStartHoldPercent);
            var backgroundCss = BackgroundTransparent
                ? "transparent"
                : BuildGradient(BackgroundGradientAngle, BackgroundGradientStart, BackgroundGradientMid, BackgroundGradientEnd);

            var chevronBackgroundCss = ChevronBackgroundColor;
            var classAttr = string.IsNullOrWhiteSpace(CssClass) ? uniqueId : $"{uniqueId} {CssClass}";
            output.Attributes.SetAttribute("class", classAttr);

            bool fixedHeight = Height > 0;
            int verticalPadding = fixedHeight ? Math.Max(4, (int)Math.Round(Height * 0.08)) : 0;
            int contentHeight = fixedHeight ? Math.Max(16, Height - (verticalPadding * 2)) : 0;

            int effectiveIconSize = fixedHeight ? Clamp(contentHeight, 16, contentHeight) : IconSize;
            int effectiveHeadingFontSize = fixedHeight ? Clamp((int)Math.Round(contentHeight * 0.42), 10, contentHeight) : HeadingFontSize;
            int effectiveSubheadingFontSize = fixedHeight ? Clamp((int)Math.Round(contentHeight * 0.20), 8, effectiveHeadingFontSize) : SubheadingFontSize;
            int effectiveAvatarSize = fixedHeight ? Clamp((int)Math.Round(contentHeight * 0.75), 16, contentHeight) : UserAvatarSize;
            int effectiveUserNameFontSize = fixedHeight ? Clamp((int)Math.Round(contentHeight * 0.24), 9, effectiveHeadingFontSize) : 15;
            int effectiveLoginTimeFontSize = fixedHeight ? Clamp((int)Math.Round(contentHeight * 0.18), 8, effectiveUserNameFontSize) : 12;
            int effectiveSideIconWidth = SideIconWidth ?? effectiveAvatarSize;
            int effectiveSideIconHeight = SideIconHeight ?? effectiveAvatarSize;
            string effectiveSideIconFontSize = !string.IsNullOrWhiteSpace(SideIconFontSize)
                ? SideIconFontSize!
                : $"{Math.Round(Math.Min(effectiveSideIconWidth, effectiveSideIconHeight) * 0.55)}px";

            string heightCss = fixedHeight
                ? $"height: {Height}px; min-height: {Height}px; max-height: {Height}px; padding: {verticalPadding}px 28px;"
                : $"padding: {Padding};";

            bool showUserPanel = !string.IsNullOrWhiteSpace(UserName);
            bool showSideIcon = !string.IsNullOrWhiteSpace(SideIconSrc) || !string.IsNullOrWhiteSpace(SideIconClass);

            var sb = new StringBuilder();

            sb.Append($@"
<style>
  .{uniqueId} {{
    display: flex;
    align-items: center;
    gap: 20px;
    width: 100%;
    max-width: {MaxWidth};
    {heightCss}
    border-radius: {BorderRadius};
    background: {backgroundCss};
    box-sizing: border-box;
    overflow: hidden;
    position: relative;
  }}
  .{uniqueId} .strip-icon-frame {{
    flex: 0 0 auto;
    width: {effectiveIconSize}px;
    height: {effectiveIconSize}px;
    box-sizing: border-box;
    border-radius: 50%;
    border: {IconBorderWidth.ToString(CultureInfo.InvariantCulture)}px solid {IconBorderColor};
    background-color: {IconBackgroundColor};
    padding: {IconImageMargin}px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }}
  .{uniqueId} .strip-icon-frame img {{
    width: {IconImageSize};
    height: auto;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    display: block;
    box-sizing: border-box;
    image-rendering: -webkit-optimize-contrast;
    image-rendering: crisp-edges;
    transform: translateZ(0);
    backface-visibility: hidden;
  }}
  .{uniqueId} .strip-text {{
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    overflow: hidden;
  }}
  .{uniqueId} .strip-heading {{
    margin: 0;
    font-family: {HeadingFontFamily};
    font-size: {effectiveHeadingFontSize}px;
    font-weight: {HeadingFontWeight};
    line-height: 1.15;
    letter-spacing: 0.5px;
    display: inline-block;
    width: fit-content;
    max-width: 100%;
    background-image: {headingGradientCss};
    background-size: 100%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    color: {HeadingFallbackColor};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }}
  .{uniqueId} .strip-subheading {{
    margin: 2px 0 0 0;
    font-family: {SubheadingFontFamily};
    font-size: {effectiveSubheadingFontSize}px;
    font-weight: {SubheadingFontWeight};
    font-style: italic;
    line-height: 1.3;
    display: inline-block;
    max-width: 100%;
    background-image: {subheadingGradientCss};
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    color: {SubheadingFallbackColor};
    word-break: break-word;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }}
  @supports not (-webkit-background-clip: text) {{
    .{uniqueId} .strip-heading {{ -webkit-text-fill-color: initial; color: {HeadingFallbackColor}; }}
    .{uniqueId} .strip-subheading {{ -webkit-text-fill-color: initial; color: {SubheadingFallbackColor}; }}
  }}

  .{uniqueId} .strip-side-icon {{
    flex: 0 0 auto;
    width: {effectiveSideIconWidth}px;
    height: {effectiveSideIconHeight}px;
    border-radius: {SideIconBorderRadius};
    overflow: hidden;
    background: {SideIconBackgroundColor};
    border: {SideIconBorderWidth.ToString(CultureInfo.InvariantCulture)}px solid {SideIconBorderColor};
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
  }}
  .{uniqueId} .strip-side-icon img {{
    width: 100%;
    height: 100%;
    min-width: 100%;
    min-height: 100%;
    max-width: 100%;
    max-height: 100%;
    flex: 1 1 auto;
    object-fit: fill;
    display: block;
    box-sizing: border-box;
  }}
  .{uniqueId} .strip-side-icon i {{
    color: {SideIconColor};
    font-size: {effectiveSideIconFontSize};
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }}

  .{uniqueId} .strip-user-panel {{
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 10px;
    margin-left: auto;
    height: 100%;
    padding: 0 4px;
    cursor: pointer;
    user-select: none;
    position: relative;
  }}
  .{uniqueId} .strip-user-avatar {{
    flex: 0 0 auto;
    width: {effectiveAvatarSize}px;
    height: {effectiveAvatarSize}px;
    border-radius: 50%;
    overflow: hidden;
    background-color: #DDE0E3;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
  }}
  .{uniqueId} .strip-user-avatar img {{
    width: 100%;
    height: 100%;
    min-width: 100%;
    min-height: 100%;
    max-width: 100%;
    max-height: 100%;
    flex: 1 1 auto;
    object-fit: cover;
    object-position: center center;
    display: block;
    box-sizing: border-box;
  }}
  .{uniqueId} .strip-user-info {{
    display: flex;
    flex-direction: column;
    justify-content: center;
    line-height: 1.25;
    max-width: 220px;
  }}
  .{uniqueId} .strip-user-name {{
    margin: 0;
    font-family: var(--ctrl-font);
    font-size: {effectiveUserNameFontSize}px;
    font-weight: 700;
    color: #1F2937;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }}
  .{uniqueId} .strip-user-time {{
    margin: 0;
    font-family: var(--ctrl-font);
    font-size: {effectiveLoginTimeFontSize}px;
    font-weight: 600;
    color: #3B5BA5;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }}
  .{uniqueId} .strip-user-chevron {{
    flex: 0 0 auto;
    width: {Math.Max(18, (int)Math.Round(effectiveAvatarSize * 0.55))}px;
    height: {Math.Max(18, (int)Math.Round(effectiveAvatarSize * 0.55))}px;
    border-radius: 50%;
    background: {chevronBackgroundCss};
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  }}
  .{uniqueId} .strip-user-panel.open .strip-user-chevron {{
    transform: rotate(180deg);
  }}
  .{uniqueId} .strip-user-chevron svg {{
    width: 55%;
    height: 55%;
    fill: none;
    stroke: {ChevronIconColor};
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }}

  /* Global Dropdown styling - attached directly to body */
  .strip-user-dropdown[data-owner-id=""{uniqueId}-user-panel""] {{
    display: none;
    position: fixed !important;
    min-width: 170px;
    background: #FFFFFF;
    border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.25), 0 2px 8px rgba(0,0,0,0.12);
    overflow: hidden;
    z-index: 2147483647 !important; /* Maximum 32-bit integer z-index */
    cursor: default;
    transform-origin: top right;
    opacity: 0;
    transform: scale(0.92) translateY(-6px);
    transition: opacity 0.16s cubic-bezier(0.16, 1, 0.3, 1),
                transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }}
  .strip-user-dropdown[data-owner-id=""{uniqueId}-user-panel""].dropdown-anchor-bottom {{
    transform-origin: bottom right;
  }}
  .strip-user-dropdown[data-owner-id=""{uniqueId}-user-panel""].dropdown-anchor-left {{
    transform-origin: top left;
  }}
  .strip-user-dropdown[data-owner-id=""{uniqueId}-user-panel""].dropdown-anchor-bottom.dropdown-anchor-left {{
    transform-origin: bottom left;
  }}
  .strip-user-dropdown[data-owner-id=""{uniqueId}-user-panel""].dropdown-visible {{
    display: block;
  }}
  .strip-user-dropdown[data-owner-id=""{uniqueId}-user-panel""].dropdown-open {{
    opacity: 1;
    transform: scale(1) translateY(0);
  }}
  .strip-user-dropdown[data-owner-id=""{uniqueId}-user-panel""] .strip-user-dropdown-item {{
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    font-family: var(--ctrl-font);
    font-size: 14px;
    font-weight: 600;
    color: #1F2937;
    cursor: pointer;
    opacity: 0;
    transform: translateX(8px);
    transition: opacity 0.18s ease, transform 0.18s ease, background-color 0.12s ease;
  }}
  .strip-user-dropdown[data-owner-id=""{uniqueId}-user-panel""].dropdown-open .strip-user-dropdown-item {{
    opacity: 1;
    transform: translateX(0);
  }}
  .strip-user-dropdown[data-owner-id=""{uniqueId}-user-panel""].dropdown-open .strip-user-dropdown-item:nth-child(1) {{
    transition-delay: 0.04s;
  }}
  .strip-user-dropdown[data-owner-id=""{uniqueId}-user-panel""].dropdown-open .strip-user-dropdown-item:nth-child(2) {{
    transition-delay: 0.09s;
  }}
  .strip-user-dropdown[data-owner-id=""{uniqueId}-user-panel""].dropdown-open .strip-user-dropdown-item:nth-child(3) {{
    transition-delay: 0.14s;
  }}
  .strip-user-dropdown[data-owner-id=""{uniqueId}-user-panel""] .strip-user-dropdown-item:hover {{
    background-color: #F3F4F6;
  }}
  .strip-user-dropdown[data-owner-id=""{uniqueId}-user-panel""] .strip-user-dropdown-item:active {{
    background-color: #E5E7EB;
    transform: scale(0.98);
  }}
  .strip-user-dropdown[data-owner-id=""{uniqueId}-user-panel""] .strip-user-dropdown-item + .strip-user-dropdown-item {{
    border-top: 1px solid #EDEDED;
  }}
  .strip-user-dropdown[data-owner-id=""{uniqueId}-user-panel""] .strip-user-dropdown-item svg {{
    flex: 0 0 auto;
    width: 16px;
    height: 16px;
    transition: transform 0.15s ease;
  }}
  .strip-user-dropdown[data-owner-id=""{uniqueId}-user-panel""] .strip-user-dropdown-item:hover svg {{
    transform: scale(1.12);
  }}
</style>
");

            sb.Append("<div class=\"strip-icon-frame\">");
            if (!string.IsNullOrWhiteSpace(IconSrc))
            {
                sb.Append($"<img src=\"{Encode(IconSrc)}\" alt=\"{Encode(IconAlt)}\" />");
            }
            sb.Append("</div>");

            sb.Append("<div class=\"strip-text\">");
            if (!string.IsNullOrWhiteSpace(Heading))
            {
                sb.Append($"<div class=\"strip-heading\">{Encode(Heading)}</div>");
            }
            if (!string.IsNullOrWhiteSpace(Subheading))
            {
                sb.Append($"<div class=\"strip-subheading\">{Encode(Subheading)}</div>");
            }
            sb.Append("</div>");

            if (!string.IsNullOrWhiteSpace(childHtml))
            {
                sb.Append($"<div class=\"strip-extra\">{childHtml}</div>");
            }

            if (showSideIcon)
            {
                sb.Append("<div class=\"strip-side-icon\">");
                if (!string.IsNullOrWhiteSpace(SideIconSrc))
                {
                    sb.Append($"<img src=\"{Encode(SideIconSrc)}\" alt=\"{Encode(SideIconAlt)}\" />");
                }
                else if (!string.IsNullOrWhiteSpace(SideIconClass))
                {
                    sb.Append($"<i class=\"{Encode(SideIconClass)}\" aria-label=\"{Encode(SideIconAlt)}\"></i>");
                }
                sb.Append("</div>");
            }

            if (showUserPanel)
            {
                sb.Append($@"
<div class=""strip-user-panel"" id=""{uniqueId}-user-panel"" data-strip-user-panel>
  <div class=""strip-user-avatar"">
    {(!string.IsNullOrWhiteSpace(UserImageSrc)
        ? $"<img src=\"{Encode(UserImageSrc)}\" alt=\"{Encode(UserName ?? "user")}\" />"
        : !string.IsNullOrWhiteSpace(UserInitials)
            ? $"<span class=\"strip-user-initials\">{Encode(UserInitials)}</span>"
            : DefaultAvatarSvg())}
  </div>
  <div class=""strip-user-info"">
    <p class=""strip-user-name"">{Encode(UserName ?? string.Empty)}</p>
    <p class=""strip-user-time"">{Encode(LoginTime)}</p>
  </div>
  <div class=""strip-user-chevron"">
    <svg viewBox=""0 0 24 24""><polyline points=""6 9 12 15 18 9""></polyline></svg>
  </div>
  <div class=""strip-user-dropdown"" data-strip-user-dropdown data-owner-id=""{uniqueId}-user-panel"">
    <div class=""strip-user-dropdown-item"" data-strip-action=""help"">
      <svg viewBox=""0 0 24 24"" fill=""none"" stroke=""#111827"" stroke-width=""2"" stroke-linecap=""round"" stroke-linejoin=""round"">
        <circle cx=""12"" cy=""12"" r=""10""></circle>
        <path d=""M9.09 9a3 3 0 0 1 5.83 1c0 2-3 2-3 4""></path>
        <line x1=""12"" y1=""17"" x2=""12.01"" y2=""17""></line>
      </svg>
      <span>{Encode(HelpText)}</span>
    </div>
    <div class=""strip-user-dropdown-item"" data-strip-action=""fullscreen"">
      <svg class=""icon-maximize"" viewBox=""0 0 24 24"" fill=""none"" stroke=""#111827"" stroke-width=""2"" stroke-linecap=""round"" stroke-linejoin=""round"">
        <polyline points=""15 3 21 3 21 9""></polyline>
        <polyline points=""9 21 3 21 3 15""></polyline>
        <line x1=""21"" y1=""3"" x2=""14"" y2=""10""></line>
        <line x1=""3"" y1=""21"" x2=""10"" y2=""14""></line>
      </svg>
      <svg class=""icon-minimize"" style=""display:none"" viewBox=""0 0 24 24"" fill=""none"" stroke=""#111827"" stroke-width=""2"" stroke-linecap=""round"" stroke-linejoin=""round"">
        <polyline points=""4 14 10 14 10 20""></polyline>
        <polyline points=""20 10 14 10 14 4""></polyline>
        <line x1=""14"" y1=""10"" x2=""21"" y2=""3""></line>
        <line x1=""3"" y1=""21"" x2=""10"" y2=""14""></line>
      </svg>
      <span class=""fullscreen-label"">Maximize</span>
    </div>
    {(ShowInstall ? $@"<div class=""strip-user-dropdown-item"" data-strip-action=""install"" data-strip-install-item>
      <svg viewBox=""0 0 24 24"" fill=""none"" stroke=""#111827"" stroke-width=""2"" stroke-linecap=""round"" stroke-linejoin=""round"">
        <rect x=""3"" y=""4"" width=""18"" height=""12"" rx=""2""></rect>
        <line x1=""8"" y1=""20"" x2=""16"" y2=""20""></line>
        <line x1=""12"" y1=""16"" x2=""12"" y2=""20""></line>
      </svg>
      <span>{Encode(InstallText)}</span>
    </div>" : "")}
    <div class=""strip-user-dropdown-item"" data-strip-action=""logout"">
      <svg viewBox=""0 0 24 24"" fill=""none"" stroke=""#111827"" stroke-width=""2"" stroke-linecap=""round"" stroke-linejoin=""round"">
        <path d=""M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4""></path>
        <polyline points=""16 17 21 12 16 7""></polyline>
        <line x1=""21"" y1=""12"" x2=""9"" y2=""12""></line>
      </svg>
      <span>Log out</span>
    </div>
  </div>
</div>
<script>
(function () {{
  var panel = document.getElementById('{uniqueId}-user-panel');
  if (!panel || panel.__stripHeaderBound) return;
  panel.__stripHeaderBound = true;

  var dropdown = panel.querySelector('[data-strip-user-dropdown]');
  var closeTimer = null;
  var CLOSE_ANIM_MS = 160;

  // Move dropdown directly to body element to escape container overflow and stacking context limits
  if (dropdown && dropdown.parentElement !== document.body) {{
    document.body.appendChild(dropdown);
  }}

  function positionDropdown() {{
    if (!dropdown) return;
    dropdown.style.top = '';
    dropdown.style.bottom = '';
    dropdown.style.left = '';
    dropdown.style.right = '';

    var anchorRect = panel.getBoundingClientRect();
    var ddHeight = dropdown.offsetHeight;
    var ddWidth = dropdown.offsetWidth;
    var viewportW = window.innerWidth;
    var viewportH = window.innerHeight;
    var gap = 6;

    var spaceBelow = viewportH - anchorRect.bottom;
    var openUp = spaceBelow < (ddHeight + gap) && anchorRect.top > (ddHeight + gap);
    if (openUp) {{
      dropdown.style.bottom = (viewportH - anchorRect.top + gap) + 'px';
    }} else {{
      dropdown.style.top = (anchorRect.bottom + gap) + 'px';
    }}
    dropdown.classList.toggle('dropdown-anchor-bottom', openUp);

    var right = viewportW - anchorRect.right;
    var openLeft = anchorRect.right - ddWidth < 4;
    if (right < 4) right = 4;
    if (openLeft) {{
      dropdown.style.left = '4px';
      dropdown.style.right = 'auto';
    }} else {{
      dropdown.style.right = right + 'px';
      dropdown.style.left = 'auto';
    }}
    dropdown.classList.toggle('dropdown-anchor-left', openLeft);
  }}

  function openDropdown() {{
    if (!dropdown) return;
    clearTimeout(closeTimer);
    panel.classList.add('open');
    dropdown.classList.add('dropdown-visible');
    positionDropdown();
    void dropdown.offsetHeight;
    requestAnimationFrame(function () {{
      dropdown.classList.add('dropdown-open');
      positionDropdown();
    }});
  }}

  function closeDropdown() {{
    if (!dropdown) return;
    panel.classList.remove('open');
    dropdown.classList.remove('dropdown-open');
    clearTimeout(closeTimer);
    closeTimer = setTimeout(function () {{
      dropdown.classList.remove('dropdown-visible');
    }}, CLOSE_ANIM_MS);
  }}

  // ---- Fullscreen toggle (Maximize / Minimize) ----
  var fsItem = dropdown ? dropdown.querySelector('[data-strip-action=""fullscreen""]') : null;
  var fsLabel = fsItem ? fsItem.querySelector('.fullscreen-label') : null;
  var fsIconMax = fsItem ? fsItem.querySelector('.icon-maximize') : null;
  var fsIconMin = fsItem ? fsItem.querySelector('.icon-minimize') : null;

  function isFullscreen() {{
    return !!(document.fullscreenElement ||
              document.webkitFullscreenElement ||
              document.msFullscreenElement);
  }}

  function updateFullscreenUi() {{
    var fs = isFullscreen();
    if (fsLabel) fsLabel.textContent = fs ? 'Minimize' : 'Maximize';
    if (fsIconMax) fsIconMax.style.display = fs ? 'none' : '';
    if (fsIconMin) fsIconMin.style.display = fs ? '' : 'none';
  }}

  function toggleFullscreen() {{
    var elem = document.documentElement;
    if (!isFullscreen()) {{
      if (elem.requestFullscreen) elem.requestFullscreen();
      else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
      else if (elem.msRequestFullscreen) elem.msRequestFullscreen();
    }} else {{
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      else if (document.msExitFullscreen) document.msExitFullscreen();
    }}
  }}

  // Keeps label/icon correct even when the user exits with the Esc key
  document.addEventListener('fullscreenchange', updateFullscreenUi);
  document.addEventListener('webkitfullscreenchange', updateFullscreenUi);
  document.addEventListener('MSFullscreenChange', updateFullscreenUi);
  updateFullscreenUi();

  // Handle panel toggle
  panel.addEventListener('click', function (e) {{
    if (panel.classList.contains('open')) {{
      closeDropdown();
    }} else {{
      openDropdown();
    }}
  }});

  // Handle dropdown actions from body-level element
  dropdown.addEventListener('click', function (e) {{
    var actionEl = e.target.closest('[data-strip-action]');
    if (actionEl) {{
      e.stopPropagation();
      closeDropdown();
      var action = actionEl.getAttribute('data-strip-action');

      if (action === 'fullscreen') {{
        toggleFullscreen();
      }}

      panel.dispatchEvent(new CustomEvent('strip-header:action', {{ bubbles: true, detail: {{ action: action }} }}));
      document.dispatchEvent(new CustomEvent('strip-header:action', {{ bubbles: true, detail: {{ action: action, panelId: '{uniqueId}-user-panel' }} }}));
    }}
  }});

  document.addEventListener('click', function (e) {{
    if (!panel.contains(e.target) && !dropdown.contains(e.target) && panel.classList.contains('open')) {{
      closeDropdown();
    }}
  }});

  document.addEventListener('keydown', function (e) {{
    if (e.key === 'Escape' && panel.classList.contains('open')) {{
      closeDropdown();
    }}
  }});

  window.addEventListener('scroll', function () {{
    if (panel.classList.contains('open')) positionDropdown();
  }}, true);

  window.addEventListener('resize', function () {{
    if (panel.classList.contains('open')) positionDropdown();
  }});
}})();
</script>
");
            }

            output.Content.SetHtmlContent(sb.ToString());
        }

        private static int Clamp(int value, int min, int max)
        {
            if (max < min) max = min;
            return Math.Clamp(value, min, max);
        }

        private static string DefaultAvatarSvg() =>
            "<svg viewBox=\"0 0 24 24\" fill=\"#9CA3AF\"><circle cx=\"12\" cy=\"8\" r=\"4\"/><path d=\"M4 20c0-4 3.5-7 8-7s8 3 8 7\"/></svg>";

        private static string BuildGradient(int angle, string start, string? mid, string end, int midStopPercent = 50, int startHoldPercent = 0)
        {
            if (!string.IsNullOrWhiteSpace(mid) &&
                !string.Equals(start, mid, StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(end, mid, StringComparison.OrdinalIgnoreCase))
            {
                var clampedMidStop = Math.Clamp(midStopPercent, 1, 99);

                if (startHoldPercent > 0 && clampedMidStop > 1)
                {
                    var clampedHold = Math.Clamp(startHoldPercent, 1, clampedMidStop - 1);
                    return $"linear-gradient({angle}deg, {start} 0%, {start} {clampedHold}%, {mid} {clampedMidStop}%, {end} 100%)";
                }

                return $"linear-gradient({angle}deg, {start} 0%, {mid} {clampedMidStop}%, {end} 100%)";
            }

            if (startHoldPercent > 0)
            {
                var clampedHold = Math.Clamp(startHoldPercent, 1, 99);
                return $"linear-gradient({angle}deg, {start} 0%, {start} {clampedHold}%, {end} 100%)";
            }

            return $"linear-gradient({angle}deg, {start} 0%, {end} 100%)";
        }

        private static string Encode(string value) => HtmlEncoder.Default.Encode(value ?? string.Empty);
    }
}