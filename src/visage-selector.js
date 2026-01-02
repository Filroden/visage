/**
 * @file Defines the VisageSelector application.
 * @module visage
 */

import { Visage } from "./visage.js";
import { VisageGallery } from "./visage-gallery.js"; 
import { VisageComposer } from "./visage-composer.js";
import { VisageData } from "./visage-data.js"; 

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class VisageSelector extends HandlebarsApplicationMixin(ApplicationV2) {
    
    constructor(options = {}) {
        super(options);
        this.actorId = options.actorId;
        this.tokenId = options.tokenId;
        this.sceneId = options.sceneId;
    }

    static DEFAULT_OPTIONS = {
        tag: "div",
        id: "visage-selector",
        classes: ["visage", "visage-selector-app", "borderless"],
        position: { width: "auto", height: "auto" },
        window: { frame: false, positioned: true },
        actions: {
            selectVisage: VisageSelector.prototype._onSelectVisage,
            openConfig: VisageSelector.prototype._onOpenConfig,
            revertGlobal: VisageSelector.prototype._onRevertGlobal,
            removeLayer: VisageSelector.prototype._onRemoveLayer
        }
    };

    static PARTS = {
        form: {
            template: "modules/visage/templates/visage-selector.hbs",
            scrollable: [".visage-selector-grid-wrapper"] 
        }
    };

    async _onRevertGlobal(event, target) {
        const token = canvas.tokens.get(this.tokenId);
        if (!token) return;

        const ns = Visage.DATA_NAMESPACE;
        const currentFormKey = token.actor.getFlag(ns, `${this.tokenId}.currentFormKey`) || "default";
        const currentStack = token.document.getFlag(ns, "activeStack") || [];

        // Filter stack: Keep ONLY the layer that matches the current Identity.
        const newStack = currentStack.filter(layer => layer.id === currentFormKey);

        await VisageComposer.compose(token, newStack);
    }

    async _prepareContext(options) {
        const token = canvas.tokens.get(this.tokenId);
        if (!token || !token.actor) return { forms: [] };
        
        const actor = token.actor; 
        const ns = Visage.DATA_NAMESPACE;
        const currentFormKey = actor.flags?.[ns]?.[this.tokenId]?.currentFormKey || "default";

        // --- 1. Prepare "Default" Visage ---
        const defaultRaw = VisageData.getDefaultAsVisage(token.document);
        const defaultForm = VisageData.toPresentation(defaultRaw, {
            isActive: currentFormKey === "default",
            isVideo: foundry.helpers.media.VideoHelper.hasVideoExtension(defaultRaw.changes.img || "")
        });
        // FIX: Explicitly set key for template
        defaultForm.key = "default";

        // --- 2. Process Alternate Visages ---
        const localVisages = VisageData.getLocal(actor).filter(v => !v.deleted);
        const alternateForms = localVisages.map(data => {
            const form = VisageData.toPresentation(data, {
                isActive: data.id === currentFormKey,
                isVideo: foundry.helpers.media.VideoHelper.hasVideoExtension(data.changes.img || ""),
                isWildcard: (data.changes.img || "").includes('*')
            });
            // FIX: Explicitly set key for template
            form.key = data.id;
            return form;
        });

        // --- 3. Sort and Merge ---
        alternateForms.sort((a, b) => a.label.localeCompare(b.label));
        const orderedForms = [defaultForm, ...alternateForms];

        // --- 4. Resolve Paths (Async) ---
        for (const form of orderedForms) {
            form.resolvedPath = await Visage.resolvePath(form.path);
        }

        // --- 5. PREPARE STACK DISPLAY ---
        const flags = token.document.flags[Visage.MODULE_ID] || {};
        const activeStack = flags.activeStack || flags.stack || [];
        
        // Visual Filter: Hide Identity Layer
        const visibleStack = activeStack.filter(layer => layer.id !== currentFormKey);

        const stackDisplay = visibleStack.map(layer => {
            const img = layer.changes.img || layer.changes.texture?.src || "icons/svg/aura.svg";
            return {
                id: layer.id,
                label: layer.label,
                icon: img
            };
        }).reverse();

        return { 
            forms: orderedForms,
            activeStack: stackDisplay, 
            hasGlobalOverride: stackDisplay.length > 0 
        };
    }
    
    async _onSelectVisage(event, target) {
        const formKey = target.dataset.formKey;
        if (formKey) {
            await Visage.setVisage(this.actorId, this.tokenId, formKey);
            this.close();
        }
    }

    _onOpenConfig(event, target) {
        const appId = `visage-gallery-${this.actorId}-${this.tokenId}`;
        if (Visage.apps[appId]) {
            Visage.apps[appId].bringToTop();
        } else {
            new VisageGallery({ 
                actorId: this.actorId, 
                tokenId: this.tokenId, 
                sceneId: this.sceneId, 
                id: appId 
            }).render(true);
        }
        this.close();
    }

    async _onRemoveLayer(event, target) {
        const layerId = target.dataset.layerId;
        const token = canvas.tokens.get(this.tokenId);
        if (!token) return;

        const currentStack = token.document.getFlag(Visage.MODULE_ID, "activeStack") || [];
        const newStack = currentStack.filter(layer => layer.id !== layerId);

        await VisageComposer.compose(token, newStack);
    }

    _onClickAction(event, target) {
        const action = target.dataset.action;
        if (action === "selectVisage") this._onSelectVisage(event, target);
        else if (action === "openConfig") this._onOpenConfig(event, target);
        else if (action === "revertGlobal") this._onRevertGlobal(event, target);
        else if (action === "removeLayer") this._onRemoveLayer(event, target);
    }

    _onRender(context, options) {
        const rtlLanguages = ["ar", "he", "fa", "ur"];
        if (rtlLanguages.includes(game.i18n.lang)) {
            this.element.setAttribute("dir", "rtl");
            this.element.classList.add("rtl");
        }
        this._unbindDismissListeners();
        this._bindDismissListeners();
    }

    async close(options) {
        this._unbindDismissListeners();
        return super.close(options);
    }

    _bindDismissListeners() {
        this._onDocPointerDown = (ev) => {
            const root = this.element;
            if (!root) return;
            if (root.contains(ev.target)) return;
            const hudBtn = document.querySelector('.visage-button');
            if (hudBtn && (hudBtn === ev.target || hudBtn.contains(ev.target))) return;
            
            const dirApp = ev.target.closest('.visage-gallery');
            const editorApp = ev.target.closest('.visage-editor');
            if (dirApp || editorApp) return;
            this.close();
        };
        document.addEventListener('pointerdown', this._onDocPointerDown, true);
        this._onTokenUpdate = (document, change, options, userId) => {
            if (document.id === this.tokenId) {
                this.render();
            }
        };
        Hooks.on("updateToken", this._onTokenUpdate);
    }

    _unbindDismissListeners() {
        if (this._onDocPointerDown) {
            document.removeEventListener('pointerdown', this._onDocPointerDown, true);
            this._onDocPointerDown = null;
        }
        if (this._onTokenUpdate) {
            Hooks.off("updateToken", this._onTokenUpdate);
            this._onTokenUpdate = null;
        }
    }
}