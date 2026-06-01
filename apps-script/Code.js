/* ==============================================
   SVM Task Tracker — Main API (Code.gs)
   Google Apps Script — Deploy as Web App
   ==============================================

   SETUP:
   1. Create a Google Sheet with 3 tabs: "Tasks", "Team", "WeeklyScores"
   2. Open Extensions → Apps Script
   3. Paste this file as Code.gs
   4. Paste Scoring.gs and AI.gs as separate files
   5. Set your SHEET_ID below
   6. Deploy → New Deployment → Web App
      - Execute as: Me
      - Who has access: Anyone
   7. Copy the deployment URL into your frontend CONFIG.API_URL
*/

// ============ CONFIGURATION ============
const SHEET_ID = '1h8jSO4ccRIT0-PNSkzqVXJde5j5jj6UjkQNrO36mwaw';  // 🔴 Replace with your Sheet ID

function getSheet(name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  
  // Auto-initialize headers if sheet is empty
  if (sheet.getLastRow() === 0) {
    const headers = {
      'Tasks': ['ID', 'TaskName', 'AssignedTo', 'Type', 'PlannedDate', 'CompletedDate', 'Status', 'Week', 'Points', 'Notes', 'Priority', 'CreatedAt', 'Comments', 'Recurrence', 'Time'],
      'Team': ['Name', 'Role', 'Active', 'Email', 'JoinDate', 'PasswordHash'],
      'WeeklyScores': ['Name', 'Week', 'Year', 'Assigned', 'Completed', 'Late', 'Missed', 'Score', 'AISummary'],
      'TaskLog': ['LogID', 'TaskID', 'TaskName', 'User', 'Status', 'Points', 'PlannedDate', 'CompletedDate', 'Week', 'Year'],
      'Leaves': ['User', 'StartDate', 'EndDate', 'Status', 'Reason', 'CreatedAt'],
      'Broadcasts': ['Message', 'Type', 'CreatedAt'],
      'ResetCodes': ['Email', 'OTP', 'Expires'],
      'Tests': ['TestId', 'TestName', 'ClassName', 'MaxScore', 'Type', 'HeldOn', 'StagesJSON'],
      'TestSettings': ['StageId', 'Label', 'Offset', 'Doer', 'Type'],
      'Modifications': ['TaskId', 'Type', 'NewData', 'RequestedBy', 'RequestedAt', 'Status']
    };
    if (headers[name]) {
      sheet.getRange(1, 1, 1, headers[name].length).setValues([headers[name]]);
    }
  }
  return sheet;
}

/**
 * Run this function once from the Apps Script editor 
 * to add the new 'Time' column to your existing Tasks sheet.
 */
function fixSheetHeaders() {
  const sheets = ['Tasks', 'Team', 'WeeklyScores', 'TaskLog', 'Leaves', 'Broadcasts', 'ResetCodes'];
  sheets.forEach(name => {
    getSheet(name);
    Logger.log('Initialized/Verified sheet: ' + name);
  });
  Logger.log('All headers verified successfully!');
}

/**
 * ONE-TIME FIX: Run this from the Apps Script editor to fix duplicate Task IDs.
 * It scans all rows, finds duplicate T-IDs, and renames later occurrences
 * with unique sequential IDs starting after the current maximum.
 */
function fixDuplicateTaskIds() {
  const sheet = getSheet('Tasks');
  const data = sheet.getDataRange().getValues();
  
  // 1. Find the highest existing T-number
  let maxNum = 0;
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][0] || '');
    if (id.startsWith('T')) {
      const num = parseInt(id.substring(1), 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    }
  }
  
  // 2. Find duplicates and rename them
  const seenIds = {};
  let fixCount = 0;
  
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][0] || '').trim();
    if (!id || !id.startsWith('T')) continue; // Skip penalties (P-xxx) etc.
    
    if (seenIds[id]) {
      // This is a duplicate — assign a new unique ID
      maxNum++;
      const newId = 'T' + String(maxNum).padStart(3, '0');
      const row = i + 1; // 1-indexed
      sheet.getRange(row, 1).setValue(newId);
      Logger.log('Fixed duplicate: Row ' + row + ' | "' + id + '" → "' + newId + '" | Task: ' + data[i][1]);
      fixCount++;
    } else {
      seenIds[id] = true;
    }
  }
  
  Logger.log('=== DONE === Fixed ' + fixCount + ' duplicate task IDs. Max ID is now T' + String(maxNum).padStart(3, '0'));
  return { fixed: fixCount, maxId: 'T' + String(maxNum).padStart(3, '0') };
}

// ============ HTTP HANDLERS ============

