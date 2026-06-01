const fs = require('fs');

const content = fs.readFileSync('styles.css', 'utf8');
const lines = content.split('\n');

lines.forEach((line, index) => {
  if (line.toLowerCase().includes('loader') || line.toLowerCase().includes('spinner') || line.toLowerCase().includes('loading-')) {
    console.log(`styles.css:${index + 1}: ${line.trim()}`);
  }
});
