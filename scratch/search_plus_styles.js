const fs = require('fs');

const content = fs.readFileSync('styles.css', 'utf8');
const lines = content.split('\n');

lines.forEach((line, index) => {
  if (line.includes('button') || line.includes('.btn') || line.includes('floating')) {
    console.log(`styles.css:${index + 1}: ${line.trim()}`);
  }
});
