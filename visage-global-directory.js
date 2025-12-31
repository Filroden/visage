/**
 * @file The main browser window for the Global Visage Library.
 * @module visage
 */

import { Visage } from "./visage.js";
import { VisageGlobalData } from "./visage-global-data.js";
import { VisageGlobalEditor } from "./visage-global-editor.js";
import { VisageComposer } from "./visage-composer.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class VisageGlobalDirectory extends HandlebarsApplicationMixin(ApplicationV2) {
    
    constructor(options = {}) {
        super(options);
        this.filters = {
            search: "",
            category: null,
            tags: new Set(),
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
            height: 680
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
            clearSearch: VisageGlobalDirectory.prototype._onClearSearch,
            toggleTag: VisageGlobalDirectory.prototype._onToggleTag,
            clearTags: VisageGlobalDirectory.prototype._onClearTags
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
        
        // --- 1. ANALYZE DATA (Categories & Tags) ---
        const categories = new Set();
        const tagCounts = {}; // { "Boss": 12, "Undead": 4 }

        VisageGlobalData.all.forEach(v => {
            if (v.category) categories.add(v.category);
            if (v.tags && Array.isArray(v.tags)) {
                v.tags.forEach(t => {
                    tagCounts[t] = (tagCounts[t] || 0) + 1;
                });
            }
        });

        // --- 2. PREPARE TAG LISTS ---
        // A. Active Filters (The ones currently filtering the view)
        const activeTags = Array.from(this.filters.tags).sort().map(t => ({
            label: t,
            active: true
        }));

        // B. Popular Suggestions (Top 10, excluding ones already active)
        const popularTags = Object.entries(tagCounts)
            .sort((a, b) => b[1] - a[1]) // Sort by frequency desc
            .slice(0, 10) // Take Top 10
            .map(([tag, count]) => ({ label: tag, count }))
            .filter(t => !this.filters.tags.has(t.label)) // Remove if already active
            .map(t => ({
                label: t.label,
                active: false,
                count: t.count
            }));

        const categoryList = Array.from(categories).sort().map(c => ({
            label: c,
            active: this.filters.category === c
        }));

        // --- 3. FILTER ITEMS ---
        let items = source.filter(entry => {
            // Category Filter
            if (this.filters.category && entry.category !== this.filters.category) return false;
            
            // Text Search
            if (this.filters.search) {
                const term = this.filters.search.toLowerCase();
                const matchesSearch = (
                    entry.label.toLowerCase().includes(term) ||
                    (entry.tags && entry.tags.some(t => t.toLowerCase().includes(term)))
                );
                if (!matchesSearch) return false;
            }

            // Tag Filter (AND Logic: Must have ALL active tags)
            if (this.filters.tags.size > 0) {
                const entryTags = entry.tags || [];
                const hasAllTags = Array.from(this.filters.tags).every(t => entryTags.includes(t));
                if (!hasAllTags) return false;
            }

            return true;
        });

        items.sort((a, b) => a.label.localeCompare(b.label));

        // Use Promise.all for Async Wildcard Resolution
        const preparedItems = await Promise.all(items.map(async (entry) => {
            const c = entry.changes;
            const resolvedImg = await Visage.resolvePath(c.img);
            const ringCtx = Visage.prepareRingContext(c.ring);
            
            // Scale/Dim/Flip logic (same as before)
            const scaleVal = (c.scale !== null) ? Math.round(c.scale * 100) : 100;
            const scaleActive = (c.scale !== null && c.scale !== 1);
            let dimLabel = "-";
            let dimActive = false;
            if (c.width || c.height) {
                dimLabel = `${c.width || "-"} x ${c.height || "-"}`;
                dimActive = true;
            }
            let flipIcon = "fas fa-arrows-alt-h"; 
            let flipLabel = "-";
            let flipActive = false;
            if (c.isFlippedX !== null || c.isFlippedY !== null) {
                flipActive = true;
                if (c.isFlippedX !== null && c.isFlippedY === null) flipIcon = c.isFlippedX ? "fas fa-arrow-left" : "fas fa-arrow-right";
                else if (c.isFlippedY !== null && c.isFlippedX === null) flipIcon = c.isFlippedY ? "fas fa-arrow-down" : "fas fa-arrow-up";
                else flipIcon = "fas fa-expand-arrows-alt";
            }
            
            // Disposition
            let dispClass = "none";
            let dispLabel = game.i18n.localize("VISAGE.Disposition.NoChange");
            if (c.disposition !== null) {
                switch (c.disposition) {
                    case 1: dispClass = "friendly"; dispLabel = game.i18n.localize("VISAGE.Disposition.Friendly"); break;
                    case 0: dispClass = "neutral"; dispLabel = game.i18n.localize("VISAGE.Disposition.Neutral"); break;
                    case -1: dispClass = "hostile"; dispLabel = game.i18n.localize("VISAGE.Disposition.Hostile"); break;
                    case -2: dispClass = "secret"; dispLabel = game.i18n.localize("VISAGE.Disposition.Secret"); break;
                }
            }

            // Map item tags for the card footer (highlight active ones)
            const itemTags = (entry.tags || []).map(t => ({
                label: t,
                active: this.filters.tags.has(t)
            }));

            return {
                ...entry,
                changes: { ...entry.changes, img: resolvedImg },
                meta: {
                    hasRing: ringCtx.enabled,
                    hasPulse: ringCtx.hasPulse,
                    hasGradient: ringCtx.hasGradient,
                    hasWave: ringCtx.hasWave,
                    hasInvisibility: ringCtx.hasInvisibility,
                    ringColor: ringCtx.colors.ring,
                    ringBkg: ringCtx.colors.background,
                    forceFlipX: c.isFlippedX === true,
                    forceFlipY: c.isFlippedY === true,
                    itemTags: itemTags,
                    slots: {
                        scale: { active: scaleActive, val: `${scaleVal}%` },
                        dim: { active: dimActive, val: dimLabel },
                        flip: { active: flipActive, icon: flipIcon, val: flipLabel },
                        disposition: { class: dispClass, val: dispLabel }
                    }
                }
            };
        }));

        return {
            items: preparedItems,
            categories: categoryList,
            filters: this.filters,
            // Pass the two lists to the template
            activeTags: activeTags,
            popularTags: popularTags,
            hasFilterBar: activeTags.length > 0 || popularTags.length > 0,
            isBin: this.filters.showBin
        };
    }

    _onToggleTag(event, target) {
        const tag = target.dataset.tag;
        if (this.filters.tags.has(tag)) {
            this.filters.tags.delete(tag);
        } else {
            this.filters.tags.add(tag);
        }
        this.render();
    }

    _onClearTags(event, target) {
        this.filters.tags.clear();
        this.render();
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

    /**
     * Handle the start of a drag workflow.
     * Attaches the Global Visage ID and Type to the drag event.
     */
    _onDragStart(event) {
        const card = event.target.closest(".visage-card");
        if (!card) return;
        
        // Create the standard Drag Data object
        const dragData = {
            type: "Visage", // Unique type identifier for our module
            id: card.dataset.id
        };
        
        // Attach to the event
        event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
    }

    async _onCreate() { new VisageGlobalEditor().render(true); }

    async _onEdit(event, target) {
        const id = target.closest(".visage-card").dataset.id;
        new VisageGlobalEditor({ visageId: id }).render(true);
    }

    /**
     * Action: Move to Recycle Bin (Soft Delete)
     */
    async _onDelete(event, target) {
        const card = target.closest(".visage-card");
        if (!card) return;
        const id = card.dataset.id;
        
        await VisageGlobalData.delete(id); // Performs the soft delete
        this.render(); // <--- ADD THIS: Force the UI to update immediately
    }

    /**
     * Action: Restore from Recycle Bin
     */
    async _onRestore(event, target) {
        const card = target.closest(".visage-card");
        if (!card) return;
        const id = card.dataset.id;
        
        await VisageGlobalData.restore(id);
        this.render(); // <--- ADD THIS
    }

    /**
     * Action: Permanently Destroy (Hard Delete)
     */
    async _onDestroy(event, target) {
        const card = target.closest(".visage-card");
        if (!card) return;
        const id = card.dataset.id;

        const confirm = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize("VISAGE.Dialog.Destroy.Title") },
            content: game.i18n.localize("VISAGE.Dialog.Destroy.Content"),
            modal: true
        });

        if (confirm) {
            await VisageGlobalData.destroy(id);
            this.render(); // <--- ADD THIS
        }
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

    /**
     * Action: Apply Visage to Selected Tokens
     */
    async _onApply(event, target) {
        // 1. Get currently selected tokens (Placeables)
        const tokens = canvas.tokens.controlled.filter(t => t.document.isOwner);
        
        if (tokens.length === 0) {
            return ui.notifications.warn("VISAGE.Notifications.NoTokens", { localize: true });
        }
        
        // 2. Get the Visage Data
        const card = target.closest(".visage-card");
        const visageId = card.dataset.id;
        const visageData = VisageGlobalData.get(visageId);
        
        if (!visageData) return;

        // 3. Apply to tokens (Pass the Placeable, NOT the Document)
        for (const token of tokens) {
            // CHANGED: Removed .document
            await Visage.applyGlobalVisage(token, visageData);
        }
    }
}