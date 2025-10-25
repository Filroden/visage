/**
 * The primary class for the Visage module.
 *
 * This class acts as the main controller and data manager for the module.
 * It provides a public API for other modules and macros, handles data
 * synchronization hooks, and contains the core logic for changing a token's
 * appearance ("visage").
 */
export class Visage {
    /**
     * The official module ID, used for settings, flags, and API access.
     * @type {string}
     */
    static MODULE_ID = "visage";

    /**
     * The namespace used for storing all module-related data within actor flags.
     * @type {string}
     */
    static DATA_NAMESPACE = "visage";

    /**
     * A utility function for logging messages to the console.
     * It respects the "Debug Mode" setting from the 'lib-dev-mode' (dev-mode)
     * module if it is active, otherwise, it logs only if 'force' is true.
     *
     * @param {string} message - The message to log.
     * @param {boolean} [force=false] - Whether to force the log, ignoring debug settings.
     */
    static log(message, force = false) {
        // Check if dev-mode is active and has debug enabled for this module
        const shouldLog = force || game.modules.get('_dev-mode')?.api?.getPackageDebugValue(this.MODULE_ID);
        if (shouldLog) {
            console.log(`${this.MODULE_ID} | ${message}`);
        }
    }

    /**
     * Resolves a file path, with special handling for wildcards ('*').
     *
     * If a path contains a wildcard, this method will browse the file system
     * (handling Data, S3, and public 'icons' paths) and randomly select one
     * file from the list of matches.
     *
     * @param {string} path - The path to resolve (e.g., "path/to/image.png" or "path/to/folder/*").
     * @returns {Promise<string>} - The resolved, concrete file path.
     */
    static async resolvePath(path) {
        // If no path or no wildcard, return the path as-is.
        if (!path || !path.includes('*')) return path;

        try {
            const browseOptions = { wildcard: true };
            let source = "data"; // Default source

            // Check for S3 paths
            if (/\.s3\./.test(path)) {
                source = 's3';
                const { bucket, keyPrefix } = foundry.applications.apps.FilePicker.implementation.parseS3URL(path);
                if (bucket) {
                    browseOptions.bucket = bucket;
                    path = keyPrefix; // The path for browsing is just the key
                }
            } else if (path.startsWith('icons/')) {
                // Check for core 'icons' paths
                source = 'public';
            }

            // Asynchronously browse for files matching the wildcard
            const content = await foundry.applications.apps.FilePicker.implementation.browse(source, path, browseOptions);
            
            // If files are found, pick one at random
            if (content.files.length) {
                return content.files[Math.floor(Math.random() * content.files.length)];
            }
        } catch (err) {
            this.log(`Error resolving wildcard path: ${path} | ${err}`, true);
        }
        // Fallback: return the original path if resolution fails
        return path;
    }

    /**
     * Initializes the module.
     * This method is called once by the 'init' hook in main.js.
     * Its primary role is to set up the public API on `game.modules`.
     */
    static initialize() {
        this.log("Initializing Visage");

        // Expose the public API for macros and other modules
        game.modules.get(this.MODULE_ID).api = {
            setVisage: this.setVisage.bind(this),
            getForms: this.getForms.bind(this),
            isFormActive: this.isFormActive.bind(this),
            resolvePath: this.resolvePath.bind(this)
        };
    }

