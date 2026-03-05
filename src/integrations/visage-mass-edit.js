import { Visage } from "../core/visage.js";
import { DATA_NAMESPACE } from "../core/visage-constants.js";

/**
 * Handles compatibility with the Mass Edit module to prevent token base data corruption.
 */
export class VisageMassEdit {
    static pendingRestores = new Map();
    static isPrompting = false;
    static isClosing = false;
    static forceCloseTime = 0; // Timestamp shield

    static initialize() {
        Hooks.on("renderMassTokenConfig", this._onRenderMassEdit.bind(this));
        Hooks.on("renderTokenConfig", this._onRenderMassEdit.bind(this));
        Hooks.on("closeMassTokenConfig", this._onCloseMassEdit.bind(this));
        Hooks.on("closeTokenConfig", this._onCloseMassEdit.bind(this));
    }

    /**
     * Intercepts Mass Edit rendering. Prompts GM to revert tokens to protect base data.
     */
    static async _onRenderMassEdit(app, html, data) {
        const isMassEdit =
            app.constructor.name.includes("Mass") ||
            app.options?.id?.includes("mass");
        if (!isMassEdit) return;

        if (this.isPrompting) return;

        // 1. Target Extraction (Prioritize Mass Edit's internal arrays)
        let targetDocs = [];
        if (Array.isArray(app.meObjects) && app.meObjects.length > 0) {
            targetDocs = app.meObjects.map((t) => t.document || t);
        } else if (Array.isArray(app.targets) && app.targets.length > 0) {
            targetDocs = app.targets.map((t) => t.document || t);
        } else if (canvas.tokens?.controlled?.length > 0) {
            targetDocs = canvas.tokens.controlled.map((t) => t.document);
        }

        // 2. Identify if any targeted tokens are wearing a Visage
        const visagedDocs = targetDocs.filter((doc) => {
            if (!doc?.getFlag) return false;
            const stack = doc.getFlag(DATA_NAMESPACE, "activeStack");
            const identity = doc.getFlag(DATA_NAMESPACE, "identity");
            return (stack && stack.length > 0) || identity;
        });

        if (visagedDocs.length === 0) return;

        this.isPrompting = true;

        try {
            const confirm = await foundry.applications.api.DialogV2.confirm({
                window: {
                    title: game.i18n.localize("VISAGE.MassEdit.InterceptTitle"),
                },
                content: game.i18n.format("VISAGE.MassEdit.InterceptContent", {
                    count: visagedDocs.length,
                }),
                classes: ["visage-dialog-compact"],
                modal: true,
            });

            if (confirm) {
                // Activate a 1-second invulnerability shield against close hooks
                this.forceCloseTime = Date.now();

                // Force Close Mass Edit to purge stale disguise data
                app.close();

                ui.notifications.info(
                    game.i18n.localize(
                        "VISAGE.Notifications.MassEditReverting",
                    ),
                );

                for (const doc of visagedDocs) {
                    const identity = doc.getFlag(DATA_NAMESPACE, "identity");
                    const activeStack = foundry.utils.deepClone(
                        doc.getFlag(DATA_NAMESPACE, "activeStack") || [],
                    );

                    this.pendingRestores.set(doc.id, { identity, activeStack });

                    // Revert the token
                    await Visage.revert(doc.object || doc.id);
                }

                ui.notifications.info(
                    game.i18n.localize("VISAGE.Notifications.MassEditReverted"),
                );
            } else {
                ui.notifications.warn(
                    game.i18n.localize("VISAGE.Warnings.MassEditActive"),
                    { permanent: true },
                );
            }
        } finally {
            this.isPrompting = false;
        }
    }

    static async forceRestore() {
        if (this.pendingRestores.size === 0) {
            ui.notifications.warn("Visage | No pending restorations found.");
            return;
        }

        ui.notifications.info(
            game.i18n.localize("VISAGE.Notifications.MassEditRestoring"),
        );

        for (const [tokenId, savedState] of this.pendingRestores.entries()) {
            const token = canvas.tokens.get(tokenId);
            if (!token) continue;

            if (savedState.identity) {
                await Visage.apply(token, savedState.identity, {
                    switchIdentity: true,
                    clearStack: true,
                });
            }

            const overlays = savedState.activeStack.filter(
                (layer) => layer.id !== savedState.identity,
            );
            for (const overlay of overlays) {
                await Visage.apply(token, overlay.id, {
                    switchIdentity: false,
                    clearStack: false,
                });
            }
        }

        ui.notifications.info(
            game.i18n.localize("VISAGE.Notifications.MassEditRestored"),
        );
        this.pendingRestores.clear();
    }

    /**
     * Intercepts Mass Edit closing. Prompts GM to restore the removed Visages.
     */
    static async _onCloseMassEdit(app, html) {
        const isMassEdit =
            app.constructor.name.includes("Mass") ||
            app.options?.id?.includes("mass");
        if (!isMassEdit) return;

        // If this close event fired within 1000ms of us forcing the window closed, ignore it completely
        if (Date.now() - this.forceCloseTime < 1000) return;

        if (this.pendingRestores.size === 0) return;

        // This existing lock protects against the natural double-hook when the GM genuinely closes the window
        if (this.isClosing) return;
        this.isClosing = true;

        try {
            const confirm = await foundry.applications.api.DialogV2.confirm({
                window: {
                    title: game.i18n.localize("VISAGE.MassEdit.CompleteTitle"),
                },
                content: game.i18n.localize("VISAGE.MassEdit.CompleteContent"),
                classes: ["visage-dialog-compact"],
                modal: true,
            });

            if (confirm) {
                await this.forceRestore();
            }
        } finally {
            this.pendingRestores.clear();
            this.isClosing = false;
        }
    }
}
