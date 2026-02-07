/**
 * @file Main entry point for the Visage module.
 * Initializes the API, registers settings, and manages hooks for UI integration.
 * @module visage
 * @version 3.0.0
 */

import { Visage } from "./src/visage.js";
import { VisageSelector } from "./src/visage-selector.js";
import { VisageData } from "./src/visage-data.js"; 
import { VisageEditor } from "./src/visage-editor.js"; 
import { VisageGallery } from "./src/visage-gallery.js"; 
import { handleTokenHUD } from "./src/visage-hud.js";
import { cleanseSceneTokens, cleanseAllTokens } from "./src/visage-cleanup.js";
import { migrateWorldData } from "./src/visage-migration.js";
import { handleGhostEdit } from "./src/visage-ghost.js";
import { MODULE_ID } from "./src/visage-constants.js";
import { VisageSequencer } from "./src/visage-sequencer.js";
import { VisageSamples } from "./src/visage-samples.js";

/**
 * Singleton instance of the global gallery when opened via Scene Controls.
 * @type {VisageGallery|null}
 */
let globalDirectoryInstance = null;

/**
 * The semantic version number where the Data Structure changed (Unified Model).
 * Worlds on a version older than this will trigger the migration utility.
 * @constant {string}
 */
const NEEDS_MIGRATION_VERSION = "3.0.0";

/**
 * Opens the Visage Configuration window (Gallery) for a specific actor or token.
 * Handles duplicate window checks to bring existing windows to focus rather than
 * opening multiple instances for the same entity.
 * * @param {Actor} actor - The target actor document.
 * @param {TokenDocument|null} [token=null] - The specific token document, if applicable.
 */
function openVisageConfig(actor, token = null) {
    if (!actor) return;
    try {
        let tokenId = token?.id || null;
        let sceneId = token?.parent?.id || null;

        // If no specific token is provided but the actor is synthetic (unlinked), 
        // we must extract the token context from the actor itself.
        if (!tokenId && actor.isToken) {
            tokenId = actor.token.id;
            sceneId = actor.token.parent.id;
        }

        // Generate a unique App ID to prevent duplicate windows for the same entity.
        const appId = `visage-gallery-${actor.id}-${tokenId || "sidebar"}`;

        if (Visage.apps[appId]) {
            Visage.apps[appId].bringToTop();
            return;
        }

        new VisageGallery({
            actorId: actor.id,
            tokenId: tokenId,
            sceneId: sceneId,
            id: appId
        }).render(true);

    } catch (err) {
        console.error("Visage | Failed to open configuration window:", err);
    }
}

/**
 * Helper to extract the Actor ID from a DOM element (directory entry).
 * Supports both jQuery objects and native DOM elements.
 * * @param {jQuery|HTMLElement} li - The list item element from the sidebar.
 * @returns {string|undefined} The Actor ID, or undefined if not found.
 */
function getActorIdFromElement(li) {
    const element = (li instanceof jQuery) ? li[0] : li;
    return element.dataset?.entryId || element.dataset?.documentId;
}

/* -------------------------------------------- */
/* Initialization Hooks                        */
/* -------------------------------------------- */

/**
 * Initialization hook.
 * Sets up the API, registers Handlebars helpers, loads templates, and injects UI controls.
 */
