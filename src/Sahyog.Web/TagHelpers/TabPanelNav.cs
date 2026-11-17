using Microsoft.AspNetCore.Razor.TagHelpers;
using System.Collections.Generic;
using System.Net;
using System.Threading.Tasks;

namespace Sahyog.Web.TagHelpers
{
    /// <summary>
    /// Mutable hand-off object between &lt;tab-panel&gt; and its
    /// &lt;tab-panel-nav&gt; / &lt;tab-nav-button&gt; children.
    ///
    /// TagHelperContext.Items is copy-on-write going DOWN the tree, so a
    /// child can never add a key the parent will see. The standard
    /// workaround: the parent puts a mutable object in Items BEFORE
    /// rendering its children, and the children write into that object.
    /// TabPanel then reads Html back after GetChildContentAsync().
    /// </summary>
    internal sealed class TabPanelNavContext
    {
        public string Html { get; set; } = "";
        public int ButtonCount { get; set; }   // used to stagger each button's entrance animation
    }

    /// <summary>
    /// A vertical column of icon buttons that sits on the frosted-glass
    /// strip beside a &lt;tab-panel&gt; (the gap between the strip's outer
    /// edge and the panel). Each button switches which section of the
    /// panel's body is visible.
    ///
    /// It renders INSIDE the panel's DOM (same trick as the corner
    /// badge), positioned out into the glass gap — so it slides, fades,
    /// hides and stacks together with the panel automatically, with no
    /// extra wiring to the JS-created strip element.
    ///
    /// Usage:
    /// <tab-panel id="SecurityPanel" title="Security details" strip-extra="120px" corner-icon="money">
    ///     <tab-panel-nav>
    ///         <tab-nav-button icon="shopping-bag" label="Pledge gold / Ornaments" target-section="GoldSection" active="true"></tab-nav-button>
    ///         <tab-nav-button icon="briefcase" label="Pledge deposits" target-section="DepositSection"
    ///                         source-url="/Loan/PledgeDepositsPartial"></tab-nav-button>
    ///     </tab-panel-nav>
    ///
    ///     <div id="GoldSection"><partial name="_PledgeGold" /></div>
    ///     <div id="DepositSection"></div>
    /// </tab-panel>
    /// </summary>
    [HtmlTargetElement("tab-panel-nav", ParentTag = "tab-panel")]
    [RestrictChildren("tab-nav-button")]
    public class TabPanelNav : TagHelper
    {
        public string Top { get; set; }                    // optional — distance from the panel's top edge; defaults to just below the corner badge
        public string Width { get; set; }                  // optional — defaults to the visible glass gap (StripExtra minus the panel's margin on that side)
        public string Gap { get; set; } = "18px";          // vertical gap between buttons
        public string AriaLabel { get; set; } = "Sections";

        public override async Task ProcessAsync(TagHelperContext context, TagHelperOutput output)
        {
            var navCtx = context.Items.TryGetValue(typeof(TabPanelNavContext), out var o)
                ? o as TabPanelNavContext
                : null;

            var buttonsHtml = (await output.GetChildContentAsync()).GetContent();

            // Never render in place (that would drop it into .tp-body) —
            // TabPanel re-emits it in the right spot instead.
            output.SuppressOutput();
            if (navCtx == null) return;

            var styleVars = new List<string>();
            if (!string.IsNullOrWhiteSpace(Top)) styleVars.Add($"--tp-nav-top:{Top}");
            if (!string.IsNullOrWhiteSpace(Width)) styleVars.Add($"--tp-nav-width:{Width}");
            if (!string.IsNullOrWhiteSpace(Gap)) styleVars.Add($"--tp-nav-gap:{Gap}");
            var style = styleVars.Count > 0 ? $" style='{string.Join("; ", styleVars)};'" : "";

            navCtx.Html = $@"<nav class='tp-nav' role='tablist' aria-orientation='vertical' aria-label='{WebUtility.HtmlEncode(AriaLabel)}'{style}>
                    {buttonsHtml}
                </nav>";
        }
    }

