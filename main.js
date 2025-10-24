import { Visage } from "./visage.js";
import { VisageSelector } from "./visage-selector.js";
// Import the new config app
import { VisageConfigApp } from "./visage-config.js";
import { handleTokenHUD } from "./visage-hud.js";
import { cleanseSceneTokens, cleanseAllTokens } from "./visage-cleanup.js";

/**
 * Hook to initialize the module once the game is ready.
 */
Hooks.once("init", () => {
    Visage.initialize();

    game.settings.register("visage", "cleanseScene", {
        name: "[GM Only] Remove all Visage-related data from tokens on current scene",
        hint: "When you check this box and save, you will be asked for confirmation to remove Visage data from tokens in the current scene. This action cannot be undone.",
        scope: "world",
        config: true,
        restricted: true,
        type: Boolean,
        default: false,
        onChange: (value) => {
            if (value) {
                Dialog.confirm({
                    title: "Confirm Data Cleanse",
                    content: "<p>Are you sure you want to remove all Visage data from tokens on the <strong>current scene</strong>? This action cannot be undone.</p>",
                    yes: () => cleanseSceneTokens(),
                    no: () => ui.notifications.warn("Visage | Data cleanse cancelled."),
                    defaultYes: false
                }).finally(() => {
                    game.settings.set("visage", "cleanseScene", false);
                });
            }
        },
    });

    game.settings.register("visage", "cleanseAll", {
        name: "[GM Only] Remove all Visage-related data from tokens in all scenes",
        hint: "When you check this box and save, you will be asked for confirmation to remove Visage data from tokens in ALL scenes. This action cannot be undone.",
        scope: "world",
        config: true,
        restricted: true,
        type: Boolean,
        default: false,
        onChange: (value) => {
            if (value) {
                Dialog.confirm({
                    title: "Confirm Data Cleanse",
                    content: "<p>Are you sure you want to remove all Visage data from tokens in <strong>all scenes</strong>? This action cannot be undone.</p>",
                    yes: () => cleanseAllTokens(),
                    no: () => ui.notifications.warn("Visage | Data cleanse cancelled."),
                    defaultYes: false
                }).finally(() => {
                    game.settings.set("visage", "cleanseAll", false);
                });
            }
        },
    });
});

// Add a static property to the Visage class to track open apps.
Visage.apps = {};

/**
 * Hook to register the application when rendered.
 */
Hooks.on("renderApplication", (app, html, data) => {
    if (app instanceof VisageSelector || app instanceof VisageConfigApp) {
        Visage.apps[app.options.id] = app;
    }
});

/**
 * Hook to unregister the application when closed.
 */
Hooks.on("closeApplication", (app) => {
    if (app instanceof VisageSelector || app instanceof VisageConfigApp) {
        delete Visage.apps[app.options.id];
    }
});

/**
 * Hook for the Token HUD.
 * Delegates all logic to the dedicated handler.
 */
Hooks.on("renderTokenHUD", handleTokenHUD);

/**
 * Hook for pre-updating a Token.
 * Delegates to the Visage class to handle default data updates.
 */
Hooks.on("preUpdateToken", (document, change, options, userId) => {
    Visage.handleTokenUpdate(document, change, options, userId);
});