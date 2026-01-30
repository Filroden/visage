import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        // Foundry VTT Globals
        foundry: "readonly",
        game: "readonly",
        canvas: "readonly",
        ui: "readonly",
        Hooks: "readonly",
        FilePicker: "readonly",
        AudioHelper: "readonly",
        VideoHelper: "readonly",
        PIXI: "readonly",
        Actor: "readonly",
        Item: "readonly",
        Scene: "readonly",
        Token: "readonly",
        User: "readonly",
        ChatMessage: "readonly",
        Macro: "readonly",
        Roll: "readonly",
        Config: "readonly",
        Handlebars: "readonly",
        jQuery: "readonly",
        renderTemplate: "readonly",
        CONFIG: "readonly",
        // Hosting & Module Globals
        ForgeVTT: "readonly",
        Sequencer: "readonly",
        Trowel: "readonly"
      }
    },
    rules: {
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
      "no-debugger": "warn",
      "no-console": "off" // Set to "warn" if you want to find left-over logs
    }
  }
];
