# Visage

![Latest Version](https://img.shields.io/badge/Version-1.4.0-blue)
![Foundry Version](https://img.shields.io/badge/Foundry_VTT-v13_%7C_v13-orange)
![License](https://img.shields.io/badge/License-MIT-yellow)
![RTL Support](https://img.shields.io/badge/RTL-Supported-green)
![Languages](https://img.shields.io/badge/Languages-24-blueviolet)
![Download Count](https://img.shields.io/github/downloads/Filroden/visage/visage.zip)
![Download Count](https://img.shields.io/github/downloads/Filroden/visage/latest/visage.zip)
![Last Commit](https://img.shields.io/github/last-commit/Filroden/visage)
![Issues](https://img.shields.io/github/issues/Filroden/visage)

**Visage** allows players and GMs to instantly switch a token's appearance, disposition, and Dynamic Token Ring configuration on the fly.

Owners can configure and **store multiple alternate forms** (Visages) for any Actor — which are saved persistently and available to all its linked tokens across all scenes. Using a custom, grid-based **Token HUD Selector**, you can switch the token's image and name, adjust its visual scale (e.g., 150% for enlarge), flip its orientation, apply a disposition ('Friendly', 'Neutral', 'Hostile', or 'Secret' state) and completely reconfigure its Dynamic Token Ring settings (colours, effects, subject texture). **[New in v1.5.0]** You can also change a token's actual dimensions (width and height).

The module supports:

* **all image or video formats** that are valid for tokens.

<img src="images/animated_tokens.gif" alt="Visage Configuration Window showing RTL support for Arabic" style="margin-inline-start: 3rem; height: 250px;">

* **supports wildcard filepaths** (e.g., path/to/wolves/*.webp), letting you select a random image from a folder every time the **Visage** is activated.

This module makes it ideal for dynamic gameplay without requiring time-consuming manual edits in the core Token Configuration window every change.

This is the perfect module for visually resolving common game mechanics across any system. Use **Visage** for quick application of **illusions** and **disguises** that change the token's appearance and name to fool opponents. Simplify **shapeshifting** abilities by visually swapping to another image with one click. It is also an excellent tool for showing visual effects, such as changing scale to represent the token getting smaller or larger.

**Visage** increases immersion and table speed by placing powerful visual controls directly within the Token HUD, providing **one-click access to all your stored alternative forms**.

[Version History](VERSION.md)

## Localization & Accessibility

**Visage** is designed to be accessible:

* **Responsive UI**: The interface is fully responsive to changes in the base font size and scales naturally for users requiring larger text.
* **Native RTL Support**: Includes full **Right-to-Left (RTL)** support. If your Foundry client is set to an RTL language (e.g., Arabic, Hebrew), the Visage UI (Selector HUD, Configuration Window, and Dynamic Ring Editor) automatically mirrors its layout to ensure a natural reading experience.

<div style="display: flex; justify-content: center; align-items: flex-start; gap: 20px;"><div style="text-align: center;"><img src="images/visage_configuration_ar.png" alt="Visage Configuration Window showing RTL support for Arabic" style="max-width: 100%; height: 250px; object-fit: contain;"></div><div style="text-align: center;"><img src="images/visage_configuration_he.png" alt="Visage Configuration Window showing RTL support for Hebrew" style="max-width: 100%; height: 250px; object-fit: contain;"></div></div>

* **Languages**: Currently supports Arabic, Catalan, Chinese (Simplified and Traditional), Czech, Dutch, English (UK and US), Finnish, French, German, Hebrew, Hungarian, Italian, Japanese, Korean, Persian, Polish, Portuguese (Brazil and Portugal), Romanian, Russian, Spanish (Latin America and Spain), Swedish, Turkish, Ukrainian and Welsh.

## Licence

Software and associated documentation files in this repository are covered by an [MIT License](LICENSE.md).

## Roadmap

[Short term]

* 

[Long term]

* Add the ability to create and use a global directory of visages, so certain effects can be applied quickly to any token (e.g., enlarge/reduce effects).
* Consider adding the ability to create and edit visages from actors without needing to place a token on the scene.
* Test module against FoundryVTT v14.

## How to Use Visage

**Visage** makes it easy to switch a token's appearance, name, and mechanical state on the fly. Here’s how to set it up and use it.

### 1. Configuring Visages

Before you can switch **Visages**, you need to define them for a token. These **Visages** are stored on the actor and are available to all tokens of that actor.

1. **Open Visage Configuration**: Right-click on a token and choose the **Visage** icon in the Token HUD (a "switch account" symbol) to open the **Visage Selector HUD**. In the top right corner, click the settings ("cog") icon to open the **Visage Configuration** window.
2. **Review Visage Defaults**:
    * The **Visage Configuration** window shows the token's current default name and image path. These are the settings the token will have when its **Visage** is set to "Default".
    * By default, these are inherited from the actor's main settings. However, you can override them by changing the token name/image/disposition on the Token's main configuration window. **Visage** automatically tracks these changes.
3. **Add Alternate Visages**:
    * Click the "**Add Visage**" button to create a new alternate form.
    * For each  **Visage**, you can provide:
        * **Name**: A name for the **Visage** (e.g., "[Name] (Wolf Form)", "[Name] (Enlarged)", "Barrel"). This name will also be used for the token's name when this **Visage** is active so remember this is what other players will see. **This is optional**.
            * If you leave this field blank, the Visage will use the token's current default name when applied.
            * If you provide a name, it will override the token's name as usual.
        * **Image Path**: The path to the image file for this **Visage**. **This is optional**.
            * If you leave this field blank, the Visage will use the token's current default image when applied.
            * You can use the folder icon to open the File Picker. Wildcards (`*`) are supported (e.g., 'path/to/images/wolf_*.webp').
        * **Scale**: A percentage scale factor (e.g., `100%`, `80%`, `150%`). This will visually enlarge or shrink the token image on the canvas without changing its actual size. The default is `100%` (no change).
        * **Flip**: If ticked, the image will be flipped horizontally.
        * **Disposition**: Controls the token's disposition (border colour and interactability) when this **Visage** is active. Next to the Flip checkbox, there's a **Disposition** button showing the current setting (e.g., 'Default', 'Disguise: Friendly', 'Illusion: Secret').
            * Clicking this button opens a pop-out where you can choose one of the following overrides:
                * **Default (No Change)**: The **Visage** won't affect the token's disposition. It will keep whatever disposition the token currently has or revert to its original default if switching back to the "Default" **Visage**.
                * **Disguise As**: Select **Friendly**, **Neutral**, or **Hostile**. This changes the token's border colour and how others might perceive it.
                * **Illusion (Secret)**: Sets the token to the **Secret** state (purple border for owner, non-interactive for others). This is mutually exclusive with Friendly/Neutral/Hostile.
        * **Dynamic Ring**: Click the Target Icon button to open the Ring Editor.
            * **Enable Ring Override**: Check this to force specific ring settings for this visage. If unchecked, the visage will inherit the token's current ring settings.
            * **Subject**: You can override the texture used inside the ring (leave blank to use the main Visage image) and adjust the subject scale correction independently.
            * **Colours**: Define the Ring Colour and Background Colour.
            * **Effects**: Enable special ring animations like Pulse, Gradient, Wave, or Invisibility.
        * **Token Dimensions** (width and height): Enter the size, in grid spaces, for the token's size. Note that this changes the actual token size and can have in-game impacts such as calculating cover, attack size, etc.
4. **Delete Alternative Visages**: Click the trash icon to delete the **Visage**.
5. **Save Changes**: If you make any changes (add new **Visage**, change a value in an existing **Visage**, or delete a **Visage**), the "Save Changes" button will highlight. Clicking it will save the changes and close the **Visage Configuration** window.

<img src="images/visage_configuration.png" alt="Visage Configuration window" width="500" style="display: block; margin: 0 auto;">
<br>
<img src="images/ring_editor.png" alt="Visage Dynamic Ring Editor" height="500" style="display: block; margin: 0 auto;">

### 2. Selecting a Visage

Once configured, switching between **Visages** is simple.

1. **Open the Token HUD**: Click on a token you have configured to bring up the Token HUD.
2. **Click the Visage Icon**: You will see an icon (a "switch account" symbol). Click this to open the **Visage Selector HUD**.
3. **Choose a Visage**: A grid will appear next to the token showing all the available **Visages** you configured.
    * Each tile will show the name and image you have set (or the default image if it was blank).
    * If a **Visage** uses a Dynamic Token Ring, the **Visage** will show the ring with your configured colours, background style and any animation effects, giving you an immediate preview of the effect.
    * **Corner Buttons**
        * The token's "Default" **Visage** has a gold star icon in the top left corner.
        * The active **Visage** is highlighted with a green check icon in the top right corner.
        * If a **Visage** uses a wildcard in its filepath, it will show a blue shuffle icon in the bottom left corner. Selecting it again will pick another random image.
        * If a Visage's image has been flipped it will show a purple mirror-image icon in the bottom right corner.
    * **Information Chips**
        * If a **Visage** has a scale that is not 100% or it has a different token size to the default, these will be shown in a chip on the top border.
        * If a **Visage** changes the token's disposition, a coloured chip will appear at the bottom-center indicating the state (e.g., 'Friendly', 'Hostile', 'Secret'), matching Foundry's disposition colours.
4. **Click to Switch**: Simply click on a **Visage** in the grid. The token's image, name, scale, flip, and disposition will instantly update to match your selection, and the selector will close.

<img src="images/selector_hud.png" alt="Visage Selector HUD showing available Visages and their saved changes" height="500" style="display: block; margin: 0 auto;">

### 3. Restoring the Default

To switch a token back to its original appearance:

1. Open the **Visage Selector HUD** from the Token HUD.
2. Click on the Default **Visage** (marked with a gold star in the top left corner).
3. The token will revert to the default name, image, scale, flip state, and disposition that **Visage** automatically captured for it.

### 4. Deleting all Visage-related data

For GMs, the module offers two settings that will remove all Visage-related data from either all tokens on a scene or from all tokens on all scenes. Use this with caution as it cannot be undone.

## Visage Module: Public API Documentation

The **Visage** module exposes a public API that allows other modules, system macros, or advanced users to programmatically interact with its core functionality, such as switching actor forms.

The API is accessible via `game.modules.get('visage').api`.

-----

### Accessing the API

To access any of the functions described below, you must first get a reference to the API object:

```javascript
const visageAPI = game.modules.get('visage')?.api;

if (!visageAPI) {
    console.error("Visage API is not available.");
    return;
}
// Now you can call the functions, e.g., visageAPI.setVisage(...)
````

-----

### API Methods

#### 1\. setVisage

The core function to switch the specified Token to the specified appearance form and apply its configured overrides.

| Parameter | Type     | Description                                                                                                                                                                                |
| :-------- | :------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actorId` | `string` | The ID of the Actor document associated with the token. |
| `tokenId` | `string` | The ID of a specific Token on the canvas to update immediately. |
| `formKey` | `string` | The unique identifier (UUID) of the appearance form to switch to (e.g., `"a1b2c3d4e5f6g7h8"`). Use the string literal `"default"` to switch to the Token's captured default image, name, scale, and disposition. |

**Signature:**

```typescript
(actorId: string, tokenId: string, formKey: string): Promise<boolean>
```

**Returns:**

* `Promise<true>` on success.
* `Promise<false>` if the Actor, Token, or the specified `formKey` is not found, or if the update fails.

**Details:**

This function updates the token's `name`, `texture.src`, `texture.scaleX`, `texture.scaleY`, `width`, `height`, `disposition` and dynamic `ring`configuration based on the data saved for the specified `formKey`. If the `formKey` is `"default"`, it restores the values captured automatically by Visage. If the configured disposition for the form is set to `"Default (No Change)"` (`null` internally), the token's disposition will *not* be modified by this call when switching to that form. If the saved visage has a blank name or image path, this function will automatically use the token's captured default name/image instead.

**Example:** Switch a specific token to a 'Wolf' form

```javascript
visageAPI.setVisage("actor-id-12345", "token-id-67890", "a1b2c3d4e5f6g7h8");
```

#### 2\. getForms

Retrieves a standardised array of all available alternate visages for a given Actor.

| Parameter | Type     | Description                          |
| :-------- | :------- | :----------------------------------- |
| `actorId` | `string` | The ID of the Actor document to query. |
| `tokenId` | `string` (optional) | The ID of a specific Token. If provided, its defaults will be used for fallbacks. If omitted, the Actor's prototype token data will be used instead. |

**Signature:**

```typescript
(actorId: string, tokenId?: string): Array<object> | null
```

**Returns:**

* An `Array` of visage objects, where each object has the following structure:
  * `key` (string): The internal unique identifier (UUID) for the visage.
  * `name` (string): The resolved display name. If the visage had a blank name, this will be the default name (either from the token or the prototype).
  * `path` (string): The resolved image file path. If the visage had a blank path, this will be the default image path.
  * `scale` (number): The configured scale factor for the visage (e.g., `1.0`, `1.2`, `-0.8`).
  * `disposition` (number | null): The configured disposition override value (`1`: Friendly, `0`: Neutral, `-1`: Hostile, `-2`: Secret) or `null` if the visage is set to "Default (No Change)".
  * `ring` (object | null): The Dynamic Ring configuration object. Contains { `enabled`, `subject`, `colors`, `effects` }. Returns null or an empty object if no ring overrides are set.
  * `width` (number): The token's width in grid spaces (e.g., 1).
  * `height` (number): The token's height in grid spaces (e.g., 2).
* Returns `null` if no alternate forms are defined or the Actor is not found.

**Example 1: Using only an Actor ID**

```javascript
// This will use the actor's prototype token for fallbacks
const forms = visageAPI.getForms("actor-id-12345");

// forms might look like:
// [ 
//   { 
//     key: "a1...", 
//     name: "Wolf", 
//     path: "path/to/wolf.webp", 
//     scale: 1.2,
//     width: 1,
//     height: 1,
//     disposition: -1,
//     ring: { enabled: false } // Ring explicitly disabled
//   }, 
//   { 
//     key: "b2...", 
//     name: "Spectral Form", 
//     path: "path/to/ghost.webp", 
//     scale: 1.0,
//     width: 2,
//     height: 2,
//     disposition: -2, // Secret
//     ring: { 
//        enabled: true, 
//        colors: { ring: "#00FF00", background: "#000000" }, 
//        effects: 2 // Pulse
//     } 
//   } 
// ]

```

#### 3\. isFormActive

Checks if the specified appearance form is currently active on a specific Token.

| Parameter | Type     | Description                                                                 |
| :-------- | :------- | :-------------------------------------------------------------------------- |
| `actorId` | `string` | The ID of the Actor document associated with the token.                     |
| `tokenId` | `string` | The ID of the token on the canvas to check.                                 |
| `formKey` | `string` | The unique identifier (UUID) of the appearance form to check (e.g., `"default"`, `"a1b2c3..."`, etc). |

**Signature:**

```typescript
(actorId: string, tokenId: string, formKey: string): boolean
```

**Returns:**

* `true` if the token's currently applied form key matches the one provided, otherwise `false`.

**Example:**

```javascript
if (visageAPI.isFormActive("actor-id-12345", "token-id-67890", "a1b2c3d4e5f6g7h8")) {
    console.log("The token is in its default form.");
}
```

#### 4\. resolvePath

A utility function to resolve a file path that may contain a Foundry VTT wildcard (`*`) into a single, concrete image path. This is primarily used for displaying a single image in UI previews.

| Parameter | Type     | Description                                |
| :-------- | :------- | :----------------------------------------- |
| `path`    | `string` | The file path (which may include a wildcard). |

**Signature:**

```typescript
(path: string): Promise<string>
```

**Returns:**

* A `Promise` that resolves to the concrete file path. If the path does not contain a wildcard, the original path is returned. If resolution fails (e.g., no matching files), the original path is returned as a fallback.

**Example:**

```javascript
const wildcardPath = "path/to/images/*.webp";
const resolved = await visageAPI.resolvePath(wildcardPath);
// resolved might be: "path/to/images/wolf-03.webp"
```

-----

## Note on Token vs. Actor IDs

The Visage API methods generally require both an `actorId` and a `tokenId` because the custom visage configurations are stored on the Actor Document, but the visual changes (image, name, scale, disposition) must be applied to the specific Token Document on the canvas. The currently active form is also tracked per-token.

The Visage API methods like `setVisage` and `isFormActive` require both an `actorId` and a `tokenId` because the custom visage configurations are stored on the Actor Document, but the visual changes (image, name, scale, disposition) must be applied to the specific Token Document on the canvas. The currently active form is also tracked per-token. The `getForms` method is an exception, as it can function with just an `actorId` (falling back to prototype token data), but providing a `tokenId` will yield more accurate results for default values.

You can reliably get both IDs from any selected Token instance (`token`) on the canvas using:

```javascript
const tokenId = token.id;
const actorId = token.actor.id; // Works for both linked and unlinked tokens
```
