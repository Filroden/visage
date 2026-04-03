import { VisageData } from "../data/visage-data.js";
import { MODULE_ID } from "./visage-constants.js";

/**
 * The Visage Automation Engine (Watcher).
 * A singleton responsible for listening to game state changes and
 * automatically applying or removing Visages based on defined conditions.
 */
export class VisageAutomation {
    /**
     * The active registry of tokens being watched.
     * Structure: Map<tokenId, { actorId: string, visages: Array, stateCache: Object }>
     */
    static _registry = new Map();

    /**
     * A queue to debounce rapid token updates (like scroll-wheel rotation) on a per-token basis.
     * Structure: Map<tokenId, timeoutId>
     */
    static _evaluationQueue = new Map();

    static _lastEvaluatedMinute = null;

    /**
     * Initializes the Automation Engine.
     * Called once during the `ready` hook.
     */
    static initialize() {
        if (!game.user.isGM) return; // The Watcher only runs on the GM's machine to prevent race conditions

        // 1. Registry Maintenance Hooks
        Hooks.on("canvasReady", () => this.buildRegistry());
        Hooks.on("createToken", () => this.buildRegistry());
        Hooks.on("deleteToken", (token) => this._registry.delete(token.id));
        Hooks.on("visageDataChanged", () => this.buildRegistry()); // Custom hook you fire when saving a Visage

        // 2. Data Observation Hooks
        Hooks.on("updateActor", this._onUpdateActor.bind(this));
        Hooks.on("createActiveEffect", this._onStatusChange.bind(this));
        Hooks.on("updateActiveEffect", this._onStatusChange.bind(this));
        Hooks.on("deleteActiveEffect", this._onStatusChange.bind(this));

        // 3. Event Hooks
        Hooks.on("updateCombat", this._onCombatChange.bind(this));
        Hooks.on("deleteCombat", this._onCombatChange.bind(this));
        Hooks.on("updateToken", this._onUpdateToken.bind(this));
        Hooks.on("targetToken", this._onTargetToken.bind(this));
        Hooks.on("updateScene", this._onUpdateScene.bind(this));
        Hooks.on("updateWorldTime", this._onUpdateWorldTime.bind(this));

        console.log("Visage | Automation Engine Initialized.");
        this.buildRegistry();
    }

    /**
     * Scans the current canvas and builds the registry of tokens that have
     * active Automations configured in their Visages.
     */
    static buildRegistry() {
        // Save a reference to the old registry so we don't wipe our memory during saves
        const oldRegistry = new Map(this._registry);
        this._registry.clear();

        if (!canvas.ready) return;

        // Fetch all automated Global Visages to act as "Universal Rules"
        const globalAutomations = VisageData.globals.filter((v) => !v.deleted && v.automation?.enabled && v.automation?.conditions?.length > 0);

        for (const token of canvas.tokens.placeables) {
            if (!token.actor) continue;

            const localVisages = VisageData.getLocal(token.actor);
            const automatedVisages = localVisages.filter((v) => !v.deleted && v.automation?.enabled && v.automation?.conditions?.length > 0);

            // Combine the token's specific local automations with the universal global automations
            const combinedAutomations = [...automatedVisages, ...globalAutomations];

            if (combinedAutomations.length > 0) {
                // Preserve the region boundary cache to prevent false triggers on rebuild
                const oldRecord = oldRegistry.get(token.id);

                this._registry.set(token.id, {
                    actorId: token.actor.id,
                    visages: combinedAutomations,
                    _lastRegionState: oldRecord ? oldRecord._lastRegionState : undefined,
                });
            }
        }
    }

    // ==========================================
    // OBSERVATION HOOKS
    // ==========================================

    static _onUpdateActor(actor, changes, options, userId) {
        // Find tokens on the canvas linked to this actor that are in our registry
        const linkedTokens = canvas.tokens.placeables.filter((t) => t.actor?.id === actor.id && this._registry.has(t.id));
        if (!linkedTokens.length) return;

        for (const token of linkedTokens) {
            this._queueEvaluation(token.document);
        }
    }

