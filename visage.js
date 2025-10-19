/**
 * Main class for the Visage module.
 *
 * This class handles the initialization of the module, setting up the API,
 * and registering any necessary hooks.
 */
export class Visage {
    /**
     * The ID of the module.
     * @type {string}
     */
    static MODULE_ID = "visage";

    /**
     * The developer's preferred namespace for storing module data.
     * @type {string}
     */
    static DATA_NAMESPACE = "visage";

    /**
     * A helper for logging messages to the console.
     * @param {string} message - The message to log.
     * @param {boolean} force - Whether to force the message to be logged, regardless of debug settings.
     */
    static log(message, force = false) {
        const shouldLog = force || game.modules.get('_dev-mode')?.api?.getPackageDebugValue(this.MODULE_ID);
        if (shouldLog) {
            console.log(`${this.MODULE_ID} | ${message}`);
        }
    }

    /**
     * Resolves a path that may contain wildcards to a single, concrete file path.
     * @param {string} path - The path to resolve.
     * @returns {Promise<string>} - The resolved file path.
     */
    static async resolvePath(path) {
        if (!path || !path.includes('*')) return path;
        try {
            const browseOptions = { wildcard: true };
            let source = "data";
            if (/\.s3\./.test(path)) {
                source = 's3';
                const { bucket, keyPrefix } = foundry.applications.apps.FilePicker.implementation.parseS3URL(path);
                if (bucket) {
                    browseOptions.bucket = bucket;
                    path = keyPrefix;
                }
            } else if (path.startsWith('icons/')) {
                source = 'public';
            }
            const content = await foundry.applications.apps.FilePicker.implementation.browse(source, path, browseOptions);
            if (content.files.length) {
                return content.files[Math.floor(Math.random() * content.files.length)];
            }
        } catch (err) {
            this.log(`Error resolving wildcard path: ${path} | ${err}`, true);
        }
        return path;
    }

    /**
     * Initializes the module and sets up the public API.
     */
    static initialize() {
        this.log("Initializing Visage");

        // Expose the public API.
        game.modules.get(this.MODULE_ID).api = {
            setVisage: this.setVisage.bind(this),
            getForms: this.getForms.bind(this),
            isFormActive: this.isFormActive.bind(this),
            resolvePath: this.resolvePath.bind(this)
        };
    }

    /**
     * Hook handler for preUpdateToken.
     *
     * This function is registered to the 'preUpdateToken' hook and is responsible for
     * automatically updating the module's default name and token image whenever the
     * user saves changes on the main Token Configuration form.
     *
     * @param {TokenDocument} tokenDocument - The token document being updated.
     * @param {object} change - The differential data that is being applied to the document.
     * @param {object} options - Additional options which modify the update request.
     */
    static handleTokenUpdate(tokenDocument, change, options) {
        // If the update is coming from our own module, do not proceed.
        if (options.visageUpdate) return;

        const actor = tokenDocument.actor;
        if (!actor) return;

        const hasChangedName = "name" in change;
        const hasChangedTexture = "texture" in change && "src" in change.texture;

        if (hasChangedName || hasChangedTexture) {
            const tokenId = tokenDocument.id;
            const updateData = {};

            if (hasChangedName) {
                this.log(`Token ${tokenId} name changed to "${change.name}". Updating default.`);
                updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.name`] = change.name;
            }

            if (hasChangedTexture) {
                this.log(`Token ${tokenId} texture changed to "${change.texture.src}". Updating default.`);
                updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.token`] = change.texture.src;
            }

            // Use a separate, awaited update to avoid race conditions with the main update
            actor.update(updateData).then(() => {
                this.log(`Default visage updated for token ${tokenId}.`);
            });
        }
    }

    /**
     * Switches the token to the specified form.
     * @param {string} actorId - The ID of the actor.
     * @param {string} tokenId - The ID of the specific token to update on the canvas.
     * @param {string} formKey - The key of the form to switch to.
     * @returns {Promise<boolean>} - True on success, false otherwise.
     */
    static async setVisage(actorId, tokenId, formKey) {
        this.log(`Setting visage for token ${tokenId} (actor ${actorId}) to ${formKey}`);
        
        const token = canvas.tokens.get(tokenId);
        if (!token) {
            this.log(`Token not found: ${tokenId}`, true);
            return false;
        }

        const actor = token.actor;
        if (!actor) {
            this.log(`Actor not found for token: ${tokenId}`, true);
            return false;
        }

        const moduleData = actor.flags?.[this.DATA_NAMESPACE] || {};
        const tokenData = moduleData[tokenId] || {};
        
        let newName;
        let newTokenPath;

        if (formKey === 'default') {
            const defaults = tokenData.defaults;
            if (!defaults) {
                this.log(`Cannot reset to default; no defaults saved for token ${tokenId}.`, true);
                return false;
            }
            newName = defaults.name;
            newTokenPath = defaults.token;
        } else {
            const alternateImages = moduleData.alternateImages || {};
            const imagePath = alternateImages[formKey];
            if (!imagePath) {
                this.log(`Form key "${formKey}" not found for actor ${actorId}`, true);
                return false;
            }
            newName = formKey;
            newTokenPath = imagePath;
        }

        try {
            // Update the token document on the scene, passing a custom flag
            await token.document.update({
                "name": newName,
                "texture.src": newTokenPath
            }, { visageUpdate: true });

            // Update the actor flags for this token
            await actor.update({
                [`flags.${this.DATA_NAMESPACE}.${tokenId}.currentFormKey`]: formKey
            });

            this.log(`Successfully updated token ${tokenId} to form ${formKey}`);
            return true;
        } catch (error) {
            this.log(`Failed to update token ${tokenId}: ${error}`, true);
            return false;
        }
    }

    /**
     * Retrieves the stored alternateImages data for the actor.
     * @param {string} actorId - The ID of the actor.
     * @returns {object|null} - The alternate images data, or null if not found.
     */
    static getForms(actorId) {
        const actor = game.actors.get(actorId);
        return actor?.flags?.[this.DATA_NAMESPACE]?.alternateImages || null;
    }

    /**
     * Checks if the specified form is currently active on the token.
     * @param {string} actorId - The ID of the actor.
     * @param {string} tokenId - The ID of the token.
     * @param {string} formKey - The key of the form to check.
     * @returns {boolean} - True if the form is active, false otherwise.
     */
    static isFormActive(actorId, tokenId, formKey) {
        const actor = game.actors.get(actorId);
        const currentFormKey = actor?.flags?.[this.DATA_NAMESPACE]?.[tokenId]?.currentFormKey;
        // If no key is stored, it's 'default'.
        if (currentFormKey === undefined && formKey === 'default') return true;
        return currentFormKey === formKey;
    }
}