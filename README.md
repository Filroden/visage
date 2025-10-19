# Visage
Allows the owner of an Actor to instantly switch a Token's image and name between multiple pre-defined visages via a custom, grid-based selector in the Token HUD.


# Visage Module: Public API Documentation

The **Visage** module exposes a public API that allows other modules, system macros, or advanced users to programmatically interact with its core functionality, such as switching actor forms.

The API is accessible via `game.modules.get('visage').api`.

-----

## Accessing the API

To access any of the functions described below, you must first get a reference to the API object:

```javascript
const visageAPI = game.modules.get('visage')?.api;

if (!visageAPI) {
    console.error("Visage API is not available.");
    return;
}
// Now you can call the functions, e.g., visageAPI.setVisage(...)
```

-----

## API Methods

### 1\. setVisage

The core function to switch the specified Token to the specified form.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `actorId` | `string` | The ID of the Actor document to update. |
| `tokenId` | `string` | The ID of a specific Token on the canvas to update immediately. |
| `formKey` | `string` | The key of the form to switch to. Use `"default"` to switch to the Token's default image and name. |

**Signature:**

```typescript
(actorId: string, tokenId: string, formKey: string): Promise<boolean>
```

**Returns:**

  * `Promise<true>` on success.
  * `Promise<false>` if the Actor, Token, or the specified `formKey` is not found.

**Example: Switch a specific token to a 'Wolf' form**

```javascript
visageAPI.setVisage("actor-id-12345", "token-id-67890", "Wolf");
```

\<hr\>

### 2\. getForms

Retrieves the universal `alternateImages` data object for the Actor.

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

### 3\. isFormActive

Checks if the specified form is currently active on a specific Token.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `actorId` | `string` | The ID of the Actor document. |
| `tokenId` | `string` | The ID of the token to check. |
| `formKey` | `string` | The key of the form to check (e.g., `"default"`, `"Wolf"`). |

**Signature:**

```typescript
(actorId: string, tokenId: string, formKey: string): boolean
```

**Returns:**

  * `true` if the token's current form key matches the one provided, otherwise `false`.

**Example:**

```javascript
if (visageAPI.isFormActive("actor-id-12345", "token-id-67890", "default")) {
    console.log("The token is in its default form.");
}
```

\<hr\>

### 4\. resolvePath

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