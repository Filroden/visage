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

    static _onUpdateActor(actor, _changes, _options, _userId) {
        // 1. Handle Unlinked Tokens
        if (actor.isToken) {
            const tokenDoc = actor.token;
            if (tokenDoc && this._registry.has(tokenDoc.id)) {
                this._queueEvaluation(tokenDoc);
            }
            return;
        }

        // 2. Handle Linked Tokens
        const linkedTokens = canvas.tokens.placeables.filter((t) => t.actor?.id === actor.id && t.document.actorLink && this._registry.has(t.id));

        for (const token of linkedTokens) {
            this._queueEvaluation(token.document);
        }
    }

    static _onStatusChange(effect, _options, _userId) {
        const actor = effect.parent?.documentName === "Item" ? effect.parent.parent : effect.parent;
        if (actor?.documentName !== "Actor") return;

        if (actor.isToken) {
            // Unlinked Token
            if (this._registry.has(actor.token.id)) {
                this._queueEvaluation(actor.token);
            }
        } else {
            // Linked Token
            const linkedTokens = canvas.tokens.placeables.filter((t) => t.actor?.id === actor.id && t.document.actorLink && this._registry.has(t.id));
            for (const token of linkedTokens) {
                this._queueEvaluation(token.document);
            }
        }
    }

    static _onCombatChange(_combat, _changes, _options, _userId) {
        for (const tokenId of this._registry.entries()) {
            const token = canvas.tokens.get(tokenId);
            if (token) this._queueEvaluation(token.document);
        }
    }

    static _onUpdateToken(tokenDoc, changes, _options, _userId) {
        if (!this._registry.has(tokenDoc.id)) return;

        // 1. Throttle: Spatial changes AND Unlinked Token attribute changes
        const keys = Object.keys(changes);
        const isRelevant = keys.some(
            (k) => k === "x" || k === "y" || k === "elevation" || k === "-=elevation" || k === "rotation" || k === "delta" || k.startsWith("delta.") || k === "actorData" || k.startsWith("actorData."),
        );

        if (!isRelevant) return;

        // 2. The Boundary Bypass Cache
        // Safely extract the IDs of the Regions the token is currently standing in
        const currentRegionIds = Array.from(tokenDoc.regions || [])
            .map((r) => r.id)
            .sort((a, b) => a.localeCompare(b))
            .join(",");

        // Retrieve the last known regions from our registry (or initialise it to current)
        const registryEntry = this._registry.get(tokenDoc.id);
        const previousRegionIds = registryEntry._lastRegionState ?? currentRegionIds;
        registryEntry._lastRegionState = currentRegionIds;

        // 3. Evaluation Routing
        if (currentRegionIds !== previousRegionIds) {
            const token = tokenDoc.object;
            if (token) this._evaluate(token);
            return;
        }

        // NO BOUNDARY CROSSED: Normal movement within the same space.
        // Send to the queue to safely wait for animations to finish.
        this._queueEvaluation(tokenDoc);
    }

    static _onTargetToken(_user, token, _targeted) {
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

    static _onUpdateWorldTime(worldTime, _dt) {
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
     * Safely queues a token for evaluation.
     * Uses a lightweight 50ms debounce to batch simultaneous database hooks
     * (e.g., updateActor and updateToken firing concurrently)
     * @param {TokenDocument} tokenDoc - The document of the token to evaluate.
     */
    static _queueEvaluation(tokenDoc) {
        if (!this._registry.has(tokenDoc.id)) return;

        // 1. Clear any existing pending evaluation for this specific token
        if (this._evaluationQueue.has(tokenDoc.id)) {
            clearTimeout(this._evaluationQueue.get(tokenDoc.id));
        }

        // 2. Set a rapid debounce. 50ms is enough to catch duplicate data packets
        // without introducing any human-perceptible input lag.
        const timeoutId = setTimeout(() => {
            this._evaluationQueue.delete(tokenDoc.id);

            // Fetch the freshest canvas object and evaluate instantly
            const freshToken = canvas.tokens.get(tokenDoc.id);
            if (freshToken) this._evaluate(freshToken);
        }, 50);

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
        const queue = { apply: [], remove: [] };

        // 1. Build the Transition Queue
        for (const visage of record.visages) {
            const hasMetConditions = this._checkConditions(actor, token, visage.automation);
            if (hasMetConditions === null) continue; // Skip if no valid conditions exist

            const isActive = await VisageApi.isActive(token.id, visage.id);
            this._routeToQueue(queue, visage, hasMetConditions, isActive);
        }

        // 2. Process Removals First
        for (const visage of queue.remove) {
            if (await VisageApi.isActive(token.id, visage.id)) {
                await VisageApi.remove(token.id, visage.id);
            }
        }

        // 3. Process Applies (Handling Priorities and Highlander Rule)
        if (queue.apply.length > 0) {
            const identities = queue.apply.filter((v) => v.mode === "identity");
            const overlays = queue.apply.filter((v) => v.mode !== "identity");

            const winningIdentity = this._resolveWinningIdentity(identities);
            const sortedOverlays = this._sortOverlays(overlays);
            const finalApplies = winningIdentity ? [winningIdentity, ...sortedOverlays] : sortedOverlays;

            for (const visage of finalApplies) {
                if (!(await VisageApi.isActive(token.id, visage.id))) {
                    await VisageApi.apply(token.id, visage.id);
                }
            }
        }
    }

    /**
     * Checks if a visage's conditions are met. Returns null if no valid conditions exist.
     */
    static _checkConditions(actor, token, auto) {
        const results = [];
        for (const cond of auto.conditions) {
            if (cond.disabled) continue;
            if (cond.type === "attribute") results.push(this._evalAttribute(actor, cond));
            else if (cond.type === "status") results.push(this._evalStatus(actor, cond));
            else if (cond.type === "event") results.push(this._evalEvent(token, cond));
        }

        if (results.length === 0) return null;
        return auto.logic === "AND" ? results.every(Boolean) : results.some(Boolean);
    }

    /**
     * Routes a visage to the correct transition queue based on its state and conditions.
     */
    static _routeToQueue(queue, visage, isTrue, isActive) {
        const auto = visage.automation;
        if (isTrue && !isActive) {
            const action = auto.onEnter?.action || "apply";
            if (queue[action]) queue[action].push(visage);
        } else if (!isTrue && isActive) {
            const action = auto.onExit?.action || "remove";
            if (queue[action]) queue[action].push(visage);
        } else if (isTrue && isActive && visage.mode === "identity") {
            const action = auto.onEnter?.action || "apply";
            if (action === "apply" && queue.apply) queue.apply.push(visage);
        }
    }

    /**
     * Resolves the "Highlander Rule" to find the highest priority Identity.
     */
    static _resolveWinningIdentity(identities) {
        if (identities.length === 0) return null;
        return identities.reduce((prev, curr) => {
            const prevPri = prev.automation.onEnter?.priority || 0;
            const currPri = curr.automation.onEnter?.priority || 0;
            if (prevPri === currPri) return prev.id.localeCompare(curr.id) > 0 ? prev : curr;
            return prevPri > currPri ? prev : curr;
        });
    }

    /**
     * Sorts overlays by their application priority.
     */
    static _sortOverlays(overlays) {
        return overlays.sort((a, b) => {
            const priA = a.automation.onEnter?.priority || 0;
            const priB = b.automation.onEnter?.priority || 0;
            if (priA === priB) return a.id.localeCompare(b.id);
            return priA - priB;
        });
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

        // 2. Route to the appropriate data type evaluator
        if (condition.dataType === "boolean") return this._evalBooleanAttribute(rawVal, condition);
        if (condition.dataType === "string") return this._evalStringAttribute(rawVal, condition);

        // Default to Number logic
        return this._evalNumberAttribute(rawVal, condition, actor);
    }

    /**
     * Evaluates a Boolean attribute condition.
     */
    static _evalBooleanAttribute(rawVal, condition) {
        const checkVal = Boolean(rawVal);
        const targetVal = String(condition.value) === "true"; // Safely cast to bool

        if (condition.operator === "eq") return checkVal === targetVal;
        if (condition.operator === "neq") return checkVal !== targetVal;
        return false;
    }

    /**
     * Evaluates a String attribute condition.
     */
    static _evalStringAttribute(rawVal, condition) {
        const checkVal = String(rawVal).toLowerCase();
        const targetVal = String(condition.value).toLowerCase();

        if (condition.operator === "eq") return checkVal === targetVal;
        if (condition.operator === "neq") return checkVal !== targetVal;
        if (condition.operator === "includes") return checkVal.includes(targetVal);
        return false;
    }

    /**
     * Evaluates a Number attribute condition (including percentages).
     */
    static _evalNumberAttribute(rawVal, condition, actor) {
        let checkVal = Number(rawVal);
        const targetVal = Number(condition.value);

        if (Number.isNaN(checkVal) || Number.isNaN(targetVal)) return false;

        // Handle Percentage Calculations
        if (condition.mode === "percent") {
            const maxPath = condition.denominatorPath || condition.path.replace(/\.value$/, ".max");
            const maxVal = foundry.utils.getProperty(actor, maxPath);
            const numMaxVal = Number(maxVal);

            if (!Number.isNaN(numMaxVal) && numMaxVal > 0) {
                checkVal = (checkVal / numMaxVal) * 100;
            } else {
                console.warn(`Visage | Cannot calculate percentage for ${condition.path} - no valid max found at ${maxPath}`);
                return false;
            }
        }

        // Evaluate the Operator
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
            case "combat":
                return this._evalCombatEvent(token, condition);
            case "targeted":
                return this._evalTargetedEvent(token, condition);
            case "facing":
                return this._evalFacingEvent(token, condition);
            case "elevation":
                return this._evalElevationEvent(token, condition);
            case "globalLight":
                return this._evalGlobalLightEvent(condition);
            case "darkness":
                return this._evalDarknessEvent(condition);
            case "region":
                return this._evalRegionEvent(token, condition);
            case "time":
                return this._evalTimeEvent(condition);
            case "weather":
                return this._evalWeatherEvent(condition);
            default:
                return false;
        }
    }

    // -- Event Logic Helpers --

    static _evalCombatEvent(token, condition) {
        const isActive = game.combats.some((c) => c.started && c.combatants.some((cb) => cb.tokenId === token.id));
        return condition.operator === "active" ? isActive : !isActive;
    }

    static _evalTargetedEvent(token, condition) {
        const isActive = token.targeted.size > 0;
        return condition.operator === "active" ? isActive : !isActive;
    }

    static _evalFacingEvent(token, condition) {
        if (condition.startAngle === undefined || condition.endAngle === undefined) return false;

        const currentAngle = ((token.document.rotation % 360) + 360) % 360;
        const startAngle = Number(condition.startAngle) || 0;
        const endAngle = Number(condition.endAngle) || 0;

        const isBetween = startAngle <= endAngle ? currentAngle >= startAngle && currentAngle <= endAngle : currentAngle >= startAngle || currentAngle <= endAngle;

        return condition.operator === "active" ? isBetween : !isBetween;
    }

    static _evalGlobalLightEvent(condition) {
        const env = canvas.scene?.environment;
        let isLit = false;
        if (env?.globalLight?.enabled) {
            const dark = env.darknessLevel || 0;
            const min = env.globalLight.darkness?.min ?? 0;
            const max = env.globalLight.darkness?.max ?? 1;
            isLit = dark >= min && dark <= max;
        }
        return condition.operator === "active" ? isLit : !isLit;
    }

    static _evalRegionEvent(token, condition) {
        if (!condition.regionId) return false;
        const regionSet = token.document?.regions || [];
        const inRegion = Array.from(regionSet).some((r) => r.id === condition.regionId || r.name === condition.regionId);
        return condition.operator === "active" ? inRegion : !inRegion;
    }

    static _evalTimeEvent(condition) {
        if (!condition.startTime || !condition.endTime) return false;

        const hoursPerDay = game.settings.get(MODULE_ID, "hoursPerDay");
        const minsPerHour = game.settings.get(MODULE_ID, "minutesPerHour");
        const secsPerDay = hoursPerDay * minsPerHour * 60;

        const timeOfDay = game.time.worldTime % secsPerDay;
        const toSecs = (timeStr) => {
            const [h, m] = timeStr.split(":").map(Number);
            return h * minsPerHour * 60 + m * 60;
        };

        const startSecs = toSecs(condition.startTime);
        const endSecs = toSecs(condition.endTime);

        const isBetween = startSecs <= endSecs ? timeOfDay >= startSecs && timeOfDay < endSecs : timeOfDay >= startSecs || timeOfDay < endSecs;

        return condition.operator === "active" ? isBetween : !isBetween;
    }

    static _evalWeatherEvent(condition) {
        const targetWeather = condition.customWeather || condition.weatherId;
        if (!targetWeather) return false;
        const isMatch = (canvas.scene?.weather || "") === targetWeather;
        return condition.operator === "active" ? isMatch : !isMatch;
    }

    // -- Numeric Comparison Utility --
    static _compareNumericEvent(valA, valB, operator) {
        if (operator === "gt") return valA > valB;
        if (operator === "gte") return valA >= valB;
        if (operator === "lt") return valA < valB;
        if (operator === "lte") return valA <= valB;
        if (operator === "neq") return valA !== valB;
        return valA === valB; // eq
    }

    static _evalElevationEvent(token, condition) {
        const el = Math.round(Number(token.document.elevation ?? 0) * 100) / 100;
        const val = Math.round(Number(condition.value ?? 0) * 100) / 100;
        return this._compareNumericEvent(el, val, condition.operator);
    }

    static _evalDarknessEvent(condition) {
        const dark = Math.round(Number(canvas.scene?.environment?.darknessLevel ?? 0) * 100) / 100;
        const val = Math.round(Number(condition.value ?? 0) * 100) / 100;
        return this._compareNumericEvent(dark, val, condition.operator);
    }
}
