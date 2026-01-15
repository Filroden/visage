import { Visage } from "./visage.js";
import { VisageData } from "./visage-data.js"; 
import { VisageEditor } from "./visage-editor.js";
import { VisageUtilities } from "./visage-utilities.js";
import { cleanVisageData } from "./visage-migration.js"; // <--- ADDED THIS IMPORT

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The main browser application for Visage.
 * It adapts its behavior, theme, and available actions based on whether it is
 * targeting a specific Actor ("Local Mode") or the World Settings ("Global Mode").
 */
export class VisageGallery extends HandlebarsApplicationMixin(ApplicationV2) {
    
    /**
     * @param {Object} options - Application options.
     * @param {string} [options.actorId] - If provided, opens in "Local Mode" for this actor.
     * @param {string} [options.tokenId] - Context token for applying changes immediately.
     * @param {string} [options.sceneId] - Scene context.
     */
    constructor(options = {}) {
        super(options);
        
        this.actorId = options.actorId || null;
        this.tokenId = options.tokenId || null;
        this.sceneId = options.sceneId || null;
        
        // Theme Adaptation: Different icons/styles help users distinguish modes instantly.
        if (!this.isLocal) {
            this.options.window.icon = "visage-icon-domino"; // Global (Masks)
        } else {
            this.options.window.icon = "visage-icon-mask";   // Local (Identities)
        }
        
        this.filters = {
            search: "",
            category: null,
            tags: new Set(),
            showBin: false
        };
        
        // --- Reactive Updates ---
        // We bind listeners here to ensure the UI stays in sync with data changes.
        
        this._onDataChanged = () => this.render();
        
        this._onActorUpdate = (doc) => {
            if (doc.id === this.actorId) this.render();
        };

        this._onTokenUpdate = (doc, changes, options, userId) => {
            if (this.tokenId && doc.id === this.tokenId) {
                // RACE CONDITION FIX: 
                // When a token reverts to default, the data update on the server happens instantly,
                // but the client-side document might lag by a few frames. 
                // A small delay ensures the Gallery reads the *new* default state, not the old cached one.
                setTimeout(() => {
                    if (this.rendered) this.render();
                }, 100); 
            }
        };

        if (this.isLocal) {
            Hooks.on("updateActor", this._onActorUpdate);
            Hooks.on("updateToken", this._onTokenUpdate);
        } else {
            Hooks.on("visageDataChanged", this._onDataChanged);
        }
    }

    /**
     * Returns true if the gallery is managing a specific Actor's identities.
     * Returns false if managing the World's mask library.
     */
    get isLocal() { return !!this.actorId; }

    get actor() {
        return VisageUtilities.resolveTarget(this.options).actor;
    }

    async close(options) {
        if (this.isLocal) {
            Hooks.off("updateActor", this._onActorUpdate);
            Hooks.off("updateToken", this._onTokenUpdate);
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
            swapDefault: VisageGallery.prototype._onSwapDefault,
            promote: VisageGallery.prototype._onPromote,
            copyToLocal: VisageGallery.prototype._onCopyToLocal,
            export: VisageGallery.prototype._onExport,
            import: VisageGallery.prototype._onImport
        }
    };

    static PARTS = {
        directory: {
            template: "modules/visage/templates/visage-gallery.hbs", 
            scrollable: [".visage-browser-grid", ".visage-sidebar"]
        }
    };

    get title() {
        if (this.isLocal && this.actor) {
            return game.i18n.format("VISAGE.Directory.Title.Local", { actor: this.actor.name });
        }
        return game.i18n.localize("VISAGE.Directory.Title.Global");
    }

