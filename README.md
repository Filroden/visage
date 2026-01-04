# Visage

![Latest Version](https://img.shields.io/badge/Version-2.0.0-blue)
![Foundry Version](https://img.shields.io/badge/Foundry_VTT-v13_%7C_v13-orange)
![License](https://img.shields.io/badge/License-MIT-yellow)
![RTL Support](https://img.shields.io/badge/RTL-Supported-green)
![Languages](https://img.shields.io/badge/Languages-24-blueviolet)
![Download Count](https://img.shields.io/github/downloads/Filroden/visage/visage.zip)
![Download Count](https://img.shields.io/github/downloads/Filroden/visage/latest/visage.zip)
![Last Commit](https://img.shields.io/github/last-commit/Filroden/visage)
![Issues](https://img.shields.io/github/issues/Filroden/visage)


**Visage** is the ultimate token management tool for Foundry VTT. It allows players and GMs to instantly switch a token's appearance, disposition, size, scale, orientation and Dynamic Token Ring configuration using a dedicated HUD. Use it in any game system to support dynamic gameplay without requiring time-consuming manual edits in the core Token Configuration window every change.

**New in v2.0:** Visage now features a **Non-Destructive Stack System**. You can layer partial overrides ("Masks") on top of identity swaps ("Visages"). For example, change a token's image (Visage), then change its size to 2x2 (Mask) to show an "enlarge" effect, and remove them individually to return to the original state perfectly every time.

* For how to use Visage, check the [Wiki](https://github.com/Filroden/visage/wiki).
* To discuss the module, or suggest ideas, check the [Discussion Forum](https://github.com/Filroden/visage/discussions).

## Core Concepts

Visage separates visual changes into two distinct types to handle complex game scenarios:

### The Visage (Local Identity)

**"Who am I?"**
Saved on the token's **Actor**. These represent alternate forms of a specific character. When applied, a Visage becomes the token's new "Base Identity,". Visages are managed by players (for tokens they own) and by GMs.

* *Examples:* A Druid's Wild Shape, a Changeling's personas, a Werewolf's hybrid form, or simply a character changing their outfit.

### The Mask (Global Override)

**"What is affecting me?"**
Saved in the **World** to create library of potential effects for the GM to apply to one or more tokens. These are generic overrides that can be applied to *any* token. Masks act as layers on top of the current identity, modifying specific fields (like just the Ring Colour or just the Image) without overwriting the underlying character data.

* *Examples:*
  * **"Friendly":** Override the token's disposition to keep that BBEG's real feelings a secret.
  * **"Hidden":** Swaps the image to a "Shadow" or "Barrel" icon (keeps the character's name).
  * **"Dead":** Swaps the image to a generic "Tombstone" marker.
  * **"Enlarged":** Change the tokens scale and/or dimensions.

## Key Features

### 1. The Selector HUD

Access the token's entire Visage library directly from the Token HUD to quickly apply any Visages or to manage any existing masks on that token. No more having to edit the token's settings every time you want to make a change.

* **Grid Layout:** Quickly browse all available Visages.
* **Active Stack:** See exactly what Masks are active on the token.
* **Quick Revert:** Strip all disguises or revert specific layers with one click.

[ADD IMAGE OF HUD]

### 2. The Gallery (for Visages) & Library (for Masks)

Manage your visual assets in a beautiful, card-based interface.

* **Visage Gallery:** Accessed from the HUD, from an actor's sheet header or by right-clicking an actor in the sidebar. Manage Visages specific to that token/actor.
* **Mask Library:** Accessed via Scene Controls. Create generic masks usable by the GM on any token. Apply them to one or more selected tokens, or even **drag and drop** them onto tokens, to take immediate effect.
* **Detailed Search:** Filter by tags, categories, or name to find the right look instantly.

[ADD IMAGE OF GALLERY AND LIBRARY]

### 3. The Visual Editor

An editor that lets you build and **preview** your token's appearance before saving it.

* **Video Support:** Use `.webm` or `.mp4` files for animated transformations.
* **Wildcard Support:** Point a Visage to a folder (e.g., `creatures/wolves/*`). Every time you apply it, a random image from that folder is chosen.
* **Scale & Flip:** Pre-configure scale (e.g., Enlarge Person = 200%) and orientation/mirroring.

[ADD IMAGE OF EDITOR]

### 4. The Token Previewer

**Live Visualisation:** A preview of the token is shown in the Selector HUD, Gallery, Library and in the Editor so you can see a good approximation of how your Visages and Masks will look before you save or apply them (including Dynamic Ring effects). Some effects cannot be shown (such as changes to scale or dimensions) so all previews show full information on the changes included in the Visage or Mask.

[ADD IMAGE OF CARD PREVIEW AND SELECTOR HUD TILE PREVIEW]

### 5. Non-Destructive Editing

The module protects your data. If you open the core Token Configuration window while a Visage or Mask is active, the module intercepts the window to show you the **Original Token Data**.

* This prevents you from accidentally overwriting your Druid's human face with their Bear face permanently.
* Edits made to the prototype token are intelligently merged into the background state, preserving your changes even when the mask comes off.

## Ideas for how to use the module

* **Polymorph, Wild Shapes and Illusions:** One click to turn a PC into a T-Rex, a tabby cat or even a table. One click to turn them back.
* **Costumes and Poses:** Create Visages to show your character in normal clothes, in their Sunday best, or fully armoured and ready to face adversity. Show the character in a neutral pose or with weapons drawn.
* **Disguise Self:** Create a "Guard Disguise" Visage. The nameplate changes to "Town Guard" and the image swaps, fooling players or NPCs.
* **Spell Effects:** Effects like Enlarge and Shrink can easily be applied.
* **Status Indicators:** Create a Mask that only changes the Dynamic Ring colour (e.g., Purple for "Charmed", Red for "Bloodied"). Apply it to any token to visually flag their status without changing their avatar.
* **Narrative Reveals:** Change an NPC's disposition as players interact with them, developing long term relationships or creating new enemies. Or use it as a way to hide the true intent of that BBEG masquerading as the town mayor.

## Localisation & Accessibility

**Visage** is designed to be accessible:

* **Responsive UI**: The interface is fully responsive to changes in the base font size and scales naturally for users requiring larger text.
* **Native RTL Support**: Includes full **Right-to-Left (RTL)** support. If your Foundry client is set to an RTL language (e.g., Arabic, Hebrew), the Visage UI automatically mirrors its layout.

<div style="display: flex; justify-content: center; align-items: flex-start; gap: 20px;">
    <img src="images/visage_configuration_ar.png" alt="RTL support for Arabic" style="height: 200px; object-fit: contain;">
    <img src="images/visage_configuration_he.png" alt="RTL support for Hebrew" style="height: 200px; object-fit: contain;">
</div>
<br>

* **Languages**: Currently supports Arabic, Catalan, Chinese (Simplified and Traditional), Czech, Dutch, English (UK and US), Finnish, French, German, Hebrew, Hungarian, Italian, Japanese, Korean, Persian, Polish, Portuguese (Brazil and Portugal), Romanian, Russian, Spanish (Latin America and Spain), Swedish, Turkish, Ukrainian and Welsh.

## [Version History](VERSION.md)

## Licence

Software and associated documentation files in this repository are covered by an [MIT License](LICENSE.md).

## Roadmap

### Short term

* **Visage Swap (v2.1):** Option to permanently overwrite the default token with the currently selected Visage.
* **Type Conversion (v2.2):** Ability to move a Local Visage to the Global Library (and vice versa).
* **Import/Export (v2.3):** Share Visage configurations between worlds.

### Long term

* **Unified Card Architecture:** Refactoring UI for greater consistency.
* **Visual FX Layers:** Integration with PIXI filters for true visual effects (Bloom, Glitch, Opacity adjustments, etc.).
