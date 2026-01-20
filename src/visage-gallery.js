/* visage-gallery.js */
import { Visage } from "./visage.js";
import { VisageData } from "./visage-data.js"; 
import { VisageEditor } from "./visage-editor.js";
import { VisageUtilities } from "./visage-utilities.js";
import { cleanVisageData } from "./visage-migration.js"; 

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class VisageGallery extends HandlebarsApplicationMixin(ApplicationV2) {
    
    constructor(options = {}) {
        super(options);
        
        this.actorId = options.actorId || null;
        this.tokenId = options.tokenId || null;
        this.sceneId = options.sceneId || null;
       
        this.filters = {
            search: "",
            category: null,
            tags: new Set(),
            showBin: false
        };
        
        this._onDataChanged = () => this.render();
        
        this._onActorUpdate = (doc) => {
            if (doc.id === this.actorId) this.render();
        };

        this._onTokenUpdate = (doc, changes, options, userId) => {
            if (this.tokenId && doc.id === this.tokenId) {
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
            icon: "visage-icon-domino",
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
            toggleMode: VisageGallery.prototype._onToggleMode,
            selectCategory: VisageGallery.prototype._onSelectCategory,
            toggleBin: VisageGallery.prototype._onToggleBin,
            clearSearch: VisageGallery.prototype._onClearSearch,
            toggleTag: VisageGallery.prototype._onToggleTag,
            clearTags: VisageGallery.prototype._onClearTags,
            swapDefault: VisageGallery.prototype._onSwapDefault,
            promote: VisageGallery.prototype._onPromote,
            copyToLocal: VisageGallery.prototype._onCopyToLocal,
            export: VisageGallery.prototype._onExport,
            import: VisageGallery.prototype._onImport,
            toggleMenu: VisageGallery.prototype._onToggleMenu,
            duplicate: VisageGallery.prototype._onDuplicate,
            exportIndividual: VisageGallery.prototype._onExportIndividual
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

    async _prepareContext(options) {
        let rawItems = [];
        if (this.isLocal) {
            if (!this.actor) return { identities: [], overlays: [] };
            rawItems = VisageData.getLocal(this.actor);
        } else {
            rawItems = this.filters.showBin ? VisageData.bin : VisageData.globals;
        }

        let source = rawItems;
        if (this.isLocal) {
            source = rawItems.filter(v => this.filters.showBin ? v.deleted : !v.deleted);
        }
        
        // Inject Default into Local list (Identity)
        if (this.isLocal && !this.filters.showBin && this.actor) {
             let defaultRaw;
             if (this.tokenId) {
                 const token = canvas.tokens.get(this.tokenId);
                 if (token) defaultRaw = VisageData.getDefaultAsVisage(token.document);
             } 
             if (!defaultRaw) {
                const proto = this.actor.prototypeToken;
                defaultRaw = { 
                    id: "default",
                    label: game.i18n.localize("VISAGE.Selector.Default"),
                    category: "",
                    tags: [],
                    isDefault: true,
                    mode: "identity",
                    changes: {
                        name: proto.name,
                        texture: { src: proto.texture.src, scaleX: proto.texture.scaleX ?? 1.0, scaleY: proto.texture.scaleY ?? 1.0 },
                        disposition: proto.disposition, ring: proto.ring, width: proto.width, height: proto.height
                    }
                };
             }
             if (defaultRaw) source.unshift(defaultRaw);
        }

        // --- FILTERING ---
        // 1. Calculate Categories/Tags from ALL items before filtering
        const categories = new Set();
        const tagCounts = {}; 
        source.forEach(v => {
            if (v.category) categories.add(v.category);
            if (v.tags && Array.isArray(v.tags)) {
                v.tags.forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
            }
        });

        // 2. Filter the Source List
        let filteredItems = source.filter(entry => {
            if (this.filters.category && entry.category !== this.filters.category) return false;
            
            if (this.filters.search) {
                const term = this.filters.search.toLowerCase();
                if (!(entry.label.toLowerCase().includes(term) || (entry.tags && entry.tags.some(t => t.toLowerCase().includes(term))))) return false;
            }
            
            if (this.filters.tags.size > 0) {
                const entryTags = entry.tags || [];
                if (!Array.from(this.filters.tags).every(t => entryTags.includes(t))) return false;
            }
            return true;
        });

        // 3. Prepare Presentation & Split
        const identities = [];
        const overlays = [];

        for (const entry of filteredItems) {
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

            if (context.mode === "identity") identities.push(context);
            else overlays.push(context);
        }

        // Sort Identities (Default first)
        identities.sort((a, b) => {
            if (a.id === "default") return -1;
            if (b.id === "default") return 1;
            return a.label.localeCompare(b.label);
        });
        
        overlays.sort((a, b) => a.label.localeCompare(b.label));

        // ... [Tag/Category Prep Unchanged] ...
        const activeTags = Array.from(this.filters.tags).sort().map(t => ({ label: t, active: true }));
        const popularTags = Object.entries(tagCounts)
            .sort((a, b) => b[1] - a[1]) 
            .slice(0, 10)
            .map(([tag, count]) => ({ label: tag, count }))
            .filter(t => !this.filters.tags.has(t.label)) 
            .map(t => ({ label: t.label, active: false, count: t.count }));
        const categoryList = Array.from(categories).sort().map(c => ({
            label: c, active: this.filters.category === c
        }));

        const emptyMsg = this.isLocal 
            ? game.i18n.localize("VISAGE.Directory.Empty.Local")
            : game.i18n.localize("VISAGE.Directory.Empty.Global");

        const modeLabel = this.isLocal 
            ? game.i18n.localize("VISAGE.Directory.Mode.Gallery") 
            : game.i18n.localize("VISAGE.Directory.Mode.Library");

        return {
            isLocal: this.isLocal,
            // Pass split arrays
            identities: identities,
            overlays: overlays,
            hasItems: identities.length > 0 || overlays.length > 0,
            
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

        if (!this._clickListener) {
            this._clickListener = (event) => {
                if (!event.target.closest('[data-action="toggleMenu"]') && !event.target.closest('.visage-popover-menu')) {
                    this.element.querySelectorAll('.visage-popover-menu.active').forEach(menu => {
                        menu.classList.remove('active');
                    });
                }
            };
            this.element.addEventListener('click', this._clickListener);
        }

        const searchInput = this.element.querySelector(".search-bar input");
        if (searchInput) {
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

    _onToggleMenu(event, target) {
        this.element.querySelectorAll('.visage-popover-menu.active').forEach(menu => {
            if (menu !== target.nextElementSibling) menu.classList.remove('active');
        });
        const menu = target.nextElementSibling;
        if (menu) menu.classList.toggle('active');
    }

    async _onDuplicate(event, target) {
        const card = target.closest(".visage-card");
        const id = card.dataset.id;
        
        let source;
        if (this.isLocal) {
            source = VisageData.getLocal(this.actor).find(v => v.id === id);
        } else {
            source = VisageData.getGlobal(id);
        }

        if (!source) return;

        const copySuffix = game.i18n.localize("VISAGE.Suffix.Copy");
        const copy = {
            label: `${source.label}${copySuffix}`,
            category: source.category,
            tags: source.tags ? [...source.tags] : [],
            changes: foundry.utils.deepClone(source.changes),
            mode: source.mode 
        };

        await VisageData.save(copy, this.isLocal ? this.actor : null);
        target.closest('.visage-popover-menu').classList.remove('active');
    }

    async _onExportIndividual(event, target) {
        const card = target.closest(".visage-card");
        const id = card.dataset.id;
        
        let source;
        if (this.isLocal) {
            source = VisageData.getLocal(this.actor).find(v => v.id === id);
        } else {
            source = VisageData.getGlobal(id);
        }

        if (!source) return;

        const data = [source];
        const safeName = source.label.replace(/[^a-z0-9]/gi, '_');
        const filename = `Visage_${safeName}.json`;
        
        foundry.utils.saveDataToFile(JSON.stringify(data, null, 2), "application/json", filename);
        target.closest('.visage-popover-menu').classList.remove('active');
    }

    async _onPromote(event, target) {
        const visageId = target.dataset.visageId;
        if (!visageId || !this.isLocal) return;
        
        await VisageData.promote(this.actor, visageId);
    }

    /**
     * Action: Copy to Visage (Global -> Local).
     * FORCE: mode = "identity" (Visage)
     */
    async _onCopyToLocal(event, target) {
        if (this.isLocal) return; 

        const card = target.closest(".visage-card");
        const id = card.dataset.id;
        const globalMask = VisageData.getGlobal(id);
        if (!globalMask) return;

        const tokens = canvas.tokens.controlled.filter(t => t.document.isOwner);
        if (tokens.length === 0) return ui.notifications.warn("VISAGE.Notifications.NoTokens", { localize: true });

        const targetActors = new Set(tokens.map(t => t.actor).filter(a => a));

        let count = 0;
        for (const actor of targetActors) {
            const payload = {
                label: globalMask.label,
                category: globalMask.category,
                tags: globalMask.tags ? [...globalMask.tags] : [],
                mode: globalMask.mode,
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

    async _onExport(event, target) {
        let data;
        let filename;

        if (this.isLocal) {
            data = VisageData.getLocal(this.actor).filter(v => !v.deleted);
            const safeName = this.actor.name.replace(/[^a-z0-9]/gi, '_');
            filename = `Visage_Local_${safeName}.json`;
        } else {
            data = VisageData.globals;
            filename = "Visage_Global_Library.json";
        }

        if (data.length === 0) {
            return ui.notifications.warn("VISAGE.Notifications.ExportEmpty", { localize: true });
        }
        
        foundry.utils.saveDataToFile(JSON.stringify(data, null, 2), "application/json", filename);
        ui.notifications.info(game.i18n.format("VISAGE.Notifications.Exported", { count: data.length }));
    }

    async _onImport(event, target) {
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

                    const currentItems = this.isLocal ? VisageData.getLocal(this.actor) : VisageData.globals;
                    const currentIds = new Set(currentItems.map(i => i.id));

                    for (const entry of json) {
                        const cleanEntry = cleanVisageData(entry);
                        if (!cleanEntry.id || !cleanEntry.changes) continue;

                        if (currentIds.has(cleanEntry.id)) {
                            skipped++;
                            continue;
                        }

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
        const id = card.dataset.id;
        
        // --- NEW: Safety Check ---
        if (this.isLocal && this.tokenId) {
            const isIdentity = Visage.isActive(this.tokenId, id); // You defined this in visage.js
            // Or verify stack manually if isActive only checks stack:
            const token = canvas.tokens.get(this.tokenId);
            const currentIdentity = token?.document.getFlag(Visage.MODULE_ID, "identity");
            const inStack = token?.document.getFlag(Visage.MODULE_ID, "activeStack")?.some(i => i.id === id);

            if (currentIdentity === id || inStack) {
                const confirm = await foundry.applications.api.DialogV2.confirm({
                   window: { title: game.i18n.localize("VISAGE.Dialog.DeleteActive.Title") },
                    content: `<p>${game.i18n.localize("VISAGE.Warnings.DeleteActive")}</p>`,
                    modal: true
                });
                if (!confirm) return;
                
                // Force remove it from the token first
                await Visage.remove(this.tokenId, id);
            }
        }
        // -------------------------
        
        await VisageData.delete(id, this.actor);
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

    async _onApply(event, target) {
        const card = target.closest(".visage-card");
        const id = card.dataset.id;
        const name = card.querySelector(".card-title")?.innerText || "Visage";

        if (this.isLocal) {
            if (this.tokenId) {
                if (id === "default") {
                    const token = canvas.tokens.get(this.tokenId);
                    const currentIdentity = token.document.getFlag(Visage.MODULE_ID, "identity");
                    if (currentIdentity) await Visage.remove(this.tokenId, currentIdentity);
                    ui.notifications.info(game.i18n.format("VISAGE.Notifications.Updated", { name: name }));
                } else {
                    await Visage.apply(this.tokenId, id);
                    ui.notifications.info(game.i18n.format("VISAGE.Notifications.Updated", { name: name }));
                }
            } else {
                ui.notifications.warn("VISAGE.Notifications.NoTokens", { localize: true });
            }
        } else {
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

    /**
    * Toggles the mode of a specific Visage item (Identity <-> Overlay).
     */
    async _onToggleMode(event, target) {
        const card = target.closest(".visage-card");
        const id = card.dataset.id;
        
        let source;
        if (this.isLocal) {
            source = VisageData.getLocal(this.actor).find(v => v.id === id);
        } else {
            source = VisageData.getGlobal(id);
        }

        if (!source) return;

        // Flip Mode
        const newMode = (source.mode === "identity") ? "overlay" : "identity";
        
        // Prepare Update
        const update = {
            id: source.id,
            mode: newMode
        };

        // If local, we need to pass the full object structure to _saveLocal logic or use a specific update method.
        // VisageData.save handles updates if ID exists.
        // However, VisageData.save expects full data for Local items to overwrite.
        // Let's merge the change into the existing source and save that.
        
        const payload = foundry.utils.mergeObject(source, { mode: newMode });
        
        await VisageData.save(payload, this.isLocal ? this.actor : null);
        
        // No manual render needed as save triggers hooks
    }
}