/**
 * @file Defines the VisageSelector application (The "HUD").
 * A transient, pop-up UI that allows users to quickly swap token appearances
 * or manage active mask layers directly from the canvas.
 * @module visage
 */

import { Visage } from "./visage.js";
import { VisageGallery } from "./visage-gallery.js"; 
import { VisageComposer } from "./visage-composer.js";
import { VisageData } from "./visage-data.js"; 

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The HUD application spawned by clicking the button in the Token HUD.
 * Designed to be lightweight and close automatically when focus is lost.
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
     * Removes all "Mask" layers from the stack, leaving only the base Identity.
     * This is the "Strip Disguise" feature.
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
     * * COMPLEXITY: This method must combine "Local Identity" options (faces)
     * with "Active Stack" layers (current effects) into a single UI context.
     * @override
     */
    async _prepareContext(options) {
        const token = canvas.tokens.get(this.tokenId);
        if (!token || !token.actor) return { forms: [] };
        
        const actor = token.actor; 
        const ns = Visage.DATA_NAMESPACE;
        const currentFormKey = token.document.getFlag(ns, "identity") || "default";

        // --- 1. Prepare "Default" Visage Entry ---
        // Represents the token's original, unmodified appearance.
        const defaultRaw = VisageData.getDefaultAsVisage(token.document);
        const defaultForm = VisageData.toPresentation(defaultRaw, {
            isActive: currentFormKey === "default",
            isVideo: foundry.helpers.media.VideoHelper.hasVideoExtension(defaultRaw.changes.img || "")
        });
        defaultForm.key = "default";

        // --- 2. Process Alternate Visages (Local Identity Options) ---
        const localVisages = VisageData.getLocal(actor).filter(v => !v.deleted);
        const alternateForms = localVisages.map(data => {
            const form = VisageData.toPresentation(data, {
                isActive: data.id === currentFormKey,
                isVideo: foundry.helpers.media.VideoHelper.hasVideoExtension(data.changes.img || ""),
                isWildcard: (data.changes.img || "").includes('*')
            });
            form.key = data.id;
            return form;
        });

        // --- 3. Sorting & Merging ---
        alternateForms.sort((a, b) => a.label.localeCompare(b.label));
        const orderedForms = [defaultForm, ...alternateForms];

        // --- 4. Resolve Image Paths (Async) ---
        // Resolves wildcards so the HUD shows a real image, not a random "*" path.
        for (const form of orderedForms) {
            form.resolvedPath = await Visage.resolvePath(form.path);
        }

        // --- 5. Prepare Active Stack Display ---
        // Shows active Global Masks currently layered on the token.
        const flags = token.document.flags[Visage.MODULE_ID] || {};
        const activeStack = flags.activeStack || flags.stack || [];
        
        // Visual Filter: Hide the base Identity Layer from the "Effects" list
        // so it doesn't appear twice (once as selected face, once as stack item).
        const visibleStack = activeStack.filter(layer => layer.id !== currentFormKey);

        const stackDisplay = visibleStack.map(layer => {
            const img = layer.changes.img || layer.changes.texture?.src || "icons/svg/aura.svg";
            return {
                id: layer.id,
                label: layer.label,
                icon: img
            };
        }).reverse(); // Show newest on top

        return { 
            forms: orderedForms,
            activeStack: stackDisplay, 
            hasGlobalOverride: stackDisplay.length > 0 
        };
    }
    
    /**
     * Handles clicking a Visage Tile to swap appearance.
     * @param {PointerEvent} event 
     * @param {HTMLElement} target 
     */
    async _onSelectVisage(event, target) {
        const formKey = target.dataset.formKey;
        if (formKey) {
            if (formKey === "default") {
                // If "Default" selected, remove the current Identity Layer only.
                // Do NOT call revert() as that wipes masks.
                const token = canvas.tokens.get(this.tokenId);
                const currentIdentity = token.document.getFlag(Visage.MODULE_ID, "identity");
                if (currentIdentity) await Visage.remove(this.tokenId, currentIdentity);
            } else {
                // Apply new Identity, but preserve existing masks (switchIdentity: true)
                await Visage.apply(this.tokenId, formKey, { switchIdentity: true });
            }
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

    /**
     * Binds listeners to detect clicks outside the HUD or token updates.
     * Used to auto-close the HUD if the user interacts with the canvas or selects a different token.
     * @private
     */
    _bindDismissListeners() {
        this._onDocPointerDown = (ev) => {
            const root = this.element;
            if (!root) return;
            // Ignore clicks inside the HUD itself
            if (root.contains(ev.target)) return;
            // Ignore clicks on the toggle button
            const hudBtn = document.querySelector('.visage-button');
            if (hudBtn && (hudBtn === ev.target || hudBtn.contains(ev.target))) return;
            
            // Ignore clicks on other Visage windows (Editor/Gallery)
            const dirApp = ev.target.closest('.visage-gallery');
            const editorApp = ev.target.closest('.visage-editor');
            if (dirApp || editorApp) return;
            
            this.close();
        };
        document.addEventListener('pointerdown', this._onDocPointerDown, true);
        
        // Auto-refresh HUD if the token changes while open
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