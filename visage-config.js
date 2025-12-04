/**
 * @file visage-config.js
 * @description Defines the VisageConfigApp class.
 * @module visage
 */

import { Visage } from "./visage.js";
import { VisageRingEditor } from "./visage-ring-editor.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class VisageConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
    
    constructor(options = {}) {
        super(options);
        this.actorId = options.actorId;
        this.tokenId = options.tokenId;
        this.sceneId = options.sceneId;

        this._tempVisages = null;
        this.childApps = new Set();
        
        this._dispositionMap = {
            [-2]: { name: game.i18n.localize("VISAGE.Disposition.Secret")   },
            [-1]: { name: game.i18n.localize("VISAGE.Disposition.Hostile")  },
            [0]:  { name: game.i18n.localize("VISAGE.Disposition.Neutral")  },
            [1]:  { name: game.i18n.localize("VISAGE.Disposition.Friendly") }
        };
    }

    /** @override */
    static DEFAULT_OPTIONS = {
        tag: "form",
        id: "visage-config",
        classes: ["visage-config-app", "visage-dark-theme"],
        window: {
            title: "VISAGE.Config.Title",
            icon: "visage-header-icon", 
            resizable: true,
            minimizable: true,
            contentClasses: ["standard-form"]
        },
        position: {
            width: "auto",
            height: "auto"
        },
        actions: {
            addVisage: VisageConfigApp.prototype._onAddVisage,
            deleteVisage: VisageConfigApp.prototype._onDeleteVisage,
            save: VisageConfigApp.prototype._onSave,
            toggleDisposition: VisageConfigApp.prototype._onToggleDisposition,
            changeDispositionType: VisageConfigApp.prototype._onChangeDispositionType,
            changeDispositionValue: VisageConfigApp.prototype._onChangeDispositionValue,
            openFilePicker: VisageConfigApp.prototype._onOpenFilePicker,
            openRingEditor: VisageConfigApp.prototype._onOpenRingEditor
        }
    };

    /** @override */
    static PARTS = {
        form: {
            template: "modules/visage/templates/visage-config-app.hbs",
            scrollable: [".visage-config-wrapper"] 
        }
    };

    get title() {
        return game.i18n.localize(this.options.window.title);
    }

    /** @override */
    async _prepareContext(options) {
        // ... (Actor/Token retrieval remains same) ...
        const scene = game.scenes.get(this.sceneId);
        const tokenDocument = scene?.tokens.get(this.tokenId);
        const actor = tokenDocument?.actor ?? game.actors.get(this.actorId);
        if (!actor || !tokenDocument) return {};

        const ns = Visage.DATA_NAMESPACE;
        const moduleData = actor.flags?.[ns] || {};
        
        // 1. Fetch Defaults
        const tokenDefaults = moduleData[this.tokenId]?.defaults || {
            name: tokenDocument.name,
            token: tokenDocument.texture.src,
            scale: tokenDocument.texture.scaleX ?? 1.0,
            disposition: tokenDocument.disposition ?? 0,
            ring: tokenDocument.ring?.toObject() ?? {}
        };
        
        // 2. Process Default Visage (Read-Only Row)
        const defaultVisage = await this._processVisageEntry(
            "default", 
            tokenDefaults.name, 
            tokenDefaults.token, 
            tokenDefaults.scale || 1.0, 
            false, // isFlipped derived from scale inside function
            tokenDefaults.disposition, 
            tokenDefaults.ring,
            false
        );

        // 3. Build Informative Tooltip for Default Ring
        if (defaultVisage.hasRing) {
            const r = tokenDefaults.ring;
            const parts = [game.i18n.localize("VISAGE.RingConfig.Title")];
            if (r.subject?.texture) parts.push(`${game.i18n.localize("VISAGE.RingConfig.SubjectTexture")}: ${r.subject.texture}`);
            if (r.subject?.scale) parts.push(`${game.i18n.localize("VISAGE.RingConfig.SubjectScale")}: ${r.subject.scale}`);
            if (r.colors?.ring) parts.push(`${game.i18n.localize("VISAGE.RingConfig.RingColor")}: ${r.colors.ring}`);
            if (r.colors?.background) parts.push(`${game.i18n.localize("VISAGE.RingConfig.BackgroundColor")}: ${r.colors.background}`);
            
            defaultVisage.ringTooltip = parts.join("<br>");
        } else {
            defaultVisage.ringTooltip = game.i18n.localize("VISAGE.RingConfig.RingDisabled");
        }

        // 4. Process Alternates (Existing Logic)
        let visages = [];
        if (this._tempVisages) {
             visages = this._tempVisages;
        } else {
            const sourceData = moduleData.alternateVisages || moduleData.alternateImages || {};
            const normalizedData = Visage.getVisages(actor);
            
            visages = await Promise.all(normalizedData.map(async (data) => {
                return this._processVisageEntry(
                    data.id, data.name, data.path, data.scale, false, data.disposition, data.ring, false
                );
            }));
        }
        
        // ... (Dirty Check Logic for Alternates remains same) ...
        const sourceData = moduleData.alternateVisages || moduleData.alternateImages || {};
        const normalizedSource = Visage.getVisages(actor);
        
        const processedVisages = await Promise.all(visages.map(async (v) => {
            const original = normalizedSource.find(s => s.id === v.id);
            const originalRing = original ? (original.ring || {}) : {};
            const currentRing = v.ring || {};
            const currentEmpty = foundry.utils.isEmpty(currentRing);
            const originalEmpty = foundry.utils.isEmpty(originalRing);
            
            let isRingDirty = false;
            if (currentEmpty && originalEmpty) isRingDirty = false;
            else isRingDirty = !foundry.utils.objectsEqual(currentRing, originalRing);
            
            v.ringClass = (v.hasRing ? "ring-active" : "") + (isRingDirty ? " ring-dirty" : "");
            return v;
        }));

        return {
            visages: processedVisages,
            // NEW: Pass the full object instead of individual fields
            defaultVisage: defaultVisage, 
            isDirty: this._isDirty || false
        };
    }

    async _processVisageEntry(id, name, path, scale, isFlippedX, disposition, ring, originalRing = {}) {
        let dispositionType = "none";
        let dispositionValue = 0; 
        let buttonText = game.i18n.localize("VISAGE.Config.Disposition.Button.Default");

        if (disposition === -2) {
            dispositionType = "illusion";
            buttonText = game.i18n.localize("VISAGE.Config.Disposition.Button.Illusion");
        } else if (disposition !== null && disposition !== undefined) {
            dispositionType = "disguise";
            dispositionValue = disposition;
            const dispoName = this._dispositionMap[disposition]?.name || "";
            buttonText = game.i18n.format("VISAGE.Config.Disposition.Button.Disguise", { name: dispoName });
        } else {
            dispositionType = "none";
            buttonText = game.i18n.localize("VISAGE.Config.Disposition.Button.Default");
        }

        // Ensure ring is null if empty to keep logic consistent
        const cleanRing = (ring && !foundry.utils.isEmpty(ring)) ? ring : null;
        const hasRing = !!(cleanRing && cleanRing.enabled);
        
        const ringIcon = hasRing ? "fas fa-bullseye" : "far fa-circle";
        let ringClass = hasRing ? "ring-active" : "";
        
        const ringTooltip = hasRing ? "Dynamic Ring Configured" : "Configure Dynamic Ring";

        return {
            id,
            name,
            path,
            scale: Math.round(Math.abs(scale) * 100),
            isFlippedX: (scale < 0) || isFlippedX,
            dispositionType,
            dispositionValue,
            dispositionButtonText: buttonText,
            resolvedPath: await Visage.resolvePath(path),
            
            ring: cleanRing || {}, // Pass object for form/JSON serialization
            hasRing,
            ringIcon,
            ringClass,
            ringTooltip
        };
    }

    async _onAddVisage(event, target) {
        this._tempVisages = await this._readFormData(this.element);
        
        const newEntry = await this._processVisageEntry(
            foundry.utils.randomID(16), 
            "", "", 1.0, false, null, null
        );
        this._tempVisages.push(newEntry);
        
        this._isDirty = true;
        this.render();
    }

    async _onDeleteVisage(event, target) {
        const row = target.closest(".visage-list-item");
        const idToDelete = row.dataset.id;

        this._tempVisages = await this._readFormData(this.element);
        this._tempVisages = this._tempVisages.filter(v => v.id !== idToDelete);
        
        this._isDirty = true;
        this.render();
    }

    _onOpenRingEditor(event, target) {
        this._readFormData(this.element).then(currentData => {
            this._tempVisages = currentData;
            
            const row = target.closest(".visage-list-item");
            const index = parseInt(row.dataset.index);
            const visageData = this._tempVisages[index];

            const editorId = `visage-ring-editor-${this.actorId}-${this.tokenId}-${visageData.id}`;
            
            const ringEditor = new VisageRingEditor({
                ringData: visageData.ring,
                visageName: visageData.name,
                id: editorId,
                callback: (newRingData) => {
                    this.updateRingData(index, newRingData);
                },
                position: {
                    left: event.clientX + 20,
                    top: event.clientY - 50
                }
            });
            this.childApps.add(ringEditor);
            ringEditor.render(true);
        });
    }

    updateRingData(index, ringData) {
        if (this._tempVisages && this._tempVisages[index]) {
            this._tempVisages[index].ring = ringData;
            this._markDirty();
            this.render();
        }
    }

    _onToggleDisposition(event, target) {
        const row = target.closest(".visage-disposition-cell");
        const popout = row.querySelector(".visage-disposition-popout");
        this.element.querySelectorAll(".visage-disposition-popout").forEach(el => {
            if (el !== popout) el.classList.remove("active");
        });
        popout.classList.toggle("active");
    }

    _updateButtonText(popout) {
        const cell = popout.closest(".visage-disposition-cell");
        const button = cell.querySelector(".visage-disposition-button");
        const dispoInput = popout.querySelector('input[name$=".dispositionType"]:checked');
        if (!dispoInput) return;
        const dispoType = dispoInput.value;
        const select = popout.querySelector('select');
        let buttonText = game.i18n.localize("VISAGE.Config.Disposition.Button.Default");
        if (dispoType === "disguise") {
            select.disabled = false;
            const val = parseInt(select.value);
            const dispoName = this._dispositionMap[val]?.name || "";
            buttonText = game.i18n.format("VISAGE.Config.Disposition.Button.Disguise", { name: dispoName });
        } else {
            select.disabled = true;
            if (dispoType === "illusion") {
                buttonText = game.i18n.localize("VISAGE.Config.Disposition.Button.Illusion");
            }
        }
        button.textContent = buttonText;
        this._markDirty();
    }
    
    _onChangeDispositionType(event, target) { this._updateButtonText(target.closest(".visage-disposition-popout")); }
    _onChangeDispositionValue(event, target) { this._updateButtonText(target.closest(".visage-disposition-popout")); }

    _onOpenFilePicker(event, target) {
        const group = target.closest(".visage-path-group");
        const input = group.querySelector("input");
        const fp = new FilePicker({
            type: "image",
            current: input.value,
            callback: (path) => {
                input.value = path;
                this._markDirty();
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        fp.browse();
    }

    _markDirty() {
        this._isDirty = true;
        const btn = this.element.querySelector(".visage-save");
        if (btn) btn.classList.add("dirty");
    }

    async close(options) {
        for (const app of this.childApps) {
            app.close(); 
        }
        this.childApps.clear();
        return super.close(options);
    }

    async _onSave(event, target) {
        event.preventDefault();
        const scene = game.scenes.get(this.sceneId);
        const tokenDocument = scene?.tokens.get(this.tokenId);
        const actor = tokenDocument?.actor ?? game.actors.get(this.actorId);
        if (!actor) return;
        
        const ns = Visage.DATA_NAMESPACE;
        const moduleData = actor.flags?.[ns] || {};
        const tokenDefaults = moduleData[this.tokenId]?.defaults || {
            name: tokenDocument?.name,
            token: tokenDocument?.texture.src
        };

        const currentVisages = await this._readFormData(this.element);
        
        const newKeys = new Set(); 
        const visagesToSave = [];

        for (const v of currentVisages) {
            const finalPath = v.path ? v.path.trim() : (tokenDefaults.token || "");
            const finalName = v.name ? v.name.trim() : (tokenDefaults.name || "Visage");

            if (!finalPath) {
                return ui.notifications.error(game.i18n.format("VISAGE.Notifications.NoPath", { name: finalName }));
            }
            
            newKeys.add(v.id); 
            visagesToSave.push({ ...v, name: finalName, path: finalPath });
        }

        const newVisages = {};
        for (const v of visagesToSave) {
            let scale = v.scale / 100;
            if (v.isFlippedX) scale = -Math.abs(scale);
            else scale = Math.abs(scale);

            let disposition = null;
            if (v.dispositionType === "illusion") {
                disposition = -2;
            } else if (v.dispositionType === "disguise") {
                disposition = parseInt(v.dispositionValue);
            }

            // FIX: Ensure we save null if ring is empty, avoiding {} persistence
            const ringToSave = (v.ring && !foundry.utils.isEmpty(v.ring)) ? v.ring : null;

            newVisages[v.id] = {
                name: v.name,
                path: v.path,
                scale: scale,
                disposition: disposition,
                ring: ringToSave
            };
        }

        const updates = {
            [`flags.${ns}.alternateVisages`]: newVisages,
            [`flags.${ns}.-=alternateImages`]: null 
        };

        const currentFlags = actor.flags[ns]?.alternateVisages || {};
        for (const existingKey of Object.keys(currentFlags)) {
            if (!newKeys.has(existingKey)) {
                updates[`flags.${ns}.alternateVisages.-=${existingKey}`] = null;
            }
        }

        await actor.update(updates);
        
        this._isDirty = false;
        this._tempVisages = null;
        this.render();
        ui.notifications.info(game.i18n.localize("VISAGE.Notifications.Saved"));
        
        if (tokenDocument?.object) {
            tokenDocument.object.refresh();
        }
        this.close();
    }

    async _readFormData(formElement) {
        const formData = new foundry.applications.ux.FormDataExtended(formElement).object;
        const visages = [];
        
        const indices = new Set();
        for (const key of Object.keys(formData)) {
            const match = key.match(/^visages\.(\d+)\./);
            if (match) indices.add(parseInt(match[1]));
        }

        for (const i of Array.from(indices).sort((a,b) => a - b)) {
            const id = formData[`visages.${i}.id`];
            const name = formData[`visages.${i}.name`];
            const path = formData[`visages.${i}.path`];
            const rawScale = formData[`visages.${i}.scale`];
            const scale = (rawScale ? parseFloat(rawScale) : 100) / 100;
            const isFlippedX = formData[`visages.${i}.isFlippedX`] || false;
            const dispositionType = formData[`visages.${i}.dispositionType`];
            const dispositionValue = formData[`visages.${i}.dispositionValue`];

            // FIX: Default to null, not {}
            let ring = null; 
            try {
                const ringRaw = formData[`visages.${i}.ringJSON`];
                if (ringRaw) ring = JSON.parse(ringRaw);
            } catch (e) { console.warn("Visage | Failed to parse ring data", e); }

            let disposition = null;
            if (dispositionType === "illusion") {
                disposition = -2;
            } else if (dispositionType === "disguise") {
                disposition = parseInt(dispositionValue);
            }

            visages.push(await this._processVisageEntry(
                id, name, path, scale, isFlippedX, disposition, ring
            ));
        }
        return visages;
    }

    /** @override */
    _onRender(context, options) {
        const inputs = this.element.querySelectorAll("input, select");
        inputs.forEach(i => i.addEventListener("change", () => this._markDirty()));
        
        this.element.addEventListener('click', (event) => {
            if (!event.target.closest('.visage-disposition-popout') && 
                !event.target.closest('.visage-disposition-button')) {
                this.element.querySelectorAll('.visage-disposition-popout.active').forEach(el => {
                    el.classList.remove('active');
                });
            }
        });
    }
}