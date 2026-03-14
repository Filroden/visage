# Foundry V14 Migration Guide: Forced Deletions

## Architectural Context

Foundry V14 introduces strict schema validation using DataModels. Because of this, the legacy method of deleting object keys by prepending `-=` to the key string inside an `.update()` payload has been deprecated and will throw console errors.

In V14, deletions must be handled either by using native document methods (like `unsetFlag`) or by explicitly passing the `foundry.data.operators.ForcedDeletion` symbol in the update payload.

There are exactly four instances of the legacy `-=` syntax in the Visage codebase that must be migrated.

## 1. Refactoring to Native `unsetFlag`

**File:** `src/data/visage-data.js`

Where possible, we should avoid building manual update payloads for flags and use Foundry's native `unsetFlag` method, which automatically handles the correct database syntax for both V13 and V14.

**Location A: `destroy()` method (~Line 122)**
*Old V13 Code:*

```javascript
        if (actor) {
            await actor.update({
                [`flags.${DATA_NAMESPACE}.${this.ALTERNATE_FLAG_KEY}.-=${id}`]: null,
            });
            Hooks.callAll("visageDataChanged");
            return;
        }

```

*New V14 Code:*

```javascript
        if (actor) {
            await actor.unsetFlag(DATA_NAMESPACE, `${this.ALTERNATE_FLAG_KEY}.${id}`);
            Hooks.callAll("visageDataChanged");
            return;
        }

```

**Location B: `_saveLocal()` method (~Line 188)**
*Old V13 Code:*

```javascript
        // Explicitly delete old bloat first to bypass Foundry's Deep Merge resurrection
        if (existing) {
            await actor.update({
                [`flags.${DATA_NAMESPACE}.${this.ALTERNATE_FLAG_KEY}.-=${id}`]: null,
            });
        }

```

*New V14 Code:*

```javascript
        // Explicitly delete old bloat first to bypass Foundry's Deep Merge resurrection
        if (existing) {
            await actor.unsetFlag(DATA_NAMESPACE, `${this.ALTERNATE_FLAG_KEY}.${id}`);
        }

```

## 2. Implementing the ForcedDeletion Operator

**File:** `src/core/visage.js`

In the `remove()` method, we update the active stack array and delete the identity string simultaneously in a single database `.update()` call. Because we are batching a write and a delete together, we cannot use `unsetFlag` and must instead use the new V14 explicit deletion operator.

**Location: `remove()` method (~Line 248)**
*Old V13 Code:*

```javascript
        const updateFlags = {};
        if (currentIdentity === maskId) updateFlags[`flags.${DATA_NAMESPACE}.-=identity`] = null;

        if (stack.length === 0) updateFlags[`flags.${DATA_NAMESPACE}.-=activeStack`] = null;
        else updateFlags[`flags.${DATA_NAMESPACE}.activeStack`] = stack;

        await token.document.update(updateFlags);

```

*New V14 Code:*

```javascript
        const updateFlags = {};
        
        if (currentIdentity === maskId) {
            updateFlags[`flags.${DATA_NAMESPACE}.identity`] = foundry.data.operators.ForcedDeletion;
        }

        if (stack.length === 0) {
            updateFlags[`flags.${DATA_NAMESPACE}.activeStack`] = foundry.data.operators.ForcedDeletion;
        } else {
            updateFlags[`flags.${DATA_NAMESPACE}.activeStack`] = stack;
        }

        await token.document.update(updateFlags);

```
