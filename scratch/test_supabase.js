const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zbGh6a3RoY2dqeXFsZWpscnhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxOTUzMDYsImV4cCI6MjA5NTc3MTMwNn0.KCXg7pm9gH2ulG7uNtVmJoYKWP2laosAhwnvEfh15V8';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zbGh6a3RoY2dqeXFsZWpscnhrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDE5NTMwNiwiZXhwIjoyMDk1NzcxMzA2fQ.ZdpBngyhWUnnHe4Qhv-LgdPjEYgI4mmH2w-zLRjFb6Y';
const BASE_URL = 'https://nslhzkthcgjyqlejlrxk.supabase.co/rest/v1';

async function testQuery(tableName, key, keyName) {
  try {
    const res = await fetch(`${BASE_URL}/${tableName}?select=count`, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`
      }
    });
    const text = await res.text();
    console.log(`[${keyName}] ${tableName} count response:`, text);
  } catch (err) {
    console.error(`[${keyName}] Error querying ${tableName}:`, err.message);
  }
}

async function testSelect(tableName, key, keyName) {
  try {
    const res = await fetch(`${BASE_URL}/${tableName}?limit=3`, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`
      }
    });
    const text = await res.text();
    console.log(`[${keyName}] ${tableName} sample rows:`, text.substring(0, 500));
  } catch (err) {
    console.error(`[${keyName}] Error querying ${tableName}:`, err.message);
  }
}

async function main() {
  console.log('=== TEST WITH ANON KEY ===');
  await testQuery('tasks', ANON_KEY, 'ANON');
  await testQuery('team', ANON_KEY, 'ANON');
  await testSelect('tasks', ANON_KEY, 'ANON');

  console.log('\n=== TEST WITH SERVICE KEY ===');
  await testQuery('tasks', SERVICE_KEY, 'SERVICE');
  await testQuery('team', SERVICE_KEY, 'SERVICE');
  await testSelect('tasks', SERVICE_KEY, 'SERVICE');
}

main();
