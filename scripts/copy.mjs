
import fs from 'fs';
import path from 'path';

/**
 * Copy files with specific extensions from source to destination
 * while preserving folder structure and applying exclusions
 *
 * @param {string} sourceDir - Source directory path
 * @param {string} destDir - Destination directory path
 * @param {string[]} includeExtensions - Array of file extensions to include (without dots)
 * @param {string[]} excludeExtensions - Array of file extensions to exclude (without dots)
 * @param {string[]} excludeFolders - Array of folder names to exclude
 * @param {string[]} excludeFiles - Array of specific filenames to exclude (regardless of folder)
 * @returns {Promise<void>}
 */
async function copyFiles(sourceDir, destDir, includeExtensions = [], excludeExtensions = [], excludeFolders = [], excludeFiles = []) {
  // Create destination directory if it doesn't exist
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  // Read source directory
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(sourceDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      // Skip excluded folders
      if (excludeFolders.includes(entry.name)) {
        console.log(`Skipping excluded folder: ${srcPath}`);
        continue;
      }

      // Recursively process subdirectories
      await copyFiles(srcPath, destPath, includeExtensions, excludeExtensions, excludeFolders);
    } else if (entry.isFile()) {
      // Skip if filename is in the exclude files list
      if (excludeFiles.includes(entry.name)) {
        console.log(`Skipping excluded file: ${srcPath}`);
        continue;
      }

      const extension = path.extname(entry.name).slice(1).toLowerCase();

      // Skip if file extension is in exclude list
      if (excludeExtensions.includes(extension)) {
        console.log(`Skipping excluded extension: ${srcPath}`);
        continue;
      }

      // Only copy if extension is in include list (or include list is empty)
      if (includeExtensions.length === 0 || includeExtensions.includes(extension)) {
        // Create parent directory if it doesn't exist
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }

        // Copy the file
        fs.copyFileSync(srcPath, destPath);
        console.log(`Copied: ${srcPath} -> ${destPath}`);
      }
    }
  }
}

// CLI application
// Check if this file is being run directly (not imported)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log(`
Usage: node copy-files.mjs <sourceDir> <destDir> [options]

Options:
  --include=ext1,ext2,...  File extensions to include (without dots)
  --exclude=ext1,ext2,...  File extensions to exclude (without dots)
  --exclude-folders=dir1,dir2,...  Folder names to exclude
  --exclude-files=file1,file2,...  Specific filenames to exclude (regardless of folder)
    `);
    process.exit(1);
  }

  const sourceDir = args[0];
  const destDir = args[1];

  // Parse command line options
  const options = args.slice(2).reduce((acc, arg) => {
    if (arg.startsWith('--include=')) {
      acc.include = arg.replace('--include=', '').split(',').filter(Boolean);
    } else if (arg.startsWith('--exclude=')) {
      acc.exclude = arg.replace('--exclude=', '').split(',').filter(Boolean);
    } else if (arg.startsWith('--exclude-folders=')) {
      acc.excludeFolders = arg.replace('--exclude-folders=', '').split(',').filter(Boolean);
    } else if (arg.startsWith('--exclude-files=')) {
      acc.excludeFiles = arg.replace('--exclude-files=', '').split(',').filter(Boolean);
    }
    return acc;
  }, { include: [], exclude: [], excludeFolders: [], excludeFiles: [] });

  console.log('Starting file copy operation with these settings:');
  console.log(`- Source directory: ${sourceDir}`);
  console.log(`- Destination directory: ${destDir}`);
  console.log(`- Include extensions: ${options.include.length ? options.include.join(', ') : 'All'}`);
  console.log(`- Exclude extensions: ${options.exclude.length ? options.exclude.join(', ') : 'None'}`);
  console.log(`- Exclude folders: ${options.excludeFolders.length ? options.excludeFolders.join(', ') : 'None'}`);
  console.log(`- Exclude files: ${options.excludeFiles.length ? options.excludeFiles.join(', ') : 'None'}`);

  copyFiles(sourceDir, destDir, options.include, options.exclude, options.excludeFolders, options.excludeFiles)
  .then(() => {
    console.log('File copy operation completed successfully!');
  })
  .catch((error) => {
    console.error('Error during file copy operation:', error);
    process.exit(1);
  });
}

// Export the function for use as a module
export { copyFiles };
