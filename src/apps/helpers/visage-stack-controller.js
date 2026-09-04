import { Visage } from "../../core/visage.js";
import { VisageData } from "../../data/visage-data.js";
import { VisageComposer } from "../../core/visage-composer.js";
import { DATA_NAMESPACE } from "../../core/visage-constants.js";

/**
 * A shared controller for managing a Token's active Visage stack from any UI component.
 * Decouples stack manipulation logic from specific Application windows.
 */
export class VisageStackController {
    /**
     * Clears all overlays from a token's stack.
     * Protects the active identity, and prevents players from removing GM-hidden overlays.
     */
    static async revertGlobal(tokenId) {
        const token = canvas.tokens.get(tokenId);
        if (!token) return;

        const currentFormKey = token.document.getFlag(DATA_NAMESPACE, "identity") || "default";
        const currentStack = token.document.getFlag(DATA_NAMESPACE, "activeStack") || [];

        const layersToRemove = currentStack.filter((layer) => {
            // 1. Never remove the active Identity
            if (layer.id === currentFormKey || layer.mode === "identity") return false;

            // 2. GMs can remove all remaining overlays
            if (game.user.isGM) return true;

            // 3. Players cannot remove hidden/private overlays
            const globalSource = VisageData.getGlobal(layer.id);
            if (globalSource && !globalSource.public) return false;

            const localSource = VisageData.getLocal(token.actor).find((v) => v.id === layer.id);
            if (localSource?.playerVisibility === "hidden") return false;

            return true;
        });

        // Route removals through the core API to ensure Sequencer/TMFX teardowns fire correctly
        for (const layer of layersToRemove) {
            await Visage.remove(tokenId, layer.id);
        }
    }

    /**
     * Removes a specific layer from the stack.
     * Includes a safety wrapper for V14 Sequencer incompatibility.
     */
    static async removeLayer(tokenId, layerId) {
        try {
            await Visage.remove(tokenId, layerId);
        } catch (error) {
            console.error(`Visage | Error removing layer (External Module Failure Caught):`, error);
        }
    }

    /**
     * Toggles the disabled/hidden state of a specific layer.
     */
    static async toggleLayerVisibility(tokenId, layerId) {
        await Visage.toggleLayer(tokenId, layerId);
    }

    /**
     * Attaches Drag-and-Drop sorting listeners to a DOM list using Event Delegation.
     * @param {HTMLElement} listElement - The UL or DIV containing the draggable items.
     * @param {string} tokenId - The ID of the token being manipulated.
     * @param {Function} [onReorderComplete] - Optional callback to re-render the UI after sorting.
     */
    static bindDragDrop(listElement, tokenId, onReorderComplete = null) {
        if (!listElement) return;

        let dragSrcEl = null;

        listElement.addEventListener("dragstart", (e) => {
            const item = e.target.closest("li.stack-item");
            if (!item) return;

            dragSrcEl = item;
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/html", item.outerHTML);
            item.classList.add("dragging");
        });

        listElement.addEventListener("dragover", (e) => {
            const item = e.target.closest("li.stack-item");
            if (!item) return;
            if (e.preventDefault) e.preventDefault();
            return false;
        });

        listElement.addEventListener("dragenter", (e) => {
            const item = e.target.closest("li.stack-item");
            if (item && item !== dragSrcEl) item.classList.add("over");
        });

        listElement.addEventListener("dragleave", (e) => {
            const item = e.target.closest("li.stack-item");
            if (item) item.classList.remove("over");
        });

        listElement.addEventListener("dragend", (e) => {
            const item = e.target.closest("li.stack-item");
            if (item) item.classList.remove("dragging");
            listElement.querySelectorAll("li.stack-item").forEach((i) => i.classList.remove("over"));
        });

        listElement.addEventListener("drop", async (e) => {
            e.stopPropagation();
            const item = e.target.closest("li.stack-item");

            if (item && dragSrcEl && dragSrcEl !== item) {
                // 1. Visual Swap
                const allItems = [...listElement.querySelectorAll("li.stack-item")];
                const srcIndex = allItems.indexOf(dragSrcEl);
                const targetIndex = allItems.indexOf(item);

                if (srcIndex < targetIndex) {
                    item.after(dragSrcEl);
                } else {
                    item.before(dragSrcEl);
                }

                // 2. Calculate New Logic Order (Reversed)
                const newVisualOrder = [...listElement.querySelectorAll("li.stack-item")].map((li) => li.dataset.layerId);
                const newLogicOrder = newVisualOrder.toReversed();

                // 3. Save to Database
                await Visage.reorderStack(tokenId, newLogicOrder);

                // 4. Fire Callback
                if (onReorderComplete) onReorderComplete();
            }

            // Cleanup hover states
            listElement.querySelectorAll("li.stack-item").forEach((i) => i.classList.remove("over"));
            return false;
        });
    }
}
