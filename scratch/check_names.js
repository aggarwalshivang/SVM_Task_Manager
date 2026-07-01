const fs = require('fs');

async function check() {
  const code = fs.readFileSync('app.js', 'utf8');
  const urlMatch = code.match(/SUPABASE_URL:\s*'(.*?)'/);
  const keyMatch = code.match(/SUPABASE_ANON_KEY:\s*'(.*?)'/);
  
  if (!urlMatch || !keyMatch) {
    console.error('Could not find credentials');
    return;
  }

  const url = urlMatch[1];
  const key = keyMatch[1];
  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json'
  };
  
  const teamRes = await fetch(`${url}/rest/v1/team?select=name,email`, { headers });
  const teamData = await teamRes.json();
  
  console.log('--- TEAM ---');
  if (Array.isArray(teamData)) {
    console.log(teamData.filter(t => t.name.toLowerCase().includes('sneha') || t.name.toLowerCase().includes('shivan')));
  } else {
    console.log('Team data error:', teamData);
  }

  const tasksRes = await fetch(`${url}/rest/v1/tasks?select=task_id,assigned_to`, { headers });
  const tasksData = await tasksRes.json();
  
  if (Array.isArray(tasksData)) {
    console.log('--- TASKS SNEHA ---');
    console.log(tasksData.filter(t => t.assigned_to && t.assigned_to.toLowerCase().includes('sneha')).length);
    
    const shivaniTasks = tasksData.filter(t => t.assigned_to && t.assigned_to.toLowerCase().includes('shivan'));
    console.log('--- TASKS SHIVANI ---');
    console.log(shivaniTasks.length + ' tasks found for shivani');
    console.log('Sample shivani tasks:', shivaniTasks.slice(0, 3));
  } else {
    console.log('Tasks data error:', tasksData);
  }
}

check().catch(console.error);
