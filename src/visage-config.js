/**
 * @file Defines the configuration application for managing an actor's visages.
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
        classes: ["visage", "visage-config-app", "visage-dark-theme"],
        window: {
            title: "VISAGE.Config.Title",
            icon: "visage-header-icon", 
            resizable: true,
            minimizable: true,
            contentClasses: ["standard-form"]
        },
        position: { width: "auto", height: "auto" },
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

    /**
     * Helper to retrieve the token's default data.
     * @private
     */
    _getTokenDefaults() {
        // 1. Try to get the specific token
        const scene = game.scenes.get(this.sceneId);
        const tokenDocument = scene?.tokens.get(this.tokenId);
        
        // 2. If token exists, return its specific data
        if (tokenDocument) {
            const ns = Visage.DATA_NAMESPACE;
            const moduleData = tokenDocument.actor?.flags?.[ns] || {};
            const savedDefaults = moduleData[this.tokenId]?.defaults || {};

            const rawScaleX = savedDefaults.scale ?? tokenDocument.texture.scaleX ?? 1.0;
            const rawScaleY = savedDefaults.scaleY ?? tokenDocument.texture.scaleY ?? 1.0;

            return {
                name: savedDefaults.name || tokenDocument.name,
                token: savedDefaults.token || tokenDocument.texture.src,
                scale: Math.abs(rawScaleX), 
                isFlippedX: rawScaleX < 0,
                isFlippedY: rawScaleY < 0,
                disposition: savedDefaults.disposition ?? tokenDocument.disposition ?? 0,
                width: savedDefaults.width ?? tokenDocument.width ?? 1,
                height: savedDefaults.height ?? tokenDocument.height ?? 1,
                ring: savedDefaults.ring ? savedDefaults.ring : (tokenDocument.ring?.toObject ? tokenDocument.ring.toObject() : (tokenDocument.ring || {}))
            };
        }

        // 3. FALLBACK: Prototype Token
        const actor = game.actors.get(this.actorId);
        const proto = actor?.prototypeToken;
        if (!proto) return {};

        const ringData = (proto.ring && typeof proto.ring.toObject === "function") 
            ? proto.ring.toObject() 
            : (proto.ring || {});

        return {
            name: proto.name,
            token: proto.texture.src,
            scale: Math.abs(proto.texture.scaleX ?? 1.0),
            isFlippedX: (proto.texture.scaleX ?? 1.0) < 0,
            isFlippedY: (proto.texture.scaleY ?? 1.0) < 0,
            disposition: proto.disposition ?? 0,
            width: proto.width ?? 1,
            height: proto.height ?? 1,
            ring: ringData
        };
    }

    /** @override */
    async _prepareContext(options) {
        const scene = game.scenes.get(this.sceneId);
        const tokenDocument = scene?.tokens.get(this.tokenId);
        const actor = tokenDocument?.actor ?? game.actors.get(this.actorId);
        if (!actor) return {};

        // --- 1. PREPARE DEFAULT VISAGE ---
        const tokenDefaults = this._getTokenDefaults();
        
        const defaultVisage = await this._processVisageEntry(
            "default", 
            tokenDefaults.name, 
            tokenDefaults.token, 
            tokenDefaults.scale || 1.0, 
            tokenDefaults.isFlippedX,
            tokenDefaults.disposition, 
            tokenDefaults.ring,
            tokenDefaults.width || 1,
            tokenDefaults.height || 1,
            tokenDefaults.isFlippedY
        );

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

        // --- 2. PREPARE ALTERNATE VISAGES ---
        let visages = [];
        
        // A. If we have unsaved changes in memory, use those
        if (this._tempVisages) {
             visages = this._tempVisages;
        } 
        // B. Otherwise, fetch from database using the UNIFIED MODEL
        else {
            const normalizedData = Visage.getVisages(actor);
            visages = await Promise.all(normalizedData.map(async (data) => {
                // The Unified Model stores data in 'changes'
                const c = data.changes;
                
                // Extract properties from the 'changes' object
                const rawScaleX = c.texture?.scaleX ?? 1.0;
                const rawScaleY = c.texture?.scaleY ?? 1.0;
                
                return this._processVisageEntry(
                    data.id,
                    data.label,          // Unified Label -> UI Name
                    c.img,               // Unified Img -> UI Path
                    Math.abs(rawScaleX), // Derive absolute scale
                    rawScaleX < 0,       // Derive Flip X
                    c.disposition,
                    c.ring,
                    c.width,
                    c.height,
                    rawScaleY < 0        // Derive Flip Y
                );
            }));
        }
        
        // --- 3. CALCULATE DIRTY STATE FOR RINGS ---
        const normalizedSource = Visage.getVisages(actor);
        
        const processedVisages = await Promise.all(visages.map(async (v) => {
            const original = normalizedSource.find(s => s.id === v.id);
            // In Unified Model, ring is at original.changes.ring
            const originalRing = original ? (original.changes?.ring || {}) : {};
            const currentRing = v.ring || {};
            
            const currentEmpty = foundry.utils.isEmpty(currentRing);
            const originalEmpty = foundry.utils.isEmpty(originalRing);
            
            let isRingDirty = false;
            if (currentEmpty && originalEmpty) isRingDirty = false;
            else isRingDirty = !foundry.utils.objectsEqual(currentRing, originalRing);
            
            v.ringClass = (v.hasRing ? "ring-active" : "") + (isRingDirty ? " ring-dirty" : "");
            return v;
        }));

        const isActorMode = !this.tokenId;
        
        return {
            visages: processedVisages,
            defaultVisage: defaultVisage,
            isDirty: this._isDirty || false,
            defaultLegend: isActorMode 
                ? game.i18n.localize("VISAGE.Config.DefaultLegendPrototype") 
                : game.i18n.localize("VISAGE.Config.DefaultLegend"),
            defaultHint: isActorMode
                ? game.i18n.localize("VISAGE.Config.DefaultHintPrototype")
                : game.i18n.localize("VISAGE.Config.DefaultHint")
        };
    }

    /**
     * Processes a single visage data object for template rendering.
     * @private
     */
    async _processVisageEntry(id, name, path, scale, isFlippedX, disposition, ring, width = 1, height = 1, isFlippedY = false) {
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
        }

        const cleanRing = (ring && !foundry.utils.isEmpty(ring)) ? ring : null;
        const hasRing = !!(cleanRing && cleanRing.enabled);
        
        return {
            id,
            name,
            path,
            scale: Math.round(Math.abs(scale) * 100),
            isFlippedX: isFlippedX,
            isFlippedY: isFlippedY,
            dispositionType,
            dispositionValue,
            dispositionButtonText: buttonText,
            resolvedPath: await Visage.resolvePath(path),
            ring: cleanRing || {},
            hasRing,
            ringIcon: hasRing ? "fas fa-bullseye" : "far fa-circle",
            ringClass: hasRing ? "ring-active" : "",
            ringTooltip: hasRing ? "Dynamic Ring Configured" : "Configure Dynamic Ring",
            width: width || 1,
            height: height || 1
        };
    }

    /**
     * Helper to Scrape HTML Form into Array of Objects.
     * @private
     */
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
            // Name/Path/Scale logic is standard
            const name = formData[`visages.${i}.name`];
            const path = formData[`visages.${i}.path`];
            const rawScale = formData[`visages.${i}.scale`];
            const scale = (rawScale ? parseFloat(rawScale) : 100) / 100;
            const isFlippedX = formData[`visages.${i}.isFlippedX`] || false;
            const isFlippedY = formData[`visages.${i}.isFlippedY`] || false;
            const dispositionType = formData[`visages.${i}.dispositionType`];
            const dispositionValue = formData[`visages.${i}.dispositionValue`];
            const width = formData[`visages.${i}.width`] ? parseFloat(formData[`visages.${i}.width`]) : 1;
            const height = formData[`visages.${i}.height`] ? parseFloat(formData[`visages.${i}.height`]) : 1;

            let ring = null; 
            try {
                const ringRaw = formData[`visages.${i}.ringJSON`];
                if (ringRaw) ring = JSON.parse(ringRaw);
            } catch (e) { console.warn("Visage | Failed to parse ring data", e); }

            let disposition = null;
            if (dispositionType === "illusion") disposition = -2;
            else if (dispositionType === "disguise") disposition = parseInt(dispositionValue);

            visages.push(await this._processVisageEntry(
                id, name, path, scale, isFlippedX, disposition, ring, width, height, isFlippedY
            ));
        }
        return visages;
    }

    // --- Actions ---

    async _onAddVisage(event, target) {
        this._tempVisages = await this._readFormData(this.element);
        const defaults = this._getTokenDefaults();

        const newEntry = await this._processVisageEntry(
            foundry.utils.randomID(16), 
            "", defaults.token || "", defaults.scale ?? 1.0, 
            false, null, null, 
            defaults.width || 1, defaults.height || 1
        );
        this._tempVisages.push(newEntry);
        this._markDirty();
        this.render();
    }

    async _onDeleteVisage(event, target) {
        const idToDelete = target.closest(".visage-list-item").dataset.id;
        this._tempVisages = await this._readFormData(this.element);
        this._tempVisages = this._tempVisages.filter(v => v.id !== idToDelete);
        this._markDirty();
        this.render();
    }

    _onOpenRingEditor(event, target) {
        this._readFormData(this.element).then(currentData => {
            this._tempVisages = currentData;
            const row = target.closest(".visage-list-item");
            const index = parseInt(row.dataset.index);
            const visageData = this._tempVisages[index];
            const defaults = this._getTokenDefaults();
            const effectivePath = visageData.path || defaults.token || "";

            const editorId = `visage-ring-editor-${this.actorId}-${this.tokenId}-${visageData.id}`;
            const ringEditor = new VisageRingEditor({
                ringData: visageData.ring,
                visageName: visageData.name,
                effectivePath: effectivePath, 
                id: editorId,
                callback: (newRingData) => this.updateRingData(index, newRingData),
                position: { left: event.clientX + 20, top: event.clientY - 50 }
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
        const popout = target.closest(".visage-disposition-cell").querySelector(".visage-disposition-popout");
        this.element.querySelectorAll(".visage-disposition-popout").forEach(el => { if(el !== popout) el.classList.remove("active"); });
        popout.classList.toggle("active");
    }

    _updateButtonText(popout) {
        const cell = popout.closest(".visage-disposition-cell");
        const button = cell.querySelector(".visage-disposition-button");
        const dispoType = popout.querySelector('input[name$=".dispositionType"]:checked')?.value;
        const select = popout.querySelector('select');
        let buttonText = game.i18n.localize("VISAGE.Config.Disposition.Button.Default");
        
        if (dispoType === "disguise") {
            select.disabled = false;
            const val = parseInt(select.value);
            const dispoName = this._dispositionMap[val]?.name || "";
            buttonText = game.i18n.format("VISAGE.Config.Disposition.Button.Disguise", { name: dispoName });
        } else {
            select.disabled = true;
            if (dispoType === "illusion") buttonText = game.i18n.localize("VISAGE.Config.Disposition.Button.Illusion");
        }
        button.textContent = buttonText;
        this._markDirty();
    }
    
    _onChangeDispositionType(event, target) { this._updateButtonText(target.closest(".visage-disposition-popout")); }
    _onChangeDispositionValue(event, target) { this._updateButtonText(target.closest(".visage-disposition-popout")); }

    _onOpenFilePicker(event, target) {
        const input = target.closest(".visage-path-group").querySelector("input");
        new FilePicker({
            type: "imagevideo",
            current: input.value,
            callback: (path) => {
                input.value = path;
                this._markDirty();
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }).browse();
    }

    _markDirty() {
        this._isDirty = true;
        const btn = this.element.querySelector(".visage-save");
        if (btn) btn.classList.add("dirty");
    }

    async close(options) {
        for (const app of this.childApps) app.close(); 
        this.childApps.clear();
        return super.close(options);
    }

    _isValidPath(path) {
        if (!path) return true;
        const validExtensions = new Set([...Object.keys(CONST.IMAGE_FILE_EXTENSIONS), ...Object.keys(CONST.VIDEO_FILE_EXTENSIONS)]);
        const cleanPath = path.split("?")[0].trim();
        const parts = cleanPath.split(".");
        if (parts.length < 2) return false; 
        return validExtensions.has(parts.pop().toLowerCase());
    }

    /**
     * Handles the 'Save' button click event.
     * REFACTORED: Now saves data in the UNIFIED MODEL (nested changes).
     * @private
     */
    async _onSave(event, target) {
        event.preventDefault();
        const scene = game.scenes.get(this.sceneId);
        const tokenDocument = scene?.tokens.get(this.tokenId);
        const actor = tokenDocument?.actor ?? game.actors.get(this.actorId);
        if (!actor) return;
        
        const ns = Visage.DATA_NAMESPACE;
        const tokenDefaults = this._getTokenDefaults();
        const currentVisages = await this._readFormData(this.element);        
        const newKeys = new Set(); 
        const visagesToSave = [];

        for (const v of currentVisages) {
            // Validation
            const rawPath = v.path ? v.path.trim() : "";
            if (rawPath && !this._isValidPath(rawPath)) {
                ui.notifications.error(game.i18n.format("VISAGE.Notifications.InvalidPath", { name: v.name || "Visage" }));
                return;
            }
            const finalPath = rawPath || (tokenDefaults.token || "");
            const finalName = v.name ? v.name.trim() : (tokenDefaults.name || "Visage");

            if (!finalPath) {
                return ui.notifications.error(game.i18n.format("VISAGE.Notifications.NoPath", { name: finalName }));
            }
            
            newKeys.add(v.id); 
            visagesToSave.push({ ...v, name: finalName, path: finalPath });
        }

        const newVisages = {};
        for (const v of visagesToSave) {
            const scale = Math.abs(v.scale / 100);

            let disposition = null;
            if (v.dispositionType === "illusion") disposition = -2;
            else if (v.dispositionType === "disguise") disposition = parseInt(v.dispositionValue);

            const ringToSave = (v.ring && !foundry.utils.isEmpty(v.ring)) ? v.ring : null;

            // --- UNIFIED MODEL CONSTRUCTION ---
            newVisages[v.id] = {
                id: v.id,
                label: v.name, // The display name in the UI
                
                // Metadata (Empty for local, but present for schema)
                category: "",
                tags: [],
                
                // The Update Object
                changes: {
                    name: v.name,
                    img: v.path,
                    texture: {
                        scaleX: scale * (v.isFlippedX ? -1 : 1),
                        scaleY: scale * (v.isFlippedY ? -1 : 1)
                    },
                    width: v.width || 1,
                    height: v.height || 1,
                    disposition: disposition,
                    ring: ringToSave
                }
            };
        }

        const updates = {
            [`flags.${ns}.alternateVisages`]: newVisages,
            [`flags.${ns}.-=alternateImages`]: null // Cleanup really old data if present
        };

        // Handle deletion of removed keys
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

    _onRender(context, options) {
        const rtlLanguages = ["ar", "he", "fa", "ur"];
        if (rtlLanguages.includes(game.i18n.lang)) {
            this.element.setAttribute("dir", "rtl");
            this.element.classList.add("rtl");
        }
        const inputs = this.element.querySelectorAll("input, select");
        inputs.forEach(i => i.addEventListener("change", () => this._markDirty()));
        this.element.addEventListener('click', (event) => {
            if (!event.target.closest('.visage-disposition-popout') && !event.target.closest('.visage-disposition-button')) {
                this.element.querySelectorAll('.visage-disposition-popout.active').forEach(el => el.classList.remove('active'));
            }
        });
    }
}