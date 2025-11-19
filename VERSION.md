# Version History

| Version | Changes |
| :--- | :--- |
| **Version 1.2.0** | * Internal: Move module to ApplicationV2 in preparation for implementing a global Visage directory.<br>* Internal: Add data normalisation helper.<br> * Update migration script as it missed unlinked tokens.|
| **Version 1.1.1** | * Fix bug that prevented multiple Visages being created at the same time. |
| **Version 1.1.0** | * Visages can now be saved with blank Name or Image Path fields to create "partial" visages, inheriting the token's default name/image as needed.<br>* Upgraded the getForms API to accept an optional tokenId to intelligently resolve these partial visages using either token-specific defaults or (if no ID is provided) the actor's prototype token defaults. |
| **Version 1.0.8** | * Internal: Rename misleading name-key and UUID-key variables. |
| **Version 1.0.7** | * Correct manifest link (for real this time). |
| **Version 1.0.6** | * Correct manifest link. |
| **Version 1.0.5** | * Remove box-shadow on Visage Selector HUD setting icon. |
| **Version 1.0.1** | * Remove red bottom border on Visage Selector title.<br>* Allow duplicate visage names. |
| **Version 1.0.0** | **FULL RELEASE**<br>* Internal: Refactored internal data storage from name-keyed to UUID-keyed actor flags for improved data integrity.<br>* Added one time migration for beta-testers.<br>* Additional documentation improvements before public release. |
| **Version 0.5.0** | * Add feature to configure and apply token disposition (Friendly, Neutral, Hostile, Secret) with each visage, enabling disguise and illusion mechanics.<br>* Update styling for configuration window and selector HUD chip.<br>* Update documentation.<br>* Small styling changes to Visage Configuration window. |
| **Version 0.4.0** | * Internal: Significant re-write.<br>* Move the token configuration from the default token window where there was a rendering issue, to its own window, opened by clicking a setting cog in the Visage Selector HUD.<br>* Add styling to the "Save Changes" button if there are changes to be saved.<br>* Match the new config window style to the Selector HUD style.<br>* Sort Visage forms in the Selector HUD in alphabetical order with the default always first.<br>* Add shuffle icon on any visage form that uses a wildcard within its filepath to show user they can select it again for a different random pick. |
| **Version 0.3.4** | * Fix flip option for token images. |
| **Version 0.3.3** | * Fix bug when restoring scale to default (again).<br>* Fix how wildcard paths are resolved to prevent the mystery man appearing. |
| **Version 0.3.2** | * Fix bug when restoring scale to default. |
| **Version 0.3.1** | * Fix label in configuration tab. |
| **Version 0.3.0** | * Add a token image scaling feature, including option to flip the image. |
| **Version 0.2.4** | * Add module setting to remove visage data from tokens.<br>* Add star icon to default token tile in selector HUD.<br>* Add usage instructions to the README.md. |
| **Version 0.2.3** | * Internal: Under the covers code improvement.<br>* Improvements made to visage token configuration. |
| **Version 0.2.1** | * Fix issue with reading data from tokens that were not linked to actors. |
| **Version 0.2.0** | **INITIAL BETA RELEASE** |
