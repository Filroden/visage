# Visage

![Latest Version](https://img.shields.io/badge/Version-3.0.0-blue)
![Foundry Version](https://img.shields.io/badge/Foundry_VTT-v13_%7C_v13-orange)
![License](https://img.shields.io/badge/License-MIT-yellow)
![RTL Support](https://img.shields.io/badge/RTL-Supported-green)
![Languages](https://img.shields.io/badge/Languages-24-blueviolet)
![Download Count](https://img.shields.io/github/downloads/Filroden/visage/visage.zip)
![Download Count](https://img.shields.io/github/downloads/Filroden/visage/latest/visage.zip)
![Last Commit](https://img.shields.io/github/last-commit/Filroden/visage)
![Issues](https://img.shields.io/github/issues/Filroden/visage)

**Visage** is the ultimate token appearance and visual effects manager for Foundry VTT. It allows players and GMs to instantly switch token art, layer visual effects, play attached sounds, and manage complex stacks of graphical overrides through a dedicated, unified HUD.

## What's New in v3.0?

Visage v3.0 introduces a **Unified Data Model** and a powerful **Effects Engine**.

### 1. Identities vs. Overlays

Gone are the restrictions of the past. Every entry in Visage, whether it's stored locally on an Actor or globally in the World, can now be defined as one of two Modes:

* **Visage Identity (Who you are):** Replaces the token's base image. Use this for shapeshifting, disguises, or character portraits. Only one **Identity** can be active at a time.
* **Visage Overlay (What is happening to you):** Adds a layer *on top* of the token without removing the base image. Use this for conditions (Burning, Frozen), spell effects (Spirit Guardians), or environmental markers. You can stack unlimited **Overlays**.

### 2. The Effects Engine (Sequencer Integration)

Visage now integrates with the **Sequencer** module.

* **Visual Effects:** Attach animated spell effects (like JB2A), particle systems, or looping videos to any Identity or Overlay. These effects automatically play when the Visage is applied and stop when removed.
* **Audio Effects:** Attach sound files to an entry (like PSFX). Create a "Rage" overlay that plays a roar when applied, or a "Stealth" identity that emits a soft looping hum.
* **Smart Stacking:** Visual effects can be layered above or below the token, with full control over scale, opacity, rotation, and blend modes.

### 3. Unified Libraries

* **Local & Global Flexibility:** You can now create **Local Overlays** (e.g., a specific player's unique "Hunter's Mark") or **Global Identities** (e.g., a world-wide "Invisibility" placeholder).
* **Smart Organisation of Visages:** The Selector HUD and the Local and Global Libraries are now smartly organised into "Identities" and "Overlays" sections, making it instant to find what you need.

---

## Key Features

* **Non-Destructive Stacking:** Visage never overwrites your original token data. It builds a "Stack" of effects on top of a base state. One click reverts everything to the original Token configuration.
* **Dynamic Token Ring Support:** Full support for Foundry V12+ Dynamic Rings. Switch ring colors and effects instantly when changing Visages.
* **Intelligent UI:** The interface adapts to the content. "Smart Buttons" tell you if an item will swap your face or add a layer.
* **Native RTL Support:** Includes full **Right-to-Left (RTL)** support for languages like Arabic and Hebrew.
* **Ghost Edit Protection:** Visage detects if you try to edit a token while effects are active and warns you, preventing accidental data loss.

## Dependencies

* **[Sequencer](https://foundryvtt.com/packages/sequencer)** (Recommended): Required to use Visual and Audio effects. Visage works without it, but the Effects tab will be disabled.

## Version History

[Version History](VERSION.md)

## Licence

Software and associated documentation files in this repository are covered by an [MIT License](LICENSE.md).

## Roadmap

### Short term

* **Add Public/Private flags to global Visages:** GMs can tag their globally stored Visages (both Identities and Overlays) as either Public or Private. Players can see public Visages inside their token's Selector HUD and apply them to their own tokens.
* **Light sources:** Allow the token's light source to be configured within Visages (identities and overlays).

### Long term (no promises!)

* **Visual FX Layers/token image builder:** Integration with PIXI filters for true visual effects (Bloom, Glitch, Opacity adjustments, etc.). The idea here is to create a power-user tool to create your own tokens by blending multiple images/videos through normal blend modes (screen, overlay, etc), or to add simple effects like colour tints.
