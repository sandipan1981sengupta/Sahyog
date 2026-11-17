using Microsoft.AspNetCore.Razor.TagHelpers;
using System.Linq;

namespace Sahyog.Web.TagHelpers
{
    /// <summary>
    /// Icon rail (left-hand vertical nav). Requires Font Awesome:
    /// https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/css/font-awesome.min.css
    ///
    /// Usage:
    /// <report-rail id="MainRail" show-logo="true" show-carets="true">
    ///     <rail-item key="home" label="Home" icon="home" href="/Home"></rail-item>
    ///     <rail-item key="config" label="Config" icon="cog" href="/Config"></rail-item>
    ///     <rail-item key="report" label="Report" icon="file-text-o" active="true"
    ///                opens-panel="true" panel-target="ReportDetailsPanel"></rail-item>
    ///     <rail-item key="settings" label="Settings" icon="cog" href="/Settings"></rail-item>
    /// </report-rail>
    ///
    /// Put one or more &lt;report-panel&gt; elements anywhere else on the
    /// page (they render as fixed-position overlays regardless of where
    /// they sit in the DOM) and reference them via PanelTarget above.
    ///
    /// ActiveIconColor / ActiveLabelColor (here, and on <rail-item>) accept
    /// either a flat CSS color OR a CSS gradient function
    /// (linear-gradient(...), radial-gradient(...), conic-gradient(...)).
    /// When a gradient is given, that icon or label is painted with the
    /// gradient as its foreground (background-clip: text) instead of a
    /// solid color — independently for the icon and the label, so one can
    /// be a flat color while the other is a gradient.
    /// </summary>
    [HtmlTargetElement("report-rail")]
    [RestrictChildren("rail-item")]
    public class ReportRail : TagHelper
    {
        public string Id { get; set; }
        public string RailWidth { get; set; } = "92px";
        public string RailHeight { get; set; } = "100%";
        public bool ShowLogo { get; set; } = true;
        public string LogoBackground { get; set; }
        public string LogoIcon { get; set; } = "comment-o";
        public string LogoIconColor { get; set; } = "#ffffff";
        public string LogoIconSize { get; set; } = "22px";
        public string LogoWidth { get; set; } = "52px";
        public string LogoHeight { get; set; } = "52px";
        public string LogoImageUrl { get; set; }
        public string LogoBorderRadius { get; set; } = "14px";
        public string LogoBorderWidth { get; set; } = "0px";
        public string LogoBorderColor { get; set; } = "transparent";
        public string LogoOffsetY { get; set; }
        public bool ShowCarets { get; set; } = false;

        public string LogoToDividerGap { get; set; }
        public string DividerWidth { get; set; } = "46px";
        public string DividerThickness { get; set; } = "1px";
        public string DividerColor { get; set; }
        public string DividerToIconsGap { get; set; }
        public bool ShowDivider { get; set; } = true;

        public string FooterImageUrl { get; set; }
        public string FooterImageBorderRadius { get; set; } = "14px";
        public string FooterImageBorderWidth { get; set; } = "0px";
        public string FooterImageBorderColor { get; set; } = "transparent";
        public string FooterImageSize { get; set; } = "52px";

        public string BackgroundColor { get; set; }
        public string HoverColor { get; set; }
        public string ActiveColor { get; set; }

        // May be a flat color OR a gradient function (linear-gradient(...),
        // radial-gradient(...), conic-gradient(...)). See ReportRailColorUtil.
        public string ActiveIconColor { get; set; }
        public string ActiveLabelColor { get; set; }

        public string ActiveGradientStart { get; set; }
        public string ActiveGradientEnd { get; set; }
        public string ActiveBarColor { get; set; }
        public string SelectionColor { get; set; }
        public string SelectionBorderRadius { get; set; } = "12px";
        public string SelectionInset { get; set; } = "6px";
        public string IconSize { get; set; } = "24px";
        public string LabelFontSize { get; set; } = "12.5px";
        public string LabelFontWeight { get; set; } = "500";

