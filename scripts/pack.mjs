import { compilePack } from "@foundryvtt/foundryvtt-cli";
import { copyFiles } from "./copy.mjs";
import fs from "fs";

if (fs.existsSync("./dist")) {
    fs.rmSync("./dist", { recursive: true });
}

copyFiles(
    ".",
    "./dist",
    ["js", "json", "css", "hbs", "svg", "md", "html"],
    [],
    ["dist", "node_modules", ".git", ".github", "scripts"],
    [
        "package.json",
        "package-lock.json",
        "GEMINI.md",
        ".DS_Store",
        ".gitignore",
        ".gitattributes",
        "ar.json",
        "ca.json",
        "cs.json",
        "cy.json",
        "de.json",
        "es-419.json",
        "es.json",
        "fa.json",
        "fi.json",
        "he.json",
        "hu.json",
        "it.json",
        "ja.json",
        "ko.json",
        "nl.json",
        "pl.json",
        "pt-br.json",
        "pt-pt.json",
        "ro.json",
        "ru.json",
        "sv.json",
        "tr.json",
        "uk.json",
        "zh-cn.json",
        "zh-tw.json",
    ],
)
    .then(() => {
        console.log("File copy operation completed successfully!");
    })
    .catch((error) => {
        console.error("Error during file copy operation:", error);
        process.exit(1);
    });
