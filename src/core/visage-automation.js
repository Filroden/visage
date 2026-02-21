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
        Hooks.on("deleteActiveEffect", this._onStatusChange.bind(this));

        // 3. Event Hooks
        Hooks.on("updateCombat", this._onCombatChange.bind(this));
        Hooks.on("deleteCombat", this._onCombatChange.bind(this));
        Hooks.on("updateToken", this._onUpdateToken.bind(this));

        Hooks.on("targetToken", (user, token, targeted) => {
            if (this._registry.has(token.id)) this._evaluate(token);
        });

        Hooks.on("updateScene", (scene, changes) => {
            if (
                changes.environment?.darknessLevel !== undefined ||
                changes.environment?.globalLight?.enabled !== undefined
            ) {
                setTimeout(() => {
                    for (const tokenId of this._registry.keys()) {
                        const t = canvas.tokens.get(tokenId);
                        if (t) this._evaluate(t);
                    }
                }, 100);
            }
        });

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
        const globalAutomations = VisageData.globals.filter(
            (v) =>
                v.automation?.enabled && v.automation?.conditions?.length > 0,
        );

        for (const token of canvas.tokens.placeables) {
            if (!token.actor) continue;

            const localVisages = VisageData.getLocal(token.actor);
            const automatedVisages = localVisages.filter(
                (v) =>
                    v.automation?.enabled &&
                    v.automation?.conditions?.length > 0,
            );

            // Combine the token's specific local automations with the universal global automations
            const combinedAutomations = [
                ...automatedVisages,
                ...globalAutomations,
            ];

            if (combinedAutomations.length > 0) {
                this._registry.set(token.id, {
                    actorId: token.actor.id,
                    visages: combinedAutomations,
                    stateCache: oldRegistry.get(token.id)?.stateCache || {},
                });
            }
        }
    }

    // ==========================================
    // OBSERVATION HOOKS
    // ==========================================

    static _onUpdateActor(actor, changes, options, userId) {
        // Find tokens on the canvas linked to this actor that are in our registry
        const linkedTokens = canvas.tokens.placeables.filter(
            (t) => t.actor?.id === actor.id && this._registry.has(t.id),
        );
        if (!linkedTokens.length) return;

        // In the next step, we will pass these tokens to the Evaluation Loop
        for (const token of linkedTokens) {
            this._evaluate(token);
        }
    }

    static _onStatusChange(effect, options, userId) {
        const actor = effect.parent;
        if (!actor || actor.documentName !== "Actor") return;

        const linkedTokens = canvas.tokens.placeables.filter(
            (t) => t.actor?.id === actor.id && this._registry.has(t.id),
        );
        if (!linkedTokens.length) return;

        for (const token of linkedTokens) {
            this._evaluate(token);
        }
    }

    static _onCombatChange(combat, changes, options, userId) {
        for (const [tokenId, record] of this._registry.entries()) {
            const token = canvas.tokens.get(tokenId);
            if (token) this._evaluate(token);
        }
    }

    static _onUpdateToken(tokenDoc, changes, options, userId) {
        // We only care if elevation or position changed.
        // This acts as our throttle to prevent evaluating on every minor token update.
        if (
            changes.elevation === undefined &&
            changes.x === undefined &&
            changes.y === undefined
        )
            return;

        if (this._registry.has(tokenDoc.id)) {
            const token = tokenDoc.object;
            if (token) this._evaluate(token);
        }
    }

    // ==========================================
    // THE EVALUATION LOOP
    // ==========================================

    /**
     * Evaluates all automated visages for a specific token and fires transitions.
     * @param {Token} token - The token to evaluate.
     */
    static async _evaluate(token) {
        const record = this._registry.get(token.id);
        if (!record) return;

        const actor = token.actor;
        const VisageApi = game.modules.get(MODULE_ID).api;

        for (const visage of record.visages) {
            const auto = visage.automation;
            const visageId = visage.id;

            // 1. Resolve conditions
            let results = [];
            for (const cond of auto.conditions) {
                if (cond.disabled) continue;
                if (cond.type === "attribute") {
                    results.push(this._evalAttribute(actor, cond));
                } else if (cond.type === "status") {
                    results.push(this._evalStatus(actor, cond));
                } else if (cond.type === "event") {
                    results.push(this._evalEvent(token, cond));
                }
            }

            // 2. Apply Logic (AND / OR)
            const isTrue =
                auto.logic === "AND"
                    ? results.every((r) => r === true)
                    : results.some((r) => r === true);

            // 3. Compare with Cache (The Latch)
            const wasTrue = record.stateCache[visageId] ?? false;

            if (isTrue && !wasTrue) {
                // Transition: FALSE -> TRUE
                record.stateCache[visageId] = true;
                if (auto.onEnter.action === "apply")
                    await VisageApi.apply(token.id, visageId);
                else if (auto.onEnter.action === "remove")
                    await VisageApi.remove(token.id, visageId);
            } else if (!isTrue && wasTrue) {
                // Transition: TRUE -> FALSE
                record.stateCache[visageId] = false;
                if (auto.onExit.action === "apply")
                    await VisageApi.apply(token.id, visageId);
                else if (auto.onExit.action === "remove")
                    await VisageApi.remove(token.id, visageId);
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
        // This safely traverses the actor object (e.g., actor.system.attributes.hp.value)
        const rawVal = foundry.utils.getProperty(actor, condition.path);

        // If the path doesn't exist on this actor, the condition cannot be met
        if (rawVal === undefined || rawVal === null) return false;

        let checkVal = Number(rawVal);
        let targetVal = Number(condition.value);

        // Safety check: Ensure we are comparing numbers
        if (isNaN(checkVal) || isNaN(targetVal)) return false;

        // 2. Handle Percentage Calculations
        if (condition.mode === "percent") {
            // Heuristic: In almost all Foundry systems, if the current value is at ".value",
            // the maximum value is stored at ".max" in the same object.
            const maxPath = condition.path.replace(/\.value$/, ".max");
            const maxVal = foundry.utils.getProperty(actor, maxPath);
            const numMaxVal = Number(maxVal);

            if (!isNaN(numMaxVal) && numMaxVal > 0) {
                checkVal = (checkVal / numMaxVal) * 100;
            } else {
                // If we are asked to calculate a percentage but cannot find a valid 'max',
                // we must fail safely to prevent errors or false positives.
                console.warn(
                    `Visage | Cannot calculate percentage for ${condition.path} - no valid max found at ${maxPath}`,
                );
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
            default:
                return false;
        }
    }

    /**
     * Evaluates a Status Effect condition against an actor.
     * @param {Actor} actor - The actor to evaluate.
     * @param {Object} condition - The condition configuration.
     * @returns {boolean} True if the condition is met.
     */
    static _evalStatus(actor, condition) {
        if (!condition.statusId) return false;

        // Foundry maintains a Set of active status IDs directly on the actor
        const hasStatus = actor.statuses.has(condition.statusId);

        if (condition.operator === "active") {
            return hasStatus; // True if the actor HAS the status
        } else if (condition.operator === "inactive") {
            return !hasStatus; // True if the actor DOES NOT HAVE the status
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
        if (condition.eventId === "combat") {
            const isActive = game.combats.some(
                (c) =>
                    c.started &&
                    c.combatants.some((cb) => cb.tokenId === token.id),
            );
            return condition.operator === "active" ? isActive : !isActive;
        } else if (condition.eventId === "targeted") {
            // A token is targeted if any user has a targeting reticle on it
            const isActive = token.targeted.size > 0;
            return condition.operator === "active" ? isActive : !isActive;
        } else if (condition.eventId === "elevation") {
            const el = Number(token.document.elevation) || 0;
            const val = Number(condition.value) || 0;
            if (condition.operator === "gt") return el > val;
            if (condition.operator === "lt") return el < val;
            return el === val;
        } else if (condition.eventId === "globalLight") {
            const env = canvas.scene?.environment;
            let isLit = false;
            if (env && env.globalLight?.enabled) {
                const dark = env.darknessLevel || 0;
                const min = env.globalLight.darkness?.min ?? 0;
                const max = env.globalLight.darkness?.max ?? 1;
                isLit = dark >= min && dark <= max;
            }
            return condition.operator === "active" ? isLit : !isLit;
        } else if (condition.eventId === "darkness") {
            const dark = Number(canvas.scene?.environment?.darknessLevel) || 0;
            const val = Number(condition.value) || 0;
            if (condition.operator === "gt") return dark > val;
            if (condition.operator === "lt") return dark < val;
            return dark === val;
        } else if (condition.eventId === "region") {
            if (!condition.regionId) return false;
            const regionSet = token.document?.regions || [];
            const inRegion = Array.from(regionSet).some(
                (r) =>
                    r.id === condition.regionId ||
                    r.name === condition.regionId,
            );
            return condition.operator === "active" ? inRegion : !inRegion;
        }

        return false;
    }
}