        public override async Task ProcessAsync(TagHelperContext context, TagHelperOutput output)
        {
            var childContent = await output.GetChildContentAsync();
            var itemsHtml = childContent.GetContent();

            output.TagName = "nav";
            output.Attributes.SetAttribute("class", "report-rail");
            output.Attributes.SetAttribute("id", Id);
            output.Attributes.SetAttribute("aria-label", "Primary");

            var styleVars = new System.Collections.Generic.List<string>
            {
                $"width:{RailWidth}",
                $"height:{RailHeight}",
                $"--rr-icon-size:{IconSize}",
                $"--rr-label-size:{LabelFontSize}",
                $"--rr-label-weight:{LabelFontWeight}"
            };
            if (!string.IsNullOrWhiteSpace(BackgroundColor)) styleVars.Add($"background:{BackgroundColor}");
            if (!string.IsNullOrWhiteSpace(HoverColor)) styleVars.Add($"--rr-hover-color:{HoverColor}");
            if (!string.IsNullOrWhiteSpace(ActiveColor)) styleVars.Add($"--rr-active-color:{ActiveColor}");
            if (!string.IsNullOrWhiteSpace(ActiveIconColor)) styleVars.Add($"--rr-active-icon-color:{ActiveIconColor}");
            if (!string.IsNullOrWhiteSpace(ActiveLabelColor)) styleVars.Add($"--rr-active-label-color:{ActiveLabelColor}");

            var effectiveBarColor = !string.IsNullOrWhiteSpace(ActiveBarColor) ? ActiveBarColor
                : (!string.IsNullOrWhiteSpace(ActiveLabelColor) ? ActiveLabelColor
                : ActiveColor);
            if (!string.IsNullOrWhiteSpace(effectiveBarColor)) styleVars.Add($"--rr-active-bar:{effectiveBarColor}");
            if (!string.IsNullOrWhiteSpace(SelectionColor)) styleVars.Add($"--rr-selection-color:{SelectionColor}");
            if (!string.IsNullOrWhiteSpace(SelectionBorderRadius)) styleVars.Add($"--rr-selection-radius:{SelectionBorderRadius}");
            if (!string.IsNullOrWhiteSpace(SelectionInset)) styleVars.Add($"--rr-selection-inset:{SelectionInset}");
            if (!string.IsNullOrWhiteSpace(LogoBackground)) styleVars.Add($"--rr-logo-bg:{LogoBackground}");
            if (!string.IsNullOrWhiteSpace(LogoToDividerGap)) styleVars.Add($"--rr-logo-divider-gap:{LogoToDividerGap}");
            if (!string.IsNullOrWhiteSpace(DividerWidth)) styleVars.Add($"--rr-divider-width:{DividerWidth}");
            if (!string.IsNullOrWhiteSpace(DividerThickness)) styleVars.Add($"--rr-divider-thickness:{DividerThickness}");
            if (!string.IsNullOrWhiteSpace(DividerColor)) styleVars.Add($"--rr-divider-color:{DividerColor}");
            if (!string.IsNullOrWhiteSpace(DividerToIconsGap)) styleVars.Add($"--rr-divider-icons-gap:{DividerToIconsGap}");

            var useGradientActive = !string.IsNullOrWhiteSpace(ActiveGradientStart) && !string.IsNullOrWhiteSpace(ActiveGradientEnd);
            if (useGradientActive)
            {
                styleVars.Add($"--rr-active-gradient:linear-gradient(135deg, {ActiveGradientStart}, {ActiveGradientEnd})");
            }

            output.Attributes.SetAttribute("style", string.Join("; ", styleVars) + ";");

            if (useGradientActive)
            {
                output.Attributes.SetAttribute("data-use-gradient-active", "true");
            }

            context.Items["ReportRail.UseGradientActive"] = useGradientActive;
            context.Items["ReportRail.DefaultIconIsGradient"] = ReportRailColorUtil.IsGradient(ActiveIconColor);
            context.Items["ReportRail.DefaultLabelIsGradient"] = ReportRailColorUtil.IsGradient(ActiveLabelColor);

            // Carry the raw rail-wide values themselves (not just whether
            // they're gradients) so each <rail-item> can fall back to
            // them when it doesn't set its own ActiveIconColor /
            // ActiveLabelColor / ActiveColor. Without this, a rail-wide
            // gradient set only on <report-rail> would never reach any
            // individual item's fallback chain — items would only ever
            // see the rail-wide value via the CSS variable inherited from
            // the <nav>, which is consumed by the PLAIN (non-gradient)
            // color rule and therefore silently fails for gradients.
            context.Items["ReportRail.DefaultActiveColor"] = ActiveColor;
            context.Items["ReportRail.DefaultActiveIconColor"] = ActiveIconColor;
            context.Items["ReportRail.DefaultActiveLabelColor"] = ActiveLabelColor;
            context.Items["ReportRail.DefaultActiveBarColor"] = ActiveBarColor;

            var logoOffsetStyle = !string.IsNullOrWhiteSpace(LogoOffsetY) ? $" transform: translateY({LogoOffsetY});" : "";
            var logoSizeStyle = $" width: {LogoWidth}; height: {LogoHeight};";
            var logoBorderStyle = $"border: {LogoBorderWidth} solid {LogoBorderColor}; border-radius: {LogoBorderRadius}; --rr-logo-border-width: {LogoBorderWidth}; --rr-logo-border-radius: {LogoBorderRadius};{logoSizeStyle}{logoOffsetStyle}";

            var logoHtml = "";
            if (ShowLogo)
            {
                if (!string.IsNullOrWhiteSpace(LogoImageUrl))
                {
                    logoHtml = $@"<div class='rr-logo rr-logo-image' style='{logoBorderStyle}'>
                        <img src='{LogoImageUrl}' alt='' onerror=""this.style.display='none';"" />
                    </div>";
                }
                else
                {
                    logoHtml = $"<div class='rr-logo' style='{logoBorderStyle}'><i class='fa fa-{LogoIcon}' style='font-size:{LogoIconSize}; color:{LogoIconColor};'></i></div>";
                }
            }

            var caretsHtml = ShowCarets ? @"
                <div class='rr-carets'>
                    <div>&#9650;</div>
                    <div>&#9660;</div>
                </div>" : "";

            var dividerHtml = ShowDivider ? "<div class='rr-divider'></div>" : "";

            var footerImageHtml = "";
            if (!string.IsNullOrWhiteSpace(FooterImageUrl))
            {
                var footerBorderStyle = $"border: {FooterImageBorderWidth} solid {FooterImageBorderColor}; border-radius: {FooterImageBorderRadius}; width: {FooterImageSize}; height: {FooterImageSize}; --rr-footer-border-width: {FooterImageBorderWidth}; --rr-footer-border-radius: {FooterImageBorderRadius};";
                footerImageHtml = $@"<div class='rr-footer-image' style='{footerBorderStyle}'>
                        <img src='{FooterImageUrl}' alt='' onerror=""this.style.display='none';"" />
                    </div>";
            }

            output.Content.SetHtmlContent($@"
                {logoHtml}
                {caretsHtml}
                {dividerHtml}
                <ul class='rr-items'>
                    {itemsHtml}
                </ul>
                <div class='rr-active-indicator'></div>
                {footerImageHtml}
            ");
        }
    }

