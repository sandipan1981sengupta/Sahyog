using Microsoft.AspNetCore.Razor.TagHelpers;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace Sahyog.Web.TagHelpers
{
    /// <summary>
    /// Shared helper for foreground/text colors that should also accept a
    /// CSS gradient() function, not just a flat color. A plain CSS `color`
    /// property can't render a gradient directly, so wherever this
    /// applies, the tag helpers detect a gradient string and flip on a
    /// matching data-*-gradient="true" attribute — the stylesheet then
    /// switches that element to the background-clip:text technique
    /// instead of a flat `color`. Plain colors (hex, rgb, named, CSS
    /// vars) are completely unaffected and keep using `color` as normal.
    /// </summary>
    internal static class GradientColorHelper
    {
        public static bool IsGradient(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return false;
            var v = value.ToLowerInvariant();
            return v.Contains("gradient(");
        }
    }

    /// <summary>
    /// A strip of rotated, vertical tab buttons docked to a screen edge —
    /// e.g. "Joint Account info", "Nominee Info", "Document" stacked
    /// along the right side. Each &lt;tab-button&gt; opens its own
    /// &lt;tab-panel&gt;, sliding in from whichever edge that panel
    /// specifies (independently per panel — one button's panel can slide
    /// from the left while another's slides from the right).
    ///
    /// Usage:
    /// <tab-strip id="AccountTabs" dock-side="right">
    ///     <tab-button label="Joint Account info" target-panel="JointAccountPanel"
    ///                 label-color="#1d5fae" active-label-color="#c22a8d"
    ///                 bar-top-color="#1d5fae" bar-bottom-color="#c22a8d"></tab-button>
    ///     <tab-button label="Nominee Info" target-panel="NomineePanel"
    ///                 label-color="#c22a8d" active-label-color="#1d5fae"></tab-button>
    ///     <tab-button label="Document" target-panel="DocumentPanel"></tab-button>
    /// </tab-strip>
    ///
    /// <tab-panel id="JointAccountPanel" title="Joint account info" side="right">
    ///     <partial name="_JointAccountInfo" />
    /// </tab-panel>
    ///
    /// <tab-panel id="NomineePanel" title="Nominee Info" side="right" source-url="/Account/NomineeInfoPartial">
    /// </tab-panel>
    /// </summary>
    [HtmlTargetElement("tab-strip")]
    [RestrictChildren("tab-button")]
    public class TabStrip : TagHelper
    {
        public string Id { get; set; }
        public string DockSide { get; set; } = "right";   // "right" or "left" — which screen edge the strip itself is docked to
        public string Top { get; set; } = "120px";           // optional — distance from the top of the viewport to the first tab
        public string Gap { get; set; } = "0px";               // optional — vertical gap between stacked tab buttons
        public string BackgroundColor { get; set; }              // optional — background behind each tab button (defaults to theme)
        public string ButtonWidth { get; set; }                    // optional — the LENGTH of each rotated tab (visually its "height" once rotated), e.g. "160px"
        public string ButtonThickness { get; set; } = "40px";        // optional — the rotated tab's short dimension (visually its "width" once rotated)

        public override async Task ProcessAsync(TagHelperContext context, TagHelperOutput output)
        {
            var childContent = await output.GetChildContentAsync();
            var itemsHtml = childContent.GetContent();

            var dockSide = (DockSide ?? "right").ToLower() == "left" ? "left" : "right";
            context.Items["TabStrip.DockSide"] = dockSide;

            output.TagName = "div";
            output.Attributes.SetAttribute("class", $"tab-strip tab-strip-{dockSide}");
            output.Attributes.SetAttribute("id", Id);

            var styleVars = new List<string>
            {
                $"top:{Top}",
                $"--ts-gap:{Gap}",
                $"--ts-btn-thickness:{ButtonThickness}"
            };
            if (!string.IsNullOrWhiteSpace(ButtonWidth)) styleVars.Add($"--ts-btn-length:{ButtonWidth}");
            if (!string.IsNullOrWhiteSpace(BackgroundColor)) styleVars.Add($"--ts-btn-bg:{BackgroundColor}");
            output.Attributes.SetAttribute("style", string.Join("; ", styleVars) + ";");

            output.Content.SetHtmlContent($@"
                <div class='ts-list'>
                    {itemsHtml}
                </div>
            ");
        }
    }

    /// <summary>
    /// A single rotated tab button inside a &lt;tab-strip&gt;. Clicking it
    /// opens the &lt;tab-panel&gt; named by TargetPanel, and marks this
    /// button (and only this one, within its strip) as active.
    /// </summary>
    [HtmlTargetElement("tab-button")]
    public class TabButton : TagHelper
    {
        public string Label { get; set; }
        public string TargetPanel { get; set; }          // id of the <tab-panel> this button opens
        public bool Active { get; set; } = false;             // pre-selected on page load

        // Content
        public string BackgroundColor { get; set; }             // optional — this button's own background, overrides strip default
        public string ActiveBackgroundColor { get; set; }          // optional — background while this button is the active/selected one

        // Foreground / label
        public string LabelColor { get; set; }                       // optional — this button's own label color (unselected)
        public string ActiveLabelColor { get; set; }                   // optional — label color while active
        public string FontSize { get; set; } = "14px";
        public string FontWeight { get; set; } = "700";

        // The two-tone accent bar along one edge of the tab (visible in
        // the reference screenshot as a blue-to-pink gradient bar)
        public string BarTopColor { get; set; }               // optional — top half color of the accent bar
        public string BarBottomColor { get; set; }               // optional — bottom half color of the accent bar
        public string BarWidth { get; set; } = "3px";

        // Sizing overrides for just this one button
        public string Width { get; set; }               // overrides the strip's ButtonWidth for this button only
        public string Height { get; set; }                // overrides the strip's ButtonThickness for this button only

        public override void Process(TagHelperContext context, TagHelperOutput output)
        {
            var dockSide = context.Items.TryGetValue("TabStrip.DockSide", out var d) ? d as string : "right";

            output.TagName = "button";
            output.Attributes.SetAttribute("type", "button");
            output.Attributes.SetAttribute("class", "ts-tab" + (Active ? " ts-active" : ""));
            output.Attributes.SetAttribute("data-target-panel", TargetPanel ?? "");
            output.Attributes.SetAttribute("data-dock-side", dockSide);

            // If either label color is a gradient() string, flip on its
            // OWN data attribute so the CSS switches that state to the
            // background-clip:text technique instead of a flat `color`.
            // These are independent — a panel can have a gradient resting
            // label AND a separately-gradient active label at once.
            if (GradientColorHelper.IsGradient(LabelColor))
            {
                output.Attributes.SetAttribute("data-label-gradient", "true");
            }
            if (GradientColorHelper.IsGradient(ActiveLabelColor))
            {
                output.Attributes.SetAttribute("data-active-label-gradient", "true");
            }

            var styleVars = new List<string>();
            if (!string.IsNullOrWhiteSpace(Width)) styleVars.Add($"--ts-btn-length:{Width}");
            if (!string.IsNullOrWhiteSpace(Height)) styleVars.Add($"--ts-btn-thickness:{Height}");
            if (!string.IsNullOrWhiteSpace(BackgroundColor)) styleVars.Add($"--ts-tab-bg:{BackgroundColor}");
            if (!string.IsNullOrWhiteSpace(ActiveBackgroundColor)) styleVars.Add($"--ts-tab-active-bg:{ActiveBackgroundColor}");
            if (!string.IsNullOrWhiteSpace(LabelColor)) styleVars.Add($"--ts-tab-label-color:{LabelColor}");
            if (!string.IsNullOrWhiteSpace(ActiveLabelColor)) styleVars.Add($"--ts-tab-active-label-color:{ActiveLabelColor}");
            if (!string.IsNullOrWhiteSpace(FontSize)) styleVars.Add($"--ts-tab-font-size:{FontSize}");
            if (!string.IsNullOrWhiteSpace(FontWeight)) styleVars.Add($"--ts-tab-font-weight:{FontWeight}");
            if (!string.IsNullOrWhiteSpace(BarTopColor)) styleVars.Add($"--ts-bar-top:{BarTopColor}");
            if (!string.IsNullOrWhiteSpace(BarBottomColor)) styleVars.Add($"--ts-bar-bottom:{BarBottomColor}");
            if (!string.IsNullOrWhiteSpace(BarWidth)) styleVars.Add($"--ts-bar-width:{BarWidth}");
            if (styleVars.Count > 0) output.Attributes.SetAttribute("style", string.Join("; ", styleVars) + ";");

            output.Content.SetHtmlContent($@"
                <span class='ts-tab-inner'>
                    <span class='ts-tab-bar'></span>
                    <span class='ts-tab-label'>{Label}</span>
                </span>
            ");
        }
    }

    /// <summary>
    /// A slide-out panel opened by a &lt;tab-button&gt;. Content can come
    /// three ways:
    ///
    /// 1. Inline Razor child content — write a &lt;partial&gt;, a
    ///    view component, or plain HTML directly inside the tag:
    ///        <tab-panel id="JointAccountPanel" title="Joint account info">
    ///            <partial name="_JointAccountInfo" />
    ///        </tab-panel>
    ///    This renders at page-load time, same as any other Razor content.
    ///
    /// 2. SourceUrl — an endpoint that returns a partial view's HTML,
    ///    fetched over AJAX the FIRST time this panel is opened (then
    ///    cached in the DOM, not re-fetched on subsequent opens):
    ///        <tab-panel id="NomineePanel" title="Nominee Info"
    ///                   source-url="/Account/NomineeInfoPartial">
    ///        </tab-panel>
    ///    Use this for content that's expensive to render, depends on
    ///    data that might change between opens, or that you'd rather not
    ///    load until the person actually asks to see it.
    ///
    /// 3. Sections switched by round buttons on the glass strip — add a
    ///    &lt;tab-panel-nav&gt; (see TabPanelNav.cs). Each
    ///    &lt;tab-nav-button&gt; shows one section and can lazy-load it
    ///    with its own source-url. Don't combine this with the panel's
    ///    own SourceUrl — that replaces the whole body, sections included.
    ///        <tab-panel id="SecurityPanel" title="Security" strip-extra="110px">
    ///            <tab-panel-nav>
    ///                <tab-nav-button icon="car" label="Vehicle info" target-section="SecVehicle"
    ///                                source-url="/Loan/VehicleInfoPartial"></tab-nav-button>
    ///            </tab-panel-nav>
    ///            <div id="SecVehicle"></div>
    ///        </tab-panel>
    /// </summary>
    [HtmlTargetElement("tab-panel")]
    public class TabPanel : TagHelper
    {
        public string Id { get; set; }
        public string Title { get; set; }
        public string Side { get; set; } = "right";     // "right" or "left" — which edge this panel slides in from, independent of any other panel
        public string PanelWidth { get; set; } = "600px";
        public string PanelHeight { get; set; }             // optional — any valid CSS length: "780px", "100%", "calc(100vh - 160px)". Leave unset to auto-fill the space between PanelMarginTop and PanelMarginBottom (the original behavior).
        public string SourceUrl { get; set; }              // optional — AJAX endpoint returning partial view HTML, loaded on first open

        // Whether clicking anywhere outside this panel closes it.
        // Defaults to true (matches the original behavior). Set to
        // false if the panel should only close via its own close
        // button or a programmatic window.closeTabPanel(id) call —
        // useful for panels holding an in-progress form the person
        // shouldn't be able to dismiss by an accidental stray click.
        public bool CloseOnOutsideClick { get; set; } = true;

        // Header styling
        public string HeaderBackground { get; set; }
        public string TitleColor { get; set; }
        public string TitleFontSize { get; set; } = "28px";
        public string TitleFontWeight { get; set; } = "800";
        public string CloseButtonBackground { get; set; }     // accepts gradient() or flat color
        public string CloseButtonColor { get; set; } = "#ffffff";
        public string CloseButtonBorderRadius { get; set; } = "10px";

        // Panel body
        public string PanelBackground { get; set; }
        public string PanelBorderRadius { get; set; } = "16px";  // rounds all four corners uniformly, since the panel now floats clear of the screen edge on every side (see the margin properties below) rather than sitting flush against it

        // Panel margin — gap between the PANEL and the true screen edge,
        // one value per side. All default to 20px like the old single
        // PanelMargin did; set any of them individually to change just
        // that side (e.g. a taller panel with less top margin).
        public string PanelMarginTop { get; set; } = "20px";
        public string PanelMarginRight { get; set; } = "20px";
        public string PanelMarginBottom { get; set; } = "20px";
        public string PanelMarginLeft { get; set; } = "20px";

        // Backing strip — the visible gray frame behind the panel (see
        // tab-panel.js's ensureStrip). Sized independently from the
        // panel: StripExtra widens it past the panel's sides, the strip
        // margins control how far it insets from the top/bottom of the
        // screen (usually smaller than the panel's own margins so the
        // strip peeks out above/below the panel too), and the four
        // StripRadius* corners
        // rounds its own corners so it doesn't look like a flat slab
        // behind the rounded panel.
        public string StripColor { get; set; }
        public string StripExtra { get; set; } = "20px";           // how much wider than the panel the strip is
        public string StripHeight { get; set; }                       // optional — any valid CSS length: "780px", "100%", "calc(100vh - 160px)". Leave unset to auto-fill between StripMarginTop and StripMarginBottom, same pattern as PanelHeight.
        public string StripMarginTop { get; set; } = "12px";
        public string StripMarginBottom { get; set; } = "12px";

        // Strip corner radii — one value per corner, independent of each
        // other and of the panel's own PanelBorderRadius. All default to
        // 20px. Named by position regardless of which screen edge the
        // strip is docked to (top-left is always top-left on screen).
        public string StripRadiusTopLeft { get; set; } = "20px";
        public string StripRadiusTopRight { get; set; } = "20px";
        public string StripRadiusBottomRight { get; set; } = "20px";
        public string StripRadiusBottomLeft { get; set; } = "20px";

        public string StripShadow { get; set; } = "0 4px 20px rgba(0, 0, 0, 0.1)";  // gives the strip depth against the page, separate from the panel's own box-shadow

        // Optional decorative badge icon sitting astride the panel's top
        // outer corner — purely visual, not interactive (per the
        // reference design). Uses a Font Awesome icon name, same
        // convention as report-sidebar's icons.
        public string CornerIcon { get; set; }                      // e.g. "pencil", "edit" — omit to skip rendering the badge entirely
        public string CornerIconColor { get; set; } = "#7c3aed";      // icon glyph color
        public string CornerIconBackground { get; set; } = "#ffffff";  // badge circle background
        public string CornerIconBorderColor { get; set; } = "#ffffff";   // the badge's 2px ring color, gives it a clean edge against the strip/panel behind it
        public string CornerIconSize { get; set; } = "40px";             // badge circle diameter

        // Header layout — the badge straddles the panel's top-left/
        // top-right corner (half over the visible strip, half over the
        // panel), so it sits OUTSIDE the header's own box. These two
        // control the header's own text inset, independent of the badge:
        public string HeaderPadTop { get; set; } = "28px";
        public string HeaderPadLeft { get; set; } = "32px";
        public string CornerIconTop { get; set; }                  // optional override — defaults to 16px from the true screen top; the badge is position:fixed and aligns with the strip's top edge, not the panel
        public string CornerIconInset { get; set; }                  // optional override — how far in from the strip's outer edge the badge's center sits; defaults to 20px

        public override async Task ProcessAsync(TagHelperContext context, TagHelperOutput output)
        {
            // ADDED — shared hand-off object for <tab-panel-nav>.
            // Must be created BEFORE GetChildContentAsync(), because the
            // nav is a CHILD tag helper: it renders during that call and
            // writes its HTML into navCtx.Html. Child tag helpers can't
            // add new keys the parent would see (context.Items is
            // copy-on-write going down), but they CAN fill in this
            // object the parent put there first. See TabPanelNav.cs.
            var navCtx = new TabPanelNavContext();
            context.Items[typeof(TabPanelNavContext)] = navCtx;

            var childContent = await output.GetChildContentAsync();
            var innerHtml = childContent.GetContent();

            var side = (Side ?? "right").ToLower() == "left" ? "left" : "right";

            output.TagName = "div";
            output.Attributes.SetAttribute("class", $"tab-panel tab-panel-{side}");
            output.Attributes.SetAttribute("id", Id);
            output.Attributes.SetAttribute("role", "dialog");
            output.Attributes.SetAttribute("aria-label", Title ?? "");
            output.Attributes.SetAttribute("data-close-on-outside", CloseOnOutsideClick ? "true" : "false");

            // Title, close icon, and corner icon colors all render as
            // plain text/glyphs, which a flat CSS `color` can't turn
            // into a gradient — so each gets its own data attribute when
            // it's a gradient() string, matching the pattern used for
            // tab labels above. The stylesheet switches that specific
            // element to background-clip:text only when its attribute is
            // present; plain colors never set these and are unaffected.
            if (GradientColorHelper.IsGradient(TitleColor))
            {
                output.Attributes.SetAttribute("data-title-gradient", "true");
            }
            if (GradientColorHelper.IsGradient(CloseButtonColor))
            {
                output.Attributes.SetAttribute("data-close-color-gradient", "true");
            }
            if (GradientColorHelper.IsGradient(CornerIconColor))
            {
                output.Attributes.SetAttribute("data-icon-gradient", "true");
            }
            if (!string.IsNullOrWhiteSpace(SourceUrl))
            {
                output.Attributes.SetAttribute("data-source-url", SourceUrl);
                output.Attributes.SetAttribute("data-loaded", "false");
            }

            var styleVars = new List<string> { $"width:{PanelWidth}", $"--tp-panel-w:{PanelWidth}" };
            if (!string.IsNullOrWhiteSpace(PanelHeight)) styleVars.Add($"--tp-panel-height:{PanelHeight}");
            if (!string.IsNullOrWhiteSpace(HeaderBackground)) styleVars.Add($"--tp-header-bg:{HeaderBackground}");
            if (!string.IsNullOrWhiteSpace(TitleColor)) styleVars.Add($"--tp-title-color:{TitleColor}");
            if (!string.IsNullOrWhiteSpace(TitleFontSize)) styleVars.Add($"--tp-title-size:{TitleFontSize}");
            if (!string.IsNullOrWhiteSpace(TitleFontWeight)) styleVars.Add($"--tp-title-weight:{TitleFontWeight}");
            if (!string.IsNullOrWhiteSpace(CloseButtonBackground)) styleVars.Add($"--tp-close-bg:{CloseButtonBackground}");
            if (!string.IsNullOrWhiteSpace(CloseButtonColor)) styleVars.Add($"--tp-close-color:{CloseButtonColor}");
            if (!string.IsNullOrWhiteSpace(CloseButtonBorderRadius)) styleVars.Add($"--tp-close-radius:{CloseButtonBorderRadius}");
            if (!string.IsNullOrWhiteSpace(PanelBackground)) styleVars.Add($"--tp-panel-bg:{PanelBackground}");
            if (!string.IsNullOrWhiteSpace(PanelBorderRadius)) styleVars.Add($"--tp-panel-radius:{PanelBorderRadius}");
            if (!string.IsNullOrWhiteSpace(PanelMarginTop)) styleVars.Add($"--tp-panel-margin-top:{PanelMarginTop}");
            if (!string.IsNullOrWhiteSpace(PanelMarginRight)) styleVars.Add($"--tp-panel-margin-right:{PanelMarginRight}");
            if (!string.IsNullOrWhiteSpace(PanelMarginBottom)) styleVars.Add($"--tp-panel-margin-bottom:{PanelMarginBottom}");
            if (!string.IsNullOrWhiteSpace(PanelMarginLeft)) styleVars.Add($"--tp-panel-margin-left:{PanelMarginLeft}");
            if (!string.IsNullOrWhiteSpace(StripColor)) styleVars.Add($"--tp-strip-color:{StripColor}");
            if (!string.IsNullOrWhiteSpace(StripExtra)) styleVars.Add($"--tp-strip-extra:{StripExtra}");
            if (!string.IsNullOrWhiteSpace(StripHeight)) styleVars.Add($"--tp-strip-height:{StripHeight}");
            if (!string.IsNullOrWhiteSpace(StripMarginTop)) styleVars.Add($"--tp-strip-margin-top:{StripMarginTop}");
            if (!string.IsNullOrWhiteSpace(StripMarginBottom)) styleVars.Add($"--tp-strip-margin-bottom:{StripMarginBottom}");
            if (!string.IsNullOrWhiteSpace(StripRadiusTopLeft)) styleVars.Add($"--tp-strip-radius-tl:{StripRadiusTopLeft}");
            if (!string.IsNullOrWhiteSpace(StripRadiusTopRight)) styleVars.Add($"--tp-strip-radius-tr:{StripRadiusTopRight}");
            if (!string.IsNullOrWhiteSpace(StripRadiusBottomRight)) styleVars.Add($"--tp-strip-radius-br:{StripRadiusBottomRight}");
            if (!string.IsNullOrWhiteSpace(StripRadiusBottomLeft)) styleVars.Add($"--tp-strip-radius-bl:{StripRadiusBottomLeft}");
            if (!string.IsNullOrWhiteSpace(StripShadow)) styleVars.Add($"--tp-strip-shadow:{StripShadow}");
            // The strip is a SEPARATE DOM element (created by tab-panel.js,
            // appended under <body>, not inside this panel), so
            // --tp-strip-margin-right / --tp-strip-margin-left can't be
            // read from the panel's own inline style via CSS inheritance.
            // tab-panel.js copies the *-color/-extra/-radius/-margin-top/
            // -margin-bottom vars across explicitly when it creates or
            // reuses the strip — see ensureStrip() in that file.
            if (!string.IsNullOrWhiteSpace(CornerIconSize)) styleVars.Add($"--tp-corner-icon-size:{CornerIconSize}");
            if (!string.IsNullOrWhiteSpace(CornerIconTop)) styleVars.Add($"--tp-corner-icon-top:{CornerIconTop}");
            if (!string.IsNullOrWhiteSpace(CornerIconInset)) styleVars.Add($"--tp-corner-icon-inset:{CornerIconInset}");
            if (!string.IsNullOrWhiteSpace(HeaderPadTop)) styleVars.Add($"--tp-header-pad-top:{HeaderPadTop}");
            if (!string.IsNullOrWhiteSpace(HeaderPadLeft)) styleVars.Add($"--tp-header-pad-left:{HeaderPadLeft}");
            output.Attributes.SetAttribute("style", string.Join("; ", styleVars) + ";");

            var loadingHtml = !string.IsNullOrWhiteSpace(SourceUrl)
                ? "<div class='tp-loading'><div class='tp-spinner'></div></div>"
                : "";

            // The corner badge is purely decorative — no click behavior —
            // per the reference design. It's position:fixed and sits ON
            // the backing strip's top corner, with a 2px border ring
            // (default white, via CornerIconBorderColor) giving it a
            // clean edge against the strip/panel behind it. Leave
            // CornerIconTop/CornerIconInset unset to get the default
            // placement (16px down from the true screen top, 20px in
            // from the strip's outer edge).
            var cornerBadgeHtml = !string.IsNullOrWhiteSpace(CornerIcon)
                ? $@"<div class='tp-corner-badge tp-corner-badge-{side}' style='--tp-corner-icon-color:{CornerIconColor}; --tp-corner-icon-bg:{CornerIconBackground}; --tp-corner-icon-border-color:{CornerIconBorderColor}; --tp-corner-icon-size:{CornerIconSize};'>
                        <i class='fa fa-{CornerIcon}'></i>
                     </div>"
                : "";

            // ADDED — {navCtx.Html} is the <nav class='tp-nav'> column of
            // round buttons written by <tab-panel-nav> during
            // GetChildContentAsync() above (empty string when the panel
            // has no nav). It's placed here, OUTSIDE .tp-body, so CSS can
            // push it out into the glass strip beside the panel; on small
            // screens it becomes a row above the header instead.
            output.Content.SetHtmlContent($@"
                {cornerBadgeHtml}
                {navCtx.Html}
                <div class='tp-header'>
                    <h1>{Title}</h1>
                    <button class='tp-close-btn' type='button' aria-label='Close'><span class='tp-close-icon'>&#10005;</span></button>
                </div>
                <div class='tp-body'>
                    {innerHtml}
                    {loadingHtml}
                </div>
            ");
        }
    }
}