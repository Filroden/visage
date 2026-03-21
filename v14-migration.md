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

## 3. Token Z-Axis (Elevation/Depth) Support

**Architectural Context:**
Foundry V14 introduces native 3D sizing for tokens, replacing the standard 2D `width` and `height` with `Size (Grid Spaces) X, Y, Z`. Visage must be updated to capture, store, and manipulate this third dimension to ensure 3D scale adjustments are not discarded.

**Required Updates:**

* **Ghost Editing (`src/core/visage.js`):** In the `Visage.handleTokenUpdate` method, the `relevantKeys` array intercepts manual token changes to update the base token beneath the active Visage. You must add the new Z-axis property (likely `depth` or `z`) to this array.
* **State Snapshots (`src/data/visage-data.js`):** Update the `getDefaultAsVisage` method to snapshot the Z-axis property alongside `width` and `height` when capturing a token's "True Form".
* **Reversion Logic (`src/utils/visage-cleanup.js`):** Update the `getRevertData` method to restore the Z-axis property when mapping the clean snapshot back to the token properties.
* **UI Integration (`src/apps/visage-editor.js` & `.hbs`):** The Editor's "Dimensions" slot will need a new input for the Z-axis so users can scale a token's vertical volume. Related Handlebars templates and CSS grid layouts will need adjusting to accommodate three inputs instead of two.

## 4. V14 API & Rendering Mechanics Testing

Foundry V14 introduces significant changes to the game canvas, occlusion, and line-of-sight calculations. While external dependencies like Sequencer may handle some of the WebGL heavy lifting, Visage's core visual manipulations must be rigorously tested against the new V14 rules.

**Testing Checklist:**

* **Multi-Level Canvas Occlusion:** V14 refines how obscuring images behave on multi-level scenes (e.g., surfaces at or above the viewed level's top elevation now always occlude).
  * *Action:* Test active Visages (both Identity and Overlay modes) when a token is sitting on an elevation higher than the GM's currently viewed level. Ensure the new native occlusion rules do not aggressively clip or permanently hide your visual effects.
* **Line of Sight & Token Test Points:** V14 adds the physical centre point of the token as an additional visibility test point to fix issues with large tokens.
  * *Action:* Visage frequently alters `texture.anchorX`, `texture.anchorY`, and `scale`. Test tokens with heavily offset visual anchors to ensure they do not become visible to players too early or too late, as the underlying physical centre point remains static while the visual representation shifts.
* **Regions API Updates:** V14 includes several additions and standardisations to the `RegionLayer` (e.g., `placeRegion`).
  * *Action:* Visage relies on checking region boundaries for its `RegionEnter` and `RegionExit` automation triggers. Verify that these specific event listeners still fire correctly under the new V14 region placement mechanics.
