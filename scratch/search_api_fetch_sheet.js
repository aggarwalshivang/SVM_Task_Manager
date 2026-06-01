const fs = require('fs');

const file = 'app.js';
const content = fs.readFileSync(file, 'utf8');
const lines = content.split('\n');

lines.forEach((line, index) => {
  if (line.includes('apiFetchSheet')) {
    console.log(`Line ${index + 1}: ${line.trim()}`);
  }
});
