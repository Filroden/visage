# Visage

![Latest Version](https://img.shields.io/badge/Version-2.4.0-blue)
![Foundry Version](https://img.shields.io/badge/Foundry_VTT-v13_%7C_v13-orange)
![License](https://img.shields.io/badge/License-MIT-yellow)
![RTL Support](https://img.shields.io/badge/RTL-Supported-green)
![Languages](https://img.shields.io/badge/Languages-24-blueviolet)
![Download Count](https://img.shields.io/github/downloads/Filroden/visage/visage.zip)
![Download Count](https://img.shields.io/github/downloads/Filroden/visage/latest/visage.zip)
![Last Commit](https://img.shields.io/github/last-commit/Filroden/visage)
![Issues](https://img.shields.io/github/issues/Filroden/visage)


**Visage** is the ultimate token management tool for Foundry VTT. It allows players and GMs to instantly switch a token's appearance, disposition, size, scale, horizontal/vertical orientation, opacity, rotation lock, and Dynamic Token Ring configuration using a dedicated HUD. Use it in any game system to support dynamic gameplay without requiring time-consuming manual edits in the core Token Configuration window every change.

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

  ![Visage Selector HUD](images/v2/visage_selector_hud.png?raw=true)

### 2. The Gallery (for Visages) & Library (for Masks)

Manage your visual assets in a beautiful, card-based interface with a detailed search where you can filter by tags, categories, or name to find the right look instantly.

* **Visage Gallery:** Accessed from the HUD, from an actor's sheet header or by right-clicking an actor in the sidebar. Manage Visages specific to that token/actor.

  ![Visage Gallery](images/v2/visage_gallery.png?raw=true)

* **Mask Library:** Accessed via Scene Controls. Create generic masks usable by the GM on any token. Apply them to one or more selected tokens, or even **drag and drop** them onto tokens, to take immediate effect.

  ![Mask Library](images/v2/mask_library.png?raw=true)

Available actions (some only available when you are in the Visage Gallery or the Mask Library):

* **Apply**: Apply the selected Mask or Visage to the token(s).
* **Edit**: Edit the Mask or Visage using the Editor.

And within the popup menu:

* **Duplicate (New in v2.4)**: Create a copy of an existing Mask or Visage.
* **Commit to Default (New in v2.1)**: Found a permanent new look? You can now swap a Visage to become the token's new "Default" state directly from the Gallery. Visage automatically creates a backup of the previous default appearance, so you never lose your history.
* **Promote Visage to the global Mask Library (New in v2.2)**: As a GM, do you like a particular look and want to use it on other tokens? Simply "Promote" (copy) it to the Mask Library.
* **Copy Mask to the local Visage Gallery of selected token(s) (New in v2.3)**: As a GM, you can also do the reverse, and transfer a Mask to the selected token(s)'s Visage Gallery.
* **Import/Export Visages and Masks (New in v2.3 and v2.4)**: Export your entire Mask Library so it can be transferred to another world or export them individually. Save one or all the Visages from one token so they can be added to others. Importing will prevent duplication of existing Masks or Visages if they share the same unique ID. When importing Masks or Visages created in earlier versions of the module, it will intelligently make any changes needed to the data to bring it up to date.
* **Delete**: Soft delete (send to Recycle Bin).

### 3. The Visual Editor

An editor that lets you build and **preview** your token's appearance before saving it.

![Mask Editor](images/v2/mask_editor.png?raw=true)

Key Features:
* **Video Support:** Use `.webm` or `.mp4` files for animated transformations.

  ![Live Preview of animated tokens](images/v2/visage_animated_preview.gif?raw=true)

* **Wildcard Support:** Point a Visage to a folder (e.g., `creatures/wolves/*`) or include wildcards (`*` or `?`) within the filename. Every time you apply it, a random image that matches is chosen.

### 4. The Token Previewer

**Live Visualisation:** A preview of the token is shown in the Selector HUD, Gallery, Library and in the Editor so you can see a good approximation of how your Visages and Masks will look before you save or apply them (including Dynamic Ring effects and any subject textures applied). Some effects cannot be shown (such as changes to scale or dimensions) so all previews show full information on the changes included in the Visage or Mask.

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
* **Languages**: Currently supports Arabic, Catalan, Chinese (Simplified and Traditional), Czech, Dutch, English (UK and US), Finnish, French, German, Hebrew, Hungarian, Italian, Japanese, Korean, Persian, Polish, Portuguese (Brazil and Portugal), Romanian, Russian, Spanish (Latin America and Spain), Swedish, Turkish, Ukrainian and Welsh.

## Version History

[Version History](VERSION.md)

## Licence

Software and associated documentation files in this repository are covered by an [MIT License](LICENSE.md).

## Roadmap

### Next Major Update (v3.0.0)

* **Sequencer Integration:** Deep integration with the **Sequencer** module (and libraries like JB2A/PSFX). Allow users to attach specific visual effects and sounds to a Visage or Mask that trigger automatically when applied or removed, or remain as a persistant effect.

### Long term (no promises!)

* **Visual FX Layers/token image builder:** Integration with PIXI filters for true visual effects (Bloom, Glitch, Opacity adjustments, etc.). The idea here is to create a power-user tool to create your own tokens by blending multiple images/videos through normal blend modes (screen, overlay, etc), or to add simple effects like colour tints.
