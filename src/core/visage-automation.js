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

        // 2. Data Observation Hooks (Milestone 2 focus)
        Hooks.on("updateActor", this._onUpdateActor.bind(this));
        Hooks.on("createActiveEffect", this._onStatusChange.bind(this));
        Hooks.on("deleteActiveEffect", this._onStatusChange.bind(this));

        console.log("Visage | Automation Engine Initialized.");
        this.buildRegistry();
    }

    /**
     * Scans the current canvas and builds the registry of tokens that have
     * active Automations configured in their local Visages.
     */
    static buildRegistry() {
        this._registry.clear();
        if (!canvas.ready) return;

        for (const token of canvas.tokens.placeables) {
            if (!token.actor) continue;

            const localVisages = VisageData.getLocal(token.actor);
            const automatedVisages = localVisages.filter(
                (v) =>
                    v.automation?.enabled &&
                    v.automation?.conditions?.length > 0,
            );

            if (automatedVisages.length > 0) {
                this._registry.set(token.id, {
                    actorId: token.actor.id,
                    visages: automatedVisages,
                    stateCache: this._registry.get(token.id)?.stateCache || {}, // Preserve existing cache if it exists
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
                if (cond.type === "attribute") {
                    results.push(this._evalAttribute(actor, cond));
                } else if (cond.type === "status") {
                    results.push(this._evalStatus(actor, cond));
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

    // -- Logic Resolvers (To be written next!) --

    static _evalAttribute(actor, condition) {
        return false; // Placeholder
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
}
