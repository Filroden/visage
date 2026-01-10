/**
 * @file The main browser window for the Visage Library/Gallery.
 * Displays available visages in a grid, handles filtering, searching, and application logic.
 * @module visage
 */

import { Visage } from "./visage.js";
import { VisageData } from "./visage-data.js"; 
import { VisageEditor } from "./visage-editor.js";
import { VisageUtilities } from "./visage-utilities.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The main UI for browsing and managing Visage data.
 * Can operate in two modes:
 * 1. **Local Mode (Gallery):** Manages Visages stored on a specific Actor.
 * 2. **Global Mode (Library):** Manages World-level Masks stored in settings.
 */
export class VisageGallery extends HandlebarsApplicationMixin(ApplicationV2) {
    
    /**
     * @param {Object} options - Application options.
     * @param {string|null} [options.actorId] - The ID of the actor (Local Mode).
     * @param {string|null} [options.tokenId] - The ID of the token (Local Mode context).
     * @param {string|null} [options.sceneId] - The ID of the scene (Local Mode context).
     */
    constructor(options = {}) {
        super(options);
        
        this.actorId = options.actorId || null;
        this.tokenId = options.tokenId || null;
        this.sceneId = options.sceneId || null;
        
        // Dynamic Icon: Mask for Local (Identity), Domino for Global (Cosmetic)
        if (!this.isLocal) {
            this.options.window.icon = "visage-icon-domino";
        } else {
            this.options.window.icon = "visage-icon-mask";
        }
        
        this.filters = {
            search: "",
            category: null,
            tags: new Set(),
            showBin: false
        };
        
        // Debounced render listener for live data updates
        this._onDataChanged = () => this.render();
        
        // Listener for Actor updates (Linked Tokens / Prototype Token)
        this._onActorUpdate = (doc) => {
            if (doc.id === this.actorId) this.render();
        };

        // Listener for Token updates (Unlinked Tokens / Specific Instance Changes)
        this._onTokenUpdate = (doc, changes, options, userId) => {
            if (this.tokenId && doc.id === this.tokenId) this.render();
        };

        if (this.isLocal) {
            Hooks.on("updateActor", this._onActorUpdate);
            Hooks.on("updateToken", this._onTokenUpdate);
        } else {
            Hooks.on("visageDataChanged", this._onDataChanged);
        }
    }

    /**
     * True if this instance is managing a specific Actor's Visages.
     * @type {boolean}
     */
    get isLocal() { return !!this.actorId; }

    /**
     * Retrieves the target Actor document.
     * Resolves synthetic token actors if necessary.
     * @type {Actor|null}
     */
    get actor() {
        return VisageUtilities.resolveTarget(this.options).actor;
    }

    /** @override */
    async close(options) {
        if (this.isLocal) {
            Hooks.off("updateActor", this._onActorUpdate);
            Hooks.off("updateToken", this._onTokenUpdate); // <-- Added Cleanup
        } else {
            Hooks.off("visageDataChanged", this._onDataChanged);
        }
        return super.close(options);
    }

    static DEFAULT_OPTIONS = {
        tag: "div",
        id: "visage-gallery", 
        classes: ["visage", "visage-gallery", "visage-dark-theme"],
        window: {
            title: "VISAGE.Directory.Title.Global", 
            icon: "visage-icon-mask",
            resizable: true,
        },
        position: { width: 1250, height: 700 },
        actions: {
            create: VisageGallery.prototype._onCreate,
            edit: VisageGallery.prototype._onEdit,
            delete: VisageGallery.prototype._onDelete,
            restore: VisageGallery.prototype._onRestore,
            destroy: VisageGallery.prototype._onDestroy,
            apply: VisageGallery.prototype._onApply,
            selectCategory: VisageGallery.prototype._onSelectCategory,
            toggleBin: VisageGallery.prototype._onToggleBin,
            clearSearch: VisageGallery.prototype._onClearSearch,
            toggleTag: VisageGallery.prototype._onToggleTag,
            clearTags: VisageGallery.prototype._onClearTags,
            swapDefault: VisageGallery.prototype._onSwapDefault
        }
    };

