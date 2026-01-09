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

        try {
            const browseOptions = {};
            let source = "data";
            let directory = "";
            let pattern = "";

            // Handle S3 Bucket parsing
            if (/\.s3\./i.test(path)) {
                source = "s3";
                const { bucket, keyPrefix } = foundry.applications.apps.FilePicker.implementation.parseS3URL(path);

                if (!bucket) return null; // Return null on invalid S3

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
            const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
            const regex = new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");

            const content = await foundry.applications.apps.FilePicker.implementation.browse(
                source,
                directory,
                browseOptions
            );

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
                return matches[Math.floor(Math.random() * matches.length)];
            }
        }
        catch (err) {
            this.log(`Error resolving wildcard path: ${path} | ${err}`, true);
        }

        return null;
    }

    /* visage-utilities.js */

    /**
     * Captures the current visual properties of a token document or a plain data object.
     * STRICT V2 MODE: Expects modern data structure (texture.src, texture.scaleX).
     * @param {TokenDocument|Object} data - The token document or data object to inspect.
     * @returns {Object} A standardized visual state object (v2 Schema).
     */
    static extractVisualState(data) {
        if (!data) return {};
        
        // Helper to safely get nested properties whether 'data' is a Document or JSON
        // We keep this because 'dirtyBase' in handleTokenUpdate is a plain object.
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
            alpha: get("alpha"),
            texture: {
                src: textureSrc,
                scaleX: scaleX,
                scaleY: scaleY
            },
            ring: ringData
        };
    }
}