Hooks.once("init", () => {
    try {
        Visage.initialize();
        VisageData.registerSettings();

        // Expose API classes to the global scope and module API for third-party integration.
        window.VisageData = VisageData;
        window.VisageEditor = VisageEditor;
        window.VisageGallery = VisageGallery;
        
        game.modules.get("visage").api.Data = VisageData;
        game.modules.get("visage").api.Editor = VisageEditor;
        game.modules.get("visage").api.Gallery = VisageGallery;

        // Register Handlebars helpers for logic and data formatting in templates
        Handlebars.registerHelper("visageNeq", (a, b) => a !== b);
        Handlebars.registerHelper("visageEq", (a, b) => a === b);
        Handlebars.registerHelper("visageSelected", (condition) => condition ? "selected" : "");
        Handlebars.registerHelper("visageJson", (context) => JSON.stringify(context));
        Handlebars.registerHelper("visagePercent", (value) => {
            const num = Number(value);
            if (isNaN(num)) return "0%";
            return `${Math.round(num * 100)}%`;
        });

        // Preload interface templates
        foundry.applications.handlebars.loadTemplates([
            "modules/visage/templates/visage-selector.hbs",
            "modules/visage/templates/visage-editor.hbs",
            "modules/visage/templates/visage-gallery.hbs",
            "modules/visage/templates/parts/visage-preview.hbs",
            "modules/visage/templates/parts/visage-card.hbs",
            "modules/visage/templates/parts/visage-effectCard.hbs",
            "modules/visage/templates/parts/visage-tile.hbs"
        ]);

        registerSettings();

        /**
         * Inject "Visage" option into the Actor Directory context menu.
         * Checks if the user is the owner of the actor before showing the option.
         * @param {Array} options - The context menu options array.
         */
        const addSidebarOption = (options) => {
            options.push({
                name: "VISAGE.Title",
                icon: '<i class="visage-icon-domino"></i>',
                condition: (li) => {
                    const documentId = getActorIdFromElement(li);
                    if (!documentId) return false;
                    const actor = game.actors.get(documentId);
                    return actor && actor.isOwner;
                },
                callback: (li) => {
                    const documentId = getActorIdFromElement(li);
                    const actor = game.actors.get(documentId);
                    if (actor) openVisageConfig(actor);
                }
            });
        };

        // Hook into both standard and enriched directory context menus
        Hooks.on("getActorContextOptions", (html, options) => addSidebarOption(options));
        Hooks.on("getActorDirectoryEntryContext", (html, options) => {
            // Prevent duplicate entries if other modules trigger this hook multiple times
            if (!options.some(o => o.name === "VISAGE.Title")) addSidebarOption(options);
        });

        /**
         * Inject Header Button into Legacy Actor Sheets (ApplicationV1).
         * @param {Object} sheet - The ActorSheet application.
         * @param {Array} buttons - The existing header buttons.
         */
        Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
            if (!sheet.actor.isOwner) return;
            buttons.unshift({
                label: "VISAGE.Title",
                class: "visage-config",
                icon: "visage-icon-domino",
                onclick: () => openVisageConfig(sheet.actor)
            });
        });

        /**
         * Inject Control Button into ApplicationV2 Actor Sheets.
         * Handles both `getHeaderControls` and `getActorSheetV2HeaderControls` for compatibility.
         * @param {Object} app - The ApplicationV2 instance.
         * @param {Array} controls - The controls array.
         */
        const addAppV2Control = (app, controls) => {
            const actor = app.document;
            if (!actor || !actor.isOwner) return;
            controls.push({
                label: "VISAGE.Title",
                icon: "visage-icon-domino",
                action: "visageConfigure",
                onClick: () => openVisageConfig(actor),
                order: 0
            });
        };

        // Enforce custom styling classes on tooltips generated by Visage elements
        document.addEventListener("pointerover", (event) => {
            const target = event.target.closest('[data-tooltip]');
            if (target && target.closest('.visage')) {
                if (!target.hasAttribute("data-tooltip-class")) {
                    target.setAttribute("data-tooltip-class", "visage-tooltip");
                }
            }
        }, { capture: true, passive: true });

        Hooks.on("getHeaderControlsActorSheetV2", addAppV2Control);
        Hooks.on("getActorSheetV2HeaderControls", addAppV2Control);

    } catch (err) {
        console.error("Visage | Initialization failed:", err);
    }
});

/* -------------------------------------------- */
/* Scene Controls                              */
/* -------------------------------------------- */

/**
 * Adds the Visage Gallery tool to the Scene Controls (Token Layer).
 * This allows GMs to access the global Visage directory.
 */
Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;

    // Locate the Token Layer controls.
    // Handles system-specific control structures (arrays vs objects).
    let tokenLayer = null;
    if (Array.isArray(controls)) tokenLayer = controls.find(c => c.name === "token");
    else {
        for (const key in controls) {
            const layer = controls[key];
            if (layer.name === "token" || layer.name === "tokens") {
                tokenLayer = layer;
                break;
            }
        }
    }

    if (!tokenLayer) return;

    const visageTool = {
        name: "visage-gallery", 
        title: "VISAGE.Directory.Title.Global", 
        icon: "visage-tool-icon",
        visible: true,
        toggle: false, 
        button: true,
        // Using onChange ensures compatibility with newer Foundry versions (V13+)
        onChange: () => {
            if (!globalDirectoryInstance) globalDirectoryInstance = new VisageGallery();
            globalDirectoryInstance.render(true);
        }
    };

    if (Array.isArray(tokenLayer.tools)) tokenLayer.tools.push(visageTool);
    else tokenLayer.tools["visage-gallery"] = visageTool;
});

