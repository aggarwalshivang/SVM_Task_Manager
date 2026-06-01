const fs = require('fs');

const file = 'app.js';
const content = fs.readFileSync(file, 'utf8');
const lines = content.split('\n');

console.log('Total lines:', lines.length);

lines.forEach((line, index) => {
  if (line.includes('function renderTasks')) {
    console.log(`Line ${index + 1}: ${line}`);
  }
});
