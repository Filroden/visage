/**
 * This script is a one-time cleanup utility to be run in the Foundry VTT console.
 * Its purpose is to remove the legacy `rmu-visage` flag data from all tokens
 * on the currently active scene. This is necessary after migrating to the new
 * `visage` flag structure.
 *
 * How to use:
 * 1. Open your Foundry VTT world.
 * 2. Navigate to the scene containing the tokens you want to clean up.
 * 3. Press F12 to open the browser's developer console.
 * 4. Copy and paste the entire script into the console.
 * 5. Press Enter to execute the script.
 */
(async () => {
  // Collect updates to be performed in a single batch operation.
  const updates = canvas.scene.tokens
    .filter(token => token.actor?.flags['rmu-visage'])
    .map(token => ({
      _id: token.id,
      'actorData.flags.-=rmu-visage': null
    }));

  // If any tokens with the old flag were found, perform the update.
  if (updates.length > 0) {
    await canvas.scene.updateEmbeddedDocuments('Token', updates);
    const message = `Visage | Removed old 'rmu-visage' flags from ${updates.length} tokens on the current scene.`;
    console.log(message);
    ui.notifications.info(message);
  } else {
    const message = `Visage | No tokens with old 'rmu-visage' flags found on the current scene.`;
    console.log(message);
    ui.notifications.info(message);
  }
})();
