# Visage

![Latest Version](https://img.shields.io/badge/Version-1.6.1-blue)
![Foundry Version](https://img.shields.io/badge/Foundry_VTT-v13_%7C_v13-orange)
![License](https://img.shields.io/badge/License-MIT-yellow)
![RTL Support](https://img.shields.io/badge/RTL-Supported-green)
![Languages](https://img.shields.io/badge/Languages-24-blueviolet)
![Download Count](https://img.shields.io/github/downloads/Filroden/visage/visage.zip)
![Download Count](https://img.shields.io/github/downloads/Filroden/visage/latest/visage.zip)
![Last Commit](https://img.shields.io/github/last-commit/Filroden/visage)
![Issues](https://img.shields.io/github/issues/Filroden/visage)

**Visage** allows players and GMs to instantly switch a token's appearance, disposition, Dynamic Token Ring configuration and size/image scale on the fly.

Owners can configure and **store multiple alternate forms** (Visages) for any Actor — which are saved persistently and available to all its linked tokens across all scenes.

<div style="display: flex; justify-content: center; align-items: flex-start; gap: 20px;"><div style="text-align: center;"><img src="images/selector_hud_cropped.png" alt="Visage Selector HUD" style="margin-inline-start: 3rem; width: 150px; max-height: 100%; object-fit: contain;"></div><div style="text-align: center;"><img src="images/animated_tokens.gif" alt="Visage Selector HUD showing animated tokens" style="margin-inline-start: 3rem; width: 150px; max-height: 100%;object-fit: contain;"></div></div>

Using a custom, grid-based **Token HUD Selector**, you can switch the token's image and name, adjust its visual scale (e.g., 150% for enlarge), flip its orientation, apply a disposition ('Friendly', 'Neutral', 'Hostile', or 'Secret' state) and completely reconfigure its Dynamic Token Ring settings (colours, effects, subject texture). You can also change a token's actual dimensions (width and height).

The module supports:

* **all image or video formats** that are valid for tokens.
* **supports wildcard filepaths** (e.g., path/to/wolves/*.webp), letting you select a random image from a folder every time the **Visage** is activated.

This module makes it ideal for dynamic gameplay without requiring time-consuming manual edits in the core Token Configuration window every change.

This is the perfect module for visually resolving common game mechanics across any system. Use **Visage** for quick application of **illusions** and **disguises** that change the token's appearance and name to fool opponents. Simplify **shapeshifting** abilities by visually swapping to another image with one click. It is also an excellent tool for showing visual effects, such as changing scale to represent the token getting smaller or larger.

**Visage** increases immersion and table speed by placing powerful visual controls directly within the Token HUD, providing **one-click access to all your stored alternative forms**.

[Version History](VERSION.md)

## Localisation & Accessibility

**Visage** is designed to be accessible:

* **Responsive UI**: The interface is fully responsive to changes in the base font size and scales naturally for users requiring larger text.
* **Native RTL Support**: Includes full **Right-to-Left (RTL)** support. If your Foundry client is set to an RTL language (e.g., Arabic, Hebrew), the Visage UI (Selector HUD, Configuration Window, and Dynamic Ring Editor) automatically mirrors its layout to ensure a natural reading experience.

<div style="display: flex; justify-content: center; align-items: flex-start; gap: 20px;"><div style="text-align: center;"><img src="images/visage_configuration_ar.png" alt="Visage Configuration Window showing RTL support for Arabic" style="max-height: 100%; width: 250px; object-fit: contain;"></div><div style="text-align: center;"><img src="images/visage_configuration_he.png" alt="Visage Configuration Window showing RTL support for Hebrew" style="max-height: 100%; width: 250px; object-fit: contain;"></div></div>

* **Languages**: Currently supports Arabic, Catalan, Chinese (Simplified and Traditional), Czech, Dutch, English (UK and US), Finnish, French, German, Hebrew, Hungarian, Italian, Japanese, Korean, Persian, Polish, Portuguese (Brazil and Portugal), Romanian, Russian, Spanish (Latin America and Spain), Swedish, Turkish, Ukrainian and Welsh.

## Licence

Software and associated documentation files in this repository are covered by an [MIT License](LICENSE.md).

## Roadmap

[Short term]

* 

[Long term]

* Add the ability to create and use a global directory of visages, so certain effects can be applied quickly to any token (e.g., enlarge/reduce effects).
* Test module against FoundryVTT v14.
