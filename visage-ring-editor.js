/**
 * @file visage-ring-editor.js
 * @description Defines the VisageRingEditor class.
 * @module visage
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class VisageRingEditor extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(options = {}) {
        super(options);
        this.ringData = options.ringData || {};
        this.callback = options.callback;
        this.visageName = options.visageName || "Visage";
        
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
        classes: ["visage-ring-editor", "visage-dark-theme"],
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

    /** @override */
    get title() {
        return `${game.i18n.localize(this.options.window.title)}: ${this.visageName}`;
    }

    /** @override */
    async _prepareContext(options) {
        const data = this.ringData;
        
        const currentEffects = data.effects || 0;
        const effects = this.availableEffects.map(eff => ({
            ...eff,
            isActive: (currentEffects & eff.value) !== 0
        }));

        // Note: Removed CONST.TOKEN_RING_SUBJECTS logic here

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
            effects: effects
        };
    }

    /** @override */
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
}