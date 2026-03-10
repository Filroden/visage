# Automated Test Macro

## Test World

```javascript
/**
 * VISAGE CORE ENGINE TEST SUITE (EXTENDED)
 * Validates API integrity, Composer mathematical layering, Sequencer delays, Stack Logic, and Edge Cases.
 */
(async () => {
    const api = game.modules.get("visage")?.api;
    const token = canvas.tokens.controlled[0];
    
    if (!api) return ui.notifications.error("Visage | Visage API not found!");
    if (!token) return ui.notifications.warn("Visage | Please select a test token.");

    console.group(`Visage | 🧪 V4 Test Suite Running on: ${token.name}`);
    let passed = 0; let failed = 0;

    const assert = async (name, action, condition, waitTime = 1000) => {
        try {
            await action();
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

    await api.revert(token.id);
    await new Promise(resolve => setTimeout(resolve, 500));

    // Core Masks
    const maskIdentityBear = "xgtKQTuIf51Xg7aI"; 
    const maskTorch        = "94WkCyfQ3fU1suxM"; 
    const maskApe          = "Ggi6M947iLmjpPSm"; 
    const maskAlligator    = "C0caM7ra7NgK5Xmh"; 
    const maskScale        = "znoc5gClZs6tJ4VF"; 
    const maskAnchor       = "y3j1Nq0fiyroyJW7"; 
    
    // Orchestration Masks
    const maskSize4        = "mOMjC741TElCKDhj"; // Width/Height 4
    const maskSize1        = "sIqsr7iYXkfIy3iN"; // Width/Height 1
    const maskGhost        = "NW5NU61wb7XI4p9i"; // Alpha 0.5
    const maskSecret       = "PdsqRY7Cj8XfRq65"; // Disposition -2

    // Edge Case Masks
    const maskPortrait     = "ztbOOK2ypNLq8IEY"; // Portrait override
    const maskMirror       = "RnbqezzqeQlrcszh"; // Horizontal flip
    const maskRing         = "8DnrzrxZzSWC0vzF"; // Low Health ring
    const maskName         = "7sooGShfHXDaXjuS"; // Name override

    // Cache original token name for the revert test
    const baseName = token.document.name;
    const basePortrait = token.actor.img;

    // --- TEST 1: Identity Base Application ---
    await assert("Apply Identity Layer (Bear)",
        async () => await api.apply(token.id, maskIdentityBear),
        () => token.document.getFlag("visage", "identity") === maskIdentityBear && token.document.width === 1.5
    );

    // --- TEST 2: Active Light Stack ---
    await assert("Apply Light Overlay (Torch)",
        async () => await api.apply(token.id, maskTorch),
        () => token.document.light.dim === 40 
    );

    // --- TEST 3: Inactive Light Overwrite Prevention (Bug Check) ---
    await assert("Apply Inactive Light Overlay (Ape)",
        async () => await api.apply(token.id, maskApe),
        () => token.document.light.dim === 40 && token.document.width === 2
    );

    // --- TEST 4: Global Delay & Async Resolution ---
    await assert("Apply Layer with 500ms Delay (Alligator)",
        async () => await api.apply(token.id, maskAlligator),
        () => api.isActive(token.id, maskAlligator) && token.document.texture.src.includes("Alligator"),
        1200 
    );

    // --- TEST 5: Cartesian Geometry and Scale Stack ---
    await assert("Apply Geometric Mutations (Scale + Anchor)",
        async () => {
            await api.apply(token.id, maskScale);
            await api.apply(token.id, maskAnchor);
        },
        () => token.document.texture.scaleX === 3 && token.document.texture.anchorX === 0
    );

    // --- TEST 6: Stack Priority (Z-Index) Override ---
    await assert("Stack Priority Override (4x4 vs 1x1)",
        async () => {
            await api.apply(token.id, maskSize4); 
            await api.apply(token.id, maskSize1); 
        },
        () => token.document.width === 1 
    );

    // --- TEST 7: Stack Priority (Z-Index) Reveal ---
    await assert("Stack Priority Reveal (Remove 1x1, reveal 4x4)",
        async () => await api.remove(token.id, maskSize1),
        () => token.document.width === 4 
    );

    // --- TEST 8: Boolean API Toggling ---
    await assert("API Toggle Layer (Ghost Form)",
        async () => {
            await api.apply(token.id, maskGhost); 
            await api.toggleLayer(token.id, maskGhost); 
        },
        () => {
            const stack = token.document.getFlag("visage", "activeStack") || [];
            const ghostLayer = stack.find(l => l.id === maskGhost);
            return ghostLayer && ghostLayer.disabled === true && token.document.alpha === 1;
        }
    );

    // --- TEST 9: Non-Visual Data Merging ---
    await assert("Apply Data Mutation (Secret Disposition)",
        async () => await api.apply(token.id, maskSecret),
        () => token.document.disposition === -2
    );

    // --- TEST 10: Actor Portrait Update ---
    await assert("Apply Actor Portrait Update",
        async () => await api.apply(token.id, maskPortrait),
        () => token.actor.img === "images/1720192926382.png"
    );

    // --- TEST 11: Decoupled Mirror Math ---
    await assert("Apply Decoupled Mirror Math (Horizontal Flip)",
        async () => await api.apply(token.id, maskMirror),
        () => token.document.texture.scaleX < 0 
    );

    // --- TEST 12: Dynamic Ring Object ---
    await assert("Apply Dynamic Ring Object (Low Health)",
        async () => await api.apply(token.id, maskRing),
        () => token.document.ring.enabled === true
    );

    // --- TEST 13: Name Override ---
    await assert("Apply Name Override (Maid)",
        async () => await api.apply(token.id, maskName),
        () => token.document.name === "Maid"
    );

    // --- TEST 14: Complete Revert & Cleanup ---
    await assert("Revert to Default State",
        async () => await api.revert(token.id),
        () => {
            const stack = token.document.getFlag("visage", "activeStack") || [];
            const identity = token.document.getFlag("visage", "identity");
            
            // Verify everything is wiped, including standard properties like disposition returning to normal,
            // the decoupled mirror math resolving to a positive scale, the dynamic ring disabling, and
            // the actor portrait returning to its original state.
            return stack.length === 0 && 
                   !identity && 
                   token.document.alpha === 1 && 
                   token.document.width === 1 && 
                   token.document.texture.scaleX > 0 &&
                   token.document.ring.enabled === false &&
                   token.document.name === baseName &&
                   token.actor.img === basePortrait;
        }
    );

    console.log(`Visage | 🏁 TEST SUITE COMPLETE | Passed: ${passed} | Failed: ${failed}`);
    console.groupEnd();
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