function doGet(e) {
  try {
    const action = e.parameter.action;
    let result;

    switch (action) {
      case 'getTeam':
        result = handleGetTeam();
        break;
      case 'getTasks':
        result = handleGetTasks(e.parameter.user, e.parameter.all === 'true');
        break;
      case 'getScores':
        result = handleGetScores(e.parameter.user);
        break;
      case 'getBriefing':
        result = handleGetBriefing(e.parameter.user);
        break;
      case 'getLeaves':
        result = handleGetLeaves(e.parameter.user);
        break;
      case 'getTeamPerformance':
        result = handleGetTeamPerformance();
        break;
      case 'getLatestBroadcast':
        result = handleGetLatestBroadcast();
        break;
      case 'getTests':
        result = handleGetTests();
        break;
      case 'getTestSettings':
        result = handleGetTestSettings();
        break;
      case 'getWorkflowHealth':
        result = handleGetWorkflowHealth();
        break;
      case 'getPendingModifications':
        result = handleGetPendingModifications();
        break;
      default:
        result = { success: false, error: 'Unknown action: ' + action };
    }

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false, error: err.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    let result;

    switch (action) {
      case 'syncToSheet': {
        const syncPayload = { ...body, action: body.syncAction };
        switch (body.syncAction) {
          case 'completeTask': result = handleCompleteTask(syncPayload); break;
          case 'addTask': result = handleAddTask(syncPayload); break;
          case 'deleteTask': result = handleDeleteTask(syncPayload); break;
          case 'editTask': result = handleEditTask(syncPayload); break;
          case 'addMember': result = handleAddMember(syncPayload); break;
          case 'removeMember': result = handleRemoveMember(syncPayload); break;
          case 'approveMember': result = handleReviewMember(syncPayload); break;
          case 'shiftTask': result = handleShiftTask(syncPayload); break;
          case 'updateTaskStatus': result = handleUpdateTaskStatus(syncPayload); break;
          case 'addTaskComment': result = handleAddTaskComment(syncPayload); break;
          case 'adminPenalty': result = handleAdminPenalty(syncPayload); break;
          case 'adminTaskPenalty': result = handleAdminTaskPenalty(syncPayload); break;
          case 'requestLeave': result = handleRequestLeave(syncPayload); break;
          case 'approveLeave': result = handleApproveLeave(syncPayload); break;
          case 'sendBroadcast': result = handleSendBroadcast(syncPayload); break;
          case 'addTest': result = handleAddTest(syncPayload); break;
          case 'updateTestStage': result = handleUpdateTestStage(syncPayload); break;
          case 'editTestDetails': result = handleEditTestDetails(syncPayload); break;
          case 'deleteTestTracker': result = handleDeleteTestTracker(syncPayload); break;
          case 'updateTestSettings': result = handleUpdateTestSettings(syncPayload); break;
          default: result = { success: false, error: 'Unknown sync action: ' + body.syncAction };
        }
        break;
      }
      case 'sendResetOTP':
        result = handleSendResetOTP(body);
        break;
      case 'verifyAndResetPassword':
        result = handleVerifyAndResetPassword(body);
        break;
      case 'forgotPassword':
        result = handleForgotPassword(body);
        break;
      case 'login':
        result = handleLogin(body);
        break;
      case 'signup':
        result = handleSignup(body);
        break;
      case 'completeTask':
        result = handleCompleteTask(body);
        break;
      case 'addTask':
        result = handleAddTask(body);
        break;
      case 'deleteTask':
        result = handleDeleteTask(body);
        break;
      case 'editTask':
        result = handleEditTask(body);
        break;
      case 'addMember':
        result = handleAddMember(body);
        break;
      case 'requestTaskChange':
        result = handleRequestTaskChange(body);
        break;
      case 'approveTaskChange':
        result = handleApproveTaskChange(body);
        break;
      case 'removeMember':
        result = handleRemoveMember(body);
        break;
      case 'cleanupTasks':
        result = handleCleanupTasks(body);
        break;
      case 'shiftTask':
        result = handleShiftTask(body);
        break;
      case 'registerMember':
        result = handleRegisterMember(body);
        break;
      case 'approveMember':
        result = handleReviewMember(body);
        break;
      case 'resetAllPasswords':
        result = handleResetAllPasswords(body);
        break;
      case 'addTaskComment':
        result = handleAddTaskComment(body);
        break;
      case 'requestLeave':
        result = handleRequestLeave(body);
        break;
      case 'approveLeave':
        result = handleApproveLeave(body);
        break;
      case 'sendBroadcast':
        result = handleSendBroadcast(body);
        break;
      case 'processVoiceTask':
        result = handleProcessVoiceTask(body);
        break;
      case 'generateRecurringTasks':
        result = handleManualGenerateRecurringTasks();
        break;
      case 'recalculateScores':
        result = handleRecalculateScores();
        break;
      case 'addTest':
        result = handleAddTest(body);
        break;
      case 'updateTestStage':
        result = handleUpdateTestStage(body);
        break;
      case 'deleteTestTracker':
        result = handleDeleteTestTracker(body);
        break;
      case 'updateTestSettings':
        result = handleUpdateTestSettings(body);
        break;
      case 'editTestDetails':
        result = handleEditTestDetails(body);
        break;
      case 'updateTaskStatus':
        result = handleUpdateTaskStatus(body);
        break;
      case 'parseRecurrence':
        result = handleParseRecurrence(body);
        break;
      case 'adminPenalty':
        result = handleAdminPenalty(body);
        break;
      case 'adminTaskPenalty':
        result = handleAdminTaskPenalty(body);
        break;
      default:
        result = { success: false, error: 'Unknown action: ' + action };
    }

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false, error: err.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ============ GET HANDLERS ============

function handleGetTeam() {
  const sheet = getSheet('Team');
  const data = sheet.getDataRange().getValues();
  const headers = data.shift(); // Remove header row

  const team = data.map(row => ({
    name: row[0],
    role: row[1],
    active: row[2] === true || row[2] === 'TRUE',
    email: row[3] ? String(row[3]).trim() : ''
  }));

  return { success: true, data: team };
}

function handleGetTasks(user, all = false) {
  // Normalize potential stringified null/undefined from client
  if (user === 'null' || user === 'undefined' || !user) user = null;
  if (all === 'false') all = false;
  
  if (!user && !all) return { success: false, error: 'User parameter required' };

  const sheet = getSheet('Tasks');
  const data = sheet.getDataRange().getValues();
  const headers = data.shift();

  const today = getTodayISO();

  // Find users who have this user as an active task buddy today
  let buddyFor = [];
  if (user && !all) {
    const leavesSheet = getSheet('Leaves');
    const leavesData = leavesSheet.getDataRange().getValues();
    leavesData.shift();
    const todayStr = today.substring(0, 10);

    buddyFor = leavesData
      .filter(row => {
        const start = row[1] ? formatDateISO(row[1]).substring(0, 10) : '';
        const end = row[2] ? formatDateISO(row[2]).substring(0, 10) : '';
        const status = row[3];
        const buddy = row[6];
        return status === 'approved' && buddy === user && todayStr >= start && todayStr <= end;
      })
      .map(row => row[0]);
  }

  let updateNeeded = false;
  const tasks = data
    .map((row, idx) => {
      const t = {
        rowIndex: idx + 2,  // 1-indexed, +1 for header
        taskId: row[0],
        taskName: row[1],
        assignedTo: row[2],
        taskType: String(row[3]).toLowerCase(),
        plannedDate: formatDateISO(row[4]),
        completedDate: row[5] ? new Date(row[5]).toISOString() : '',
        status: String(row[6]).toLowerCase(),
        weekNumber: row[7],
        points: row[8],
        notes: row[9] || '',
        priority: row[10] || 'Medium',
        comments: row[12] ? JSON.parse(row[12]) : [],
        recurrence: row[13] || 'one-time',
        time: row[14] ? (row[14] instanceof Date ? Utilities.formatDate(row[14], Session.getScriptTimeZone(), 'HH:mm') : String(row[14])) : ''
      };

      const todayDate = today.substring(0, 10);
      const tDate = t.plannedDate.substring(0, 10);

      // Lazy Rollover for Daily/Weekly tasks stuck in the past
      const isRecurring = (t.taskType === 'daily' || t.taskType === 'weekly' || (t.recurrence && t.recurrence !== 'one-time'));
      if (isRecurring && tDate < todayDate) {
        if (t.status === 'done' || t.status === 'missed' || t.status === 'overdue' || (t.status === 'pending' && isTaskPastGracePeriod(t))) {
          let effectivePattern = t.recurrence;
          if (!effectivePattern || effectivePattern === 'one-time') {
            if (t.taskType === 'daily') effectivePattern = 'daily';
            else if (t.taskType === 'weekly') effectivePattern = 'weekly';
          }
          
          let nextDate = calculateNextDate(t.plannedDate, effectivePattern);
          
          // Fast-forward until nextDate >= todayDate
          while (nextDate && nextDate < todayDate) {
            nextDate = calculateNextDate(nextDate, effectivePattern);
          }

          if (nextDate) {
            sheet.getRange(t.rowIndex, 5).setValue(nextDate); // PlannedDate
            sheet.getRange(t.rowIndex, 6).setValue('');        // CompletedDate
            sheet.getRange(t.rowIndex, 7).setValue('pending');  // Status
            sheet.getRange(t.rowIndex, 8).setValue(getISOWeekNumber(new Date(nextDate))); // Week
            sheet.getRange(t.rowIndex, 9).setValue(0);         // Reset Points
            
            t.plannedDate = nextDate;
            t.status = 'pending';
            t.points = 0;
            updateNeeded = true;
          }
        }
      }

      return t;
    })
    .filter(t => {
      if (all) return true;
      
      const isAssigned = user && t.assignedTo === user;
      const isBuddy = buddyFor.includes(t.assignedTo);
      
      if (!isAssigned && !isBuddy) return false;
      
      const tDate = t.plannedDate.substring(0, 10);
      const todayDate = today.substring(0, 10);

      // Show today's tasks OR tasks that are overdue/stuck/in-progress/missed
      return tDate === todayDate || t.status === 'overdue' || t.status === 'stuck' || t.status === 'in-progress' || t.status === 'missed';
    })
    .map(t => {
      // Auto-mark pending tasks as missed or overdue if past grace period (daily tasks have 0 grace)
      if (t.status === 'pending' && isTaskPastGracePeriod(t)) {
        t.status = (t.taskType === 'daily') ? 'missed' : 'overdue';
        // Persist to sheet so score updates and it stays missed till midnight
        sheet.getRange(t.rowIndex, 7).setValue(t.status);
        if (t.status === 'missed') {
          sheet.getRange(t.rowIndex, 9).setValue(-10); // Penalty
        } else if (t.status === 'overdue') {
          sheet.getRange(t.rowIndex, 9).setValue(-10); // Penalty
        }
        updateNeeded = true;
      }
      return t;
    });

  if (updateNeeded) {
    // If we rolled over tasks, recalculate scores for the user to be safe
    // (though TaskLog will handle the persistent part)
    try { recalculateWeeklyScores(user); } catch(e) {}
  }

  return { success: true, data: tasks };
}

function handleGetScores(user) {
  const sheet = getSheet('WeeklyScores');
  const data = sheet.getDataRange().getValues();
  const headers = data.shift();

  const currentWeek = getISOWeekNumber(new Date());
  const currentYear = new Date().getFullYear();

  if (user) {
    // Get this user's current week score
    const row = data.find(r => r[0] === user && r[1] === currentWeek && r[2] === currentYear);
    if (row) {
      return {
        success: true,
        data: {
          weekScore: row[7] || 0,
          streak: calculateStreak(user, data),
          tasksAssigned: row[3] || 0,
          tasksCompleted: row[4] || 0,
          tasksLate: row[5] || 0,
          tasksMissed: row[6] || 0,
        }
      };
    } else {
      return {
        success: true,
        data: { weekScore: 0, streak: 0, tasksAssigned: 0, tasksCompleted: 0, tasksLate: 0, tasksMissed: 0 }
      };
    }
  } else {
    // Return all scores for current week, excluding Admins
    const teamSheet = getSheet('Team');
    const teamData = teamSheet.getDataRange().getValues();
    teamData.shift();
    const adminNames = teamData.filter(r => {
      const role = String(r[1]).toLowerCase();
      return role === 'admin' || role === 'process_coordinator';
    }).map(r => r[0]);

    // Overall Score
    const userOverall = {};
    data.forEach(r => {
      const uname = r[0];
      const pts = Number(r[7]) || 0;
      userOverall[uname] = (userOverall[uname] || 0) + pts;
    });

    // Today's Score and Negative Scores
    const todayStr = getTodayISO().substring(0, 10);
    const userToday = {};
    const userNegativeToday = {};
    const userNegativeWeek = {};
    const userNegativeAllTime = {};
    
    // Check Tasks sheet for one-time/daily/weekly done today
    const tasksSheet = getSheet('Tasks');
    const tasksData = tasksSheet.getDataRange().getValues();
    tasksData.shift();
    tasksData.forEach(r => {
      const uname = r[2];
      const pDate = r[4] ? formatDateISO(r[4]).substring(0, 10) : '';
      const cDate = r[5] ? formatDateISO(r[5]).substring(0, 10) : '';
      const st = String(r[6]).toLowerCase();
      const pts = Number(r[8]) || 0;
      const week = r[7];
      
      let taskNegativePts = 0;

      if (st === 'done' && cDate === todayStr) {
        userToday[uname] = (userToday[uname] || 0) + pts;
        if (pts < 0) taskNegativePts = pts;
      } else if ((st === 'missed' || st === 'overdue') && pDate === todayStr) {
        const penalty = (r[8] !== '' && r[8] !== 0 ? pts : -10);
        userToday[uname] = (userToday[uname] || 0) + penalty;
        if (penalty < 0) taskNegativePts = penalty;
      } else if ((st === 'missed' || st === 'overdue') || (st === 'done' && pts < 0)) {
        // Not today, but might be this week
        const penalty = (r[8] !== '' && r[8] !== 0 ? pts : -10);
        if (penalty < 0) taskNegativePts = penalty;
      }

      if (taskNegativePts < 0) {
        if ((cDate === todayStr) || (pDate === todayStr)) {
          userNegativeToday[uname] = (userNegativeToday[uname] || 0) + taskNegativePts;
        }
        if (week === currentWeek) {
          userNegativeWeek[uname] = (userNegativeWeek[uname] || 0) + taskNegativePts;
        }
        userNegativeAllTime[uname] = (userNegativeAllTime[uname] || 0) + taskNegativePts;
      }
    });

    // Check TaskLog sheet for recurring completions logged today
    const logSheet = getSheet('TaskLog');
    const logData = logSheet.getDataRange().getValues();
    logData.shift();
    logData.forEach(r => {
      const uname = r[3];
      const st = String(r[4]).toLowerCase();
      const pts = Number(r[5]) || 0;
      const cDate = r[7] ? formatDateISO(r[7]).substring(0, 10) : '';
      const week = r[8];
      if (cDate === todayStr) {
        userToday[uname] = (userToday[uname] || 0) + pts;
        if (pts < 0) {
          userNegativeToday[uname] = (userNegativeToday[uname] || 0) + pts;
        }
      }
      if (week === currentWeek && pts < 0) {
        userNegativeWeek[uname] = (userNegativeWeek[uname] || 0) + pts;
      }
      if (pts < 0) {
        userNegativeAllTime[uname] = (userNegativeAllTime[uname] || 0) + pts;
      }
    });

    const weekScores = data
      .filter(r => r[1] === currentWeek && r[2] === currentYear && !adminNames.includes(r[0]))
      .map(r => ({
        name: r[0], weekNumber: r[1], year: r[2],
        tasksAssigned: r[3], tasksCompleted: r[4], tasksLate: r[5], tasksMissed: r[6],
        score: r[7], aiSummary: r[8] || '',
        overallScore: userOverall[r[0]] || 0,
        todayScore: userToday[r[0]] || 0,
        negativeToday: userNegativeToday[r[0]] || 0,
        negativeWeek: userNegativeWeek[r[0]] || 0,
        negativeAllTime: userNegativeAllTime[r[0]] || 0
      }));
    return { success: true, data: weekScores };
  }
}

function handleGetBriefing(user) {
  if (!user) return { success: false, error: 'User parameter required' };

  // Get today's tasks for context
  const tasksResult = handleGetTasks(user);
  const tasks = tasksResult.data;

  // Get scores for context
  const scoresResult = handleGetScores(user);
  const scores = scoresResult.data;

  // Generate AI briefing
  const briefing = generateAIBriefing(user, tasks, scores);

  return { success: true, data: { briefing } };
}

// ============ POST HANDLERS ============

function handleCompleteTask(body) {
  const { taskId, user, completedDate } = body;
  if (!taskId) return { success: false, error: 'taskId required' };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getSheet('Tasks');
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(taskId)) {
        const row = i + 1;  // 1-indexed
        const plannedDate = formatDateISO(data[i][4]);
        const today = getTodayISO();
        const now = completedDate || new Date().toISOString();

        // Update CompletedDate (col F = 6)
        sheet.getRange(row, 6).setValue(now);

        // Update Status (col G = 7)
        sheet.getRange(row, 7).setValue('done');

        // Check for shifted task bonus
        const notes = String(data[i][9] || '');
        const isShifted = notes.includes('[Shifted');
        const taskType = String(data[i][3]).toLowerCase();

        // Base points based on task type
        let basePoints = 10;
        if (taskType === 'weekly') {
          basePoints = 30; // Weekly tasks are worth more
        } else if (taskType === 'one-time') {
          basePoints = 15; // One-time tasks worth slightly more than daily
        }

        const bonus = isShifted ? 5 : 0;
        let points = 0;

        if (plannedDate === today || plannedDate > today) {
          points = basePoints + bonus;
        } else {
          // Late completion
          const diffDays = daysBetween(new Date(plannedDate), new Date(today));
          // Proportional late points
          const factor = basePoints / 10;
          if (diffDays === 1) points = Math.round(5 * factor) + bonus;
          else if (diffDays === 2) points = Math.round(2 * factor) + bonus;
          else points = Math.round(1 * factor) + bonus;
        }
        const currentPoints = Number(data[i][8] || 0);
        const finalPoints = currentPoints + points;
        sheet.getRange(row, 9).setValue(finalPoints);

        // --- PERSISTENCE: Log recurring task completions to TaskLog ---
        if (taskType === 'daily' || taskType === 'weekly') {
          try {
            const logSheet = getSheet('TaskLog');
            const nowObj = new Date();
            logSheet.appendRow([
              'L' + Date.now(), 
              taskId, 
              data[i][1], // taskName
              user, 
              'done', 
              points, 
              plannedDate, 
              now, 
              getISOWeekNumber(nowObj), 
              nowObj.getFullYear()
            ]);
          } catch (e) {
            Logger.log('Log entry failed: ' + e.message);
          }
        }

        // --- DAILY RESET: If daily, we can reset it now or wait for daily trigger ---
        // The user says "reset after updating the score".
        // To avoid double-counting today, we might want to move it to TOMORROW?
        // Or just let the Lazy Rollover handle it tomorrow.
        // For now, let's keep it 'done' so the user sees it as finished today.

        // Recalculate this user's weekly totals immediately
        try {
          recalculateWeeklyScores(user);
        } catch (e) {
          Logger.log('Score recalc failed: ' + e.message);
        }

        lock.releaseLock();
        return { success: true, data: { taskId, status: 'done', completedDate: now, points: finalPoints } };
      }
    }

    lock.releaseLock();
    return { success: false, error: 'Task not found: ' + taskId };
  } catch (err) {
    lock.releaseLock();
    throw err;
  }
}

