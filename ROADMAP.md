# Other items

1. CSS Refactor

   * **Context:** `visage.css` has accumulated duplicate styles between the different UIs (Selector HUD, Token Configuration Window, Global Visage Directory, Global Visage Editor).
   * **Task:** Extract shared components (Cards, Chips, Grids) into reusable classes to clean up the codebase. These then need to be applied back to any hbs templates if class names change.

2. Global Editor Preview

   * **Task:** Add a live visual preview panel to the Global Visage Editor window so users can see changes in real-time before saving. For appearance, use the same effective display of the visage as used in the directory card,

3. UX Improvements (Tags & Categories)

   * **Task:** Implement a "Soft Select" (Dropdown/Combobox) for Categories to prevent duplicates. Implement "Pills" for tags in the directory search and editor.
