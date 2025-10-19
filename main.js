import { Visage } from "./visage.js";
import { VisageSelector } from "./visage-selector.js";
import { handleTokenConfig } from "./visage-config.js";
import { handleTokenHUD } from "./visage-hud.js";

/**
 * Hook to initialize the module once the game is ready.
 */
Hooks.once("init", () => {
    Visage.initialize();
});

// Add a static property to the Visage class to track open apps.
Visage.apps = {};

/**
 * Hook to register the application when rendered.
 */
Hooks.on("renderApplication", (app, html, data) => {
    if (app instanceof VisageSelector) {
        Visage.apps[app.options.id] = app;
    }
});

/**
 * Hook to unregister the application when closed.
 */
Hooks.on("closeApplication", (app) => {
    if (app instanceof VisageSelector) {
        delete Visage.apps[app.options.id];
    }
});

/**
 * Hook for the Token HUD.
 * Delegates all logic to the dedicated handler.
 */
Hooks.on("renderTokenHUD", handleTokenHUD);

/**
 * Hook for the Token Configuration.
 * Delegates all logic to the dedicated handler.
 */
Hooks.on('renderTokenConfig', handleTokenConfig);

/**
 * Hook for pre-updating a Token.
 * Delegates to the Visage class to handle default data updates.
 */
Hooks.on("preUpdateToken", (tokenDocument, change) => {
    Visage.handleTokenUpdate(tokenDocument, change);
});