// ===== Modern Area Chart =====
// Auto-initializes every .modern-area-chart-canvas on the page.
// Requires Chart.js: <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>

$(document).ready(function () {

    if (typeof Chart === "undefined") {
        console.warn("Modern Area Chart: Chart.js is not loaded.");
        return;
    }

    var zoomPluginAvailable = false;
    try {
        zoomPluginAvailable = !!(Chart.registry && Chart.registry.plugins.get("zoom"));
    } catch (e) {
        zoomPluginAvailable = false;
    }

    var chartInstances = {};

    // Custom plugin — draws each point's value as text just above the point.
    Chart.register({
        id: "modernAreaDataLabels",
        afterDatasetsDraw: function (chart) {
            var pluginOpts = chart.options.plugins && chart.options.plugins.modernAreaDataLabels;
            if (!pluginOpts || !pluginOpts.enabled) return;

            var ctx = chart.ctx;
            ctx.save();
            ctx.font = "bold 11px sans-serif";
            ctx.fillStyle = "#1f2937";
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";

            chart.data.datasets.forEach(function (dataset, datasetIndex) {
                var meta = chart.getDatasetMeta(datasetIndex);
                if (meta.hidden) return;

                meta.data.forEach(function (point, index) {
                    var value = dataset.data[index];
                    if (value === null || value === undefined) return;

                    var pos = point.tooltipPosition();
                    ctx.fillText(value, pos.x, pos.y - 8);
                });
            });

            ctx.restore();
        }
    });

    // Custom plugin — draws a dashed vertical guide line that smoothly
    // tracks the exact mouse cursor position (via native mousemove),
    // rather than snapping to the nearest data point.
    Chart.register({
        id: "modernAreaCrosshair",
        afterDraw: function (chart) {
            var pluginOpts = chart.options.plugins && chart.options.plugins.modernAreaCrosshair;
            if (!pluginOpts || !pluginOpts.enabled) return;
            if (chart._crosshairX === null || chart._crosshairX === undefined) return;

            var chartArea = chart.chartArea;
            if (chart._crosshairX < chartArea.left || chart._crosshairX > chartArea.right) return;

            var ctx = chart.ctx;
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(chart._crosshairX, chartArea.top);
            ctx.lineTo(chart._crosshairX, chartArea.bottom);
            ctx.lineWidth = 1;
            ctx.strokeStyle = "rgba(100, 116, 139, 0.6)";
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.restore();
        }
    });

    function enableMouseTrackingCrosshair(chart, canvasEl) {
        canvasEl.addEventListener("mousemove", function (e) {
            var position = Chart.helpers.getRelativePosition(e, chart);
            chart._crosshairX = position.x;
            chart.draw();
        });

        canvasEl.addEventListener("mouseleave", function () {
            chart._crosshairX = null;
            chart.draw();
        });
    }

    function getAccentColor() {
        var value = getComputedStyle(document.documentElement).getPropertyValue("--ctrl-accent");
        return value ? value.trim() : "#5b7a9d";
    }

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

    function hexToRgba(hex, alpha) {
        hex = hex.replace("#", "");
        if (hex.length === 3) {
            hex = hex.split("").map(function (c) { return c + c; }).join("");
        }
        var num = parseInt(hex, 16);
        var r = num >> 16, g = (num >> 8) & 0x00FF, b = num & 0x0000FF;
        return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
    }

    // Fill gradient: solid-ish at the line, fading to fully transparent at
    // the bottom of the chart area — the classic area-chart look.
    function makeAreaFillGradient(baseColor, fillOpacity) {
        return function (context) {
            var chart = context.chart;
            var chartArea = chart.chartArea;
            if (!chartArea) return "transparent";

            var gradient = chart.ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, hexToRgba(baseColor, fillOpacity));
            gradient.addColorStop(1, hexToRgba(baseColor, 0));
            return gradient;
        };
    }

    function buildDataset(label, data, color, pointRadius, lineWidth, smooth, fillOpacity) {
        return {
            label: label,
            data: data,
            borderColor: color,
            backgroundColor: makeAreaFillGradient(color, fillOpacity),
            borderWidth: lineWidth,
            pointRadius: pointRadius,
            pointHoverRadius: pointRadius + 3,
            pointBackgroundColor: color,
            pointBorderColor: "#ffffff",
            pointBorderWidth: 2,
            tension: smooth ? 0.35 : 0,
            fill: true
        };
    }

    function buildConfig(labels, values, datasetLabel, customColors, showDataLabels, pointRadius, lineWidth, smooth, fillOpacity, showCrosshair, enableZoom) {
        var hasCustomColors = customColors && customColors.length > 0;
        var baseColor = hasCustomColors ? customColors[0] : getAccentColor();

        return {
            type: "line",
            data: {
                labels: labels,
                datasets: [buildDataset(datasetLabel, values, baseColor, pointRadius, lineWidth, smooth, fillOpacity)]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: showCrosshair
                    ? { mode: "index", intersect: false }
                    : { mode: "nearest", intersect: true },
                animation: {
                    duration: 900,
                    easing: "easeOutQuart"
                },
                transitions: {
                    active: { animation: { duration: 250 } }
                },
                plugins: {
                    legend: { display: false },
                    modernAreaDataLabels: { enabled: showDataLabels },
                    modernAreaCrosshair: { enabled: showCrosshair },
                    zoom: enableZoom ? {
                        zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" },
                        pan: { enabled: true, mode: "x" }
                    } : undefined,
                    tooltip: {
                        titleFont: { size: 16, weight: "bold" },
                        bodyFont: { size: 15 },
                        padding: 14,
                        cornerRadius: 8,
                        displayColors: true,
                        boxPadding: 6
                    }
                },
                scales: {
                    x: { ticks: { font: { size: 13, weight: "bold" } } },
                    y: { beginAtZero: true, ticks: { font: { size: 13, weight: "bold" } } }
                }
            }
        };
    }

    function buildMultiSeriesConfig(labels, seriesArray, showDataLabels, pointRadius, lineWidth, smooth, fillOpacity, showCrosshair, enableZoom) {
        var palette = generatePalette(seriesArray.length);

        var datasets = seriesArray.map(function (s, i) {
            var color = s.color || palette[i];
            return buildDataset(s.label, s.data, color, pointRadius, lineWidth, smooth, fillOpacity);
        });

        return {
            type: "line",
            data: { labels: labels, datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: showCrosshair
                    ? { mode: "index", intersect: false }
                    : { mode: "nearest", intersect: true },
                animation: {
                    duration: 900,
                    easing: "easeOutQuart"
                },
                transitions: {
                    active: { animation: { duration: 250 } }
                },
                plugins: {
                    legend: { display: false },
                    modernAreaDataLabels: { enabled: showDataLabels },
                    modernAreaCrosshair: { enabled: showCrosshair },
                    zoom: enableZoom ? {
                        zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" },
                        pan: { enabled: true, mode: "x" }
                    } : undefined,
                    tooltip: {
                        titleFont: { size: 16, weight: "bold" },
                        bodyFont: { size: 15 },
                        padding: 14,
                        cornerRadius: 8,
                        displayColors: true,
                        boxPadding: 6
                    }
                },
                scales: {
                    x: { ticks: { font: { size: 13, weight: "bold" } } },
                    y: { beginAtZero: true, ticks: { font: { size: 13, weight: "bold" } } }
                }
            }
        };
    }

    function renderCustomLegend(legendBoxId, seriesLabels, colors) {
        var $legendBox = $("#" + legendBoxId);
        if ($legendBox.length === 0) return;

        $legendBox.empty();
        seriesLabels.forEach(function (label, i) {
            var $swatch = $("<span class='mc-legend-swatch'></span>").css("background", colors[i % colors.length]);
            var $text = $("<span></span>").text(label);
            $("<div class='mc-legend-item'></div>").append($swatch, $text).appendTo($legendBox);
        });
    }

    $(".modern-area-chart-canvas").each(function () {
        var $canvas = $(this);
        var id = $canvas.attr("id");
        var labels = [];

        try {
            labels = JSON.parse($canvas.attr("data-labels") || "[]");
        } catch (e) {
            console.warn("Modern Area Chart: invalid labels for", id, e);
        }

        var seriesRaw = $canvas.attr("data-series");
        var showDataLabels = $canvas.attr("data-show-data-labels") === "true";
        var pointRadius = parseInt($canvas.attr("data-point-radius")) || 6;
        var lineWidth = parseInt($canvas.attr("data-line-width")) || 5;
        var smooth = $canvas.attr("data-smooth") !== "false";
        var showCrosshair = $canvas.attr("data-show-crosshair") === "true";
        var enableZoom = $canvas.attr("data-enable-zoom") === "true";
        if (enableZoom && !zoomPluginAvailable) {
            console.warn("Modern Area Chart: enable-zoom is set for #" + id + " but chartjs-plugin-zoom isn't loaded. Add <script src='https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2'></script> after Chart.js.");
            enableZoom = false;
        }
        var fillOpacity = parseFloat($canvas.attr("data-fill-opacity"));
        if (isNaN(fillOpacity)) fillOpacity = 0.35;

        if (seriesRaw) {
            var seriesArray = [];
            try {
                seriesArray = JSON.parse(seriesRaw);
            } catch (e) {
                console.warn("Modern Area Chart: invalid series JSON for", id, e);
            }
            chartInstances[id] = new Chart($canvas[0], buildMultiSeriesConfig(labels, seriesArray, showDataLabels, pointRadius, lineWidth, smooth, fillOpacity, showCrosshair, enableZoom));
            if (showCrosshair) enableMouseTrackingCrosshair(chartInstances[id], $canvas[0]);
            if (enableZoom) {
                setTimeout(function () { chartInstances[id].resize(); }, 0);
            }

            var palette = generatePalette(seriesArray.length);
            var seriesColors = seriesArray.map(function (s, i) { return s.color || palette[i]; });
            var seriesLabels = seriesArray.map(function (s) { return s.label; });
            renderCustomLegend(id + "_legend", seriesLabels, seriesColors);
        } else {
            var values = [];
            var customColors = [];
            try {
                values = JSON.parse($canvas.attr("data-values") || "[]");
                customColors = JSON.parse($canvas.attr("data-colors") || "[]");
            } catch (e) {
                console.warn("Modern Area Chart: invalid data attributes for", id, e);
            }
            var datasetLabel = $canvas.attr("data-dataset-label") || "Value";
            chartInstances[id] = new Chart($canvas[0], buildConfig(labels, values, datasetLabel, customColors, showDataLabels, pointRadius, lineWidth, smooth, fillOpacity, showCrosshair, enableZoom));
            if (showCrosshair) enableMouseTrackingCrosshair(chartInstances[id], $canvas[0]);
            if (enableZoom) {
                setTimeout(function () { chartInstances[id].resize(); }, 0);
            }

            var lineColor = (customColors && customColors.length > 0) ? customColors[0] : getAccentColor();
            renderCustomLegend(id + "_legend", [datasetLabel], [lineColor]);
        }
    });

    // Usage: setModernAreaChartData("#TrendChart", ["Jan","Feb"], [120, 190]);
    //        setModernAreaChartData("#TrendChart", ["Jan","Feb"], [120, 190], ["#dc2626"]);
    window.setModernAreaChartData = function (chartSelector, labels, values, colors) {
        var id = chartSelector.replace("#", "");
        var chart = chartInstances[id];
        if (!chart) return;

        var datasetLabel = chart.data.datasets[0] ? chart.data.datasets[0].label : "Value";
        var color = (colors && colors.length > 0) ? colors[0] : getAccentColor();
        var pointRadius = chart.data.datasets[0] ? chart.data.datasets[0].pointRadius : 6;
        var lineWidth = chart.data.datasets[0] ? chart.data.datasets[0].borderWidth : 5;
        var smooth = chart.data.datasets[0] ? chart.data.datasets[0].tension > 0 : true;

        chart.data.labels = labels;
        chart.data.datasets = [buildDataset(datasetLabel, values, color, pointRadius, lineWidth, smooth, 0.35)];
        chart.update();

        renderCustomLegend(id + "_legend", [datasetLabel], [color]);
    };

    // Usage: setModernAreaChartMultiSeries("#TrendChart", ["Jan","Feb","Mar"], [
    //            { label: "2025", data: [100, 150, 130] },
    //            { label: "2026", data: [120, 190, 150], color: "#dc2626" }
    //        ]);
    window.setModernAreaChartMultiSeries = function (chartSelector, labels, seriesArray) {
        var id = chartSelector.replace("#", "");
        var chart = chartInstances[id];
        if (!chart) return;

        var pointRadius = chart.data.datasets[0] ? chart.data.datasets[0].pointRadius : 6;
        var lineWidth = chart.data.datasets[0] ? chart.data.datasets[0].borderWidth : 5;
        var smooth = chart.data.datasets[0] ? chart.data.datasets[0].tension > 0 : true;
        var palette = generatePalette(seriesArray.length);

        chart.data.labels = labels;
        chart.data.datasets = seriesArray.map(function (s, i) {
            var color = s.color || palette[i];
            return buildDataset(s.label, s.data, color, pointRadius, lineWidth, smooth, 0.35);
        });
        chart.update();

        var seriesColors = seriesArray.map(function (s, i) { return s.color || palette[i]; });
        var seriesLabels = seriesArray.map(function (s) { return s.label; });
        renderCustomLegend(id + "_legend", seriesLabels, seriesColors);
    };

    // Usage: getModernAreaChartData("#TrendChart") -> { labels: [...], series: [{ label, data }, ...] }
    window.getModernAreaChartData = function (chartSelector) {
        var id = chartSelector.replace("#", "");
        var chart = chartInstances[id];
        if (!chart) return { labels: [], series: [] };
        return {
            labels: chart.data.labels,
            series: chart.data.datasets.map(function (d) { return { label: d.label, data: d.data }; })
        };
    };

    // Usage (single series): setModernAreaChartDataSource("#TrendChart", myData, "month", ["sales"]);
    // Usage (multi-series):  setModernAreaChartDataSource("#TrendChart", myData, "month", ["2025", "2026"]);
    window.setModernAreaChartDataSource = function (chartSelector, dataSource, labelField, seriesFields, colors) {
        var labels = dataSource.map(function (item) { return item[labelField]; });

        if (seriesFields.length === 1) {
            var values = dataSource.map(function (item) { return item[seriesFields[0]]; });
            window.setModernAreaChartData(chartSelector, labels, values, colors);
        } else {
            var seriesArray = seriesFields.map(function (field, i) {
                var series = { label: field, data: dataSource.map(function (item) { return item[field]; }) };
                if (colors && colors[i]) {
                    series.color = colors[i];
                }
                return series;
            });
            window.setModernAreaChartMultiSeries(chartSelector, labels, seriesArray);
        }
    };

    // Usage: clearModernAreaChart("#TrendChart")
    // Usage: resetModernAreaChartZoom("#TrendChart") — returns to the original,
    // un-zoomed view. Only does anything if enable-zoom is on.
    window.resetModernAreaChartZoom = function (chartSelector) {
        var id = chartSelector.replace("#", "");
        var chart = chartInstances[id];
        if (chart && typeof chart.resetZoom === "function") {
            chart.resetZoom();
        }
    };

    window.clearModernAreaChart = function (chartSelector) {
        var id = chartSelector.replace("#", "");
        var chart = chartInstances[id];
        if (!chart) return;

        var pointRadius = chart.data.datasets[0] ? chart.data.datasets[0].pointRadius : 6;
        var lineWidth = chart.data.datasets[0] ? chart.data.datasets[0].borderWidth : 5;
        var smooth = chart.data.datasets[0] ? chart.data.datasets[0].tension > 0 : true;

        chart.data.labels = [];
        chart.data.datasets = [buildDataset("Value", [], getAccentColor(), pointRadius, lineWidth, smooth, 0.35)];
        chart.update();

        renderCustomLegend(id + "_legend", [], []);
    };

});