# Feature Specification: Unified Card Architecture (v3.0)

**Status:** Deferred (Target: v3.0)
**Goal:** Eliminate UI logic duplication and styling inconsistencies by implementing a single, adaptive "Smart Card" component across the HUD, Gallery, and Editor.

## 1. The Problem

Currently, the **Visage Selector** (HUD) and **Visage Gallery** (Library) use entirely separate templates and CSS logic to display the same data.

* **Duplication:** Any change to how a "Hostile" token looks must be coded twice (once for the tile, once for the row).
* **Logic Leakage:** The Data Model (`VisageData`) contains view logic (formatting strings, HTML classes), breaking MVC principles.
* **Inconsistency:** Ring effects and video previews behave slightly differently between the two views.

## 2. The Solution: "One Card, Two Modes"

We will implement a **Presentation Layer** that feeds a single Handlebars partial (`visage-card.hbs`). This card adapts its layout via CSS classes rather than different HTML structures.

### A. The Architecture

1. **The Presenter (`VisagePresenter.js`):**
    * Extracts `toPresentation()` out of `VisageData`.
    * Handles all async path resolution (`Promise.all`).
    * Calculates UI semiotics (which icon to use for flip, which border color for disposition).
    * **Benefit:** The Data layer becomes pure storage; the View layer becomes pure rendering.

2. **The Template (`visage-card.hbs`):**
    * Replaces both `visage-preview.hbs` and the inline HUD tiles.
    * Contains the "High-Fidelity" center zone (Video + Dynamic Rings + Transformations).
    * Contains conditional slots for Metadata and Actions.

### B. The Modes

The card renders differently based on a parent CSS class:

| Feature | Gallery Mode (`.mode-gallery`) | HUD Mode (`.mode-hud`) |
| --- | --- | --- |
| **Layout** | **Horizontal Row** (Photo Library style). | **Square Tile** (Compact grid). |
| **Metadata** | **Static Column** on the left. Always visible. | **Hidden Drawer** on the left. |
| **Interaction** | **Action Buttons** (Edit/Delete) on the right. | **Click-to-Apply**. |
| **Details** | Full tags visible in footer/column. | **"Peep-Hole" UX**: Hovering a specific "Info Hotspot" slides out the metadata drawer over the image. |

## 3. Implementation Requirements

### Phase 1: The Presenter

* Create `src/visage-presenter.js`.
* Ensure `prepare(data)` returns a standardized context object (`preview.slots`, `preview.meta`, etc.).
* Update `VisageSelector`, `VisageGallery`, and `VisageEditor` to await this presenter before rendering.

### Phase 2: The Unified Partial

* Create `templates/parts/visage-card.hbs`.
* **Critical Requirement:** It must faithfully reproduce the **Visage Ring** rendering (Pulse, Wave, Gradient) and **Video** styling logic currently found in `visage-preview.hbs`.
* **Critical Requirement:** It must support the "Invisibility" effect (applying opacity/blur to the image zone).

### Phase 3: The CSS Engine

* **Deprecation:** Comment out/remove legacy `.visage-tile` and `.visage-chip` styles.
* **Badges:** Implement standardized badges (Scale, Flip) that overlay the image in both modes.
* **Footer Slider:** Ensure the footer animation (Slide Up to reveal Tags) works smoothly in both modes or is disable for the Gallery if preferred.

## 4. Known Pitfalls (Lessons from v2.0 Attempt)

* **Async Complexity:** The Presenter is async (due to wildcard/video resolution). The Apps must change their `_prepareContext` to use `await Promise.all(items.map(...))` or the UI will render empty.
* **CSS Specificity:** The "Footer Slider" relies on precise height and overflow calculations. Changing padding in the container breaks the slide-up effect.
* **Ring Layering:** The Z-Index of the Ring Preview vs. the Image vs. the "Info Hotspot" is fragile. The Hotspot must be on top (`z-index: 20+`) to be clickable.