    /**
     * Prepares the data for the Handlebars template.
     * * ARCHITECTURE NOTE:
     * This method acts as a data unification layer. It fetches data from either
     * Actor Flags (Local) or World Settings (Global), normalizes them into a standard
     * structure, applies client-side filtering (Search/Tags/Categories), and
     * generates the presentation data (Icons/Badges) for the UI cards.
     * @override
     */
    async _prepareContext(options) {
        // 1. Fetch Raw Data Source
        let rawItems = [];
        if (this.isLocal) {
            if (!this.actor) return { items: [] };
            rawItems = VisageData.getLocal(this.actor);
        } else {
            rawItems = this.filters.showBin ? VisageData.bin : VisageData.globals;
        }

        // 2. Initial Filter (Recycle Bin Logic)
        let source = rawItems;
        if (this.isLocal) {
            source = rawItems.filter(v => this.filters.showBin ? v.deleted : !v.deleted);
        }
        
        // 3. Synthesize "Default Visage" (Local Mode Only)
        // The actor's base appearance (Prototype Token) isn't stored in the flags,
        // so we must generate a "Virtual Visage" representing it so it appears in the grid.
        if (this.isLocal && !this.filters.showBin && this.actor) {
             let defaultRaw;
             
             // Prefer current token state if available (for unlinked token edits)
             if (this.tokenId) {
                 const token = canvas.tokens.get(this.tokenId);
                 if (token) defaultRaw = VisageData.getDefaultAsVisage(token.document);
             } 
             
             // Fallback to Prototype Token
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
                        texture: { 
                            src: proto.texture.src, 
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

        // 4. Aggregate Filters (Tags & Categories)
        const categories = new Set();
        const tagCounts = {}; 
        source.forEach(v => {
            if (v.category) categories.add(v.category);
            if (v.tags && Array.isArray(v.tags)) {
                v.tags.forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
            }
        });

        const activeTags = Array.from(this.filters.tags).sort().map(t => ({ label: t, active: true }));
        
        // Calculate "Popular Tags" for suggestions
        const popularTags = Object.entries(tagCounts)
            .sort((a, b) => b[1] - a[1]) 
            .slice(0, 10)
            .map(([tag, count]) => ({ label: tag, count }))
            .filter(t => !this.filters.tags.has(t.label)) 
            .map(t => ({ label: t.label, active: false, count: t.count }));
            
        const categoryList = Array.from(categories).sort().map(c => ({
            label: c,
            active: this.filters.category === c
        }));

        // 5. Apply Client-Side Filtering
        let items = source.filter(entry => {
            if (this.filters.category && entry.category !== this.filters.category) return false;
            
            if (this.filters.search) {
                const term = this.filters.search.toLowerCase();
                // Search matches Name OR Tags
                if (!(entry.label.toLowerCase().includes(term) || (entry.tags && entry.tags.some(t => t.toLowerCase().includes(term))))) return false;
            }
            
            if (this.filters.tags.size > 0) {
                const entryTags = entry.tags || [];
                // AND logic: Entry must contain ALL selected tags
                if (!Array.from(this.filters.tags).every(t => entryTags.includes(t))) return false;
            }
            return true;
        });

        // Sort: Default first, then Alphabetical
        items.sort((a, b) => {
            if (a.id === "default") return -1;
            if (b.id === "default") return 1;
            return a.label.localeCompare(b.label);
        });

        // 6. Generate UI Context (Badges, Resolved Images)
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
        VisageUtilities.applyVisageTheme(this.element, this.isLocal);

        if (!this._dataListener) {
            this._dataListener = Hooks.on("visageDataChanged", () => this.render());
        }

        // Search Debounce
        const searchInput = this.element.querySelector(".search-bar input");
        if (searchInput) {
            searchInput.addEventListener("input", (e) => {
                this.filters.search = e.target.value;
                if (this._searchDebounce) clearTimeout(this._searchDebounce);
                this._searchDebounce = setTimeout(() => {
                    this.render();
                    // Restore Focus Trick
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

        // Drag & Drop Handling
        // Only allow dragging generic Masks (Global), not specific Identities (Local)
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
     * Action: Promote to Library (Local -> Global).
     */
    async _onPromote(event, target) {
        const visageId = target.dataset.visageId;
        if (!visageId || !this.isLocal) return;
        
        await VisageData.promote(this.actor, visageId);
    }

    /**
     * Action: Copy to Visage (Global -> Local).
     * Copies the selected Mask from the Library to the Actors of all selected tokens.
     */
    async _onCopyToLocal(event, target) {
        if (this.isLocal) return; // Only valid in Global Library

        // 1. Get Global Data
        const card = target.closest(".visage-card");
        const id = card.dataset.id;
        const globalMask = VisageData.getGlobal(id);
        if (!globalMask) return;

        // 2. Identify Targets
        // Matches "Apply" logic: owned tokens on canvas.
        const tokens = canvas.tokens.controlled.filter(t => t.document.isOwner);
        if (tokens.length === 0) return ui.notifications.warn("VISAGE.Notifications.NoTokens", { localize: true });

        // 3. Deduplicate Actors
        // If we select 3 Goblins (same actor), we only want to copy the visage once to the "Goblin" actor.
        const targetActors = new Set(tokens.map(t => t.actor).filter(a => a));

        // 4. Copy Operation
        let count = 0;
        for (const actor of targetActors) {
            // Construct payload without ID (to force generation of a new Local ID)
            const payload = {
                label: globalMask.label,
                category: globalMask.category,
                tags: globalMask.tags ? [...globalMask.tags] : [],
                changes: foundry.utils.deepClone(globalMask.changes)
            };

            await VisageData.save(payload, actor);
            count++;
        }

        ui.notifications.info(game.i18n.format("VISAGE.Notifications.CopyStats", { 
            label: globalMask.label, 
            count: count 
        }));
    }

    /**
     * Action: Swap Default.
     * Replaces the token's base prototype with the selected Visage data.
     */
    async _onSwapDefault(event, target) {
        if (!this.isLocal || !this.tokenId) return;
        const visageId = target.dataset.visageId;
        const visageLabel = target.closest('.visage-card')?.querySelector('.card-title')?.innerText || "Visage";

        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize("VISAGE.Dialog.SwapDefault.Title") },
            content: game.i18n.format("VISAGE.Dialog.SwapDefault.Content", { label: visageLabel }),
            modal: true,
            rejectClose: false
        });

        if (!confirmed) return;

        try {
            await VisageData.commitToDefault(this.tokenId, visageId);
        } catch (err) {
            console.error(err);
            ui.notifications.error("Visage | Failed to swap default.");
        }
    }

    /**
     * Action: Export Visages/Masks.
     * Dumps the current context (Active Local or Active Global) to a JSON file.
     * Excludes deleted items.
     */
    async _onExport(event, target) {
        let data;
        let filename;

        if (this.isLocal) {
            // Local Export: Filter to only active items (exclude 'deleted')
            data = VisageData.getLocal(this.actor).filter(v => !v.deleted);
            // Sanitize filename to prevent OS issues
            const safeName = this.actor.name.replace(/[^a-z0-9]/gi, '_');
            filename = `Visage_Local_${safeName}.json`;
        } else {
            // Global Export: Globals getter already filters out deleted items
            data = VisageData.globals;
            filename = "Visage_Global_Library.json";
        }

        if (data.length === 0) {
            return ui.notifications.warn("VISAGE.Notifications.ExportEmpty", { localize: true });
        }
        
        saveDataToFile(JSON.stringify(data, null, 2), "application/json", filename);
        ui.notifications.info(game.i18n.format("VISAGE.Notifications.Exported", { count: data.length }));
    }

    /**
     * Action: Import Visages/Masks.
     * Reads a JSON file, sanitizes data, and imports non-duplicate items.
     */
    async _onImport(event, target) {
        // Create hidden file input
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";
        
        input.onchange = async () => {
            const file = input.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const json = JSON.parse(e.target.result);
                    if (!Array.isArray(json)) throw new Error(game.i18n.localize("VISAGE.Errors.ImportInvalidFormat"));

                    let imported = 0;
                    let skipped = 0;

                    // Fetch existing items to check for duplicates (UUID collision)
                    const currentItems = this.isLocal ? VisageData.getLocal(this.actor) : VisageData.globals;
                    const currentIds = new Set(currentItems.map(i => i.id));

                    for (const entry of json) {
                        // 1. Sanitize & Migrate (using v2.2 schema cleaner)
                        const cleanEntry = cleanVisageData(entry);
                        
                        // 2. Basic Validation
                        if (!cleanEntry.id || !cleanEntry.changes) continue;

                        // 3. Duplicate Check: If UUID exists, SKIP.
                        if (currentIds.has(cleanEntry.id)) {
                            skipped++;
                            continue;
                        }

                        // 4. Save (Context Aware)
                        await VisageData.save(cleanEntry, this.isLocal ? this.actor : null);
                        imported++;
                    }

                    if (imported > 0 || skipped > 0) {
                        ui.notifications.info(game.i18n.format("VISAGE.Notifications.ImportStats", {
                            imported: imported,
                            skipped: skipped
                        }));
                        this.render();
                    } else {
                        ui.notifications.warn("VISAGE.Notifications.ImportEmpty", { localize: true });
                    }

                } catch (err) {
                    console.error("Visage | Import Failed:", err);
                    ui.notifications.error("VISAGE.Notifications.ImportError", { localize: true });
                }
            };
            reader.readAsText(file);
        };
        
        input.click();
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
     * Action: Apply Visage/Mask.
     * Handles the logic for activating a visage on a token.
     * - Local Mode: Swaps identity (switchIdentity: true).
     * - Global Mode: Stacks as a mask (clearStack: false).
     */
    async _onApply(event, target) {
        const card = target.closest(".visage-card");
        const id = card.dataset.id;
        const name = card.querySelector(".card-title")?.innerText || "Visage";

        if (this.isLocal) {
            // Local Mode: Identity Swap Logic
            if (this.tokenId) {
                if (id === "default") {
                    const token = canvas.tokens.get(this.tokenId);
                    const currentIdentity = token.document.getFlag(Visage.MODULE_ID, "identity");
                    if (currentIdentity) await Visage.remove(this.tokenId, currentIdentity);
                    ui.notifications.info(game.i18n.format("VISAGE.Notifications.Updated", { name: name }));
                } else {
                    await Visage.apply(this.tokenId, id, { switchIdentity: true });
                    ui.notifications.info(game.i18n.format("VISAGE.Notifications.Updated", { name: name }));
                }
            } else {
                ui.notifications.warn("VISAGE.Notifications.NoTokens", { localize: true });
            }
        } else {
            // Global Mode: Mask Stacking Logic
            const tokens = canvas.tokens.controlled.filter(t => t.document.isOwner);
            if (tokens.length === 0) return ui.notifications.warn("VISAGE.Notifications.NoTokens", { localize: true });
            
            const visageData = VisageData.getGlobal(id);
            if (!visageData) return;

            for (const token of tokens) {
                await Visage.apply(token, id, { clearStack: false });
            }
            ui.notifications.info(game.i18n.format("VISAGE.Notifications.Applied", { count: tokens.length, label: name }));
        }
    }
}