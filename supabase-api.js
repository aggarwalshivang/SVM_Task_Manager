// =============================================
// SUPABASE API LAYER
// =============================================
function getTodayStr() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  const localDate = new Date(d.getTime() - (offset * 60 * 1000));
  return localDate.toISOString().substring(0, 10);
}

function getISOWeekNum(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

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

function isTaskPastGracePeriod(task) {
  if (!task.plannedDate) return false;
  const dueDate = getTaskDueDateTime(task.plannedDate, task.time);
  if (!dueDate) return false;
  
  const now = new Date();
  const gracePeriodMs = (task.taskType === 'daily') ? 0 : (24 * 60 * 60 * 1000); 
  return now.getTime() > (dueDate.getTime() + gracePeriodMs);
}

function calculateNextDate(currentDateStr, pattern) {
  if (!pattern || pattern === 'one-time') return null;
  
  let next = new Date(currentDateStr);
  if (isNaN(next.getTime())) next = new Date(); // Fallback to today

  if (pattern === 'daily') {
    next.setDate(next.getDate() + 1);
  } else if (pattern === 'weekly') {
    next.setDate(next.getDate() + 7);
  } else if (pattern.startsWith('interval:')) {
    const parts = pattern.split(':');
    const n = parseInt(parts[1]) || 1;
    const unit = parts[2];
    if (unit === 'days') next.setDate(next.getDate() + n);
    else if (unit === 'weeks') next.setDate(next.getDate() + n * 7);
    else if (unit === 'months') next.setMonth(next.getMonth() + n);
  } else if (pattern.startsWith('dayOfWeek:')) {
    const targetDay = parseInt(pattern.split(':')[1]);
    next.setDate(next.getDate() + 1);
    while (next.getDay() !== targetDay) {
      next.setDate(next.getDate() + 1);
    }
  } else if (pattern.startsWith('dayOfMonth:')) {
    const targetDay = parseInt(pattern.split(':')[1]);
    next.setMonth(next.getMonth() + 1);
    const lastDayOfMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(targetDay, lastDayOfMonth));
  } else if (pattern.startsWith('nthWeekday:')) {
    const parts = pattern.split(':');
    const n = parseInt(parts[1]);
    const dayOfWeek = parseInt(parts[2]);
    
    next.setMonth(next.getMonth() + 1);
    next.setDate(1);
    
    let count = 0;
    while (count < n) {
      if (next.getDay() === dayOfWeek) count++;
      if (count < n) next.setDate(next.getDate() + 1);
    }
  } else if (pattern.startsWith('yearly:')) {
    const parts = pattern.split(':')[1].split('-');
    const month = parseInt(parts[0]) - 1;
    const day = parseInt(parts[1]);
    next.setFullYear(next.getFullYear() + 1);
    next.setMonth(month);
    next.setDate(day);
  } else {
    next.setDate(next.getDate() + 1);
  }
  
  const offset = next.getTimezoneOffset();
  const localDate = new Date(next.getTime() - (offset * 60 * 1000));
  return localDate.toISOString().substring(0, 10);
}