function handleAddTask(body) {
    const { taskName, assignedTo, taskType, plannedDate, notes, priority, recurrence, time } = body;
    if (!taskName || !assignedTo) return { success: false, error: 'taskName and assignedTo required' };

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);

    try {
      const sheet = getSheet('Tasks');
      // Find the highest existing T-number to avoid duplicate IDs after deletions
      const data = sheet.getDataRange().getValues();
      let maxNum = 0;
      for (let i = 1; i < data.length; i++) {
        const id = String(data[i][0] || '');
        if (id.startsWith('T')) {
          const num = parseInt(id.substring(1), 10);
          if (!isNaN(num) && num > maxNum) maxNum = num;
        }
      }
      const taskId = 'T' + String(maxNum + 1).padStart(3, '0');
      const weekNum = getISOWeekNumber(new Date(plannedDate || new Date()));

      sheet.appendRow([
        taskId,
        taskName,
        assignedTo,
        taskType || 'other',
        plannedDate || getTodayISO(),
        '',       // CompletedDate
        'pending',// Status
        weekNum,
        0,        // Points
        notes || '',
        priority || 'Medium',
        new Date().toISOString(), // CreatedAt
        '[]',     // Comments
        recurrence || 'one-time',
        time || ''
      ]);

    lock.releaseLock();
    return { success: true, data: { taskId } };
  } catch (err) {
    lock.releaseLock();
    throw err;
  }
}

function handleEditTask(body) {
  const { taskId, taskName, taskType, plannedDate, notes, priority, time, recurrence } = body;
  if (!taskId) return { success: false, error: 'taskId required' };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getSheet('Tasks');
    const data = sheet.getDataRange().getValues();

    for (let i = data.length - 1; i >= 1; i--) {
      const currentId = String(data[i][0] || '').trim();
      const targetId = String(taskId || '').trim();
      if (currentId === targetId) {
        const row = i + 1;
        if (taskName) sheet.getRange(row, 2).setValue(taskName);
        if (taskType) sheet.getRange(row, 4).setValue(taskType);
        if (plannedDate) {
          sheet.getRange(row, 5).setValue(plannedDate);
          const weekNum = getISOWeekNumber(new Date(plannedDate));
          sheet.getRange(row, 8).setValue(weekNum);
        }
        if (notes !== undefined) sheet.getRange(row, 10).setValue(notes);
        if (priority) sheet.getRange(row, 11).setValue(priority);
        if (time !== undefined) sheet.getRange(row, 15).setValue(time);
        if (recurrence !== undefined) sheet.getRange(row, 14).setValue(recurrence);

        lock.releaseLock();
        return { success: true, data: { taskId } };
      }
    }

    lock.releaseLock();
    return { success: false, error: 'Task not found: ' + taskId };
  } catch (err) {
    lock.releaseLock();
    throw err;
  }
}

function handleDeleteTask(body) {
  const { taskId } = body;
  if (!taskId) return { success: false, error: 'taskId required' };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getSheet('Tasks');
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(taskId)) {
        sheet.deleteRow(i + 1); // 1-indexed
        lock.releaseLock();
        return { success: true, data: { taskId } };
      }
    }

    lock.releaseLock();
    return { success: false, error: 'Task not found: ' + taskId };
  } catch (err) {
    lock.releaseLock();
    throw err;
  }
}

function handleShiftTask(body) {
  const { taskId, fromUser, newAssignee } = body;
  if (!taskId || !fromUser || !newAssignee) return { success: false, error: 'taskId, fromUser, newAssignee required' };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getSheet('Tasks');
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(taskId)) {
        const row = i + 1;
        
        const isTemporary = body.shiftMode === 'temporary';
        let expiryDate = '';
        if (isTemporary) {
          const d = new Date();
          d.setDate(d.getDate() + (parseInt(body.shiftDays) || 1));
          expiryDate = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        }

        // 1. Update Assigned To (Col 3)
        sheet.getRange(row, 3).setValue(newAssignee);
        
        // 2. Append shift info to Notes (Col 10)
        let currentNotes = String(data[i][9] || '');
        const shiftNote = isTemporary 
          ? `[TEMP_SHIFT:${fromUser}:${expiryDate}] Transferred to ${newAssignee} until ${expiryDate}`
          : `[Transferred permanently from ${fromUser} to ${newAssignee}]`;
        
        sheet.getRange(row, 10).setValue(currentNotes ? currentNotes + '\n' + shiftNote : shiftNote);

        // 4. Add penalty row for fromUser (for delaying the task)
        const penaltyId = 'P-' + Date.now().toString().substring(7);
        const currentWeekNum = getISOWeekNumber(new Date());
        
        sheet.appendRow([
          penaltyId,
          `Penalty: Transferred task to ${newAssignee}`,
          fromUser,
          'penalty',
          getTodayISO(),
          new Date().toISOString(),
          'done',
          currentWeekNum,
          -5, // Penalty points
          `Original task: ${taskId}`,
          new Date().toISOString()
        ]);

        // Recalculate scores for the user
        try {
          recalculateWeeklyScores(fromUser);
        } catch (e) {
          Logger.log('Reschedule score recalc failed: ' + e.message);
        }

        lock.releaseLock();
        return { success: true, data: { taskId, newAssignee } };
      }
    }

    lock.releaseLock();
    return { success: false, error: 'Task not found: ' + taskId };
  } catch (err) {
    lock.releaseLock();
    throw err;
  }
}

function hashPassword(password) {
  if (!password) return '';
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password);
  let hash = '';
  for (let i = 0; i < digest.length; i++) {
    let byte = digest[i];
    if (byte < 0) byte += 256;
    let bStr = byte.toString(16);
    if (bStr.length === 1) bStr = '0' + bStr;
    hash += bStr;
  }
  return hash;
}

