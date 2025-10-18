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
            resetToDefault: this.resetToDefault.bind(this),
            getForms: this.getForms.bind(this),
            isFormActive: this.isFormActive.bind(this),
            resolvePath: this.resolvePath.bind(this)
        };
    }

    /**
     * Switches the actor to the specified form.
     * @param {string} actorId - The ID of the actor to update.
     * @param {string} formKey - The key of the form to switch to.
     * @param {string|null} tokenId - The ID of the specific token to update on the canvas.
     * @returns {Promise<boolean>} - True on success, false otherwise.
     */
    static async setVisage(actorId, formKey, tokenId = null) {
        this.log(`Setting visage for actor ${actorId} to ${formKey}`);
        const actor = game.actors.get(actorId);
        if (!actor) {
            this.log(`Actor not found: ${actorId}`, true);
            return false;
        }

        const moduleData = actor.flags?.[this.DATA_NAMESPACE] || {};
        let newPortraitPath;
        let newTokenPath;

        if (formKey === 'default') {
            const defaults = moduleData.defaults;
            if (!defaults) {
                this.log(`Cannot reset to default; no defaults saved for actor ${actorId}.`, true);
                return false;
            }
            newPortraitPath = defaults.portrait;
            newTokenPath = defaults.token;
        } else {
            const alternateImages = moduleData.alternateImages || {};
            const imagePath = alternateImages[formKey];
            if (!imagePath) {
                this.log(`Form key "${formKey}" not found for actor ${actorId}`, true);
                return false;
            }
            newPortraitPath = imagePath;
            newTokenPath = imagePath;
        }

        const isWildcard = newTokenPath && newTokenPath.includes('*');

        try {
            await actor.update({
                "img": newPortraitPath,
                "prototypeToken.texture.src": newTokenPath,
                "prototypeToken.randomImg": isWildcard,
                [`flags.${this.DATA_NAMESPACE}.currentFormKey`]: formKey
            });

            if (tokenId) {
                const token = canvas.tokens.get(tokenId);
                if (token) {
                    const resolvedTokenPath = await this.resolvePath(newTokenPath);
                    await token.document.update({ "texture.src": resolvedTokenPath });
                }
            }

            this.log(`Successfully updated actor ${actorId} to form ${formKey}`);
            return true;
        } catch (error) {
            this.log(`Failed to update actor ${actorId}: ${error}`, true);
            return false;
        }
    }

    /**
     * Switches the actor back to the default form.
     * @param {string} actorId - The ID of the actor to update.
     * @returns {Promise<boolean>} - True on success, false otherwise.
     */
    static async resetToDefault(actorId) {
        this.log(`Resetting visage for actor ${actorId}`);
        return await this.setVisage(actorId, "default");
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
     * Checks if the specified form is currently active on the actor.
     * @param {string} actorId - The ID of the actor.
     * @param {string} formKey - The key of the form to check.
     * @returns {boolean} - True if the form is active, false otherwise.
     */
    static isFormActive(actorId, formKey) {
        const actor = game.actors.get(actorId);
        const currentFormKey = actor?.flags?.[this.DATA_NAMESPACE]?.currentFormKey;
        return currentFormKey === formKey;
    }
}
