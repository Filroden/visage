/**
 * VISAGE SETTINGS SECTIONS
 * -------------------------------------------------------------------
 * Manages the collapsible sections (<details class="visage-section">) in the Visage Editor's
 * settings panel.
 *
 * - Open state: the editor re-renders often (selecting a layer, adding an effect), and a fresh
 *   render would otherwise reopen every section. The open state is remembered per section key
 *   (data-section) and restored after each render, so a section stays the way the user left it,
 *   including across different effects that share a section key.
 * - Summaries: a section whose rows have "apply" checkboxes (the Token appearance sections)
 *   shows how many properties it changes, and, while collapsed, a chip for each one. Collapsing
 *   every section therefore gives an overview of what the Visage changes without a separate
 *   "show changed only" filter.
 *
 * Summaries are read from the form itself rather than from the editor's data, so they always
 * match what the user sees, including edits that have not been saved or re-rendered yet.
 */

/** Selector for one collapsible section. */
const SECTION_SELECTOR = "details.visage-section";

/** Selector for a ticked "apply" checkbox (named "<property>_active"). */
const ACTIVE_CHECKBOX_SELECTOR = 'input[type="checkbox"][name$="_active"]:checked';

/** The row that holds one property: an ordinary checkbox row or a range slider row. */
const ROW_SELECTOR = ".visage-range, .form-group";

/** Values longer than this are shortened in a chip; the full value is in the chip's tooltip. */
const MAX_CHIP_VALUE_LENGTH = 24;

/** The ellipsis appended to a shortened chip value. */
const ELLIPSIS = "…";

export class VisageSettingsSections {
    constructor() {
        /** @type {Map<string, boolean>} Open state by section key. */
        this._openState = new Map();
    }

    /**
     * Starts remembering the open state of every section inside an element. Call once: the
     * listener sits on the root element, which persists across re-renders.
     *
     * The "toggle" event does not bubble, so it is caught in the capture phase instead.
     *
     * @param {HTMLElement} root - The application's root element.
     */
    bind(root) {
        root.addEventListener(
            "toggle",
            (event) => {
                const section = event.target;
                if (!section.matches?.(SECTION_SELECTOR) || !section.dataset.section) return;
                this._openState.set(section.dataset.section, section.open);
            },
            true,
        );
    }

    /**
     * Restores the remembered open state after a render. Sections never toggled keep the open
     * state their template gave them.
     *
     * @param {HTMLElement} root - The element to search.
     */
    restore(root) {
        for (const section of root.querySelectorAll(SECTION_SELECTOR)) {
            const open = this._openState.get(section.dataset.section);
            if (open !== undefined) section.open = open;
        }
    }

    /**
     * Collapses every section in a panel, or expands them all if every one is already collapsed.
     *
     * @param {HTMLElement} panel - The settings panel whose sections should change.
     */
    toggleAll(panel) {
        const sections = [...panel.querySelectorAll(SECTION_SELECTOR)];
        const open = sections.every((section) => !section.open);
        for (const section of sections) section.open = open;
    }

    /**
     * Refreshes the override count and chips of every section inside an element.
     *
     * @param {HTMLElement} root - The element to search.
     */
    refresh(root) {
        for (const section of root.querySelectorAll(SECTION_SELECTOR)) {
            VisageSettingsSections.#refreshSection(section);
        }
    }

    /**
     * Counts the ticked "apply" checkboxes inside an element.
     *
     * @param {HTMLElement} root - The element to search.
     * @returns {number}
     */
    static countOverrides(root) {
        return root.querySelectorAll(ACTIVE_CHECKBOX_SELECTOR).length;
    }

    /**
     * Writes one section's count and chips. Sections without a count element (those whose rows
     * have no apply checkbox) are left alone.
     */
    static #refreshSection(section) {
        const count = section.querySelector(".visage-section-count");
        const chips = section.querySelector(".visage-section-chips");
        if (!count || !chips) return;

        const ticked = [...section.querySelectorAll(ACTIVE_CHECKBOX_SELECTOR)];
        count.textContent = String(ticked.length);
        count.hidden = ticked.length === 0;

        chips.replaceChildren(...ticked.map((checkbox) => VisageSettingsSections.#buildChip(checkbox)));
        if (!ticked.length) chips.replaceChildren(VisageSettingsSections.#buildEmptyChip());
    }

    /**
     * Builds the chip for one ticked property: its label followed by its current value.
     */
    static #buildChip(checkbox) {
        const row = checkbox.closest(ROW_SELECTOR);
        const label = VisageSettingsSections.#readLabel(row);
        const value = VisageSettingsSections.#readValue(row);

        const chip = document.createElement("span");
        chip.className = "visage-section-chip";
        chip.textContent = value ? `${label} ${VisageSettingsSections.#shorten(value)}` : label;
        if (value) chip.dataset.tooltip = `${label} ${value}`;
        return chip;
    }

    /** The chip shown in a section that changes nothing. */
    static #buildEmptyChip() {
        const chip = document.createElement("span");
        chip.className = "visage-section-chip empty";
        chip.textContent = game.i18n.localize("VISAGE.Editor.Sections.NothingChanged");
        return chip;
    }

    /** Reads a row's visible label, ignoring any icons inside it. */
    static #readLabel(row) {
        const label = row?.querySelector(".visage-range-name, label");
        return label?.textContent.replace(/\s+/g, " ").trim() ?? "";
    }

    /**
     * Reads a row's current value as the user sees it: the slider chip's text, a select's
     * chosen option, or the typed value of its inputs (several inputs, such as anchor X and Y,
     * are joined with a slash). File paths are reduced to the file name.
     */
    static #readValue(row) {
        if (!row) return "";

        const output = row.querySelector("output.visage-range-value");
        if (output) return output.value;

        const select = row.querySelector("select:not(:disabled)");
        if (select) return select.selectedOptions[0]?.text.trim() ?? "";

        const inputs = [...row.querySelectorAll('input:not([type="checkbox"]):not([type="hidden"]):not([type="range"]):not(:disabled)')];
        return inputs
            .map((input) => VisageSettingsSections.#fileName(input.value))
            .filter(Boolean)
            .join(" / ");
    }

    /** Reduces a path to its last segment; other text is returned unchanged. */
    static #fileName(value) {
        return String(value ?? "").split("/").pop();
    }

    /** Shortens a long value so a chip stays on one line. */
    static #shorten(value) {
        return value.length > MAX_CHIP_VALUE_LENGTH ? `${value.slice(0, MAX_CHIP_VALUE_LENGTH)}${ELLIPSIS}` : value;
    }
}