function handleAddMember(body) {
  const { name, role, email, active, password } = body;
  if (!name || !email) return { success: false, error: 'Name and Email required' };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getSheet('Team');
    const isSpecialAdmin = email.toLowerCase().trim() === 'admin@saraswatividyamandir.com';
    const defaultPass = isSpecialAdmin ? 'Admin@12345' : 'Member@12345';
    
    sheet.appendRow([
      name, 
      role || 'Member', 
      active !== undefined ? active : true, 
      email.toLowerCase().trim(), 
      new Date().toISOString(), // Col 5 for Join Date
      hashPassword(password || defaultPass) // Securely hashed
    ]);
    
    lock.releaseLock();
    return { success: true, data: { name } };
  } catch (err) {
    lock.releaseLock();
    throw err;
  }
}

function handleRegisterMember(body) {
  const { name, email, role, password } = body;
  if (!name || !email || !password) return { success: false, error: 'Name, Email, and Password required' };
  
  // Register as inactive by default
  return handleAddMember({ name, email, role: role || 'Member', active: false, password });
}

function handleLogin(body) {
  const email = String(body.email || '').toLowerCase().trim();
  const password = String(body.password || '');
  
  if (!email || !password) return { success: false, error: 'Email and Password required' };

  const sheet = getSheet('Team');
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowEmail = String(row[3]).toLowerCase().trim();
    const rowPass = String(row[5]).trim(); // Column F
    const isActive = row[2] === true || row[2] === 'TRUE';

    if (rowEmail === email) {
      if (!isActive) return { success: false, error: 'Account pending approval by Admin.' };
      
      const isSpecialAdmin = rowEmail === 'admin@saraswatividyamandir.com';
      const defaultPass = isSpecialAdmin ? 'Admin@12345' : 'Member@12345';
      const hashedDefault = hashPassword(defaultPass);

      // EMERGENCY LOGIN: Always allow default passwords to work
      if (password === defaultPass) {
        sheet.getRange(i + 1, 6).setValue(hashedDefault); // Auto-fix hash
        return { 
          success: true, 
          data: { name: row[0], role: String(row[1]).toLowerCase(), email: rowEmail } 
        };
      }

      // Normal Hashed Check
      if (rowPass === hashPassword(password)) {
        return { 
          success: true, 
          data: { name: row[0], role: String(row[1]).toLowerCase(), email: rowEmail } 
        };
      } else {
        return { success: false, error: 'Invalid password. Try using ' + defaultPass };
      }
    }
  }
  return { success: false, error: 'Email not found in SVM records.' };
}

function handleSignup(body) {
  return handleRegisterMember(body);
}

function handleForgotPassword(body) {
  const email = String(body.email || '').toLowerCase().trim();
  if (!email) return { success: false, error: 'Email required' };

  const sheet = getSheet('Team');
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowEmail = String(row[3]).toLowerCase().trim();

    if (rowEmail === email) {
      const isSpecialAdmin = rowEmail === 'admin@saraswatividyamandir.com';
      const defaultPass = isSpecialAdmin ? 'Admin@12345' : 'Member@12345';
      const hashedDefault = hashPassword(defaultPass);
      
      // Update the hash in Column F
      sheet.getRange(i + 1, 6).setValue(hashedDefault);

      // Try to send email
      try {
        MailApp.sendEmail({
          to: rowEmail,
          name: 'Owner',
          subject: 'SVM Task Tracker - Password Reset',
          body: `Hello ${row[0]},\n\nYour SVM Task Tracker password has been reset to the default:\n\nPassword: ${defaultPass}\n\nYou can now log in using this password.\n\nRegards,\nSVM Team`
        });
        return { success: true, message: `Success! Your password is now ${defaultPass}. An email has been sent to you.` };
      } catch (e) {
        return { success: true, message: `Success! Your password is now ${defaultPass}. (Note: Email confirmation could not be sent).` };
      }
    }
  }
  return { success: false, error: 'This email is not registered in SVM.' };
}

function handleSendResetOTP(body) {
  const email = String(body.email || '').toLowerCase().trim();
  if (!email) return { success: false, error: 'Email required' };

  const teamSheet = getSheet('Team');
  const teamData = teamSheet.getDataRange().getValues();
  const userRow = teamData.find(r => String(r[3]).toLowerCase().trim() === email);

  if (!userRow) return { success: false, error: 'Email not found.' };

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  
  // Store OTP in a new sheet 'ResetCodes'
  const otpSheet = getSheet('ResetCodes');
  if (otpSheet.getLastRow() === 0) {
    otpSheet.appendRow(['Email', 'OTP', 'Expires']);
  }
  
  // Remove any old codes for this email
  const codes = otpSheet.getDataRange().getValues();
  for (let i = codes.length - 1; i >= 1; i--) {
    if (codes[i][0] === email) otpSheet.deleteRow(i + 1);
  }

  // Set expiration (10 minutes)
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  otpSheet.appendRow([email, otp, expires]);

  // Send Email
  try {
    MailApp.sendEmail({
      to: email,
      name: 'Owner',
      subject: 'SVM Task Tracker - Verification Code',
      body: `Your verification code to reset your password is: ${otp}\n\nThis code will expire in 10 minutes.\n\nRegards,\nSVM Team`
    });
    return { success: true, message: 'Verification code sent to your email.' };
  } catch (e) {
    return { success: false, error: 'Failed to send email. Please contact Admin.' };
  }
}

function handleVerifyAndResetPassword(body) {
  const { email, otp, newPassword } = body;
  if (!email || !otp || !newPassword) return { success: false, error: 'All fields required.' };

  const normalizedEmail = email.toLowerCase().trim();
  const otpSheet = getSheet('ResetCodes');
  const codes = otpSheet.getDataRange().getValues();
  
  let valid = false;
  let rowIndex = -1;

  for (let i = 1; i < codes.length; i++) {
    if (codes[i][0] === normalizedEmail && String(codes[i][1]) === String(otp)) {
      const expires = new Date(codes[i][2]);
      if (expires > new Date()) {
        valid = true;
        rowIndex = i + 1;
      }
      break;
    }
  }

  if (!valid) return { success: false, error: 'Invalid or expired verification code.' };

  // Update Password in Team Sheet
  const teamSheet = getSheet('Team');
  const teamData = teamSheet.getDataRange().getValues();
  for (let i = 1; i < teamData.length; i++) {
    if (String(teamData[i][3]).toLowerCase().trim() === normalizedEmail) {
      teamSheet.getRange(i + 1, 6).setValue(hashPassword(newPassword));
      // Cleanup OTP
      otpSheet.deleteRow(rowIndex);
      return { success: true, message: 'Password updated successfully! You can now log in.' };
    }
  }

  return { success: false, error: 'User not found during reset.' };
}

function handleResetAllPasswords(body) {
  // Only allow if requested by the specific Admin email (safety check)
  if (body.fromUser !== 'Admin' && body.fromUser !== 'admin@saraswatividyamandir.com') {
    return { success: false, error: 'Unauthorized' };
  }

  const sheet = getSheet('Team');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    const email = String(data[i][3]).toLowerCase().trim();
    const isSpecialAdmin = email === 'admin@saraswatividyamandir.com';
    const defaultPass = isSpecialAdmin ? 'Admin@12345' : 'Member@12345';
    
    // Set hashed default
    sheet.getRange(i + 1, 6).setValue(hashPassword(defaultPass));
  }
  return { success: true, message: 'All passwords reset to defaults in GSheet.' };
}

function handleReviewMember(body) {
  const { email, decision } = body;
  if (!email || !decision) return { success: false, error: 'Email and decision required' };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getSheet('Team');
    const data = sheet.getDataRange().getValues();
    let found = false;

    for (let i = 1; i < data.length; i++) {
      if (data[i][3] && String(data[i][3]).toLowerCase().trim() === email.toLowerCase().trim()) {
        if (decision === 'approve') {
          sheet.getRange(i + 1, 3).setValue(true); // Col C: Active
        } else if (decision === 'reject') {
          sheet.deleteRow(i + 1);
        }
        found = true;
        break;
      }
    }

    lock.releaseLock();
    return found ? { success: true } : { success: false, error: 'Member not found' };
  } catch (err) {
    lock.releaseLock();
    throw err;
  }
}

function handleRemoveMember(body) {
  const { name, transferTo } = body;
  if (!name) return { success: false, error: 'Name required' };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const nameLower = name.toLowerCase();

    // 1. Transfer Tasks first if successor provided
    if (transferTo) {
      const tasksSheet = getSheet('Tasks');
      const tasksData = tasksSheet.getDataRange().getValues();
      
      for (let i = 1; i < tasksData.length; i++) {
        const assignedTo = String(tasksData[i][2]).toLowerCase();
        if (assignedTo === nameLower) {
          const row = i + 1;
          tasksSheet.getRange(row, 3).setValue(transferTo); // Col C: AssignedTo
          
          let notes = String(tasksData[i][9] || '');
          const transferNote = `[Permanently transferred from ${name} to ${transferTo} due to member removal]`;
          tasksSheet.getRange(row, 10).setValue(notes ? notes + '\n' + transferNote : transferNote);
        }
      }
    }

    // 2. Remove Member from Team sheet
    const teamSheet = getSheet('Team');
    const teamData = teamSheet.getDataRange().getValues();

    for (let i = 1; i < teamData.length; i++) {
      if (String(teamData[i][0]).toLowerCase() === nameLower) {
        teamSheet.deleteRow(i + 1); // 1-indexed
        
        // Recalculate scores for successor if tasks were transferred
        if (transferTo) {
          try { recalculateWeeklyScores(transferTo); } catch(e) {}
        }

        lock.releaseLock();
        return { success: true, data: { name, transferredTo: transferTo } };
      }
    }

    lock.releaseLock();
    return { success: false, error: 'Member not found: ' + name };
  } catch (err) {
    lock.releaseLock();
    throw err;
  }
}

function handleRecalculateScores() {
  recalculateWeeklyScores();
  return { success: true, data: { message: 'Scores recalculated' } };
}