    static _onStatusChange(effect, options, userId) {
        const actor = effect.parent?.documentName === "Item" ? effect.parent.parent : effect.parent;

        if (!actor || actor.documentName !== "Actor") return;

        const linkedTokens = canvas.tokens.placeables.filter((t) => t.actor?.id === actor.id && this._registry.has(t.id));
        if (!linkedTokens.length) return;

        for (const token of linkedTokens) {
            this._queueEvaluation(token.document);
        }
    }

    static _onCombatChange(combat, changes, options, userId) {
        for (const [tokenId, record] of this._registry.entries()) {
            const token = canvas.tokens.get(tokenId);
            if (token) this._queueEvaluation(token.document);
        }
    }

    static _onUpdateToken(tokenDoc, changes, options, userId) {
        if (!this._registry.has(tokenDoc.id)) return;

        // 1. Throttle: We MUST track X and Y again to detect horizontal movement
        if (changes.x === undefined && changes.y === undefined && changes.elevation === undefined && changes["-=elevation"] === undefined && changes.rotation === undefined) return;

        // 2. The Boundary Bypass Cache
        // Safely extract the IDs of the Regions the token is currently standing in
        const currentRegionIds = Array.from(tokenDoc.regions || [])
            .map((r) => r.id)
            .sort()
            .join(",");

        // Retrieve the last known regions from our registry (or initialise it to current)
        const registryEntry = this._registry.get(tokenDoc.id);
        const previousRegionIds = registryEntry._lastRegionState ?? currentRegionIds;
        registryEntry._lastRegionState = currentRegionIds; // Update the cache

        // 3. Evaluation Routing
        if (currentRegionIds !== previousRegionIds) {
            // BOUNDARY CROSSED: The core database confirms we entered/exited a region!
            // Bypass the animation queue and evaluate instantly so the trap triggers mid-stride.
            const token = tokenDoc.object;
            if (token) this._evaluate(token);
            return;
        }

        // NO BOUNDARY CROSSED: Normal movement within the same space.
        // Send to the queue to safely wait for animations to finish.
        this._queueEvaluation(tokenDoc);
    }

    static _onTargetToken(user, token, targeted) {
        if (this._registry.has(token.id)) {
            this._queueEvaluation(token.document);
        }
    }

    static _onUpdateScene(scene, changes) {
        if (scene.id !== canvas.scene?.id) return;

        const expanded = foundry.utils.expandObject(changes);

        if (
            expanded.environment?.darknessLevel !== undefined ||
            expanded.environment?.globalLight?.enabled !== undefined ||
            expanded.environment?.weather !== undefined ||
            expanded.weather !== undefined
        ) {
            for (const tokenId of this._registry.keys()) {
                const t = canvas.tokens.get(tokenId);
                if (t) this._queueEvaluation(t.document);
            }
        }
    }

    static _onUpdateWorldTime(worldTime, dt) {
        const currentMinute = Math.floor(worldTime / 60);
        if (this._lastEvaluatedMinute === currentMinute) return;

        this._lastEvaluatedMinute = currentMinute;

        for (const tokenId of this._registry.keys()) {
            const token = canvas.tokens.get(tokenId);
            if (token) this._queueEvaluation(token.document);
        }
    }

    // ==========================================
    // THE EVALUATION LOOP
    // ==========================================

    /**
     * Safely queues a token for evaluation, recursively waiting for any active
     * movement or PIXI drawing animations to finish before taking a state snapshot.
     * @param {TokenDocument} tokenDoc - The document of the token to evaluate.
     */
    static _queueEvaluation(tokenDoc) {
        if (!this._registry.has(tokenDoc.id)) return;

        // Clear any existing pending evaluation for this specific token
        if (this._evaluationQueue.has(tokenDoc.id)) {
            clearTimeout(this._evaluationQueue.get(tokenDoc.id));
        }

        // Recursive polling function to handle mid-redraw detachment and animations
        const attemptEvaluation = (attempts = 0) => {
            // Failsafe: abort after ~1000ms to prevent infinite loops
            if (attempts > 20) {
                this._evaluationQueue.delete(tokenDoc.id);
                return;
            }

            const freshToken = canvas.tokens.get(tokenDoc.id);

            // Check animation state natively
            const isAnimating = freshToken && freshToken.animationContexts && freshToken.animationContexts.size > 0;

            if (freshToken && !isAnimating) {
                this._evaluationQueue.delete(tokenDoc.id);
                this._evaluate(freshToken);
            } else {
                // Token is animating or rebuilding. Re-queue and try again.
                const timeoutId = setTimeout(() => attemptEvaluation(attempts + 1), 50);
                this._evaluationQueue.set(tokenDoc.id, timeoutId);
            }
        };

        // Queue the initial evaluation
        const timeoutId = setTimeout(() => attemptEvaluation(0), 40);
        this._evaluationQueue.set(tokenDoc.id, timeoutId);
    }

