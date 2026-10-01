/**
 * VISAGE AUTOMATION TEXT
 * -------------------------------------------------------------------
 * Describes a Visage's automation rule in a plain sentence, for example: "Applied while the token
 * is in combat and hp.value is at or below 50% of hp.max. Removed when that stops being true."
 *
 * The same sentence is shown in three places, so it is built here once:
 * - the "In words" summary under the conditions in the Visage Editor,
 * - the tooltip on the automation button of Gallery cards,
 * - the tooltip on the automation button of Selector HUD tiles.
 *
 * Each condition becomes one clause from a localisation template. The clauses are joined with
 * Intl.ListFormat in the user's language, as a conjunction ("a, b and c") for ALL and a
 * disjunction ("a, b or c") for ANY. Disabled conditions are left out, because the automation
 * engine ignores them too.
 *
 * The wording mirrors how the automation engine evaluates each condition
 * (src/core/visage-automation.js): "active" means the state is true, "inactive" that it is false.
 */

/** Key prefix for every string used here. */
const KEY = "VISAGE.Automation.Text";

/** Operator words shared by number attributes, token elevation and scene darkness. */
const NUMERIC_OPERATORS = new Set(["lte", "gte", "eq", "neq", "lt", "gt"]);

/** Events that are simply on or off, each with its own wording for both states. */
const BINARY_EVENTS = new Set(["combat", "targeted", "visibility", "globalLight"]);

/** The logic value that joins clauses with "or" rather than "and". */
const LOGIC_ANY = "OR";

export class VisageAutomationText {
    /**
     * The full sentence for an automation rule.
     *
     * @param {object|null|undefined} automation - A Visage's automation block.
     * @returns {string} The sentence, or an empty string if there is no rule at all.
     */
    static describe(automation) {
        const conditions = (automation?.conditions ?? []).filter((c) => !c.disabled);
        if (!automation?.conditions?.length) return "";
        if (!conditions.length) return game.i18n.localize(`${KEY}.NoActiveConditions`);

        const clauses = conditions.map((c) => VisageAutomationText.describeCondition(c)).filter(Boolean);
        const list = VisageAutomationText.#joinClauses(clauses, automation.logic);
        const sentence = game.i18n.format(`${KEY}.Sentence`, { conditions: list });

        return automation.enabled ? sentence : `${sentence} ${game.i18n.localize(`${KEY}.SwitchedOff`)}`;
    }

    /**
     * The clause for one condition, such as "the token is in combat".
     *
     * @param {object} condition - One automation condition.
     * @returns {string}
     */
    static describeCondition(condition) {
        switch (condition.type) {
            case "attribute":
                return VisageAutomationText.#describeAttribute(condition);
            case "status":
                return VisageAutomationText.#describeStatus(condition);
            case "event":
                return VisageAutomationText.#describeEvent(condition);
            default:
                return "";
        }
    }

    /**
     * The words for a comparison operator, such as "at or below". Also used to label the
     * operator options in the editor, so the options read the same as the sentence.
     *
     * @param {string} operator - lte, gte, eq, neq, lt or gt.
     * @returns {string}
     */
    static operatorWords(operator) {
        const op = NUMERIC_OPERATORS.has(operator) ? operator : "eq";
        return game.i18n.localize(`${KEY}.Op.${op}`);
    }

    /** Joins clauses into a list in the user's language. */
    static #joinClauses(clauses, logic) {
        const type = logic === LOGIC_ANY ? "disjunction" : "conjunction";
        try {
            return new Intl.ListFormat(game.i18n.lang, { style: "long", type }).format(clauses);
        } catch {
            // An unrecognised language code: fall back to the browser's default locale
            return new Intl.ListFormat(undefined, { style: "long", type }).format(clauses);
        }
    }

    // --- Attributes ---

    static #describeAttribute(c) {
        const path = c.path || game.i18n.localize(`${KEY}.UnsetPath`);
        if (c.dataType === "boolean") {
            return game.i18n.format(`${KEY}.Attribute.Boolean`, { path, value: String(c.value) });
        }
        if (c.dataType === "string") {
            return game.i18n.format(`${KEY}.Attribute.String.${VisageAutomationText.#stringOperator(c.operator)}`, { path, value: c.value ?? "" });
        }
        return VisageAutomationText.#describeNumberAttribute(c, path);
    }

    static #describeNumberAttribute(c, path) {
        const op = VisageAutomationText.operatorWords(c.operator);
        const value = c.value ?? 0;
        if (c.mode !== "percent") return game.i18n.format(`${KEY}.Attribute.Number`, { path, op, value });

        const max = c.denominatorPath || game.i18n.localize(`${KEY}.ItsMaximum`);
        return game.i18n.format(`${KEY}.Attribute.Percent`, { path, op, value, max });
    }

    /** Text attributes support is (eq), is not (neq) and contains (includes). */
    static #stringOperator(operator) {
        if (operator === "neq") return "Neq";
        if (operator === "includes") return "Includes";
        return "Eq";
    }

    // --- Statuses ---

    static #describeStatus(c) {
        const status = c.customStatus || VisageAutomationText.#statusName(c.statusId) || game.i18n.localize(`${KEY}.UnsetStatus`);
        return game.i18n.format(`${KEY}.Status.${VisageAutomationText.#state(c)}`, { status });
    }

    /** The display name of a core status effect, or its id if the system does not list it. */
    static #statusName(statusId) {
        if (!statusId) return "";
        const effects = Array.isArray(CONFIG.statusEffects) ? CONFIG.statusEffects : Object.values(CONFIG.statusEffects ?? {});
        const effect = effects.find((s) => s.id === statusId);
        return effect ? game.i18n.localize(effect.name || effect.label || statusId) : statusId;
    }

    // --- Events ---

    static #describeEvent(c) {
        const id = c.eventId;
        if (BINARY_EVENTS.has(id)) return game.i18n.localize(`${KEY}.Event.${id}.${VisageAutomationText.#state(c)}`);

        const state = VisageAutomationText.#state(c);
        switch (id) {
            case "elevation":
            case "darkness":
                return game.i18n.format(`${KEY}.Event.${id}`, { op: VisageAutomationText.operatorWords(c.operator), value: c.value ?? 0 });
            case "region":
                return game.i18n.format(`${KEY}.Event.region.${state}`, { region: c.regionId || "?" });
            case "time":
                return game.i18n.format(`${KEY}.Event.time.${state}`, { start: c.startTime || "00:00", end: c.endTime || "00:00" });
            case "weather":
                return game.i18n.format(`${KEY}.Event.weather.${state}`, { weather: VisageAutomationText.#weatherName(c) });
            case "facing":
                return game.i18n.format(`${KEY}.Event.facing.${state}`, { start: c.startAngle ?? 0, end: c.endAngle ?? 0 });
            default:
                return id ?? "";
        }
    }

    /** The display name of the weather a condition looks for. */
    static #weatherName(c) {
        if (c.customWeather) return c.customWeather;
        const config = CONFIG.weatherEffects?.[c.weatherId];
        if (!config) return c.weatherId || "?";
        return game.i18n.localize(config.label || config.name || c.weatherId);
    }

    /** "Active" or "Inactive", the two states most conditions can look for. */
    static #state(c) {
        return c.operator === "inactive" ? "Inactive" : "Active";
    }
}