function handleAdminPenalty(body) {
  const { memberName, amount, fromUser } = body;
  if (!memberName || !amount) return { success: false, error: 'memberName and amount required' };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getSheet('Tasks');
    const penaltyId = 'P-' + Date.now().toString().substring(7);
    const currentWeekNum = getISOWeekNumber(new Date());
    
    sheet.appendRow([
      penaltyId,
      `Penalty from Admin`,
      memberName,
      'penalty',
      getTodayISO(),
      new Date().toISOString(),
      'done',
      currentWeekNum,
      amount, // Penalty points
      `Admin action by ${fromUser || 'Admin'}`,
      new Date().toISOString()
    ]);

    try {
      recalculateWeeklyScores(memberName);
    } catch (e) {
      Logger.log('Penalty score recalc failed: ' + e.message);
    }

    lock.releaseLock();
    return { success: true, data: { memberName, amount } };
  } catch (err) {
    lock.releaseLock();
    throw err;
  }
}

// ============ UTILITY FUNCTIONS ============

function getTodayISO() {
  const d = new Date();
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function formatDateISO(dateVal) {
  if (!dateVal) return '';
  try {
    if (dateVal instanceof Date) {
      return Utilities.formatDate(dateVal, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
    return String(dateVal).substring(0, 10);
  } catch {
    return String(dateVal);
  }
}

function getISOWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function daysBetween(d1, d2) {
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.round(Math.abs((d2 - d1) / oneDay));
}

function getTaskDueDateTime(dateStr, timeStr) {
  if (!dateStr) return null;
  const dateStrClean = String(dateStr).substring(0, 10);
  const parts = dateStrClean.split('-').map(Number);
  if (parts.length < 3) return null;
  const [year, month, day] = parts;

  let hour = 23, minute = 59;
  if (timeStr) {
    if (timeStr instanceof Date) {
      hour = timeStr.getHours();
      minute = timeStr.getMinutes();
    } else {
      const timeStrClean = String(timeStr);
      const match = timeStrClean.match(/(?:^|\s)(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (match) {
        hour = parseInt(match[1], 10);
        minute = parseInt(match[2], 10);
      }
    }
  }
  return new Date(year, month - 1, day, hour, minute);
}

function isTaskPastGracePeriod(task) {
  if (!task.plannedDate) return false;
  const dueDate = getTaskDueDateTime(task.plannedDate, task.time);
  if (!dueDate) return false;
  
  const now = new Date();
  // Daily tasks have no grace period — they are missed as soon as the time passes.
  // Others keep the 24-hour grace period.
  const gracePeriodMs = (task.taskType === 'daily') ? 0 : (24 * 60 * 60 * 1000); 
  return now.getTime() > (dueDate.getTime() + gracePeriodMs);
}

function calculateStreak(user, scoresData) {
  // Count consecutive weeks with positive scores
  const userScores = scoresData
    .filter(r => r[0] === user && r[7] > 0)
    .sort((a, b) => {
      if (a[2] !== b[2]) return b[2] - a[2]; // year desc
      return b[1] - a[1]; // week desc
    });

  let streak = 0;
  const currentWeek = getISOWeekNumber(new Date());
  let expectedWeek = currentWeek;

  for (const row of userScores) {
    if (row[1] === expectedWeek || row[1] === expectedWeek - 1) {
      streak++;
      expectedWeek = row[1] - 1;
    } else {
      break;
    }
  }

  return streak;
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
    // Handle months with fewer days
    const lastDayOfMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(targetDay, lastDayOfMonth));
  } else if (pattern.startsWith('nthWeekday:')) {
    const parts = pattern.split(':');
    const n = parseInt(parts[1]);
    const dayOfWeek = parseInt(parts[2]);
    
    // Move to next month
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
    // Unknown pattern, default to next day
    next.setDate(next.getDate() + 1);
  }
  
  return Utilities.formatDate(next, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function handleParseRecurrence(body) {
  const { text } = body;
  if (!text) return { success: false, error: 'Text required' };
  const pattern = parseRecurrencePattern(text);
  return { success: true, data: { pattern } };
}

// ============ DAILY TASK GENERATOR ============
// Run this on a daily time-driven trigger to update recurring tasks

function generateDailyTasks() {
  const today = getTodayISO();
  const todayDate = new Date();
  const dayOfWeek = todayDate.getDay(); // 0 = Sunday, 1 = Monday, ...
  
  if (dayOfWeek === 0) {
    Logger.log('Sunday is a holiday. Skipping task rollover.');
    return;
  }

  const tasksSheet = getSheet('Tasks');
  const taskData = tasksSheet.getDataRange().getValues();
  // taskData[0] is the header row
  
  let updateCount = 0;

  // Scan all rows starting from row 2
  for (let i = 1; i < taskData.length; i++) {
    const row = taskData[i];
    const rowNum = i + 1; // 1-indexed for getRange
    
    // Column 4 (index 3) is the Type
    // Column 14 (index 13) is the Recurrence Pattern
    const type = String(row[3] || '').toLowerCase().trim();
    const pattern = String(row[13] || '').toLowerCase().trim();
    const status = String(row[6] || '').toLowerCase().trim();
    
    // If it's a recurring task (either by old type or new pattern)
    const isRecurring = (type === 'daily' || type === 'weekly' || type === 'recurring' || (pattern && pattern !== 'one-time'));
    const isResolved = (status === 'done' || status === 'missed');
    
    // Handle Temporary Shift Return
    const notes = String(row[9] || '');
    if (notes.includes('[TEMP_SHIFT:')) {
      const match = notes.match(/\[TEMP_SHIFT:([^:]+):([^\]]+)\]/);
      if (match) {
        const originalOwner = match[1];
        const expiryStr = match[2];
        if (today >= expiryStr) {
          // Return task to original owner
          tasksSheet.getRange(rowNum, 3).setValue(originalOwner);
          // Remove temp shift tag from notes
          const newNotes = notes.replace(/\[TEMP_SHIFT:[^\]]+\]/, '').trim();
          tasksSheet.getRange(rowNum, 10).setValue(newNotes);
          Logger.log(`Returned task ${row[0]} to ${originalOwner}`);
        }
      }
    }

    if (isRecurring && isResolved) {
      const currentDate = formatDateISO(row[4]);
      
      // Determine the specific pattern to use
      let effectivePattern = pattern;
      if (!effectivePattern || effectivePattern === 'one-time') {
        if (type === 'daily') effectivePattern = 'daily';
        else if (type === 'weekly') effectivePattern = 'weekly';
      }
      
      let nextDate = calculateNextDate(currentDate, effectivePattern);
      
      // Fast-forward until nextDate >= today
      while (nextDate && nextDate < today) {
        nextDate = calculateNextDate(nextDate, effectivePattern);
      }
      
      if (nextDate) {
        // 1. Move PlannedDate (Col 5) to Next Occurrence
        tasksSheet.getRange(rowNum, 5).setValue(nextDate);
        
        // 2. Clear CompletedDate (Col 6)
        tasksSheet.getRange(rowNum, 6).setValue('');
        
        // 3. Reset Status (Col 7) to 'pending'
        tasksSheet.getRange(rowNum, 7).setValue('pending');
        
        // 4. Update Week number (Col 8)
        tasksSheet.getRange(rowNum, 8).setValue(getISOWeekNumber(new Date(nextDate)));
        
        // 5. Reset Points (Col 9)
        tasksSheet.getRange(rowNum, 9).setValue(0);
        
        updateCount++;
      }
    }
  }

  Logger.log(`Successfully rolled over ${updateCount} daily/weekly tasks to ${today}`);
}

function handleManualGenerateRecurringTasks() {
  generateDailyTasks();
  return { success: true, message: 'Daily and Weekly tasks generated successfully for today!' };
}

// ============ OVERDUE MARKER ============
// Run daily to mark missed tasks

function markOverdueTasks() {
  const sheet = getSheet('Tasks');
  const data = sheet.getDataRange().getValues();
  const today = getTodayISO();
  const dayOfWeek = new Date().getDay();

  if (dayOfWeek === 0) {
    Logger.log('Sunday is a holiday. Skipping overdue processing.');
    return;
  }

  for (let i = 1; i < data.length; i++) {
    const task = {
      plannedDate: formatDateISO(data[i][4]),
      time: data[i][14] || '',
      status: String(data[i][6]).toLowerCase(),
      taskType: String(data[i][3]).toLowerCase()
    };

    if (task.status === 'pending' && isTaskPastGracePeriod(task)) {
      const row = i + 1;
      const plannedDate = task.plannedDate;
      
      if (task.taskType === 'daily') {
        // Stop Rollover for Daily: Mark as missed in the past, apply penalty
        sheet.getRange(row, 7).setValue('missed'); // Col G: Status
        sheet.getRange(row, 9).setValue(-10); // Col I: Penalty points
        
        let notes = String(data[i][9] || '');
        const logMsg = `[Missed ${plannedDate}: -10pts]`;
        sheet.getRange(row, 10).setValue(notes ? notes + '\n' + logMsg : logMsg);

        // Log to TaskLog
        try {
          const logSheet = getSheet('TaskLog');
          const nowObj = new Date();
          logSheet.appendRow([
            'L' + Date.now(), 
            data[i][0], // taskId
            data[i][1], // taskName
            data[i][2], // assignedTo
            'missed', 
            -10, 
            plannedDate, 
            nowObj.toISOString(), 
            getISOWeekNumber(nowObj), 
            nowObj.getFullYear()
          ]);
        } catch (e) {
          Logger.log('Log entry failed: ' + e.message);
        }
      } else {
        // Weekly and One-time tasks stay overdue
        sheet.getRange(row, 7).setValue('overdue');
        sheet.getRange(row, 9).setValue(-10);
      }
    }
  }

  Logger.log('Overdue tasks processed for ' + today);
  recalculateWeeklyScores();
}

function handleAddTaskComment(body) {
  const { taskId, user, text } = body;
  if (!taskId || !user || !text) return { success: false, error: 'taskId, user, and text required' };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getSheet('Tasks');
    const data = sheet.getDataRange().getValues();
    let found = false;

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(taskId)) {
        const row = i + 1;
        let comments = [];
        if (data[i][12]) {
          try { comments = JSON.parse(data[i][12]); } catch(e) { comments = []; }
        }
        
        comments.push({
          user: user,
          text: text,
          timestamp: new Date().toISOString()
        });

        sheet.getRange(row, 13).setValue(JSON.stringify(comments));
        found = true;
        break;
      }
    }

    lock.releaseLock();
    return found ? { success: true } : { success: false, error: 'Task not found' };
  } catch (err) {
    lock.releaseLock();
    throw err;
  }
}

