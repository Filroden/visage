import { MODULE_ID } from "../core/visage-constants.js";
import { VisageDataModel } from "../data/visage-data-model.js";

/**
 * @file Shared utility functions for the Visage module.
 * Centralizes logging, path resolution, token state extraction, and theme management.
 * @module visage
 */

export class VisageUtilities {
    /**
     * Centralized logging helper.
     * respect's the developer mode module if present to suppress noise.
     * @param {string} message - The message to log.
     * @param {boolean} [force=false] - If true, logs even if debug mode is off.
     */
    static log(message, force = false) {
        // Integrate with _dev-mode module if available for standard debug toggling
        const shouldLog = force || game.modules.get("_dev-mode")?.api?.getPackageDebugValue(MODULE_ID);
        if (shouldLog) console.log(`${MODULE_ID} | ${message}`);
    }

    /**
     * Removes query strings (cache busters) from a file path safely.
     * * **Strategy:**
     * 1. Find the last period (.) denoting the file extension.
     * 2. If a '?' appears *after* that period, it is a cache buster -> Strip it.
     * 3. If a '?' appears *before* that period (or no period exists), it is a wildcard -> Keep it.
     * @param {string} path - The raw file path.
     * @returns {string} The clean path.
     */
    static cleanPath(path) {
        if (!path || typeof path !== "string") return "";

        const lastDot = path.lastIndexOf(".");

        // If no extension is found, fallback to standard splitting (unlikely for valid assets)
        if (lastDot === -1) return path.split("?")[0];

        // Search for a '?' only occurring AFTER the extension dot
        const queryIndex = path.indexOf("?", lastDot);

        if (queryIndex !== -1) {
            // Found a cache buster after the extension
            return path.substring(0, queryIndex);
        }

        // No cache buster found (any '?' present must be before the dot, i.e., a wildcard)
        return path;
    }

    /**
     * Determines if a given file path points to a video file based on extension.
     * Handles cleaning query strings before checking to ensuring accurate detection.
     * @param {string} path - The file path to check.
     * @returns {boolean} True if the file is a video.
     */
    static isVideo(path) {
        if (!path) return false;
        const clean = this.cleanPath(path);
        return foundry.helpers.media.VideoHelper.hasVideoExtension(clean);
    }

    /**
     * Recursively crawls the target directory and caches all image/video filepaths.
     * @param {string} directory - The root directory to crawl.
     */
    static async buildAutoImageCache(directory) {
        if (!directory) return;

        ui.notifications.info(game.i18n.localize("VISAGE.Notifications.CacheBuildStart"));

        const allFiles = [];
        const FilePickerClass = foundry.applications?.apps?.FilePicker || FilePicker;

        async function crawl(targetDir) {
            try {
                const result = await FilePickerClass.browse("data", targetDir, { type: "imagevideo" });
                if (result.files) allFiles.push(...result.files);

                if (result.dirs) {
                    for (const dir of result.dirs) {
                        await crawl(dir);
                    }
                }
            } catch (err) {
                console.warn(`Visage | Could not crawl directory: ${targetDir}`, err);
            }
        }

        await crawl(directory);
        await game.settings.set("visage", "autoImageCache", allFiles); // Use literal "visage" or pass MODULE_ID from constants

        ui.notifications.info(
            game.i18n.format("VISAGE.Notifications.CacheBuildSuccess", {
                count: allFiles.length,
            }),
        );
    }

    /**
     * Constructs the auto-mapped image wildcard path.
     * @param {string} overrideName - The name explicitly set in the Visage changes.
     * @param {string} fallbackName - The token's base name.
     * @param {string} directory - The globally configured auto-image directory.
     * @returns {string|null} The constructed wildcard path, or null if invalid.
     */
    static resolveAutoMappingPath(overrideName, fallbackName, directory) {
        if (!directory || typeof directory !== "string") return null;

        const activeName = overrideName?.trim() || fallbackName?.trim();
        if (!activeName) return null;

        const safeDirectory = directory.endsWith("/") ? directory.slice(0, -1) : directory;

        // Return the wildcard string to trigger UI badges and randomization
        return `${safeDirectory}/*${activeName}*`;
    }