    /// <summary>
    /// A single icon rail entry. Set OpensPanel + PanelTarget to have this
    /// item toggle open a &lt;report-panel&gt; elsewhere on the page instead
    /// of (or in addition to) navigating via Href.
    ///
    /// ActiveIconColor / ActiveLabelColor accept either a flat CSS color or
    /// a CSS gradient function (linear-gradient(...), radial-gradient(...),
    /// conic-gradient(...)). When set to a gradient, that icon or label
    /// renders with the gradient as its foreground instead of a solid
    /// color — independently, so the icon can be a gradient while the
    /// label stays a flat color, or vice versa.
    /// </summary>
    [HtmlTargetElement("rail-item")]
    public class RailItem : TagHelper
    {
        public string Key { get; set; }
        public string Label { get; set; }
        public string Icon { get; set; }
        public string Href { get; set; } = "#";
        public bool Active { get; set; } = false;
        public bool OpensPanel { get; set; } = false;
        public string PanelTarget { get; set; }

        public string IconColor { get; set; }
        public string IconSize { get; set; }
        public string LabelColor { get; set; }
        public string FontSize { get; set; }
        public string FontWeight { get; set; }
        public string HoverColor { get; set; }

        public string ActiveColor { get; set; }
        public string ActiveIconColor { get; set; }
        public string ActiveLabelColor { get; set; }
        public string ActiveBarColor { get; set; }

        public override void Process(TagHelperContext context, TagHelperOutput output)
        {
            var useGradient = context.Items.TryGetValue("ReportRail.UseGradientActive", out var v) && v is bool b && b;

            output.TagName = "li";
            var classes = "rr-item" + (Active ? " rr-active" : "") + (Active && useGradient ? " rr-active-gradient" : "");

            if (!string.IsNullOrWhiteSpace(Key)) output.Attributes.SetAttribute("data-key", Key);
            if (OpensPanel) output.Attributes.SetAttribute("data-opens-panel", "true");
            if (!string.IsNullOrWhiteSpace(PanelTarget)) output.Attributes.SetAttribute("data-panel-target", PanelTarget);

            var itemStyleVars = new System.Collections.Generic.List<string>();
            if (!string.IsNullOrWhiteSpace(HoverColor)) itemStyleVars.Add($"--rr-hover-color:{HoverColor}");
            if (!string.IsNullOrWhiteSpace(IconSize)) itemStyleVars.Add($"--rr-icon-size:{IconSize}");
            if (!string.IsNullOrWhiteSpace(FontSize)) itemStyleVars.Add($"--rr-label-size:{FontSize}");
            if (!string.IsNullOrWhiteSpace(FontWeight)) itemStyleVars.Add($"--rr-label-weight:{FontWeight}");

            string effectiveActiveIconColor;
            string effectiveActiveLabelColor;
            bool iconIsGradient;
            bool labelIsGradient;

            {
                // Rail-wide defaults (may be null), read from the parent
                // <report-rail>'s own ActiveColor / ActiveIconColor /
                // ActiveLabelColor — used only when this item doesn't
                // specify its own, so a gradient (or any color) set once
                // at the rail level applies to every active item without
                // having to repeat it on each <rail-item>.
                //
                // This block runs for EVERY item, not just the one that
                // happens to be server-rendered active="true". That's
                // required because the JS click handler can mark ANY
                // item active later (on click), and at that point it
                // needs to already know — from data attributes baked in
                // here — whether THIS item's icon/label should render as
                // a gradient, since the click handler has no way to
                // re-run this C# fallback logic itself.
                context.Items.TryGetValue("ReportRail.DefaultActiveColor", out var railActiveColorObj);
                context.Items.TryGetValue("ReportRail.DefaultActiveIconColor", out var railActiveIconColorObj);
                context.Items.TryGetValue("ReportRail.DefaultActiveLabelColor", out var railActiveLabelColorObj);
                var railActiveColor = railActiveColorObj as string;
                var railActiveIconColor = railActiveIconColorObj as string;
                var railActiveLabelColor = railActiveLabelColorObj as string;

                // Icon fallback chain: this item's ActiveIconColor -> this
                // item's ActiveColor -> this item's ActiveLabelColor ->
                // rail's ActiveIconColor -> rail's ActiveColor -> rail's
                // ActiveLabelColor -> this item's plain IconColor.
                effectiveActiveIconColor = !string.IsNullOrWhiteSpace(ActiveIconColor) ? ActiveIconColor
                    : (!string.IsNullOrWhiteSpace(ActiveColor) ? ActiveColor
                    : (!string.IsNullOrWhiteSpace(ActiveLabelColor) ? ActiveLabelColor
                    : (!string.IsNullOrWhiteSpace(railActiveIconColor) ? railActiveIconColor
                    : (!string.IsNullOrWhiteSpace(railActiveColor) ? railActiveColor
                    : (!string.IsNullOrWhiteSpace(railActiveLabelColor) ? railActiveLabelColor
                    : IconColor)))));

                // Label fallback chain: this item's ActiveLabelColor ->
                // this item's ActiveColor -> rail's ActiveLabelColor ->
                // rail's ActiveColor -> this item's plain LabelColor.
                effectiveActiveLabelColor = !string.IsNullOrWhiteSpace(ActiveLabelColor) ? ActiveLabelColor
                    : (!string.IsNullOrWhiteSpace(ActiveColor) ? ActiveColor
                    : (!string.IsNullOrWhiteSpace(railActiveLabelColor) ? railActiveLabelColor
                    : (!string.IsNullOrWhiteSpace(railActiveColor) ? railActiveColor
                    : LabelColor)));

                iconIsGradient = ReportRailColorUtil.IsGradient(effectiveActiveIconColor);
                labelIsGradient = ReportRailColorUtil.IsGradient(effectiveActiveLabelColor);

                // Always tell the client which classes to add WHEN this
                // item becomes active, regardless of whether it starts
                // active now. The click handler in report-sidebar.js
                // reads these two attributes and adds rr-icon-gradient /
                // rr-label-gradient itself, the same way it already reads
                // data-opens-panel / data-panel-target.
                if (iconIsGradient) output.Attributes.SetAttribute("data-icon-gradient", "true");
                if (labelIsGradient) output.Attributes.SetAttribute("data-label-gradient", "true");
            }

            if (Active)
            {
                if (iconIsGradient) classes += " rr-icon-gradient";
                if (labelIsGradient) classes += " rr-label-gradient";

                // Same rail-wide fallback as the icon/label colors above:
                // this item's own ActiveBarColor -> this item's
                // ActiveLabelColor -> this item's ActiveIconColor -> this
                // item's ActiveColor -> the RAIL's own ActiveBarColor ->
                // rail's ActiveLabelColor -> rail's ActiveIconColor ->
                // rail's ActiveColor. Without the rail fallback here, an
                // item that relies entirely on rail-wide colors (the
                // normal case now that active-icon-color/active-label-color
                // are usually set once on <report-rail>) would never get
                // --rr-active-bar at all, leaving the accent bar to fall
                // through to the CSS's own hardcoded purple/pink default
                // even though the icon and label correctly show the
                // intended gradient.
                context.Items.TryGetValue("ReportRail.DefaultActiveBarColor", out var railActiveBarColorObj);
                var railActiveBarColor = railActiveBarColorObj as string;
                context.Items.TryGetValue("ReportRail.DefaultActiveColor", out var railActiveColorObj2);
                context.Items.TryGetValue("ReportRail.DefaultActiveIconColor", out var railActiveIconColorObj2);
                context.Items.TryGetValue("ReportRail.DefaultActiveLabelColor", out var railActiveLabelColorObj2);
                var railActiveColor2 = railActiveColorObj2 as string;
                var railActiveIconColor2 = railActiveIconColorObj2 as string;
                var railActiveLabelColor2 = railActiveLabelColorObj2 as string;

                var effectiveItemBarColor = !string.IsNullOrWhiteSpace(ActiveBarColor) ? ActiveBarColor
                    : (!string.IsNullOrWhiteSpace(ActiveLabelColor) ? ActiveLabelColor
                    : (!string.IsNullOrWhiteSpace(ActiveIconColor) ? ActiveIconColor
                    : (!string.IsNullOrWhiteSpace(ActiveColor) ? ActiveColor
                    : (!string.IsNullOrWhiteSpace(railActiveBarColor) ? railActiveBarColor
                    : (!string.IsNullOrWhiteSpace(railActiveLabelColor2) ? railActiveLabelColor2
                    : (!string.IsNullOrWhiteSpace(railActiveIconColor2) ? railActiveIconColor2
                    : railActiveColor2))))));
                if (!string.IsNullOrWhiteSpace(effectiveItemBarColor)) itemStyleVars.Add($"--rr-active-bar:{effectiveItemBarColor}");

                if (!useGradient && !iconIsGradient && !labelIsGradient && !string.IsNullOrWhiteSpace(ActiveColor))
                {
                    itemStyleVars.Add($"--rr-active-color:{ActiveColor}");
                }
            }

            output.Attributes.SetAttribute("class", classes);

            var iconHtml = !string.IsNullOrWhiteSpace(Icon)
                ? $"<i class='fa fa-{Icon}'></i>"
                : "";

            var skipInlineColorForGradient = Active && useGradient;

            string iconStyle = "";
            if (iconIsGradient)
            {
                itemStyleVars.Add($"--rr-active-icon-color:{effectiveActiveIconColor}");
            }
            if (!iconIsGradient && !skipInlineColorForGradient && !string.IsNullOrWhiteSpace(Active ? effectiveActiveIconColor : IconColor))
            {
                iconStyle = $"style='color:{(Active ? effectiveActiveIconColor : IconColor)};'";
            }

            string labelStyle = "";
            if (labelIsGradient)
            {
                itemStyleVars.Add($"--rr-active-label-color:{effectiveActiveLabelColor}");
            }
            if (!labelIsGradient && !skipInlineColorForGradient && !string.IsNullOrWhiteSpace(Active ? effectiveActiveLabelColor : LabelColor))
            {
                labelStyle = $"style='color:{(Active ? effectiveActiveLabelColor : LabelColor)};'";
            }

            if (itemStyleVars.Count > 0)
            {
                output.Attributes.SetAttribute("style", string.Join("; ", itemStyleVars) + ";");
            }

            var linkTag = (!string.IsNullOrWhiteSpace(Href) && Href != "#") ? "a" : "button";
            var linkAttrs = linkTag == "a"
                ? $"href='{Href}' class='rr-item-btn'"
                : "type='button' class='rr-item-btn'";

            output.Content.SetHtmlContent($@"
                <{linkTag} {linkAttrs}>
                    <span class='rr-item-icon' {iconStyle}>{iconHtml}</span>
                    <span class='rr-item-label' {labelStyle}>{Label}</span>
                </{linkTag}>
            ");
        }
    }