    static PARTS = {
        directory: {
            template: "modules/visage/templates/visage-gallery.hbs", 
            scrollable: [".visage-browser-grid", ".visage-sidebar"]
        }
    };

    /** @override */
    get title() {
        if (this.isLocal && this.actor) {
            return game.i18n.format("VISAGE.Directory.Title.Local", { actor: this.actor.name });
        }
        return game.i18n.localize("VISAGE.Directory.Title.Global");
    }

    /**
     * Prepares the data context for rendering the gallery.
     * Aggregates data, handles filtering, and generates UI-ready presentation objects.
     * @override
     */
    async _prepareContext(options) {
        let rawItems = [];
        if (this.isLocal) {
            if (!this.actor) return { items: [] };
            rawItems = VisageData.getLocal(this.actor);
        } else {
            // Global Mode: Toggle between Active items and the Recycle Bin
            rawItems = this.filters.showBin ? VisageData.bin : VisageData.globals;
        }

        // Apply deleted filter for Local items (Local doesn't currently support a Bin UI, but data supports soft-delete)
        let source = rawItems;
        if (this.isLocal) {
            source = rawItems.filter(v => this.filters.showBin ? v.deleted : !v.deleted);
        }
        
        // --- 1. Virtual "Default" Entry (Local Only) ---
        // In Local Mode, we inject a virtual card representing the token's original appearance.
        if (this.isLocal && !this.filters.showBin && this.actor) {
             let defaultRaw;
             
             if (this.tokenId) {
                 const token = canvas.tokens.get(this.tokenId);
                 if (token) defaultRaw = VisageData.getDefaultAsVisage(token.document);
             } 
             
             // Fallback to prototype token if canvas token is unavailable
             if (!defaultRaw) {
                const proto = this.actor.prototypeToken;
                defaultRaw = { 
                    id: "default",
                    label: game.i18n.localize("VISAGE.Selector.Default"),
                    category: "",
                    tags: [],
                    isDefault: true,
                    changes: {
                        name: proto.name,
                        img: proto.texture.src,
                        texture: { 
                            scaleX: proto.texture.scaleX ?? 1.0, 
                            scaleY: proto.texture.scaleY ?? 1.0 
                        },
                        disposition: proto.disposition,
                        ring: proto.ring,
                        width: proto.width,
                        height: proto.height
                    }
                };
             }
             
             if (defaultRaw) source.unshift(defaultRaw);
        }

        // --- 2. Aggregate Categories & Tags ---
        const categories = new Set();
        const tagCounts = {}; 
        source.forEach(v => {
            if (v.category) categories.add(v.category);
            if (v.tags && Array.isArray(v.tags)) {
                v.tags.forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
            }
        });

        const activeTags = Array.from(this.filters.tags).sort().map(t => ({ label: t, active: true }));
        
        // Calculate popular tags for the sidebar
        const popularTags = Object.entries(tagCounts)
            .sort((a, b) => b[1] - a[1]) // Sort by frequency
            .slice(0, 10)
            .map(([tag, count]) => ({ label: tag, count }))
            .filter(t => !this.filters.tags.has(t.label)) 
            .map(t => ({ label: t.label, active: false, count: t.count }));
            
        const categoryList = Array.from(categories).sort().map(c => ({
            label: c,
            active: this.filters.category === c
        }));

        // --- 3. Filter Items ---
        let items = source.filter(entry => {
            if (this.filters.category && entry.category !== this.filters.category) return false;
            if (this.filters.search) {
                const term = this.filters.search.toLowerCase();
                // Search in Label OR Tags
                if (!(entry.label.toLowerCase().includes(term) || (entry.tags && entry.tags.some(t => t.toLowerCase().includes(term))))) return false;
            }
            if (this.filters.tags.size > 0) {
                const entryTags = entry.tags || [];
                // Must match ALL selected tags
                if (!Array.from(this.filters.tags).every(t => entryTags.includes(t))) return false;
            }
            return true;
        });

        // Ensure "Default" is always first, then alphabetical
        items.sort((a, b) => {
            if (a.id === "default") return -1;
            if (b.id === "default") return 1;
            return a.label.localeCompare(b.label);
        });

        // --- 4. Generate Presentation Data ---
        // Uses VisageData.toPresentation to normalize UI logic (badges, labels, icons)
        const preparedItems = await Promise.all(items.map(async (entry) => {
            const rawPath = VisageData.getRepresentativeImage(entry.changes);
            const resolvedPath = await Visage.resolvePath(rawPath);
            const context = VisageData.toPresentation(entry, {
                isWildcard: (rawPath || "").includes('*'),
                isActive: false 
            });

            context.meta.itemTags = (entry.tags || []).map(t => ({
                label: t,
                active: this.filters.tags.has(t)
            }));

            context.changes.img = resolvedPath;
            return context;
        }));

        const emptyMsg = this.isLocal 
            ? game.i18n.localize("VISAGE.Directory.Empty.Local")
            : game.i18n.localize("VISAGE.Directory.Empty.Global");

        const modeLabel = this.isLocal 
            ? game.i18n.localize("VISAGE.Directory.Mode.Gallery") 
            : game.i18n.localize("VISAGE.Directory.Mode.Library");

        return {
            isLocal: this.isLocal,
            items: preparedItems,
            categories: categoryList,
            filters: this.filters,
            activeTags: activeTags,
            popularTags: popularTags,
            hasFilterBar: activeTags.length > 0 || popularTags.length > 0,
            isBin: this.filters.showBin,
            emptyMessage: emptyMsg,
            modeLabel: modeLabel
        };
    }
    
