// ===== Modern Pie Chart =====
// Auto-initializes every .modern-pie-chart-canvas on the page.
// Requires Chart.js: <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
//
// window.ModernPieChart.init(context) can be called again after any
// AJAX/partial load to initialize newly-injected canvases. Safe to call
// repeatedly — already-initialized canvases are skipped.

window.ModernPieChart = window.ModernPieChart || {};
window.ModernPieChart._instances = window.ModernPieChart._instances || {};

window.ModernPieChart.init = function (context) {
    if (typeof Chart === "undefined") {
        console.warn("Modern Pie Chart: Chart.js is not loaded.");
        return;
    }

    var chartInstances = window.ModernPieChart._instances;
    var $scope = context ? $(context) : $(document);

    var $canvases = ($scope.is && $scope.is(".modern-pie-chart-canvas"))
        ? $scope
        : $scope.find(".modern-pie-chart-canvas");

    function generatePalette(count) {
        var basePalette = [
            "#5b7a9d", "#0e93a8", "#2f8f5b", "#7451a8", "#d97706",
            "#dc2626", "#7a97b8", "#46617f", "#94a3b8", "#334155"
        ];
        var result = [];
        for (var i = 0; i < count; i++) {
            result.push(basePalette[i % basePalette.length]);
        }
        return result;
    }

    function buildConfig(labels, values, customColors) {
        var hasCustomColors = customColors && customColors.length > 0;
        var pieColors = hasCustomColors ? customColors : generatePalette(labels.length);

        return {
            type: "pie",
            data: {
                labels: labels,
                datasets: [{
                    data: values,
                    backgroundColor: pieColors,
                    borderWidth: 2,
                    borderColor: "#ffffff",
                    hoverOffset: 16   // slice "pops out" on hover
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 900,
                    easing: "easeOutQuart"
                },
                transitions: {
                    active: {
                        animation: { duration: 300 }
                    }
                },
                plugins: {
                    legend: { display: false },   // replaced by the custom HTML legend box
                    tooltip: {
                        titleFont: { size: 16, weight: "bold" },
                        bodyFont: { size: 15 },
                        padding: 14,
                        cornerRadius: 8,
                        displayColors: true,
                        boxPadding: 6
                    }
                }
            }
        };
    }

    function renderCustomLegend(legendBoxId, labels, colors) {
        var $legendBox = $("#" + legendBoxId);
        if ($legendBox.length === 0) return;   // legend disabled (show-legend="false")

        $legendBox.empty();
        labels.forEach(function (label, i) {
            var $swatch = $("<span class='mc-legend-swatch'></span>").css("background", colors[i % colors.length]);
            var $text = $("<span></span>").text(label);
            $("<div class='mc-legend-item'></div>").append($swatch, $text).appendTo($legendBox);
        });
    }

    $canvases.each(function () {
        var $canvas = $(this);
        var id = $canvas.attr("id");

        if ($canvas.data("mpc-inited")) return;
        $canvas.data("mpc-inited", true);

        var labels = [];
        var values = [];
        var customColors = [];
        try {
            labels = JSON.parse($canvas.attr("data-labels") || "[]");
            values = JSON.parse($canvas.attr("data-values") || "[]");
            customColors = JSON.parse($canvas.attr("data-colors") || "[]");
        } catch (e) {
            console.warn("Modern Pie Chart: invalid data attributes for", id, e);
        }

        chartInstances[id] = new Chart($canvas[0], buildConfig(labels, values, customColors));

        var finalColors = (customColors && customColors.length > 0) ? customColors : generatePalette(labels.length);
        renderCustomLegend(id + "_legend", labels, finalColors);
    });
};

$(document).ready(function () {
    window.ModernPieChart.init();
});

// Usage: setModernPieChartData("#StatusChart", ["Active","Inactive"], [62, 21]);
//        setModernPieChartData("#StatusChart", ["Active","Inactive"], [62, 21], ["#16a34a", "#dc2626"]);
window.setModernPieChartData = function (chartSelector, labels, values, colors) {
    var id = chartSelector.replace("#", "");
    var chart = window.ModernPieChart._instances[id];
    if (!chart) return;

    function generatePalette(count) {
        var basePalette = [
            "#5b7a9d", "#0e93a8", "#2f8f5b", "#7451a8", "#d97706",
            "#dc2626", "#7a97b8", "#46617f", "#94a3b8", "#334155"
        ];
        var result = [];
        for (var i = 0; i < count; i++) {
            result.push(basePalette[i % basePalette.length]);
        }
        return result;
    }

    var finalColors = (colors && colors.length > 0) ? colors : generatePalette(labels.length);

    chart.data.labels = labels;
    chart.data.datasets[0].data = values;
    chart.data.datasets[0].backgroundColor = finalColors;
    chart.update();

    var $legendBox = $("#" + id + "_legend");
    if ($legendBox.length > 0) {
        $legendBox.empty();
        labels.forEach(function (label, i) {
            var $swatch = $("<span class='mc-legend-swatch'></span>").css("background", finalColors[i % finalColors.length]);
            var $text = $("<span></span>").text(label);
            $("<div class='mc-legend-item'></div>").append($swatch, $text).appendTo($legendBox);
        });
    }
};

// Usage: setModernPieChartDataSource("#StatusChart", myData, "status", "count");
// where myData = [{ status: "Active", count: 62 }, { status: "Inactive", count: 21 }, ...]
// Extracts labels/values from your own object shape, then calls setModernPieChartData.
window.setModernPieChartDataSource = function (chartSelector, dataSource, labelField, valueField, colors) {
    var labels = dataSource.map(function (item) { return item[labelField]; });
    var values = dataSource.map(function (item) { return item[valueField]; });
    window.setModernPieChartData(chartSelector, labels, values, colors);
};

// Usage: clearModernPieChart("#StatusChart")
window.clearModernPieChart = function (chartSelector) {
    var id = chartSelector.replace("#", "");
    var chart = window.ModernPieChart._instances[id];
    if (!chart) return;

    chart.data.labels = [];
    chart.data.datasets[0].data = [];
    chart.data.datasets[0].backgroundColor = [];
    chart.update();

    var $legendBox = $("#" + id + "_legend");
    if ($legendBox.length > 0) $legendBox.empty();
};

// Usage: getModernPieChartData("#StatusChart") -> { labels: [...], values: [...] }
window.getModernPieChartData = function (chartSelector) {
    var id = chartSelector.replace("#", "");
    var chart = window.ModernPieChart._instances[id];
    if (!chart) return { labels: [], values: [] };
    return { labels: chart.data.labels, values: chart.data.datasets[0].data };
};