    /// <summary>
    /// The white slide-out "Report Details" style panel. Can be used at
    /// top level (opened from a &lt;rail-item&gt;) or nested inside a
    /// &lt;nav-row&gt; as its child content, in which case it becomes a
    /// drill-in sub-panel that opens on top of its parent when that row
    /// is clicked, with an automatic back button.
    /// </summary>
    [HtmlTargetElement("report-panel")]
    [RestrictChildren("report-section", "nav-row")]
    public class ReportPanel : TagHelper
    {
        public string Id { get; set; }
        public string Title { get; set; } = "Report Details";
        public string PanelWidth { get; set; } = "520px";
        public bool IsNested { get; set; } = false;

        public string HeaderBackground { get; set; }
        public string PanelBackground { get; set; }
        public string TitleColor { get; set; }
        public string TitleFontSize { get; set; } = "24px";
        public string TitleFontWeight { get; set; } = "800";
        public string CloseButtonBackground { get; set; }
        public string CloseButtonColor { get; set; } = "#ffffff";
        public string CloseButtonBorderRadius { get; set; }
        public string BackButtonBorderRadius { get; set; }
        public bool ShowPinButton { get; set; } = false;
        public bool CloseOnSelect { get; set; } = false;

        public string RowHoverColor { get; set; }
        public string SectionLabelColor { get; set; }
        public string SectionSuffixColor { get; set; }
        public string SelectionColor { get; set; }
        public string ActiveBarColor { get; set; }
        public string ScrimColor { get; set; }

