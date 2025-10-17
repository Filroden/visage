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

## 6. Development Log

### Session Summary (2025-10-17)

This session focused on taking the module from a non-functional state to a feature-complete, stable version, while adhering to Foundry VTT development best practices.

**Completed Work:**

1.  **UI Refactoring:** The initial Token Configuration UI, which was non-functional, was completely rebuilt. It is now correctly implemented as a dedicated "Visages" tab within the `TokenConfig` window, in line with Foundry v13 standards.
2.  **Data Storage:** On the advice of the system developer, all module data has been moved from the `actor.system` object to the correct `actor.flags` scope, preventing future conflicts with the game system. A cleanup script was provided to migrate existing worlds.
3.  **Core Logic Overhaul:**
    *   The logic for switching visages now correctly updates both the actor's main portrait and the specific token on the canvas.
    *   A major data persistence bug was fixed, ensuring that adding, editing, and especially deleting visages is now saved correctly.
4.  **Enhanced Default Image Handling:**
    *   The data model was improved to save separate default images for the actor portrait and token image.
    *   The module now automatically detects and updates these stored defaults if the user changes their base images through the standard actor or token sheets.
5.  **Wildcard Path Support (Initial Attempt):** An initial attempt was made to fix a bug where token images using wildcard paths (`*`) would appear broken in the module's UI. The UI was updated to resolve and display these images using `foundry.utils.randomizeWildcard`, which was later found to be incorrect for Foundry VTT v13.
6.  **Versioning:** The module version was updated to `0.2.0` to reflect the significant feature additions and breaking data changes.

### Session Summary (2025-10-17 - Wildcard Fix Iteration)

This session focused on correctly implementing wildcard path handling after previous attempts proved unsuccessful.

**Completed Work:**

1.  **Wildcard Resolution Debugging:** Identified that `foundry.utils.randomizeWildcard` and `TokenDocument#_getRandomizedImagePath` were not the correct APIs for Foundry VTT v13. Repeated attempts to find the correct API through documentation and web searches were unsuccessful.
2.  **Learning from External Module:** Analyzed the `token-variants` module to understand its approach to wildcard resolution, which provided the key insight into using `FilePicker.implementation.browse`.
3.  **Correct Wildcard Implementation:**
    *   Implemented a static `RMUVisage.resolvePath` method that uses `foundry.applications.apps.FilePicker.implementation.browse` with the `wildcard: true` option to resolve wildcard paths to a single random image for UI previews.
    *   Modified the `setVisage` function to store the raw wildcard path in `actor.prototypeToken.texture.src` and set `actor.prototypeToken.randomImg` to `true` (if the path is a wildcard). This leverages Foundry VTT's native wildcard randomization, fixing the "Invalid Asset" error on world load and ensuring correct behavior when reverting to default visages.
    *   Updated the `renderTokenConfig` hook and `VisageSelector` to utilize the new `RMUVisage.resolvePath` for displaying resolved images in the UI.

**Open Issue:**

*   **Token Config Tab Rendering:** A minor, non-critical UI glitch remains. If the `Token Configuration` dialog is closed while the "Visages" tab is active, reopening it will result in a blank tab. The content appears correctly after clicking on another tab and back. This issue has been parked as it does not affect functionality.

## 6. Known Issues

### A. Token Config Tab Rendering

*   **Symptom:** If the `Token Configuration` dialog is closed while the "Visages" tab is active, reopening the dialog will result in a blank tab content area.
*   **Workaround:** Click on any other tab (e.g., "Identity") and then click back on the "Visages" tab. The content will then appear correctly.
*   **Cause:** This is a race condition within the Foundry VTT V13 application rendering cycle. The application tries to render the "Visages" tab before the module script has had time to fully inject the tab's content, resulting in a blank panel. Attempts to programmatically fix this have been unreliable.