/**
 * VISAGE DRAG & DROP MANAGER
 * -------------------------------------------------------------------
 * A dedicated controller for handling HTML5 drag-and-drop interactions
 * within the Visage Editor interface.
 * * ARCHITECTURAL OVERVIEW:
 * This class manages the complex event bindings required to reorder
 * the Effect Stack (Visual and Audio layers). It intercepts drag events,
 * updates the UI to reflect valid drop zones, and computes the resulting
 * array mutations and z-order changes when a drop occurs.
 * * Note: This class holds a reference to the parent `VisageEditor` instance
 * to trigger state updates and re-renders when the underlying data mutates.
 */

/**
 * Handles HTML5 drag-and-drop interactions for the Effect Stack.
 */
export class VisageDragDropManager {
    constructor(editor) {
        this.editor = editor;
        this.dragSource = null;
    }

    /**
     * Binds HTML5 drag-and-drop listeners to Effect Cards and Groups.
     * @param {HTMLElement} html - The rendered application root.
     */
    bind(html) {
        // 1. Bind Cards (Draggables)
        const cards = html.querySelectorAll(".effect-card");
        cards.forEach((card) => {
            if (
                card.classList.contains("pinned-light") ||
                card.dataset.action === "editRing"
            )
                return;

            card.addEventListener("dragstart", (ev) => {
                this.dragSource = card;
                ev.dataTransfer.effectAllowed = "move";
                ev.dataTransfer.setData("text/plain", card.dataset.id);
                ev.dataTransfer.setData("type", card.dataset.type);
                card.classList.add("dragging");
            });

            card.addEventListener("dragend", () => {
                card.classList.remove("dragging");
                this.dragSource = null;
                html.querySelectorAll(".drag-over, .group-drag-over").forEach(
                    (el) => {
                        el.classList.remove("drag-over", "group-drag-over");
                    },
                );
            });

            card.addEventListener("dragenter", (ev) => ev.preventDefault());
            card.addEventListener("dragover", (ev) => {
                ev.preventDefault();
                const sourceType = this.dragSource?.dataset.type;
                if (sourceType === "visual" && card.dataset.type === "visual")
                    card.classList.add("drag-over");
            });

            card.addEventListener("dragleave", () =>
                card.classList.remove("drag-over"),
            );
            card.addEventListener("drop", (ev) =>
                this._onDrop(
                    ev,
                    card.closest(".effect-group").dataset.group,
                    card.dataset.id,
                ),
            );
        });

        // 2. Bind Groups (Drop Zones for appending)
        const groups = html.querySelectorAll(".effect-group");
        groups.forEach((group) => {
            if (
                group.dataset.group === "light" ||
                group.dataset.group === "ring"
            )
                return;

            group.addEventListener("dragenter", (ev) => ev.preventDefault());
            group.addEventListener("dragover", (ev) => {
                ev.preventDefault();
                const sourceType = this.dragSource?.dataset.type;
                const targetGroup = group.dataset.group;
                if (sourceType === "audio" && targetGroup !== "audio") return;
                if (sourceType === "visual" && targetGroup === "audio") return;
                group.classList.add("group-drag-over");
            });

            group.addEventListener("dragleave", () =>
                group.classList.remove("group-drag-over"),
            );
            group.addEventListener("drop", (ev) =>
                this._onDrop(ev, group.dataset.group, null),
            );
        });
    }

    /**
     * Handles the logic when a drag-and-drop action completes, updating z-orders.
     */
    async _onDrop(ev, targetGroup, targetId) {
        ev.preventDefault();
        ev.stopPropagation();

        const draggedId = ev.dataTransfer.getData("text/plain");
        if (!draggedId || draggedId === targetId) return;

        const effects = this.editor._effects;
        const draggedIndex = effects.findIndex((e) => e.id === draggedId);
        if (draggedIndex === -1) return;

        const draggedEffect = effects[draggedIndex];

        // Update Z-Order if moved
        if (targetGroup === "above" && draggedEffect.type === "visual")
            draggedEffect.zOrder = "above";
        else if (targetGroup === "below" && draggedEffect.type === "visual")
            draggedEffect.zOrder = "below";
        else if (targetGroup === "audio" && draggedEffect.type !== "audio")
            return;

        // Reorder Array
        effects.splice(draggedIndex, 1);
        if (targetId) {
            const targetIndex = effects.findIndex((e) => e.id === targetId);
            effects.splice(targetIndex, 0, draggedEffect);
        } else {
            let insertIndex = effects.length;
            if (targetGroup === "above" || targetGroup === "below") {
                const lastIdx = effects.findLastIndex(
                    (e) => e.type === "visual" && e.zOrder === targetGroup,
                );
                if (lastIdx !== -1) insertIndex = lastIdx + 1;
            } else if (targetGroup === "audio") {
                const lastIdx = effects.findLastIndex(
                    (e) => e.type === "audio",
                );
                if (lastIdx !== -1) insertIndex = lastIdx + 1;
            }
            effects.splice(insertIndex, 0, draggedEffect);
        }

        this.editor._markDirty();
        this.editor._updatePreview();
        await this.editor.render();
    }
}
