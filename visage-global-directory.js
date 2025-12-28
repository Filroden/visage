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
            category: null, // null = All
            showBin: false
        };
    }

    static DEFAULT_OPTIONS = {
        tag: "div",
        id: "visage-global-directory",
        classes: ["visage", "visage-global-directory", "visage-dark-theme"],
        window: {
            title: "VISAGE.GlobalDirectory.Title",
            icon: "visage-icon-mask", // Using your CSS mask class
            resizable: true,
            width: 900,
            height: 700
        },
        actions: {
            create: VisageGlobalDirectory.prototype._onCreate,
            edit: VisageGlobalDirectory.prototype._onEdit,
            delete: VisageGlobalDirectory.prototype._onDelete,
            restore: VisageGlobalDirectory.prototype._onRestore,
            destroy: VisageGlobalDirectory.prototype._onDestroy, // Hard delete
            apply: VisageGlobalDirectory.prototype._onApply,
            
            // Filter Actions
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
        // 1. Get Data Source (Bin vs Active)
        const source = this.filters.showBin ? VisageGlobalData.bin : VisageGlobalData.all;
        
        // 2. Extract Categories (from Active list only, usually)
        // We accumulate unique categories to build the sidebar list
        const allActive = VisageGlobalData.all;
        const categories = new Set();
        allActive.forEach(v => {
            if (v.category) categories.add(v.category);
        });
        const categoryList = Array.from(categories).sort().map(c => ({
            label: c,
            active: this.filters.category === c
        }));

        // 3. Filter Items
        let items = source.filter(entry => {
            // Category Filter
            if (this.filters.category && entry.category !== this.filters.category) return false;
            
            // Search Filter
            if (this.filters.search) {
                const term = this.filters.search.toLowerCase();
                return (
                    entry.label.toLowerCase().includes(term) ||
                    (entry.tags && entry.tags.some(t => t.toLowerCase().includes(term)))
                );
            }
            return true;
        });

        return {
            items: items,
            categories: categoryList,
            filters: this.filters,
            isBin: this.filters.showBin,
            hasSelection: canvas.tokens?.controlled.length > 0
        };
    }

    /* -------------------------------------------- */
    /* Event Listeners                              */
    /* -------------------------------------------- */

    _onRender(context, options) {
        // Debounced Search Input
        const searchInput = this.element.querySelector(".search-bar input");
        if (searchInput) {
            searchInput.addEventListener("input", (e) => {
                this.filters.search = e.target.value;
                this.render(); // Re-render to filter grid
            });
        }

        // Drag Start Handler
        const cards = this.element.querySelectorAll(".visage-card");
        cards.forEach(card => {
            card.addEventListener("dragstart", this._onDragStart.bind(this));
        });
    }

    _onDragStart(event) {
        const id = event.currentTarget.dataset.id;
        const visage = VisageGlobalData.get(id);
        if (!visage) return;

        // Standard Foundry Drag Data
        const dragData = {
            type: "Visage",
            payload: visage, // Pass the full data
            id: id
        };
        event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
    }

    /* -------------------------------------------- */
    /* Actions                                      */
    /* -------------------------------------------- */

    async _onCreate() {
        new VisageGlobalEditor().render(true);
    }

    async _onEdit(event, target) {
        const id = target.closest(".visage-card").dataset.id;
        new VisageGlobalEditor({ visageId: id }).render(true);
    }

    async _onDelete(event, target) {
        const id = target.closest(".visage-card").dataset.id;
        const confirm = await Dialog.confirm({
            title: "Delete Visage",
            content: "Move this visage to the Recycle Bin?"
        });
        if (confirm) {
            await VisageGlobalData.delete(id);
            this.render();
        }
    }

    async _onRestore(event, target) {
        const id = target.closest(".visage-card").dataset.id;
        await VisageGlobalData.restore(id);
        this.render();
    }

    async _onDestroy(event, target) {
        const id = target.closest(".visage-card").dataset.id;
        const confirm = await Dialog.confirm({
            title: "Permanently Delete",
            content: "This action cannot be undone. Are you sure?"
        });
        if (confirm) {
            await VisageGlobalData.destroy(id);
            this.render();
        }
    }

    _onSelectCategory(event, target) {
        const cat = target.dataset.category;
        // Toggle off if clicking active
        this.filters.category = (this.filters.category === cat) ? null : cat;
        this.render();
    }

    _onToggleBin() {
        this.filters.showBin = !this.filters.showBin;
        this.filters.category = null; // Reset category when switching modes
        this.render();
    }

    _onClearSearch() {
        this.filters.search = "";
        this.render();
    }

    /* -------------------------------------------- */
    /* THE APPLY LOGIC                              */
    /* -------------------------------------------- */

    /**
     * Applies a Global Visage to all selected tokens on the canvas.
     */
    async _onApply(event, target) {
        const id = target.closest(".visage-card").dataset.id;
        const visage = VisageGlobalData.get(id);
        if (!visage) return;

        const tokens = canvas.tokens.controlled;
        if (!tokens.length) {
            ui.notifications.warn("Visage | No tokens selected.");
            return;
        }

        const updates = tokens.map(t => this._calculateTokenUpdate(t, visage.changes));
        
        // Filter out null updates (in case of error)
        const validUpdates = updates.filter(u => u);

        if (validUpdates.length) {
            await canvas.scene.updateEmbeddedDocuments("Token", validUpdates);
            ui.notifications.info(`Applied '${visage.label}' to ${validUpdates.length} tokens.`);
        }
    }

    /**
     * Converts a Visage Payload into a specific Token Update object.
     * @param {Token} token - The token object on the canvas.
     * @param {object} changes - The payload from the Global Visage.
     * @returns {object} The update data.
     */
    _calculateTokenUpdate(token, changes) {
        const update = { _id: token.id };
        const c = changes;

        // 1. Identity
        if (c.name) update.name = c.name;
        if (c.disposition !== null) update.disposition = c.disposition;

        // 2. Texture & Scale
        // Foundry V10+ Structure: texture: { src, scaleX, scaleY }
        const textureUpdate = {};
        
        if (c.img) textureUpdate.src = c.img;

        // SCALE & FLIP MATH
        // We need to respect the token's *current* flipping if the payload says "Unchanged" (null).
        // If Payload Flip is True/False, we force it.
        
        // Get current state
        const currentScaleX = token.document.texture.scaleX;
        const currentScaleY = token.document.texture.scaleY;
        const currentAbsScale = Math.abs(currentScaleX);
        const currentIsFlippedX = currentScaleX < 0; // Negative scaleX means flipped horizontally in Foundry
        const currentIsFlippedY = currentScaleY < 0; 

        // Determine new absolute scale (use payload, or keep current)
        const newAbsScale = (c.scale !== null) ? c.scale : currentAbsScale;

        // Determine new Flip State X
        let newIsFlippedX = currentIsFlippedX; // Default to current
        if (c.isFlippedX === true) newIsFlippedX = true;
        if (c.isFlippedX === false) newIsFlippedX = false;

        // Determine new Flip State Y
        let newIsFlippedY = currentIsFlippedY; // Default to current
        if (c.isFlippedY === true) newIsFlippedY = true;
        if (c.isFlippedY === false) newIsFlippedY = false;

        // Calculate Final Scale Values
        // In Foundry, negative scale = flipped
        textureUpdate.scaleX = newAbsScale * (newIsFlippedX ? -1 : 1);
        textureUpdate.scaleY = newAbsScale * (newIsFlippedY ? -1 : 1);

        if (Object.keys(textureUpdate).length > 0) update.texture = textureUpdate;

        // 3. Dimensions
        if (c.width) update.width = c.width;
        if (c.height) update.height = c.height;

        // 4. Ring
        if (c.ring) {
            update.ring = c.ring;
        }

        // 5. Flags (Metadata for Tracking)
        // We stamp the token so we know it's using a Global Visage
        update["flags.visage.activeVisage"] = {
            id: "global", // or the specific ID if we want to track it
            source: "global",
            label: changes.label // store for UI reference
        };

        return update;
    }
}