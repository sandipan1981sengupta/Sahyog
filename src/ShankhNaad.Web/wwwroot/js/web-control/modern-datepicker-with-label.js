// ===== Modern Date Picker With Label Control =====
// Separate from modern-datepicker.js — auto-initializes every .mdpwl-input
// on the page. Global helper functions use the "WithLabel" suffix so this
// coexists cleanly with the original modern-datepicker.js.
//
// window.ModernDatePickerWithLabel.init(context) can be called again
// after any AJAX/partial load to initialize newly-injected inputs.
// Safe to call repeatedly — already-initialized inputs are skipped.

window.ModernDatePickerWithLabel = window.ModernDatePickerWithLabel || {};
window.ModernDatePickerWithLabel._instances = window.ModernDatePickerWithLabel._instances || {};

window.ModernDatePickerWithLabel.init = function (context) {
    var datePickers = window.ModernDatePickerWithLabel._instances;
    var $scope = context ? $(context) : $(document);

    var $inputs = ($scope.is && $scope.is(".mdpwl-input"))
        ? $scope
        : $scope.find(".mdpwl-input");

    $inputs.each(function () {
        var input = this;
        var $input = $(input);

        if ($input.data("mdpwl-inited")) return;
        $input.data("mdpwl-inited", true);

        var $field = $input.closest(".mdpwl-field");
        var $errorIcon = $field.find(".mdpwl-icon-error");
        var isRequired = $field.attr("data-required") === "true";
        // ADDED — read the TagHelper's DisableTyping flag (rendered as
        // data-disable-typing='true' + a native readonly attribute).
        // When true: flatpickr's allowInput is turned off, so the only
        // way to set a value is picking a date from the calendar popup.
        var typingDisabled = $input.attr("data-disable-typing") === "true";

        // Read disabled dates from data attribute, fallback to empty array
        var disabled = [];
        try {
            var raw = $input.attr("data-disabled-dates");
            disabled = raw ? JSON.parse(raw) : [];
        } catch (e) {
            console.warn("Invalid disabled-dates JSON for", input.id, e);
        }

        function checkRequired() {
            if (isRequired && !input.value.trim()) {
                $errorIcon.show();
            } else {
                $errorIcon.hide();
            }
        }
        checkRequired();   // show immediately on load if empty — don't wait for blur

        datePickers[input.id] = flatpickr(input, {
            disableMobile: true,   // always our own calendar (phones would otherwise get the browser's built-in date picker)
            dateFormat: "d-m-Y",
            // ShankhNaad: inside a pop-up <dialog> the calendar must open in place,
            // otherwise it is drawn behind the dialog.
            static: !!input.closest("dialog"),
            allowInput: !typingDisabled,   // CHANGED — was hardcoded true
            disable: disabled,
            clickOpens: !input.disabled,   // 🔒 don't open calendar on click if disabled
            onReady: function (selectedDates, dateStr, instance) {
                // ADDED — skip the manual character-filter listener
                // entirely when typing is disabled; there's nothing
                // left for it to filter since the field can't be typed
                // into at all (flatpickr enforces this once allowInput
                // is false).
                if (!typingDisabled) {
                    instance.input.addEventListener("input", function () {
                        this.value = this.value.replace(/[^0-9-]/g, "").substring(0, 10);
                        checkRequired();
                    });
                }

                instance.input.addEventListener("blur", checkRequired);

                // 🔒 keep flatpickr's own disabled state in sync with the input attribute
                if (input.disabled) {
                    instance.altInput && (instance.altInput.disabled = true);
                }
            },
            onChange: function () {
                checkRequired();   // covers date picked via the calendar UI, not just typed
            }
        });

        // expose so validate/clear helpers can re-check after programmatic changes
        $field.data("mdpwl-check-required", checkRequired);
    });

    if (!window.ModernDatePickerWithLabel._iconHandlerBound) {
        window.ModernDatePickerWithLabel._iconHandlerBound = true;

        $(document).on("click", ".mdpwl-icon", function () {
            var input = $(this)
                .closest(".mdpwl-field")
                .find(".mdpwl-input")[0];

            // 🔒 don't open calendar via icon click if disabled
            if (!input || input.disabled) return;

            if (input && datePickers[input.id]) {
                datePickers[input.id].open();
            }
        });
    }
};

$(document).ready(function () {
    window.ModernDatePickerWithLabel.init();
});

// ----- Enable / disable a datepicker dynamically at runtime -----
// Usage: disableModernDatePickerWithLabel("#DOB");  /  enableModernDatePickerWithLabel("#DOB");
window.disableModernDatePickerWithLabel = function (inputSelector) {
    var $input = $(inputSelector);
    if ($input.length === 0) return;

    var input = $input[0];
    var fp = window.ModernDatePickerWithLabel._instances[input.id];

    $input.prop("disabled", true);
    $input.closest(".mdpwl-field").addClass("mdpwl-disabled");

    if (fp) {
        fp.close();
        fp.set("clickOpens", false);
    }
};

