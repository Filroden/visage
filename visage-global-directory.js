/**
 * @file The main browser window for the Global Visage Library.
 * @module visage
 */

import { Visage } from "./visage.js";
import { VisageGlobalData } from "./visage-global-data.js";
import { VisageGlobalEditor } from "./visage-global-editor.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class VisageGlobalDirectory extends HandlebarsApplicationMixin(ApplicationV2) {
    
    constructor(options = {}) {
        super(options);
        this.filters = {
            search: "",
            category: null, 
            showBin: false
        };
        
        this._onDataChanged = () => this.render();
        Hooks.on("visageGlobalDataChanged", this._onDataChanged);
    }

    async close(options) {
        Hooks.off("visageGlobalDataChanged", this._onDataChanged);
        return super.close(options);
    }

    static DEFAULT_OPTIONS = {
        tag: "div",
        id: "visage-global-directory",
        classes: ["visage", "visage-global-directory", "visage-dark-theme"],
        window: {
            title: "VISAGE.Directory.Title",
            icon: "visage-icon-mask",
            resizable: true,
        },
        position: {
            width: 1180,
            height: 660
        },
        actions: {
            create: VisageGlobalDirectory.prototype._onCreate,
            edit: VisageGlobalDirectory.prototype._onEdit,
            delete: VisageGlobalDirectory.prototype._onDelete,
            restore: VisageGlobalDirectory.prototype._onRestore,
            destroy: VisageGlobalDirectory.prototype._onDestroy,
            apply: VisageGlobalDirectory.prototype._onApply,
            selectCategory: VisageGlobalDirectory.prototype._onSelectCategory,
            toggleBin: VisageGlobalDirectory.prototype._onToggleBin,
            clearSearch: VisageGlobalDirectory.prototype._onClearSearch
        }
    };

    static PARTS = {
        directory: {
            template: "modules/visage/templates/visage-global-directory.hbs",
            scrollable: [".visage-browser-grid", ".visage-sidebar"]
        }
    };

    /** @override */
    async _prepareContext(options) {
        const source = this.filters.showBin ? VisageGlobalData.bin : VisageGlobalData.all;
        
        const allActive = VisageGlobalData.all;
        const categories = new Set();
        allActive.forEach(v => {
            if (v.category) categories.add(v.category);
        });
        const categoryList = Array.from(categories).sort().map(c => ({
            label: c,
            active: this.filters.category === c
        }));

        let items = source.filter(entry => {
            if (this.filters.category && entry.category !== this.filters.category) return false;
            if (this.filters.search) {
                const term = this.filters.search.toLowerCase();
                return (
                    entry.label.toLowerCase().includes(term) ||
                    (entry.tags && entry.tags.some(t => t.toLowerCase().includes(term)))
                );
            }
            return true;
        });

        items.sort((a, b) => a.label.localeCompare(b.label));

        items = items.map(entry => {
            const c = entry.changes;

            // SLOT 1: SCALE
            const scaleVal = (c.scale !== null) ? Math.round(c.scale * 100) : 100;
            const scaleActive = (c.scale !== null && c.scale !== 1);

            // SLOT 2: DIMENSIONS
            let dimLabel = "-";
            let dimActive = false;
            if (c.width || c.height) {
                dimLabel = `${c.width || "-"} x ${c.height || "-"}`;
                dimActive = true;
            }

            // SLOT 3: MIRRORING
            let flipIcon = "fas fa-arrows-alt-h"; 
            let flipLabel = "-";
            let flipActive = false;

            if (c.isFlippedX !== null || c.isFlippedY !== null) {
                flipActive = true;
                
                if (c.isFlippedX !== null && c.isFlippedY === null) {
                    flipIcon = c.isFlippedX ? "fas fa-arrow-left" : "fas fa-arrow-right";
                    flipLabel = c.isFlippedX ? game.i18n.localize("VISAGE.Mirror.Horizontal.Label") : game.i18n.localize("VISAGE.Mirror.Label.Standard");
                } else if (c.isFlippedY !== null && c.isFlippedX === null) {
                    flipIcon = c.isFlippedY ? "fas fa-arrow-down" : "fas fa-arrow-up";
                    flipLabel = c.isFlippedY ? game.i18n.localize("VISAGE.Mirror.Vertical.Label") : game.i18n.localize("VISAGE.Mirror.Label.Standard");
                } else {
                    flipIcon = "fas fa-expand-arrows-alt";
                    const hState = c.isFlippedX ? "H" : "";
                    const vState = c.isFlippedY ? "V" : "";
                    
                    if (hState && vState) flipLabel = game.i18n.localize("VISAGE.Mirror.Label.Combined");
                    else if (hState) flipLabel = game.i18n.localize("VISAGE.Mirror.Horizontal.Label");
                    else if (vState) flipLabel = game.i18n.localize("VISAGE.Mirror.Vertical.Label");
                    else flipLabel = game.i18n.localize("VISAGE.Mirror.Label.Standard");
                }
            }

            // SLOT 4: DISPOSITION
            let dispositionClass = "none";
            let dispositionLabel = game.i18n.localize("VISAGE.Disposition.NoChange");
            if (c.disposition !== null) {
                switch (c.disposition) {
                    case 1: dispositionClass = "friendly"; dispositionLabel = game.i18n.localize("VISAGE.Disposition.Friendly"); break;
                    case 0: dispositionClass = "neutral"; dispositionLabel = game.i18n.localize("VISAGE.Disposition.Neutral"); break;
                    case -1: dispositionClass = "hostile"; dispositionLabel = game.i18n.localize("VISAGE.Disposition.Hostile"); break;
                    case -2: dispositionClass = "secret"; dispositionLabel = game.i18n.localize("VISAGE.Disposition.Secret"); break;
                }
            }

            const ring = c.ring || {};
            const hasRing = !!c.ring;
            const hasPulse = hasRing && (ring.effects & 2); 
            const hasGradient = hasRing && (ring.effects & 4);
            const hasWave = hasRing && (ring.effects & 8);
            const hasInvisibility = hasRing && (ring.effects & 16);

            const forceFlipX = c.isFlippedX === true; 
            const forceFlipY = c.isFlippedY === true;

            return {
                ...entry,
                meta: {
                    hasRing,
                    hasPulse,
                    hasGradient,
                    hasWave,
                    hasInvisibility,
                    ringColor: ring.colors?.ring,
                    ringBkg: ring.colors?.background,
                    forceFlipX,
                    forceFlipY,
                    tokenName: c.name || null,

                    slots: {
                        scale: { active: scaleActive, val: `${scaleVal}%` },
                        dim: { active: dimActive, val: dimLabel },
                        flip: { active: flipActive, icon: flipIcon, val: flipLabel },
                        disposition: { class: dispositionClass, val: dispositionLabel }
                    }
                }
            };
        });

        return {
            items: items,
            categories: categoryList,
            filters: this.filters,
            isBin: this.filters.showBin
        };
    }

    _onRender(context, options) {
        const searchInput = this.element.querySelector(".search-bar input");
        if (searchInput) {
            if (this.filters.search && document.activeElement !== searchInput) {
                // Focus restored implicitly by browser if re-render is fast enough, or manual handling below
            }

            searchInput.addEventListener("input", (e) => {
                this.filters.search = e.target.value;
                
                if (this._searchDebounce) clearTimeout(this._searchDebounce);
                
                this._searchDebounce = setTimeout(() => {
                    this.render();
                    setTimeout(() => {
                        const input = this.element.querySelector(".search-bar input");
                        if(input) {
                            input.focus();
                            const val = input.value;
                            input.value = "";
                            input.value = val;
                        }
                    }, 50);
                }, 300);
            });
        }

        const cards = this.element.querySelectorAll(".visage-card");
        cards.forEach(card => {
            card.addEventListener("dragstart", this._onDragStart.bind(this));
        });
    }

    _onDragStart(event) {
        const id = event.currentTarget.dataset.id;
        const visage = VisageGlobalData.get(id);
        if (!visage) return;
        const dragData = {
            type: "Visage",
            payload: visage, 
            id: id
        };
        event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
    }

    async _onCreate() { new VisageGlobalEditor().render(true); }
    async _onEdit(event, target) {
        const id = target.closest(".visage-card").dataset.id;
        new VisageGlobalEditor({ visageId: id }).render(true);
    }
    async _onDelete(event, target) {
        const id = target.closest(".visage-card").dataset.id;
        await VisageGlobalData.delete(id);
    }
    async _onRestore(event, target) {
        const id = target.closest(".visage-card").dataset.id;
        await VisageGlobalData.restore(id);
    }
    async _onDestroy(event, target) {
        const id = target.closest(".visage-card").dataset.id;
        const confirm = await Dialog.confirm({
            title: game.i18n.localize("VISAGE.Dialog.Destroy.Title"),
            content: game.i18n.localize("VISAGE.Dialog.Destroy.Content")
        });
        if (confirm) await VisageGlobalData.destroy(id);
    }
    _onSelectCategory(event, target) {
        const cat = target.dataset.category;
        this.filters.category = (this.filters.category === cat) ? null : cat;
        this.render();
    }
    _onToggleBin(event, target) {
        const mode = target.dataset.mode;
        const requestingBin = mode === "bin";
        if (this.filters.showBin === requestingBin) return;
        this.filters.showBin = requestingBin;
        this.filters.category = null; 
        this.render();
    }
    _onClearSearch() {
        this.filters.search = "";
        this.render();
    }
    async _onApply(event, target) {
        const id = target.closest(".visage-card").dataset.id;
        const visage = VisageGlobalData.get(id);
        if (!visage) return;
        
        const tokens = canvas.tokens.controlled;
        if (!tokens.length) { 
            ui.notifications.warn(game.i18n.localize("VISAGE.Notifications.NoTokens")); 
            return; 
        }

        const updates = tokens.map(t => this._calculateTokenUpdate(t, visage.changes, visage.label)).filter(u => u);
        
        if (updates.length) {
            await canvas.scene.updateEmbeddedDocuments("Token", updates);
            ui.notifications.info(game.i18n.format("VISAGE.Notifications.Applied", { label: visage.label, count: updates.length }));
        }
    }
    
    // Snapshot Logic (Saves state, doesn't revert)
    _calculateTokenUpdate(token, changes, label) {
        const update = { _id: token.id };
        const c = changes;
        
        // 1. SNAPSHOT LOGIC
        const currentFlags = token.document.flags?.visage || {};
        const isAlreadyOverridden = !!currentFlags.activeVisage;
        
        if (!isAlreadyOverridden) {
            let ringData = undefined;
            if (token.document.ring) {
                ringData = (typeof token.document.ring.toObject === "function") 
                    ? token.document.ring.toObject() 
                    : token.document.ring;
            }

            const originalState = {
                name: token.document.name,
                disposition: token.document.disposition,
                "texture.src": token.document.texture.src,
                "texture.scaleX": token.document.texture.scaleX,
                "texture.scaleY": token.document.texture.scaleY,
                width: token.document.width,
                height: token.document.height,
                ring: ringData
            };
            
            Object.keys(originalState).forEach(key => originalState[key] === undefined && delete originalState[key]);
            update["flags.visage.originalState"] = originalState;
        }

        // 2. APPLY OVERRIDES
        if (c.name) update.name = c.name;
        if (c.disposition !== null) update.disposition = c.disposition;
        
        const textureUpdate = {};
        if (c.img) textureUpdate.src = c.img;

        const currentScaleX = token.document.texture.scaleX;
        const currentScaleY = token.document.texture.scaleY;
        const currentAbsScale = Math.abs(currentScaleX);
        
        const newAbsScale = (c.scale !== null) ? c.scale : currentAbsScale;

        let newIsFlippedX = currentScaleX < 0; 
        if (c.isFlippedX === true) newIsFlippedX = true;
        if (c.isFlippedX === false) newIsFlippedX = false;
        
        let newIsFlippedY = currentScaleY < 0; 
        if (c.isFlippedY === true) newIsFlippedY = true;
        if (c.isFlippedY === false) newIsFlippedY = false;

        textureUpdate.scaleX = newAbsScale * (newIsFlippedX ? -1 : 1);
        textureUpdate.scaleY = newAbsScale * (newIsFlippedY ? -1 : 1);

        if (Object.keys(textureUpdate).length > 0) update.texture = textureUpdate;
        if (c.width) update.width = c.width;
        if (c.height) update.height = c.height;
        if (c.ring) update.ring = c.ring;

        // 3. FLAG AS ACTIVE
        update["flags.visage.activeVisage"] = { 
            id: "global", 
            source: "global",
            label: label || "Global Visage" 
        };

        return update;
    }
}