# Project Brief: Foundry VTT Module - RMU Visage

This document outlines the scope, data structure, and stylistic requirements for the `rmu-visage` module, intended for use with the Foundry VTT Rolemaster Unified (RMU) system.

## 1. Module Identity and Scope

| Attribute | Value |
| :--- | :--- |
| **Module ID** | `rmu-visage` |
| **Name** | RMU Visage |
| **Description** | Allows the owner of a linked Actor to instantly switch between multiple character images (visages) for the portrait and token via a custom, grid-based selector in the Token HUD. |
| **Target Foundry VTT** | v13 |
| **System** | Rolemaster Unified (RMU) |

## 2. Technical Requirements

### A. Language and Style

*   **Prose (README, documentation, commit messages):** Use British English spelling and terminology (e.g., "colour," "customise," "initialise").
*   **Code and Comments:** Use US English spelling and terminology (e.g., "color," "customize," "initialize").
*   **Code Documentation:** All functions, methods, and classes **must** be fully documented with clear, detailed comments explaining their purpose, parameters, return values, and any side effects.

### B. Data Structure (Crucial)

All module data must be stored on the Actor document under the module's own namespace in the `flags` scope.

| Field Name | Type | Location | Description |
| :--- | :--- | :--- | :--- |
| `defaults` | `Object` | `actor.flags.rmu-visage.defaults` | An object containing the default `portrait` and `token` image paths. |
| `alternateImages` | `Object` | `actor.flags.rmu-visage.alternateImages` | A map of Form Keys (strings) to Image Paths (strings). Contains all user-defined forms, *excluding* the default. |
| `currentFormKey` | `String` | `actor.flags.rmu-visage.currentFormKey` | The key identifying the currently active form (e.g., "default", "Wolf"). |

### C. Version Compatibility

This is intended for FoundryVTT version 13 which is largely using its new AppV2 for its UI.

### D. Core Logic

1.  **Actor-Centric Updates:** All image switching logic must target the **Actor Document** (`actor.update({ img: newPath, ... })`). This ensures that the Actor's portrait and *all* linked Token Documents update consistently.
2.  **Wildcard Path Handling:** When a token image path contains a wildcard (`*`), the raw wildcard path is stored in `actor.prototypeToken.texture.src`. Foundry VTT's native wildcard randomization is enabled by setting `actor.prototypeToken.randomImg` to `true`. For UI previews, wildcard paths are resolved to a single random image using `foundry.applications.apps.FilePicker.implementation.browse` with the `wildcard: true` option.
3.  **Permissions:** Checks must ensure only the Token Owner or a GM can trigger the form-switching functionality.

## 4. Public API Specification

The module must expose a public API under `game.modules.get('rmu-visage').api` to allow the RMU system or other modules to interact with its core functionality programmatically (e.g., triggered by skills, spells or item use).

| API Method | Signature | Purpose |
| :--- | :--- | :--- |
| `setVisage` | `(actorId: string, formKey: string): Promise<boolean>` | Core function to switch the Actor to the specified form. Returns `true` on success, `false` if the Actor or form key is not found. |
| `resetToDefault` | `(actorId: string): Promise<boolean>` | Switches the Actor back to the form associated with the `"default"` key. |
| `getForms` | `(actorId: string): Object \| null` | Retrieves the stored `alternateImages` data object for the Actor. |
| `isFormActive` | `(actorId: string, formKey: string): boolean` | Checks if the specified form is currently active on the Actor. |
| `resolvePath` | `(path: string): Promise<string>` | Resolves a path that may contain wildcards to a single, concrete file path for UI display. |

## 5. User Interface (UI) Implementation

### A. Configuration UI (GM/Owner)

*   **Location:** Extend the core Foundry VTT **Token Configuration Sheet** (`TokenConfig`).
*   **Feature:** Add a new, dedicated tab (e.g., "Visages") to the sheet.
*   **Content:** A dynamic list allowing the user to add, edit, and remove alternate forms, including a Form Name (key) and an Image File Path selected via the standard Foundry File Picker.

### B. Runtime UI (Player/Owner)

*   **Access Point:** Extend the **Token HUD** (`renderTokenHUD`) to add a custom control button (suggested icon: transformation or disguise symbol).
*   **Selector:** Clicking the HUD button must launch a custom, lightweight `Application` dialog (do not use the standard `Dialog` class) positioned near the token.
*   **Layout:** The dialog content must be a grid of visual tiles.
    *   **Tile:** Each tile displays the alternate image and the associated form name.
    *   **Highlight:** The tile corresponding to the current `currentFormKey` must be visually highlighted.
*   **Action:** Clicking any tile triggers the form-switching logic and automatically closes the dialog.

## 6. Known Issues

### A. Token Config Tab Rendering

*   **Symptom:** If the `Token Configuration` dialog is closed while the "Visages" tab is active, reopening the dialog will result in a blank tab content area.
*   **Workaround:** Click on any other tab (e.g., "Identity") and then click back on the "Visages" tab. The content will then appear correctly.
*   **Cause:** This is a race condition within the Foundry VTT V13 application rendering cycle. The application tries to render the "Visages" tab before the module script has had time to fully inject the tab's content, resulting in a blank panel. Attempts to programmatically fix this have been unreliable.

## 7. Roadmap

*   Add guards to the inputs - no blank names (or replace with default "Visage #"), no duplicate names, validate filepath
*   Add placeholder text to inputs ("...visage name", "...image filepath")
*   Consider adding settings to clear tokens and actors of visage data (tokens on scene, tokens on all scenes, tokens/actors in world)
*   Improve styling of visage selector panel - strong border, consider placing label over bottom of image inside border, etc