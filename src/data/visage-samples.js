import { MODULE_ID } from "../core/visage-constants.js";
import { VisageData } from "./visage-data.js";
import { cleanVisageData } from "./visage-migration.js";
import { VisageUtilities } from "../utils/visage-utilities.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class VisageSamples extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        tag: "form",
        id: "visage-samples",
        classes: ["visage", "visage-settings"],
        window: {
            title: "VISAGE.Samples.Title", // Key used here
            icon: "visage-icon open",
            resizable: false,
        },
        position: { height: "auto" },
        form: {
            handler: VisageSamples.prototype._onSubmit,
            closeOnSubmit: true,
        },
    };

    static PARTS = {
        form: {
            template: "modules/visage/templates/visage-samples.hbs",
        },
    };

    // Define available packs here.
    // The 'filename' must match the files in the samples folder.
    static PACKS = [
        {
            id: "lights",
            label: "VISAGE.Samples.Pack.Lights.Label",
            filename: "overlays_light_sources.json",
            desc: "VISAGE.Samples.Pack.Lights.Desc",
        },
        {
            id: "sizes",
            label: "VISAGE.Samples.Pack.Sizes.Label",
            filename: "overlays_token_size.json",
            desc: "VISAGE.Samples.Pack.Sizes.Desc",
        },
        {
            id: "scale",
            label: "VISAGE.Samples.Pack.Scale.Label",
            filename: "overlays_image_scale.json",
            desc: "VISAGE.Samples.Pack.Scale.Desc",
        },
        {
            id: "orientation",
            label: "VISAGE.Samples.Pack.Orientation.Label",
            filename: "overlays_image_orientation.json",
            desc: "VISAGE.Samples.Pack.Orientation.Desc",
        },
        {
            id: "dispositions",
            label: "VISAGE.Samples.Pack.Dispositions.Label",
            filename: "overlays_dispositions.json",
            desc: "VISAGE.Samples.Pack.Dispositions.Desc",
        },
        {
            id: "rotation",
            label: "VISAGE.Samples.Pack.Rotation.Label",
            filename: "overlays_rotation_lock.json",
            desc: "VISAGE.Samples.Pack.Rotation.Desc",
        },
    ];

    /**
     * Ensure the title is localised properly.
     */
    get title() {
        return game.i18n.localize("VISAGE.Samples.Title");
    }

    async _prepareContext(options) {
        return {
            packs: VisageSamples.PACKS,
        };
    }

    _onRender(context, options) {
        VisageUtilities.applyVisageTheme(this.element, false);
    }

    /**
     * Handles the form submission.
     * Iterates over selected packs, fetches the JSON (with lang fallback), and imports data.
     */
    async _onSubmit(event, form, formData) {
        const selectedIds = Object.keys(formData.object).filter(
            (k) => formData.object[k],
        );

        if (selectedIds.length === 0) {
            return ui.notifications.warn(
                game.i18n.localize("VISAGE.Notifications.Samples.NoneSelected"),
            );
        }

        let totalImported = 0;
        let totalSkipped = 0;

        ui.notifications.info(
            game.i18n.localize("VISAGE.Notifications.Samples.Start"),
        );

        for (const packId of selectedIds) {
            const packDef = VisageSamples.PACKS.find((p) => p.id === packId);
            if (!packDef) continue;

            try {
                // 1. Fetch Data
                const data = await this._fetchPackData(packDef.filename);

                // 2. Import Loop (Reusing logic from VisageGallery)
                // We use VisageData.globals because these are global presets
                const currentIds = new Set(VisageData.globals.map((i) => i.id));

                for (const entry of data) {
                    const cleanEntry = cleanVisageData(entry);
                    if (!cleanEntry.id || !cleanEntry.changes) continue;

                    // Skip duplicates based on ID to prevent overwriting user edits
                    if (currentIds.has(cleanEntry.id)) {
                        totalSkipped++;
                        continue;
                    }

                    if (cleanEntry.label) {
                        cleanEntry.label = game.i18n.localize(cleanEntry.label);
                    }

                    if (cleanEntry.category) {
                        cleanEntry.category = game.i18n.localize(
                            cleanEntry.category,
                        );
                    }

                    await VisageData.save(cleanEntry, null); // null actor = Global
                    totalImported++;
                }
            } catch (err) {
                console.error(
                    `Visage | Failed to import pack ${packDef.id}:`,
                    err,
                );
                ui.notifications.error(
                    game.i18n.format("VISAGE.Notifications.Samples.Error", {
                        label: game.i18n.localize(packDef.label),
                    }),
                );
            }
        }

        ui.notifications.info(
            game.i18n.format("VISAGE.Notifications.Samples.Complete", {
                added: totalImported,
                skipped: totalSkipped,
            }),
        );
    }

    /**
     * SImple Pack Fetch
     */
    async _fetchPackData(filename) {
        const path = `modules/${MODULE_ID}/sample_overlays/${filename}`;
        const response = await fetch(path);

        if (!response.ok) throw new Error(`Could not find file: ${filename}`);
        return await response.json();
    }
}
