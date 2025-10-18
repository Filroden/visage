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

// Keep stored defaults in sync with manual portrait/token changes
Hooks.on("updateActor", async (actor, changed) => {
  if (!actor?.isOwner) return;

  const ns = Visage.DATA_NAMESPACE;
  const mod = actor.flags?.[ns] || {};
  const isDefault = (mod.currentFormKey ?? "default") === "default";
  if (!isDefault) return;

  const updates = {};
  if (changed.img) {
    updates[`flags.${ns}.defaults.portrait`] = actor.img;
  }
  if (foundry.utils.getProperty(changed, "prototypeToken.texture.src") !== undefined) {
    updates[`flags.${ns}.defaults.token`] = actor.prototypeToken.texture.src;
  }

  if (Object.keys(updates).length) {
    await actor.update(updates); // flags-only, no loop (we only react to img/prototypeToken changes)
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