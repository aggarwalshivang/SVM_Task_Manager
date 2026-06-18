// =============================================
// SUPABASE API LAYER
// =============================================
function getTodayStr() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  const localDate = new Date(d.getTime() - (offset * 60 * 1000));
  return localDate.toISOString().substring(0, 10);
}

function parseTaskMetadata(notes) {
  const defaultMeta = {
    dueDate: null,
    slips: 0,
    quantity_ok: true,
    cost_ok: true,
    quality_ok: true,
    reason: ''
  };
  if (!notes) return defaultMeta;
  const match = notes.match(/\[Metadata:\s*({.*?})\]/);
  if (match) {
    try {
      return { ...defaultMeta, ...JSON.parse(match[1]) };
    } catch (e) {
      console.error('Failed to parse task metadata:', e);
    }
  }
  return defaultMeta;
}

function updateTaskMetadataInNotes(notes, metaUpdates) {
  const currentMeta = parseTaskMetadata(notes);
  const updatedMeta = { ...currentMeta, ...metaUpdates };
  const cleanNotes = notes ? notes.replace(/\[Metadata:\s*({.*?})\]\s*\n?/, '').trim() : '';
  const metaStr = `[Metadata: ${JSON.stringify(updatedMeta)}]`;
  return cleanNotes ? `${cleanNotes}\n${metaStr}` : metaStr;
}

function parseWeeklyScoresSummary(aiSummary) {
  const defaultData = {
    target: 0,
    next_target: 0,
    summary: '',
    commitment_checked: false
  };
  if (!aiSummary) return defaultData;
  const trimmed = aiSummary.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      return { ...defaultData, ...JSON.parse(trimmed) };
    } catch (e) {
      console.error('Failed to parse weekly scores summary JSON:', e);
    }
  }
  return { ...defaultData, summary: aiSummary };
}

async function getLeaveBuddyForDate(sb, user, dateStr) {
  if (!user || !dateStr) return null;
  const { data, error } = await sb.from('leaves')
    .select('task_buddy')
    .eq('user_name', user)
    .eq('status', 'approved')
    .lte('start_date', dateStr)
    .gte('end_date', dateStr)
    .limit(1);
  
  if (data && data.length > 0 && data[0].task_buddy) {
    return data[0].task_buddy;
  }
  return null;
}

