# Automated Test Macro

## Test World

```javascript
/**
 * VISAGE CORE ENGINE TEST SUITE
 * Tailored for the specific Global Visages in the test environment.
 * Select a token and run this macro to verify API integrity and Composer math.
 */
(async () => {
    const api = game.modules.get("visage")?.api;
    const token = canvas.tokens.controlled[0];
    
    if (!api) return ui.notifications.error("Visage | Visage API not found!");
    if (!token) return ui.notifications.warn("Visage | Please select a test token.");

    console.group(`Visage | 🧪 V4 Test Suite Running on: ${token.name}`);
    let passed = 0; let failed = 0;

    // Helper: Run a test, wait for the canvas/delays, and assert the outcome
    const assert = async (name, action, condition, waitTime = 250) => {
        try {
            await action();
            // Wait for standard Foundry updates, Sequencer, or Visage delays to fire
            await new Promise(resolve => setTimeout(resolve, waitTime)); 
            if (condition()) {
                console.log(`Visage | ✅ PASS: ${name}`);
                passed++;
            } else {
                console.error(`Visage | ❌ FAIL: ${name}`);
                failed++;
            }
        } catch (e) {
            console.error(`Visage | 💥 ERROR: ${name}`, e);
            failed++;
        }
    };

    // --- KNOWN VISAGE IDs ---
    const ID_TORCH = "94WkCyfQ3fU1suxM";        // Light Source
    const ID_SCALE = "a31OhexaBMLs6kNR";        // Scale 150%
    const ID_FLIP  = "S6CUmwndlZEfiiei";        // Vertical Flip
    const ID_GATOR = "C0caM7ra7NgK5Xmh";        // Polymorph (Width 2, Delay 500ms)

    // --- PREPARATION ---
    await api.revert(token.id);
    const baseLight = token.document.light.dim;

    // --- TEST 1: Nested Object Injection (Lighting) ---
    await assert("API: Apply Torch Overlay",
        async () => await api.apply(token.id, ID_TORCH),
        () => token.document.light.dim === 40 && api.isActive(token.id, ID_TORCH)
    );

    // --- TEST 2: Atomic Math (Scale) ---
    await assert("Composer: Apply 150% Scale",
        async () => await api.apply(token.id, ID_SCALE),
        () => Math.abs(token.document.texture.scaleX) === 1.5
    );

    // --- TEST 3: Atomic Math (Mirror Y) ---
    await assert("Composer: Apply Vertical Flip (Preserving Scale)",
        async () => await api.apply(token.id, ID_FLIP),
        // The scaleY should be -1.5 (Flipped AND Scaled)
        () => token.document.texture.scaleY === -1.5 
    );

    // --- TEST 4: Delayed Transitions & Dimensions ---
    await assert("Composer: Apply Delayed Polymorph (Alligator)",
        async () => await api.apply(token.id, ID_GATOR),
        () => token.document.width === 2 && token.document.texture.src.includes("Alligator"),
        650 // Wait 650ms to allow the 500ms delay to execute safely
    );

    // --- TEST 5: Targeted Removal (Stack Recalculation) ---
    await assert("API: Remove Torch (Preserve Alligator)",
        async () => await api.remove(token.id, ID_TORCH),
        () => token.document.light.dim === baseLight && token.document.width === 2
    );

    // --- TEST 6: Complete Revert ---
    await assert("API: Revert to Default",
        async () => await api.revert(token.id),
        () => {
            const stack = token.document.getFlag("visage", "activeStack") || [];
            return stack.length === 0 && token.document.width !== 2;
        }
    );

    console.log(`Visage | 🏁 Test Complete: ${passed} Passed, ${failed} Failed.`);
    console.groupEnd();
    
    if (failed === 0) ui.notifications.info("Visage | Test Suite: All tests passed!");
    else ui.notifications.error(`Visage | Test Suite: ${failed} tests failed. Check console.`);
})();

```

## Generic

```javascript

/**
 * VISAGE CORE ENGINE TEST SUITE
 * Select a token and run this macro to verify API integrity.
 */
(async () => {
    const api = game.modules.get("visage")?.api;
    const token = canvas.tokens.controlled[0];
    
    if (!api) return ui.notifications.error("Visage | Visage API not found!");
    if (!token) return ui.notifications.warn("Visage | Please select a test token.");

    console.group(`Visage V4 Test Suite: ${token.name}`);
    let passed = 0; let failed = 0;

    const assert = async (name, action, condition) => {
        try {
            await action();
            // Small delay to let canvas/sequencer catch up
            await new Promise(resolve => setTimeout(resolve, 250)); 
            if (condition()) {
                console.log(`Visage | ✅ PASS: ${name}`);
                passed++;
            } else {
                console.error(`Visage | ❌ FAIL: ${name}`);
                failed++;
            }
        } catch (e) {
            console.error(`Visage | 💥 ERROR: ${name}`, e);
            failed++;
        }
    };

    // --- PREPARATION ---
    await api.revert(token.id);

    // --- TEST 1: Retrieve Available Visages ---
    await assert("API: getAvailable returns items", 
        async () => {}, 
        () => api.getAvailable(token.id).length > 0
    );

    // Get a couple of safe test IDs from your global library
    const globals = api.getAvailable(token.id).filter(v => v.type === "global");
    if (globals.length < 2) {
        console.warn("Visage | Not enough Global Visages to run stack tests. Skipping remaining.");
        console.groupEnd();
        return;
    }
    const maskA = globals[0].id; // e.g., Torch
    const maskB = globals[1].id; // e.g., Disposition/Scale

    // --- TEST 2: Apply Base Overlay ---
    await assert("API: Apply Layer A",
        async () => await api.apply(token.id, maskA),
        () => api.isActive(token.id, maskA) === true
    );

    // --- TEST 3: Apply Stacked Overlay ---
    await assert("API: Apply Layer B (Stacking)",
        async () => await api.apply(token.id, maskB),
        () => api.isActive(token.id, maskA) && api.isActive(token.id, maskB)
    );

    // --- TEST 4: Remove Specific Layer ---
    await assert("API: Remove Layer A (Preserve B)",
        async () => await api.remove(token.id, maskA),
        () => !api.isActive(token.id, maskA) && api.isActive(token.id, maskB)
    );

    // --- TEST 5: Complete Revert ---
    await assert("API: Revert to Default",
        async () => await api.revert(token.id),
        () => {
            const stack = token.document.getFlag("visage", "activeStack") || [];
            return stack.length === 0 && !api.isActive(token.id, maskB);
        }
    );

    console.log(`Visage | Visage Test Complete: ${passed} Passed, ${failed} Failed.`);
    console.groupEnd();
    
    if (failed === 0) ui.notifications.info("Visage | Visage Test Suite: All tests passed!");
    else ui.notifications.error(`Visage | Visage Test Suite: ${failed} tests failed. Check console.`);
})();

```
