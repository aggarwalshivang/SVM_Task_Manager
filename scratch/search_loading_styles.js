const fs = require('fs');

const content = fs.readFileSync('index.html', 'utf8');
const lines = content.split('\n');

let found = false;
lines.forEach((line, index) => {
  if (line.includes('loading-screen') || line.includes('loading-spinner') || line.includes('loading-logo')) {
    console.log(`Line ${index + 1}: ${line.trim()}`);
  }
});
