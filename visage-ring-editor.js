/**
 * @file Defines the VisageRingEditor class, a specialized application for configuring a visage's dynamic ring.
 * @module visage
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * A specialized child application for editing the dynamic ring properties of a single visage.
 * It is opened by the main `VisageConfigApp` and uses a callback to return the updated data.
 * @extends {HandlebarsApplicationMixin(ApplicationV2)}
 */
export class VisageRingEditor extends HandlebarsApplicationMixin(ApplicationV2) {
    /**
     * @param {object} [options={}] - Application configuration options.
     * @param {object} [options.ringData={}] - The initial ring data to edit.
     * @param {Function} options.callback - A function to call with the updated ring data when saved.
     * @param {string} [options.visageName="Visage"] - The name of the parent visage, used in the window title.
     * @param {string} [options.effectivePath=""] - The resolved image path for this visage, used for validation.
     */
    constructor(options = {}) {
        super(options);
        /**
         * The ring data object being edited.
         * @type {object}
         * @protected
         */
        this.ringData = options.ringData || {};
        
        /**
         * The callback function to execute on save.
         * @type {Function}
         * @protected
         */
        this.callback = options.callback;
        
        /**
         * The name of the parent visage.
         * @type {string}
         * @protected
         */
        this.visageName = options.visageName || "Visage";

        /**
         * The effective image path for this visage (inherited or overridden).
         * Used to check for video compatibility.
         * @type {string}
         * @protected
         */
        this.effectivePath = options.effectivePath || "";
        
        /**
         * The available ring effects, with their bitwise values and labels.
         * @type {Array<object>}
         * @protected
         */
        this.availableEffects = [
            { value: 2, label: "VISAGE.RingConfig.Effects.Pulse", key: "RING_PULSE" },
            { value: 4, label: "VISAGE.RingConfig.Effects.Gradient", key: "RING_GRADIENT" },
            { value: 8, label: "VISAGE.RingConfig.Effects.Wave", key: "BKG_WAVE" },
            { value: 16, label: "VISAGE.RingConfig.Effects.Invisibility", key: "INVISIBILITY" }
        ];
    }

    /** @override */
    static DEFAULT_OPTIONS = {
        tag: "form",
        id: "visage-ring-editor",
        // PRESERVED: Your specific classes
        classes: ["visage", "visage-ring-editor", "visage-dark-theme"],
        window: {
            title: "VISAGE.RingConfig.Title",
            icon: "visage-header-icon",
            resizable: false,
            minimizable: false,
            contentClasses: ["standard-form"]
        },
        position: {
            width: "auto",
            height: "auto"
        },
        actions: {
            save: VisageRingEditor.prototype._onSave
        }
    };

    /** @override */
    static PARTS = {
        form: {
            template: "modules/visage/templates/visage-ring-editor.hbs",
        }
    };

    /**
     * The localized title of the application window, including the visage name.
     * @returns {string}
     * @override
     */
    get title() {
        return `${game.i18n.localize(this.options.window.title)}: ${this.visageName}`;
    }

    /**
     * Prepares the data context for rendering the ring editor template.
     * This method unpacks the `ringData` object into a format that the Handlebars template can easily use.
     * A key task is to take the `effects` property, which is a bitwise integer (a bitmask), and
     * transform it into an array of objects where each effect has an `isActive` boolean property. This allows
     * the template to simply loop through the effects and render checkboxes with the correct `checked` state.
     *
     * @param {object} options - Options passed to the render cycle.
     * @returns {Promise<object>} The context object for the template.
     * @protected
     * @override
     */
    async _prepareContext(options) {
        const data = this.ringData;
        
        const currentEffects = data.effects || 0;
        const effects = this.availableEffects.map(eff => ({
            ...eff,
            isActive: (currentEffects & eff.value) !== 0
        }));

        // Check if the effective path is a video file.
        // If so, enabling the ring will freeze the video, so must warn the user.
        const showVideoWarning = foundry.helpers.media.VideoHelper.hasVideoExtension(this.effectivePath);

        return {
            enabled: data.enabled ?? false,
            subject: {
                texture: data.subject?.texture ?? "",
                scale: data.subject?.scale ?? 1.0
            },
            colors: {
                ring: data.colors?.ring ?? "#FFFFFF",
                background: data.colors?.background ?? "#000000"
            },
            effects: effects,
            showVideoWarning: showVideoWarning // Pass flag to template
        };
    }

    /**
     * Handles the 'Save' button click event.
     * This method reads the data from the form inputs and reconstructs the `ringData` object.
     * It performs the reverse operation of `_prepareContext` for the `effects` property: it iterates
     * over the effect checkboxes and uses bitwise OR operations to combine the values of the checked
     * effects back into a single integer bitmask. The final `newRingData` object is then passed to the
     * parent application's callback function.
     *
     * @param {PointerEvent} event - The triggering click event.
     * @param {HTMLElement} target - The button element that was clicked.
     * @protected
     * @override
     */
    async _onSave(event, target) {
        event.preventDefault();
        const formData = new foundry.applications.ux.FormDataExtended(this.element).object;

        const newRingData = {
            enabled: formData.enabled,
            subject: {
                texture: formData.subjectTexture,
                scale: formData.subjectScale
            },
            colors: {
                ring: formData.ringColor,
                background: formData.backgroundColor
            },
            effects: 0
        };

        // Re-construct the bitmask from the individual effect checkboxes.
        for (const [key, value] of Object.entries(formData)) {
            if (key.startsWith("effect_") && value === true) {
                const bitValue = parseInt(key.split("_")[1]);
                newRingData.effects |= bitValue;
            }
        }

        if (this.callback) {
            this.callback(newRingData);
        }

        this.close();
    }

    /** * @override 
     * Inject RTL attributes into the editor window if necessary.
     */
    _onRender(context, options) {
        const rtlLanguages = ["ar", "he", "fa", "ur"];
        if (rtlLanguages.includes(game.i18n.lang)) {
            this.element.setAttribute("dir", "rtl");
            this.element.classList.add("rtl");
        }
    }
}