        public override async Task ProcessAsync(TagHelperContext context, TagHelperOutput output)
        {
            var childContent = await output.GetChildContentAsync();
            var innerHtml = childContent.GetContent();

            var isNested = IsNested || (context.Items.TryGetValue("ReportPanel.ForceNested", out var fn) && fn is bool fb && fb);

            output.TagName = "div";
            var nestedClass = isNested ? " rp-nested" : "";
            output.Attributes.SetAttribute("class", $"report-panel{nestedClass}");
            output.Attributes.SetAttribute("id", Id);
            output.Attributes.SetAttribute("role", "dialog");
            output.Attributes.SetAttribute("data-close-on-select", CloseOnSelect ? "true" : "false");
            output.Attributes.SetAttribute("aria-label", Title);

            var styleVars = new System.Collections.Generic.List<string>
            {
                $"width:{PanelWidth}",
                $"--rp-title-size:{TitleFontSize}",
                $"--rp-title-weight:{TitleFontWeight}"
            };
            if (!string.IsNullOrWhiteSpace(HeaderBackground)) styleVars.Add($"--rp-header-bg:{HeaderBackground}");
            if (!string.IsNullOrWhiteSpace(PanelBackground)) styleVars.Add($"--rp-panel-bg:{PanelBackground}");
            if (!string.IsNullOrWhiteSpace(TitleColor)) styleVars.Add($"--rp-title-color:{TitleColor}");
            if (!string.IsNullOrWhiteSpace(CloseButtonBackground)) styleVars.Add($"--rp-close-bg:{CloseButtonBackground}");
            if (!string.IsNullOrWhiteSpace(CloseButtonColor)) styleVars.Add($"--rp-close-color:{CloseButtonColor}");
            if (!string.IsNullOrWhiteSpace(CloseButtonBorderRadius)) styleVars.Add($"--rp-close-radius:{CloseButtonBorderRadius}");
            if (!string.IsNullOrWhiteSpace(BackButtonBorderRadius)) styleVars.Add($"--rp-back-radius:{BackButtonBorderRadius}");
            if (!string.IsNullOrWhiteSpace(RowHoverColor)) styleVars.Add($"--rp-row-hover:{RowHoverColor}");
            if (!string.IsNullOrWhiteSpace(SectionLabelColor)) styleVars.Add($"--rp-section-label-color:{SectionLabelColor}");
            if (!string.IsNullOrWhiteSpace(SectionSuffixColor)) styleVars.Add($"--rp-section-suffix-color:{SectionSuffixColor}");
            if (!string.IsNullOrWhiteSpace(SelectionColor)) styleVars.Add($"--rp-selection-color:{SelectionColor}");
            if (!string.IsNullOrWhiteSpace(ActiveBarColor)) styleVars.Add($"--rp-active-bar:{ActiveBarColor}");
            if (!string.IsNullOrWhiteSpace(ScrimColor)) styleVars.Add($"--rp-scrim-color:{ScrimColor}");
            output.Attributes.SetAttribute("style", string.Join("; ", styleVars) + ";");

            var backOrCloseBtn = isNested
                ? @"<button class='rp-back-btn' type='button' aria-label='Back'>
                        <svg width='20' height='20' viewBox='0 0 24 24' fill='none'><path d='M15 5l-7 7 7 7' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg>
                    </button>"
                : "";

            var closeBtnHtml = "<button class='rp-close-btn' type='button' aria-label='Close'>&#10005;</button>";

            var pinBtnHtml = ShowPinButton
                ? @"<button class='rp-pin-btn' type='button' aria-label='Pin panel open' aria-pressed='false'>
                        <svg width='18' height='18' viewBox='0 0 24 24' fill='none' class='rp-pin-icon'>
                            <path d='M12 2l1.5 5.5L19 9l-4 3.5L16 18l-4-3-4 3 1-5.5L5 9l5.5-1.5L12 2Z' stroke='currentColor' stroke-width='1.6' stroke-linejoin='round'/>
                        </svg>
                    </button>"
                : "";

            output.Content.SetHtmlContent($@"
                <div class='rp-header'>
                    <div class='rp-header-titlewrap'>
                        {backOrCloseBtn}
                        <h1>{Title}</h1>
                    </div>
                    <div class='rp-header-actions'>
                        {pinBtnHtml}
                        {(isNested ? "" : closeBtnHtml)}
                    </div>
                </div>
                <div class='rp-body'>
                    {innerHtml}
                </div>
            ");
        }
    }

    /// <summary>
    /// Collapsible group inside a &lt;report-panel&gt;, e.g. "Master Report".
    /// </summary>
    [HtmlTargetElement("report-section")]
    [RestrictChildren("report-item")]
    public class ReportSection : TagHelper
    {
        public string Label { get; set; }
        public bool DefaultOpen { get; set; } = false;
        public string LabelColor { get; set; }
        public string SuffixColor { get; set; }
        public string Suffix { get; set; } = "---";
        public string FontSize { get; set; }
        public string FontWeight { get; set; }
        public string HoverColor { get; set; }
        public string ChevronColor { get; set; }