    /**
     * Evaluates all automated visages for a specific token and fires transitions.
     * @param {Token} token - The token to evaluate.
     */
    static async _evaluate(token) {
        const record = this._registry.get(token.id);
        if (!record) return;

        const actor = token.actor;
        const VisageApi = game.modules.get(MODULE_ID).api;

        // The transition queue for this evaluation cycle
        const queue = { apply: [], remove: [] };

        for (const visage of record.visages) {
            const auto = visage.automation;

            // 1. Resolve conditions
            let results = [];
            for (const cond of auto.conditions) {
                if (cond.disabled) continue;
                if (cond.type === "attribute") results.push(this._evalAttribute(actor, cond));
                else if (cond.type === "status") results.push(this._evalStatus(actor, cond));
                else if (cond.type === "event") results.push(this._evalEvent(token, cond));
            }

            if (results.length === 0) continue;

            // 2. Apply Logic (AND / OR)
            const isTrue = auto.logic === "AND" ? results.every((r) => r === true) : results.some((r) => r === true);

            // 3. True Declarative State Check
            // We bypass the fragile in-memory cache and check the exact canvas state!
            const isActive = await VisageApi.isActive(token.id, visage.id);

            if (isTrue && !isActive) {
                // Condition met, but visage missing -> Apply
                const action = auto.onEnter?.action || "apply";
                if (queue[action]) queue[action].push(visage);
            } else if (!isTrue && isActive) {
                // Condition failed, but visage present -> Remove
                const action = auto.onExit?.action || "remove";
                if (queue[action]) queue[action].push(visage);
            } else if (isTrue && isActive && visage.mode === "identity") {
                // Self-Healing Identity Rule
                const action = auto.onEnter?.action || "apply";
                if (action === "apply" && queue.apply) queue.apply.push(visage);
            }
        }

        // 4. Process the Queue (Removals first)
        for (const visage of queue.remove) {
            const isActive = await VisageApi.isActive(token.id, visage.id);
            if (isActive) await VisageApi.remove(token.id, visage.id);
        }

        // 5. Prioritise and Process Applies
        if (queue.apply.length > 0) {
            // SCENARIO 1: Identity Highlander Rule
            const identities = queue.apply.filter((v) => v.mode === "identity");
            let winningIdentity = null;
            if (identities.length > 0) {
                winningIdentity = identities.reduce((prev, curr) => {
                    const prevPri = prev.automation.onEnter?.priority || 0;
                    const currPri = curr.automation.onEnter?.priority || 0;
                    if (prevPri === currPri) {
                        return prev.id.localeCompare(curr.id) > 0 ? prev : curr;
                    }
                    return prevPri > currPri ? prev : curr;
                });
            }

            // SCENARIO 2: Overlay Sorting (Ascending)
            const overlays = queue.apply
                .filter((v) => v.mode !== "identity")
                .sort((a, b) => {
                    const priA = a.automation.onEnter?.priority || 0;
                    const priB = b.automation.onEnter?.priority || 0;
                    if (priA === priB) {
                        return a.id.localeCompare(b.id);
                    }
                    return priA - priB;
                });

            // Combine winners
            const finalApplies = winningIdentity ? [winningIdentity, ...overlays] : overlays;

            for (const visage of finalApplies) {
                const isActive = await VisageApi.isActive(token.id, visage.id);
                if (!isActive) await VisageApi.apply(token.id, visage.id);
            }
        }
    }

    // -- Logic Resolvers --