    _onToggleTag(event, target) {
        const tag = target.dataset.tag;
        if (this.filters.tags.has(tag)) this.filters.tags.delete(tag);
        else this.filters.tags.add(tag);
        this.render();
    }

    _onClearTags(event, target) {
        this.filters.tags.clear();
        this.render();
    }

    _onRender(context, options) {
        // Handle RTL Support
        VisageUtilities.applyVisageTheme(this.element, this.isLocal);

        // Setup live listener for data changes
        if (!this._dataListener) {
            this._dataListener = Hooks.on("visageDataChanged", () => this.render());
        }

        // Debounced Search Input
        const searchInput = this.element.querySelector(".search-bar input");
        if (searchInput) {
            searchInput.addEventListener("input", (e) => {
                this.filters.search = e.target.value;
                if (this._searchDebounce) clearTimeout(this._searchDebounce);
                this._searchDebounce = setTimeout(() => {
                    this.render();
                    // Refocus and restore cursor logic
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

        // Setup Drag-and-Drop for Global Items
        if (!this.isLocal) {
            const cards = this.element.querySelectorAll(".visage-card");
            cards.forEach(card => {
                card.setAttribute("draggable", "true");
                card.addEventListener("dragstart", this._onDragStart.bind(this));
            });
        } else {
            const cards = this.element.querySelectorAll(".visage-card");
            cards.forEach(card => card.removeAttribute("draggable"));
        }
    }

    /**
     * Handles the "Swap to Default" action.
     * Swaps the selected Visage with the token's Base/Prototype data.
     */
    async _onSwapDefault(event, target) {
        // Safety checks
        if (!this.isLocal || !this.tokenId) return;
        const visageId = target.dataset.visageId;
        const visageLabel = target.closest('.visage-card')?.querySelector('.card-title')?.innerText || "Visage";

        // 1. Confirm with User (Destructive Action)
        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize("VISAGE.Dialog.SwapDefault.Title") },
            content: game.i18n.format("VISAGE.Dialog.SwapDefault.Content", { label: visageLabel }),
            modal: true,
            rejectClose: false
        });

        if (!confirmed) return;

        // 2. Perform Swap
        try {
            await VisageData.commitToDefault(this.tokenId, visageId);
            // No manual re-render needed; VisageData updates the Actor, 
            // which triggers 'updateActor' hook, which calls this.render() via _bindListeners
        } catch (err) {
            console.error(err);
            ui.notifications.error("Visage | Failed to swap default.");
        }
    }

    _onDragStart(event) {
        const card = event.target.closest(".visage-card");
        if (!card) return;
        const dragData = { type: "Visage", id: card.dataset.id };
        event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
    }

    async _onCreate() { 
        new VisageEditor({ 
            actorId: this.actorId,
            tokenId: this.tokenId
        }).render(true); 
    }

    async _onEdit(event, target) {
        const id = target.closest(".visage-card").dataset.id;
        new VisageEditor({ 
            visageId: id,
            actorId: this.actorId,
            tokenId: this.tokenId
        }).render(true);
    }

    async _onDelete(event, target) {
        const card = target.closest(".visage-card");
        if (!card) return;
        
        await VisageData.delete(card.dataset.id, this.actor);
        if (this.isLocal) this.render();
    }

    async _onRestore(event, target) {
        const card = target.closest(".visage-card");
        if (!card) return;
        
        await VisageData.restore(card.dataset.id, this.actor);
        if (this.isLocal) this.render();
    }

    async _onDestroy(event, target) {
        const card = target.closest(".visage-card");
        if (!card) return;

        const confirm = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize("VISAGE.Dialog.Destroy.Title") },
            content: game.i18n.localize("VISAGE.Dialog.Destroy.Content"),
            modal: true
        });