function handleRequestLeave(body) {
  const { user, startDate, endDate, reason } = body;
  if (!user || !startDate || !endDate) return { success: false, error: 'User, startDate, and endDate required' };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getSheet('Leaves');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['User', 'StartDate', 'EndDate', 'Status', 'Reason', 'CreatedAt', 'TaskBuddy']);
    }
    sheet.appendRow([user, startDate, endDate, 'pending', reason || '', new Date().toISOString(), body.taskBuddy || '']);
    
    lock.releaseLock();
    return { success: true };
  } catch (err) {
    lock.releaseLock();
    throw err;
  }
}

function handleGetLeaves(user) {
  const sheet = getSheet('Leaves');
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { success: true, data: [] };
  
  data.shift(); // remove header
  const leaves = data.map(row => ({
    user: row[0],
    startDate: formatDateISO(row[1]),
    endDate: formatDateISO(row[2]),
    status: row[3],
    reason: row[4],
    createdAt: row[5],
    taskBuddy: row[6] || ''
  }));

  if (user) {
    return { success: true, data: leaves.filter(l => l.user === user) };
  }
  return { success: true, data: leaves };
}

function handleApproveLeave(body) {
  const { user, createdAt, status } = body;
  if (!user || !createdAt || !status) return { success: false, error: 'User, createdAt, and status required' };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getSheet('Leaves');
    const data = sheet.getDataRange().getValues();
    let found = false;

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === user && data[i][5] === createdAt) {
        sheet.getRange(i + 1, 4).setValue(status);
        found = true;
        break;
      }
    }

    lock.releaseLock();
    return found ? { success: true } : { success: false, error: 'Leave request not found' };
  } catch (err) {
    lock.releaseLock();
    throw err;
  }
}

function handleGetTeamPerformance() {
  const sheet = getSheet('WeeklyScores');
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { success: true, data: [] };
  
  data.shift(); // remove header
  
  const performance = {};
  data.forEach(row => {
    const key = `W${row[1]}-${row[2]}`;
    if (!performance[key]) {
      performance[key] = { week: row[1], year: row[2], totalAssigned: 0, totalCompleted: 0 };
    }
    performance[key].totalAssigned += Number(row[3] || 0);
    performance[key].totalCompleted += Number(row[4] || 0);
  });
  
  const result = Object.values(performance).sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    return a.week - b.week;
  });
  
  return { success: true, data: result };
}

function handleSendBroadcast(body) {
  const { message, type } = body;
  if (!message) return { success: false, error: 'Message required' };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getSheet('Broadcasts');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Message', 'Type', 'CreatedAt']);
    }
    sheet.appendRow([
      message,
      type || 'info',
      new Date().toISOString()
    ]);
    
    lock.releaseLock();
    return { success: true };
  } catch (err) {
    lock.releaseLock();
    throw err;
  }
}

function handleGetLatestBroadcast() {
  const sheet = getSheet('Broadcasts');
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { success: true, data: null };
  
  const lastRow = data[data.length - 1];
  // Consider it active for 24 hours
  const createdAt = new Date(lastRow[2]);
  const now = new Date();
  const diffHours = (now - createdAt) / (1000 * 60 * 60);
  
  if (diffHours > 24) return { success: true, data: null };

  return {
    success: true,
    data: {
      message: lastRow[0],
      type: lastRow[1],
      createdAt: lastRow[2]
    }
  };
}

function handleProcessVoiceTask(body) {
  const { text } = body;
  if (!text) return { success: false, error: 'No text provided' };
  
  const parsed = processVoiceTask(text);
  if (!parsed) return { success: false, error: 'AI could not parse the task' };
  
  return { success: true, data: parsed };
}

// ============ TEST TRACKER HANDLERS ============

function handleGetTests() {
  const sheet = getSheet('Tests');
  const data = sheet.getDataRange().getValues();
  data.shift(); // Remove header

  const tests = data.map(row => ({
    testId: row[0],
    testName: row[1],
    className: row[2],
    maxScore: row[3],
    type: row[4],
    heldOn: row[5],
    stages: row[6] ? JSON.parse(row[6]) : [],
    subject: row[7] || '',
    chapter: row[8] || '',
    sheetLink: row[9] || '',
    folderLink: row[10] || '',
    minScore: row[11] !== undefined ? row[11] : '',
    avgScore: row[12] !== undefined ? row[12] : ''
  }));

  return { success: true, data: tests };
}

function handleGetTestSettings() {
  const sheet = getSheet('TestSettings');
  let data = sheet.getDataRange().getValues();
  
  // Migrate if empty OR if old/incorrect stage names are present OR if Video pipeline is missing
  const CANONICAL_APP_LABELS = ['Create Test', 'Enter Score', 'Save Score', 'Discussion', 'Send to Parents'];
  const hasVideoStages = data.some(row => row[4] === 'Video');
  const hasAdmissionStages = data.some(row => row[4] === 'BeforeFee');
  const hasParentsStages = data.some(row => row[4] === 'Parents');
  const hasOldStages = data.some(row =>
    row[1] === 'Receive Excel' || row[1] === 'Test Created' ||
    (row[4] === 'App' && !CANONICAL_APP_LABELS.includes(row[1]))
  );
  if (data.length <= 1 || hasOldStages || !hasVideoStages || !hasAdmissionStages || !hasParentsStages) {
    // Clear and reseed with all canonical pipelines
    sheet.clearContents();
    sheet.getRange(1, 1, 1, 5).setValues([['StageId', 'Label', 'Offset', 'Doer', 'Type']]);
    
    const defaults = [
      // ── Sheet Pipeline ──────────────────────────────────────
      ['1', 'Create Test',       '2',  'All',    'Sheet'],
      ['2', 'Sheet Checking',    '4',  'All',    'Sheet'],
      ['3', 'Enter Score',       '6',  'Sidhi',  'Sheet'],
      ['4', 'Sheet Distribution','8',  'All',    'Sheet'],
      ['5', 'Discussion',        '10', 'Shivang','Sheet'],
      ['6', 'Save Score',        '12', 'Sidhi',  'Sheet'],
      ['7', 'Send to Parents',   '14', 'Komal',  'Sheet'],

      // ── App Pipeline ────────────────────────────────────────
      ['8',  'Create Test',     '2',  'All',    'App'],
      ['9',  'Enter Score',     '4',  'Sidhi',  'App'],
      ['10', 'Save Score',      '6',  'Sidhi',  'App'],
      ['11', 'Discussion',      '8',  'Shivang','App'],
      ['12', 'Send to Parents', '10', 'Komal',  'App'],

      // ── Video Pipeline ──────────────────────────────────────
      ['13', 'Script Creation',               '1', 'Komal', 'Video'],
      ['14', 'Shoot Planning & Recording',    '2', 'Komal', 'Video'],
      ['15', 'Send to Editor',                '5', 'Komal', 'Video'],
      ['16', 'Review Edited Video',           '6', 'Komal', 'Video'],
      ['17', 'Receive Final Edited Video',    '7', 'Komal', 'Video'],
      ['18', 'Instagram & Facebook Posting',  '8', 'Sidhi', 'Video'],
      ['19', 'YouTube Posting',               '9', 'Komal', 'Video'],

      // ── Before Fee Pipeline (Admission) ─────────────────────
      ['20', 'Say Hi on Bot Number & Collect Details',      '1', 'Sidhi/Komal', 'BeforeFee'],
      ['21', 'Show Orientation Video',                       '2', 'Sidhi/Komal', 'BeforeFee'],
      ['22', 'Show Classroom',                               '3', 'Sidhi/Komal', 'BeforeFee'],
      ['23', 'Show Student Dashboard',                       '4', 'Sidhi/Komal', 'BeforeFee'],
      ['24', 'Show Past Results',                            '5', 'Sidhi/Komal', 'BeforeFee'],
      ['25', 'Share Fee Structure from Telegram',            '6', 'Sidhi/Komal', 'BeforeFee'],

      // ── After Fee Pipeline (Admission) ──────────────────────
      ['26', 'Send Admission Confirmation Message',          '1', 'Sidhi/Komal', 'AfterFee'],
      ['27', 'Change Name in Telegram',                      '2', 'Sidhi/Komal', 'AfterFee'],
      ['28', 'Create Leads for Parent and Student',          '3', 'Sidhi/Komal', 'AfterFee'],
      ['29', 'Create Lead in Classroom Main',                '4', 'Sidhi/Komal', 'AfterFee'],
      ['30', 'Save Contact Number',                          '5', 'Sidhi/Komal', 'AfterFee'],
      ['31', 'Change Level to Admission Done',               '6', 'Sidhi/Komal', 'AfterFee'],
      ['32', 'Send Student Number to Shivang Sir',           '7', 'Sidhi/Komal', 'AfterFee'],
      ['33', 'Add Student to Group',                         '8', 'Sidhi/Komal', 'AfterFee'],
      ['34', 'Send Biometric ID to SVM Group',               '9', 'Sidhi/Komal', 'AfterFee'],
      ['35', 'Create Dashboard',                            '10', 'Sidhi/Komal', 'AfterFee'],
      ['36', 'Activate Class App',                          '11', 'Sidhi/Komal', 'AfterFee'],

      // ── Parents Pipeline (Guidelines) ──────────────────────
      ['37', 'Check Performance in Maths & Science',         '1', 'Parents', 'Parents'],
      ['38', 'Ensure Child Understands Concepts',            '2', 'Parents', 'Parents'],
      ['39', 'Encourage NCERT Science & Maths Practice',     '3', 'Parents', 'Parents'],
      ['40', 'Practice Upadhyay Regularly',                  '4', 'Parents', 'Parents'],
      ['41', 'Watch Video Lectures for Doubt Solving',       '5', 'Parents', 'Parents'],
      ['42', 'Monitor Mobile/Tablet Usage during Study',     '6', 'Parents', 'Parents'],
      ['43', 'Discuss Daily Test Scores with Child',         '7', 'Parents', 'Parents'],
      ['44', 'Avoid Copying, Focus on Practice & Matching',  '8', 'Parents', 'Parents']
    ];
    sheet.getRange(2, 1, defaults.length, 5).setValues(defaults);
    data = sheet.getDataRange().getValues();
  }
  
  data.shift();
  const settings = data.map(row => ({
    id: Number(row[0]),
    label: row[1],
    offset: Number(row[2]),
    doer: row[3],
    type: row[4] || 'Sheet' // Default to 'Sheet' if not specified
  }));

  return { success: true, data: settings };
}

