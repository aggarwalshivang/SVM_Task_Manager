const fs = require('fs');

const files = ['index.html', 'app.js'];

files.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    if (line.toLowerCase().includes('loader') || line.toLowerCase().includes('spinner') || line.toLowerCase().includes('loading-')) {
      console.log(`${file}:${index + 1}: ${line.trim()}`);
    }
  });
});
