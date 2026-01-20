# Public API

Access via `game.modules.get('visage').api`.

## `apply(token, visageId, [options])`

Adds a Visage (Identity or Overlay) to the token's active stack.

* **token**: `Token` object or ID string.
* **visageId**: `string` - The UUID of the item to apply.
* **options**: Object containing modification flags:
  * `switchIdentity` (boolean): If `true`, forces this item to act as an **Identity** (swaps base texture). If `false`, forces **Overlay** (stacks on top). *Default: Auto-detected from item's `mode`.*
  * `clearStack` (boolean): If `true`, removes all existing layers before applying. *Default: `false`.*
* **Returns**: `Promise<boolean>`

## `remove(token, visageId)`

Removes a specific layer from the token's stack.

* **token**: `Token` object or ID.
* **visageId**: `string` - The UUID of the layer to remove.
* **Returns**: `Promise<boolean>`

## `revert(token)`

Clears the entire stack (Identities and Overlays) and restores the token to its original default appearance.

* **token**: `Token` object or ID.
* **Returns**: `Promise<boolean>`

## `isActive(token, visageId)`

Checks if a specific Visage is currently active in the stack.

* **Returns**: `boolean`

## `getAvailable(token)`

Returns an array of all Visage data objects (Local and Global) available to this token's actor.

## `resolvePath(path)`

Resolves a wildcard path string or S3 URL into a concrete file path.

---

## Data Schema (`changes` object)

When manipulating Visage data directly, the `changes` object defines the visual modifications.

* **name** (string): Token name override.
* **texture** (object): `{ src: "path.png" }`.
* **scale** (number): Atomic scale override (e.g. 1.5 for 150%).
* **mirrorX / mirrorY** (boolean): Horizontal/Vertical flip state.
* **alpha** (number): Token opacity (0.0 to 1.0).
* **lockRotation** (boolean): Lock the token image rotation.
* **width / height** (number): Grid dimensions.
* **disposition** (number): Token disposition constant.
* **ring** (object): Dynamic Token Ring configuration.
* **effects** (array): List of Sequencer effects to play.

### Complete Data Example

Here is a complete example configuration illustrating a "Burning Ghost" appearance that uses Identity properties, Dynamic Ring, and Sequencer Effects.

```javascript
// Example 'changes' object structure
const changes = {
  // Core Token Data
  name: "Burning Ghost",         // Name override
  disposition: 1,                // 1=Friendly, 0=Neutral, -1=Hostile, -2=Secret
  width: 2,                      // Grid units (2x2)
  height: 2,
  
  // Visual Appearance
  texture: {
    src: "path/to/ghost_token.webp"
  },
  scale: 1.2,                    // Atomic Scale Override (120%)
  mirrorX: true,                 // Horizontal Flip
  alpha: 0.8,                    // Opacity
  lockRotation: true,            // Face stays upright
  
  // Dynamic Token Ring
  ring: {
    enabled: true,
    colors: {
      ring: "#FF4400",           
      background: "#000000"
    },
    effects: 2,                  // Bitmask: 2=Pulse, 4=Gradient, 8=Wave, 16=Invisibility
    subject: {
      texture: "path/to/ring_subject.webp",
      scale: 1.0
    }
  },

  // Sequencer Effects (New in v3.0)
  effects: [
    {
      id: "fire_aura",
      type: "visual",
      path: "jb2a.flames.01.orange",
      scale: 1.5,
      opacity: 0.8,
      zOrder: "below",           // "above" or "below"
      blendMode: "screen"
    },
    {
      id: "fire_sound",
      type: "audio",
      path: "sounds/fire_loop.ogg",
      opacity: 0.5               // Volume
    }
  ]
};