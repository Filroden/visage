import {compilePack} from '@foundryvtt/foundryvtt-cli';
import {copyFiles} from './copy.mjs';
import fs from 'fs';

if (fs.existsSync('./dist')) {
  fs.rmSync('./dist', { recursive: true });
}

copyFiles(
  '.',
  './dist',
  ['js', 'json', 'css', 'hbs', 'svg', 'md', 'html'],
  [],
  ['dist', 'node_modules', '.git', '.github', 'scripts'],
  ['package.json', 'package-lock.json', 'GEMINI.md', '.DS_Store', '.gitignore', '.gitattributes']
)  
.then(() => {
  console.log('File copy operation completed successfully!');
})
.catch((error) => {
  console.error('Error during file copy operation:', error);
  process.exit(1);
});



