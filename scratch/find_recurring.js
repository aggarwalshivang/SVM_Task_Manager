const fs = require('fs');

const file = 'apps-script/Code.js';
const content = fs.readFileSync(file, 'utf8');
const lines = content.split('\n');

lines.forEach((line, index) => {
  if (line.includes('function handleManual') || line.includes('generateRecurringTasks')) {
    console.log(`Line ${index + 1}: ${line}`);
    // print next 40 lines
    for (let i = 0; i < 40; i++) {
      if (lines[index + 1 + i]) {
        console.log(`${index + 1 + i + 1}: ${lines[index + 1 + i]}`);
      }
    }
  }
});
