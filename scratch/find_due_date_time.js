const fs = require('fs');

const file = 'apps-script/Code.js';
const content = fs.readFileSync(file, 'utf8');
const lines = content.split('\n');

lines.forEach((line, index) => {
  if (line.includes('function getTaskDueDateTime')) {
    console.log(`Line ${index + 1}: ${line}`);
    // print next 20 lines
    for (let i = 0; i < 20; i++) {
      console.log(`${index + 1 + i + 1}: ${lines[index + 1 + i]}`);
    }
  }
});
