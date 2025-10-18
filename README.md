# Visage
A FoundryVTT module that allows a token's owner (player or GM) to add additional token art to the token within the token's configuration dialogue and then, via the token's HUD, quickly change both the token art and the actor's portrait so you can apply disguises, illusions, shapeshift forms, etc. It will store the original image paths and provide a quick way to return to the default images. This is purely a visual change of token and portrait image.


# Visage Module: Public API Documentation

The **Visage** module exposes a public API that allows other modules, system macros, or advanced users to programmatically interact with its core functionality, such as switching actor forms.

The API is accessible via `game.modules.get('rmu-visage').api`.

-----

## Accessing the API

To access any of the functions described below, you must first get a reference to the API object:

```javascript
const visageAPI = game.modules.get('rmu-visage')?.api;

if (!visageAPI) {
    console.error("RMU Visage API is not available.");
    return;
}
// Now you can call the functions, e.g., visageAPI.setVisage(...)
```

-----

## API Methods

### 1\. setVisage

The core function for changing an Actor's current form (visage).

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `actorId` | `string` | The ID of the Actor document to update. |
| `formKey` | `string` | The key of the form to switch to. Use `"default"` to switch to the Actor's base image. |
| `tokenId` | `string` | (Optional) The ID of a specific Token on the canvas to update immediately. If omitted, only the Actor's prototype token and portrait are updated. |

**Signature:**

```typescript
(actorId: string, formKey: string, tokenId?: string): Promise<boolean>
```

**Returns:**

  * `Promise<true>` on success.
  * `Promise<false>` if the Actor or the specified `formKey` is not found.

**Example: Switch to a 'Wolf' form**

```javascript
visageAPI.setVisage("actor-id-12345", "Wolf");
```

\<hr\>

### 2\. resetToDefault

A convenience function to switch the Actor back to its original portrait and prototype token image paths. This is equivalent to calling `setVisage` with `"default"`.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `actorId` | `string` | The ID of the Actor document to reset. |

**Signature:**

```typescript
(actorId: string): Promise<boolean>
```

**Returns:**

  * `Promise<true>` on success.
  * `Promise<false>` if the Actor is not found or no defaults have been saved.

**Example:**

```javascript
visageAPI.resetToDefault("actor-id-12345");
```

\<hr\>

### 3\. getForms

Retrieves the raw map of user-defined alternate forms (visages) stored on the Actor.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `actorId` | `string` | The ID of the Actor document. |

**Signature:**

```typescript
(actorId: string): Object | null
```

**Returns:**

  * An `Object` where keys are the form names (e.g., `"Wolf"`) and values are the image file paths, or `null` if no forms are defined or the Actor is not found.

**Example:**

```javascript
const forms = visageAPI.getForms("actor-id-12345");
// forms might look like: { "Wolf": "path/to/wolf.webp", "Disguise": "path/to/mask.webp" }
```

\<hr\>

### 4\. isFormActive

Checks if a specific form is currently active on the Actor.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `actorId` | `string` | The ID of the Actor document. |
| `formKey` | `string` | The key of the form to check (e.g., `"default"`, `"Wolf"`). |

**Signature:**

```typescript
(actorId: string, formKey: string): boolean
```

**Returns:**

  * `true` if the Actor's current form key matches the one provided, otherwise `false`.

**Example:**

```javascript
if (visageAPI.isFormActive("actor-id-12345", "default")) {
    console.log("The actor is in their default form.");
}
```

\<hr\>

### 5\. resolvePath

A utility function to resolve a file path that may contain a Foundry VTT wildcard (`*`) into a single, concrete image path. This is primarily used for displaying a single image in UI previews.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `path` | `string` | The file path (which may include a wildcard). |

**Signature:**

```typescript
(path: string): Promise<string>
```

**Returns:**

  * A `Promise` that resolves to the concrete file path. If the path does not contain a wildcard, the original path is returned.

**Example:**

```javascript
const wildcardPath = "path/to/images/*.webp";
const resolved = await visageAPI.resolvePath(wildcardPath);
// resolved might be: "path/to/images/wolf-03.webp"
```