async function supabaseApiFetch(action, params = {}) {
  const sb = getSupabase();

  switch (action) {

    case 'getTeam': {
      const { data, error } = await sb.from('team').select('name,role,active,email');
      if (error) throw new Error(error.message);
      return { success: true, data: data.map(r => ({ name: r.name, role: r.role, active: r.active, email: r.email })) };
    }

    case 'getTasks': {
      const user = params.user;
      const all = params.all === true || params.all === 'true';
      let q = sb.from('tasks').select('*');
      if (!all && user) q = q.eq('assigned_to', user);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const todayDate = getTodayStr();
      const rows = (data || []).map(r => ({
        taskId: r.task_id, taskName: r.task_name, assignedTo: r.assigned_to,
        taskType: (r.task_type || '').toLowerCase(), plannedDate: r.planned_date || '',
        completedDate: r.completed_date || '', status: (r.status || 'pending').toLowerCase(),
        weekNumber: r.week_number, points: r.points || 0, notes: r.notes || '',
        priority: r.priority || 'Medium', comments: r.comments || [],
        recurrence: r.recurrence || 'one-time', time: r.time || ''
      }));

      // Find task buddies
      let buddyFor = [];
      if (user && !all) {
        const todayStr = todayDate;
        const { data: leaves } = await sb.from('leaves').select('*').eq('status', 'approved').eq('task_buddy', user);
        buddyFor = (leaves || [])
          .filter(row => {
            const start = row.start_date || '';
            const end = row.end_date || '';
            return todayStr >= start && todayStr <= end;
          })
          .map(row => row.user_name);
      }

      const processedRows = [];
      for (const t of rows) {
        const tDate = (t.plannedDate || '').substring(0, 10);
        
        // 1. Lazy Rollover for Daily/Weekly tasks stuck in the past
        const isRecurring = (t.taskType === 'daily' || t.taskType === 'weekly' || (t.recurrence && t.recurrence !== 'one-time'));
        if (isRecurring && tDate < todayDate) {
          if (t.status === 'done' || t.status === 'missed' || t.status === 'overdue' || (t.status === 'pending' && isTaskPastGracePeriod(t))) {
            let effectivePattern = t.recurrence;
            if (!effectivePattern || effectivePattern === 'one-time') {
              if (t.taskType === 'daily') effectivePattern = 'daily';
              else if (t.taskType === 'weekly') effectivePattern = 'weekly';
            }
            
            let nextDate = calculateNextDate(t.plannedDate, effectivePattern);
            while (nextDate && nextDate < todayDate) {
              nextDate = calculateNextDate(nextDate, effectivePattern);
            }

            if (nextDate) {
              const curWeek = getISOWeekNum(new Date(nextDate));
              await sb.from('tasks').update({ planned_date: nextDate, completed_date: null, status: 'pending', week_number: curWeek, points: 0 }).eq('task_id', t.taskId);
              t.plannedDate = nextDate;
              t.completedDate = '';
              t.status = 'pending';
              t.weekNumber = curWeek;
              t.points = 0;
              syncToSheet('editTask', { taskId: t.taskId, plannedDate: nextDate, completedDate: '', status: 'pending', points: 0, weekNumber: curWeek });
            }
          }
        }

        // 2. Auto-mark pending tasks as missed/overdue if past grace period
        if (t.status === 'pending' && isTaskPastGracePeriod(t)) {
          const newStatus = (t.taskType === 'daily') ? 'missed' : 'overdue';
          const penaltyPoints = -10;
          await sb.from('tasks').update({ status: newStatus, points: penaltyPoints }).eq('task_id', t.taskId);
          t.status = newStatus;
          t.points = penaltyPoints;
          syncToSheet('editTask', { taskId: t.taskId, status: newStatus, points: penaltyPoints });
        }

        processedRows.push(t);
      }

      if (all) return { success: true, data: processedRows };
      return { success: true, data: processedRows.filter(t => {
        const isAssigned = user && t.assignedTo === user;
        const isBuddy = buddyFor.includes(t.assignedTo);
        if (!isAssigned && !isBuddy) return false;
        
        const d = (t.plannedDate || '').substring(0, 10);
        return d === todayDate || ['overdue','stuck','in-progress','missed'].includes(t.status);
      })};
    }

    case 'getScores': {
      const user = params.user;
      const curWeek = getISOWeekNum(new Date());
      const curYear = new Date().getFullYear();
      if (user) {
        const { data } = await sb.from('weekly_scores').select('*').eq('name', user).eq('week', curWeek).eq('year', curYear).maybeSingle();
        if (!data) return { success: true, data: { weekScore: 0, streak: 0, tasksAssigned: 0, tasksCompleted: 0, tasksLate: 0, tasksMissed: 0 } };
        return { success: true, data: { weekScore: data.score || 0, streak: 0, tasksAssigned: data.assigned || 0, tasksCompleted: data.completed || 0, tasksLate: data.late || 0, tasksMissed: data.missed || 0 } };
      }
      const { data: teamData } = await sb.from('team').select('name,role');
      const adminNames = (teamData || []).filter(r => r.role?.toLowerCase() === 'admin' || r.role?.toLowerCase() === 'process_coordinator').map(r => r.name);
      const { data: scores } = await sb.from('weekly_scores').select('*').eq('week', curWeek).eq('year', curYear);
      const { data: allScores } = await sb.from('weekly_scores').select('name,score');
      const overall = {};
      (allScores || []).forEach(r => { overall[r.name] = (overall[r.name] || 0) + (r.score || 0); });
      return { success: true, data: (scores || []).filter(r => !adminNames.includes(r.name)).map(r => ({
        name: r.name, weekNumber: r.week, year: r.year, tasksAssigned: r.assigned, tasksCompleted: r.completed,
        tasksLate: r.late, tasksMissed: r.missed, score: r.score, aiSummary: r.ai_summary || '',
        overallScore: overall[r.name] || 0, todayScore: 0, negativeToday: 0, negativeWeek: 0, negativeAllTime: 0
      }))};
    }

    case 'login': {
      const email = (params.email || '').toLowerCase().trim();
      const { data, error } = await sb.from('team').select('*').eq('email', email).maybeSingle();
      if (error || !data) return { success: false, error: 'Email not found in SVM records.' };
      if (!data.active) return { success: false, error: 'Account pending approval by Admin.' };
      const isSpecial = email === 'admin@saraswatividyamandir.com';
      const defaultPass = isSpecial ? 'Admin@12345' : 'Member@12345';
      const inputHash = await hashPassword(params.password || '');
      const defaultHash = await hashPassword(defaultPass);
      if (params.password === defaultPass || inputHash === data.password_hash) {
        if (params.password === defaultPass && data.password_hash !== defaultHash) {
          await sb.from('team').update({ password_hash: defaultHash }).eq('email', email);
        }
        return { success: true, data: { name: data.name, role: (data.role || 'member').toLowerCase(), email: data.email } };
      }
      return { success: false, error: 'Invalid password. Try using ' + defaultPass };
    }

    case 'signup':
    case 'registerMember': {
      const { name, email, role, password } = params;
      if (!name || !email || !password) return { success: false, error: 'Name, Email, and Password required' };
      const hash = await hashPassword(password);
      const { error } = await sb.from('team').insert({ name, email: email.toLowerCase().trim(), role: role || 'Member', active: false, password_hash: hash });
      if (error) return { success: false, error: error.message };
      syncToSheet('addMember', { name, email, role: role || 'Member', active: false });
      return { success: true };
    }

    case 'addMember': {
      const { name, email, role, active, password } = params;
      const isSpecial = (email || '').toLowerCase() === 'admin@saraswatividyamandir.com';
      const defPass = isSpecial ? 'Admin@12345' : 'Member@12345';
      const hash = await hashPassword(password || defPass);
      const { error } = await sb.from('team').insert({ name, email: (email || '').toLowerCase().trim(), role: role || 'Member', active: active !== undefined ? active : true, password_hash: hash });
      if (error) return { success: false, error: error.message };
      syncToSheet('addMember', params);
      return { success: true, data: { name } };
    }

    case 'removeMember': {
      const { name, transferTo } = params;
      if (transferTo) {
        await sb.from('tasks').update({ assigned_to: transferTo }).eq('assigned_to', name);
      }
      const { error } = await sb.from('team').delete().eq('name', name);
      if (error) return { success: false, error: error.message };
      syncToSheet('removeMember', params);
      return { success: true, data: { name } };
    }

    case 'approveMember': {
      const { email, decision } = params;
      if (decision === 'approve') {
        await sb.from('team').update({ active: true }).eq('email', email);
      } else {
        await sb.from('team').delete().eq('email', email);
      }
      syncToSheet('approveMember', params);
      return { success: true };
    }

    case 'completeTask': {
      const { taskId, user, completedDate } = params;
      const now = completedDate || new Date().toISOString();
      const { data: taskRows } = await sb.from('tasks').select('*').eq('task_id', taskId).maybeSingle();
      if (!taskRows) return { success: false, error: 'Task not found: ' + taskId };
      const plannedDate = (taskRows.planned_date || '').substring(0, 10);
      const today = getTodayStr();
      const taskType = (taskRows.task_type || '').toLowerCase();
      let basePoints = taskType === 'weekly' ? 30 : taskType === 'one-time' ? 15 : 10;
      const isShifted = (taskRows.notes || '').includes('[Shifted');
      const bonus = isShifted ? 5 : 0;
      let points = 0;
      if (plannedDate >= today) { points = basePoints + bonus; }
      else {
        const diff = Math.round((new Date(today) - new Date(plannedDate)) / 86400000);
        const f = basePoints / 10;
        points = (diff === 1 ? Math.round(5*f) : diff === 2 ? Math.round(2*f) : Math.round(f)) + bonus;
      }
      const finalPoints = (taskRows.points || 0) + points;
      const { error } = await sb.from('tasks').update({ status: 'done', completed_date: now, points: finalPoints }).eq('task_id', taskId);
      if (error) return { success: false, error: error.message };
      if (taskType === 'daily' || taskType === 'weekly') {
        const curWeek = getISOWeekNum(new Date());
        await sb.from('task_log').insert({ log_id: 'L' + Date.now(), task_id: taskId, task_name: taskRows.task_name, user_name: user, status: 'done', points, planned_date: plannedDate, completed_date: now, week_number: curWeek, year: new Date().getFullYear() });
      }
      syncToSheet('completeTask', { taskId, user, completedDate: now, points: finalPoints });
      return { success: true, data: { taskId, status: 'done', completedDate: now, points: finalPoints } };
    }

    case 'addTask': {
      const { taskName, assignedTo, taskType, plannedDate, notes, priority, recurrence, time } = params;
      if (!taskName || !assignedTo) return { success: false, error: 'taskName and assignedTo required' };
      const { data: existing } = await sb.from('tasks').select('task_id').order('task_id', { ascending: false }).limit(1);
      const lastId = existing?.[0]?.task_id || 'T000';
      const num = parseInt((lastId.match(/\d+/) || ['0'])[0]) + 1;
      const taskId = 'T' + String(num).padStart(3, '0');
      const curWeek = getISOWeekNum(new Date(plannedDate || new Date()));
      const { error } = await sb.from('tasks').insert({ task_id: taskId, task_name: taskName, assigned_to: assignedTo, task_type: taskType || 'other', planned_date: plannedDate || getTodayStr(), status: 'pending', week_number: curWeek, points: 0, notes: notes || '', priority: priority || 'Medium', comments: [], recurrence: recurrence || 'one-time', time: time || '' });
      if (error) return { success: false, error: error.message };
      syncToSheet('addTask', { taskId, taskName, assignedTo, taskType, plannedDate, notes, priority, recurrence, time });
      return { success: true, data: { taskId } };
    }

    case 'deleteTask': {
      const { taskId } = params;
      const { error } = await sb.from('tasks').delete().eq('task_id', taskId);
      if (error) return { success: false, error: error.message };
      syncToSheet('deleteTask', { taskId });
      return { success: true, data: { taskId } };
    }

    case 'editTask': {
      const { taskId, taskName, taskType, plannedDate, notes, priority, time, recurrence } = params;
      const upd = {};
      if (taskName) upd.task_name = taskName;
      if (taskType) upd.task_type = taskType;
      if (plannedDate) { upd.planned_date = plannedDate; upd.week_number = getISOWeekNum(new Date(plannedDate)); }
      if (notes !== undefined) upd.notes = notes;
      if (priority) upd.priority = priority;
      if (time !== undefined) upd.time = time;
      if (recurrence !== undefined) upd.recurrence = recurrence;
      const { error } = await sb.from('tasks').update(upd).eq('task_id', taskId);
      if (error) return { success: false, error: error.message };
      syncToSheet('editTask', params);
      return { success: true, data: { taskId } };
    }

    case 'shiftTask': {
      const { taskId, fromUser, newAssignee, shiftMode, shiftDays } = params;
      const upd = { assigned_to: newAssignee };
      const { data: t } = await sb.from('tasks').select('notes').eq('task_id', taskId).maybeSingle();
      if (!t) return { success: false, error: 'Task not found' };
      let curNotes = t.notes || '';
      if (shiftMode === 'temporary') {
        const d = new Date(); d.setDate(d.getDate() + (parseInt(shiftDays) || 1));
        const exp = d.toISOString().substring(0, 10);
        curNotes += `\n[TEMP_SHIFT:${fromUser}:${exp}] Transferred to ${newAssignee} until ${exp}`;
      } else {
        curNotes += `\n[Transferred permanently from ${fromUser} to ${newAssignee}]`;
      }
      upd.notes = curNotes;
      await sb.from('tasks').update(upd).eq('task_id', taskId);
      const penaltyId = 'P-' + Date.now().toString().substring(7);
      await sb.from('tasks').insert({ task_id: penaltyId, task_name: `Penalty: Transferred task to ${newAssignee}`, assigned_to: fromUser, task_type: 'penalty', planned_date: getTodayStr(), completed_date: new Date().toISOString(), status: 'done', week_number: getISOWeekNum(new Date()), points: -5, notes: `Original task: ${taskId}`, priority: 'High' });
      syncToSheet('shiftTask', params);
      return { success: true, data: { taskId, newAssignee } };
    }

    case 'updateTaskStatus': {
      const { taskId, status } = params;
      const { error } = await sb.from('tasks').update({ status }).eq('task_id', taskId);
      if (error) return { success: false, error: error.message };
      syncToSheet('updateTaskStatus', params);
      return { success: true };
    }

    case 'addTaskComment': {
      const { taskId, user, text } = params;
      const { data: t } = await sb.from('tasks').select('comments').eq('task_id', taskId).maybeSingle();
      if (!t) return { success: false, error: 'Task not found' };
      const comments = [...(t.comments || []), { user, text, timestamp: new Date().toISOString() }];
      await sb.from('tasks').update({ comments }).eq('task_id', taskId);
      syncToSheet('addTaskComment', params);
      return { success: true };
    }

    case 'adminPenalty': {
      const { memberName, amount, fromUser } = params;
      const penaltyId = 'P-' + Date.now().toString().substring(7);
      await sb.from('tasks').insert({ task_id: penaltyId, task_name: 'Penalty from Admin', assigned_to: memberName, task_type: 'penalty', planned_date: getTodayStr(), completed_date: new Date().toISOString(), status: 'done', week_number: getISOWeekNum(new Date()), points: Number(amount), notes: `Admin action by ${fromUser || 'Admin'}`, priority: 'High' });
      syncToSheet('adminPenalty', params);
      return { success: true, data: { memberName, amount } };
    }

    case 'adminTaskPenalty': {
      const { taskId, memberName, fromUser } = params;
      const { data: t } = await sb.from('tasks').select('task_name').eq('task_id', taskId).maybeSingle();
      if (!t) return { success: false, error: 'Task not found' };
      await sb.from('tasks').update({ status: 'pending', completed_date: null, points: 0 }).eq('task_id', taskId);
      const penaltyId = 'P-' + Date.now().toString().substring(7);
      await sb.from('tasks').insert({ task_id: penaltyId, task_name: `Penalty: Undone task "${t.task_name}" by ${fromUser || 'Admin'}`, assigned_to: memberName, task_type: 'penalty', planned_date: getTodayStr(), completed_date: new Date().toISOString(), status: 'done', week_number: getISOWeekNum(new Date()), points: -20, notes: `Task penalized: ${taskId}`, priority: 'High' });
      syncToSheet('adminTaskPenalty', params);
      return { success: true };
    }

    case 'requestLeave': {
      const { user, startDate, endDate, reason, taskBuddy } = params;
      const { error } = await sb.from('leaves').insert({ user_name: user, start_date: startDate, end_date: endDate, status: 'pending', reason: reason || '', task_buddy: taskBuddy || '' });
      if (error) return { success: false, error: error.message };
      syncToSheet('requestLeave', params);
      return { success: true };
    }

    case 'getLeaves': {
      let q = sb.from('leaves').select('*');
      if (params.user) q = q.eq('user_name', params.user);
      const { data, error } = await q;
      if (error) return { success: false, error: error.message };
      return { success: true, data: (data || []).map(r => ({ user: r.user_name, startDate: r.start_date, endDate: r.end_date, status: r.status, reason: r.reason, createdAt: r.created_at, taskBuddy: r.task_buddy })) };
    }

    case 'approveLeave': {
      const { user, createdAt, status } = params;
      await sb.from('leaves').update({ status }).eq('user_name', user).eq('created_at', createdAt);
      syncToSheet('approveLeave', params);
      return { success: true };
    }

    case 'sendBroadcast': {
      const { message, type } = params;
      const { error } = await sb.from('broadcasts').insert({ message, type: type || 'info' });
      if (error) return { success: false, error: error.message };
      syncToSheet('sendBroadcast', params);
      return { success: true };
    }

    case 'getLatestBroadcast': {
      const { data } = await sb.from('broadcasts').select('*').order('created_at', { ascending: false }).limit(1);
      if (!data || !data[0]) return { success: true, data: null };
      const diff = (Date.now() - new Date(data[0].created_at)) / 3600000;
      if (diff > 24) return { success: true, data: null };
      return { success: true, data: { message: data[0].message, type: data[0].type, createdAt: data[0].created_at } };
    }

    case 'getTests': {
      const { data, error } = await sb.from('tests').select('*');
      if (error) throw new Error(error.message);
      return { success: true, data: (data || []).map(r => ({ testId: r.test_id, testName: r.test_name, className: r.class_name, maxScore: r.max_score, type: r.type, heldOn: r.held_on, stages: r.stages || [], subject: r.subject || '', chapter: r.chapter || '', sheetLink: r.sheet_link || '', folderLink: r.folder_link || '', minScore: r.min_score ?? '', avgScore: r.avg_score ?? '' })) };
    }

    case 'getTestSettings': {
      const { data, error } = await sb.from('test_settings').select('*').order('stage_id', { ascending: true });
      if (error || !data || data.length === 0) return apiFetchSheet('getTestSettings', params, 'GET');
      return {
        success: true,
        data: data.map(r => {
          // Support both plain label strings AND enriched JSON labels (link/hidden packed in)
          let label = r.label || '';
          let link = r.link || '';
          let hidden = r.hidden || false;
          try {
            const parsed = JSON.parse(label);
            // If label is a JSON object with a _label key it's an enriched record
            if (parsed && typeof parsed === 'object' && parsed._label !== undefined) {
              label = parsed._label;
              link = parsed._link || link;
              hidden = parsed._hidden ?? hidden;
            }
          } catch (e) { /* plain string label — use as-is */ }
          return { id: r.stage_id, label, offset: r.offset_days, doer: r.doer, type: r.type || 'Sheet', link, hidden };
        })
      };
    }

    case 'addTest': {
      const { testName, className, maxScore, heldOn, type, stages, subject, chapter, sheetLink, folderLink, minScore, avgScore } = params;
      const testId = 'TEST' + Date.now();
      const { error } = await sb.from('tests').insert({ test_id: testId, test_name: testName, class_name: className, max_score: maxScore, type: type || 'Sheet', held_on: heldOn, stages: stages || [], subject: subject || '', chapter: chapter || '', sheet_link: sheetLink || '', folder_link: folderLink || '', min_score: minScore ?? null, avg_score: avgScore ?? null });
      if (error) return { success: false, error: error.message };
      syncToSheet('addTest', { ...params, testId });
      return { success: true, data: { testId } };
    }

    case 'updateTestStage': {
      const { testId, stageId, status, actualDate, doneBy, doneAt } = params;
      const { data: t } = await sb.from('tests').select('stages').eq('test_id', testId).maybeSingle();
      if (!t) return { success: false, error: 'Test not found' };
      const stages = [...(t.stages || [])];
      const idx = stages.findIndex(s => s.id === stageId);
      const upd = { id: stageId, status, actualDate, doneBy: doneBy || '', doneAt: doneAt || '' };
      if (idx !== -1) stages[idx] = { ...stages[idx], ...upd }; else stages.push(upd);
      await sb.from('tests').update({ stages }).eq('test_id', testId);
      syncToSheet('updateTestStage', params);
      return { success: true };
    }

    case 'editTestDetails': {
      const { testId, testName, className, maxScore, heldOn, type, subject, chapter, sheetLink, folderLink, minScore, avgScore, stages } = params;
      const upd = {};
      if (testName) upd.test_name = testName;
      if (className) upd.class_name = className;
      if (maxScore) upd.max_score = maxScore;
      if (heldOn) upd.held_on = heldOn;
      if (type) upd.type = type;
      if (stages) upd.stages = stages;
      upd.subject = subject || ''; upd.chapter = chapter || '';
      upd.sheet_link = sheetLink || ''; upd.folder_link = folderLink || '';
      upd.min_score = minScore ?? null; upd.avg_score = avgScore ?? null;
      const { error } = await sb.from('tests').update(upd).eq('test_id', testId);
      if (error) return { success: false, error: error.message };
      syncToSheet('editTestDetails', params);
      return { success: true };
    }

    case 'deleteTestTracker': {
      const { testId } = params;
      const { error } = await sb.from('tests').delete().eq('test_id', testId);
      if (error) return { success: false, error: error.message };
      syncToSheet('deleteTestTracker', params);
      return { success: true };
    }

    case 'updateTestSettings': {
      const { settings } = params;

      // Always write only the guaranteed base columns that exist in every deployment.
      // link and hidden are encoded into the label field as enriched JSON so no ALTER TABLE is needed.
      const toInsert = (settings || []).map(s => {
        // Encode link/hidden into label as {_label, _link, _hidden} JSON
        // so we never touch columns that may not exist in the schema.
        const hasExtras = s.link || s.hidden;
        const labelVal = hasExtras
          ? JSON.stringify({ _label: s.label, _link: s.link || '', _hidden: !!s.hidden })
          : s.label;
        return {
          stage_id: s.id,
          label: labelVal,
          offset_days: s.offset,
          doer: s.doer,
          type: s.type || 'Sheet'
        };
      });

      // Wipe existing rows then re-insert — both steps in a safe sequential flow
      const { error: delError } = await sb.from('test_settings').delete().neq('stage_id', 0);
      if (delError) return { success: false, error: 'Failed to clear settings: ' + delError.message };

      if (toInsert.length > 0) {
        const { error: insError } = await sb.from('test_settings').insert(toInsert);
        if (insError) return { success: false, error: 'Failed to save settings: ' + insError.message };
      }

      syncToSheet('updateTestSettings', params);
      return { success: true };
    }

    case 'verifyAndResetPassword': {
      const { email, otp, newPassword } = params;
      const normalizedEmail = (email || '').toLowerCase().trim();
      const { data: codeRow } = await sb.from('reset_codes').select('*').eq('email', normalizedEmail).eq('otp', otp).maybeSingle();
      if (!codeRow) return { success: false, error: 'Invalid or expired verification code.' };
      if (new Date(codeRow.expires_at) < new Date()) return { success: false, error: 'Code expired.' };
      const hash = await hashPassword(newPassword);
      await sb.from('team').update({ password_hash: hash }).eq('email', normalizedEmail);
      await sb.from('reset_codes').delete().eq('id', codeRow.id);
      return { success: true, message: 'Password updated successfully! You can now log in.' };
    }

    case 'requestTaskChange': {
      const { taskId, type, newData, requestedBy } = params;
      const { error } = await sb.from('modifications').insert({ task_id: taskId, type, new_data: newData || {}, requested_by: requestedBy, status: 'pending' });
      if (error) return { success: false, error: error.message };
      return { success: true };
    }

    case 'getPendingModifications': {
      const { data } = await sb.from('modifications').select('*').eq('status', 'pending');
      const { data: tasks } = await sb.from('tasks').select('task_id,task_name');
      const taskMap = Object.fromEntries((tasks || []).map(t => [t.task_id, t.task_name]));
      return { success: true, data: (data || []).map(r => ({ id: r.id, taskId: r.task_id, taskName: taskMap[r.task_id] || 'Unknown Task', type: r.type, newData: r.new_data, requestedBy: r.requested_by, requestedAt: r.requested_at })) };
    }

    case 'approveTaskChange': {
      const { requestId, decision } = params;
      await sb.from('modifications').update({ status: decision === 'approved' ? 'approved' : 'rejected' }).eq('id', requestId);
      if (decision === 'approved') {
        const { data: mod } = await sb.from('modifications').select('*').eq('id', requestId).maybeSingle();
        if (mod) {
          if (mod.type === 'delete') await supabaseApiFetch('deleteTask', { taskId: mod.task_id });
          else if (mod.type === 'edit') await supabaseApiFetch('editTask', { taskId: mod.task_id, ...mod.new_data });
          else if (mod.type === 'shift') await supabaseApiFetch('shiftTask', { taskId: mod.task_id, ...mod.new_data });
        }
      }
      return { success: true };
    }

    case 'getTeamPerformance': {
      const { data } = await sb.from('weekly_scores').select('week,year,assigned,completed');
      const perf = {};
      (data || []).forEach(r => {
        const key = `W${r.week}-${r.year}`;
        if (!perf[key]) perf[key] = { week: r.week, year: r.year, totalAssigned: 0, totalCompleted: 0 };
        perf[key].totalAssigned += r.assigned || 0;
        perf[key].totalCompleted += r.completed || 0;
      });
      return { success: true, data: Object.values(perf).sort((a, b) => a.year !== b.year ? a.year - b.year : a.week - b.week) };
    }

    case 'cleanupTasks': {
      const threshold = new Date(Date.now() - 30 * 86400000).toISOString().substring(0, 10);
      const { data: old } = await sb.from('tasks').select('task_id,planned_date,status');
      const toDelete = (old || []).filter(r => r.planned_date && r.planned_date < threshold && (r.status === 'done' || r.status === 'missed')).map(r => r.task_id);
      if (toDelete.length > 0) await sb.from('tasks').delete().in('task_id', toDelete);
      return { success: true, count: toDelete.length };
    }

    default:
      return { success: false, error: 'Unknown action: ' + action };
  }
}