    /**
     * Evaluates an Attribute condition against an actor's data.
     * @param {Actor} actor - The actor to evaluate.
     * @param {Object} condition - The condition configuration.
     * @returns {boolean} True if the condition is met.
     */
    static _evalAttribute(actor, condition) {
        if (!condition.path) return false;

        // 1. Fetch the raw value using Foundry's native getProperty
        const rawVal = foundry.utils.getProperty(actor, condition.path);

        if (rawVal === undefined || rawVal === null) return false;

        // -- BOOLEAN LOGIC --
        if (condition.dataType === "boolean") {
            const checkVal = Boolean(rawVal);
            const targetVal = String(condition.value) === "true"; // Safely cast to bool

            if (condition.operator === "eq") return checkVal === targetVal;
            if (condition.operator === "neq") return checkVal !== targetVal;
            return false;
        }

        // -- STRING LOGIC --
        if (condition.dataType === "string") {
            // Convert both to lowercase for case-insensitive matching
            const checkVal = String(rawVal).toLowerCase();
            const targetVal = String(condition.value).toLowerCase();

            if (condition.operator === "eq") return checkVal === targetVal;
            if (condition.operator === "neq") return checkVal !== targetVal;
            if (condition.operator === "includes") return checkVal.includes(targetVal);
            return false;
        }

        // -- NUMBER LOGIC (Default) --
        let checkVal = Number(rawVal);
        let targetVal = Number(condition.value);

        // Safety check: Ensure we are comparing numbers
        if (isNaN(checkVal) || isNaN(targetVal)) return false;

        // 2. Handle Percentage Calculations
        if (condition.mode === "percent") {
            const maxPath = condition.denominatorPath || condition.path.replace(/\.value$/, ".max");
            const maxVal = foundry.utils.getProperty(actor, maxPath);
            const numMaxVal = Number(maxVal);

            if (!isNaN(numMaxVal) && numMaxVal > 0) {
                checkVal = (checkVal / numMaxVal) * 100;
            } else {
                console.warn(`Visage | Cannot calculate percentage for ${condition.path} - no valid max found at ${maxPath}`);
                return false;
            }
        }

        // 3. Evaluate the Operator
        switch (condition.operator) {
            case "lte":
                return checkVal <= targetVal;
            case "gte":
                return checkVal >= targetVal;
            case "eq":
                return checkVal === targetVal;
            case "neq":
                return checkVal !== targetVal;
            case "lt":
                return checkVal < targetVal;
            case "gt":
                return checkVal > targetVal;
            default:
                return false;
        }
    }

    /**
     * Evaluates a Status/Active Effect condition against an actor.
     * @param {Actor} actor - The actor to evaluate.
     * @param {Object} condition - The condition configuration.
     * @returns {boolean} True if the condition is met.
     */
    static _evalStatus(actor, condition) {
        const targetStatus = condition.customStatus || condition.statusId;
        if (!targetStatus) return false;

        const searchKey = targetStatus.trim().toLowerCase();
        let isActive = false;

        // 1. First, check Foundry's native Statuses Set (e.g., "prone", "blinded")
        if (actor.statuses.has(condition.statusId)) {
            isActive = true;
        }

        // 2. If not a core status, check all Active Effects by Name (e.g., "Rage", "Disguise Self")
        else {
            // Fallback to .effects if .appliedEffects doesn't exist for some reason (backward compatibility)
            const effectsToSearch = actor.appliedEffects || actor.effects || [];
            isActive = effectsToSearch.some((e) => {
                const effectName = (e.name || e.label || "").toLowerCase();
                return effectName === searchKey;
            });
        }

        if (condition.operator === "active") {
            return isActive; // True if the actor HAS the effect
        } else if (condition.operator === "inactive") {
            return !isActive; // True if the actor DOES NOT HAVE the effect
        }

        return false;
    }

