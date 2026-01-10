/* visage-utilities.js */

/**
 * @file Shared utility functions for the Visage module.
 * Centralizes logging, path resolution, and token state extraction.
 * @module visage
 */

export class VisageUtilities {
    static MODULE_ID = "visage";

    /**
     * Centralized logging helper.
     * @param {string} message - The message to log.
     * @param {boolean} [force=false] - If true, logs even if debug mode is off.
     */
    static log(message, force = false) {
        const shouldLog = force || game.modules.get('_dev-mode')?.api?.getPackageDebugValue(this.MODULE_ID);
        if (shouldLog) console.log(`${this.MODULE_ID} | ${message}`);
    }

    /**
     * Resolves wildcard paths or S3 bucket URLs into a concrete file path.
     * Filters the directory contents to ensure only files matching the wildcard pattern are selected.
     * @param {string} path - The image path (e.g., "tokens/guards/bear-*.png").
     * @returns {Promise<string|null>} The resolved single file path, or null if resolution fails.
     */
    static async resolvePath(path) {
        if (!path) return path;
        
        // Optimization: If no wildcard, return as is.
        if (!path.includes('*') && !path.includes('?')) return path;

        // FIX: Decode URL components (e.g. %20 -> space) before processing
        // This ensures 'tokens/my%20images/*.png' becomes 'tokens/my images/*.png' for the browser
        try {
            path = decodeURIComponent(path);
        } catch (e) {
            // Ignore decode errors, use raw path
        }

        try {
            const browseOptions = {};
            let source = "data";
            let directory = "";
            let pattern = "";

            // FIX: Safely resolve the FilePicker class for V12/V13 compatibility
            const FilePickerClass = foundry.applications?.apps?.FilePicker || FilePicker;

            // Handle S3 Bucket parsing
            if (/\.s3\./i.test(path)) {
                source = "s3";
                const { bucket, keyPrefix } = FilePickerClass.parseS3URL(path);
                if (!bucket) return null; 
                browseOptions.bucket = bucket;

                const lastSlash = keyPrefix.lastIndexOf('/');
                directory = lastSlash >= 0 ? keyPrefix.slice(0, lastSlash + 1) : "";
                pattern   = lastSlash >= 0 ? keyPrefix.slice(lastSlash + 1) : keyPrefix;
            }
            else {
                // Non-S3 paths
                if (path.startsWith("icons/")) source = "public";

                const lastSlash = path.lastIndexOf('/');
                directory = lastSlash >= 0 ? path.slice(0, lastSlash + 1) : "";
                pattern   = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
            }

            // Convert wildcard pattern to RegExp
            // Escapes regex chars except * and ? which are converted to .* and .
            const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
            const regex = new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");

            // ROBUST BROWSE CALL
            const content = await FilePickerClass.browse(source, directory, browseOptions);

            // Filter files to those matching the wildcard
            const matches = content.files.filter(file => {
                const rawName = file.split("/").pop();
                let name;
                try {
                    name = decodeURIComponent(rawName);
                } catch {
                    name = rawName;
                }
                return regex.test(name);
            });

            if (matches.length) {
                const choice = matches[Math.floor(Math.random() * matches.length)];
                // this.log(`Resolved wildcard '${path}' to '${choice}'`); // Optional verbose log
                return choice;
            } else {
                // ENABLED DEBUG LOG: Helps identify why resolution failed
                console.warn(`Visage | Wildcard Resolution Failed: No files matched pattern '${pattern}' in directory '${directory}' (Source: ${source})`);
            }
        }
        catch (err) {
            console.warn(`Visage | Error resolving wildcard path: ${path}`, err);
        }

        return null;
    }

    /**
     * Captures the current visual properties of a token document or a plain data object.
     * STRICT V2 MODE: Expects modern data structure (texture.src, texture.scaleX).
     * @param {TokenDocument|Object} data - The token document or data object to inspect.
     * @returns {Object} A standardized visual state object (v2 Schema).
     */
    static extractVisualState(data) {
        if (!data) return {};
        
        const get = (key) => foundry.utils.getProperty(data, key);

        const ringData = data.ring?.toObject?.() ?? data.ring ?? {};
        const textureSrc = get("texture.src");
        const scaleX = get("texture.scaleX") ?? 1.0;
        const scaleY = get("texture.scaleY") ?? 1.0;

        return {
            name: get("name"),
            displayName: get("displayName"),
            disposition: get("disposition"),
            width: get("width"),
            height: get("height"),
            texture: {
                src: textureSrc,
                scaleX: scaleX,
                scaleY: scaleY
            },
            ring: ringData
        };
    }

    /**
     * Helper to resolve the Target Actor and Token from a set of IDs.
     * Supports resolving from Canvas, Scene (unlinked), or Actor directory.
     * @param {Object} ids - { actorId, tokenId, sceneId }
     * @returns {Object} { actor, token } - The resolved documents (or null).
     */
    static resolveTarget({ actorId, tokenId, sceneId } = {}) {
        let token = null;
        let actor = null;

        if (tokenId) {
            token = canvas.tokens.get(tokenId);
            if (!token && sceneId) {
                const scene = game.scenes.get(sceneId);
                token = scene?.tokens.get(tokenId);
            }
        }
        
        if (token) actor = token.actor;
        else if (actorId) actor = game.actors.get(actorId);

        return { actor, token };
    }

    /**
     * Applies standard Visage theme classes and RTL settings to an application element.
     * @param {HTMLElement} element - The application's root element.
     * @param {boolean} isLocal - Whether to apply the 'Local' (Gold) or 'Global' (Blue) theme.
     */
    static applyVisageTheme(element, isLocal) {
        // 1. RTL Support
        const rtlLanguages = ["ar", "he", "fa", "ur"];
        if (rtlLanguages.includes(game.i18n.lang)) {
            element.setAttribute("dir", "rtl");
            element.classList.add("rtl");
        }

        // 2. Theme Classes
        element.classList.remove("visage-theme-local", "visage-theme-global");
        
        if (isLocal) {
            element.classList.add("visage-theme-local");
        } else {
            element.classList.add("visage-theme-global");
        }
    }
}