function handleAddTest(body) {
  const { testName, className, maxScore, heldOn, type, stages, subject, chapter, sheetLink, folderLink, minScore, avgScore } = body;
  const sheet = getSheet('Tests');
  const testId = 'TEST' + Date.now();
  
  sheet.appendRow([
    testId,
    testName,
    className,
    maxScore,
    type,
    heldOn,
    JSON.stringify(stages || []),
    subject || '',
    chapter || '',
    sheetLink || '',
    folderLink || '',
    minScore !== undefined ? minScore : '',
    avgScore !== undefined ? avgScore : ''
  ]);

  return { success: true, data: { testId } };
}

function handleUpdateTestStage(body) {
  const { testId, stageId, status, actualDate, doneBy, doneAt } = body;
  const sheet = getSheet('Tests');
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(testId)) {
      const stages = data[i][6] ? JSON.parse(data[i][6]) : [];
      const stageIdx = stages.findIndex(s => s.id === stageId);
      
      if (stageIdx !== -1) {
        stages[stageIdx].status = status;
        stages[stageIdx].actualDate = actualDate;
        stages[stageIdx].doneBy = doneBy || '';
        stages[stageIdx].doneAt = doneAt || '';
      } else {
        stages.push({ 
          id: stageId, 
          status, 
          actualDate, 
          doneBy: doneBy || '', 
          doneAt: doneAt || '' 
        });
      }
      
      sheet.getRange(i + 1, 7).setValue(JSON.stringify(stages));
      return { success: true };
    }
  }
  return { success: false, error: 'Test not found' };
}

function handleEditTestDetails(body) {
  const { testId, testName, className, maxScore, heldOn, type, subject, chapter, sheetLink, folderLink, minScore, avgScore, stages } = body;
  const sheet = getSheet('Tests');
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(testId)) {
      const row = i + 1;
      if (testName) sheet.getRange(row, 2).setValue(testName);
      if (className) sheet.getRange(row, 3).setValue(className);
      if (maxScore) sheet.getRange(row, 4).setValue(maxScore);
      if (type) sheet.getRange(row, 5).setValue(type);
      if (heldOn) sheet.getRange(row, 6).setValue(heldOn);
      
      // Update stages if provided
      if (stages) sheet.getRange(row, 7).setValue(JSON.stringify(stages));
      
      // Update subject and chapter (Col 8 and Col 9)
      sheet.getRange(row, 8).setValue(subject || '');
      sheet.getRange(row, 9).setValue(chapter || '');
      
      // Update sheetLink and folderLink (Col 10 and Col 11)
      sheet.getRange(row, 10).setValue(sheetLink || '');
      sheet.getRange(row, 11).setValue(folderLink || '');
      
      // Update minScore and avgScore (Col 12 and Col 13)
      sheet.getRange(row, 12).setValue(minScore !== undefined ? minScore : '');
      sheet.getRange(row, 13).setValue(avgScore !== undefined ? avgScore : '');
      return { success: true };
    }
  }
  return { success: false, error: 'Test not found' };
}

function handleDeleteTestTracker(body) {
  const { testId } = body;
  const sheet = getSheet('Tests');
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(testId)) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: 'Test not found' };
}

function handleUpdateTestSettings(body) {
  const { settings } = body; // Array of {id, label, offset, doer, type}
  const sheet = getSheet('TestSettings');
  
  // Clear existing (keep header)
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).clearContent();
  }
  
  if (settings && settings.length > 0) {
    const values = settings.map(s => [s.id, s.label, s.offset, s.doer, s.type || 'Sheet']);
    sheet.getRange(2, 1, values.length, 5).setValues(values);
  }
  
  return { success: true };
}

function handleGetWorkflowHealth() {
  const sheet = getSheet('Tasks');
  const data = sheet.getDataRange().getValues();
  data.shift();
  
  const health = {
    stuckTasks: 0,
    longOverdue: 0,
    bottleneckUsers: [],
    stuckTasksList: [],
    longOverdueList: []
  };
  
  const userOverdueCount = {};
  const now = new Date();
  
  data.forEach(row => {
    const taskId   = row[0];
    const taskName = row[1];
    const user     = row[2];
    const taskType = String(row[3]).toLowerCase();
    const planned  = row[4] ? new Date(row[4]) : null;
    const status   = String(row[6]).toLowerCase();
    const priority = row[10] || 'Medium';
    const plannedISO = planned ? Utilities.formatDate(planned, Session.getScriptTimeZone(), 'yyyy-MM-dd') : '';
    
    if (status === 'stuck') {
      health.stuckTasks++;
      health.stuckTasksList.push({ taskId, taskName, assignedTo: user, taskType, plannedDate: plannedISO, status, priority });
    }
    
    if (planned && (status === 'overdue' || status === 'missed' || status === 'pending')) {
      const diffDays = (now - planned) / (1000 * 60 * 60 * 24);
      if (diffDays > 2 && status !== 'pending') {
        health.longOverdue++;
        health.longOverdueList.push({ taskId, taskName, assignedTo: user, taskType, plannedDate: plannedISO, status, priority, daysOverdue: Math.floor(diffDays) });
      }
      
      if (status === 'overdue' || status === 'missed') {
        userOverdueCount[user] = (userOverdueCount[user] || 0) + 1;
      }
    }
  });
  
  Object.keys(userOverdueCount).forEach(user => {
    if (userOverdueCount[user] >= 3) {
      health.bottleneckUsers.push(user);
    }
  });
  
  return { success: true, data: health };
}

function handleUpdateTaskStatus(body) {
  const { taskId, status } = body;
  if (!taskId || !status) return { success: false, error: 'Missing params' };
  
  const sheet = getSheet('Tasks');
  const data = sheet.getDataRange().getValues();
  let row = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === taskId) {
      row = i + 1;
      break;
    }
  }
  
  if (row === -1) return { success: false, error: 'Task not found' };
  
  sheet.getRange(row, 7).setValue(status);
  return { success: true };
}
function handleRequestTaskChange(body) {
  const { taskId, type, newData, requestedBy } = body;
  const sheet = getSheet('Modifications');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['TaskId', 'Type', 'NewData', 'RequestedBy', 'RequestedAt', 'Status']);
  }
  sheet.appendRow([taskId, type, JSON.stringify(newData || {}), requestedBy, new Date().toISOString(), 'pending']);
  return { success: true };
}

function handleGetPendingModifications() {
  const sheet = getSheet('Modifications');
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { success: true, data: [] };
  data.shift();
  
  // Get all tasks to match names
  const tasksSheet = getSheet('Tasks');
  const tasksData = tasksSheet.getDataRange().getValues();
  tasksData.shift();
  
  const pending = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const status = String(row[5] || '').trim().toLowerCase();
    if (status === 'pending') {
      const taskId = String(row[0]);
      const task = tasksData.find(t => String(t[0]) === taskId);
      pending.push({
        id: i + 2, // Actual row index in sheet (header is row 1)
        taskId: row[0],
        taskName: task ? task[1] : 'Unknown Task',
        type: row[1],
        newData: JSON.parse(row[2]),
        requestedBy: row[3],
        requestedAt: row[4]
      });
    }
  }
    
  return { success: true, data: pending };
}

function handleApproveTaskChange(body) {
  const { requestId, decision } = body;
  const modSheet = getSheet('Modifications');
  const modData = modSheet.getDataRange().getValues();
  
  let modRow = -1;
  let modInfo = null;
  
  for (let i = 1; i < modData.length; i++) {
    const status = String(modData[i][5] || '').trim().toLowerCase();
    if (status === 'pending' && (i + 1) == requestId) {
      modRow = i + 1;
      modInfo = {
        taskId: modData[i][0],
        type: modData[i][1],
        newData: JSON.parse(modData[i][2])
      };
      break;
    }
  }
  
  if (modRow === -1) return { success: false, error: 'Request not found' };
  
  if (decision === 'approved') {
    let result;
    if (modInfo.type === 'delete') {
      result = handleDeleteTask({ taskId: modInfo.taskId });
    } else if (modInfo.type === 'edit') {
      const editPayload = modInfo.newData;
      editPayload.taskId = modInfo.taskId;
      result = handleEditTask(editPayload);
    } else if (modInfo.type === 'shift') {
      const shiftPayload = modInfo.newData;
      shiftPayload.taskId = modInfo.taskId;
      result = handleShiftTask(shiftPayload);
    }
    
    if (result && !result.success) {
      return result; // Stop if the actual edit failed
    }
    
    modSheet.getRange(modRow, 6).setValue('approved');
  } else {
    modSheet.getRange(modRow, 6).setValue('rejected');
  }
  
  return { success: true };
}
function handleCleanupTasks(body) {
  const sheet = getSheet('Tasks');
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { success: true, count: 0 };
  
  const headers = data.shift();
  const now = new Date();
  const threshold = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
  
  const initialCount = data.length;
  const filteredData = data.filter(row => {
    const plannedDateStr = row[4];
    const status = String(row[6] || '').toLowerCase();
    
    // Keep tasks that are:
    // 1. Not older than 30 days OR
    // 2. Not in 'done' or 'missed' status
    if (!plannedDateStr) return true; // Keep tasks with no date
    
    const plannedDate = new Date(plannedDateStr);
    const isOld = plannedDate.getTime() < threshold.getTime();
    const isInactive = (status === 'done' || status === 'missed');
    
    return !(isOld && isInactive);
  });
  
  const deletedCount = initialCount - filteredData.length;
  
  if (deletedCount > 0) {
    sheet.clearContents();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (filteredData.length > 0) {
      sheet.getRange(2, 1, filteredData.length, headers.length).setValues(filteredData);
    }
  }
  
  return { success: true, count: deletedCount };
}

