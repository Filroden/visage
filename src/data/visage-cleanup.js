import { DATA_NAMESPACE } from "../core/visage-constants.js";

/**
 * Maps the original state snapshot back to a Foundry update payload.
 * @private
 */
function _populateRevertData(updates, original) {
    if (!original) return;

    // 1. Map Nested Texture Properties
    const t = original.texture || {};
    if (t.src) updates["texture.src"] = t.src;
    if (t.scaleX !== undefined) updates["texture.scaleX"] = t.scaleX;
    if (t.scaleY !== undefined) updates["texture.scaleY"] = t.scaleY;

    // 2. Map Standard Root Properties
    const rootKeys = ["width", "height", "depth", "ring", "light", "name", "displayName", "disposition"];
    for (const key of rootKeys) {
        if (original[key] !== undefined) updates[key] = original[key];
    }
}

/**
 * Generates the update data required to revert a token to its original state.
 * @param {TokenDocument} token - The token document to revert.
 * @returns {Promise<Object|null>} An update object compatible with updateEmbeddedDocuments, or null if no Visage data exists.
 */
async function getRevertData(token) {
    const flags = token.flags?.[DATA_NAMESPACE];
    if (!flags) return null;

    const updates = {
        _id: token.id,
        [`flags.-=${DATA_NAMESPACE}`]: null,
    };

    _populateRevertData(updates, flags.originalState);

    return updates;
}

/**
 * Cleanses all tokens in the CURRENT SCENE.
 * Useful for fixing a specific map without affecting the rest of the world.
 * @returns {Promise<void>}
 */
export async function cleanseSceneTokens() {
    if (!canvas.scene) return;
    const tokenUpdates = [];
    let count = 0;

    // Batch updates to minimize database transactions
    for (const token of canvas.scene.tokens) {
        if (token.flags?.[DATA_NAMESPACE]) {
            const revertUpdate = await getRevertData(token);
            if (revertUpdate) {
                tokenUpdates.push(revertUpdate);
                count++;
            }
        }
    }

    if (tokenUpdates.length > 0) {
        await canvas.scene.updateEmbeddedDocuments("Token", tokenUpdates);
        ui.notifications.info(
            game.i18n.format("VISAGE.Notifications.CleanupScene", {
                count: count,
            }),
        );
    } else {
        ui.notifications.info(game.i18n.localize("VISAGE.Notifications.CleanupSceneEmpty"));
    }
}

/**
 * Cleanses all tokens and unlinked actors within a specific scene.
 * @private
 */
async function _cleanseSceneTokensAndUnlinked(scene) {
    let count = 0;
    const tokenUpdates = [];
    const unlinkedPromises = [];

    for (const token of scene.tokens) {
        // A. Unlinked Actor Cleanup (Synthetic Actors)
        if (!token.actorLink && token.actor?.flags?.[DATA_NAMESPACE]) {
            unlinkedPromises.push(token.actor.update({ [`flags.-=${DATA_NAMESPACE}`]: null }));
        }

        // B. Token Cleanup (Revert Appearance)
        if (token.flags?.[DATA_NAMESPACE]) {
            const revertUpdate = await getRevertData(token);
            if (revertUpdate) {
                tokenUpdates.push(revertUpdate);
                count++;
            }
        }
    }

    if (unlinkedPromises.length > 0) await Promise.all(unlinkedPromises);
    if (tokenUpdates.length > 0) await scene.updateEmbeddedDocuments("Token", tokenUpdates);

    return count;
}

/**
 * Cleanses all linked actors residing in the game's sidebar directory.
 * @private
 */
async function _cleanseSidebarActors() {
    const sidebarActorUpdates = [];
    for (const actor of game.actors) {
        if (actor.flags?.[DATA_NAMESPACE]) {
            sidebarActorUpdates.push({
                _id: actor.id,
                [`flags.-=${DATA_NAMESPACE}`]: null,
            });
        }
    }

    if (sidebarActorUpdates.length > 0) {
        await Actor.updateDocuments(sidebarActorUpdates);
    }

    return sidebarActorUpdates.length;
}

/**
 * Cleanses ALL tokens and actors in the WORLD.
 * This is a "Nuclear Option" for removing Visage data from entities.
 * @returns {Promise<void>}
 */
export async function cleanseAllTokens() {
    ui.notifications.info(game.i18n.localize("VISAGE.Notifications.CleanupGlobalStart"));
    let count = 0;

    // 1. Iterate over every Scene (Handle Tokens & Unlinked Actors)
    for (const scene of game.scenes) {
        count += await _cleanseSceneTokensAndUnlinked(scene);
    }

    // 2. Clean Actors in the Sidebar (Handle Linked Actors)
    count += await _cleanseSidebarActors();

    ui.notifications.info(game.i18n.format("VISAGE.Notifications.CleanupGlobalSuccess", { count }));
}

/**
 * SanitizeR: Selected Tokens
 * Rebuilds corrupted light schemas and resets Visage state snapshots for selected tokens.
 */
