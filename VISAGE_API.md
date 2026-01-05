# Public API

Access via `game.modules.get('visage').api`.

## `apply(token, maskId, [options])`

Adds a Visage (Local) or Mask (Global) to the token's active stack.

* **token**: `Token` object or ID string.
* **maskId**: `string` - The UUID of the mask to apply.
* **options**: `{ clearStack: boolean }` - If `true`, removes all existing masks first (replaces the stack). Default is `false` (adds to top).
* **Returns**: `Promise<boolean>`

## `remove(token, maskId)`

Removes a specific layer from the token's stack.

* **token**: `Token` object or ID.
* **maskId**: `string`.
* **Returns**: `Promise<boolean>`

## `revert(token)`

Clears the entire stack and restores the token to its original default appearance.

* **token**: `Token` object or ID.
* **Returns**: `Promise<boolean>`

## `isActive(token, maskId)`

Checks if a specific mask is currently active in the stack.

* **Returns**: `boolean`

## `getAvailable(token)`

Returns an array of all mask data objects available to this token's actor.

## `resolvePath(path)`

Resolves a wildcard path string.
