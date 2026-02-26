import { Visage } from "../core/visage.js";
import { VisageGallery } from "./visage-gallery.js";
import { VisageComposer } from "../core/visage-composer.js";
import { VisageData } from "../data/visage-data.js";
import { VisageUtilities } from "../utils/visage-utilities.js";
import { MODULE_ID, DATA_NAMESPACE } from "../core/visage-constants.js";

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
        this.uiPosition = options.uiPosition;
        this.showPublic = VisageSelector.showPublic ?? true;
    }

    static DEFAULT_OPTIONS = {
        tag: "div",
        id: "visage-selector",
        classes: ["visage", "visage-selector-app", "borderless"],
        window: { frame: false, positioned: false, controls: [] },
        actions: {
            selectVisage: VisageSelector.prototype._onSelectVisage,
            openConfig: VisageSelector.prototype._onOpenConfig,
            revertGlobal: VisageSelector.prototype._onRevertGlobal,
            removeLayer: VisageSelector.prototype._onRemoveLayer,
            toggleVisibility: VisageSelector.prototype._onToggleLayerVisibility,
            toggleGlobal: VisageSelector.prototype._onToggleGlobal,
        },
    };

    static PARTS = {
        form: {
            template: "modules/visage/templates/visage-selector.hbs",
            scrollable: [".visage-selector-grid-wrapper"],
        },
    };

    /**
     * Removes all active effects *except* the base identity.
     * Useful for quickly cleaning up a messy stack of overlays.
     */
    async _onRevertGlobal(event, target) {
        const token = canvas.tokens.get(this.tokenId);
        if (!token) return;

        const currentFormKey =
            token.document.getFlag(DATA_NAMESPACE, "identity") || "default";
        const currentStack =
            token.document.getFlag(DATA_NAMESPACE, "activeStack") || [];

        // Filter stack to keep only the active Identity layer
        const newStack = currentStack.filter(
            (layer) => layer.id === currentFormKey,
        );
        await VisageComposer.compose(token, newStack);
    }

    /**
     * Prepares the data context for the HUD.
     * Fetches Local Visages AND Public Global Visages.
     */
    async _prepareContext(options) {
        // 1. Resolve Entities (Start from Token)
        const token = canvas.tokens.get(this.tokenId);
        if (!token || !token.actor) return { identities: [], overlays: [] };

        const currentFormKey =
            token.document.getFlag(DATA_NAMESPACE, "identity") || "default";

        // =======================================================
        // PART A: THE DEFAULT IDENTITY
        // =======================================================

        // The API doesn't return the "Default" state because it isn't stored data.
        // We must generate it virtually here so the user can revert to their base form.
        const defaultRaw = VisageData.getDefaultAsVisage(token.document);
        const defaultForm = VisageData.toPresentation(defaultRaw, {
            isActive: currentFormKey === "default",
        });
        defaultForm.key = "default";
        defaultForm.resolvedPath = await Visage.resolvePath(defaultForm.path);
        defaultForm.themeClass = "visage-theme-local"; // Default is always Gold/Local

        // =======================================================
        // PART B: FETCH STORED ITEMS
        // =======================================================

        // We use the API to get all available items.
        // Note: For GMs, this returns ALL globals (Private & Public).
        let allVisages = Visage.getAvailable(this.tokenId);

        // FILTER 0: Remove Soft-Deleted Items
        allVisages = allVisages.filter((v) => !v.deleted);

        // FILTER 1: Strict "HUD" Visibility Rule
        // Private items are reserved for the Global Library (GM view).
        allVisages = allVisages.filter((v) => {
            if (v.type === "global") {
                // Must be public to show in HUD
                return v.public === true;
            }
            return true; // Keep locals
        });

        // FILTER 2: User Toggle (Show/Hide Public Globals)
        if (!this.showPublic) {
            allVisages = allVisages.filter((v) => v.type !== "global");
        }

        // Process stored items for display
        const processedItems = await Promise.all(
            allVisages.map(async (v) => {
                const isGlobal = v.type === "global";

                // Resolve representative image for the icon (checking for wildcards)
                const rawPath = VisageData.getRepresentativeImage(v.changes);
                const isWildcard =
                    (rawPath || "").includes("*") ||
                    (rawPath || "").includes("?");

                // Resolve portrait if present
                let resolvedPortrait = undefined;
                if (v.changes.portrait) {
                    resolvedPortrait = await Visage.resolvePath(
                        v.changes.portrait,
                    );
                }

                // Convert to presentation format
                const presentational = VisageData.toPresentation(v, {
                    isActive: v.id === currentFormKey,
                    isWildcard: isWildcard,
                    resolvedPortrait: resolvedPortrait,
                    // We optimistically resolve the path here for the icon
                    resolvedPath: await Visage.resolvePath(
                        v.changes?.texture?.src,
                    ),
                });

                presentational.key = v.id;

                // Apply Theme Class (Blue for Global, Gold for Local)
                presentational.themeClass = isGlobal
                    ? "visage-theme-global"
                    : "visage-theme-local";

                return presentational;
            }),
        );

        // Sort Alphabetically
        processedItems.sort((a, b) => a.label.localeCompare(b.label));

        // =======================================================
        // PART C: MERGE & SPLIT
        // =======================================================

        // Identity List: Start with Default, then append stored identities
        const identities = [
            defaultForm,
            ...processedItems.filter((v) => v.mode === "identity"),
        ];

        // If a global identity is currently active but isn't in the identities list
        // (e.g., it's a private GM Visage or the player hid public globals),
        // fetch it and inject it so the player knows why their token is changed.
        if (
            currentFormKey !== "default" &&
            !identities.some((i) => i.isActive)
        ) {
            const globalIdentity = VisageData.getGlobal(currentFormKey);
            if (globalIdentity) {
                const globalPresentation = VisageData.toPresentation(
                    globalIdentity,
                    {
                        isActive: true,
                        isGlobal: true,
                    },
                );

                globalPresentation.key = currentFormKey;
                globalPresentation.themeClass = "visage-theme-global"; // Triggers the Blue Border
                globalPresentation.resolvedPath = await Visage.resolvePath(
                    globalIdentity.changes?.texture?.src,
                );

                // Inject it right after the "Default" tile so it sits at the front
                identities.splice(1, 0, globalPresentation);
            }
        }

        // Overlay List: Just stored overlays
        const overlays = processedItems.filter((v) => v.mode === "overlay");

        // =======================================================
        // PART D: ACTIVE STACK (Sidebar)
        // =======================================================
        const flags = token.document.flags[MODULE_ID] || {};
        const activeStack = flags.activeStack || flags.stack || [];

        // Filter out the current identity from the sidebar stack (it's shown in the main grid)
        const visibleStack = activeStack.filter(
            (layer) => layer.id !== currentFormKey,
        );

        const stackDisplay = visibleStack
            .map((layer) => {
                const img =
                    layer.changes.img ||
                    layer.changes.texture?.src ||
                    "icons/svg/aura.svg";

                // Determine theme for stack items
                // We check if this ID exists in the Global registry to color it Blue
                const isGlobal = VisageData.getGlobal(layer.id) !== null;

                return {
                    id: layer.id,
                    label: layer.label,
                    icon: img,
                    themeClass: isGlobal
                        ? "visage-theme-global"
                        : "visage-theme-local",
                    disabled: layer.disabled,
                };
            })
            .reverse();

        return {
            identities,
            overlays,
            activeStack: stackDisplay,
            tokenId: this.tokenId,
            isGM: game.user.isGM,
            showPublic: this.showPublic,
        };
    }

    _onRender(context, options) {
        // Theme Application
        VisageUtilities.applyVisageTheme(this.element, "local");

        // Dismissal Listeners
        this._unbindDismissListeners();
        this._bindDismissListeners();

        // Drag and Drop Binding
        this._bindDragDrop();

        // Manual Position Application
        if (this.uiPosition) {
            const el = this.element;

            // Enforce Fixed Positioning (Overrides any centring defaults)
            el.style.position = "fixed";

            // Clear potential conflicting styles
            el.style.left = "auto";
            el.style.top = "auto";
            el.style.bottom = "auto";
            el.style.right = "auto";

            // Apply Horizontal Anchor
            if (this.uiPosition.right) {
                el.style.right = `${this.uiPosition.right}px`;
            } else if (this.uiPosition.left) {
                el.style.left = `${this.uiPosition.left}px`;
            }

            // Apply Vertical Anchor
            if (this.uiPosition.bottom) {
                el.style.bottom = `${this.uiPosition.bottom}px`;
            } else if (this.uiPosition.top) {
                el.style.top = `${this.uiPosition.top}px`;
            }
        }
    }

    /* -------------------------------------------- */
    /* Event Listeners                             */
    /* -------------------------------------------- */

    _onToggleGlobal(event, target) {
        this.showPublic = !this.showPublic;
        VisageSelector.showPublic = this.showPublic;
        this.render();
    }

    async _onSelectVisage(event, target) {
        const formKey = target.dataset.formKey;
        if (formKey) {
            if (formKey === "default") {
                const token = canvas.tokens.get(this.tokenId);
                const currentIdentity = token.document.getFlag(
                    MODULE_ID,
                    "identity",
                );
                if (currentIdentity)
                    await Visage.remove(this.tokenId, currentIdentity);
            } else {
                // Visage.apply handles mode logic (Identity Swap vs Overlay Stack) automatically
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
                id: appId,
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
        else if (action === "toggleVisibility")
            this._onToggleVisibility(event, target);
    }

    async _onToggleLayerVisibility(event, target) {
        const layerId = target.dataset.layerId;
        await Visage.toggleLayer(this.tokenId, layerId);
    }

    async close(options) {
        this._unbindDismissListeners();
        return super.close(options);
    }

    /**
     * Handles Drag and Drop reordering for the stack list.
     */
    _bindDragDrop() {
        const list = this.element.querySelector(".visage-sortable-list");
        if (!list) return;

        let dragSrcEl = null;

        const items = list.querySelectorAll("li.stack-item");
        items.forEach((item) => {
            item.addEventListener("dragstart", (e) => {
                dragSrcEl = item;
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/html", item.outerHTML);
                item.classList.add("dragging");
            });

            item.addEventListener("dragover", (e) => {
                if (e.preventDefault) e.preventDefault();
                return false;
            });

            item.addEventListener("dragenter", (e) => {
                item.classList.add("over");
            });

            item.addEventListener("dragleave", (e) => {
                item.classList.remove("over");
            });

            item.addEventListener("dragend", (e) => {
                item.classList.remove("dragging");
                items.forEach((i) => i.classList.remove("over"));
            });

            item.addEventListener("drop", async (e) => {
                e.stopPropagation();
                if (dragSrcEl !== item) {
                    // 1. Visual Swap (Immediate Feedback)
                    // Note: The stack list is visually REVERSED (Top layer at Top of list).
                    // But the array is Bottom-to-Top.

                    // Get all IDs in the visual order (Top to Bottom)
                    const allItems = [
                        ...list.querySelectorAll("li.stack-item"),
                    ];
                    const srcIndex = allItems.indexOf(dragSrcEl);
                    const targetIndex = allItems.indexOf(item);

                    // Move in DOM
                    if (srcIndex < targetIndex) {
                        item.after(dragSrcEl);
                    } else {
                        item.before(dragSrcEl);
                    }

                    // 2. Calculate New Logic Order (Bottom to Top)
                    // We grab the DOM order again, map to IDs, then REVERSE it to match logic stack
                    const newVisualOrder = [
                        ...list.querySelectorAll("li.stack-item"),
                    ].map((li) => li.dataset.layerId);
                    const newLogicOrder = newVisualOrder.reverse();

                    // 3. Save
                    await Visage.reorderStack(this.tokenId, newLogicOrder);

                    // Render is optional if the DOM swap looked correct,
                    // but safer to re-render to ensure state is clean
                    this.render();
                }
                return false;
            });
        });
    }

    /**
     * Binds a global pointer listener to detect clicks outside the HUD.
     * If the user clicks anywhere else on the screen (except the toggle button or another Visage window),
     * this selector closes automatically.
     */
    _bindDismissListeners() {
        this._onDocPointerDown = (ev) => {
            const root = this.element;
            if (!root) return;

            // Ignore clicks inside the HUD itself
            if (root.contains(ev.target)) return;

            // Ignore clicks on the HUD button that spawned this (prevents immediate re-opening)
            const hudBtn = document.querySelector(".visage-button");
            if (hudBtn && (hudBtn === ev.target || hudBtn.contains(ev.target)))
                return;

            // Ignore clicks on other Visage windows (Gallery/Editor)
            const dirApp = ev.target.closest(".visage-gallery");
            const editorApp = ev.target.closest(".visage-editor");
            if (dirApp || editorApp) return;

            this.close();
        };
        document.addEventListener("pointerdown", this._onDocPointerDown, true);

        // Auto-refresh the HUD if the token updates while it is open
        this._onTokenUpdate = (document, change, options, userId) => {
            if (document.id === this.tokenId) {
                this.render();
            }
        };
        Hooks.on("updateToken", this._onTokenUpdate);
    }

    _unbindDismissListeners() {
        if (this._onDocPointerDown) {
            document.removeEventListener(
                "pointerdown",
                this._onDocPointerDown,
                true,
            );
            this._onDocPointerDown = null;
        }
        if (this._onTokenUpdate) {
            Hooks.off("updateToken", this._onTokenUpdate);
            this._onTokenUpdate = null;
        }
    }
}
