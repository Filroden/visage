/**
 * VISAGE DRAG & DROP MANAGER
 * -------------------------------------------------------------------
 * Lets the user reorder effect rows in the Visage Editor's Layers list by dragging them.
 *
 * ARCHITECTURAL OVERVIEW:
 * A row can only be dropped onto another row in the same group (Above token, Below token, Audio
 * or Not shown in preview). Whether a visual effect sits above or below the token is set with
 * its Layer setting instead, so dragging never changes what an effect is, only its order.
 *
 * All listeners are delegated from the application's root element and bound once. The root
 * element persists across re-renders while the rows themselves are replaced, so listeners bound
 * to the rows would be lost on the first re-render.
 *
 * The dragged row's id travels in a module-specific data type rather than "text/plain", so the
 * editor's drop handler for Foundry documents (macros dragged from the sidebar) ignores it.
 */

/** Data type carrying the dragged row's effect id. */
const DRAG_DATA_TYPE = "application/x-visage-layer";

/** Selector for a draggable effect row. */
const ROW_SELECTOR = '.visage-layer[draggable="true"]';

export class VisageDragDropManager {
    /**
     * @param {VisageEditor} editor - The editor that owns the effect list.
     */
    constructor(editor) {
        this.editor = editor;
        /** @type {HTMLElement|null} The row being dragged. */
        this.dragSource = null;
    }

    /**
     * Binds the delegated drag listeners. Call once per application.
     *
     * @param {HTMLElement} root - The application's root element.
     */
    bind(root) {
        root.addEventListener("dragstart", (event) => this._onDragStart(event));
        root.addEventListener("dragend", () => this._clearDragState(root));
        root.addEventListener("dragover", (event) => this._onDragOver(event, root));
        root.addEventListener("drop", (event) => this._onDrop(event, root));
    }

    /** Starts dragging an effect row. */
    _onDragStart(event) {
        const row = event.target.closest?.(ROW_SELECTOR);
        if (!row) return;

        this.dragSource = row;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(DRAG_DATA_TYPE, row.dataset.id);
        row.classList.add("dragging");
    }

    /** Marks the row under the pointer as a valid drop target when it is in the same group. */
    _onDragOver(event, root) {
        const target = this._getValidTarget(event);
        root.querySelectorAll(".drag-over").forEach((el) => el !== target && el.classList.remove("drag-over"));
        if (!target) return;

        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        target.classList.add("drag-over");
    }

    /** Moves the dragged effect in front of the row it was dropped on. */
    async _onDrop(event, root) {
        const target = this._getValidTarget(event);
        if (!target) return;

        event.preventDefault();
        event.stopPropagation();

        const draggedId = event.dataTransfer.getData(DRAG_DATA_TYPE);
        this._clearDragState(root);
        if (!this._moveEffect(draggedId, target.dataset.id)) return;

        this.editor._markDirty();
        await this.editor.render();
    }

    /**
     * The row under the pointer, if the current drag may be dropped on it: another effect row in
     * the same group as the dragged row.
     */
    _getValidTarget(event) {
        if (!this.dragSource) return null;

        const target = event.target.closest?.(ROW_SELECTOR);
        if (!target || target === this.dragSource) return null;
        return target.dataset.group === this.dragSource.dataset.group ? target : null;
    }

    /**
     * Moves an effect in front of another in the editor's effect array. The groups in the list
     * are filtered views of that one array, so this changes the order within the group.
     *
     * @returns {boolean} True if the array changed.
     */
    _moveEffect(draggedId, targetId) {
        const effects = this.editor._effects;
        const fromIndex = effects.findIndex((e) => e.id === draggedId);
        if (fromIndex === -1 || draggedId === targetId) return false;

        const [dragged] = effects.splice(fromIndex, 1);
        const targetIndex = effects.findIndex((e) => e.id === targetId);
        effects.splice(targetIndex === -1 ? effects.length : targetIndex, 0, dragged);
        return true;
    }

    /** Clears the drag source and every drag highlight. */
    _clearDragState(root) {
        this.dragSource?.classList.remove("dragging");
        this.dragSource = null;
        root.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    }
}
