/**
 * @file Contains the core logic for the Visage module.
 * @module visage
 */

import { VisageComposer } from "./visage-composer.js";
import { VisageData } from "./visage-data.js"; // CHANGED: Renamed

export class Visage {
    static MODULE_ID = "visage";
    static DATA_NAMESPACE = "visage";
    static ALTERNATE_FLAG_KEY = "alternateVisages";
    static LEGACY_FLAG_KEY = "alternateImages";

    static log(message, force = false) {
        const shouldLog = force || game.modules.get('_dev-mode')?.api?.getPackageDebugValue(this.MODULE_ID);
        if (shouldLog) {
            console.log(`${this.MODULE_ID} | ${message}`);
        }
    }

    static async resolvePath(path) {
        if (!path || !path.includes('*')) return path;
        try {
            const browseOptions = { wildcard: true };
            let source = "data";
            if (/\.s3\./i.test(path)) {
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

    static prepareRingContext(ringData) {
        const data = ringData || {};
        const currentEffects = data.effects || 0;
        
        const availableEffects = [
            { value: 2, label: "VISAGE.RingConfig.Effects.Pulse", key: "RING_PULSE" },
            { value: 4, label: "VISAGE.RingConfig.Effects.Gradient", key: "RING_GRADIENT" },
            { value: 8, label: "VISAGE.RingConfig.Effects.Wave", key: "BKG_WAVE" },
            { value: 16, label: "VISAGE.RingConfig.Effects.Invisibility", key: "INVISIBILITY" }
        ];

        const flags = {
            hasPulse: (currentEffects & 2) !== 0,
            hasGradient: (currentEffects & 4) !== 0,
            hasWave: (currentEffects & 8) !== 0,
            hasInvisibility: (currentEffects & 16) !== 0
        };

        return {
            enabled: data.enabled ?? false,
            colors: {
                ring: data.colors?.ring ?? "#FFFFFF",
                background: data.colors?.background ?? "#000000"
            },
            subject: {
                texture: data.subject?.texture ?? "",
                scale: data.subject?.scale ?? 1.0
            },
            rawEffects: currentEffects, 
            ...flags, 
            effects: availableEffects.map(eff => ({
                ...eff,
                isActive: (currentEffects & eff.value) !== 0
            }))
        };
    }

    static initialize() {
        this.log("Initializing Visage");
        game.modules.get(this.MODULE_ID).api = {
            setVisage: this.setVisage.bind(this),
            getForms: this.getForms.bind(this), // Maintained for backward compatibility
            isFormActive: this.isFormActive.bind(this),
            resolvePath: this.resolvePath.bind(this)
        };
    }

    /**
     * Retrieves normalized visage data. 
     * Delegates to VisageData.getLocal for the actual logic.
     */
    static getVisages(actor) {
        return VisageData.getLocal(actor);
    }

    static async setVisage(actorId, tokenId, formKey) {
        const token = canvas.tokens.get(tokenId);
        if (!token) return;
        const actor = token.actor;

        let baseUpdate = null;

        if (formKey === "default") {
            const ns = this.DATA_NAMESPACE;
            const savedDefaults = actor.flags?.[ns]?.[tokenId]?.defaults || {};
            const proto = actor.prototypeToken;
            
            const defScale = savedDefaults.scale ?? proto.texture.scaleX ?? 1.0;
            const defScaleY = savedDefaults.scaleY ?? proto.texture.scaleY ?? 1.0;
            
            const flipX = savedDefaults.isFlippedX ?? (defScale < 0);
            const flipY = savedDefaults.isFlippedY ?? (defScaleY < 0);
            
            const absScaleX = Math.abs(defScale);
            const absScaleY = Math.abs(defScale); 

            baseUpdate = {
                name: savedDefaults.name || proto.name,
                texture: {
                    src: savedDefaults.token || proto.texture.src,
                    scaleX: absScaleX * (flipX ? -1 : 1),
                    scaleY: absScaleY * (flipY ? -1 : 1)
                },
                width: savedDefaults.width || proto.width || 1,
                height: savedDefaults.height || proto.height || 1,
                disposition: savedDefaults.disposition ?? proto.disposition ?? 0,
                ring: savedDefaults.ring || (proto.ring?.toObject ? proto.ring.toObject() : proto.ring) || {}
            };

        } else {
            const visages = VisageData.getLocal(actor);
            const target = visages.find(v => v.id === formKey);
            
            if (!target) {
                console.warn(`Visage | Could not find form data for key: ${formKey}`);
                return;
            }
            
            const c = foundry.utils.deepClone(target.changes);
            c.texture.src = await this.resolvePath(c.img);
            delete c.img; 
            
            if (!c.ring) c.ring = { enabled: false };
            else {
                c.ring = {
                     enabled: c.ring.enabled === true,
                     colors: c.ring.colors,
                     effects: c.ring.effects,
                     subject: c.ring.subject
                };
            }
            baseUpdate = c;
        }

        const flagKey = `flags.${this.DATA_NAMESPACE}.${tokenId}.currentFormKey`;
        await token.actor.update({ [flagKey]: formKey });

        const { VisageComposer } = await import("./visage-composer.js");
        await VisageComposer.compose(token, null, baseUpdate);
    }

    static async applyGlobalVisage(token, globalVisageData) {
        if (!token || !globalVisageData) return;
        const doc = (token instanceof Token) ? token.document : token;

        const layer = {
            id: globalVisageData.id,
            label: globalVisageData.label,
            changes: foundry.utils.deepClone(globalVisageData.changes),
            active: true
        };
        
        if (layer.changes.img) {
            layer.changes.texture = layer.changes.texture || {};
            layer.changes.texture.src = await this.resolvePath(layer.changes.img);
            delete layer.changes.img;
        }
        
        if (layer.changes.ring) {
            layer.changes.ring = {
                 enabled: layer.changes.ring.enabled === true,
                 colors: layer.changes.ring.colors,
                 effects: layer.changes.ring.effects,
                 subject: layer.changes.ring.subject
            };
        }

        const ns = this.DATA_NAMESPACE;
        let stack = foundry.utils.deepClone(
            doc.getFlag(ns, "activeStack") || doc.getFlag(ns, "stack") || []
        );

        const existingIndex = stack.findIndex(l => l.id === layer.id);
        if (existingIndex > -1) stack[existingIndex] = layer; 
        else stack.push(layer); 

        await doc.setFlag(ns, "activeStack", stack);

        const { VisageComposer } = await import("./visage-composer.js");
        await VisageComposer.compose(token);
        
        ui.notifications.info(game.i18n.format("VISAGE.Notifications.Applied", { 
            label: layer.label 
        }));
    }

    static getForms(actorId, tokenId = null) {
        const actor = game.actors.get(actorId);
        if (!actor) return null;

        let defaults;
        if (tokenId) defaults = actor.flags?.[this.DATA_NAMESPACE]?.[tokenId]?.defaults;
        
        if (!defaults) {
            const proto = actor.prototypeToken;
            defaults = { 
                name: proto.name, 
                token: proto.texture.src,
                ring: proto.ring 
            };
        }

        const normalizedVisages = VisageData.getLocal(actor);
        if (!normalizedVisages.length) return null;

        return normalizedVisages.map(data => {
            const c = data.changes;
            const absScale = Math.abs(c.texture?.scaleX || 1);
            return {
                key: data.id,
                name: c.name || defaults.name,
                path: c.img || defaults.token,
                scale: absScale,
                disposition: c.disposition,
                ring: c.ring,
                width: c.width,
                height: c.height
            };
        });
    }

    static isFormActive(actorId, tokenId, formKey) {
        const actor = game.actors.get(actorId);
        const currentFormKey = actor?.flags?.[this.DATA_NAMESPACE]?.[tokenId]?.currentFormKey;
        if (currentFormKey === undefined && formKey === 'default') return true;
        return currentFormKey === formKey;
    }

    static async handleTokenUpdate(tokenDocument, change, options, userId) {
        if (options.visageUpdate) return;
        if (game.user.id !== userId) return;

        const actor = tokenDocument.actor;
        if (!actor) return;
        const tokenId = tokenDocument.id;

        // PART A: CAPTURE DEFAULTS
        const hasChangedName = "name" in change;
        const hasChangedTextureSrc = "texture" in change && "src" in change.texture;
        const hasChangedTextureScale = "texture" in change && ("scaleX" in change.texture || "scaleY" in change.texture);
        const hasChangedDisposition = "disposition" in change;
        const hasChangedRing = "ring" in change;
        const hasChangedSize = "width" in change || "height" in change;

        if (hasChangedName || hasChangedTextureSrc || hasChangedTextureScale || hasChangedDisposition || hasChangedRing || hasChangedSize) {
            const updateData = {};

            if (hasChangedName) updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.name`] = change.name;
            if (hasChangedTextureSrc) updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.token`] = change.texture.src;
            if (hasChangedTextureScale) {
                const newScale = change.texture.scaleX ?? change.texture.scaleY; 
                if (newScale !== undefined) updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.scale`] = newScale;
            }
            if (hasChangedDisposition) updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.disposition`] = change.disposition;
            if (hasChangedRing) updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.ring`] = change.ring;
            if (hasChangedSize) {
                if ("width" in change) updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.width`] = change.width;
                if ("height" in change) updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.height`] = change.height;
            }

            if (Object.keys(updateData).length > 0) {
                actor.update(updateData);
            }
        }

        // PART B: MAINTAIN GLOBAL STACK
        const flags = tokenDocument.flags[this.MODULE_ID] || {};
        const stack = flags.activeStack || flags.stack || [];

        if (stack.length > 0) {
            const { VisageComposer } = await import("./visage-composer.js");
            let base = flags.originalState;
            if (!base) {
                base = VisageComposer._captureSnapshot(tokenDocument.object);
            }
            const newBase = foundry.utils.mergeObject(base, change, { 
                insertKeys: false, 
                inplace: false 
            });
            await VisageComposer.compose(tokenDocument.object, null, newBase);
        }
    }
}