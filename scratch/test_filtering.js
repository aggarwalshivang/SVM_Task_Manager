const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zbGh6a3RoY2dqeXFsZWpscnhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxOTUzMDYsImV4cCI6MjA5NTc3MTMwNn0.KCXg7pm9gH2ulG7uNtVmJoYKWP2laosAhwnvEfh15V8';
const BASE_URL = 'https://nslhzkthcgjyqlejlrxk.supabase.co/rest/v1';

function getTodayStr() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  const localDate = new Date(d.getTime() - (offset * 60 * 1000));
  return localDate.toISOString().substring(0, 10);
}

async function main() {
  const user = 'Sneha';
  const res = await fetch(`${BASE_URL}/tasks?assigned_to=eq.${user}`, {
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`
    }
  });
  const data = await res.json();
  console.log(`Total tasks for ${user}:`, data.length);
  
  const today = getTodayStr();
  console.log('Today is:', today);
  
  const filtered = data.filter(t => {
    const d = (t.planned_date || '').substring(0, 10);
    const matchesDate = d === today;
    const matchesStatus = ['overdue','stuck','in-progress','missed'].includes(t.status);
    return matchesDate || matchesStatus;
  });
  
  console.log('Filtered tasks count:', filtered.length);
  if (filtered.length > 0) {
    console.log('Sample filtered task:', filtered[0]);
  } else {
    console.log('No tasks matched the filter! Let us see some task dates & statuses:');
    data.slice(0, 10).forEach(t => {
      console.log(`Task: "${t.task_name}" | Date: "${t.planned_date}" | Status: "${t.status}"`);
    });
  }
}

main();
