import { Visage } from "../core/visage.js";
import { VisageGallery } from "./visage-gallery.js";
import { VisageData } from "../data/visage-data.js";
import { VisageUtilities } from "../utils/visage-utilities.js";
import { VisageStackController } from "./helpers/visage-stack-controller.js";
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
        // Apply distinct CSS classes based on the mode
        if (options.isWindowMode) {
            options.classes = ["visage", "visage-selector-window"];
        } else {
            options.classes = ["visage", "visage-selector-app", "borderless"];
        }

        super(options);

        this.actorId = options.actorId;
        this.tokenId = options.tokenId;
        this.sceneId = options.sceneId;
        this.uiPosition = options.uiPosition;
        this.isWindowMode = options.isWindowMode || false;
        this.showPublic = options.showPublic ?? VisageSelector.showPublic ?? true;

        this._activeHooks = [];
    }

    static DEFAULT_OPTIONS = {
        tag: "div",
        id: "visage-selector",
        window: { frame: false, positioned: false, controls: [] },
        actions: {
            selectVisage: VisageSelector.prototype._onSelectVisage,
            openConfig: VisageSelector.prototype._onOpenConfig,
            revertGlobal: VisageSelector.prototype._onRevertGlobal,
            removeLayer: VisageSelector.prototype._onRemoveLayer,
            toggleVisibility: VisageSelector.prototype._onToggleLayerVisibility,
            toggleGlobal: VisageSelector.prototype._onToggleGlobal,
            togglePin: VisageSelector.prototype._onTogglePin,
            applyAutoImage: VisageSelector.prototype._onApplyAutoImage,
        },
    };

    static PARTS = {
        form: {
            template: "modules/visage/templates/visage-selector.hbs",
            scrollable: [".visage-selector-grid-wrapper"],
        },
    };

    /**
     * Prepares the data context for the HUD.
     * Fetches Local Visages AND Public Global Visages.
     */
    async _prepareContext(_options) {
        // 1. Resolve Entities (Start from Token)
        const token = canvas.tokens.get(this.tokenId);
        if (!token?.actor) return { identities: [], overlays: [] };

        const currentFormKey = token.document.getFlag(DATA_NAMESPACE, "identity") || "default";

        // =======================================================
        // PART A: THE DEFAULT IDENTITY
        // =======================================================

        const defaultRaw = VisageData.getDefaultAsVisage(token.document);
        const defaultForm = await VisageData.buildPresentationContext(defaultRaw, { isActive: currentFormKey === "default" });
        defaultForm.key = "default";
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

                // Convert to presentation format using the new data layer factory
                const presentational = await VisageData.buildPresentationContext(v, { isActive: v.id === currentFormKey });

                presentational.key = v.id;

                // Apply Theme Class (Blue for Global, Gold for Local)
                presentational.themeClass = isGlobal ? "visage-theme-global" : "visage-theme-local";

                return presentational;
            }),
        );

        // Sort Alphabetically
        processedItems.sort((a, b) => a.label.localeCompare(b.label));

        // =======================================================
        // PART C: MERGE & SPLIT
        // =======================================================

        // Identity List: Start with Default, then append stored identities
        const identities = [defaultForm, ...processedItems.filter((v) => v.mode === "identity")];

        // If a global identity is currently active but isn't in the identities list
        // (e.g., it's a private GM Visage or the player hid public globals),
        // fetch it and inject it so the player knows why their token is changed.
        if (currentFormKey !== "default" && !identities.some((i) => i.isActive)) {
            const globalIdentity = VisageData.getGlobal(currentFormKey);
            if (globalIdentity) {
                const globalPresentation = await VisageData.buildPresentationContext(globalIdentity, {
                    isActive: true,
                    isGlobal: true,
                });

                globalPresentation.key = currentFormKey;
                globalPresentation.themeClass = "visage-theme-global"; // Triggers the Blue Border

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
        const visibleStack = activeStack.filter((layer) => layer.id !== currentFormKey);

        const stackDisplay = visibleStack
            .map((layer) => {
                const img = layer.changes.img || layer.changes.texture?.src || "icons/svg/aura.svg";

                // Determine theme for stack items
                // We check if this ID exists in the Global registry to color it Blue
                const isGlobal = VisageData.getGlobal(layer.id) !== null;

                return {
                    id: layer.id,
                    label: layer.label,
                    icon: img,
                    themeClass: isGlobal ? "visage-theme-global" : "visage-theme-local",
                    disabled: layer.disabled,
                };
            })
            .reverse();

        // --- Auto-Mapped Images ---
        let autoImages = [];
        const autoDir = game.settings.get("visage", "autoImageDirectory");
        const cache = game.settings.get("visage", "autoImageCache") || [];

        if (autoDir && cache.length > 0) {
            const tokenName = token.name || token.document.name || "";
            if (tokenName) {
                // 1. Escape special characters so "(Huge)" doesn't break the Regex engine!
                const escapedName = tokenName.trim().replaceAll(/[.+^${}()|[\]\\]/g, String.raw`\$&`);

                // 2. Transform spaces to generic separators
                const flexiblePattern = escapedName.replaceAll(/\s+/g, String.raw`[_\-\s]+`);

                // 3. STRICT BOUNDARY MATCH
                const exactRegex = new RegExp(String.raw`(^|[_\-\s])${flexiblePattern}([_\-\s\.]|$)`, "i");

                autoImages = cache
                    .filter((f) => f.startsWith(autoDir) && exactRegex.test(f.split("/").pop()))
                    .map((path) => {
                        const filename = path.split("/").pop();
                        const nameWithoutExt = filename.substring(0, filename.lastIndexOf("."));
                        // Determine if the file is a video based on common Foundry video extensions
                        const isVideo = path.match(/\.(webm|mp4|m4v)$/i) !== null;

                        return { path: path, name: nameWithoutExt, isVideo: isVideo };
                    });
            }
        }

        return {
            identities,
            overlays,
            activeStack: stackDisplay,
            tokenId: this.tokenId,
            isGM: game.user.isGM,
            showPublic: this.showPublic,
            isWindowMode: this.isWindowMode,
            autoImages: autoImages,
        };
    }

    /**
     * AppV2 Lifecycle: Fires when the application is rendered from a closed state.
     */
    _onFirstRender(context, options) {
        super._onFirstRender(context, options);

        // 1. Bind the Document Pointer Down (Click Outside) listener
        this._onDocPointerDown = (ev) => {
            if (this.isWindowMode) return;

            const root = this.element;
            if (!root) return;

            if (root.contains(ev.target)) return;

            const hudBtn = document.querySelector(".visage-button");
            if (hudBtn && (hudBtn === ev.target || hudBtn.contains(ev.target))) return;

            const dirApp = ev.target.closest(".visage-gallery");
            const editorApp = ev.target.closest(".visage-editor");
            if (dirApp || editorApp) return;

            this.close();
        };
        document.addEventListener("pointerdown", this._onDocPointerDown, true);

        // 2. Bind the Token Update Hook using the Registry
        if (this._activeHooks.length === 0) {
            const hookId = Hooks.on("updateToken", (document) => {
                if (document.id === this.tokenId) {
                    this.render();
                }
            });
            this._activeHooks.push({ name: "updateToken", id: hookId });
        }
    }

    _onRender(_context, _options) {
        // Theme Application
        VisageUtilities.applyVisageTheme(this.element, "local");

        // Drag and Drop Binding
        this._bindDragDrop();

        // Manual Position Application
        if (this.uiPosition && !this.isWindowMode) {
            const el = this.element;

            // Enforce Fixed Positioning (Overrides any centring defaults)
            el.style.position = "fixed";

            // Clear potential conflicting styles
            el.style.left = "auto";
            el.style.top = "auto";
            el.style.bottom = "auto";
            el.style.right = "auto";

            // Apply Horizontal Anchor (Safely checking for undefined)
            if (this.uiPosition.right !== undefined) {
                el.style.right = `${this.uiPosition.right}px`;
            } else if (this.uiPosition.left !== undefined) {
                el.style.left = `${this.uiPosition.left}px`;
            }

            // Apply Vertical Anchor
            if (this.uiPosition.bottom !== undefined) {
                el.style.bottom = `${this.uiPosition.bottom}px`;
            } else if (this.uiPosition.top !== undefined) {
                el.style.top = `${this.uiPosition.top}px`;
            }
        }

        // Re-apply pinning bindings if Handlebars replaced the DOM
        if (this.isPinned) {
            const header = this.element.querySelector(".visage-selector-header");
            if (header) this._enableDragging(header);
        }
    }

    /* -------------------------------------------- */
    /* Event Listeners                             */
    /* -------------------------------------------- */

    _onToggleGlobal(_event, _target) {
        this.showPublic = !this.showPublic;
        VisageSelector.showPublic = this.showPublic;

        // Update the native window header icon directly via the DOM to avoid frozen options
        if (this.isWindowMode) {
            const btn = this.element.querySelector('.window-header [data-action="toggleGlobal"] .visage-icon');
            if (btn) {
                btn.className = `visage-icon ${this.showPublic ? "toggle_on" : "toggle_off"}`;
            }
        }

        this.render();
    }

    async _onTogglePin(_event, _target) {
        // 1. Capture physical screen coordinates
        const rect = this.element.getBoundingClientRect();
        const isBecomingWindow = !this.isWindowMode;

        // 2. Calculate smart width expansion to account for window padding
        let targetWidth = rect.width;
        let targetLeft = rect.left;

        if (isBecomingWindow) {
            const paddingCompensation = 40;
            targetWidth += paddingCompensation;

            // Find the Token HUD
            const tokenHud = document.getElementById("token-hud");
            if (tokenHud) {
                const hudRect = tokenHud.getBoundingClientRect();
                // If selector is on the left side of the Token HUD, shift the
                // starting 'left' coordinate so the added width grows outwards
                if (rect.left < hudRect.left) {
                    targetLeft -= paddingCompensation;
                }
            }
        }

        // 3. Build the options tree for the new instance
        const newOptions = {
            id: this.id,
            actorId: this.actorId,
            tokenId: this.tokenId,
            sceneId: this.sceneId,
            showPublic: this.showPublic,
            isWindowMode: isBecomingWindow,
            uiPosition: {
                left: targetLeft,
                top: isBecomingWindow ? Math.max(0, rect.top - 40) : rect.top,
                width: targetWidth,
                height: isBecomingWindow ? rect.height : "auto",
            },
        };

        // 4. Inject Window Configuration directly if pinning
        if (newOptions.isWindowMode) {
            newOptions.window = {
                frame: true,
                positioned: true,
                resizable: true,
                title: game.i18n.localize("VISAGE.Selector.Title"),
                icon: "visage-icon domino",
                controls: [
                    {
                        icon: `visage-icon ${this.showPublic ? "toggle_on" : "toggle_off"}`,
                        label: "VISAGE.Selector.TogglePublic",
                        action: "toggleGlobal",
                    },
                    {
                        icon: "visage-icon unpin",
                        label: "VISAGE.Selector.PinToggle",
                        action: "togglePin",
                    },
                    {
                        icon: "visage-icon config",
                        label: "VISAGE.Selector.Configure",
                        action: "openConfig",
                    },
                ],
            };
            // Seed the Position Manager
            newOptions.position = newOptions.uiPosition;
        }

        // 5. Close the current instance instantly and await it to clear the DOM
        await this.close({ animate: false });

        // 6. Spawn the new instance
        new VisageSelector(newOptions).render(true, { animate: false });
    }

    async _onSelectVisage(event, target) {
        const formKey = target.dataset.formKey;
        if (formKey) {
            if (formKey === "default") {
                const token = canvas.tokens.get(this.tokenId);
                const currentIdentity = token.document.getFlag(MODULE_ID, "identity");
                if (currentIdentity) await Visage.remove(this.tokenId, currentIdentity);
            } else {
                await Visage.apply(this.tokenId, formKey);
            }
            this.close();
        }
    }

    _onOpenConfig(_event, _target) {
        const appId = `visage-gallery-${this.actorId}-${this.tokenId}`;
        const existingApp = Object.values(ui.windows).find((app) => app.id === appId);

        if (existingApp) {
            existingApp.bringToFront();
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

    // Delegated to Controller
    async _onRevertGlobal(_event, _target) {
        await VisageStackController.revertGlobal(this.tokenId);
    }

    // Delegated to Controller
    async _onRemoveLayer(event, target) {
        await VisageStackController.removeLayer(this.tokenId, target.dataset.layerId);
    }

    // Delegated to Controller
    async _onToggleLayerVisibility(event, target) {
        await VisageStackController.toggleLayerVisibility(this.tokenId, target.dataset.layerId);
    }

    async close(options) {
        // 1. Remove Document Event Listener
        if (this._onDocPointerDown) {
            document.removeEventListener("pointerdown", this._onDocPointerDown, true);
            this._onDocPointerDown = null;
        }

        // 2. Automatically unhook everything registered by this UI
        for (const hook of this._activeHooks) {
            Hooks.off(hook.name, hook.id);
        }
        this._activeHooks = []; // Clear the registry

        return super.close(options);
    }

    /**
     * Handles Drag and Drop reordering using the shared controller.
     */
    _bindDragDrop() {
        const list = this.element.querySelector(".visage-sortable-list");
        VisageStackController.bindDragDrop(list, this.tokenId, () => this.render());
    }

    /**
     * Handles clicking a Quick Visage image.
     * Extracts the token's visual baseline, injects the new image, creates a local Identity Visage, and applies it.
     */
    async _onApplyAutoImage(event, target) {
        const path = target.dataset.path;
        const filename = target.dataset.name;

        const token = canvas.tokens.get(this.tokenId);
        if (!path || !token?.actor) return;

        // Extract current base visual state
        const baseState = VisageUtilities.extractVisualState(token.document);
        const autoMapSuffix = game.i18n.localize("VISAGE.Suffix.AutoMapped") || " (Quick Visage)";

        // 1. Generate the ID explicitly so we can reference it immediately
        const newId = foundry.utils.randomID(16);

        // Format the new Visage payload
        const payload = {
            id: newId,
            label: `${filename}${autoMapSuffix}`,
            mode: "identity", // Drops it into the top section
            changes: {
                ...baseState,
                texture: {
                    ...baseState.texture,
                    src: path,
                },
            },
        };

        // 2. Save the new Visage to the Actor's local library
        await VisageData.save(payload, token.actor);

        // 3. Command the core engine to immediately apply the newly created Visage
        await Visage.apply(this.tokenId, newId);

        ui.notifications.info(`Quick Visage applied: ${payload.label}`);

        // 4. Force the HUD to re-render so the new Visage appears in Section 1
        this.render();
    }
}
