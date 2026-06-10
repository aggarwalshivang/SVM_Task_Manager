const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zbGh6a3RoY2dqeXFsZWpscnhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxOTUzMDYsImV4cCI6MjA5NTc3MTMwNn0.KCXg7pm9gH2ulG7uNtVmJoYKWP2laosAhwnvEfh15V8';
const BASE_URL = 'https://nslhzkthcgjyqlejlrxk.supabase.co/rest/v1';

async function main() {
  const res = await fetch(`${BASE_URL}/tasks?limit=1`, {
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`
    }
  });
  const data = await res.json();
  console.log('tasks sample row keys:', Object.keys(data[0] || {}));
  console.log('tasks sample row:', data[0]);
}
main();
