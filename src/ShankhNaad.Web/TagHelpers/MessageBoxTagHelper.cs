using Microsoft.AspNetCore.Razor.TagHelpers;
using System.Text.Encodings.Web;

namespace ShankhNaad.Web.TagHelpers
{
    /// <summary>
    /// Usage in .cshtml:
    ///
    /// <message-box id="confirmBox"
    ///               title="Confirmation"
    ///               icon="arrow"
    ///               type="info">
    ///     Please enter correct username and password.
    /// </message-box>
    ///
    /// Renders the modal markup only. Call showMessageBox('confirmBox') /
    /// hideMessageBox('confirmBox') from JS (see messagebox.js) to toggle it,
    /// or set auto-show="true" to show it immediately on page load.
    /// </summary>
    [HtmlTargetElement("message-box")]
    public class MessageBoxTagHelper : TagHelper
    {
        /// <summary>Unique id for the dialog, used by the JS helpers to target it.</summary>
        public string Id { get; set; } = "messageBox";

        /// <summary>Header text, e.g. "Confirmation".</summary>
        public string Title { get; set; } = "Confirmation";

        /// <summary>
        /// info | success | warning | error — controls the header gradient
        /// and the icon used when Icon is not explicitly overridden.
        /// </summary>
        public string Type { get; set; } = "info";

        /// <summary>arrow | check | warning | error | none — which icon glyph to show.</summary>
        public string Icon { get; set; } = "arrow";

        /// <summary>Show a footer with an OK button.</summary>
        public bool ShowFooter { get; set; } = true;

        /// <summary>Text for the footer OK button.</summary>
        public string OkText { get; set; } = "OK";

        /// <summary>If true, the box is visible as soon as the page renders.</summary>
        public bool AutoShow { get; set; } = false;

        public override void Process(TagHelperContext context, TagHelperOutput output)
        {
            output.TagName = "div";
            output.Attributes.SetAttribute("id", Id);
            output.Attributes.SetAttribute("class",
                $"mb-overlay mb-type-{Type} {(AutoShow ? "mb-visible" : "")}".Trim());
            output.Attributes.SetAttribute("role", "dialog");
            output.Attributes.SetAttribute("aria-modal", "true");
            output.Attributes.SetAttribute("aria-labelledby", Id + "_title");

            var bodyContent = output.GetChildContentAsync().GetAwaiter().GetResult();
            var bodyHtml = bodyContent.GetContent(HtmlEncoder.Default);

            string iconSvg = Icon switch
            {
                "check" => "<svg viewBox=\"0 0 24 24\" class=\"mb-icon-svg\"><path d=\"M20 6L9 17l-5-5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>",
                "warning" => "<svg viewBox=\"0 0 24 24\" class=\"mb-icon-svg\"><path d=\"M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>",
                "error" => "<svg viewBox=\"0 0 24 24\" class=\"mb-icon-svg\"><circle cx=\"12\" cy=\"12\" r=\"10\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"/><path d=\"M15 9l-6 6M9 9l6 6\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg>",
                "none" => "",
                _ => "<svg viewBox=\"0 0 24 24\" class=\"mb-icon-svg\"><path d=\"M5 12h14M13 6l6 6-6 6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>",
            };

            string footerHtml = ShowFooter
                ? $@"<div class=""mb-footer"">
                        <button type=""button"" class=""mb-ok-btn"" onclick=""hideMessageBox('{Id}')"">{OkText}</button>
                     </div>"
                : "";

            output.Content.SetHtmlContent($@"
    <div class=""mb-dialog"">
        <div class=""mb-header"">
            <div class=""mb-header-left"">
                {(Icon != "none" ? $"<span class=\"mb-icon\">{iconSvg}</span>" : "")}
                <span id=""{Id}_title"" class=""mb-title"">{Title}</span>
            </div>
            <button type=""button"" class=""mb-close-btn"" aria-label=""Close"" onclick=""hideMessageBox('{Id}')"">
                <span>&times;</span>
            </button>
        </div>
        <div class=""mb-body"">
            {bodyHtml}
        </div>
        {footerHtml}
    </div>");
        }
    }
}
