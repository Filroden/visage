# Visage Public API & Data Model

Access the module's core functions programmatically via `game.modules.get('visage').api`.

## Core API Methods

### `apply(token, visageId, [options])`

Adds a Visage (Identity or Overlay) to the token's active stack and instantly renders the changes.

* **token**: `Token` object or ID string.
* **visageId**: `string` - The ID of the local or global Visage to apply.
* **options**: Object containing modification flags:
  * `switchIdentity` *(boolean)*: If `true`, forces this item to act as an **Identity** (swapping the base texture). If `false`, forces **Overlay** (stacking on top). *Default: Auto-detected from the item's `mode`.*
  * `clearStack` *(boolean)*: If `true`, removes all existing layers before applying the new one. *Default: `false`.*
* **Returns**: `Promise<boolean>`

### `remove(token, visageId)`

Removes a specific layer from the token's active stack.

* **token**: `Token` object or ID.
* **visageId**: `string` - The ID of the layer to remove.
* **Returns**: `Promise<boolean>`

### `revert(token)`

Clears the entire stack (Identities and Overlays) and restores the token to its original, true default appearance, halting all active media effects.

* **token**: `Token` object or ID.
* **Returns**: `Promise<boolean>`

### `isActive(token, visageId)`

Checks if a specific Visage is currently active in the token's stack.

* **token**: `Token` object or ID.
* **visageId**: `string` - The ID of the Visage.
* **Returns**: `boolean`

### `getAvailable(token)`

Retrieves a combined array of all Visages (Local and Global) that can be applied to the specified token.

* **token**: `Token` object or ID.
* **Returns**: `Array<Object>` - An array of Visage data objects.

### `toggleLayer(token, layerId)`

Toggles the visibility (suppression) of a specific layer in the stack without removing it from the stack's memory.

* **token**: `Token` object or ID.
* **layerId**: `string` - The ID of the layer.
* **Returns**: `Promise<void>`

### `reorderStack(token, newOrderIds)`

Reorders the Z-index application of the active stack.

* **token**: `Token` object or ID.
* **newOrderIds**: `Array<string>` - An array of Layer IDs in the desired order (from bottom to top).
* **Returns**: `Promise<void>`

### `compose(token, customStack)`

Forces the engine to recalculate and render the token's appearance based on a provided stack. Useful for previews or temporary states.

* **token**: `Token` object or ID.
* **customStack**: `Array<Object>` - An array of Visage layer objects to compose.
* **Returns**: `Promise<void>`

---

## The Visage Data Model

Below is a comprehensive example of a Visage object stored in the database, including visual changes, ring parameters, Sequencer effects, and the V4 Automation engine data.

```javascript
{
  id: "abc123xyz456def7",
  label: "Enraged Fire Elemental",
  category: "Transformations",
  tags: ["fire", "elemental", "boss"],
  
  // 'identity' replaces the base token; 'overlay' stacks on top
  mode: "identity", 
  
  // true = Players can apply this from their Selector HUD
  // false = Private (GM Only)
  public: true, 

  // ----------------------------------------------------
  // VISUAL APPEARANCE ('changes' payload)
  // ----------------------------------------------------
  changes: {
    // Core Token Data
    name: "Burning Ghost",         // Name override
    disposition: -1,               // 1=Friendly, 0=Neutral, -1=Hostile, -2=Secret
    width: 2,                      // Grid units (2x2)
    height: 2,
    
    // Core Visuals (V13 Decoupled Schema)
    texture: {
      src: "path/to/ghost_token.webp",
      anchorX: 0.5,
      anchorY: 0.5
    },
    scale: 1.2,                    // Atomic Size Override (120%)
    mirrorX: true,                 // Horizontal Flip
    mirrorY: false,                // Vertical Flip
    alpha: 0.8,                    // Opacity
    lockRotation: true,            // Face stays upright regardless of movement
    
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

    // Light Source Emission
    light: {
      dim: 20,
      bright: 10,
      color: "#ff5500",
      alpha: 0.5,
      animation: {
        type: "torch",
        speed: 5,
        intensity: 5
      }
    },

    // Sequencer Effects (Visual & Audio)
    effects: [
      {
        id: "fire_aura",
        type: "visual",            // 'visual' or 'audio'
        path: "jb2a.fire_aura.01", // File path or Sequencer DB key
        zOrder: "below",           // 'above' or 'below' the token
        scale: 1.5,
        opacity: 0.8
      }
    ]
  },

  // ----------------------------------------------------
  // AUTOMATION ENGINE ('automation' payload - v4.0.0)
  // ----------------------------------------------------
  automation: {
    enabled: true,
    logic: "AND",                  // 'AND' (all conditions must be true) or 'OR' (any condition)
    onEnter: { action: "apply", priority: 0 },
    onExit: { action: "remove", delay: 0 },
    
    conditions: [
      // Example 1: Trigger based on an Actor Attribute
      {
        type: "attribute",
        path: "system.attributes.hp.value",
        operator: "lte",           // 'lte' (<=), 'gte' (>=), 'eq' (==), 'neq' (!=)
        value: 50,
        mode: "percent",           // 'absolute' or 'percent'
        denominatorPath: "system.attributes.hp.max" 
      },
      
      // Example 2: Trigger based on a Status/Active Effect
      {
        type: "status",
        statusId: "Rage",          // Core status ID or string name of an Active Effect
        operator: "active"         // 'active' (applied) or 'inactive' (removed)
      },

      // Example 3: Trigger based on Game Events
      {
        type: "event",
        eventId: "combat",         // 'combat', 'movement', 'darkness', 'region', etc.
        operator: "active"
      }
    ]
  }
}

```
