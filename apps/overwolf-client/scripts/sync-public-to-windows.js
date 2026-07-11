const fs = require('fs');
const path = require('path');

const source = path.resolve(__dirname, '..', 'public');
const target = process.env.OVERWOLF_PUBLIC_TARGET || '/mnt/c/Users/Chewbacca/Desktop/123/overwolf-client/public';

function copyDirectory(src, dest) {
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
      continue;
    }

    if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

if (!fs.existsSync(source)) {
  throw new Error(`Overwolf public source does not exist: ${source}`);
}

copyDirectory(source, target);
console.log(`Synced Overwolf public files to ${target}`);
