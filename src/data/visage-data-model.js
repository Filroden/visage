const { StringField, NumberField, BooleanField, ObjectField, ArrayField, SchemaField, DataField, ColorField } = foundry.data.fields;

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
            label: new StringField({ required: true, initial: "New Visage", label: "VISAGE.GlobalEditor.Label" }),
            category: new StringField({ required: false, nullable: true, label: "VISAGE.GlobalEditor.Category" }),
            tags: new ArrayField(new StringField(), { initial: [], label: "VISAGE.GlobalEditor.Tags" }),
            mode: new StringField({ required: true, initial: "identity", choices: ["identity", "overlay"], label: "VISAGE.GlobalEditor.Mode" }),
            public: new BooleanField({ initial: false, label: "VISAGE.GlobalEditor.Visibility" }),
            deleted: new BooleanField({ initial: false }),
            updated: new NumberField({ required: false, nullable: true, integer: true }),

            automation: new SchemaField(
                {
                    enabled: new BooleanField({ initial: false, label: "VISAGE.Editor.Triggers.Enable" }),
                    logic: new StringField({ initial: "AND", choices: ["AND", "OR"], label: "VISAGE.Editor.Triggers.LogicHint" }),

                    onEnter: new SchemaField({
                        action: new StringField({ initial: "apply", choices: ["apply", "remove"] }),
                        priority: new NumberField({ initial: 0, label: "VISAGE.Editor.Triggers.Priority" }),
                    }),

                    onExit: new SchemaField({
                        action: new StringField({ initial: "remove", choices: ["apply", "remove"] }),
                        priority: new NumberField({ initial: 0, label: "VISAGE.Editor.Triggers.Priority" }),
                    }),

                    conditions: new ArrayField(
                        new SchemaField({
                            id: new StringField({ required: true, blank: false }),
                            disabled: new BooleanField({ initial: false }),
                            type: new StringField({ required: true, choices: ["attribute", "status", "event"] }),
                            operator: new StringField({ required: false, nullable: true, label: "VISAGE.Editor.Triggers.Operator" }),

                            // --- Attribute Condition Properties ---
                            path: new StringField({ required: false, nullable: true, label: "VISAGE.Editor.Triggers.DataPath" }),
                            dataType: new StringField({ required: false, nullable: true, choices: ["boolean", "string", "number"], label: "VISAGE.Editor.Triggers.DataType" }),
                            mode: new StringField({ required: false, nullable: true, choices: ["percent", "absolute"], label: "VISAGE.Editor.Triggers.Mode" }),
                            denominatorPath: new StringField({ required: false, nullable: true, label: "VISAGE.Editor.Triggers.DenominatorPath" }),
                            value: new DataField({ required: false, nullable: true, label: "VISAGE.Editor.Triggers.Value" }),

                            // --- Status Condition Properties ---
                            statusId: new StringField({ required: false, nullable: true, label: "VISAGE.Editor.Triggers.StatusId" }),
                            customStatus: new StringField({ required: false, nullable: true, label: "VISAGE.Editor.Triggers.CustomStatusName" }),

                            // --- Event Condition Properties ---
                            eventId: new StringField({
                                required: false,
                                nullable: true,
                                choices: ["combat", "targeted", "facing", "elevation", "globalLight", "darkness", "region", "time", "weather"],
                                label: "VISAGE.Editor.Triggers.EventId",
                            }),
                            startAngle: new NumberField({ required: false, nullable: true, label: "VISAGE.Editor.Triggers.AngleStart" }),
                            endAngle: new NumberField({ required: false, nullable: true, label: "VISAGE.Editor.Triggers.AngleEnd" }),
                            regionId: new StringField({ required: false, nullable: true, label: "VISAGE.Editor.Triggers.RegionId" }),
                            startTime: new StringField({ required: false, nullable: true, label: "VISAGE.Editor.Triggers.StartTime" }),
                            endTime: new StringField({ required: false, nullable: true, label: "VISAGE.Editor.Triggers.EndTime" }),
                            weatherId: new StringField({ required: false, nullable: true, label: "VISAGE.Editor.Triggers.WeatherId" }),
                            customWeather: new StringField({ required: false, nullable: true, label: "VISAGE.Editor.Triggers.CustomWeather" }),
                        }),
                        { initial: [], label: "VISAGE.Editor.Triggers.Conditions" },
                    ),
                },
                { required: false, nullable: true, label: "VISAGE.Editor.Tabs.Triggers" },
            ),

            // ==========================================
            // 2. THE VISUAL PAYLOAD (The Token/Actor Changes)
            // ==========================================

            changes: new SchemaField({
                // FOUNDRY PROPERTIES:
                name: new StringField({ required: false, nullable: true, label: "VISAGE.GlobalEditor.NameOverride" }),
                width: new NumberField({ required: false, nullable: true, initial: null, min: 0.5, step: 0.5, label: "VISAGE.Config.List.Width" }),
                height: new NumberField({ required: false, nullable: true, initial: null, min: 0.5, step: 0.5, label: "VISAGE.Config.List.Height" }),
                depth: new NumberField({ required: false, nullable: true, initial: null, min: 0.5, step: 0.5, label: "VISAGE.Config.List.DimZ" }),
                alpha: new NumberField({ required: false, nullable: true, initial: null, min: 0, max: 1, label: "VISAGE.Config.Opacity.Label" }),
                lockRotation: new BooleanField({ required: false, nullable: true, initial: null, label: "VISAGE.RotationLock.Label" }),
                animateTransition: new BooleanField({ initial: null, required: false, nullable: true, label: "VISAGE.GlobalEditor.AnimateTransition" }),
                disposition: new NumberField({
                    required: false,
                    nullable: true,
                    initial: null,
                    choices: [-2, -1, 0, 1],
                    label: "VISAGE.Disposition.Label",
                }),

                texture: new SchemaField({
                    src: new StringField({ required: false, nullable: true, label: "VISAGE.GlobalEditor.TokenImage" }),
                    scaleX: new NumberField({ initial: 1 }),
                    scaleY: new NumberField({ initial: 1 }),
                    anchorX: new NumberField({ required: false, nullable: true, initial: null, label: "VISAGE.Config.List.Anchor" }),
                    anchorY: new NumberField({ required: false, nullable: true, initial: null, label: "VISAGE.Config.List.Anchor" }),
                }),

                ring: new SchemaField(
                    {
                        enabled: new BooleanField({ initial: false, label: "VISAGE.GlobalEditor.RingEnable" }),
                        colors: new SchemaField({
                            ring: new ColorField({ required: false, nullable: true, initial: null, label: "VISAGE.RingConfig.RingColor" }),
                            background: new ColorField({ required: false, nullable: true, initial: null, label: "VISAGE.RingConfig.BackgroundColor" }),
                        }),
                        subject: new SchemaField({
                            texture: new StringField({ required: false, nullable: true, initial: null, label: "VISAGE.RingConfig.SubjectTexture" }),
                            scale: new NumberField({ initial: 1, label: "VISAGE.RingConfig.SubjectScale" }),
                        }),
                        effects: new NumberField({ initial: 0, integer: true, label: "VISAGE.RingConfig.Effects.Label" }),
                    },
                    { required: false, nullable: true, label: "VISAGE.Editor.Tabs.Ring" },
                ),

                light: new ObjectField({ initial: {}, label: "VISAGE.Editor.Light.SettingsTitle" }),
                portrait: new StringField({ required: false, nullable: true, label: "VISAGE.GlobalEditor.ActorPortrait" }),

                // CUSTOM VISAGE PROPERTIES:
                scale: new NumberField({ min: 0.01, required: false, nullable: true, label: "VISAGE.Config.List.Scale" }),
                mirrorX: new BooleanField({ required: false, nullable: true, label: "VISAGE.Mirror.Label.Horizontal" }),
                mirrorY: new BooleanField({ required: false, nullable: true, label: "VISAGE.Mirror.Label.Vertical" }),

                effects: new ArrayField(
                    new SchemaField({
                        // Universal Properties
                        id: new StringField({ required: true, blank: false }),
                        type: new StringField({
                            required: true,
                            choices: ["visual", "audio", "macro", "tmfx"],
                        }),
                        label: new StringField({ required: true, initial: "New Effect", label: "VISAGE.Editor.Effects.NamePlaceholder" }),
                        disabled: new BooleanField({ initial: false }),
                        delay: new NumberField({ initial: 0, label: "VISAGE.Editor.Effects.Delay" }),

                        // Visual & Audio Properties
                        path: new StringField({ required: false, nullable: true, label: "VISAGE.Editor.Effects.Path" }),
                        scale: new NumberField({ initial: 1, nullable: true, label: "VISAGE.Config.List.Scale" }),
                        opacity: new NumberField({ initial: 1, min: 0, max: 1, nullable: true, label: "VISAGE.Config.Opacity.Label" }),
                        bindRotation: new BooleanField({ initial: true, label: "VISAGE.Editor.Effects.BindRotation" }),
                        bindToSprite: new BooleanField({ initial: false, label: "VISAGE.Editor.Effects.BindToSprite" }),
                        offsetX: new NumberField({ initial: 0, nullable: true, label: "VISAGE.Editor.Effects.OffsetX" }),
                        offsetY: new NumberField({ initial: 0, nullable: true, label: "VISAGE.Editor.Effects.OffsetY" }),
                        rotation: new NumberField({ initial: 0, nullable: true, label: "VISAGE.Rotation.Label" }),
                        rotationRandom: new BooleanField({ initial: false }),
                        tint: new ColorField({ required: false, nullable: true, initial: null, label: "VISAGE.Editor.Effects.Tint" }),
                        zOrder: new StringField({ required: false, nullable: true, choices: ["above", "below"], label: "VISAGE.Editor.Effects.Layering" }),
                        loop: new BooleanField({ initial: false, label: "VISAGE.Editor.Effects.Loop" }),
                        fadeIn: new NumberField({ initial: 0, label: "VISAGE.Editor.Effects.FadeIn" }),
                        fadeOut: new NumberField({ initial: 0, label: "VISAGE.Editor.Effects.FadeOut" }),
                        maskToToken: new BooleanField({ initial: false, required: false, label: "VISAGE.Editor.Effects.MaskToToken" }),
                        constrainedByWalls: new BooleanField({ initial: false, required: false, label: "VISAGE.Editor.Effects.ConstrainedByWalls" }),
                        fadeEase: new StringField({ initial: null, required: false, nullable: true, label: "VISAGE.Editor.Effects.FadeEase" }),
                        scaleEase: new StringField({ initial: null, required: false, nullable: true, label: "VISAGE.Editor.Effects.ScaleEase" }),
                        scaleIn: new NumberField({ initial: null, required: false, nullable: true, label: "VISAGE.Editor.Effects.ScaleIn" }),
                        scaleInDuration: new NumberField({ initial: null, required: false, nullable: true, label: "VISAGE.Editor.Effects.ScaleInDuration" }),

                        // Macro Properties
                        uuid: new StringField({ required: false, nullable: true, label: "VISAGE.Editor.Effects.MacroUUID" }),

                        // TMFX Properties
                        tmfxPreset: new StringField({ required: false, nullable: true, label: "VISAGE.Editor.Effects.TmfxPreset" }),
                        tmfxPayload: new StringField({ required: false, nullable: true, label: "VISAGE.Editor.Effects.TmfxPayload" }),
                    }),
                    { initial: [], label: "VISAGE.Editor.Tabs.Effects" },
                ),

                // THIRD-PARTY INTEGRATION DATA
                flags: new SchemaField(
                    {
                        "dylans-animated-tokens": new SchemaField(
                            {
                                spritesheet: new BooleanField({
                                    initial: false,
                                    label: "VISAGE.Editor.DAT.SpriteSheet",
                                }),
                                sheetstyle: new StringField({
                                    initial: "dlru",
                                    label: "VISAGE.Editor.DAT.SheetStyle",
                                }),
                                separateidle: new BooleanField({
                                    initial: false,
                                    label: "VISAGE.Editor.DAT.SeparateIdle",
                                }),
                                // Prevent cleansing of implicit/inferred properties during state capture
                                sheetsrc: new StringField({
                                    required: false,
                                    nullable: true,
                                    initial: null,
                                }),
                                animationframes: new NumberField({
                                    required: false,
                                    nullable: true,
                                    initial: null,
                                    integer: true,
                                }),
                                noidle: new BooleanField({
                                    initial: false,
                                }),
                                dirorder: new ArrayField(new StringField(), {
                                    initial: null,
                                    nullable: true,
                                }),
                                animlist: new ArrayField(new ArrayField(new DataField()), {
                                    initial: null,
                                    nullable: true,
                                }),
                                unlockedanchor: new BooleanField({
                                    initial: false,
                                }),
                                unlockedfit: new BooleanField({
                                    initial: false,
                                }),
                            },
                            { required: false, nullable: true },
                        ),
                    },
                    { required: false, nullable: true },
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