    /**
     * Hook handler for the 'preUpdateToken' event.
     *
     * This function automatically syncs changes from the standard Token
     * Configuration window to this module's "default" form data.
     * If a user changes the token's name, image, or scale normally,
     * this function updates the saved default visage to match.
     *
     * @param {TokenDocument} tokenDocument - The token document being updated.
     * @param {object} change - The differential data being applied.
     * @param {object} options - Additional options for the update.
     */
    static handleTokenUpdate(tokenDocument, change, options) {
        // IMPORTANT: If the update is coming from our own `setVisage` function,
        // (which sets `options.visageUpdate = true`), we must abort
        // to prevent an infinite update loop.
        if (options.visageUpdate) return;

        const actor = tokenDocument.actor;
        if (!actor) return;

        // Check if the relevant properties have changed
        const hasChangedName = "name" in change;
        const hasChangedTextureSrc = "texture" in change && "src" in change.texture;
        const hasChangedTextureScale = "texture" in change && ("scaleX" in change.texture || "scaleY" in change.texture);
        const hasChangedDisposition = "disposition" in change;

        // If nothing we care about changed, do nothing.
        if (hasChangedName || hasChangedTextureSrc || hasChangedTextureScale || hasChangedDisposition) {
            const tokenId = tokenDocument.id;
            const updateData = {};

            // Prepare the flag updates
            if (hasChangedName) {
                this.log(`Token ${tokenId} name changed to "${change.name}". Updating default.`);
                updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.name`] = change.name;
            }

            if (hasChangedTextureSrc) {
                this.log(`Token ${tokenId} texture src changed to "${change.texture.src}". Updating default.`);
                updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.token`] = change.texture.src;
            }

            if (hasChangedTextureScale) {
                // Assume scaleX and scaleY are linked (or use scaleX as the primary)
                const newScale = change.texture.scaleX ?? change.texture.scaleY; 
                if (newScale !== undefined) {
                    this.log(`Token ${tokenId} texture scale changed to "${newScale}". Updating default.`);
                    updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.scale`] = newScale;
                }
            }

            if (hasChangedDisposition) {
                this.log(`Token ${tokenId} disposition changed to "${change.disposition}". Updating default.`);
                updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.disposition`] = change.disposition;
            }

            // Asynchronously update the actor's flags
            // We do this in a non-blocking way to avoid holding up the original token update.
            if (Object.keys(updateData).length > 0) {
                actor.update(updateData).then(() => {
                    this.log(`Default visage updated for token ${tokenId}.`);
                });
            }
        }
    }

    /**
     * The core API function to change a token's visage to a specified form.
     *
     * @param {string} actorId - The ID of the token's actor.
     * @param {string} tokenId - The ID of the specific token on the canvas to update.
     * @param {string} formKey - The key of the form to switch to (e.g., "default", "Werewolf", etc.).
     * @returns {Promise<boolean>} - True on success, false on failure.
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

        // Get the module's data from the actor's flags
        const moduleData = actor.flags?.[this.DATA_NAMESPACE] || {};
        const tokenData = moduleData[tokenId] || {};
        
        let newName;
        let newTokenPath;
        let newScale;
        let newDisposition;

        // --- Determine the new token data based on the formKey ---
        if (formKey === 'default') {
            // Special case: "default" reverts to the saved default data.
            const defaults = tokenData.defaults;
            if (!defaults) {
                this.log(`Cannot reset to default; no defaults saved for token ${tokenId}.`, true);
                return false;
            }
            
            newName = defaults.name;
            newTokenPath = defaults.token;
            newScale = defaults.scale ?? 1.0;
            newDisposition = defaults.disposition ?? 0; // Restore default disposition (or 0 if unset)

        } else {
            // Case: Switching to an alternate form.
            const alternateImages = moduleData.alternateImages || {};
            const visageData = alternateImages[formKey];
            
            if (!visageData) {
                this.log(`Form key "${formKey}" not found for actor ${actorId}`, true);
                return false;
            }
            
            // Check if the data is stored as a complex object {path, scale} or just a simple string (path)
            const isObject = typeof visageData === 'object' && visageData !== null;
            
            newName = formKey; // The form's name is its key
            
            if (isObject) {
                newTokenPath = visageData.path;
                newScale = visageData.scale ?? 1.0;
                newDisposition = visageData.disposition; // This can be null
            } else {
                // Handle legacy string-only data
                newTokenPath = visageData;
                newScale = 1.0;
                newDisposition = null; // No disposition data
            }
        }

        // Resolve the path (handles wildcards)
        const finalTokenPath = await this.resolvePath(newTokenPath);

        // --- Prepare Update Payload ---
        const updateData = {
            "name": newName,
            "texture.src": finalTokenPath,
            "texture.scaleX": newScale, // Negative scale handles flip
            "texture.scaleY": Math.abs(newScale) // Ensure scaleY is positive
        };

        // Only add disposition to the update if it's not null/undefined
        // (null means "No Change" for alternate forms)
        if (newDisposition !== null && newDisposition !== undefined) {
            updateData.disposition = newDisposition;
        }

        // --- Apply the updates ---
        try {
            // 1. Update the token document on the canvas
            await token.document.update(updateData, { visageUpdate: true }); // Pass our custom option to prevent the hook loop

            // 2. Update the actor's flags to store the new active form
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
     * API function to retrieve all configured alternate forms for an actor.
     *
     * This is a helper function, primarily used to populate UI elements
     * like the VisageSelector.
     *
     * @param {string} actorId - The ID of the actor.
     * @returns {Array<object>|null} - An array of visage objects, or null if none are configured.
     * Each object has the shape: { key, name, path, scale, disposition }
     */
    static getForms(actorId) {
        const actor = game.actors.get(actorId);
        const alternateImages = actor?.flags?.[this.DATA_NAMESPACE]?.alternateImages;

        if (!alternateImages) {
            return null; // No forms configured
        }

        // Map the stored object data into a standardized array format
        return Object.entries(alternateImages).map(([key, data]) => {
            const isObject = typeof data === 'object' && data !== null;
            const path = isObject ? data.path : data;
            const scale = isObject ? (data.scale ?? 1.0) : 1.0;
            const disposition = isObject ? (data.disposition ?? null) : null;
            
            return {
                key: key,       // The internal key (e.g., "werewolf")
                name: key,      // The display name (same as key for now)
                path: path,
                scale: scale,
                disposition: disposition
            };
        });
    }

    /**
     * API function to check if a specific form is currently active on a token.
     *
     * @param {string} actorId - The ID of the actor.
     * @param {string} tokenId - The ID of the token.
     * @param {string} formKey - The key of the form to check.
     * @returns {boolean} - True if the form is active, false otherwise.
     */
    static isFormActive(actorId, tokenId, formKey) {
        const actor = game.actors.get(actorId);
        // Get the currently saved form key from the flags
        const currentFormKey = actor?.flags?.[this.DATA_NAMESPACE]?.[tokenId]?.currentFormKey;
        
        // If no form key is set, the token is considered to be in its "default" state.
        if (currentFormKey === undefined && formKey === 'default') return true;
        
        // Otherwise, do a direct comparison.
        return currentFormKey === formKey;
    }
}