    /**
     * Evaluates a Game Event condition against a token's state.
     * @param {Token} token - The token object on the canvas.
     * @param {Object} condition - The condition configuration.
     * @returns {boolean} True if the condition is met.
     */
    static _evalEvent(token, condition) {
        switch (condition.eventId) {
            case "combat": {
                const isActive = game.combats.some((c) => c.started && c.combatants.some((cb) => cb.tokenId === token.id));
                return condition.operator === "active" ? isActive : !isActive;
            }

            case "targeted": {
                // A token is targeted if any user has a targeting reticle on it
                const isActive = token.targeted.size > 0;
                return condition.operator === "active" ? isActive : !isActive;
            }

            case "facing": {
                if (condition.startAngle === undefined || condition.endAngle === undefined) return false;

                // Normalize any angle into a clean 0-359 range
                const currentAngle = ((token.document.rotation % 360) + 360) % 360;

                const startAngle = Number(condition.startAngle) || 0;
                const endAngle = Number(condition.endAngle) || 0;

                // Wrap-around logic for passing the 0-degree mark
                const isBetween = startAngle <= endAngle ? currentAngle >= startAngle && currentAngle <= endAngle : currentAngle >= startAngle || currentAngle <= endAngle;

                return condition.operator === "active" ? isBetween : !isBetween;
            }

            case "elevation": {
                // Round to 2 decimal places to eliminate floating-point dust
                // Converts a 'null' deletion state into 0
                const el = Math.round(Number(token.document.elevation ?? 0) * 100) / 100;
                const val = Math.round(Number(condition.value ?? 0) * 100) / 100;

                if (condition.operator === "gt") return el > val;
                if (condition.operator === "gte") return el >= val;
                if (condition.operator === "lt") return el < val;
                if (condition.operator === "lte") return el <= val;
                if (condition.operator === "neq") return el !== val;
                return el === val;
            }

            case "globalLight": {
                const env = canvas.scene?.environment;
                let isLit = false;
                if (env && env.globalLight?.enabled) {
                    const dark = env.darknessLevel || 0;
                    const min = env.globalLight.darkness?.min ?? 0;
                    const max = env.globalLight.darkness?.max ?? 1;
                    isLit = dark >= min && dark <= max;
                }
                return condition.operator === "active" ? isLit : !isLit;
            }

            case "darkness": {
                // Round to 2 decimal places to eliminate floating-point dust from gradual lighting transitions
                const dark = Math.round(Number(canvas.scene?.environment?.darknessLevel ?? 0) * 100) / 100;
                const val = Math.round(Number(condition.value ?? 0) * 100) / 100;

                if (condition.operator === "gt") return dark > val;
                if (condition.operator === "gte") return dark >= val;
                if (condition.operator === "lt") return dark < val;
                if (condition.operator === "lte") return dark <= val;
                if (condition.operator === "neq") return dark !== val;
                return dark === val;
            }

            case "region": {
                if (!condition.regionId) return false;
                const regionSet = token.document?.regions || [];
                const inRegion = Array.from(regionSet).some((r) => r.id === condition.regionId || r.name === condition.regionId);
                return condition.operator === "active" ? inRegion : !inRegion;
            }

            case "time": {
                if (!condition.startTime || !condition.endTime) return false;

                const hoursPerDay = game.settings.get(MODULE_ID, "hoursPerDay");
                const minsPerHour = game.settings.get(MODULE_ID, "minutesPerHour");
                const secsPerDay = hoursPerDay * minsPerHour * 60;

                // Isolate the current time of day in seconds
                const timeOfDay = game.time.worldTime % secsPerDay;

                // Helper to convert the string "HH:MM" into seconds
                const toSecs = (timeStr) => {
                    const [h, m] = timeStr.split(":").map(Number);
                    return h * minsPerHour * 60 + m * 60;
                };

                const startSecs = toSecs(condition.startTime);
                const endSecs = toSecs(condition.endTime);

                // If start is greater than end (e.g. 20:00 to 06:00), we use OR logic to span midnight
                const isBetween = startSecs <= endSecs ? timeOfDay >= startSecs && timeOfDay < endSecs : timeOfDay >= startSecs || timeOfDay < endSecs;

                return condition.operator === "active" ? isBetween : !isBetween;
            }

            case "weather": {
                const targetWeather = condition.customWeather || condition.weatherId;
                if (!targetWeather) return false;

                const currentWeather = canvas.scene?.weather || "";
                const isMatch = currentWeather === targetWeather;

                return condition.operator === "active" ? isMatch : !isMatch;
            }

            default:
                return false;
        }
    }
}
