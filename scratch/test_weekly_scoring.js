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
      let isSingle = false;
      
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
        maybeSingle: () => {
          isSingle = true;
          return builder;
        },
        then: async (resolve, reject) => {
          try {
            const filterStr = filters.join('&');
            const qStr = queryParams.join('&');
            const fullUrl = `${global.CONFIG.SUPABASE_URL}/rest/v1/${table}?${[qStr, filterStr].filter(Boolean).join('&')}`;
            
            const reqHeaders = { ...headers };
            if (isSingle && method === 'GET') {
              reqHeaders['Accept'] = 'application/vnd.pgrst.object+json';
            }
            
            const options = {
              method,
              headers: reqHeaders
            };
            if (payload) {
              options.body = JSON.stringify(payload);
            }
            
            const res = await fetch(fullUrl, options);
            if (!res.ok) {
              const text = await res.text();
              // If single object expected but 0 rows returned, PostgREST returns 406 Not Acceptable or 200/404
              if (isSingle && res.status === 406) {
                resolve({ data: null, error: null });
              } else {
                resolve({ data: null, error: { message: text } });
              }
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

const apiCode = fs.readFileSync('supabase-api.js', 'utf8');
eval(apiCode);

async function runTest() {
  console.log('--- TESTING saveWeeklyTarget ---');
  try {
    const saveRes = await supabaseApiFetch('saveWeeklyTarget', {
      user: 'ankit',
      week: 24,
      year: 2026,
      nextTarget: -15,
      commitmentChecked: true
    });
    console.log('saveWeeklyTarget response:', saveRes);

    console.log('--- TESTING getScores ---');
    const getRes = await supabaseApiFetch('getScores', {
      week: 24,
      year: 2026
    });
    console.log('getScores response success:', getRes.success);
    if (getRes.success && getRes.data) {
      const ankitScore = getRes.data.find(s => s.name === 'ankit');
      console.log('ankit score row:', ankitScore);
    }
  } catch (err) {
    console.error('Test error:', err);
  }
}

runTest();
