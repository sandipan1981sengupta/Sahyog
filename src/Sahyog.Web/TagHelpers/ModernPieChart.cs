using Microsoft.AspNetCore.Razor.TagHelpers;
using System.Text.Json;

namespace Sahyog.Web.TagHelpers
{
    /// <summary>
    /// Pie chart. Standalone control — requires Chart.js loaded in
    /// _Layout.cshtml: <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
    /// </summary>
    [HtmlTargetElement("modern-pie-chart")]
    public class ModernPieChart : TagHelper
    {
        public string Id { get; set; }
        public string Title { get; set; }
        public IEnumerable<string> Labels { get; set; }
        public IEnumerable<double> Data { get; set; }
        public string ChartHeight { get; set; } = "350px";
        public IEnumerable<string> Colors { get; set; }   // optional — one color per slice; falls back to auto-palette if not set
        public bool ShowLegend { get; set; } = true;        // set false to hide the legend box entirely
        public bool ShowBorder { get; set; } = true;         // set false to remove the card border and shadow
        public int LegendFontSize { get; set; } = 14;          // legend text size
        public string LegendFontWeight { get; set; } = "700";    // CSS font-weight: "400", "600", "700", "bold", "normal"
        public int LegendGap { get; set; } = 16;                   // gap between legend items
        public string LegendPosition { get; set; } = "bottom";      // "top", "bottom", "left", "right"
        public bool ShowLegendBox { get; set; } = true;               // set false to remove the border/background/shadow, showing plain legend items

        public override void Process(TagHelperContext context, TagHelperOutput output)
        {
            output.TagName = "div";
            output.Attributes.SetAttribute("class", "modern-chart-wrapper" + (ShowBorder ? "" : " mc-no-border"));

            var labelsJson = JsonSerializer.Serialize(Labels ?? Enumerable.Empty<string>());
            var dataJson = JsonSerializer.Serialize(Data ?? Enumerable.Empty<double>());
            var colorsJson = JsonSerializer.Serialize(Colors ?? Enumerable.Empty<string>());

            var titleHtml = !string.IsNullOrWhiteSpace(Title)
                ? $"<div class='mc-title'>{Title}</div>"
                : "";

            var normalizedPosition = (LegendPosition ?? "bottom").ToLower();
            if (normalizedPosition != "top" && normalizedPosition != "bottom" &&
                normalizedPosition != "left" && normalizedPosition != "right")
            {
                normalizedPosition = "bottom";
            }

            var legendBoxHtml = ShowLegend
                ? $@"<div class='mc-legend-box{(ShowLegendBox ? "" : " mc-legend-plain")}' id='{Id}_legend'
                          style='--mc-legend-font-size:{LegendFontSize}px; --mc-legend-font-weight:{LegendFontWeight}; --mc-legend-gap:{LegendGap}px;'></div>"
                : "";

            output.Content.SetHtmlContent($@"
                {titleHtml}
                <div class='mc-chart-body mc-legend-{normalizedPosition}'>
                    <div class='mc-canvas-wrap' style='height:{ChartHeight};'>
                        <canvas id='{Id}' class='modern-pie-chart-canvas'
                                data-labels='{System.Net.WebUtility.HtmlEncode(labelsJson)}'
                                data-values='{System.Net.WebUtility.HtmlEncode(dataJson)}'
                                data-colors='{System.Net.WebUtility.HtmlEncode(colorsJson)}'></canvas>
                    </div>
                    {legendBoxHtml}
                </div>
            ");
        }
    }
}