export async function sanitizeSelectedTokensLight() {
    const tokens = canvas.tokens.controlled;

    if (tokens.length === 0) {
        return ui.notifications.warn(game.i18n.localize("VISAGE.Notifications.SanitizeSelectWarning"));
    }

    const confirm = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("VISAGE.Dialog.SanitizeSelected.Title") },
        content: game.i18n.localize("VISAGE.Dialog.SanitizeSelected.Content"),
        modal: true,
    });

    if (!confirm) return;

    let successCount = 0;
    let skippedCount = 0;
    const updates = [];

    for (const token of tokens) {
        const doc = token.document;
        const defaultLight = doc.schema.fields.light.getInitialValue();
        const currentLight = doc.light?.toObject?.() ?? doc.light ?? {};

        const sanitizedLight = foundry.utils.mergeObject(defaultLight, currentLight, {
            insertKeys: false,
            insertValues: true,
            overwrite: true,
            inplace: false,
        });

        const hasLingeringFlag = doc.getFlag(DATA_NAMESPACE, "originalState") !== undefined;
        const isLightCorrupted = !foundry.utils.equals(currentLight, sanitizedLight);

        if (!hasLingeringFlag && !isLightCorrupted) {
            skippedCount++;
            continue;
        }

        const updateData = { _id: doc.id };

        if (isLightCorrupted) {
            updateData.light = sanitizedLight;
        }

        if (hasLingeringFlag) {
            updateData[`flags.${DATA_NAMESPACE}.originalState`] = new foundry.data.operators.ForcedDeletion();
        }

        updates.push(updateData);
    }

    if (updates.length > 0) {
        await canvas.scene.updateEmbeddedDocuments("Token", updates);
        successCount = updates.length;
        ui.notifications.info(game.i18n.format("VISAGE.Notifications.SanitizeSelectedSuccess", { successCount, skippedCount }));
    } else {
        ui.notifications.info(game.i18n.format("VISAGE.Notifications.SanitizeSelectedClean", { skippedCount }));
    }
}

/**
 * Internal helper to sanitize lights for all tokens on a specific scene.
 * @private
 */
async function _sanitizeSceneTokensLight(scene) {
    const updates = [];
    let skipped = 0;

    for (const tokenDoc of scene.tokens) {
        const defaultLight = tokenDoc.schema.fields.light.getInitialValue();
        const currentLight = tokenDoc.light?.toObject?.() ?? tokenDoc.light ?? {};

        const sanitizedLight = foundry.utils.mergeObject(defaultLight, currentLight, {
            insertKeys: false,
            insertValues: true,
            overwrite: true,
            inplace: false,
        });

        const hasLingeringFlag = tokenDoc.getFlag(DATA_NAMESPACE, "originalState") !== undefined;
        const isLightCorrupted = !foundry.utils.equals(currentLight, sanitizedLight);

        if (!hasLingeringFlag && !isLightCorrupted) {
            skipped++;
            continue;
        }

        const updateData = { _id: tokenDoc.id };

        if (isLightCorrupted) {
            updateData.light = sanitizedLight;
        }

        if (hasLingeringFlag) {
            updateData[`flags.${DATA_NAMESPACE}.originalState`] = new foundry.data.operators.ForcedDeletion();
        }

        updates.push(updateData);
    }

    if (updates.length > 0) {
        await scene.updateEmbeddedDocuments("Token", updates);
    }

    return { fixed: updates.length, skipped };
}

/**
 * Internal helper to sanitize prototype token lights for all actors in the sidebar.
 * @private
 */
async function _sanitizeSidebarActorsLight() {
    const updates = [];
    let skipped = 0;

    for (const actor of game.actors) {
        const proto = actor.prototypeToken;
        if (!proto) continue;

        const defaultLight = proto.schema.fields.light.getInitialValue();
        const currentLight = proto.light?.toObject?.() ?? proto.light ?? {};

        const sanitizedLight = foundry.utils.mergeObject(defaultLight, currentLight, {
            insertKeys: false,
            insertValues: true,
            overwrite: true,
            inplace: false,
        });

        const hasLingeringFlag = proto.getFlag(DATA_NAMESPACE, "originalState") !== undefined;
        const isLightCorrupted = !foundry.utils.equals(currentLight, sanitizedLight);

        if (!hasLingeringFlag && !isLightCorrupted) {
            skipped++;
            continue;
        }

        const updateData = { _id: actor.id };

        if (isLightCorrupted) {
            // Flatten the key to ensure safe database injection on the actor document
            updateData["prototypeToken.light"] = sanitizedLight;
        }

        if (hasLingeringFlag) {
            updateData[`prototypeToken.flags.${DATA_NAMESPACE}.originalState`] = new foundry.data.operators.ForcedDeletion();
        }

        updates.push(updateData);
    }

    if (updates.length > 0) {
        await Actor.updateDocuments(updates);
    }

    return { fixed: updates.length, skipped };
}

/**
 * SanitizeR: All World Tokens (Nuclear Option)
 * Rebuilds corrupted light schemas and resets Visage state snapshots for EVERY token and actor in the world.
 */
export async function sanitizeAllTokensLight() {
    const confirm = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("VISAGE.Dialog.SanitizeWorld.Title") },
        content: game.i18n.localize("VISAGE.Dialog.SanitizeWorld.Content"),
        modal: true,
    });

    if (!confirm) return;

    ui.notifications.info(game.i18n.localize("VISAGE.Notifications.SanitizeWorldStart"));

    let totalFixed = 0;
    let totalSkipped = 0;

    // 1. Process all canvas tokens across all scenes
    for (const scene of game.scenes) {
        const result = await _sanitizeSceneTokensLight(scene);
        totalFixed += result.fixed;
        totalSkipped += result.skipped;
    }

    // 2. Process all prototype tokens in the actor sidebar
    const sidebarResult = await _sanitizeSidebarActorsLight();
    totalFixed += sidebarResult.fixed;
    totalSkipped += sidebarResult.skipped;

    if (totalFixed > 0) {
        ui.notifications.info(game.i18n.format("VISAGE.Notifications.SanitizeWorldSuccess", { successCount: totalFixed, skippedCount: totalSkipped }));
    } else {
        ui.notifications.info(game.i18n.format("VISAGE.Notifications.SanitizeWorldClean", { skippedCount: totalSkipped }));
    }
}
