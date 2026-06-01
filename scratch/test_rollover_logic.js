const fs = require('fs');

global.CONFIG = {
  SUPABASE_URL: 'https://nslhzkthcgjyqlejlrxk.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zbGh6a3RoY2dqeXFsZWpscnhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxOTUzMDYsImV4cCI6MjA5NTc3MTMwNn0.KCXg7pm9gH2ulG7uNtVmJoYKWP2laosAhwnvEfh15V8'
};

global.syncToSheet = function(action, data) {
  console.log(`[MOCK syncToSheet] action: ${action}, data:`, data);
};

global.getSupabase = function() {
  const headers = {
    'apikey': global.CONFIG.SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${global.CONFIG.SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json'
  };
  
  return {
    from: (table) => {
      let queryParams = [];
      let filters = [];
      let method = 'GET';
      let payload = null;
      
      const builder = {
        select: (cols) => {
          queryParams.push(`select=${cols}`);
          return builder;
        },
        eq: (col, val) => {
          filters.push(`${col}=eq.${encodeURIComponent(val)}`);
          return builder;
        },
        update: (p) => {
          method = 'PATCH';
          payload = p;
          return builder;
        },
        insert: (p) => {
          method = 'POST';
          payload = p;
          return builder;
        },
        then: async (resolve, reject) => {
          try {
            const filterStr = filters.join('&');
            const qStr = queryParams.join('&');
            const fullUrl = `${global.CONFIG.SUPABASE_URL}/rest/v1/${table}?${[qStr, filterStr].filter(Boolean).join('&')}`;
            
            const options = {
              method,
              headers
            };
            if (payload) {
              options.body = JSON.stringify(payload);
            }
            
            const res = await fetch(fullUrl, options);
            if (!res.ok) {
              resolve({ data: null, error: { message: await res.text() } });
            } else {
              if (method === 'PATCH' || method === 'POST') {
                resolve({ data: {}, error: null });
              } else {
                const json = await res.json();
                resolve({ data: json, error: null });
              }
            }
          } catch (err) {
            resolve({ data: null, error: { message: err.message } });
          }
        }
      };
      
      return builder;
    }
  };
};

global.hashPassword = async function(p) { return p; };

// Helper with updated regex parsing
function getTaskDueDateTime(dateStr, timeStr) {
  if (!dateStr) return null;
  const dateStrClean = String(dateStr).substring(0, 10);
  const parts = dateStrClean.split('-').map(Number);
  if (parts.length < 3) return null;
  const [year, month, day] = parts;

  let hour = 23, minute = 59;
  if (timeStr) {
    const timeStrClean = String(timeStr);
    const match = timeStrClean.match(/(?:^|\s)(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (match) {
      hour = parseInt(match[1], 10);
      minute = parseInt(match[2], 10);
    }
  }
  return new Date(year, month - 1, day, hour, minute);
}

// Override getTaskDueDateTime in eval context
const apiCode = fs.readFileSync('supabase-api.js', 'utf8');
eval(apiCode.replace(/function getTaskDueDateTime[\s\S]*?return new Date\(year, month - 1, day, hour, minute\);\s*\}/, getTaskDueDateTime.toString()));

async function runTest() {
  console.log('--- STARTING TASK ROLLOVER TEST WITH FIXED CHAINING ---');
  try {
    const res = await supabaseApiFetch('getTasks', { user: 'Sneha' });
    console.log('Result success:', res.success);
    console.log(`Loaded ${res.data.length} tasks for Sneha`);
    if (res.data.length > 0) {
      console.log('Sample tasks:');
      res.data.slice(0, 5).forEach(t => {
        console.log(`- Task: "${t.taskName}" | Date: ${t.plannedDate} | Status: ${t.status} | Points: ${t.points}`);
      });
    }
  } catch (err) {
    console.error('Test error:', err);
  }
}

runTest();
