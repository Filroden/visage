import { MODULE_ID } from "../../core/visage-constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class VisageAttributePicker extends HandlebarsApplicationMixin(
    ApplicationV2,
) {
    constructor(options = {}) {
        super(options);
        this.actor = options.actor;
        this.onSelect = options.onSelect;
    }

    static DEFAULT_OPTIONS = {
        tag: "div",
        id: "visage-attribute-picker",
        classes: ["visage", "visage-dark-theme", "visage-attribute-picker-app"],
        window: {
            title: "VISAGE.Editor.Triggers.AttributePicker",
            icon: "visage-icon-attribute",
            resizable: true,
        },
        position: { width: 400, height: 500 },
        actions: {
            selectAttribute: VisageAttributePicker.prototype._onSelectAttribute,
        },
    };

    static PARTS = {
        picker: {
            template:
                "modules/visage/templates/helpers/visage-attribute-picker.hbs",
            scrollable: [".visage-attribute-list"],
        },
    };

    async _prepareContext() {
        if (!this.actor) return { attributes: [] };

        // Flatten the Actor's System Data
        const flatSystem = foundry.utils.flattenObject(this.actor.system);
        const attributes = [];

        for (const [key, value] of Object.entries(flatSystem)) {
            // Include Numbers and Booleans
            let isValid =
                typeof value === "number" || typeof value === "boolean";

            // Include Strings, but ONLY if they are short (no HTML biographies)
            if (
                typeof value === "string" &&
                value.length < 50 &&
                !value.includes("<")
            ) {
                isValid = true;
            }

            if (isValid) {
                attributes.push({
                    path: `system.${key}`,
                    value: value,
                    type: typeof value,
                });
            }
        }

        // Sort alphabetically for easier scanning
        attributes.sort((a, b) => a.path.localeCompare(b.path));

        return {
            attributes,
            isEmpty: attributes.length === 0,
        };
    }

    _onRender(context, options) {
        // Bind the live search bar using pure DOM manipulation
        const searchInput = this.element.querySelector(
            ".visage-attribute-search",
        );
        const items = this.element.querySelectorAll(".attribute-item");
        const emptyState = this.element.querySelector(".empty-state-dynamic");

        if (searchInput) {
            searchInput.addEventListener("input", (e) => {
                const query = e.target.value.trim().toLowerCase();
                let visibleCount = 0;

                // Loop through all items and hide/show them based on the query
                items.forEach((item) => {
                    const path = item.dataset.path.toLowerCase();
                    if (path.includes(query)) {
                        item.style.display = "flex"; // Match the CSS display type
                        visibleCount++;
                    } else {
                        item.style.display = "none";
                    }
                });

                // Toggle the empty state message if no results match
                if (emptyState) {
                    emptyState.style.display =
                        visibleCount === 0 ? "block" : "none";
                }
            });

            // Auto-focus the search bar when the window opens
            searchInput.focus();
        }
    }

    _onSelectAttribute(event, target) {
        const path = target.closest(".attribute-item").dataset.path;
        if (this.onSelect) {
            this.onSelect(path);
        }
        this.close();
    }
}