        public override async Task ProcessAsync(TagHelperContext context, TagHelperOutput output)
        {
            var childContent = await output.GetChildContentAsync();
            var itemsHtml = childContent.GetContent();

            output.TagName = "div";
            output.Attributes.SetAttribute("class", "rp-section");

            var openClass = DefaultOpen ? " rp-open" : "";
            var labelStyle = !string.IsNullOrWhiteSpace(LabelColor) ? $"style='color:{LabelColor};'" : "";
            var suffixStyle = !string.IsNullOrWhiteSpace(SuffixColor) ? $"style='color:{SuffixColor};'" : "";

            var headerStyleVars = new System.Collections.Generic.List<string>();
            if (!string.IsNullOrWhiteSpace(HoverColor)) headerStyleVars.Add($"--rp-row-hover:{HoverColor}");
            if (!string.IsNullOrWhiteSpace(FontSize)) headerStyleVars.Add($"--rp-section-title-size:{FontSize}");
            if (!string.IsNullOrWhiteSpace(FontWeight)) headerStyleVars.Add($"--rp-section-title-weight:{FontWeight}");
            if (!string.IsNullOrWhiteSpace(ChevronColor)) headerStyleVars.Add($"--rp-chevron-color:{ChevronColor}");
            var headerStyleAttr = headerStyleVars.Count > 0 ? $"style='{string.Join("; ", headerStyleVars)};'" : "";

            output.Content.SetHtmlContent($@"
                <button type='button' class='rp-section-header' aria-expanded='{(DefaultOpen ? "true" : "false")}' {headerStyleAttr}>
                    <span class='rp-section-title' {labelStyle}>{Label}<span class='rp-section-suffix' {suffixStyle}>{Suffix}</span></span>
                    <span class='rp-chevron'><svg width='16' height='16' viewBox='0 0 24 24' fill='none'><path d='M5 8l7 7 7-7' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg></span>
                </button>
                <div class='rp-section-items{openClass}'>
                    {itemsHtml}
                </div>
            ");
        }
    }

    /// <summary>
    /// A single leaf report row inside a &lt;report-section&gt;.
    /// </summary>
    [HtmlTargetElement("report-item")]
    public class ReportItem : TagHelper
    {
        public string Id { get; set; }
        public string Label { get; set; }
        public string Icon { get; set; } = "file-text-o";
        public string Href { get; set; } = "#";
        public bool Active { get; set; } = false;
        public bool? CloseOnSelect { get; set; }

        public string IconColor { get; set; }
        public string IconSize { get; set; }
        public string LabelColor { get; set; }
        public string FontSize { get; set; }
        public string FontWeight { get; set; }
        public string HoverColor { get; set; }

        public string SelectionColor { get; set; }
        public string ActiveBarColor { get; set; }
        public string ActiveIconColor { get; set; }
        public string ActiveLabelColor { get; set; }
        public string ActiveFontWeight { get; set; } = "700";

        public override void Process(TagHelperContext context, TagHelperOutput output)
        {
            var linkTag = (!string.IsNullOrWhiteSpace(Href) && Href != "#") ? "a" : "button";
            output.TagName = linkTag;

            var classes = "rp-item-row" + (Active ? " rp-active" : "");
            output.Attributes.SetAttribute("class", classes);
            if (linkTag == "a") output.Attributes.SetAttribute("href", Href);
            else output.Attributes.SetAttribute("type", "button");
            if (!string.IsNullOrWhiteSpace(Id))
            {
                output.Attributes.SetAttribute("id", Id);
                output.Attributes.SetAttribute("data-id", Id);
            }
            output.Attributes.SetAttribute("data-label", Label);
            if (CloseOnSelect.HasValue) output.Attributes.SetAttribute("data-close-on-select", CloseOnSelect.Value ? "true" : "false");

            var rowStyleVars = new System.Collections.Generic.List<string>();
            if (!string.IsNullOrWhiteSpace(HoverColor)) rowStyleVars.Add($"--rp-row-hover:{HoverColor}");
            if (!string.IsNullOrWhiteSpace(FontSize)) rowStyleVars.Add($"--rp-item-font-size:{FontSize}");
            if (!string.IsNullOrWhiteSpace(IconSize)) rowStyleVars.Add($"--rp-item-icon-size:{IconSize}");

            if (!string.IsNullOrWhiteSpace(IconColor)) rowStyleVars.Add($"--rp-item-icon-color:{IconColor}");
            if (!string.IsNullOrWhiteSpace(LabelColor)) rowStyleVars.Add($"--rp-item-label-color:{LabelColor}");

            // Same gradient/var() detection as the rail's RailItem: a
            // plain `color:` can't render a gradient function or a
            // var(...) reference that might resolve to one, so those
            // values are routed through a background-clip: text rule
            // instead (see .rp-item-row.rp-active[data-icon-gradient="true"]
            // in the CSS). data-icon-gradient / data-label-gradient are
            // stamped on EVERY row (not just ones server-rendered
            // active="true") and the CSS vars are always emitted too, so
            // clicking a row to make it active later (via JS, which only
            // ever toggles the .rp-active class) picks up the same
            // gradient the row would have shown if it had started active.
            var effectiveActiveIconColor = !string.IsNullOrWhiteSpace(ActiveIconColor) ? ActiveIconColor
                : ActiveLabelColor;
            var effectiveActiveLabelColor = ActiveLabelColor;

            var iconIsGradient = ReportRailColorUtil.IsGradient(effectiveActiveIconColor);
            var labelIsGradient = ReportRailColorUtil.IsGradient(effectiveActiveLabelColor);

            if (!string.IsNullOrWhiteSpace(effectiveActiveIconColor)) rowStyleVars.Add($"--rp-item-active-icon-color:{effectiveActiveIconColor}");
            if (!string.IsNullOrWhiteSpace(effectiveActiveLabelColor)) rowStyleVars.Add($"--rp-item-active-label-color:{effectiveActiveLabelColor}");

            if (iconIsGradient) output.Attributes.SetAttribute("data-icon-gradient", "true");
            if (labelIsGradient) output.Attributes.SetAttribute("data-label-gradient", "true");

            if (!string.IsNullOrWhiteSpace(SelectionColor)) rowStyleVars.Add($"--rp-item-selection-color:{SelectionColor}");

            var effectiveRowBarColor = !string.IsNullOrWhiteSpace(ActiveBarColor) ? ActiveBarColor
                : (!string.IsNullOrWhiteSpace(ActiveLabelColor) ? ActiveLabelColor
                : ActiveIconColor);
            if (!string.IsNullOrWhiteSpace(effectiveRowBarColor)) rowStyleVars.Add($"--rp-item-active-bar:{effectiveRowBarColor}");

            if (!string.IsNullOrWhiteSpace(FontWeight)) rowStyleVars.Add($"--rp-item-font-weight:{FontWeight}");
            if (!string.IsNullOrWhiteSpace(ActiveFontWeight)) rowStyleVars.Add($"--rp-item-active-font-weight:{ActiveFontWeight}");

            if (rowStyleVars.Count > 0)
            {
                output.Attributes.SetAttribute("style", string.Join("; ", rowStyleVars) + ";");
            }

            output.Content.SetHtmlContent($@"
                <span class='rp-item-icon'><i class='fa fa-{Icon}'></i></span>
                <span class='rp-item-label-text'>{Label}</span>
            ");
        }
    }

