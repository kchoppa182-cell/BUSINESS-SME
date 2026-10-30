const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, '..', 'frontend');
const output = path.join(__dirname, '..', 'public');

fs.mkdirSync(output, { recursive: true });
fs.cpSync(source, output, { recursive: true });