/**
 * Registers global and world-scope settings for the module.
 * Includes debugging tools, cleanup utilities, and migration triggers.
 */
function registerSettings() {
    
    game.settings.registerMenu(MODULE_ID, "sampleManager", {
        name: "VISAGE.Settings.SampleManager.Name",
        label: "VISAGE.Settings.SampleManager.Label",
        hint: "VISAGE.Settings.SampleManager.Hint",
        icon: "visage-icon open",
        type: VisageSamples,
        restricted: true
    });

    game.settings.register(MODULE_ID, "disableWelcome", {
        name: "VISAGE.Settings.DisableWelcome.Name",
        hint: "VISAGE.Settings.DisableWelcome.Hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID, "cleanseScene", {
        name: "VISAGE.Settings.CleanseScene.Name",
        hint: "VISAGE.Settings.CleanseScene.Hint",
        scope: "world",
        config: true,
        restricted: true,
        type: Boolean,
        default: false,
        onChange: (value) => {
            if (value) {
                cleanseSceneTokens();
                // Reset toggle immediately after execution
                game.settings.set(MODULE_ID, "cleanseScene", false);
            }
        },
    });

    game.settings.register(MODULE_ID, "cleanseAll", {
        name: "VISAGE.Settings.CleanseAll.Name",
        hint: "VISAGE.Settings.CleanseAll.Hint",
        scope: "world",
        config: true,
        restricted: true,
        type: Boolean,
        default: false,
        onChange: (value) => {
            if (value) {
                cleanseAllTokens();
                game.settings.set(MODULE_ID, "cleanseAll", false);
            }
        },
    });

    // Hidden setting to track data versioning for auto-migrations
    game.settings.register(MODULE_ID, "worldVersion", {
        name: "World Data Version",
        scope: "world",
        config: false,
        type: String,
        default: "0.0.0"
    });

    // --- Manual Migration Trigger ---
    game.settings.register(MODULE_ID, "manualMigration", {
        name: "VISAGE.Settings.ManualMigration.Name",
        hint: "VISAGE.Settings.ManualMigration.Hint",
        scope: "world",
        config: true,
        restricted: true,
        type: Boolean,
        default: false,
        onChange: (value) => {
            if (value) {
                migrateWorldData();
                game.settings.set(MODULE_ID, "manualMigration", false);
            }
        }
    });
}

/* -------------------------------------------- */
/* Ready & Runtime Hooks                       */
/* -------------------------------------------- */

/**
 * Ready hook.
 * Performs environment checks, garbage collection, and data migration if necessary.
 */
Hooks.once("ready", async () => {
    if (!game.user.isGM) return;

    const lastVersion = game.settings.get(MODULE_ID, "worldVersion");
    const currentVersion = game.modules.get(MODULE_ID).version;

    const disableWelcome = game.settings.get(MODULE_ID, "disableWelcome");
        
    // RECENT MESSAGE GUARD
    // Look at the last 5 messages in the chat log
    const recentMessages = game.messages.contents.slice(-5);
    const alreadyPosted = recentMessages.some(m => 
        m.content.includes("visage-chat-card") && m.content.includes("https://foundryvtt.com/packages/visage")
    );

    if (!disableWelcome && !alreadyPosted) {

        const visageHtml = await renderTemplate("modules/visage/templates/parts/visage-chat-welcome.hbs", {
            version: currentVersion
        });

        await ChatMessage.create({
            user: game.user.id,
            content: visageHtml,
            whisper: [game.user.id],
            speaker: { alias: "Visage" }
        });
    }

    try {
        // Clean up deleted items older than retention period
        VisageData.runGarbageCollection();

        // Check if a migration is required based on the version difference
        if (foundry.utils.isNewerVersion(currentVersion, lastVersion)) {
            // Trigger data migration if the previous version is older than the schema change
            if (foundry.utils.isNewerVersion(NEEDS_MIGRATION_VERSION, lastVersion)) {
                console.log(`Visage | Detected legacy data (v${lastVersion}). Migrating to v${NEEDS_MIGRATION_VERSION}...`);
                
                // Await migration before updating version
                await migrateWorldData();
            }
            // Only update the version flag if migration succeeded
            await game.settings.set(MODULE_ID, "worldVersion", currentVersion);
        }
    } catch (err) {
        console.warn("Visage | Version check failed:", err);
    }
});

