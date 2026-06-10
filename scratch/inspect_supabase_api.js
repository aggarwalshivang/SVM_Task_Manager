const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zbGh6a3RoY2dqeXFsZWpscnhrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDE5NTMwNiwiZXhwIjoyMDk1NzcxMzA2fQ.ZdpBngyhWUnnHe4Qhv-LgdPjEYgI4mmH2w-zLRjFb6Y';
const BASE_URL = 'https://nslhzkthcgjyqlejlrxk.supabase.co/rest/v1';

async function main() {
  const res = await fetch(`${BASE_URL}/`, {
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`
    }
  });
  const data = await res.json();
  console.log('Available tables/views:', Object.keys(data.paths).filter(p => !p.startsWith('/rpc/')));
  console.log('Available RPCs:', Object.keys(data.paths).filter(p => p.startsWith('/rpc/')));
}
main();