    /// <summary>
    /// A flat, chevron-right row inside a &lt;report-panel&gt;.
    /// </summary>
    [HtmlTargetElement("nav-row")]
    [RestrictChildren("report-panel")]
    public class NavRow : TagHelper
    {
        public string Id { get; set; }
        public string Label { get; set; }
        public string Href { get; set; } = "#";
        public string Suffix { get; set; } = "---";
        public string LabelColor { get; set; }
        public string SuffixColor { get; set; }
        public string FontSize { get; set; }
        public string FontWeight { get; set; }
        public string HoverColor { get; set; }
        public string ChevronColor { get; set; }
        public bool? CloseOnSelect { get; set; }

        // Optional Font Awesome icon name shown before the label, same
        // convention as <report-item icon="...">. Leave unset for the
        // original icon-less look (label + chevron only).
        public string Icon { get; set; }
        public string IconColor { get; set; }
        public string IconSize { get; set; }

        // Icon color when this row is the active/selected one. Same
        // gradient/var() detection as the label color below — falls back
        // to ActiveLabelColor when not set, so one gradient value can
        // color the icon, label, and bar together.
        public string ActiveIconColor { get; set; }

        // Label color when this row is the active/selected one (only
        // ever applies to a plain nav-row with no nested panel — one
        // that drills into a sub-panel never becomes "active", per the
        // JS). May be a flat color, a gradient function
        // (linear-gradient/radial-gradient/conic-gradient), or a
        // var(...) reference that might itself resolve to a gradient —
        // same detection as RailItem / ReportItem, via ReportRailColorUtil.
        public string ActiveLabelColor { get; set; }

        // Left accent bar color/gradient when this row is active. Falls
        // back to this row's own ActiveLabelColor when not set (so
        // setting only active-label-color unifies the label and the bar
        // together, matching the same convention used on <rail-item> and
        // <report-item>), then to the panel-wide/rail-wide default the
        // CSS itself already falls back to. Unlike ActiveLabelColor, the
        // bar is a `background` in CSS, so it accepts a gradient value
        // directly with no special gradient-detection handling needed.
        public string ActiveBarColor { get; set; }