// Initialize application registry
Visage.apps = {};

/**
 * Tracks rendered Visage applications in the `Visage.apps` registry.
 * This allows singletons to be enforced by ID (e.g., prevent opening the same editor twice).
 * @param {Application} app - The application instance being rendered.
 */
Hooks.on("renderApplication", (app) => {
    if (app instanceof VisageSelector || 
        app instanceof VisageEditor ||
        app instanceof VisageGallery) {
        
        const appId = app.id || app.options?.id;
        if (appId) Visage.apps[appId] = app;
    }
});

/**
 * Removes closed Visage applications from the registry to allow re-opening.
 * @param {Application} app - The application instance being closed.
 */
Hooks.on("closeApplication", (app) => {
    if (app instanceof VisageSelector || 
        app instanceof VisageEditor ||
        app instanceof VisageGallery) {
        
        const appId = app.id || app.options?.id;
        if (appId && Visage.apps[appId]) delete Visage.apps[appId];
    }
});

/**
 * Handles Drag-and-Drop of Visage data onto the Canvas.
 * Supports applying a global visage to a specific token via drag.
 * * Uses dynamic imports to avoid circular dependencies during initial load.
 * * @param {Canvas} canvas - The canvas instance.
 * @param {Object} data - The dropped data object.
 */
Hooks.on("dropCanvasData", async (canvas, data) => {
    if (data.type !== "Visage" || !data.id) return;
    
    // Dynamic import required here because VisageData relies on initialization
    // occurring before it can be fully utilized in this context.
    const { VisageData } = await import("./src/visage-data.js");
    const { Visage } = await import("./src/visage.js");
    
    // Ensure the dropped ID is valid
    const visageData = VisageData.getGlobal(data.id); 
    if (!visageData) return;

    // Calculate intersection to find the token under the cursor
    const target = canvas.tokens.placeables.find(t => {
        return t.visible && 
               data.x >= t.x && data.x < t.x + t.w &&
               data.y >= t.y && data.y < t.y + t.h;
    });

    if (target) {
        await Visage.apply(target, data.id, { clearStack: false });
        ui.notifications.info(game.i18n.format("VISAGE.Notifications.Applied", { label: visageData.label }));
    }
});

// Intercept Token Config rendering to handle Ghost Edits (modifications to tokens with active Visages)
Hooks.on("renderTokenConfig", handleGhostEdit); 
Hooks.on("closeTokenConfig", (app) => { delete app._visageWarned; });

// Integrate with the Token HUD
Hooks.on("renderTokenHUD", handleTokenHUD);

// Monitor token updates to capture default state changes or maintain Visage persistence
Hooks.on("updateToken", (document, change, options, userId) => {
    Visage.handleTokenUpdate(document, change, options, userId);
});

/* -------------------------------------------- */
/* Cleanup Hooks                               */
/* -------------------------------------------- */

/**
 * Handle Token Deletion.
 * 1. Cleans up any active Sequencer effects (particles/sounds).
 * 2. If the token was Linked (Actor), reverts the Actor's portrait to its pre-Visage state.
 */
Hooks.on("deleteToken", async (tokenDoc, options, userId) => {
    // 1. Concurrency Control: Only the user who triggered the delete handles the cleanup
    // This prevents race conditions where 4 players delete a token and all 4 try to update the Actor.
    if (game.user.id !== userId) return;

    // 2. Clean up Sequencer Effects
    if (tokenDoc.object && Visage.sequencerReady) {
        VisageSequencer.revert(tokenDoc.object);
    }

    // 3. Revert Actor Portrait (Linked Tokens Only)
    if (tokenDoc.isLinked && tokenDoc.actorId) {
        const actor = game.actors.get(tokenDoc.actorId);
        if (!actor) return;

        const flags = tokenDoc.flags[MODULE_ID] || {};
        const originalPortrait = flags.originalState?.portrait;

        // Restore if we have a record of the original and it differs from current
        if (originalPortrait && actor.img !== originalPortrait) {
            console.log(`Visage | Reverting Actor Portrait for ${actor.name} upon token deletion.`);
            await actor.update({ img: originalPortrait });
        }
    }
});