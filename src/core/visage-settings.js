import { MODULE_ID } from "./visage-constants.js";
import { VisageSamples } from "../data/visage-samples.js";
import { VisageUtilities } from "../utils/visage-utilities.js";
import { cleanseSceneTokens, cleanseAllTokens } from "../data/visage-cleanup.js";
import { migrateWorldData } from "../data/visage-migration.js";

export class VisageSettings {
    static register() {
        game.settings.registerMenu(MODULE_ID, "sampleManager", {
            name: "VISAGE.Settings.SampleManager.Name",
            label: "VISAGE.Settings.SampleManager.Label",
            hint: "VISAGE.Settings.SampleManager.Hint",
            icon: "visage-icon open",
            type: VisageSamples,
            restricted: true,
        });

        // Register Diagnostic Export Menu Button
        game.settings.registerMenu(MODULE_ID, "exportDiagnostics", {
            name: "VISAGE.Settings.ExportLog.Name",
            hint: "VISAGE.Settings.ExportLog.Hint",
            label: "VISAGE.Settings.ExportLog.Label",
            type: class extends foundry.applications.api.ApplicationV2 {
                render(_force, _options) {
                    VisageUtilities.exportDiagnostics();
                    return this;
                }
            },
            restricted: false,
        });

        // --- Auto-Mapped Image Settings ---
        // Hidden Cache Setting
        game.settings.register(MODULE_ID, "autoImageCache", {
            name: "Auto Image Cache",
            scope: "world",
            config: false,
            type: Array,
            default: [],
        });

        // The Directory Setting with Validation
        game.settings.register(MODULE_ID, "autoImageDirectory", {
            name: "VISAGE.Settings.AutoImageDirectory.Name",
            hint: "VISAGE.Settings.AutoImageDirectory.Hint",
            scope: "world",
            config: true,
            type: String,
            default: "",
            filePicker: "folder",
            onChange: async (newPath) => {
                if (!newPath) {
                    ui.notifications.warn(game.i18n.localize("VISAGE.Notifications.AutoMapCleared"));
                    await game.settings.set(MODULE_ID, "autoImageCache", []); // Clear the cache
                    return;
                }

                try {
                    const FilePickerClass = foundry.applications?.apps?.FilePicker || FilePicker;
                    await FilePickerClass.browse("data", newPath);
                    ui.notifications.info(game.i18n.format("VISAGE.Notifications.AutoMapUpdated", { path: newPath }));

                    // Automatically trigger the crawler when a valid new folder is set
                    VisageUtilities.buildAutoImageCache(newPath);
                } catch (err) {
                    console.warn("Visage | Auto-Image Directory validation failed:", err);
                    ui.notifications.error(game.i18n.localize("VISAGE.Notifications.AutoMapError"));
                }
            },
        });

        // The Manual Rebuild Button
        game.settings.registerMenu(MODULE_ID, "rebuildAutoImageCache", {
            name: "VISAGE.Settings.RebuildCache.Name",
            hint: "VISAGE.Settings.RebuildCache.Hint",
            label: "VISAGE.Settings.RebuildCache.Label",
            icon: "visage-icon refresh",
            type: class extends foundry.applications.api.ApplicationV2 {
                render(_force, _options) {
                    const dir = game.settings.get(MODULE_ID, "autoImageDirectory");
                    if (dir) {
                        // Dynamically import to avoid circular dependencies in settings registration
                        import("../utils/visage-utilities.js").then((module) => {
                            module.VisageUtilities.buildAutoImageCache(dir);
                        });
                    } else {
                        ui.notifications.warn(game.i18n.localize("VISAGE.Notifications.AutoMapMissingDirectory"));
                    }
                    return this; // Prevent a blank window from opening
                }
            },
            restricted: true,
        });

        // --- System Override Setting ---
        game.settings.register(MODULE_ID, "allowSystemOverrides", {
            name: "VISAGE.Settings.AllowSystemOverrides.Name",
            hint: "VISAGE.Settings.AllowSystemOverrides.Hint",
            scope: "world",
            config: true,
            type: Boolean,
            default: true,
        });

        // --- Misc Settings ---
        game.settings.register(MODULE_ID, "disableWelcome", {
            name: "VISAGE.Settings.DisableWelcome.Name",
            hint: "VISAGE.Settings.DisableWelcome.Hint",
            scope: "world",
            config: true,
            type: Boolean,
            default: false,
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
            default: "0.0.0",
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
            },
        });

        // --- Time & Calendar Settings ---
        game.settings.register(MODULE_ID, "hoursPerDay", {
            name: "VISAGE.Settings.HoursPerDay.Name",
            hint: "VISAGE.Settings.HoursPerDay.Hint",
            scope: "world",
            config: true,
            type: Number,
            default: 24,
        });

        game.settings.register(MODULE_ID, "minutesPerHour", {
            name: "VISAGE.Settings.MinutesPerHour.Name",
            hint: "VISAGE.Settings.MinutesPerHour.Hint",
            scope: "world",
            config: true,
            type: Number,
            default: 60,
        });
    }
}