window.enableModernDatePickerWithLabel = function (inputSelector) {
    var $input = $(inputSelector);
    if ($input.length === 0) return;

    var input = $input[0];
    var fp = window.ModernDatePickerWithLabel._instances[input.id];

    $input.prop("disabled", false);
    $input.closest(".mdpwl-field").removeClass("mdpwl-disabled");

    if (fp) {
        fp.set("clickOpens", true);
    }
};

// ----- Validate / clear, matching the modern-input / dropdown pattern -----
// Usage: validateModernDatePickerWithLabel("#DOB") -> true/false
window.validateModernDatePickerWithLabel = function (inputSelector) {
    var $input = $(inputSelector);
    if ($input.length === 0) return true;

    var $field = $input.closest(".mdpwl-field");
    var checkFn = $field.data("mdpwl-check-required");
    if (typeof checkFn === "function") checkFn();

    var isRequired = $field.attr("data-required") === "true";
    return !(isRequired && !$input.val().trim());
};

// Usage: getModernDatePickerWithLabelValue("#DOB") -> "15-08-2026"
window.getModernDatePickerWithLabelValue = function (inputSelector) {
    return $(inputSelector).val();
};

// Usage: setModernDatePickerWithLabelValue("#DOB", "15-08-2026")
// Goes through flatpickr's own setDate() rather than a plain .val() —
// this keeps flatpickr's internal selected-date state in sync with
// what's displayed, so the calendar correctly highlights the right
// day the next time it's opened.
window.setModernDatePickerWithLabelValue = function (inputSelector, dateString) {
    var $input = $(inputSelector);
    if ($input.length === 0) return;

    var input = $input[0];
    var fp = window.ModernDatePickerWithLabel._instances[input.id];

    if (fp) {
        fp.setDate(dateString, true);   // true = also trigger onChange
    } else {
        $input.val(dateString);
    }

    var $field = $input.closest(".mdpwl-field");
    var checkFn = $field.data("mdpwl-check-required");
    if (typeof checkFn === "function") checkFn();
};

// Usage: clearModernDatePickerWithLabel("#DOB")
window.clearModernDatePickerWithLabel = function (inputSelector) {
    var $input = $(inputSelector);
    if ($input.length === 0) return;

    var input = $input[0];
    var fp = window.ModernDatePickerWithLabel._instances[input.id];

    if (fp) {
        fp.clear();
    } else {
        $input.val("");
    }

    var $field = $input.closest(".mdpwl-field");
    var checkFn = $field.data("mdpwl-check-required");
    if (typeof checkFn === "function") checkFn();
};

// Usage: clearAllModernDatePickersWithLabel() or scoped to a container
window.clearAllModernDatePickersWithLabel = function (containerSelector) {
    var $scope = containerSelector ? $(containerSelector) : $(document);
    $scope.find(".mdpwl-input").each(function () {
        var id = $(this).attr("id");
        if (id) window.clearModernDatePickerWithLabel("#" + id);
    });
};

// Usage: validateAllModernDatePickersWithLabel() -> true/false, or scoped
window.validateAllModernDatePickersWithLabel = function (containerSelector) {
    var $scope = containerSelector ? $(containerSelector) : $(document);
    var allValid = true;

    $scope.find(".mdpwl-input").each(function () {
        var id = $(this).attr("id");
        if (id && !window.validateModernDatePickerWithLabel("#" + id)) {
            allValid = false;
        }
    });

    return allValid;
};