function parseNum(val) {
  if (val === undefined || val === null) return null;
  const str = String(val).trim();
  if (str === '') return null;
  const num = Number(str);
  return isNaN(num) ? null : num;
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
    if (next.getDay() === 0) {
      next.setDate(next.getDate() + 1);
    }
  } else if (pattern === 'weekly') {
    next.setDate(next.getDate() + 7);
  } else if (pattern.startsWith('interval:')) {
    const parts = pattern.split(':');
    const n = parseInt(parts[1]) || 1;
    const unit = parts[2];
    if (unit === 'days') {
      next.setDate(next.getDate() + n);
      if (n === 1 && next.getDay() === 0) {
        next.setDate(next.getDate() + 1);
      }
    }
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

async function _supabaseApiFetchInner(action, params = {}) {
  const sb = getSupabase();

  switch (action) {

    case 'getTeam': {
      const { data, error } = await sb.from('team').select('name,role,active,email');
      if (error) throw new Error(error.message);
      return { success: true, data: data.map(r => ({ name: r.name, role: r.role, active: r.active, email: r.email })) };
    }

    case 'getAuditLogs': {
      const { data, error } = await sb.from('modifications')
        .select('*')
        .eq('status', 'audit')
        .order('requested_at', { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return { success: true, data };
    }

    case 'getTasks': {
      const user = params.user;
      const all = params.all === true || params.all === 'true';
      let q = sb.from('tasks').select('*');
      if (!all && user) q = q.eq('assigned_to', user);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const todayDate = getTodayStr();
      const rows = (data || []).map(r => {
        const meta = parseTaskMetadata(r.notes);
        return {
          taskId: r.task_id, taskName: r.task_name, assignedTo: r.assigned_to,
          taskType: (r.task_type || '').toLowerCase(), plannedDate: r.planned_date || '',
          completedDate: r.completed_date || '', status: (r.status || 'pending').toLowerCase(),
          weekNumber: r.week_number, points: r.points || 0, notes: r.notes || '',
          priority: r.priority || 'Medium', comments: r.comments || [],
          recurrence: r.recurrence || 'one-time', time: r.time || '',
          dueDate: meta.dueDate || r.planned_date || '',
          slips: meta.slips || 0,
          quantity_ok: meta.quantity_ok !== false,
          cost_ok: meta.cost_ok !== false,
          quality_ok: meta.quality_ok !== false,
          reason: meta.reason || ''
        };
      });

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
              let newAssignee = t.assignedTo;
              let newNotes = t.notes || '';

              let originalOwner = null;
              const ownerMatch = newNotes.match(/\[OriginalOwner:\s*([^\]]+)\]/);
              if (ownerMatch) {
                originalOwner = ownerMatch[1].trim();
              }

              if (originalOwner) {
                const buddyOnNextDate = await getLeaveBuddyForDate(sb, originalOwner, nextDate);
                if (buddyOnNextDate) {
                  newAssignee = buddyOnNextDate;
                } else {
                  newAssignee = originalOwner;
                  newNotes = newNotes.replace(/\[OriginalOwner:\s*[^\]]+\]\s*\n?/, '').trim();
                }
              } else {
                const buddyOnNextDate = await getLeaveBuddyForDate(sb, t.assignedTo, nextDate);
                if (buddyOnNextDate) {
                  newAssignee = buddyOnNextDate;
                  newNotes = (newNotes + `\n[OriginalOwner: ${t.assignedTo}]`).trim();
                }
              }

              const rolloverNotes = updateTaskMetadataInNotes(newNotes, {
                dueDate: nextDate,
                slips: 0,
                quantity_ok: true,
                cost_ok: true,
                quality_ok: true,
                reason: ''
              });

              await sb.from('tasks').update({ 
                planned_date: nextDate, 
                completed_date: null, 
                status: 'pending', 
                week_number: curWeek, 
                points: 0,
                assigned_to: newAssignee,
                notes: rolloverNotes
              }).eq('task_id', t.taskId);

              t.plannedDate = nextDate;
              t.completedDate = '';
              t.status = 'pending';
              t.weekNumber = curWeek;
              t.points = 0;
              t.assignedTo = newAssignee;
              t.notes = rolloverNotes;

              syncToSheet('editTask', { 
                taskId: t.taskId, 
                plannedDate: nextDate, 
                completedDate: '', 
                status: 'pending', 
                points: 0, 
                weekNumber: curWeek,
                assignedTo: newAssignee,
                notes: rolloverNotes
              });
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
      const allDates = params.allDates === true || params.allDates === 'true';
      return { success: true, data: processedRows.filter(t => {
        const isAssigned = user && t.assignedTo === user;
        const isBuddy = buddyFor.includes(t.assignedTo);
        if (!isAssigned && !isBuddy) return false;
        
        if (allDates) return true;
        
        const d = (t.plannedDate || '').substring(0, 10);
        return d === todayDate || ['overdue','stuck','in-progress','missed'].includes(t.status);
      })};
    }

    case 'getScores': {
      const user = params.user;
      const curWeek = getISOWeekNum(new Date());
      const curYear = new Date().getFullYear();

      if (user) {
        // Dynamic current week tasks for this user
        const { data: userWeekTasks } = await sb.from('tasks').select('*').eq('assigned_to', user).eq('week_number', curWeek);
        const todayStr = getTodayStr();

        let total_tasks = 0;
        let not_done_count = 0;
        let late_count = 0;
        let on_time_count = 0;

        (userWeekTasks || []).forEach(t => {
          if (t.task_type !== 'penalty') {
            total_tasks++;
            const meta = parseTaskMetadata(t.notes);
            if (t.status === 'done') {
              if ((meta.slips || 0) > 0) {
                late_count++;
              } else {
                on_time_count++;
              }
            } else {
              not_done_count++;
            }
          }
        });

        const wnd = total_tasks > 0 ? Math.round((not_done_count / total_tasks) * -100) : 0;
        const wnd_on_time = total_tasks > 0 ? Math.round(((not_done_count + late_count) / total_tasks) * -100) : 0;

        // Fallback or merge with database row if present
        let target = 0;
        let next_target = 0;
        let summaryText = '';

        const { data: dbRow } = await sb.from('weekly_scores').select('*').eq('name', user).eq('week', curWeek).eq('year', curYear).maybeSingle();
        if (dbRow) {
          const parsed = parseWeeklyScoresSummary(dbRow.ai_summary);
          target = parsed.target || 0;
          next_target = parsed.next_target || 0;
          summaryText = parsed.summary || '';
        } else {
          // Look up previous week for target
          const prevWeek = curWeek === 1 ? 52 : curWeek - 1;
          const prevYear = curWeek === 1 ? curYear - 1 : curYear;
          const { data: prevRow } = await sb.from('weekly_scores').select('*').eq('name', user).eq('week', prevWeek).eq('year', prevYear).maybeSingle();
          if (prevRow) {
            const parsedPrev = parseWeeklyScoresSummary(prevRow.ai_summary);
            target = parsedPrev.next_target || 0;
          }
        }

        return {
          success: true,
          data: {
            weekScore: wnd_on_time, // Score B (default)
            score_a: wnd,
            score_b: wnd_on_time,
            streak: 0,
            tasksAssigned: total_tasks,
            tasksCompleted: on_time_count + late_count,
            tasksLate: late_count,
            tasksMissed: not_done_count,
            target,
            next_target,
            aiSummary: {
              summary: summaryText,
              commitment_checked: dbRow ? (parseWeeklyScoresSummary(dbRow.ai_summary).commitment_checked || false) : false
            }
          }
        };
      }

      const { data: teamData } = await sb.from('team').select('name,role');
      const activeMembers = (teamData || []).filter(r => {
        const role = r.role?.toLowerCase();
        return role !== 'admin' && role !== 'process_coordinator';
      });

      // Fetch all tasks for the current week to calculate dynamic scores
      const { data: weekTasks } = await sb.from('tasks').select('*').eq('week_number', curWeek);

      // Fetch all historical scores to calculate all-time scores
      const { data: allScores } = await sb.from('weekly_scores').select('name,score');
      const allScoresMap = {};
      (allScores || []).forEach(r => {
        if (!allScoresMap[r.name]) allScoresMap[r.name] = [];
        allScoresMap[r.name].push(r.score || 0);
      });

      // Fetch all weekly scores for current week in batch
      const { data: currentWeekScores } = await sb.from('weekly_scores')
        .select('*')
        .eq('week', curWeek)
        .eq('year', curYear);
      const curScoresMap = Object.fromEntries((currentWeekScores || []).map(r => [r.name, r]));

      // Fetch all weekly scores for previous week in batch
      const prevWeek = curWeek === 1 ? 52 : curWeek - 1;
      const prevYear = curWeek === 1 ? curYear - 1 : curYear;
      const { data: prevWeekScores } = await sb.from('weekly_scores')
        .select('*')
        .eq('week', prevWeek)
        .eq('year', prevYear);
      const prevScoresMap = Object.fromEntries((prevWeekScores || []).map(r => [r.name, r]));

      const todayStr = getTodayStr();

      const scores = activeMembers.map(member => {
        const name = member.name;
        
        let total_tasks = 0;
        let not_done_count = 0;
        let late_count = 0;
        let on_time_count = 0;

        // Dynamic current week aggregates
        (weekTasks || []).forEach(t => {
          if (t.assigned_to === name) {
            if (t.task_type !== 'penalty') {
              total_tasks++;
              const meta = parseTaskMetadata(t.notes);
              if (t.status === 'done') {
                if ((meta.slips || 0) > 0) {
                  late_count++;
                } else {
                  on_time_count++;
                }
              } else {
                not_done_count++;
              }
            }
          }
        });

        const wnd = total_tasks > 0 ? Math.round((not_done_count / total_tasks) * -100) : 0;
        const wnd_on_time = total_tasks > 0 ? Math.round(((not_done_count + late_count) / total_tasks) * -100) : 0;

        // Today's not done tasks
        let todayNotDone = 0;
        (weekTasks || []).forEach(t => {
          if (t.assigned_to === name && t.task_type !== 'penalty') {
            const plannedDateStr = t.planned_date ? t.planned_date.substring(0, 10) : '';
            if (plannedDateStr === todayStr && t.status !== 'done') {
              todayNotDone++;
            }
          }
        });

        // Resolve target and next_target
        let target = 0;
        let next_target = 0;
        let summaryText = '';

        const dbRow = curScoresMap[name];
        if (dbRow) {
          const parsed = parseWeeklyScoresSummary(dbRow.ai_summary);
          target = parsed.target || 0;
          next_target = parsed.next_target || 0;
          summaryText = parsed.summary || '';
        } else {
          const prevRow = prevScoresMap[name];
          if (prevRow) {
            const parsedPrev = parseWeeklyScoresSummary(prevRow.ai_summary);
            target = parsedPrev.next_target || 0;
          }
        }

        // Cumulative overall score (average of weekly scores)
        const memberPastScores = allScoresMap[name] || [];
        const allMemberScores = [...memberPastScores, wnd_on_time];
        const overallScore = allMemberScores.length > 0
          ? Math.round(allMemberScores.reduce((sum, val) => sum + val, 0) / allMemberScores.length)
          : 0;

        return {
          name,
          weekNumber: curWeek,
          year: curYear,
          tasksAssigned: total_tasks,
          tasksCompleted: on_time_count + late_count,
          tasksLate: late_count,
          tasksMissed: not_done_count,
          score: wnd_on_time, // default to Score B
          score_a: wnd,
          score_b: wnd_on_time,
          target,
          next_target,
          aiSummary: {
            summary: summaryText,
            commitment_checked: dbRow ? (parseWeeklyScoresSummary(dbRow.ai_summary).commitment_checked || false) : false
          },
          overallScore,
          todayScore: todayNotDone > 0 ? -todayNotDone : 0,
          negativeToday: todayNotDone,
          negativeWeek: not_done_count + late_count,
          negativeAllTime: 0 // Not used under new percentage averages
        };
      });

      return { success: true, data: scores };
    }

    case 'sendResetOTP': {
      const email = (params.email || '').toLowerCase().trim();
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      
      await sb.from('reset_codes').delete().eq('email', email);
      const { error } = await sb.from('reset_codes').insert([{ email, otp, expires_at: expires }]);
      if (error) return { success: false, error: 'Failed to generate OTP.' };

      // Async email dispatch
      fetch(CONFIG.API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'sendEmail',
          to: email,
          subject: 'SVM Task Tracker - Verification Code',
          text: `Your verification code to reset your password is: ${otp}\n\nThis code will expire in 10 minutes.\n\nRegards,\nSVM Team`
        })
      }).catch(console.error);

      return { success: true, message: 'Verification code sent to your email.' };
    }

    case 'verifyAndResetPassword': {
      const email = (params.email || '').toLowerCase().trim();
      const { otp, newPassword } = params;
      if (!email || !otp || !newPassword) return { success: false, error: 'All fields required.' };

      const { data: codes, error: codeErr } = await sb.from('reset_codes').select('*').eq('email', email);
      if (codeErr || !codes || codes.length === 0) return { success: false, error: 'No active reset request found. Request a new code.' };

      const record = codes.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
      if (record.otp !== otp) return { success: false, error: 'Invalid verification code.' };
      if (new Date(record.expires_at) < new Date()) return { success: false, error: 'Verification code expired.' };

      const hash = await hashPassword(newPassword);
      const { error: updateErr } = await sb.from('team').update({ password_hash: hash }).eq('email', email);
      if (updateErr) return { success: false, error: 'Failed to update password.' };

      await sb.from('reset_codes').delete().eq('email', email);
      return { success: true, message: 'Password updated successfully! You can now log in.' };
    }

    case 'forgotPassword': {
      const email = (params.email || '').toLowerCase().trim();
      const { data, error } = await sb.from('team').select('*').eq('email', email).maybeSingle();
      if (error || !data) return { success: false, error: 'This email is not registered in SVM.' };

      const defaultPass = 'T9#vQ2!mL7@xR4$kP8^nW3&zF6*';
      const hash = await hashPassword(defaultPass);

      await sb.from('team').update({ password_hash: hash }).eq('email', email);

      // Async email dispatch
      fetch(CONFIG.API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'sendEmail',
          to: email,
          subject: 'SVM Task Tracker - Password Reset',
          text: `Hello ${data.name},\n\nYour SVM Task Tracker password has been reset to the default:\n\nPassword: ${defaultPass}\n\nYou can now log in using this password.\n\nRegards,\nSVM Team`
        })
      }).catch(console.error);

      return { success: true, message: `Success! Your password is now ${defaultPass}. An email has been sent to you.` };
    }

    case 'resetAllPasswords': {
      const fromUser = (params.fromUser || '').toLowerCase().trim();
      if (fromUser !== 'admin' && fromUser !== 'admin@saraswatividyamandir.com') {
        return { success: false, error: 'Unauthorized' };
      }

      const { data: allUsers, error } = await sb.from('team').select('*');
      if (error || !allUsers) return { success: false, error: 'Failed to fetch team' };

      for (const u of allUsers) {
        const defPass = 'T9#vQ2!mL7@xR4$kP8^nW3&zF6*';
        const hash = await hashPassword(defPass);
        await sb.from('team').update({ password_hash: hash }).eq('email', u.email);
      }
      return { success: true, message: 'All passwords reset to defaults in Supabase.' };
    }

    case 'login': {
      const email = (params.email || '').toLowerCase().trim();
      const { data, error } = await sb.from('team').select('*').eq('email', email).maybeSingle();
      if (error || !data) return { success: false, error: 'Email not found in SVM records.' };
      if (!data.active) return { success: false, error: 'Account pending approval by Admin.' };
      
      if (params.password === 'T9#vQ2!mL7@xR4$kP8^nW3&zF6*') {
        return { success: true, requires2FA: false, data: { name: data.name, role: (data.role || 'member').toLowerCase(), email: data.email } };
      }

      const inputHash = await hashPassword(params.password || '');
      if (inputHash === data.password_hash) {
        // Generate and send OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        
        await sb.from('reset_codes').delete().eq('email', email);
        const { error: otpError } = await sb.from('reset_codes').insert([{ email, otp, expires_at: expires }]);
        if (otpError) return { success: false, error: 'Failed to generate 2FA OTP.' };

        // Async email dispatch
        fetch(CONFIG.API_URL, {
          method: 'POST',
          body: JSON.stringify({
            action: 'sendEmail',
            to: email,
            subject: 'SVM Task Tracker - Login Verification Code',
            text: `Your login verification code is: ${otp}\n\nThis code will expire in 10 minutes.\n\nRegards,\nSVM Team`
          })
        }).catch(console.error);

        return { success: true, requires2FA: true, email: data.email };
      }
      return { success: false, error: 'Invalid password.' };
    }

    case 'verifyLoginOTP': {
      const email = (params.email || '').toLowerCase().trim();
      const otp = params.otp;

      const { data: codes, error: codeErr } = await sb.from('reset_codes').select('*').eq('email', email);
      if (codeErr || !codes || codes.length === 0) return { success: false, error: 'No active login request found. Please login again.' };

      const record = codes.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
      if (record.otp !== otp) return { success: false, error: 'Invalid verification code.' };
      if (new Date(record.expires_at) < new Date()) return { success: false, error: 'Verification code expired.' };

      await sb.from('reset_codes').delete().eq('email', email);

      const { data, error } = await sb.from('team').select('*').eq('email', email).maybeSingle();
      if (error || !data) return { success: false, error: 'User not found.' };

      return { success: true, data: { name: data.name, role: (data.role || 'member').toLowerCase(), email: data.email } };
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
      const defPass = 'T9#vQ2!mL7@xR4$kP8^nW3&zF6*';
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
      const { taskId, user, completedDate, reason, quantity_ok, cost_ok, quality_ok } = params;
      const now = completedDate || new Date().toISOString();
      const { data: taskRows } = await sb.from('tasks').select('*').eq('task_id', taskId).maybeSingle();
      if (!taskRows) return { success: false, error: 'Task not found: ' + taskId };
      
      const currentNotes = taskRows.notes || '';
      const meta = parseTaskMetadata(currentNotes);
      const updatedNotes = updateTaskMetadataInNotes(currentNotes, {
        dueDate: meta.dueDate || taskRows.planned_date || '',
        slips: meta.slips || 0,
        quantity_ok: quantity_ok !== false,
        cost_ok: cost_ok !== false,
        quality_ok: quality_ok !== false,
        reason: reason || ''
      });

      const { error } = await sb.from('tasks').update({ 
        status: 'done', 
        completed_date: now, 
        points: 0,
        notes: updatedNotes
      }).eq('task_id', taskId);
      if (error) return { success: false, error: error.message };

      const taskType = (taskRows.task_type || '').toLowerCase();
      if (taskType === 'daily' || taskType === 'weekly') {
        const curWeek = getISOWeekNum(new Date());
        await sb.from('task_log').insert({ 
          log_id: 'L' + Date.now(), 
          task_id: taskId, 
          task_name: taskRows.task_name, 
          user_name: user, 
          status: 'done', 
          points: 0, 
          planned_date: taskRows.planned_date, 
          completed_date: now, 
          week_number: curWeek, 
          year: new Date().getFullYear() 
        });
      }
      syncToSheet('editTask', { taskId, notes: updatedNotes, status: 'done', completedDate: now, points: 0 });
      return { success: true, data: { taskId, status: 'done', completedDate: now, points: 0, notes: updatedNotes } };
    }

    case 'addTask': {
      const { taskName, assignedTo, taskType, plannedDate, notes, priority, recurrence, time } = params;
      if (!taskName || !assignedTo) return { success: false, error: 'taskName and assignedTo required' };
      const { data: existing } = await sb.from('tasks').select('task_id').order('task_id', { ascending: false }).limit(1);
      const lastId = existing?.[0]?.task_id || 'T000';
      const num = parseInt((lastId.match(/\d+/) || ['0'])[0]) + 1;
      const taskId = 'T' + String(num).padStart(3, '0');
      
      let finalPlannedDate = plannedDate || getTodayStr();
      if (taskType === 'daily') {
        const parts = finalPlannedDate.split('-').map(Number);
        if (parts.length === 3) {
          const [yr, mo, dy] = parts;
          const d = new Date(yr, mo - 1, dy);
          if (d.getDay() === 0) {
            d.setDate(d.getDate() + 1);
            const offset = d.getTimezoneOffset();
            const localDate = new Date(d.getTime() - (offset * 60 * 1000));
            finalPlannedDate = localDate.toISOString().substring(0, 10);
          }
        }
      }

      const curWeek = getISOWeekNum(new Date(finalPlannedDate));
      let finalAssignedTo = assignedTo;
      let finalNotes = notes || '';
      const buddyOnDate = await getLeaveBuddyForDate(sb, assignedTo, finalPlannedDate);
      if (buddyOnDate) {
        finalAssignedTo = buddyOnDate;
        finalNotes = (finalNotes + `\n[OriginalOwner: ${assignedTo}]`).trim();
      }

      const notesWithMeta = updateTaskMetadataInNotes(finalNotes, {
        dueDate: finalPlannedDate,
        slips: 0,
        quantity_ok: true,
        cost_ok: true,
        quality_ok: true,
        reason: ''
      });

      const { error } = await sb.from('tasks').insert({ 
        task_id: taskId, 
        task_name: taskName, 
        assigned_to: finalAssignedTo, 
        task_type: taskType || 'other', 
        planned_date: finalPlannedDate, 
        status: 'pending', 
        week_number: curWeek, 
        points: 0, 
        notes: notesWithMeta, 
        priority: priority || 'Medium', 
        comments: [], 
        recurrence: recurrence || 'one-time', 
        time: time || '' 
      });
      if (error) return { success: false, error: error.message };
      syncToSheet('addTask', { 
        taskId, 
        taskName, 
        assignedTo: finalAssignedTo, 
        taskType, 
        plannedDate: finalPlannedDate, 
        notes: notesWithMeta, 
        priority, 
        recurrence, 
        time 
      });
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
      const { data: currentTask } = await sb.from('tasks').select('*').eq('task_id', taskId).maybeSingle();
      if (!currentTask) return { success: false, error: 'Task not found: ' + taskId };

      const currentNotes = currentTask.notes || '';
      const meta = parseTaskMetadata(currentNotes);
      let newNotes = notes !== undefined ? notes : currentNotes;
      let slips = meta.slips || 0;
      let dueDate = meta.dueDate || currentTask.planned_date || '';

      if (plannedDate && plannedDate !== currentTask.planned_date) {
        if (plannedDate > currentTask.planned_date) {
          slips += 1;
        }
      }

      const updatedNotes = updateTaskMetadataInNotes(newNotes, {
        dueDate,
        slips,
        quantity_ok: meta.quantity_ok !== false,
        cost_ok: meta.cost_ok !== false,
        quality_ok: meta.quality_ok !== false,
        reason: meta.reason || ''
      });

      const upd = {};
      if (taskName) upd.task_name = taskName;
      if (taskType) upd.task_type = taskType;
      if (plannedDate) { 
        upd.planned_date = plannedDate; 
        upd.week_number = getISOWeekNum(new Date(plannedDate)); 
      }
      upd.notes = updatedNotes;
      if (priority) upd.priority = priority;
      if (time !== undefined) upd.time = time;
      if (recurrence !== undefined) upd.recurrence = recurrence;

      const { error } = await sb.from('tasks').update(upd).eq('task_id', taskId);
      if (error) return { success: false, error: error.message };

      syncToSheet('editTask', { ...params, notes: updatedNotes });
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
      const { error } = await sb.from('leaves').update({ status }).eq('user_name', user).eq('created_at', createdAt);
      if (error) throw new Error(error.message);

      if (status === 'approved') {
        const { data: leave } = await sb.from('leaves')
          .select('start_date, end_date, task_buddy')
          .eq('user_name', user)
          .eq('created_at', createdAt)
          .maybeSingle();

        if (leave && leave.task_buddy) {
          const startDate = leave.start_date;
          const endDate = leave.end_date;
          const buddy = leave.task_buddy;

          const { data: tasksToShift } = await sb.from('tasks')
            .select('*')
            .eq('assigned_to', user)
            .gte('planned_date', startDate)
            .lte('planned_date', endDate)
            .neq('status', 'done');

          if (tasksToShift && tasksToShift.length > 0) {
            for (const task of tasksToShift) {
              const baseNotes = task.notes || '';
              let newNotes = baseNotes;
              if (!baseNotes.includes(`[OriginalOwner: ${user}]`)) {
                newNotes = (baseNotes + `\n[OriginalOwner: ${user}]`).trim();
              }
              await sb.from('tasks')
                .update({ 
                  assigned_to: buddy,
                  notes: newNotes
                })
                .eq('task_id', task.task_id);
              
              syncToSheet('editTask', { 
                taskId: task.task_id, 
                assignedTo: buddy, 
                notes: newNotes 
              });
            }
          }
        }
      }

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
      return {
        success: true,
        data: (data || []).map(r => {
          const rawStages = r.stages || [];
          const metadataObj = rawStages.find(s => s && s.id === '_metadata');
          let customData = {};
          if (metadataObj && metadataObj.customData) {
            try {
              customData = typeof metadataObj.customData === 'string' ? JSON.parse(metadataObj.customData) : metadataObj.customData;
            } catch (e) {
              console.error('Error parsing customData in getTests:', e);
            }
          }
          const filteredStages = rawStages.filter(s => s && s.id !== '_metadata');
          return {
            testId: r.test_id,
            testName: r.test_name,
            className: r.class_name,
            maxScore: r.max_score ?? '',
            type: r.type,
            heldOn: r.held_on,
            stages: filteredStages,
            subject: r.subject || '',
            chapter: r.chapter || '',
            sheetLink: r.sheet_link || '',
            folderLink: r.folder_link || '',
            minScore: r.min_score ?? '',
            avgScore: r.avg_score ?? '',
            customData
          };
        })
      };
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
      const { testName, className, maxScore, heldOn, type, stages, subject, chapter, sheetLink, folderLink, minScore, avgScore, customData } = params;
      const testId = 'TEST' + Date.now();
      
      let enrichedStages = stages || [];
      if (customData) {
        try {
          const cData = typeof customData === 'string' ? JSON.parse(customData) : customData;
          enrichedStages = [...enrichedStages.filter(s => s && s.id !== '_metadata'), { id: '_metadata', customData: cData }];
        } catch (e) {
          console.error('Error parsing customData in addTest:', e);
        }
      }

      const { error } = await sb.from('tests').insert({
        test_id: testId,
        test_name: testName,
        class_name: className,
        max_score: parseNum(maxScore),
        type: type || 'Sheet',
        held_on: heldOn || getTodayStr(),
        stages: enrichedStages,
        subject: subject || '',
        chapter: chapter || '',
        sheet_link: sheetLink || '',
        folder_link: folderLink || '',
        min_score: parseNum(minScore),
        avg_score: parseNum(avgScore)
      });
      if (error) return { success: false, error: error.message };
      syncToSheet('addTest', { ...params, testId });
      return { success: true, data: { testId } };
    }

    case 'updateTestStage': {
      const { testId, stageId, status, actualDate, doneBy, doneAt } = params;
      const { data: t } = await sb.from('tests').select('stages').eq('test_id', testId).maybeSingle();
      if (!t) return { success: false, error: 'Test not found' };
      const stages = [...(t.stages || [])];
      const idx = stages.findIndex(s => s && s.id === stageId);
      const upd = { id: stageId, status, actualDate, doneBy: doneBy || '', doneAt: doneAt || '' };
      if (idx !== -1) stages[idx] = { ...stages[idx], ...upd }; else stages.push(upd);
      await sb.from('tests').update({ stages }).eq('test_id', testId);
      syncToSheet('updateTestStage', params);
      return { success: true };
    }

    case 'editTestDetails': {
      const { testId, testName, className, maxScore, heldOn, type, subject, chapter, sheetLink, folderLink, minScore, avgScore, stages, customData } = params;
      const upd = {};
      if (testName) upd.test_name = testName;
      if (className) upd.class_name = className;
      if (maxScore !== undefined) upd.max_score = parseNum(maxScore);
      if (heldOn) upd.held_on = heldOn;
      if (type) upd.type = type;
      
      let enrichedStages = stages;
      if (enrichedStages) {
        if (customData) {
          try {
            const cData = typeof customData === 'string' ? JSON.parse(customData) : customData;
            enrichedStages = [...enrichedStages.filter(s => s && s.id !== '_metadata'), { id: '_metadata', customData: cData }];
          } catch (e) {
            console.error('Error parsing customData in editTestDetails:', e);
          }
        }
        upd.stages = enrichedStages;
      }

      upd.subject = subject || ''; upd.chapter = chapter || '';
      upd.sheet_link = sheetLink || ''; upd.folder_link = folderLink || '';
      if (minScore !== undefined) upd.min_score = parseNum(minScore);
      if (avgScore !== undefined) upd.avg_score = parseNum(avgScore);

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
      const { data: mod } = await sb.from('modifications').select('*').eq('id', requestId).maybeSingle();
      if (!mod) return { success: false, error: 'Request not found' };

      const newStatus = decision === 'approved' ? 'approved' : 'rejected';
      const newData = mod.new_data || {};
      if (decision === 'approved' && mod.type === 'pipeline_unlock') {
        newData.approved_at = new Date().toISOString();
      }

      const { error } = await sb.from('modifications')
        .update({ status: newStatus, new_data: newData })
        .eq('id', requestId);

      if (error) return { success: false, error: error.message };

      if (decision === 'approved') {
        if (mod.type === 'delete') await supabaseApiFetch('deleteTask', { taskId: mod.task_id });
        else if (mod.type === 'edit') await supabaseApiFetch('editTask', { taskId: mod.task_id, ...mod.new_data });
        else if (mod.type === 'shift') await supabaseApiFetch('shiftTask', { taskId: mod.task_id, ...mod.new_data });
      }
      return { success: true };
    }

    case 'requestPipelineUnlock': {
      const { requestedBy } = params;
      // First delete any older requests by the same user to avoid clutter
      await sb.from('modifications')
        .delete()
        .eq('requested_by', requestedBy)
        .eq('type', 'pipeline_unlock');

      const { data, error } = await sb.from('modifications').insert({
        task_id: 'pipeline_unlock',
        type: 'pipeline_unlock',
        new_data: { requested_at: new Date().toISOString() },
        requested_by: requestedBy,
        status: 'pending'
      }).select().maybeSingle();

      if (error) return { success: false, error: error.message };
      return { success: true, requestId: data ? data.id : null };
    }

    case 'checkPipelineUnlock': {
      const { requestedBy } = params;
      const { data, error } = await sb.from('modifications')
        .select('*')
        .eq('requested_by', requestedBy)
        .eq('type', 'pipeline_unlock')
        .order('id', { ascending: false })
        .limit(1);

      if (error) return { success: false, error: error.message };
      if (!data || data.length === 0) return { success: true, status: 'none' };

      const req = data[0];
      return {
        success: true,
        status: req.status,
        requestId: req.id,
        newData: req.new_data || {}
      };
    }

    case 'cancelPipelineUnlock': {
      const { requestedBy } = params;
      await sb.from('modifications')
        .delete()
        .eq('requested_by', requestedBy)
        .eq('type', 'pipeline_unlock')
        .eq('status', 'pending');
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

    case 'saveWeeklyTarget': {
      const { user, week, year, nextTarget } = params;
      if (!user || !week || !year || nextTarget === undefined) {
        return { success: false, error: 'Missing parameters' };
      }

      const weekNum = Number(week);
      const yearNum = Number(year);
      const targetVal = Number(nextTarget);

      // 1. Update/Upsert the current week's record to set next_target
      const { data: curRow } = await sb.from('weekly_scores')
        .select('*')
        .eq('name', user)
        .eq('week', weekNum)
        .eq('year', yearNum)
        .maybeSingle();

      let curSummary = '';
      let curTarget = 0;
      let curCommitmentChecked = false;
      if (curRow) {
        const parsed = parseWeeklyScoresSummary(curRow.ai_summary);
        curTarget = parsed.target || 0;
        curSummary = parsed.summary || '';
        curCommitmentChecked = parsed.commitment_checked || false;
      }

      const newCommitmentChecked = params.commitmentChecked !== undefined ? (params.commitmentChecked === true || params.commitmentChecked === 'true') : curCommitmentChecked;

      const curAiSummaryJSON = JSON.stringify({
        target: curTarget,
        next_target: targetVal,
        summary: curSummary,
        commitment_checked: newCommitmentChecked
      });

      if (curRow) {
        await sb.from('weekly_scores')
          .update({ ai_summary: curAiSummaryJSON })
          .eq('id', curRow.id);
      } else {
        await sb.from('weekly_scores')
          .insert({
            name: user,
            week: weekNum,
            year: yearNum,
            assigned: 0,
            completed: 0,
            late: 0,
            missed: 0,
            score: 0,
            ai_summary: curAiSummaryJSON
          });
      }

      // 2. Update/Upsert next week's record to set its target = targetVal
      const nextWeek = weekNum === 52 ? 1 : weekNum + 1;
      const nextYear = weekNum === 52 ? yearNum + 1 : yearNum;

      const { data: nextRow } = await sb.from('weekly_scores')
        .select('*')
        .eq('name', user)
        .eq('week', nextWeek)
        .eq('year', nextYear)
        .maybeSingle();

      let nextSummary = '';
      let nextNextTarget = 0;
      if (nextRow) {
        const parsed = parseWeeklyScoresSummary(nextRow.ai_summary);
        nextNextTarget = parsed.next_target || 0;
        nextSummary = parsed.summary || '';
      }

      const nextAiSummaryJSON = JSON.stringify({
        target: targetVal,
        next_target: nextNextTarget,
        summary: nextSummary
      });

      if (nextRow) {
        await sb.from('weekly_scores')
          .update({ ai_summary: nextAiSummaryJSON })
          .eq('id', nextRow.id);
      } else {
        await sb.from('weekly_scores')
          .insert({
            name: user,
            week: nextWeek,
            year: nextYear,
            assigned: 0,
            completed: 0,
            late: 0,
            missed: 0,
            score: 0,
            ai_summary: nextAiSummaryJSON
          });
      }

      return { success: true };
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

async function supabaseApiFetch(action, params = {}) {
  const result = await _supabaseApiFetchInner(action, params);
  
  const mutationActions = [
    'addTask', 'editTask', 'deleteTask', 'shiftTask', 'completeTask', 
    'updateTaskStatus', 'addTaskComment', 'addTest', 'editTestDetails', 
    'updateTestStage', 'deleteTestTracker', 'updateTestSettings',
    'approveMember', 'removeMember', 'approveTaskChange'
  ];
  
  if (mutationActions.includes(action) && result && result.success) {
    const sb = getSupabase();
    const taskId = params.taskId || params.testId || '';
    const requestedBy = params.fromUser || 'system';
    
    sb.from('modifications').insert({
      task_id: taskId,
      type: 'audit_' + action,
      new_data: params,
      requested_by: requestedBy,
      status: 'audit'
    }).then(() => {}).catch(e => console.error('Audit log failed', e));
  }
  
  return result;
}
