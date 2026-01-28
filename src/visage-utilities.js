/**
 * @file Shared utility functions for the Visage module.
 * Centralizes logging, path resolution, token state extraction, and theme management.
 * @module visage
 */

export class VisageUtilities {
    /**
     * The module ID used for scoping settings and flags.
     * @type {string}
     */
    static MODULE_ID = "visage";

    /**
     * Centralized logging helper.
     * respect's the developer mode module if present to suppress noise.
     * @param {string} message - The message to log.
     * @param {boolean} [force=false] - If true, logs even if debug mode is off.
     */
    static log(message, force = false) {
        // Integrate with _dev-mode module if available for standard debug toggling
        const shouldLog = force || game.modules.get('_dev-mode')?.api?.getPackageDebugValue(this.MODULE_ID);
        if (shouldLog) console.log(`${this.MODULE_ID} | ${message}`);
    }

    /**
     * Resolves wildcard paths or S3 bucket URLs into a concrete file path.
     * Filters the directory contents to ensure only files matching the wildcard pattern are selected.
     * * Handles both local storage ("data") and S3 buckets ("s3\").
     * * Decodes URL components to handle spaces and special characters.
     * @param {string} path - The image path (e.g., "tokens/guards/bear-*.png").
     * @returns {Promise<string|null>} The resolved single file path, or null if resolution fails.
     */
    static async resolvePath(path) {
        if (!path) return path;
        
        // Optimization: If no wildcard characters, return the path as is without filesystem lookup.
        if (!path.includes('*') && !path.includes('?')) return path;

        // Decode URL components (e.g. %20 -> space) before processing
        // This ensures 'tokens/my%20images/*.png' becomes 'tokens/my images/*.png' for the browser file picker
        try {
            path = decodeURIComponent(path);
        } catch (e) {
            // Ignore decode errors, rely on raw path if decoding fails
        }

        try {
            const browseOptions = {};
            let source = "data";
            let directory = "";
            let pattern = "";

            const FilePickerClass = foundry.applications?.apps?.FilePicker;

            // Handle S3 Bucket parsing logic
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
                // Non-S3 paths (Data/Public)
                if (path.startsWith("icons/")) source = "public";

                const lastSlash = path.lastIndexOf('/');
                directory = lastSlash >= 0 ? path.slice(0, lastSlash + 1) : "";
                pattern   = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
            }

            // Convert wildcard pattern to a strict RegExp
            // We escape standard regex chars (like . or +) but convert * to .* and ? to .
            const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
            const regex = new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");

            // Perform the browse call to get file list
            const content = await FilePickerClass.browse(source, directory, browseOptions);

            // Filter files returned by the server against our wildcard pattern
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
                // Return a random selection from the matched files
                const choice = matches[Math.floor(Math.random() * matches.length)];
                return choice;
            } else {
                // Warn specifically if the pattern was valid but no files matched it
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
     * * STRICT V3 MODE: This method ensures we are extracting the standardized V3 schema
     * (e.g. nested texture objects) regardless of whether the input is a Document or raw data.
     * * Used for creating snapshots (the "Original State") before applying masks so we can revert later.
     * @param {TokenDocument|Object} data - The token document or data object to inspect.
     * @returns {Object} A standardized visual state object (v2 Schema).
     */
    static extractVisualState(data) {
        if (!data) return {};
        
        // Helper: Prefer raw source data (if Document) to avoid temporary flags/mods.
        // For example, Foundry modifies `document.alpha` automatically when hidden; 
        // we want the true user setting from `_source` to avoid capturing temporary states.
        const source = data._source || data;
        
        // Fallback helper for nested properties which might not be in _source if they haven't been updated yet
        const get = (key) => foundry.utils.getProperty(source, key) ?? foundry.utils.getProperty(data, key);

        // Safely extract Ring data (Foundry V12+ Dynamic Token Rings)
        const ringData = source.ring?.toObject?.() ?? source.ring ?? {};
        
        // NEW: Capture Light Source (V3.2)
        const lightData = source.light?.toObject?.() ?? source.light ?? {};

        // NEW: Capture Portrait (Actor Image) (V3.2)
        // Check multiple locations for the actor reference
        let portrait = null;
        if (data.actor) portrait = data.actor.img;
        else if (data.document?.actor) portrait = data.document.actor.img;
        else if (source.actorId && canvas.tokens?.placeables) {
            // Attempt fallback lookup (use cautiously)
            const actor = game.actors?.get(source.actorId);
            if (actor) portrait = actor.img;
        }

        // Standardize texture properties
        const textureSrc = get("texture.src");
        const scaleX = get("texture.scaleX") ?? 1.0;
        const scaleY = get("texture.scaleY") ?? 1.0;
        const alpha = get("alpha") ?? 1.0;
        const lockRotation = get("lockRotation") ?? false;

        return {
            name: get("name"),
            displayName: get("displayName"),
            disposition: get("disposition"),
            width: get("width"),
            height: get("height"),
            alpha: alpha,
            lockRotation: lockRotation,
            texture: {
                src: textureSrc,
                scaleX: scaleX,
                scaleY: scaleY
            },
            ring: ringData,
            
            // New Data Properties (V3.2)
            light: lightData,
            portrait: portrait,
            delay: 0
        };
    }

    /**
     * Helper to resolve the Target Actor and Token from a set of IDs.
     * Supports resolving from Canvas (Linked), Scene (Unlinked/Synthetic), or Actor directory.
     * * Priority order:
     * 1. Specific Token on Canvas (active scene)
     * 2. Specific Token on a Scene (inactive scene)
     * 3. Actor Document (Sidebar)
     * @param {Object} ids - { actorId, tokenId, sceneId }
     * @returns {Object} { actor, token } - The resolved documents (or null).
     */
    static resolveTarget({ actorId, tokenId, sceneId } = {}) {
        let token = null;
        let actor = null;

        // Priority 1: Canvas Token
        if (tokenId) {
            token = canvas.tokens.get(tokenId);
            // Priority 2: Unlinked Token (Scene-embedded)
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
     * Used by all UI windows (Editor, Gallery, HUD) to ensure consistent styling.
     * @param {HTMLElement} element - The application's root element.
     * @param {boolean} isLocal - Whether to apply the 'Local' (Gold) or 'Global' (Blue) theme.
     */
    static applyVisageTheme(element, isLocal) {
        // 1. RTL Support (Arabic, Hebrew, Persian, Urdu)
        const rtlLanguages = ["ar", "he", "fa", "ur"];
        if (rtlLanguages.includes(game.i18n.lang)) {
            element.setAttribute("dir", "rtl");
            element.classList.add("rtl");
        }

        // 2. Theme Classes
        // Ensure we don't have conflicting classes before adding the new one
        element.classList.remove("visage-theme-local", "visage-theme-global");
        
        if (isLocal) {
            element.classList.add("visage-theme-local");
        } else {
            element.classList.add("visage-theme-global");
        }
    }

    /**
     * Helper property to check availability of the Sequencer module.
     * Sequencer is required for advanced visual effects (holograms, glitches, etc).
     * @returns {boolean} True if Sequencer is active.
     */
    static get hasSequencer() { return game.modules.get("sequencer")?.active; }
}