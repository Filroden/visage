/**
 * VISAGE E2E MASTER TEST SUITE
 * Combines dynamic API validation with hardcoded edge-case orchestration.
 * Validates API integrity, Composer mathematical layering, Sequencer delays, Stack Logic, and Edge Cases.
 */
(async () => {
    const api = game.modules.get("visage")?.api;
    const token = canvas.tokens.controlled[0];

    if (!api) return ui.notifications.error("Visage | Visage API not found!");
    if (!token) return ui.notifications.warn("Visage | Please select a test token.");

    console.group(`Visage | 🧪 V4 Master Test Suite Running on: ${token.name}`);
    let passed = 0;
    let failed = 0;

    /**
     * E2E Polling Mechanism:
     * Evaluates the condition every 50ms. Passes instantly when true,
     * or fails gracefully if the maxWait timeout is reached.
     */
    const assert = async (name, action, condition, maxWait = 2500) => {
        try {
            // 1. Execute the Action(s)
            await action();

            // 2. Poll the expected Condition
            let success = false;
            let elapsed = 0;
            const interval = 50;

            while (elapsed <= maxWait) {
                if (condition()) {
                    success = true;
                    break;
                }
                await new Promise((r) => setTimeout(r, interval));
                elapsed += interval;
            }

            // 3. Log Result
            if (success) {
                console.log(`Visage | ✅ PASS: ${name}`);
                passed++;
            } else {
                console.error(`Visage | ❌ FAIL: ${name} (Condition not met after ${maxWait}ms)`);
                failed++;
            }
        } catch (err) {
            console.error(`Visage | 💥 ERROR: ${name}`, err);
            failed++;
        }
    };

    // --- INITIALISATION ---
    await api.revert(token.id);
    await new Promise((r) => setTimeout(r, 500)); // Ensure clean start

    // ========================================================================
    // PHASE 1: DYNAMIC API INTEGRITY
    // ========================================================================
    console.log("--- Starting Phase 1: Dynamic API Integrity ---");

    await assert(
        "API: getAvailable returns items",
        async () => {},
        () => api.getAvailable(token.id).length > 0,
    );

    const globals = api.getAvailable(token.id).filter((v) => v.type === "global");
    if (globals.length < 2) {
        console.warn("Visage | Not enough Global Visages to run stack tests. Skipping Phase 1.");
    } else {
        const maskA = globals[0].id;
        const maskB = globals[1].id;

        await assert(
            "API: Apply Layer A",
            async () => await api.apply(token.id, maskA),
            () => api.isActive(token.id, maskA) === true,
        );

        await assert(
            "API: Apply Layer B (Stacking)",
            async () => await api.apply(token.id, maskB),
            () => api.isActive(token.id, maskA) && api.isActive(token.id, maskB),
        );

        await assert(
            "API: Remove Layer A (Preserve B)",
            async () => await api.remove(token.id, maskA),
            () => !api.isActive(token.id, maskA) && api.isActive(token.id, maskB),
        );
    }

    // --- MID-TEST CLEANUP ---
    await api.revert(token.id);
    await new Promise((r) => setTimeout(r, 500));

    // ========================================================================
    // PHASE 2: HARDCODED EDGE CASES & ORCHESTRATION
    // ========================================================================
    console.log("--- Starting Phase 2: Edge Cases & Orchestration ---");

    // Core Masks
    const maskIdentityBear = "xgtKQTuIf51Xg7aI";
    const maskTorch = "94WkCyfQ3fU1suxM";
    const maskApe = "Ggi6M947iLmjpPSm";
    const maskAlligator = "C0caM7ra7NgK5Xmh";
    const maskScale = "znoc5gClZs6tJ4VF";
    const maskAnchor = "y3j1Nq0fiyroyJW7";

    // Orchestration Masks
    const maskSize4 = "mOMjC741TElCKDhj"; // Width/Height 4
    const maskSize1 = "sIqsr7iYXkfIy3iN"; // Width/Height 1
    const maskGhost = "NW5NU61wb7XI4p9i"; // Alpha 0.5
    const maskSecret = "PdsqRY7Cj8XfRq65"; // Disposition -2

    // Edge Case Masks
    const maskPortrait = "ztbOOK2ypNLq8IEY"; // Portrait override
    const maskMirror = "RnbqezzqeQlrcszh"; // Horizontal flip
    const maskRing = "8DnrzrxZzSWC0vzF"; // Low Health ring
    const maskName = "7sooGShfHXDaXjuS"; // Name override

    // Cache the TRUE original token data for the final revert test
    const baseState = {
        name: token.document.name,
        portrait: token.actor.img,
        width: token.document.width,
        alpha: token.document.alpha,
        scaleX: token.document.texture.scaleX,
        ringEnabled: token.document.ring?.enabled ?? false,
    };

    await assert(
        "Apply Identity Layer (Bear)",
        async () => await api.apply(token.id, maskIdentityBear),
        () => token.document.getFlag("visage", "identity") === maskIdentityBear && token.document.width === 1.5,
    );

    await assert(
        "Apply Light Overlay (Torch)",
        async () => await api.apply(token.id, maskTorch),
        () => token.document.light.dim === 40,
    );

    await assert(
        "Apply Inactive Light Overlay (Ape)",
        async () => await api.apply(token.id, maskApe),
        () => token.document.light.dim === 40 && token.document.width === 2,
    );

    await assert(
        "Apply Layer with Global Delay (Alligator)",
        async () => await api.apply(token.id, maskAlligator),
        () => api.isActive(token.id, maskAlligator) && token.document.texture.src.includes("Alligator"),
    );

    await assert(
        "Apply Geometric Mutations (Scale + Anchor)",
        async () => {
            await api.apply(token.id, maskScale);
            await api.apply(token.id, maskAnchor);
        },
        () => token.document.texture.scaleX === 3 && token.document.texture.anchorX === 0,
    );

    await assert(
        "Stack Priority Override (4x4 vs 1x1)",
        async () => {
            await api.apply(token.id, maskSize4);
            await api.apply(token.id, maskSize1);
        },
        () => token.document.width === 1,
    );

    await assert(
        "Stack Priority Reveal (Remove 1x1, reveal 4x4)",
        async () => await api.remove(token.id, maskSize1),
        () => token.document.width === 4,
    );

    await assert(
        "API Toggle Layer (Ghost Form)",
        async () => {
            await api.apply(token.id, maskGhost);
            await api.toggleLayer(token.id, maskGhost);
        },
        () => {
            const stack = token.document.getFlag("visage", "activeStack") || [];
            const ghostLayer = stack.find((l) => l.id === maskGhost);
            return ghostLayer?.disabled === true && token.document.alpha === 1;
        },
    );

    await assert(
        "Apply Data Mutation (Secret Disposition)",
        async () => await api.apply(token.id, maskSecret),
        () => token.document.disposition === -2,
    );

    await assert(
        "Apply Actor Portrait Update",
        async () => await api.apply(token.id, maskPortrait),
        () => {
            // Unlinked tokens use synthetic actors. Visage safely bypasses portrait
            // mutations here to prevent bloating the scene data.
            if (!token.document.isLinked) return token.actor.img === baseState.portrait;

            const expected = "images/1720192926382.png";
            const actual = token.actor.img;
            const isMatch = actual.includes(expected);

            // Only fire the warning if it genuinely fails both strict and fuzzy matching
            if (!isMatch) {
                console.warn(`Visage | Portrait Mismatch -> Expected to include: '${expected}', Actual: '${actual}'`);
            }

            // Return the boolean evaluation directly
            return isMatch;
        },
    );

    await assert(
        "Apply Decoupled Mirror Math (Horizontal Flip)",
        async () => await api.apply(token.id, maskMirror),
        () => token.document.texture.scaleX < 0,
    );

    await assert(
        "Apply Dynamic Ring Object (Low Health)",
        async () => await api.apply(token.id, maskRing),
        () => token.document.ring.enabled === true,
    );

    await assert(
        "Apply Name Override (Maid)",
        async () => await api.apply(token.id, maskName),
        () => token.document.name === "Maid",
    );

    // ========================================================================
    // FINAL CLEANUP & VERIFICATION
    // ========================================================================
    await assert(
        "Complete Revert to Default State",
        async () => await api.revert(token.id),
        () => {
            const stack = token.document.getFlag("visage", "activeStack") || [];
            const identity = token.document.getFlag("visage", "identity");
            const currentRingEnabled = token.document.ring?.enabled ?? false;

            return (
                stack.length === 0 &&
                !identity &&
                token.document.alpha === baseState.alpha &&
                token.document.width === baseState.width &&
                token.document.texture.scaleX === baseState.scaleX &&
                currentRingEnabled === baseState.ringEnabled &&
                token.document.name === baseState.name &&
                token.actor.img === baseState.portrait
            );
        },
    );

    console.log(`Visage | 🏁 TEST SUITE COMPLETE | Passed: ${passed} | Failed: ${failed}`);
    console.groupEnd();

    if (failed === 0) ui.notifications.info("Visage | Master Test Suite: All tests passed!");
    else ui.notifications.error(`Visage | Master Test Suite: ${failed} tests failed. Check console.`);
})();