    /**
     * Resolves wildcard paths or S3 bucket URLs into a concrete file path.
     * Filters the directory contents to ensure only files matching the wildcard pattern are selected.
     * * Handles local storage ("data") and S3 buckets ("s3").
     * * Decodes URL components to handle spaces and special characters.
     * @param {string} path - The image path (e.g., "tokens/guards/bear-*.png").
     * @returns {Promise<string|null>} The resolved single file path, or null if resolution fails.
     */
    static async resolvePath(path) {
        if (!path) return path;

        const clean = this.cleanPath(path);
        if (!clean.includes("*") && !clean.includes("?")) return path;

        let processingPath = clean;
        try {
            processingPath = decodeURIComponent(processingPath);
        } catch (err) {
            console.debug(`Visage | Silently ignoring URI decode error for path: ${processingPath}`, err);
        }

        try {
            const FilePickerClass = foundry.applications?.apps?.FilePicker;
            const locationConfig = this._parsePathLocation(processingPath, FilePickerClass);
            if (!locationConfig) return null; // Exit if S3 bucket resolution failed

            let { source } = locationConfig;
            const { directory, pattern, bucket } = locationConfig;
            const browseOptions = { type: "imagevideo" };

            if (bucket) browseOptions.bucket = bucket;

            const forgeSource = await this._ensureForgeAPI(browseOptions);
            if (forgeSource) source = forgeSource;

            // Convert wildcard pattern to a strict RegExp
            const escaped = pattern.replaceAll(/[.+^${}()|[\]\\]/g, String.raw`\$&`);
            const flexiblePattern = escaped.replaceAll(/\s+/g, String.raw`[_\-\s]+`);
            const regex = new RegExp(`^${flexiblePattern.replaceAll("*", ".*").replaceAll("?", ".")}$`, "i");

            const content = await FilePickerClass.browse(source, directory, browseOptions);
            if (!content?.files?.length) return null;

            // Filter files returned by the server
            const matches = content.files.filter((file) => {
                const rawName = file.split("/").pop();
                let name;
                try {
                    name = decodeURIComponent(rawName);
                } catch {
                    name = rawName;
                }
                return regex.test(name);
            });

            if (matches.length > 0) {
                return this._applySmartMatching(matches, pattern);
            }

            console.warn(`Visage | Wildcard Resolution Failed: No files matched pattern '${pattern}' in directory '${directory}' (Source: ${source})`);
        } catch (err) {
            console.warn(`Visage | Error resolving wildcard path: ${path}`, err);
        }

        return null;
    }

    // ==========================================
    // PATH RESOLUTION HELPER METHODS
    // ==========================================

    /**
     * Parses a raw path into its source, directory, and pattern components.
     * @private
     */
    static _parsePathLocation(processingPath, FilePickerClass) {
        let source = "data";
        let directory = "";
        let pattern = "";

        // Handle S3 Bucket parsing logic
        if (/\.s3\./i.test(processingPath)) {
            source = "s3";
            const { bucket, keyPrefix } = FilePickerClass.parseS3URL(processingPath);
            if (!bucket) return null;

            const lastSlash = keyPrefix.lastIndexOf("/");
            directory = lastSlash >= 0 ? keyPrefix.slice(0, lastSlash + 1) : "";
            pattern = lastSlash >= 0 ? keyPrefix.slice(lastSlash + 1) : keyPrefix;
            return { source, directory, pattern, bucket };
        }

        // Handle Core Icons (Public)
        if (processingPath.startsWith("icons/") || processingPath.startsWith("systems/") || processingPath.startsWith("modules/")) {
            if (processingPath.startsWith("icons/")) source = "public";
        }

        const lastSlash = processingPath.lastIndexOf("/");
        directory = lastSlash >= 0 ? processingPath.slice(0, lastSlash + 1) : "";
        pattern = lastSlash >= 0 ? processingPath.slice(lastSlash + 1) : processingPath;

        return { source, directory, pattern };
    }

    /**
     * Ensures The Forge API is initialized if running on their infrastructure.
     * @private
     */
    static async _ensureForgeAPI(browseOptions) {
        if (typeof ForgeVTT !== "undefined" && ForgeVTT.usingTheForge) {
            browseOptions.cookieKey = true;

            if (!globalThis.ForgeAPI?.lastStatus) {
                try {
                    await globalThis.ForgeAPI.status();
                } catch (err) {
                    console.warn("Visage | ForgeAPI.status() failed", err);
                }
            }
            return "forgevtt";
        }
        return null;
    }