// ----- Set / get disabled dates dynamically at runtime -----
// Usage: setModernDatePickerWithLabelDisabledDates("#DOB", ["2026-08-25", { from: "2026-09-01", to: "2026-09-05" }]);
//
// Rebuilds the flatpickr instance rather than calling fp.set("disable", ...)
// directly — that was found to mis-parse range objects. Also converts
// date strings to explicit local-midnight Date objects: plain
// "YYYY-MM-DD" strings get parsed as UTC midnight by JS, which shifts
// to the PREVIOUS day in timezones ahead of UTC (e.g. IST). Also
// correctly re-wires the required-field validation logic, since
// rebuilding the flatpickr instance would otherwise lose it.
window.setModernDatePickerWithLabelDisabledDates = function (inputSelector, disabledDatesArray) {
    var $input = $(inputSelector);
    if ($input.length === 0) return;

    var input = $input[0];
    var $field = $input.closest(".mdpwl-field");
    var $errorIcon = $field.find(".mdpwl-icon-error");
    var isRequired = $field.attr("data-required") === "true";
    var typingDisabled = $input.attr("data-disable-typing") === "true";   // ADDED
    var datePickers = window.ModernDatePickerWithLabel._instances;
    var oldFp = datePickers[input.id];
    var currentValue = input.value;   // preserve whatever's already selected

    if (oldFp) {
        oldFp.destroy();
    }

    function checkRequired() {
        if (isRequired && !input.value.trim()) {
            $errorIcon.show();
        } else {
            $errorIcon.hide();
        }
    }

    // Convert strings to explicit local-time Date objects
    var normalizedDisable = (disabledDatesArray || []).map(function (item) {
        if (typeof item === "string") {
            return new Date(item + "T00:00:00");
        }
        if (item && item.from && item.to) {
            return {
                from: new Date(item.from + "T00:00:00"),
                to: new Date(item.to + "T00:00:00")
            };
        }
        return item;
    });

    datePickers[input.id] = flatpickr(input, {
            disableMobile: true,   // always our own calendar (phones would otherwise get the browser's built-in date picker)
        dateFormat: "d-m-Y",
        allowInput: !typingDisabled,   // CHANGED — was hardcoded true
        disable: normalizedDisable,
        clickOpens: !input.disabled,
        onReady: function (selectedDates, dateStr, instance) {
            if (!typingDisabled) {   // ADDED — same skip as in init()
                instance.input.addEventListener("input", function () {
                    this.value = this.value.replace(/[^0-9-]/g, "").substring(0, 10);
                    checkRequired();
                });
            }
            instance.input.addEventListener("blur", checkRequired);
            if (input.disabled) {
                instance.altInput && (instance.altInput.disabled = true);
            }
        },
        onChange: function () {
            checkRequired();
        }
    });

    $field.data("mdpwl-check-required", checkRequired);   // re-expose the fresh closure

    if (currentValue) {
        datePickers[input.id].setDate(currentValue, true);
    }

    checkRequired();
};

// Usage: getModernDatePickerWithLabelDisabledDates("#DOB")
window.getModernDatePickerWithLabelDisabledDates = function (inputSelector) {
    var $input = $(inputSelector);
    if ($input.length === 0) return [];

    var input = $input[0];
    var fp = window.ModernDatePickerWithLabel._instances[input.id];

    return fp ? fp.config.disable : [];
};

// ----- Block all dates before/after a cutoff -----
// Usage: setModernDatePickerWithLabelDateRange("#DOB", "2026-01-01", null);
//        setModernDatePickerWithLabelDateRange("#DOB", null, "2026-12-31");
//        setModernDatePickerWithLabelDateRange("#DOB", "2026-01-01", "2026-12-31");
window.setModernDatePickerWithLabelDateRange = function (inputSelector, minDateString, maxDateString) {
    var $input = $(inputSelector);
    if ($input.length === 0) return;

    var input = $input[0];
    var $field = $input.closest(".mdpwl-field");
    var $errorIcon = $field.find(".mdpwl-icon-error");
    var isRequired = $field.attr("data-required") === "true";
    var typingDisabled = $input.attr("data-disable-typing") === "true";   // ADDED
    var datePickers = window.ModernDatePickerWithLabel._instances;
    var oldFp = datePickers[input.id];
    var currentValue = input.value;

    // Defensive: oldFp might exist but be in a broken/partial state
    // (e.g. missing .config) — don't let that crash this function.
    var currentDisable = [];
    try {
        if (oldFp && oldFp.config && oldFp.config.disable) {
            currentDisable = oldFp.config.disable;
        }
    } catch (e) {
        console.warn("Could not read existing disable config, starting fresh:", e);
    }

    try {
        if (oldFp && typeof oldFp.destroy === "function") {
            oldFp.destroy();
        }
    } catch (e) {
        console.warn("Could not destroy previous flatpickr instance cleanly:", e);
    }

    function checkRequired() {
        if (isRequired && !input.value.trim()) {
            $errorIcon.show();
        } else {
            $errorIcon.hide();
        }
    }

    var minDate = minDateString ? new Date(minDateString + "T00:00:00") : undefined;
    var maxDate = maxDateString ? new Date(maxDateString + "T00:00:00") : undefined;

    datePickers[input.id] = flatpickr(input, {
            disableMobile: true,   // always our own calendar (phones would otherwise get the browser's built-in date picker)
        dateFormat: "d-m-Y",
        allowInput: !typingDisabled,   // CHANGED — was hardcoded true
        disable: currentDisable,
        minDate: minDate,
        maxDate: maxDate,
        clickOpens: !input.disabled,
        onReady: function (selectedDates, dateStr, instance) {
            if (!typingDisabled) {   // ADDED — same skip as in init()
                instance.input.addEventListener("input", function () {
                    this.value = this.value.replace(/[^0-9-]/g, "").substring(0, 10);
                    checkRequired();
                });
            }
            instance.input.addEventListener("blur", checkRequired);
            if (input.disabled) {
                instance.altInput && (instance.altInput.disabled = true);
            }
        },
        onChange: function () {
            checkRequired();
        }
    });

    $field.data("mdpwl-check-required", checkRequired);

    if (currentValue) {
        datePickers[input.id].setDate(currentValue, true);
    }

    checkRequired();
};