        public override async Task ProcessAsync(TagHelperContext context, TagHelperOutput output)
        {
            context.Items["ReportPanel.ForceNested"] = true;

            var childContent = await output.GetChildContentAsync();
            var nestedPanelHtml = childContent.GetContent().ToString().Trim();
            var hasNestedPanel = !string.IsNullOrWhiteSpace(nestedPanelHtml);

            string nestedPanelId = null;
            if (hasNestedPanel)
            {
                var idMatch = System.Text.RegularExpressions.Regex.Match(nestedPanelHtml, "id=[\"']([^\"']+)[\"']");
                if (idMatch.Success) nestedPanelId = idMatch.Groups[1].Value;
            }

            var linkTag = (!hasNestedPanel && !string.IsNullOrWhiteSpace(Href) && Href != "#") ? "a" : "button";
            output.TagName = linkTag;
            output.Attributes.SetAttribute("class", "rp-nav-row");
            if (linkTag == "a") output.Attributes.SetAttribute("href", Href);
            else output.Attributes.SetAttribute("type", "button");
            if (!string.IsNullOrWhiteSpace(Id))
            {
                output.Attributes.SetAttribute("id", Id);
                output.Attributes.SetAttribute("data-id", Id);
            }
            output.Attributes.SetAttribute("data-label", Label);
            if (!string.IsNullOrWhiteSpace(nestedPanelId)) output.Attributes.SetAttribute("data-nested-panel", nestedPanelId);
            if (CloseOnSelect.HasValue) output.Attributes.SetAttribute("data-close-on-select", CloseOnSelect.Value ? "true" : "false");

            var labelStyle = !string.IsNullOrWhiteSpace(LabelColor) ? $"style='color:{LabelColor};'" : "";
            var suffixStyle = !string.IsNullOrWhiteSpace(SuffixColor) ? $"style='color:{SuffixColor};'" : "";

            var rowStyleVars = new System.Collections.Generic.List<string>();
            if (!string.IsNullOrWhiteSpace(HoverColor)) rowStyleVars.Add($"--rp-row-hover:{HoverColor}");
            if (!string.IsNullOrWhiteSpace(FontSize)) rowStyleVars.Add($"--rp-section-title-size:{FontSize}");
            if (!string.IsNullOrWhiteSpace(FontWeight)) rowStyleVars.Add($"--rp-section-title-weight:{FontWeight}");
            if (!string.IsNullOrWhiteSpace(ChevronColor)) rowStyleVars.Add($"--rp-chevron-color:{ChevronColor}");

            // Same gradient/var() detection as RailItem / ReportItem: a
            // plain `color:` can't render a gradient function or a
            // var(...) reference that might resolve to one, so it's
            // routed through a background-clip: text rule instead (see
            // .rp-nav-row.rp-active[data-label-gradient="true"] in the
            // CSS). data-label-gradient is stamped on every row
            // regardless of active state, and the CSS var is always
            // emitted too, since NavRow's active state is entirely
            // JS-driven (no Active property/attribute exists on this tag
            // helper at all — see report-sidebar.js), so this needs to
            // be ready the moment .rp-active is toggled on by a click.
            var labelIsGradient = ReportRailColorUtil.IsGradient(ActiveLabelColor);
            if (!string.IsNullOrWhiteSpace(ActiveLabelColor)) rowStyleVars.Add($"--rp-item-active-label-color:{ActiveLabelColor}");
            if (labelIsGradient) output.Attributes.SetAttribute("data-label-gradient", "true");

            // Icon color (unselected) and active-icon-color, same
            // gradient/var() detection as the label above. Falls back to
            // ActiveLabelColor when this row's own ActiveIconColor isn't
            // set, so one gradient value on active-label-color alone can
            // still color the icon too, matching the unification already
            // used on <rail-item> and <report-item>.
            if (!string.IsNullOrWhiteSpace(IconColor)) rowStyleVars.Add($"--rp-item-icon-color:{IconColor}");
            if (!string.IsNullOrWhiteSpace(IconSize)) rowStyleVars.Add($"--rp-item-icon-size:{IconSize}");

            var effectiveActiveIconColor = !string.IsNullOrWhiteSpace(ActiveIconColor) ? ActiveIconColor : ActiveLabelColor;
            var iconIsGradient = ReportRailColorUtil.IsGradient(effectiveActiveIconColor);
            if (!string.IsNullOrWhiteSpace(effectiveActiveIconColor)) rowStyleVars.Add($"--rp-item-active-icon-color:{effectiveActiveIconColor}");
            if (iconIsGradient) output.Attributes.SetAttribute("data-icon-gradient", "true");

            // Bar color: this row's own ActiveBarColor -> this row's own
            // ActiveLabelColor (so setting only active-label-color also
            // recolors the bar, same convention as rail-item/report-item)
            // -> falls through to CSS's own --rp-active-bar/hardcoded
            // default if neither is set. A gradient value here is fine
            // as-is since --rp-item-active-bar is consumed as a
            // `background`, which accepts gradients natively.
            var effectiveNavBarColor = !string.IsNullOrWhiteSpace(ActiveBarColor) ? ActiveBarColor : ActiveLabelColor;
            if (!string.IsNullOrWhiteSpace(effectiveNavBarColor)) rowStyleVars.Add($"--rp-item-active-bar:{effectiveNavBarColor}");

            if (rowStyleVars.Count > 0)
            {
                output.Attributes.SetAttribute("style", string.Join("; ", rowStyleVars) + ";");
            }

            // Icon markup: same span/class as <report-item> ('rp-item-icon'),
            // rendered before the label. Omitted entirely when no Icon is
            // set, preserving the original icon-less look for existing
            // nav-rows that don't specify one.
            var iconHtml = !string.IsNullOrWhiteSpace(Icon)
                ? $"<span class='rp-item-icon'><i class='fa fa-{Icon}'></i></span>"
                : "";

            output.Content.SetHtmlContent($@"
                {iconHtml}
                <span class='rp-section-title rp-nav-row-title' {labelStyle}>{Label}<span class='rp-section-suffix' {suffixStyle}>{Suffix}</span></span>
                <span class='rp-chevron' style='transform:none;'><svg width='16' height='16' viewBox='0 0 24 24' fill='none'><path d='M9 5l6 7-6 7' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg></span>
            ");

            if (hasNestedPanel)
            {
                output.PostElement.SetHtmlContent(nestedPanelHtml);
            }
        }
    }

    /// <summary>
    /// Shared helper for detecting whether a color string supplied to
    /// ActiveIconColor / ActiveLabelColor on the rail is actually a CSS
    /// gradient function rather than a flat color, so the rail can switch
    /// that icon/label into background-clip "gradient text" mode instead
    /// of trying (and failing) to apply it as a plain `color`.
    /// </summary>
    internal static class ReportRailColorUtil
    {
        // Returns true for values that should be painted via
        // background-clip: text (the "gradient foreground" path) rather
        // than a plain `color:` declaration. This includes actual
        // gradient functions AND var(...) references, since a CSS
        // variable's real value isn't known at Razor-render time — it
        // might resolve to a gradient (e.g. active-icon-color="var(--app-gradient)"
        // where --app-gradient is defined elsewhere as linear-gradient(...)).
        // Routing var(...) through the background-clip path is safe even
        // when the variable turns out to hold a flat color, because
        // `background: <flat-color>` still paints correctly and
        // background-clip: text with a solid background looks identical
        // to a normal solid-colored icon/label.
        public static bool IsGradient(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return false;
            var trimmed = value.TrimStart();
            return trimmed.StartsWith("linear-gradient(", System.StringComparison.OrdinalIgnoreCase)
                || trimmed.StartsWith("radial-gradient(", System.StringComparison.OrdinalIgnoreCase)
                || trimmed.StartsWith("conic-gradient(", System.StringComparison.OrdinalIgnoreCase)
                || trimmed.StartsWith("repeating-linear-gradient(", System.StringComparison.OrdinalIgnoreCase)
                || trimmed.StartsWith("repeating-radial-gradient(", System.StringComparison.OrdinalIgnoreCase)
                || trimmed.StartsWith("var(", System.StringComparison.OrdinalIgnoreCase);
        }
    }
}