    /**
     * Applies FA-Compatible smart matching to prioritise exact word boundaries.
     * @private
     */
    static _applySmartMatching(matches, pattern) {
        const coreWordMatch = new RegExp(/^\*([^*?]+)\*$/).exec(pattern);

        if (coreWordMatch) {
            const coreWord = coreWordMatch[1].trim();
            const flexibleWord = coreWord.replaceAll(/\s+/g, String.raw`[_\-\s]+`);
            const exactRegex = new RegExp(String.raw`(^|[_\-\s])${flexibleWord}([_\-\s\.]|$)`, "i");

            // Filter for strict boundary matches
            const primaryMatches = matches.filter((match) => exactRegex.test(match.split("/").pop()));

            if (primaryMatches.length > 0) {
                return primaryMatches[Math.floor(Math.random() * primaryMatches.length)];
            }
        }

        // Loose Fallback (Only triggers if no exact bounded matches exist)
        return matches[Math.floor(Math.random() * matches.length)];
    }

    /**
     * Captures the current visual properties of a token document or a plain data object.
     * Extracts the raw properties and passes them through the DataModel to guarantee
     * a perfectly sanitized v3 schema with correct fallbacks.
     * @param {TokenDocument|Object} data - The token document or data object to inspect.
     * @returns {Object} A standardized visual state object ready to be saved as a Visage.
     */
    static extractVisualState(data) {
        if (!data) return {};

        const source = data._source || data;
        const get = (key) => foundry.utils.getProperty(source, key) ?? foundry.utils.getProperty(data, key);

        // Capture Portrait (Actor Image)
        let portrait = null;
        if (data.actor) portrait = data.actor.img;
        else if (data.document?.actor) portrait = data.document.actor.img;
        else if (source.actorId && canvas.tokens?.placeables) {
            const actor = game.actors?.get(source.actorId);
            if (actor) portrait = actor.img;
        }

        // Gather raw properties directly from the source Document
        const rawChanges = {
            name: get("name"),
            displayName: get("displayName"),
            disposition: get("disposition"),
            width: get("width"),
            height: get("height"),
            depth: get("depth"),
            alpha: get("alpha"),
            lockRotation: get("lockRotation"),
            texture: {
                src: get("texture.src"),
                scaleX: get("texture.scaleX"),
                scaleY: get("texture.scaleY"),
                anchorX: get("texture.anchorX"),
                anchorY: get("texture.anchorY"),
            },
            ring: source.ring?.toObject?.() ?? source.ring ?? {},
            light: source.light?.toObject?.() ?? source.light ?? {},
            portrait: portrait,
            delay: 0,
        };

        // Pass through the schema to enforce defaults (e.g. scales to 1, anchors to 0.5)
        const model = new VisageDataModel({ changes: rawChanges });
        return model.toObject().changes;
    }

    /**
     * Helper to resolve the Target Actor and Token from a set of IDs.
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
        element.classList.remove("visage-theme-local", "visage-theme-global");

        if (isLocal) {
            element.classList.add("visage-theme-local");
        } else {
            element.classList.add("visage-theme-global");
        }
    }

    /**
     * Helper property to check availability of the Sequencer module.
     * @returns {boolean} True if Sequencer is active.
     */
    static get hasSequencer() {
        return game.modules.get("sequencer")?.active;
    }

    /**
     * Generates and downloads a diagnostic JSON file for bug reporting.
     */
    static exportDiagnostics() {
        const module = game.modules.get("visage");

        const diagnosticData = {
            timestamp: new Date().toISOString(),
            environment: {
                userAgent: navigator.userAgent,
                foundryVersion: game.version,
                system: {
                    id: game.system.id,
                    version: game.system.version,
                },
            },
            visage: {
                version: module.version,
                sequencerActive: game.modules.get("sequencer")?.active || false,
                jb2aActive: game.modules.get("JB2A_DnD5e")?.active || game.modules.get("jb2a_patreon")?.active || false,
                activeModules: game.modules.filter((m) => m.active).map((m) => m.id),
            },
            data: {
                globalLibrary: game.settings.get("visage", "globalVisages") || {},
            },
        };

        if (canvas.ready && canvas.tokens.controlled.length > 0) {
            diagnosticData.data.selectedTokens = canvas.tokens.controlled.map((t) => ({
                name: t.name,
                actorId: t.actor?.id,
                localVisages: t.actor?.flags?.visage?.alternateVisages || {},
                activeStack: t.document.flags?.visage?.activeStack || [],
                identity: t.document.flags?.visage?.identity || null,
            }));
        }

        const filename = `Visage_Diagnostics_${Date.now()}.json`;
        foundry.utils.saveDataToFile(JSON.stringify(diagnosticData, null, 2), "application/json", filename);

        // Using the new localization key
        ui.notifications.info(game.i18n.localize("VISAGE.Notifications.ExportSuccess"));
    }
}
