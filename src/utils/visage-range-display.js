/**
 * Keeps Visage's range sliders (templates/parts/visage-range.hbs) in step with their value chips,
 * and supplies the value that paints each track's filled portion.
 *
 * Each slider sits in a .visage-range wrapper with one of two value chips:
 * - a read-only <output>, which shows the slider's value followed by the unit in its data-unit
 *   attribute (for example "°" for an angle), or
 * - an editable number input (.visage-range-number), used for values with no upper limit. The
 *   number is the form field and the slider is unnamed: moving the slider writes into the number,
 *   and typing into the number moves the thumb (which the browser clamps to the slider's range)
 *   without clamping the number itself.
 *
 * A slider whose row has an "apply" checkbox is disabled while that checkbox is cleared. A
 * disabled input is left out of the form data, which is what makes the editor inherit that
 * value from the stack, so the slider must stay disabled rather than read-only. While disabled,
 * the chip shows EMPTY_MARK instead of a value. An editable number cannot display text, so its
 * value is moved into data-held-value and a dash placeholder is shown until the row is enabled.
 *
 * The filled portion of the track (from the minimum up to the thumb) is drawn in CSS from a
 * custom property, --visage-range-fill, holding the thumb's position as a percentage. Only Firefox
 * can colour that portion of a native slider by itself (::-moz-range-progress); Chromium cannot,
 * so the percentage has to be supplied from here and refreshed whenever the value changes. It is
 * worked out from the slider's value, min and max alone, never from its size on screen, so it is
 * correct even for sliders in an inactive tab or an inspector panel moved off-screen.
 *
 * Setting a slider's value from code does not fire an input event, so any code that does so must
 * either call sync() afterwards or dispatch a bubbling "input" event on the slider.
 */
export class VisageRangeDisplay {
    /** Selector for the element wrapping one slider, its label and its value chip. */
    static WRAPPER_SELECTOR = ".visage-range";

    /** The slider inside a wrapper. */
    static SLIDER_SELECTOR = 'input[type="range"].visage-range-input';

    /** The editable number chip inside a wrapper, when there is one. */
    static NUMBER_SELECTOR = "input.visage-range-number";

    /** Shown in place of a value while the row inherits it. Must match the dash in visage-range.hbs. */
    static EMPTY_MARK = "—";

    static #OUTPUT_SELECTOR = "output.visage-range-value";
    static #FILL_PROPERTY = "--visage-range-fill";
    static #FULL_PERCENT = 100;
    // What a range input uses as its maximum when none is set (the HTML default)
    static #DEFAULT_MAX = 100;

    /**
     * Refreshes one slider's chip and filled portion after its value has changed, and copies the
     * value into its editable number chip if it has one.
     *
     * @param {HTMLInputElement} slider - A range input inside a .visage-range wrapper.
     */
    static sync(slider) {
        const wrapper = slider.closest(VisageRangeDisplay.WRAPPER_SELECTOR);
        VisageRangeDisplay.#writeOutput(wrapper, slider);
        VisageRangeDisplay.#pushToNumber(wrapper, slider);
        VisageRangeDisplay.setFill(slider);
    }

    /**
     * Moves a slider's thumb to match a value typed into its editable number chip. The number is
     * left as typed, so it can go beyond the slider's range.
     *
     * @param {HTMLInputElement} number - An editable number chip inside a .visage-range wrapper.
     */
    static syncFromNumber(number) {
        if (number.value === "") return;
        const slider = number.closest(VisageRangeDisplay.WRAPPER_SELECTOR)?.querySelector(VisageRangeDisplay.SLIDER_SELECTOR);
        if (!slider) return;

        slider.value = number.value;
        VisageRangeDisplay.setFill(slider);
    }

    /**
     * Brings a whole row up to date with its slider's current value and disabled state. Call it
     * after the row's apply checkbox changes, and after a window renders.
     *
     * @param {HTMLElement} wrapper - A .visage-range wrapper.
     */
    static refresh(wrapper) {
        const slider = wrapper.querySelector(VisageRangeDisplay.SLIDER_SELECTOR);
        if (!slider) return;

        VisageRangeDisplay.#writeOutput(wrapper, slider);
        const number = wrapper.querySelector(VisageRangeDisplay.NUMBER_SELECTOR);
        if (number) VisageRangeDisplay.#applyNumberState(number, slider);
        VisageRangeDisplay.setFill(slider);
    }

    /**
     * Refreshes every slider row inside an element, such as an application's root element after
     * it renders.
     *
     * @param {HTMLElement} root - The element to search.
     */
    static refreshAll(root) {
        for (const wrapper of root.querySelectorAll(VisageRangeDisplay.WRAPPER_SELECTOR)) {
            VisageRangeDisplay.refresh(wrapper);
        }
    }

    /**
     * Writes a slider's thumb position into the custom property its track's gradient reads.
     *
     * @param {HTMLInputElement} slider - A range input.
     */
    static setFill(slider) {
        slider.style.setProperty(VisageRangeDisplay.#FILL_PROPERTY, `${VisageRangeDisplay.#fillPercent(slider)}%`);
    }

    /**
     * Shows the slider's value and unit in a read-only chip, or the dash while the row inherits.
     */
    static #writeOutput(wrapper, slider) {
        const output = wrapper?.querySelector(VisageRangeDisplay.#OUTPUT_SELECTOR);
        if (!output) return;

        output.value = slider.disabled ? VisageRangeDisplay.EMPTY_MARK : `${slider.value}${output.dataset.unit ?? ""}`;
    }

    /**
     * Copies a moved slider's value into its editable number chip. A change event is dispatched
     * because the number, not the unnamed slider, is the form field, so the editor's form change
     * handler has to see it.
     */
    static #pushToNumber(wrapper, slider) {
        const number = wrapper?.querySelector(VisageRangeDisplay.NUMBER_SELECTOR);
        if (!number || number.disabled || number.value === slider.value) return;

        number.value = slider.value;
        number.dispatchEvent(new Event("change", { bubbles: true }));
    }

    /**
     * Hides or restores an editable number's value to match its row's disabled state. The value
     * is held in data-held-value rather than discarded, so a value beyond the slider's range
     * survives the row being switched off and on again.
     */
    static #applyNumberState(number, slider) {
        if (slider.disabled) {
            if (number.value !== "") number.dataset.heldValue = number.value;
            number.value = "";
            number.placeholder = VisageRangeDisplay.EMPTY_MARK;
            return;
        }

        if (number.value === "") number.value = number.dataset.heldValue ?? slider.value;
        delete number.dataset.heldValue;
        number.placeholder = "";
    }

    /**
     * How far along its track a slider's thumb sits, from 0 at its minimum to 100 at its maximum.
     * A slider whose minimum and maximum are equal reads as empty rather than dividing by zero.
     */
    static #fillPercent(slider) {
        const min = Number.parseFloat(slider.min) || 0;
        const max = Number.parseFloat(slider.max);
        const value = Number.parseFloat(slider.value);
        const span = (Number.isNaN(max) ? VisageRangeDisplay.#DEFAULT_MAX : max) - min;
        if (span <= 0 || Number.isNaN(value)) return 0;

        const fraction = Math.min(1, Math.max(0, (value - min) / span));
        return fraction * VisageRangeDisplay.#FULL_PERCENT;
    }
}
