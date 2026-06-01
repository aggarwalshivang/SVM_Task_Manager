const fs = require('fs');

const file = 'apps-script/Code.js';
const content = fs.readFileSync(file, 'utf8');
const lines = content.split('\n');

function printFunction(name) {
  let startIndex = -1;
  let braceCount = 0;
  let started = false;
  
  lines.forEach((line, index) => {
    if (line.includes(`function ${name}`)) {
      startIndex = index;
      started = true;
    }
    if (started) {
      // count braces
      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;
      braceCount += opens - closes;
      console.log(`${index + 1}: ${line}`);
      if (braceCount === 0 && index > startIndex) {
        started = false;
      }
    }
  });
}

console.log('=== isTaskPastGracePeriod ===');
printFunction('isTaskPastGracePeriod');

console.log('\n=== calculateNextDate ===');
printFunction('calculateNextDate');
