# Visage

![Latest Version](https://img.shields.io/badge/Version-3.2.0-blue)
![Foundry Version](https://img.shields.io/badge/Foundry_VTT-v13_%7C_v13-orange)
![License](https://img.shields.io/badge/License-MIT-yellow)
![System Agnostic](https://img.shields.io/badge/System-Agnostic-green)
![RTL Support](https://img.shields.io/badge/RTL-Supported-green)
![Languages](https://img.shields.io/badge/Languages-24-blueviolet)
![Download Count](https://img.shields.io/github/downloads/Filroden/visage/visage.zip)
![Download Count](https://img.shields.io/github/downloads/Filroden/visage/latest/visage.zip)
![Last Commit](https://img.shields.io/github/last-commit/Filroden/visage)
![Issues](https://img.shields.io/github/issues/Filroden/visage)

**Visage** is the ultimate token appearance and visual effects manager for Foundry VTT. It allows players and GMs to instantly switch token art, layer visual effects, play attached sounds, and manage complex stacks of graphical overrides through a dedicated, unified HUD.

**Why use Visage?** It solves the problem of rigid token settings. Instead of manually editing a token every time a character polymorphs, casts Invisibility, or gets Enlarged, you simply click a button. Visage creates a non-destructive "stack" of changes on top of your token—allowing you to layer a disguise over a wild shape, add a rage status effect on top of that, and then peel them away one by one to reveal the original character perfectly intact underneath. It turns complex, time-consuming administrative tasks into instant, immersive gameplay moments.

## Quick Start

1. **Open the HUD:** Right-click your token on the canvas to open the Token HUD, then click the **Visage Icon** (Domino Mask) to open the Selector HUD.
2. **Create a new Identity:** Click the **Cog** (Configure) icon to open the Local Library. Click **Create New Local Layer**.
3. **Configure:** In the Editor's header, give it a Label (e.g., "Wolf Form"), select the mode (Identity) and, on the Appearance tab, click the checkbox next to image and use the filepicker to find a good image of a wolf. Make any other changes you want. Then click "Save Local Layer".
4. **Apply:** Click the **Play** button on the card. Your token is now a Wolf! From now on, you can quickly choose which Visage to apply from the Selector HUD.

![Applying Visages (Identities and Overlays)](images/v3/apply_visages.gif?raw=true)

## What's New in v3.0?

1. **Identities vs. Overlays:** Gone are the restrictions of the past. Every entry in Visage, whether it's stored locally on an Actor or globally in the World, can now be defined as one of two Modes:

   * **Visage Identity (Who you are):** Replaces the token's base image and/or the actor's portrait. Use this for shapeshifting, disguises, or character portraits. Only one **Identity** can be active at a time.
   * **Visage Overlay (What is happening to you):** Adds a layer *on top* of the token without removing the base image. Use this for conditions (Burning, Frozen), spell effects (Spirit Guardians), or environmental markers. You can stack unlimited **Overlays**.

2. **The Effects Engine (Sequencer Integration):** Visage now integrates with the **Sequencer** module.

   * **Light Source:** Configure the standard Foundry Light Source for the token.
   * **Visual Effects:** Attach animated spell effects (like JB2A), particle systems, or looping videos to any Identity or Overlay. These effects automatically play when the Visage is applied and stop when removed.
   * **Audio Effects:** Attach sound files to an entry (like PSFX). Create a "Rage" overlay that plays a roar when applied, or a "Stealth" identity that emits a soft looping hum.
   * **Smart Stacking:** Visual effects can be layered above or below the token, with full control over scale, opacity, rotation, and blend modes.
   * **New in v3.1:** Audio and visual effects can be sorted (dragged and dropped), and played once when the Visage is applied or on a repeating loop.

3. **Unified Libraries:** You can now create **Local Overlays** (e.g., a specific player's unique "Hunter's Mark") or **Global Identities** (e.g., a world-wide "Invisibility" placeholder). The Selector HUD and the Local and Global Libraries are now smartly organised into "Identities" and "Overlays" sections, making it instant to find what you need.

---

## Core Concepts

### Identities vs. Overlays

**Visage Identity (Who you are):** Replaces the token's base image. Use this for shapeshifting, disguises, or character portraits. Only one **Identity** can be active at a time.\
**Visage Overlay (What is happening to you):** Adds a layer *on top* of the token without removing the base image. Use this for changing dispositions, conditions (Burning, Frozen), spell effects (Spirit Guardians), or environmental markers. You can stack as many **Overlays** as you want.

|Feature|Identity (Base Form)| Overlay (Visual Effect)|
|:---|:---|:---|
|Behaviour|Swaps the base token|Stacks on top of the token|
|Stacking|Exclusive (1 at a time)|Cumulative (Unlimited)|
|Use Cases|Wild Shape, Disguise, Polymorph|Invisibility, Fire, Fly, Conditions|
|Sequencer|Supported|Supported|

### Global vs. Local

🔵 **Global Visages** are stored in the World and are for the GM. Global Visages are themed blue.\
🟡 **Local Visages** are stored on the token's actor and are for players. Local Visages are themed gold.

---

## Key Features

### 1. The Selector HUD

Access the token's entire Visage library directly from the Token HUD to quickly apply any Visages (Identities or Overlays). Manage any existing Overlays on that token. No more having to edit the token's settings every time you want to make a change.

* **Grid Layout:** Quickly browse all available Visages.
* **Active Stack:** See exactly what Overlays are active on the token.
* **Quick Revert:** Revert the Identity to your token's default or remove Overlays with one click.

  ![Visage Selector HUD](images/v3/visage_selector_hud_identities.png?raw=true)

### 2. The Global (for GMs) and Local (for players) Libraries

Manage your visual assets in a beautiful, card-based interface with a detailed search where you can filter by tags, categories, or name to find the right look instantly.

* **Visage Local Gallery (for players):** Accessed from the HUD, from an actor's sheet header or by right-clicking an actor in the sidebar. Manage Visages specific to that token/actor.

  ![Visage Local Library](images/v3/visage_local_library.png?raw=true)

* **Visage Global Library (for GMs):** Accessed via Scene Controls. Create Identities and Overlays usable by the GM on any token. Apply them to one or more selected tokens, or even **drag and drop** them onto tokens, to take immediate effect.

  ![Visage Global Library](images/v3/visage_global_library.png?raw=true)

Available actions (some only available when you are in the Global or Local Library):

* **Apply**: Apply the selected Mask or Visage to the token(s).
* **Edit**: Edit the Mask or Visage using the Editor.

And within the popup menu:

* **Apply as [Identity/Overlay]:** Apply the Visage as an Identity (if it is setup as an Overlay) and as an Overlay (if setup as an Identity).
* **Duplicate**: Create a copy of an existing Visage.
* **Commit to Default (New in v2.1)**: Found a permanent new look? You can now swap a Visage to become the token's new "Default" state directly from the Gallery. Visage automatically creates a backup of the previous default appearance, so you never lose your history.
* **Promote to Global Library**: As a GM, do you like a particular look one of your players has made and want to use it on other tokens? Simply "Promote" (copy) it to the Global Library.
* **Copy to Local Library of selected token(s)**: As a GM, you can also do the reverse, and transfer a Global Visage to the selected token(s)'s Local Library, giving that player the freedom to use it from their Selector HUD.
* **Export/Import Visages**: Export your entire Library so it can be transferred to another world or export them individually. Save one or all the Visages from one token so they can be added to others. Importing will prevent duplication of existing Visages if they share the same unique ID. When importing Visages created in earlier versions of the module, it will intelligently make any changes needed to the data to bring it up to date.
* **Make Default:** Want to permanently change the look of the token? Make the selected Visage the default settings for the token (a copy of the current default settings will be added as a new Visage).
* **Delete**: Soft delete (send to Recycle Bin).

  ![Visage popup menu](images/v3/visage_card_more_actions.png?raw=true)

### 3. The Visual Editor

An editor that lets you build and **preview** your token's appearance before saving it.

![Visage Local Editor](images/v3/visage_local_editor.png?raw=true)

Key Features:

* **Light Source (new in v3.2):** Configure the standard Foundry Light Source for the token. This is added to the Effects tab, but is treated as part of the Visage's appearance. Toggle it on and click it to edit its properties.
* **Visual and Audio Effects**: Add and configure visual or audio effects to Identities and Overlays, using direct filepaths or Sequencer Database Keys. Effects can be place below or above the token. You can configure a delay between applying a Visage's appearance (image, scale, dynamic ring, light source, etc) and any visual and audio effects, and vice versa.
* **Video Support:** Use `.webm` or `.mp4` files for animated transformations.
* **Wildcard Support:** Point a Visage to a folder (e.g., `creatures/wolves/*`) or include wildcards (`*` or `?`) within the filename. Every time you apply it, a random image that matches is chosen.

### 4. The Token Previewer: Live Visualisation

* **Thumbnails in the Selector HUD and Libraries** provide a quick approximation of your Visages, including Dynamic Ring effects and subject textures. Since these cards cannot display changes to scale or dimensions, they include "Chips" and "Badges" to list the specific data changes.
* **The Editor Stage:** The Editor features a fully rendered Live Stage that also accurately displays scale, dimensions, and active effects. You can pan and zoom the viewport, and enable a grid overlay to visualise the token's exact footprint on the canvas.

---

## Ideas for how to use the module

* **Polymorph, Wild Shapes and Illusions:** One click to turn a PC into a T-Rex, a tabby cat or even a table. One click to turn them back.
* **Costumes and Poses:** Create Visages to show your character in normal clothes, in their Sunday best, or fully armoured and ready to face adversity. Show the character in a neutral pose or with weapons drawn.
* **Disguise Self:** Create a "Guard Disguise" Visage. The nameplate changes to "Town Guard" and the image swaps, fooling players or NPCs.
* **Spell Effects:** Effects like Enlarge and Shrink can easily be applied.
* **Status Indicators:** Create a Mask that only changes the Dynamic Ring colour (e.g., Purple for "Charmed", Red for "Bloodied"). Apply it to any token to visually flag their status without changing their avatar.
* **Narrative Reveals:** Change an NPC's disposition as players interact with them, developing long term relationships or creating new enemies. Or use it as a way to hide the true intent of that BBEG masquerading as the town mayor.

---

## Additional Features

* **Non-Destructive Stacking:** Visage never overwrites your original token data. It builds a "Stack" of effects on top of a base state. One click reverts everything to the original Token configuration.
* **Dynamic Token Ring Support:** Full support for Foundry V12+ Dynamic Rings. Switch ring colors and effects instantly when changing Visages.
* **Responsive UI:** The interface is fully responsive to changes in the base font size and scales naturally for users requiring larger text.
* **Native RTL Support:** Includes full **Right-to-Left (RTL)** support for languages like Arabic and Hebrew.
* **Ghost Edit Protection:** Visage detects if you try to edit a token while effects are active and warns you, preventing accidental data loss.
* **Languages:** Currently supports Arabic, Catalan, Chinese (Simplified and Traditional), Czech, Dutch, English (UK and US), Finnish, French, German, Hebrew, Hungarian, Italian, Japanese, Korean, Persian, Polish, Portuguese (Brazil and Portugal), Romanian, Russian, Spanish (Latin America and Spain), Swedish, Turkish, Ukrainian and Welsh.

## Dependencies

* **[Sequencer](https://foundryvtt.com/packages/sequencer)** (Recommended): Required to use Visual and Audio effects. Visage works without it, but the Effects tab will be disabled.

## Version History

[Version History](VERSION.md)

## Licence

Software and associated documentation files in this repository are covered by an [MIT License](LICENSE.md).

## Roadmap

### Short term

* **Improved APIs:** Improve ability to find and apply Visages
* **Selector HUD and Gallery UI improvements:** Try to simplify the tiles in the Selector HUD so it is still easy to see what settings are applied but reduce the clutter of badges/chips around the border. Also add some differentiation between Identities and Overlays in both Selector HUD and Libraries.
* **Re-order Overlay Stacks:** Allow the Overlay stack to be re-ordered in the Selector HUD.
* **Pre-made Overlays:** Add a small library of pre-made Overlays that can be imported or enabled by the GM via Game Settings.
* **Add Public/Private flags to global Visages:** GMs can tag their globally stored Visages (both Identities and Overlays) as either Public or Private. Players can see public Visages inside their token's Selector HUD and apply them to their own tokens.

### Long term (no promises!)

* **Triggers:** Automated application of Visages based on triggers (in combat/out of combat, etc). Likely to be limited to remain system agnostic, but improvements to the API should make other automations easier via macros.