    /// <summary>
    /// One round icon button + label inside a &lt;tab-panel-nav&gt;.
    ///
    /// TargetSection — id of any element inside the panel's content. Only
    ///                 the active button's section is shown; the rest are
    ///                 hidden. Plain &lt;div id="..."&gt; is enough — the JS
    ///                 adds the needed class itself.
    /// SourceUrl     — optional. Loads a partial view's HTML into the
    ///                 target section the first time it's shown (then
    ///                 cached), exactly like TabPanel's own SourceUrl.
    ///
    /// Every color property accepts a gradient() string as well as a flat
    /// color, following the same GradientColorHelper pattern as TabButton.
    /// </summary>
    [HtmlTargetElement("tab-nav-button", ParentTag = "tab-panel-nav")]
    public class TabNavButton : TagHelper
    {
        public string Icon { get; set; }                   // Font Awesome name without "fa-", e.g. "car", "briefcase"
        public string Label { get; set; }
        public string TargetSection { get; set; }
        public string SourceUrl { get; set; }
        public bool Active { get; set; } = false;          // pre-selected; if no button is marked, the first one is selected

        public string IconSize { get; set; }               // circle diameter, default 52px
        public string IconColor { get; set; }
        public string ActiveIconColor { get; set; }
        public string IconBackground { get; set; }
        public string ActiveIconBackground { get; set; }
        public string LabelColor { get; set; }
        public string ActiveLabelColor { get; set; }
        public string LabelFontSize { get; set; }          // default 12px

        public override void Process(TagHelperContext context, TagHelperOutput output)
        {
            var navCtx = context.Items.TryGetValue(typeof(TabPanelNavContext), out var o)
                ? o as TabPanelNavContext
                : null;
            var index = navCtx != null ? navCtx.ButtonCount++ : 0;

            output.TagName = "button";
            output.TagMode = TagMode.StartTagAndEndTag;
            output.Attributes.SetAttribute("type", "button");
            output.Attributes.SetAttribute("class", "tp-nav-btn" + (Active ? " tp-nav-active" : ""));
            output.Attributes.SetAttribute("role", "tab");
            output.Attributes.SetAttribute("aria-selected", Active ? "true" : "false");
            output.Attributes.SetAttribute("title", Label ?? "");

            if (!string.IsNullOrWhiteSpace(TargetSection))
            {
                output.Attributes.SetAttribute("data-target-section", TargetSection);
                output.Attributes.SetAttribute("aria-controls", TargetSection);
            }
            if (!string.IsNullOrWhiteSpace(SourceUrl))
            {
                output.Attributes.SetAttribute("data-source-url", SourceUrl);
            }

            if (GradientColorHelper.IsGradient(LabelColor)) output.Attributes.SetAttribute("data-label-gradient", "true");
            if (GradientColorHelper.IsGradient(ActiveLabelColor)) output.Attributes.SetAttribute("data-active-label-gradient", "true");
            if (GradientColorHelper.IsGradient(IconColor)) output.Attributes.SetAttribute("data-icon-gradient", "true");
            if (GradientColorHelper.IsGradient(ActiveIconColor)) output.Attributes.SetAttribute("data-active-icon-gradient", "true");

            var styleVars = new List<string> { $"--tp-nav-i:{index}" };
            if (!string.IsNullOrWhiteSpace(IconSize)) styleVars.Add($"--tp-nav-icon-size:{IconSize}");
            if (!string.IsNullOrWhiteSpace(IconColor)) styleVars.Add($"--tp-nav-icon-color:{IconColor}");
            if (!string.IsNullOrWhiteSpace(ActiveIconColor)) styleVars.Add($"--tp-nav-active-icon-color:{ActiveIconColor}");
            if (!string.IsNullOrWhiteSpace(IconBackground)) styleVars.Add($"--tp-nav-icon-bg:{IconBackground}");
            if (!string.IsNullOrWhiteSpace(ActiveIconBackground)) styleVars.Add($"--tp-nav-active-icon-bg:{ActiveIconBackground}");
            if (!string.IsNullOrWhiteSpace(LabelColor)) styleVars.Add($"--tp-nav-label-color:{LabelColor}");
            if (!string.IsNullOrWhiteSpace(ActiveLabelColor)) styleVars.Add($"--tp-nav-active-label-color:{ActiveLabelColor}");
            if (!string.IsNullOrWhiteSpace(LabelFontSize)) styleVars.Add($"--tp-nav-label-size:{LabelFontSize}");
            output.Attributes.SetAttribute("style", string.Join("; ", styleVars) + ";");

            var iconHtml = !string.IsNullOrWhiteSpace(Icon) ? $"<i class='fa fa-{Icon}' aria-hidden='true'></i>" : "";

            output.Content.SetHtmlContent($@"
                <span class='tp-nav-icon'>{iconHtml}</span>
                <span class='tp-nav-label'>{WebUtility.HtmlEncode(Label ?? "")}</span>
            ");
        }
    }
}
