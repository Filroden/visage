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

## Data Schema (`changes` object)

When manipulating Visage data directly, the changes object accepts the following properties:

* name (string): Token name override.
* texture (object): { src: "path/to/img.png", scaleX: 1.0, scaleY: 1.0 }.
* scale (number): Atomic scale override (e.g. 1.5 for 150%).
* mirrorX / mirrorY (boolean): Horizontal/Vertical flip state.
* alpha (number): Token opacity (0.0 to 1.0).
* lockRotation (boolean): Lock the token image rotation.
width / height (number): Grid dimensions.
* disposition (number): Token disposition constant.
* ring (object): Dynamic Token Ring configuration.

Here is a complete example block. It illustrates a complex "Ghostly Guardian" configuration that utilises every feature .

```javascript
// Example 'changes' object structure
const changes = {
  // Core Token Data
  name: "Ghostly Guardian",      // Name override
  disposition: 1,                // 1=Friendly, 0=Neutral, -1=Hostile, -2=Secret
  width: 2,                      // Grid units (2x2)
  height: 2,
  
  // Visual Appearance
  texture: {
    src: "path/to/ghost_token.webp"
  },
  scale: 1.2,                    // Atomic Scale Override (120%)
  mirrorX: true,                 // Horizontal Flip
  mirrorY: false,                // Vertical Flip
  alpha: 0.5,                    // Opacity (0.0 to 1.0)
  lockRotation: true,            // Face stays upright when rotating
  
  // Dynamic Token Ring (Optional)
  ring: {
    enabled: true,
    colors: {
      ring: "#76FF03",           // Hex color string
      background: "#000000"
    },
    effects: 1,                  // Bitmask: 2=Pulse, 4=Gradient, 8=Wave, 16=Invisibility
    subject: {
      texture: "path/to/ring_subject.webp",
      scale: 1.0
    }
  }
};

```
