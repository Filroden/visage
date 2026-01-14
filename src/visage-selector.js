/**
 * @file Defines the VisageSelector application (The "HUD").
 * A transient, pop-up UI that allows users to quickly swap token appearances ("Identities")
 * or manage active global effects ("Mask Layers") directly from the canvas.
 * @module visage
 */

import { Visage } from "./visage.js";
import { VisageGallery } from "./visage-gallery.js"; 
import { VisageComposer } from "./visage-composer.js";
import { VisageData } from "./visage-data.js";
import { VisageUtilities } from "./visage-utilities.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The HUD application spawned by clicking the Visage button in the Token HUD.
 * Designed to be lightweight, context-aware, and transient (closes on blur).
 */
export class VisageSelector extends HandlebarsApplicationMixin(ApplicationV2) {
    
    /**
     * @param {Object} options - Application options.
     * @param {string} options.actorId - The ID of the actor owning the token.
     * @param {string} options.tokenId - The ID of the specific token being modified.
     * @param {string} options.sceneId - The ID of the scene containing the token.
     */
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

    /**
     * Action: Clear All Effects.
     * Removes all "Mask" layers from the stack, leaving only the base Identity.
     * This essentially "Strips Disguises" while keeping the current face.
     */
    async _onRevertGlobal(event, target) {
        const token = canvas.tokens.get(this.tokenId);
        if (!token) return;

        const ns = Visage.DATA_NAMESPACE;
        const currentFormKey = token.document.getFlag(ns, "identity") || "default";
        const currentStack = token.document.getFlag(ns, "activeStack") || [];

        // Filter stack: Keep ONLY the layer that matches the current Identity.
        // This removes all other cosmetic layers (e.g. Invisibility, Rage)
        const newStack = currentStack.filter(layer => layer.id === currentFormKey);

        await VisageComposer.compose(token, newStack);
    }

    /**
     * Prepares data for rendering the HUD.
     * * COMPLEXITY: This method must combine two distinct data sources:
     * 1. "Local Identities": The static list of faces this actor can assume.
     * 2. "Active Stack": The dynamic list of global effects currently applied.
     * @override
     */
    async _prepareContext(options) {
        const token = canvas.tokens.get(this.tokenId);
        if (!token || !token.actor) return { forms: [] };
        
        const actor = token.actor; 
        const ns = Visage.DATA_NAMESPACE;
        const currentFormKey = token.document.getFlag(ns, "identity") || "default";

        // --- 1. Prepare "Default" Visage Entry ---
        // Represents the token's original, unmodified appearance (fallback).
        const defaultRaw = VisageData.getDefaultAsVisage(token.document);
        const defaultForm = VisageData.toPresentation(defaultRaw, {
            isActive: currentFormKey === "default",
        });
        defaultForm.key = "default";

        // --- 2. Process Alternate Visages (Local Identity Options) ---
        const localVisages = VisageData.getLocal(actor).filter(v => !v.deleted);
        const alternateForms = localVisages.map(data => {
            // Helper handles both v1 (img) and v2 (texture.src) paths
            const rawPath = VisageData.getRepresentativeImage(data.changes);
            
            const form = VisageData.toPresentation(data, {
                isActive: data.id === currentFormKey,
                // Wildcard detection for the UI badge
                isWildcard: (rawPath || "").includes('*') 
            });
            form.key = data.id;
            return form;
        });

        // --- 3. Sorting & Merging ---
        alternateForms.sort((a, b) => a.label.localeCompare(b.label));
        const orderedForms = [defaultForm, ...alternateForms];

        // --- 4. Resolve Image Paths (Async) ---
        // Resolves wildcards so the HUD shows a real preview image, not a generic icon.
        for (const form of orderedForms) {
            form.resolvedPath = await Visage.resolvePath(form.path);
        }

        // --- 5. Prepare Active Stack Display ---
        // Shows active Global Masks currently layered on the token.
        const flags = token.document.flags[Visage.MODULE_ID] || {};
        const activeStack = flags.activeStack || flags.stack || [];
        
        // Visual Filter: Hide the base Identity Layer from the "Effects" list
        // so the user only sees "added" effects (like "Invisibility").
        const visibleStack = activeStack.filter(layer => layer.id !== currentFormKey);

        const stackDisplay = visibleStack.map(layer => {
            const img = layer.changes.img || layer.changes.texture?.src || "icons/svg/aura.svg";
            return {
                id: layer.id,
                label: layer.label,
                icon: img
            };
        }).reverse(); // Show top-most layer first

        return { 
            forms: orderedForms,
            activeStack: stackDisplay, 
            hasGlobalOverride: stackDisplay.length > 0 
        };
    }
    
    /**
     * Handles clicking a Visage Tile to swap appearance.
     * Performs an "Identity Swap" (replaces base layer) while preserving masks.
     */
    async _onSelectVisage(event, target) {
        const formKey = target.dataset.formKey;
        if (formKey) {
            if (formKey === "default") {
                // Default: Remove the custom Identity layer, falling back to prototype token.
                const token = canvas.tokens.get(this.tokenId);
                const currentIdentity = token.document.getFlag(Visage.MODULE_ID, "identity");
                if (currentIdentity) await Visage.remove(this.tokenId, currentIdentity);
            } else {
                // Apply new Identity, switchIdentity: true ensures masks stay put.
                await Visage.apply(this.tokenId, formKey, { switchIdentity: true });
            }
            this.close();
        }
    }

    _onOpenConfig(event, target) {
        const appId = `visage-gallery-${this.actorId}-${this.tokenId}`;
        // Bring to top if already open, else spawn new Gallery instance
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
        await Visage.remove(this.tokenId, layerId);
    }

    _onClickAction(event, target) {
        const action = target.dataset.action;
        if (action === "selectVisage") this._onSelectVisage(event, target);
        else if (action === "openConfig") this._onOpenConfig(event, target);
        else if (action === "revertGlobal") this._onRevertGlobal(event, target);
        else if (action === "removeLayer") this._onRemoveLayer(event, target);
    }

    _onRender(context, options) {
        VisageUtilities.applyVisageTheme(this.element, true);
        this._unbindDismissListeners();
        this._bindDismissListeners();
    }

    async close(options) {
        this._unbindDismissListeners();
        return super.close(options);
    }

    /**
     * Binds listeners to detect "Click Away" events.
     * Ensures the HUD behaves like a transient menu (closes when focus is lost).
     * @private
     */
    _bindDismissListeners() {
        this._onDocPointerDown = (ev) => {
            const root = this.element;
            if (!root) return;
            // Ignore clicks inside the HUD itself
            if (root.contains(ev.target)) return;
            // Ignore clicks on the toggle button (prevent immediate reopen)
            const hudBtn = document.querySelector('.visage-button');
            if (hudBtn && (hudBtn === ev.target || hudBtn.contains(ev.target))) return;
            
            // Ignore clicks on other Visage windows (Editor/Gallery) to allow multitasking
            const dirApp = ev.target.closest('.visage-gallery');
            const editorApp = ev.target.closest('.visage-editor');
            if (dirApp || editorApp) return;
            
            this.close();
        };
        document.addEventListener('pointerdown', this._onDocPointerDown, true);
        
        // Auto-refresh HUD if the token changes while open (e.g. GM applies effect)
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