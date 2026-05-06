const { StringField, NumberField, BooleanField, ObjectField, ArrayField, SchemaField, DataField } = foundry.data.fields;

/**
 * Represents the unified data structure for a Visage.
 * Acts as the single source of truth for saving, validating, and formatting
 * Visage metadata, automation rules, and visual token/actor permutations.
 *
 * @extends {foundry.abstract.DataModel}
 */
export class VisageDataModel extends foundry.abstract.DataModel {
    // 1. Define the Unified Schema (Everything a Visage represents)
    static defineSchema() {
        return {
            // ==========================================
            // 1. ROOT PROPERTIES (Visage Metadata)
            // ==========================================
            id: new StringField({ required: false, nullable: true }),
            label: new StringField({ required: true, initial: "New Visage" }),
            category: new StringField({ required: false, nullable: true }),
            tags: new ArrayField(new StringField(), { initial: [] }),
            mode: new StringField({ required: true, initial: "identity", choices: ["identity", "overlay"] }),
            public: new BooleanField({ initial: false }),
            deleted: new BooleanField({ initial: false }),

            automation: new SchemaField(
                {
                    enabled: new BooleanField({ initial: false }),
                    logic: new StringField({ initial: "AND", choices: ["AND", "OR"] }),

                    onEnter: new SchemaField({
                        action: new StringField({ initial: "apply", choices: ["apply", "remove"] }),
                        priority: new NumberField({ initial: 0 }),
                    }),

                    onExit: new SchemaField({
                        action: new StringField({ initial: "remove", choices: ["apply", "remove"] }),
                        priority: new NumberField({ initial: 0 }),
                    }),

                    conditions: new ArrayField(
                        new SchemaField({
                            id: new StringField({ required: true, blank: false }),
                            disabled: new BooleanField({ initial: false }),
                            type: new StringField({ required: true, choices: ["attribute", "status", "event"] }),
                            operator: new StringField({ required: false, nullable: true }),

                            // --- Attribute Condition Properties ---
                            path: new StringField({ required: false, nullable: true }),
                            dataType: new StringField({ required: false, nullable: true, choices: ["boolean", "string", "number"] }),
                            mode: new StringField({ required: false, nullable: true, choices: ["percent", "absolute"] }),
                            denominatorPath: new StringField({ required: false, nullable: true }),
                            value: new DataField({ required: false, nullable: true }),

                            // --- Status Condition Properties ---
                            statusId: new StringField({ required: false, nullable: true }),
                            customStatus: new StringField({ required: false, nullable: true }),

                            // --- Event Condition Properties ---
                            eventId: new StringField({
                                required: false,
                                nullable: true,
                                choices: ["combat", "targeted", "facing", "elevation", "globalLight", "darkness", "region", "time", "weather"],
                            }),
                            startAngle: new NumberField({ required: false, nullable: true }),
                            endAngle: new NumberField({ required: false, nullable: true }),
                            regionId: new StringField({ required: false, nullable: true }),
                            startTime: new StringField({ required: false, nullable: true }),
                            endTime: new StringField({ required: false, nullable: true }),
                            weatherId: new StringField({ required: false, nullable: true }),
                            customWeather: new StringField({ required: false, nullable: true }),
                        }),
                        { initial: [] },
                    ),
                },
                { required: false, nullable: true },
            ),

            // ==========================================
            // 2. THE VISUAL PAYLOAD (The Token/Actor Changes)
            // ==========================================

            changes: new SchemaField({
                // FOUNDRY PROPERTIES:
                name: new StringField({ required: false, nullable: true }),
                width: new NumberField({ initial: 1, min: 0.5, step: 0.5 }),
                height: new NumberField({ initial: 1, min: 0.5, step: 0.5 }),
                depth: new NumberField({ initial: 1, min: 1, step: 1 }),
                alpha: new NumberField({ initial: 1, min: 0, max: 1 }),
                lockRotation: new BooleanField({ initial: false }),
                disposition: new NumberField({
                    initial: 0,
                    choices: [-2, -1, 0, 1],
                }),

                texture: new foundry.data.fields.SchemaField({
                    src: new StringField({ required: false, nullable: true }),
                    scaleX: new NumberField({ initial: 1 }),
                    scaleY: new NumberField({ initial: 1 }),
                    anchorX: new NumberField({ initial: 0.5 }),
                    anchorY: new NumberField({ initial: 0.5 }),
                }),

                ring: new ObjectField({ initial: {} }),
                light: new ObjectField({ initial: {} }),
                portrait: new StringField({ required: false, nullable: true }),

                // CUSTOM VISAGE PROPERTIES:
                scale: new NumberField({ required: false, nullable: true }),
                mirrorX: new BooleanField({ required: false, nullable: true }),
                mirrorY: new BooleanField({ required: false, nullable: true }),

                effects: new ArrayField(
                    new SchemaField({
                        // Universal Properties
                        id: new StringField({ required: true, blank: false }),
                        type: new StringField({
                            required: true,
                            choices: ["visual", "audio", "macro", "tmfx"],
                        }),
                        label: new StringField({ required: true, initial: "New Effect" }),
                        disabled: new BooleanField({ initial: false }),
                        delay: new NumberField({ initial: 0, min: 0 }),

                        // Visual & Audio Properties
                        path: new StringField({ required: false, nullable: true }),
                        scale: new NumberField({ initial: 1, nullable: true }),
                        opacity: new NumberField({ initial: 1, min: 0, max: 1, nullable: true }),
                        rotation: new NumberField({ initial: 0, nullable: true }),
                        rotationRandom: new BooleanField({ initial: false }),
                        zOrder: new StringField({ required: false, nullable: true, choices: ["above", "below"] }),
                        loop: new BooleanField({ initial: true }),
                        fadeIn: new NumberField({ initial: 0 }),
                        fadeOut: new NumberField({ initial: 0 }),

                        // Macro Properties
                        uuid: new StringField({ required: false, nullable: true }),

                        // TMFX Properties
                        tmfxPreset: new StringField({ required: false, nullable: true }),
                        tmfxPayload: new StringField({ required: false, nullable: true }),
                    }),
                    { initial: [] },
                ),
            }),
        };
    }

