# Visage

![Latest Version](https://img.shields.io/badge/Version-4.0.0-blue)
![Foundry Version](https://img.shields.io/badge/Foundry_VTT-v13_%7C_v13-orange)
![License](https://img.shields.io/badge/License-MIT-yellow)
![System Agnostic](https://img.shields.io/badge/System-Agnostic-green)
![RTL Support](https://img.shields.io/badge/RTL-Supported-green)
![Languages](https://img.shields.io/badge/Languages-24-blueviolet)
![Download Count](https://img.shields.io/github/downloads/Filroden/visage/visage.zip)
![Download Count](https://img.shields.io/github/downloads/Filroden/visage/latest/visage.zip)
![Last Commit](https://img.shields.io/github/last-commit/Filroden/visage)
![Issues](https://img.shields.io/github/issues/Filroden/visage)

## Welcome to Visage

**Visage is the ultimate non-destructive token appearance module with an optional automation engine.** It gives your tokens an "infinite wardrobe," allowing GMs and players to instantly transform characters with "Identities" and stackable "Overlays." By treating token art as a dynamic, persistent narrative tool, Visage brings your game's evolving story directly onto the canvas.

### The Brass Tacks

In mechanical terms, **Visage is a robust token property manager**. Instead of manually opening the Token Configuration window during a game to change a token's image, size, disposition, dynamic ring, or light source, you save those settings into a package called a "Visage". And with the *Sequencer* module installed, you can also add visual and audio effects to your Visages.

You can then apply, stack, and remove these property overrides instantly via a slick UI or automatically via the built-in background Watcher. Because Visage caches the token's original database values, you can layer incredibly complex combinations of visual changes and Sequencer effects, knowing you can safely revert to the base token with a single click.

### The Core Philosophy: Non-Destructive Layering

Visage works by taking a "snapshot" of your token's true base form. You can then apply Visages on top of it in two ways:

* **Identities:** Replaces the core token completely. Perfect for Wild Shape, Polymorph, disguises, illusions or alternate outfits or poses.
* **Overlays:** Stacks effects *on top* of the current token. Perfect for adding a sneak effect, status conditions, magical auras, or flying animations.

Because Visage is non-destructive, you can stack as many overlays as you want. When the spell ends or the disguise is dropped, simply click "Revert," and your token instantly returns to its original state.

### Why use Visage? (The Infinite Wardrobe)

While other modules focus on transient animations (a sword swinging or a fireball flying), Visage focuses on **persistent visual states**. If you have the token art, Visage gives you the power to automate the narrative:

* **Costumes, Disguises and Illusions:** Your Rogue doesn't just have one token. They have their standard gear, a stolen city guard uniform for infiltration, and a noble's outfit for the royal gala.
* **Poses & Stances:** A boss monster starts as a "dormant" stone statue. When combat begins, they swap to a "combat-ready" pose with weapons drawn. When their HP drops below 50%, they instantly transform into a bloodied feral form.
* **Health & Conditions:** Tokens dynamically reflect the brutality of combat. Apply battered, bruised, or bloody textures as a character takes damage, or add a sickly green hue when poisoned.
* **Lycanthropy & Shapeshifting:** Druids can seamlessly shift between animal forms, completely changing their token image and size on the canvas while keeping their character sheet intact.

### Key Features

* **🤖 The Automation Engine (New in v4):** Stop manually applying effects! Configure Visage to listen in the background and automatically apply visuals when conditions are met. Trigger Visages based on:
  * **Attributes:** e.g., Apply a bloody portrait when HP drops below 50%. Built with a  searchable Attribute Picker that works with any game system.
  * **Status Effects:** e.g., Apply a glowing forcefield when the "Mage Armour" effect is present.
  * **Game Events:** React to Scene Darkness, Global Illumination, elevation changes, Region entry/exit, Combat states or even the token being targeted.
* **🎬 Integrated Media Pipeline:** Visage seamlessly hooks into the **[Sequencer](https://foundryvtt.com/packages/sequencer)** module. Bind particle effects, looping animations, and sound effects to your Visages. When the Visage is removed, the audio and visual effects stop automatically.
* **💍 Dynamic Token Ring Support:** Fully supports Foundry's Dynamic Token Rings. Override subject textures, background colours, and toggle ring effects (Pulse, Wave, Invisibility) on the fly.
* **🌍 Global & Local Libraries:** GMs can build a "Global Library" of universal effects to use across the world. Set some of these Visages to "public" and they become visible for players to use. Players have a "Local Library" tied to their specific character sheet for their personal transformations.

### The Interface

Visage was built with User Experience in mind, offering three distinct tools:

1. **The Gallery:** The central hub for browsing, filtering, and organising Visages. GMs manage the world's "Global Library," while players manage their personal "Local Library."
2. **The Visage Editor:** A powerful workstation for to build Visages. It features a live preview stage so you can see your token's appearance and effects before you ever save or apply them.
3. **The Selector HUD:** A transient, slick quick-menu that appears next to a token on the canvas. It allows players to quickly swap their active Visages, toggle visibility, and reorder their active stack via drag-and-drop.

---

## Documentation & How-To Guides

Visage is a powerful tool with a lot of depth. For full tutorials, macro API documentation, and setup guides, **[please visit the Visage Wiki](https://github.com/Filroden/visage/wiki)**.

## Recommended Modules

To get the absolute most out of Visage, I highly recommend installing the following modules:

* **[Sequencer](https://foundryvtt.com/packages/sequencer)**: Required if you wish to attach visual or audio effects to a Visage.
* **[JB2A - Jules & Ben's Animated Assets](https://foundryvtt.com/packages/JB2A_DnD5e)**: Provides a massive library of visual assets pre-registered into the Sequencer Database.
* **[PSFX - Peri's Sound Effects](https://foundryvtt.com/packages/psfx)**: The audio equivalent to JB2A. Amazing sound effects perfectly formatted for VTT use.
* **[FA Nexus](https://foundryvtt.com/packages/fa-nexus)**: An in-game asset browser for Forgotten Adventures' extensive top-down token library.

## Licence

Software and associated documentation files in this repository are covered by an [MIT License](LICENSE.md).