        if (confirm) {
            await VisageData.destroy(card.dataset.id, this.actor);
            if (this.isLocal) this.render();
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
     * Handles the "Apply" button click on a Visage Card.
     * Behavior differs based on context:
     * - **Local Gallery:** Performs an Identity Swap (swaps base appearance).
     * - **Global Library:** Performs a Mask Application (layers on top of current appearance).
     */
    async _onApply(event, target) {
        const card = target.closest(".visage-card");
        const id = card.dataset.id;
        const name = card.querySelector(".card-title")?.innerText || "Visage";

        if (this.isLocal) {
            if (this.tokenId) {
                if (id === "default") {
                    // Manual Revert Logic for "Default" card
                    const token = canvas.tokens.get(this.tokenId);
                    const currentIdentity = token.document.getFlag(Visage.MODULE_ID, "identity");
                    if (currentIdentity) await Visage.remove(this.tokenId, currentIdentity);
                    ui.notifications.info(game.i18n.format("VISAGE.Notifications.Updated", { name: name }));
                } else {
                    // Apply Identity: Use switchIdentity to preserve other cosmetic masks (e.g. Invisibility)
                    await Visage.apply(this.tokenId, id, { switchIdentity: true });
                    ui.notifications.info(game.i18n.format("VISAGE.Notifications.Updated", { name: name }));
                }
            } else {
                ui.notifications.warn("VISAGE.Notifications.NoTokens", { localize: true });
            }
        } else {
            // Global Mode: Apply to selected tokens
            const tokens = canvas.tokens.controlled.filter(t => t.document.isOwner);
            if (tokens.length === 0) return ui.notifications.warn("VISAGE.Notifications.NoTokens", { localize: true });
            
            const visageData = VisageData.getGlobal(id);
            if (!visageData) return;

            for (const token of tokens) {
                // Global Mask = Add to Stack (clearStack: false)
                await Visage.apply(token, id, { clearStack: false });
            }
            ui.notifications.info(game.i18n.format("VISAGE.Notifications.Applied", { count: tokens.length, label: name }));
        }
    }
}