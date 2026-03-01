import { VisageUtilities } from "../../utils/visage-utilities.js";
import { MODULE_ID } from "../../core/visage-constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class VisageMediaTimeline extends HandlebarsApplicationMixin(
    ApplicationV2,
) {
    constructor(options = {}) {
        super(options);
        // The parent Editor instance this timeline controls
        this.editor = options.editor;

        // Define the viewport time range (e.g., -3 seconds to +5 seconds)
        this.timeMin = -3.0;
        this.timeMax = 5.0;
        this.duration = this.timeMax - this.timeMin;

        // Constants for Swimlane Calculation
        this.LANE_HEIGHT = 35;
        this.COLLISION_BUFFER = 0.8; // Estimated visual width of a block in seconds
    }

    static DEFAULT_OPTIONS = {
        tag: "div",
        id: "visage-media-timeline",
        classes: ["visage", "visage-timeline-app", "visage-dark-theme"],
        window: {
            title: "VISAGE.Editor.Timeline.Title",
            icon: "visage-icon timeline",
            resizable: true,
        },
        position: { width: 800, height: "auto" },
    };

    static PARTS = {
        timeline: {
            template:
                "modules/visage/templates/helpers/visage-media-timeline.hbs",
        },
    };

    /**
     * Pulls the live effect array from the Editor and calculates positions and swimlanes.
     */
    async _prepareContext() {
        if (!this.editor) return {};

        // Robust data extraction from the Editor's Single Source of Truth
        const editorData =
            typeof this.editor._prepareSaveData === "function"
                ? this.editor._prepareSaveData()
                : this.editor._preservedData;

        const rawEffects = editorData?.changes?.effects || [];

        // Bulletproof filter to catch both booleans and strings
        const activeEffects = rawEffects.filter((e) => {
            const isDisabled =
                e.disabled === true ||
                String(e.disabled).toLowerCase() === "true";
            return !isDisabled;
        });

        const visualEffects = activeEffects.filter(
            (e) => String(e.type).toLowerCase() === "visual",
        );
        const audioEffects = activeEffects.filter(
            (e) => String(e.type).toLowerCase() === "audio",
        );

        // Calculate Rulers (Every 1 second)
        const ticks = [];
        for (
            let t = Math.ceil(this.timeMin);
            t <= Math.floor(this.timeMax);
            t++
        ) {
            ticks.push({
                label: t === 0 ? "0.0s" : `${t > 0 ? "+" : ""}${t}.0s`,
                position: this._timeToPercent(t),
                isZero: t === 0,
            });
        }

        // Apply Event Packing (Swimlane Math)
        const processedVisual = this._packLanes(visualEffects);
        const processedAudio = this._packLanes(audioEffects);

        return {
            ticks,
            zeroPosition: this._timeToPercent(0),
            visualEffects: processedVisual.effects,
            visualHeight: Math.max(1, processedVisual.lanes) * this.LANE_HEIGHT,
            audioEffects: processedAudio.effects,
            audioHeight: Math.max(1, processedAudio.lanes) * this.LANE_HEIGHT,
        };
    }

    /**
     * The "Event Packing" Algorithm.
     * Places blocks into rows ensuring no two blocks overlap horizontally.
     */
    _packLanes(effects) {
        // Sort chronologically
        const sorted = foundry.utils
            .deepClone(effects)
            .sort((a, b) => (a.delay || 0) - (b.delay || 0));
        const lanes = [];

        sorted.forEach((eff) => {
            const delay = eff.delay || 0;
            let placed = false;

            // Find the first lane where this effect fits
            for (let i = 0; i < lanes.length; i++) {
                const lastInLane = lanes[i][lanes[i].length - 1];
                if (delay >= (lastInLane.delay || 0) + this.COLLISION_BUFFER) {
                    lanes[i].push(eff);
                    eff.top = i * this.LANE_HEIGHT;
                    placed = true;
                    break;
                }
            }

            // If it didn't fit in any existing lane, create a new one
            if (!placed) {
                lanes.push([eff]);
                eff.top = (lanes.length - 1) * this.LANE_HEIGHT;
            }

            eff.position = this._timeToPercent(delay);
            eff.delay = delay; // Ensure default 0 is explicitly set
        });

        return { effects: sorted, lanes: lanes.length };
    }

    _timeToPercent(time) {
        const clamped = Math.max(this.timeMin, Math.min(time, this.timeMax));
        return ((clamped - this.timeMin) / this.duration) * 100;
    }

    /**
     * Binds the custom 1D Drag Logic to the blocks.
     */
    _onRender(context, options) {
        // Inherit theme from parent Editor
        VisageUtilities.applyVisageTheme(this.element, this.editor?.isLocal);

        const trackArea = this.element.querySelector(".timeline-tracks");
        const blocks = this.element.querySelectorAll(".timeline-block");

        blocks.forEach((block) => {
            block.addEventListener("pointerdown", (e) =>
                this._onDragStart(e, block, trackArea),
            );
        });
    }

    _onDragStart(e, block, trackArea) {
        e.preventDefault();
        e.stopPropagation();

        const effectId = block.dataset.id;
        const trackRect = trackArea.getBoundingClientRect();

        // ROBUST EXTRACTION: Safely get the active effects without crashing
        const editorData =
            typeof this.editor._prepareSaveData === "function"
                ? this.editor._prepareSaveData()
                : this.editor._preservedData || {};

        const effectsArray = editorData?.changes?.effects || [];
        const effectRef = effectsArray.find((eff) => eff.id === effectId);
        if (!effectRef) return;

        const startDelay = effectRef.delay || 0;
        const startX = e.clientX;
        const isRTL = this.element.closest(".visage").dir === "rtl";

        const onMove = (moveEvent) => {
            let deltaX = moveEvent.clientX - startX;
            if (isRTL) deltaX *= -1;

            const percentMoved = deltaX / trackRect.width;
            const timeMoved = percentMoved * this.duration;

            let newDelay = Math.round((startDelay + timeMoved) * 10) / 10;
            newDelay = Math.max(this.timeMin, Math.min(newDelay, this.timeMax));

            block.style.insetInlineStart = `${this._timeToPercent(newDelay)}%`;
            block.dataset.tooltip = `${effectRef.label} (${newDelay}s)`;
            block.dataset.tempDelay = newDelay;
        };

        const onDrop = async () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onDrop);

            const finalDelay = parseFloat(
                block.dataset.tempDelay ?? startDelay,
            );

            if (finalDelay !== startDelay) {
                if (!this.editor._preservedData)
                    this.editor._preservedData = {};
                if (!this.editor._preservedData.changes)
                    this.editor._preservedData.changes = {};
                if (!this.editor._preservedData.changes.effects) {
                    this.editor._preservedData.changes.effects =
                        foundry.utils.deepClone(effectsArray);
                }

                const memoryEffects =
                    this.editor._preservedData.changes.effects;
                const targetMemoryRef = memoryEffects.find(
                    (eff) => eff.id === effectId,
                );

                if (targetMemoryRef) {
                    targetMemoryRef.delay = finalDelay;

                    if (typeof this.editor._markDirty === "function") {
                        this.editor._markDirty();
                    }
                }

                // 1. Render the Editor first (which pulls the Editor to the front)
                if (this.editor.rendered) {
                    await this.editor.render({ force: true });
                }

                // 2. Render the Timeline
                await this.render({ force: true });

                // 3. Force the Timeline back to the absolute top of the screen
                this.bringToFront();
            }
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onDrop);
    }
}