    /**
     * Extracts and formats the visual properties destined for a Token Document update.
     * Safely applies Visage-specific scale overrides and ignores Actor-specific data.
     *
     * @returns {Object} A sanitised, flat payload ready for Token.update()
     */
    getTokenPayload() {
        // Isolate the visual changes payload
        const rawChanges = this.toObject().changes;
        const payload = {};

        // A. Handle simple root properties via a mapping array
        const rootKeys = ["name", "width", "height", "depth", "alpha", "lockRotation", "disposition", "ring", "light", "effects"];

        for (const key of rootKeys) {
            if (rawChanges[key] !== null) payload[key] = rawChanges[key];
        }

        // B. Handle basic texture properties
        const texKeys = ["src", "anchorX", "anchorY"];
        for (const key of texKeys) {
            if (rawChanges.texture[key] !== null) {
                payload[`texture.${key}`] = rawChanges.texture[key];
            }
        }

        // C. Handle Scale Override vs Native Fallback
        this._applyScaleToPayload(rawChanges, payload);

        return payload;
    }

    /**
     * Extracts properties destined for an Actor Document update (e.g., prototype token updates or portraits).
     *
     * @returns {Object} A sanitised payload ready for Actor.update()
     */
    getActorPayload() {
        const payload = {};

        // Target the nested changes object
        if (this.changes.portrait) {
            payload.img = this.changes.portrait;
        }

        return payload;
    }

    /**
     * Helper to process scale inheritance and atomic overrides.
     * Extracts complexity to maintain low cognitive load metrics.
     *
     * @param {Object} rawChanges - The raw, validated changes object from the model.
     * @param {Object} payload - The mutable payload object being constructed.
     * @private
     */
    _apply;
    _applyScaleToPayload(raw, payload) {
        // Fallback: No override exists, pass the native values through
        if (raw.scale === null) {
            if (raw.texture.scaleX !== null) payload["texture.scaleX"] = raw.texture.scaleX;
            if (raw.texture.scaleY !== null) payload["texture.scaleY"] = raw.texture.scaleY;
            return;
        }

        // Override: Apply the custom Visage scalar while preserving the native mirror signs
        const signX = raw.texture.scaleX < 0 ? -1 : 1;
        const signY = raw.texture.scaleY < 0 ? -1 : 1;

        payload["texture.scaleX"] = raw.scale * signX;
        payload["texture.scaleY"] = raw.scale * signY;
    }
}
