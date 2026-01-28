/* visage-selector.js */
import { Visage } from "./visage.js";
import { VisageGallery } from "./visage-gallery.js"; 
import { VisageComposer } from "./visage-composer.js";
import { VisageData } from "./visage-data.js";
import { VisageUtilities } from "./visage-utilities.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The transient "HUD" application for quick Visage selection.
 * Designed to appear next to the token, allow a quick selection, and then disappear.
 * Handles auto-dismissal when clicking outside the window.
 */
export class VisageSelector extends HandlebarsApplicationMixin(ApplicationV2) {
    
    /**
     * @param {Object} options - Application options.
     * @param {string} options.actorId - The ID of the target actor.
     * @param {string} options.tokenId - The ID of the target token.
     * @param {string} [options.sceneId] - The ID of the scene (if unlinked).
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
     * Removes all active effects *except* the base identity.
     */
    async _onRevertGlobal(event, target) {
        const token = canvas.tokens.get(this.tokenId);
        if (!token) return;

        const ns = Visage.DATA_NAMESPACE;
        const currentFormKey = token.document.getFlag(ns, "identity") || "default";
        const currentStack = token.document.getFlag(ns, "activeStack") || [];

        const newStack = currentStack.filter(layer => layer.id === currentFormKey);
        await VisageComposer.compose(token, newStack);
    }

    /**
     * Prepares the data context for the HUD.
     * Fetches only *Local* Visages (Actor-specific) and splits them into Identities vs Overlays.
     */
    async _prepareContext(options) {
        const token = canvas.tokens.get(this.tokenId);
        if (!token || !token.actor) return { identities: [], overlays: [] };
        
        const actor = token.actor; 
        const ns = Visage.DATA_NAMESPACE;
        const currentFormKey = token.document.getFlag(ns, "identity") || "default";

        // 1. Prepare Default Identity
        const defaultRaw = VisageData.getDefaultAsVisage(token.document);
        const defaultForm = VisageData.toPresentation(defaultRaw, {
            isActive: currentFormKey === "default",
        });
        defaultForm.key = "default";
        defaultForm.resolvedPath = await Visage.resolvePath(defaultForm.path);

        // 2. Fetch LOCAL items ONLY
        const localItems = VisageData.getLocal(actor).filter(v => !v.deleted);
        
        // 3. Process & Split by Mode
        const identities = [defaultForm];
        const overlays = [];

        for (const item of localItems) {
            const rawPath = VisageData.getRepresentativeImage(item.changes);
            const form = VisageData.toPresentation(item, {
                isActive: item.id === currentFormKey,
                isWildcard: (rawPath || "").includes('*') 
            });
            form.key = item.id;
            form.resolvedPath = await Visage.resolvePath(form.path);

            // --- Phase 3: Tooltip Injection ---
            let tooltipContent = [];
            const existingTooltip = form.meta.effectsTooltip || "";
            
            // A. Light Source
            if (form.meta.hasLight) {
                const light = form.changes.light || {};
                const dim = light.dim || 0;
                const bright = light.bright || 0;
                const label = game.i18n.localize("VISAGE.Light.Title");
                tooltipContent.push(`
                    <div class='visage-tooltip-row'>
                        <i class='visage-icon wand-stars'></i> 
                        <span class='label'>${label}</span>
                        <span class='meta'>${dim} / ${bright}</span>
                    </div>`);
            }

            // B. Existing Effects
            if (existingTooltip) {
                const inner = existingTooltip.replace("<div class='visage-tooltip-content'>", "").replace("</div>", "");
                tooltipContent.push(inner);
            }

            // C. Transition Delay
            if (form.meta.hasDelay) {
                const ms = form.delay || 0;
                const sec = Math.abs(ms) / 1000;
                const label = game.i18n.localize("VISAGE.Transition.Delay");
                const dir = ms >= 0 ? game.i18n.localize("VISAGE.Transition.EffectsLead") : "Token Lead";
                tooltipContent.push(`
                    <div class='visage-tooltip-row'>
                        <i class='visage-icon repeat'></i> 
                        <span class='label'>${label}</span>
                        <span class='meta'>${sec}s (${dir})</span>
                    </div>`);
            }

            // Apply Updates
            if (tooltipContent.length > 0) {
                form.meta.effectsTooltip = `<div class='visage-tooltip-content'>${tooltipContent.join("")}</div>`;
                form.meta.hasEffects = true;
            }

            Object.assign(form, form.meta); // Flatten meta for HUD template

            if (item.mode === "identity") identities.push(form);
            else overlays.push(form);
        }

        identities.sort((a, b) => {
            if (a.key === "default") return -1;
            if (b.key === "default") return 1;
            return a.label.localeCompare(b.label);
        });
        overlays.sort((a, b) => a.label.localeCompare(b.label));

        // 4. Prepare Active Stack Display
        const flags = token.document.flags[Visage.MODULE_ID] || {};
        const activeStack = flags.activeStack || flags.stack || [];
        const visibleStack = activeStack.filter(layer => layer.id !== currentFormKey);

        const stackDisplay = visibleStack.map(layer => {
            const img = layer.changes.img || layer.changes.texture?.src || "icons/svg/aura.svg";
            const themeClass = (layer.source === "local") ? "visage-theme-local" : "visage-theme-global";
            return {
                id: layer.id,
                label: layer.label,
                icon: img,
                themeClass: themeClass
            };
        }).reverse();

        return { 
            identities: identities,
            overlays: overlays,
            activeStack: stackDisplay
        };
    }
    
    async _onSelectVisage(event, target) {
        const formKey = target.dataset.formKey;
        if (formKey) {
            if (formKey === "default") {
                const token = canvas.tokens.get(this.tokenId);
                const currentIdentity = token.document.getFlag(Visage.MODULE_ID, "identity");
                if (currentIdentity) await Visage.remove(this.tokenId, currentIdentity);
            } else {
                await Visage.apply(this.tokenId, formKey);
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
        VisageUtilities.applyVisageTheme(this.element, true);
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