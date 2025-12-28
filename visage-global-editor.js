/**
 * @file The Editor application for creating and modifying Global Visage entries.
 * @module visage
 */

import { Visage } from "./visage.js";
import { VisageGlobalData } from "./visage-global-data.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class VisageGlobalEditor extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(options = {}) {
        super(options);
        this.visageId = options.visageId || null;
        this.isDirty = false; // FIX 3: Track Dirty State
    }

    static DEFAULT_OPTIONS = {
        tag: "form",
        id: "visage-global-editor",
        classes: ["visage", "visage-global-editor", "visage-dark-theme"],
        window: {
            title: "VISAGE.GlobalEditor.TitleNew",
            icon: "visage-header-icon",
            resizable: true,
            minimizable: true,
            contentClasses: ["standard-form"]
        },
        position: {
            width: 960,
            height: "auto"
        },
        actions: {
            save: VisageGlobalEditor.prototype._onSave,
            toggleField: VisageGlobalEditor.prototype._onToggleField,
            openFilePicker: VisageGlobalEditor.prototype._onOpenFilePicker
        }
    };

    static PARTS = {
        form: {
            template: "modules/visage/templates/visage-global-editor.hbs",
            scrollable: [".visage-editor-grid"]
        }
    };

    get title() {
        return this.visageId 
            ? game.i18n.format("VISAGE.GlobalEditor.TitleEdit", { name: this._currentLabel || "Visage" })
            : game.i18n.localize("VISAGE.GlobalEditor.TitleNew");
    }

    async _prepareContext(options) {
        let data;
        if (this.visageId) {
            data = VisageGlobalData.get(this.visageId);
            if (!data) return this.close();
            this._currentLabel = data.label;
        } else {
            data = {
                label: "",
                category: "",
                tags: [],
                changes: {}
            };
        }

        const c = data.changes || {};

        const prep = (val, def) => ({
            value: val ?? def,
            active: val !== null && val !== undefined
        });

        // FIX 4: Convert Scale 1.0 -> 100% for display
        const rawScale = c.scale ?? 1.0;
        const displayScale = Math.round(rawScale * 100);

        const prepFlip = (val) => ({
            value: val ?? null // explicit null if undefined
        });

        const ring = c.ring || {};
        const ringActive = !!ring;
        
        const currentEffects = ring.effects || 0;
        const availableEffects = [
            { value: 2, label: "VISAGE.RingConfig.Effects.Pulse", key: "RING_PULSE" },
            { value: 4, label: "VISAGE.RingConfig.Effects.Gradient", key: "RING_GRADIENT" },
            { value: 8, label: "VISAGE.RingConfig.Effects.Wave", key: "BKG_WAVE" },
            { value: 16, label: "VISAGE.RingConfig.Effects.Invisibility", key: "INVISIBILITY" }
        ].map(eff => ({
            ...eff,
            isActive: (currentEffects & eff.value) !== 0
        }));

        return {
            isEdit: !!this.visageId,
            
            label: data.label,
            category: data.category,
            tags: (data.tags || []).join(", "),

            // Visuals
            img: prep(c.img, ""),
            scale: { value: displayScale, active: c.scale !== null && c.scale !== undefined },
            isFlippedX: prepFlip(c.isFlippedX),
            isFlippedY: prepFlip(c.isFlippedY),
            
            // Behavior
            nameOverride: prep(c.name, ""),
            disposition: prep(c.disposition, 0),
            width: prep(c.width, 1),
            height: prep(c.height, 1),

            // Ring
            ring: {
                active: ringActive,
                colors: {
                    ring: ring.colors?.ring || "#FFFFFF",
                    background: ring.colors?.background || "#000000"
                },
                subject: {
                    texture: ring.subject?.texture || "",
                    scale: ring.subject?.scale ?? 1.0
                },
                effects: availableEffects
            }
        };
    }

    _onToggleField(event, target) {
        const fieldName = target.dataset.target;
        const group = target.closest('.form-group');
        const input = group.querySelector(`[name="${fieldName}"]`);
        
        if (input) {
            input.disabled = !target.checked;
            const button = group.querySelector('button.file-picker-button');
            if (button) button.disabled = !target.checked;
        }
        this._markDirty(); // Toggle counts as a change
    }

    _onOpenFilePicker(event, target) {
        const input = target.previousElementSibling;
        const fp = new FilePicker({
            type: "imagevideo",
            current: input.value,
            callback: (path) => {
                input.value = path;
                this._markDirty();
            }
        });
        fp.browse();
    }

    // FIX 3: Dirty State Logic
    _markDirty() {
        if (!this.isDirty) {
            this.isDirty = true;
            const btn = this.element.querySelector(".visage-save");
            if (btn) btn.classList.add("dirty");
        }
    }

    _onRender(context, options) {
        // Listen for ANY input change to trigger dirty state
        this.element.addEventListener("change", () => this._markDirty());
        this.element.addEventListener("input", () => this._markDirty());
    }

    async _onSave(event, target) {
        event.preventDefault();
        const formData = new foundry.applications.ux.FormDataExtended(this.element).object;

        const getVal = (key, type = String) => {
            const isActive = formData[`${key}_active`];
            if (!isActive) return null;
            
            const raw = formData[key];
            if (type === Number) return parseFloat(raw);
            if (type === Boolean) return !!raw;
            return raw;
        };

        let finalScale = null;
        if (formData.scale_active) {
            finalScale = parseFloat(formData.scale) / 100;
        }

        const label = formData.label ? formData.label.trim() : "New Global Visage";

        const getFlipVal = (key) => {
            const val = formData[key]; // returns string "true", "false", or ""
            if (val === "true") return true;
            if (val === "false") return false;
            return null; // "Unchanged"
        };

        const payload = {
            label: label,
            category: formData.category,
            tags: formData.tags.split(",").map(t => t.trim()).filter(t => t),
            
            changes: {
                name: getVal("nameOverride"),
                img: getVal("img"),
                scale: finalScale, // Use converted scale
                isFlippedX: getFlipVal("isFlippedX"),
                isFlippedY: getFlipVal("isFlippedY"),
                width: getVal("width", Number),
                height: getVal("height", Number),
                disposition: getVal("disposition", Number),
                ring: null 
            }
        };

        if (formData.ring_active) {
            let effectsMask = 0;
            for (const [k, v] of Object.entries(formData)) {
                if (k.startsWith("effect_") && v === true) {
                    effectsMask |= parseInt(k.split("_")[1]);
                }
            }

            payload.changes.ring = {
                enabled: true,
                colors: {
                    ring: formData.ringColor,
                    background: formData.ringBackgroundColor
                },
                subject: {
                    texture: formData.ringSubjectTexture,
                    scale: formData.ringSubjectScale
                },
                effects: effectsMask
            };
        }

        try {
            if (this.visageId) {
                await VisageGlobalData.update(this.visageId, payload);
                ui.notifications.info(`Updated Visage: ${payload.label}`);
            } else {
                await VisageGlobalData.create(payload);
                ui.notifications.info(`Created Visage: ${payload.label}`);
            }
            this.close();
        } catch (err) {
            ui.notifications.error("Visage | Save Failed. Check console.");
            console.error(err);
        }
    }
}