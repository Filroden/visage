/**
 * @file The main browser window for the Visage Library/Gallery.
 * @module visage
 */

import { Visage } from "./visage.js";
import { VisageData } from "./visage-data.js"; 
import { VisageEditor } from "./visage-editor.js"; 

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

        if (this.isLocal) {
            Hooks.on("updateActor", this._onActorUpdate);
        } else {
            Hooks.on("visageDataChanged", this._onDataChanged);
        }
    }

    get isLocal() { return !!this.actorId; }

    get actor() {
        if (this.tokenId) {
            const token = canvas.tokens.get(this.tokenId);
            if (token?.actor) return token.actor;
            if (this.sceneId) {
                const scene = game.scenes.get(this.sceneId);
                const tokenDoc = scene?.tokens.get(this.tokenId);
                if (tokenDoc?.actor) return tokenDoc.actor;
            }
        }
        if (this.actorId) return game.actors.get(this.actorId);
        return null;
    }

    async close(options) {
        if (this.isLocal) Hooks.off("updateActor", this._onActorUpdate);
        else Hooks.off("visageDataChanged", this._onDataChanged);
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
        position: { 
            width: 1250, 
            height: 700 
        },
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
            clearTags: VisageGallery.prototype._onClearTags
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

    /** @override */
    async _prepareContext(options) {
        let rawItems = [];

        if (this.isLocal) {
            if (!this.actor) return { items: [] };
            rawItems = VisageData.getLocal(this.actor);
        } else {
            rawItems = this.filters.showBin ? VisageData.bin : VisageData.globals;
        }

        let source = rawItems;
        if (this.isLocal) {
            source = rawItems.filter(v => this.filters.showBin ? v.deleted : !v.deleted);
        }

        // --- ADD DEFAULT ENTRY (Local Only) ---
        if (this.isLocal && !this.filters.showBin && this.actor) {
            const ns = Visage.DATA_NAMESPACE;
            // Get saved default flags or fallback to prototype
            let defaults = this.actor.flags?.[ns]?.[this.tokenId]?.defaults;
            
            if (!defaults) {
                const proto = this.actor.prototypeToken;
                defaults = { 
                    name: proto.name, 
                    token: proto.texture.src,
                    scale: proto.texture.scaleX,
                    ring: proto.ring ? (proto.ring.toObject ? proto.ring.toObject() : proto.ring) : null
                };
            }

            // Normalize "Saved Default" format to "Unified Visage" format
            const rawScale = defaults.scale ?? 1.0;
            const scale = Math.abs(rawScale);
            const isFlippedX = defaults.isFlippedX ?? (rawScale < 0);
            
            const defaultEntry = {
                id: "default",
                label: game.i18n.localize("VISAGE.Selector.Default"),
                category: "",
                tags: [],
                isDefault: true, // Flag for template to hide actions
                changes: {
                    name: defaults.name,
                    img: defaults.token,
                    texture: {
                        scaleX: scale * (isFlippedX ? -1 : 1),
                        scaleY: scale // Simplified
                    },
                    disposition: defaults.disposition,
                    ring: defaults.ring,
                    width: defaults.width,
                    height: defaults.height
                }
            };
            
            // Add to start of list
            source.unshift(defaultEntry);
        }

        const categories = new Set();
        const tagCounts = {}; 

        source.forEach(v => {
            if (v.category) categories.add(v.category);
            if (v.tags && Array.isArray(v.tags)) {
                v.tags.forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
            }
        });

        const activeTags = Array.from(this.filters.tags).sort().map(t => ({ label: t, active: true }));
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

        let items = source.filter(entry => {
            if (this.filters.category && entry.category !== this.filters.category) return false;
            
            if (this.filters.search) {
                const term = this.filters.search.toLowerCase();
                const matchesSearch = (
                    entry.label.toLowerCase().includes(term) ||
                    (entry.tags && entry.tags.some(t => t.toLowerCase().includes(term)))
                );
                if (!matchesSearch) return false;
            }

            if (this.filters.tags.size > 0) {
                const entryTags = entry.tags || [];
                if (!Array.from(this.filters.tags).every(t => entryTags.includes(t))) return false;
            }
            return true;
        });

        // Sort: Default first, then alphabetical
        items.sort((a, b) => {
            if (a.id === "default") return -1;
            if (b.id === "default") return 1;
            return a.label.localeCompare(b.label);
        });

        const preparedItems = await Promise.all(items.map(async (entry) => {
            const c = entry.changes;
            const resolvedImg = await Visage.resolvePath(c.img);
            const isVideo = foundry.helpers.media.VideoHelper.hasVideoExtension(resolvedImg);
            const ringCtx = Visage.prepareRingContext(c.ring);
            
            const tx = c.texture || {};
            const rawScaleX = tx.scaleX ?? 1.0;
            const scaleVal = Math.round(Math.abs(rawScaleX) * 100);
            
            const hasTexture = !!c.texture; 
            const scaleActive = hasTexture && (Math.abs(rawScaleX) !== 1);

            let dimLabel = "-";
            let dimActive = false;
            if (c.width || c.height) {
                dimLabel = `${c.width || 1} x ${c.height || 1}`;
                dimActive = true;
            }
            
            const isFlippedX = rawScaleX < 0;
            const isFlippedY = (tx.scaleY ?? 1.0) < 0;

            let flipIcon = "fas fa-arrows-alt-h"; 
            let flipLabel = "-";
            let flipActive = false;
            if (isFlippedX || isFlippedY) {
                flipActive = true;
                if (isFlippedX && !isFlippedY) {
                    flipIcon = "fas fa-arrow-left";
                    flipLabel = game.i18n.localize("VISAGE.Mirror.Horizontal.Label");
                } else if (isFlippedY && !isFlippedX) {
                    flipIcon = "fas fa-arrow-down";
                    flipLabel = game.i18n.localize("VISAGE.Mirror.Vertical.Label");
                } else {
                    flipIcon = "fas fa-expand-arrows-alt";
                    flipLabel = game.i18n.localize("VISAGE.Mirror.Label.Combined");
                }
            }
            
            let dispClass = "none";
            let dispLabel = game.i18n.localize("VISAGE.Disposition.NoChange");
            if (c.disposition !== null && c.disposition !== undefined) {
                switch (c.disposition) {
                    case 1: dispClass = "friendly"; dispLabel = game.i18n.localize("VISAGE.Disposition.Friendly"); break;
                    case 0: dispClass = "neutral"; dispLabel = game.i18n.localize("VISAGE.Disposition.Neutral"); break;
                    case -1: dispClass = "hostile"; dispLabel = game.i18n.localize("VISAGE.Disposition.Hostile"); break;
                    case -2: dispClass = "secret"; dispLabel = game.i18n.localize("VISAGE.Disposition.Secret"); break;
                }
            }

            const itemTags = (entry.tags || []).map(t => ({
                label: t,
                active: this.filters.tags.has(t)
            }));

            return {
                ...entry,
                changes: { ...entry.changes, img: resolvedImg },
                isVideo: isVideo,
                meta: {
                    hasRing: ringCtx.enabled,
                    hasPulse: ringCtx.hasPulse,
                    hasGradient: ringCtx.hasGradient,
                    hasWave: ringCtx.hasWave,
                    hasInvisibility: ringCtx.hasInvisibility,
                    ringColor: ringCtx.colors.ring,
                    ringBkg: ringCtx.colors.background,
                    forceFlipX: isFlippedX,
                    forceFlipY: isFlippedY,
                    itemTags: itemTags,
                    tokenName: c.name || null,
                    slots: {
                        scale: { active: scaleActive, val: `${scaleVal}%` },
                        dim: { active: dimActive, val: dimLabel },
                        flip: { active: flipActive, icon: flipIcon, val: flipLabel },
                        disposition: { class: dispClass, val: dispLabel }
                    }
                }
            };
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
        if (this.isLocal) {
            this.element.classList.add("visage-theme-local");
            this.element.classList.remove("visage-theme-global");
        } else {
            this.element.classList.add("visage-theme-global");
            this.element.classList.remove("visage-theme-local");
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

    async _onApply(event, target) {
        if (this.isLocal) {
            const card = target.closest(".visage-card");
            if (this.tokenId) {
                await Visage.setVisage(this.actorId, this.tokenId, card.dataset.id);
                ui.notifications.info(game.i18n.format("VISAGE.Notifications.Updated", { name: "Visage" }));
                // REMOVED: this.close();  <-- Keep open for workflow
            } else {
                ui.notifications.warn("VISAGE.Notifications.NoTokens", { localize: true });
            }
        } else {
            const tokens = canvas.tokens.controlled.filter(t => t.document.isOwner);
            if (tokens.length === 0) return ui.notifications.warn("VISAGE.Notifications.NoTokens", { localize: true });
            
            const card = target.closest(".visage-card");
            const visageData = VisageData.getGlobal(card.dataset.id);
            if (!visageData) return;

            for (const token of tokens) {
                await Visage.applyGlobalVisage(token, visageData);
            }
        }
    }
}