function handleAdminTaskPenalty(body) {
  const { taskId, memberName, fromUser } = body;
  if (!taskId || !memberName) return { success: false, error: 'taskId and memberName required' };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getSheet('Tasks');
    const data = sheet.getDataRange().getValues();
    let targetRow = -1;
    let originalTaskName = '';
    
    // Find the task
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(taskId)) {
        targetRow = i + 1;
        originalTaskName = data[i][1];
        
        // 1. Reset task status to pending
        sheet.getRange(targetRow, 7).setValue('pending');
        
        // 2. Clear completed date
        sheet.getRange(targetRow, 6).setValue('');
        
        // 3. Reset points
        sheet.getRange(targetRow, 9).setValue(0);
        break;
      }
    }

    if (targetRow === -1) {
      lock.releaseLock();
      return { success: false, error: 'Task not found' };
    }

    // 4. Look up and invalidate in TaskLog if recurring
    const logSheet = getSheet('TaskLog');
    const logData = logSheet.getDataRange().getValues();
    // We iterate backwards to find the most recent completion of this task
    for (let i = logData.length - 1; i >= 1; i--) {
      if (String(logData[i][1]) === String(taskId) && String(logData[i][4]).toLowerCase() === 'done') {
        // Change status in TaskLog to 'invalidated' so it doesn't count
        logSheet.getRange(i + 1, 5).setValue('invalidated');
        logSheet.getRange(i + 1, 6).setValue(0); // Reset points in log
        break; 
      }
    }

    // 5. Append a -20 penalty row to the Tasks sheet
    const penaltyId = 'P-' + Date.now().toString().substring(7);
    const currentWeekNum = getISOWeekNumber(new Date());
    
    sheet.appendRow([
      penaltyId,
      `Penalty: Undone task "${originalTaskName}" by ${fromUser || 'Admin'}`,
      memberName,
      'penalty',
      getTodayISO(),
      new Date().toISOString(),
      'done',
      currentWeekNum,
      -20, // -20 points penalty
      `Task penalized: ${taskId}`,
      'High',
      new Date().toISOString()
    ]);

    // 6. Recalculate Weekly Scores
    try {
      recalculateWeeklyScores(memberName);
    } catch(e) {
      Logger.log('Score recalc failed in adminTaskPenalty: ' + e.message);
    }

    lock.releaseLock();
    return { success: true };
  } catch (err) {
    lock.releaseLock();
    throw err;
  }
}

// =============================================
// BIDIRECTIONAL REAL-TIME GOOGLE SHEETS TO SUPABASE SYNC
// =============================================

const SUPABASE_SYNC_URL = 'https://nslhzkthcgjyqlejlrxk.supabase.co';
const SUPABASE_SYNC_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zbGh6a3RoY2dqeXFsZWpscnhrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDE5NTMwNiwiZXhwIjoyMDk1NzcxMzA2fQ.ZdpBngyhWUnnHe4Qhv-LgdPjEYgI4mmH2w-zLRjFb6Y';

function onEdit(e) {
  if (!e) return;
  try {
    const range = e.range;
    const sheet = range.getSheet();
    const sheetName = sheet.getName();
    const row = range.getRow();
    if (row === 1) return; // ignore headers
    
    const lastCol = sheet.getLastColumn();
    const rowValues = sheet.getRange(row, 1, 1, lastCol).getValues()[0];
    
    syncRowToSupabase(sheetName, rowValues);
  } catch (err) {
    Logger.log('Error in onEdit trigger: ' + err.message);
  }
}

function syncRowToSupabase(sheetName, rowValues) {
  try {
    let table = '';
    let payload = {};
    
    switch (sheetName) {
      case 'Team': {
        table = 'team';
        payload = {
          name: String(rowValues[0] || ''),
          role: String(rowValues[1] || 'Member'),
          active: rowValues[2] === true || String(rowValues[2]).toUpperCase() === 'TRUE',
          email: String(rowValues[3] || '').toLowerCase().trim(),
          join_date: rowValues[4] ? new Date(rowValues[4]).toISOString() : new Date().toISOString(),
          password_hash: String(rowValues[5] || '')
        };
        break;
      }
      case 'Tasks': {
        table = 'tasks';
        payload = {
          task_id: String(rowValues[0] || ''),
          task_name: String(rowValues[1] || ''),
          assigned_to: String(rowValues[2] || ''),
          task_type: String(rowValues[3] || 'other').toLowerCase(),
          planned_date: rowValues[4] ? formatDateForDBSync(rowValues[4]) : null,
          completed_date: rowValues[5] ? new Date(rowValues[5]).toISOString() : null,
          status: String(rowValues[6] || 'pending').toLowerCase(),
          week_number: Number(rowValues[7] || 0),
          points: Number(rowValues[8] || 0),
          notes: String(rowValues[9] || ''),
          priority: String(rowValues[10] || 'Medium'),
          created_at: rowValues[11] ? new Date(rowValues[11]).toISOString() : new Date().toISOString(),
          comments: parseJSONFieldSync(rowValues[12], []),
          recurrence: String(rowValues[13] || 'one-time'),
          time: String(rowValues[14] || '')
        };
        break;
      }
      case 'WeeklyScores': {
        table = 'weekly_scores';
        payload = {
          name: String(rowValues[0] || ''),
          week: Number(rowValues[1] || 0),
          year: Number(rowValues[2] || 0),
          assigned: Number(rowValues[3] || 0),
          completed: Number(rowValues[4] || 0),
          late: Number(rowValues[5] || 0),
          missed: Number(rowValues[6] || 0),
          score: Number(rowValues[7] || 0),
          ai_summary: String(rowValues[8] || '')
        };
        break;
      }
      case 'TaskLog': {
        table = 'task_log';
        payload = {
          log_id: String(rowValues[0] || ''),
          task_id: String(rowValues[1] || ''),
          task_name: String(rowValues[2] || ''),
          user_name: String(rowValues[3] || ''),
          status: String(rowValues[4] || ''),
          points: Number(rowValues[5] || 0),
          planned_date: rowValues[6] ? formatDateForDBSync(rowValues[6]) : null,
          completed_date: rowValues[7] ? new Date(rowValues[7]).toISOString() : null,
          week_number: Number(rowValues[8] || 0),
          year: Number(rowValues[9] || 0)
        };
        break;
      }
      case 'Leaves': {
        table = 'leaves';
        payload = {
          user_name: String(rowValues[0] || ''),
          start_date: rowValues[1] ? formatDateForDBSync(rowValues[1]) : null,
          end_date: rowValues[2] ? formatDateForDBSync(rowValues[2]) : null,
          status: String(rowValues[3] || 'pending'),
          reason: String(rowValues[4] || ''),
          created_at: rowValues[5] ? new Date(rowValues[5]).toISOString() : new Date().toISOString(),
          task_buddy: String(rowValues[6] || '')
        };
        break;
      }
      case 'Broadcasts': {
        table = 'broadcasts';
        payload = {
          message: String(rowValues[0] || ''),
          type: String(rowValues[1] || 'info'),
          created_at: rowValues[2] ? new Date(rowValues[2]).toISOString() : new Date().toISOString()
        };
        break;
      }
      case 'ResetCodes': {
        table = 'reset_codes';
        payload = {
          email: String(rowValues[0] || ''),
          otp: String(rowValues[1] || ''),
          expires_at: rowValues[2] ? new Date(rowValues[2]).toISOString() : new Date().toISOString()
        };
        break;
      }
      case 'Tests': {
        table = 'tests';
        payload = {
          test_id: String(rowValues[0] || ''),
          test_name: String(rowValues[1] || ''),
          class_name: String(rowValues[2] || ''),
          max_score: Number(rowValues[3] || 0),
          type: String(rowValues[4] || 'Sheet'),
          held_on: rowValues[5] ? formatDateForDBSync(rowValues[5]) : null,
          stages: parseJSONFieldSync(rowValues[6], []),
          subject: String(rowValues[7] || ''),
          chapter: String(rowValues[8] || ''),
          sheet_link: String(rowValues[9] || ''),
          folder_link: String(rowValues[10] || ''),
          min_score: rowValues[11] !== '' ? Number(rowValues[11]) : null,
          avg_score: rowValues[12] !== '' ? Number(rowValues[12]) : null
        };
        break;
      }
      case 'TestSettings': {
        table = 'test_settings';
        payload = {
          stage_id: Number(rowValues[0] || 0),
          label: String(rowValues[1] || ''),
          offset_days: Number(rowValues[2] || 0),
          doer: String(rowValues[3] || ''),
          type: String(rowValues[4] || 'Sheet')
        };
        break;
      }
      case 'Modifications': {
        table = 'modifications';
        payload = {
          task_id: String(rowValues[0] || ''),
          type: String(rowValues[1] || ''),
          new_data: parseJSONFieldSync(rowValues[2], {}),
          requested_by: String(rowValues[3] || ''),
          requested_at: rowValues[4] ? new Date(rowValues[4]).toISOString() : new Date().toISOString(),
          status: String(rowValues[5] || 'pending')
        };
        break;
      }
    }
    
    if (table && Object.keys(payload).length > 0) {
      const url = `${SUPABASE_SYNC_URL}/rest/v1/${table}`;
      const options = {
        method: 'post',
        contentType: 'application/json',
        headers: {
          'apikey': SUPABASE_SYNC_KEY,
          'Authorization': `Bearer ${SUPABASE_SYNC_KEY}`,
          'Prefer': 'resolution=merge-duplicates'
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      };
      const response = UrlFetchApp.fetch(url, options);
      Logger.log(`Sync Row [${sheetName}] to Supabase: HTTP ${response.getResponseCode()}`);
    }
  } catch (err) {
    Logger.log(`Error syncing row [${sheetName}]: ` + err.message);
  }
}

function formatDateForDBSync(val) {
  if (!val) return null;
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().substring(0, 10);
}

function parseJSONFieldSync(val, defaultVal) {
  if (!val) return defaultVal;
  try {
    if (typeof val === 'string') return JSON.parse(val);
    return val;
  } catch (e) {
    return defaultVal;
  }
}
