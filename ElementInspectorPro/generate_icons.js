const fs = require('fs');
const path = require('path');

const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const buffer = Buffer.from(pngBase64, 'base64');

const dir = path.join(__dirname, 'icons');
if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
}

fs.writeFileSync(path.join(dir, 'icon16.png'), buffer);
fs.writeFileSync(path.join(dir, 'icon48.png'), buffer);
fs.writeFileSync(path.join(dir, 'icon128.png'), buffer);
console.log("Icons created.");
