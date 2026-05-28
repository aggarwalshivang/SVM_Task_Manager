/* ============================================
   SVM Task Tracker — Application Logic
   ============================================ */

// =============================================
// CONFIGURATION
// =============================================
const CONFIG = {
  //  REPLACE THIS with your deployed Apps Script Web App URL
  API_URL: 'https://script.google.com/macros/s/AKfycbzKWuUHc_xBAKQs6ze0EpYGwVGNz4jH8xMkhi1bTmapQ7MsT1L1jeoVdfDeZ2CVB5J6/exec',

  // Retry settings
  MAX_RETRIES: 2,
  RETRY_DELAY: 1000,

  // Anti-spam settings
  TASK_COOLDOWN_MS: 2000, // 2 seconds between task completions

  // Demo mode — set to true to use mock data without a backend
  DEMO_MODE: false,
};

// (Supabase removed - Using GSheet Auth)

// =============================================
// PIPELINE ADMIN APPROVAL UNLOCK SYSTEM
// =============================================

/** Returns true if an admin has approved pipeline editing and the 10-min window is still open */
function isPipelineEditUnlocked() {
  return !!state.pipelineUnlockExpiry && Date.now() < state.pipelineUnlockExpiry;
}

/** Open the Admin Approval modal */
window.requestPipelineApproval = function () {
  const modal = document.getElementById('pipeline-approval-modal');
  if (!modal) return;
  document.getElementById('pipeline-approval-email').value = '';
  document.getElementById('pipeline-approval-password').value = '';
  document.getElementById('pipeline-approval-error').textContent = '';
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('pipeline-approval-email').focus(), 120);
};

/** Toggle password visibility in approval modal */
window.toggleApprovalPasswordVisibility = function () {
  const inp = document.getElementById('pipeline-approval-password');
  const isHidden = inp.type === 'password';
  inp.type = isHidden ? 'text' : 'password';
  document.getElementById('approval-eye-icon').innerHTML = isHidden
    ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
    : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
};

/** Verify admin credentials and start the 10-minute unlock window */
window.submitPipelineApproval = async function () {
  const email = document.getElementById('pipeline-approval-email').value.trim();
  const password = document.getElementById('pipeline-approval-password').value.trim();
  const errorEl = document.getElementById('pipeline-approval-error');
  const btn = document.getElementById('pipeline-approval-submit');

  errorEl.textContent = '';
  if (!email || !password) {
    errorEl.textContent = 'Please enter admin email and password.';
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<div class="loading-spinner" style="width:16px;height:16px;border-width:2px;margin:0 auto;"></div>';

  try {
    const res = await apiFetch('login', { email, password }, 'POST');
    if (res.success && res.data && String(res.data.role).toLowerCase() === 'admin') {
      // ✅ Valid admin — grant 10-minute unlock
      const TEN_MINUTES = 10 * 60 * 1000;
      state.pipelineUnlockExpiry = Date.now() + TEN_MINUTES;

      // Clear any existing countdown
      if (state.pipelineUnlockTimer) clearInterval(state.pipelineUnlockTimer);

      state.pipelineUnlockTimer = setInterval(() => {
        if (!isPipelineEditUnlocked()) {
          // Time expired — lock up
          clearInterval(state.pipelineUnlockTimer);
          state.pipelineUnlockTimer = null;
          state.pipelineUnlockExpiry = null;
          renderIndividualFormStages();
          showToast('Admin approval expired. Pipeline is locked again.', 'error');
        } else {
          // Refresh countdown display
          const remaining = state.pipelineUnlockExpiry - Date.now();
          const mins = Math.floor(remaining / 60000);
          const secs = Math.floor((remaining % 60000) / 1000);
          const el = document.getElementById('pipeline-unlock-countdown');
          if (el) el.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
        }
      }, 1000);

      document.getElementById('pipeline-approval-modal').style.display = 'none';
      renderIndividualFormStages();
      showToast(`Pipeline unlocked for 10 minutes. Approved by ${res.data.name}.`);
    } else {
      errorEl.textContent = res.error || 'Not an admin account. Access denied.';
    }
  } catch (err) {
    errorEl.textContent = 'Verification failed. Check your connection.';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> Approve Access';
  }
};

/** Immediately re-lock pipeline (manual lock button in unlock mode) */
window.lockPipelineNow = function () {
  if (state.pipelineUnlockTimer) clearInterval(state.pipelineUnlockTimer);
  state.pipelineUnlockTimer = null;
  state.pipelineUnlockExpiry = null;
  renderIndividualFormStages();
  showToast('Pipeline locked.');
};

// =============================================
// CANONICAL PIPELINE DEFAULTS
// These are the source-of-truth stage definitions.
// They override any stale/wrong data returned by the API.
// =============================================
const PIPELINE_DEFAULTS = {
  Sheet: [
    { id: 1, label: 'Create Test', offset: 2, doer: 'All', type: 'Sheet' },
    { id: 2, label: 'Sheet Checking', offset: 4, doer: 'All', type: 'Sheet' },
    { id: 3, label: 'Enter Score', offset: 6, doer: 'Sidhi', type: 'Sheet' },
    { id: 4, label: 'Sheet Distribution', offset: 8, doer: 'All', type: 'Sheet' },
    { id: 5, label: 'Discussion', offset: 10, doer: 'Shivang', type: 'Sheet' },
    { id: 6, label: 'Save Score', offset: 12, doer: 'Sidhi', type: 'Sheet' },
    { id: 7, label: 'Send to Parents', offset: 14, doer: 'Komal', type: 'Sheet' },
  ],
  App: [
    { id: 8, label: 'Create Test', offset: 2, doer: 'All', type: 'App' },
    { id: 9, label: 'Enter Score', offset: 4, doer: 'Sidhi', type: 'App' },
    { id: 10, label: 'Save Score', offset: 6, doer: 'Sidhi', type: 'App' },
    { id: 11, label: 'Discussion', offset: 8, doer: 'Shivang', type: 'App' },
    { id: 12, label: 'Send to Parents', offset: 10, doer: 'Komal', type: 'App' },
  ],
  Video: [
    { id: 13, label: 'Script Creation', offset: 1, doer: 'Komal', type: 'Video' },
    { id: 14, label: 'Shoot Planning & Recording', offset: 2, doer: 'Komal', type: 'Video' },
    { id: 15, label: 'Send to Editor', offset: 5, doer: 'Komal', type: 'Video' },
    { id: 16, label: 'Review Edited Video', offset: 6, doer: 'Komal', type: 'Video' },
    { id: 17, label: 'Receive Final Edited Video', offset: 7, doer: 'Komal', type: 'Video' },
    { id: 18, label: 'Instagram & Facebook Posting', offset: 8, doer: 'Sidhi', type: 'Video' },
    { id: 19, label: 'YouTube Posting', offset: 9, doer: 'Komal', type: 'Video' },
  ]
};

/**
 * Validates and repairs state.testSettings against PIPELINE_DEFAULTS.
 * - Correct stage labels / doers are enforced (non-negotiable).
 * - Offset values are preserved from the API (user-editable).
 * - Missing stages are added; extra stages are left as-is (admin additions).
 */
function sanitizeTestSettings() {
  ['Sheet', 'App', 'Video'].forEach(type => {
    const canonical = PIPELINE_DEFAULTS[type];
    const canonicalLabels = canonical.map(s => s.label);
    const current = (state.testSettings || []).filter(s => s.type === type);
    const currentLabels = current.map(s => s.label);
    const isValid = canonical.length === current.length &&
      canonicalLabels.every(l => currentLabels.includes(l));

    if (!isValid) {
      const repaired = canonical.map(def => {
        const existing = current.find(s => s.label === def.label);
        return { ...def, offset: existing ? existing.offset : def.offset };
      });
      state.testSettings = [
        ...(state.testSettings || []).filter(s => s.type !== type),
        ...repaired
      ];
    }
  });
}

// =============================================
// STATE
// =============================================
const state = {
  currentUser: null,
  userRole: 'member', // 'admin' or 'member'
  teamMembers: [],
  tasks: [],
  briefing: null,
  stats: null,
  isLoading: true,
  error: null,
  filters: {
    search: '',
    status: 'all'
  },
  taskTab: 'daily', // 'daily' | 'recurring' | 'week' | 'onetime'
  theme: localStorage.getItem('theme') === 'light' ? 'light' : 'dark',
  editingTaskId: null,
  tests: [],
  testSettings: [],
  testFmsFilter: 'all',
  testFmsSearch: '',
  testFmsSort: 'held-desc',
  // Pipeline editing unlock (admin approval system)
  pipelineUnlockExpiry: null,  // timestamp when unlock expires
  pipelineUnlockTimer: null    // setInterval ID for countdown
};

// =============================================
// MOCK DATA (for demo / offline mode)
// =============================================
const MOCK_TEAM = [
  { name: 'Ankit', role: 'Coordinator', active: true },
  { name: 'Priya', role: 'Teacher', active: true },
  { name: 'Rahul', role: 'Admin', active: true },
  { name: 'Sneha', role: 'Teacher', active: true },
  { name: 'Vikram', role: 'Supervisor', active: true },
  { name: 'Meera', role: 'Teacher', active: true },
];

function getTodayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function getMockTasks(user) {
  const today = getTodayStr();
  const allTasks = [
    // Daily tasks
    { taskId: 'T001', taskName: 'Check student attendance register', assignedTo: user, taskType: 'daily', plannedDate: today, completedDate: '', status: 'pending', notes: '' },
    { taskId: 'T002', taskName: 'Review lesson plans for the day', assignedTo: user, taskType: 'daily', plannedDate: today, completedDate: '', status: 'pending', notes: '' },
    { taskId: 'T003', taskName: 'Update classroom activity log', assignedTo: user, taskType: 'daily', plannedDate: today, completedDate: '', status: 'pending', notes: '' },
    // Weekly tasks
    { taskId: 'T004', taskName: 'Submit weekly progress report', assignedTo: user, taskType: 'weekly', plannedDate: today, completedDate: '', status: 'pending', notes: '' },
    { taskId: 'T005', taskName: 'Review student homework submissions', assignedTo: user, taskType: 'weekly', plannedDate: today, completedDate: '', status: 'pending', notes: '' },
    // One-time tasks
    { taskId: 'T006', taskName: 'Prepare materials for parent-teacher meeting', assignedTo: user, taskType: 'one-time', plannedDate: today, completedDate: '', status: 'pending', notes: '' },
    { taskId: 'T007', taskName: 'Update notice board for exam schedule', assignedTo: user, taskType: 'one-time', plannedDate: today, completedDate: '', status: 'pending', notes: '' },
    // Overdue task
    { taskId: 'T008', taskName: 'Submit lab equipment inventory list', assignedTo: user, taskType: 'one-time', plannedDate: '2026-04-27', completedDate: '', status: 'overdue', notes: 'Due yesterday' },
  ];
  return allTasks;
}

function getMockStats(user) {
  return {
    weekScore: 72,
    streak: 3,
    completedToday: 0,
    totalToday: 8,
    tasksAssigned: 28,
    tasksCompleted: 22,
    tasksLate: 4,
    tasksMissed: 2,
  };
}

function getMockBriefing(user, tasks) {
  const total = tasks.length;
  const overdue = tasks.filter(t => t.status === 'overdue').length;
  const pending = tasks.filter(t => t.status === 'pending').length;
  const done = tasks.filter(t => t.status === 'done').length;

  let msg = `Good ${getTimeOfDay()}, <strong>${user}</strong>! `;
  if (total === 0) {
    msg += `You have no tasks scheduled for today. Enjoy your free time.`;
  } else {
    msg += `You have <strong>${total} task${total > 1 ? 's' : ''}</strong> today`;
    if (overdue > 0) {
      msg += ` — <strong>${overdue} overdue</strong> from yesterday. Prioritize ${overdue === 1 ? 'it' : 'those'} first.`;
    } else if (done === total) {
      msg += `. And you've completed them all — amazing work!`;
    } else {
      msg += `. Stay focused.`;
    }
  }
  return msg;
}

// =============================================
// API LAYER
// =============================================
async function apiFetch(action, params = {}, method = 'GET') {
  if (CONFIG.DEMO_MODE) {
    return demoHandler(action, params, method);
  }

  const url = new URL(CONFIG.API_URL);
  let options = {};

  if (method === 'GET') {
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    options = {
      method: 'GET',
      redirect: 'follow',
      credentials: 'omit' // Often helps with Apps Script CORS on localhost
    };
  } else {
    options = {
      method: 'POST',
      redirect: 'follow',
      credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...params }),
    };
  }

  let lastError;
  for (let attempt = 0; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url.toString(), options);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data;
    } catch (err) {
      lastError = err;
      if (attempt < CONFIG.MAX_RETRIES) {
        await sleep(CONFIG.RETRY_DELAY * (attempt + 1));
      }
    }
  }
  throw lastError;
}

async function demoHandler(action, params) {
  // Simulate network delay
  await sleep(400 + Math.random() * 400);

  switch (action) {
    case 'getTeam':
      return { success: true, data: MOCK_TEAM };
    case 'getTasks':
      return { success: true, data: getMockTasks(params.user) };
    case 'getScores':
      if (!params.user) {
        return { success: true, data: MOCK_TEAM.map(m => ({ name: m.name, ...getMockStats(m.name) })) };
      }
      return { success: true, data: getMockStats(params.user) };
    case 'getBriefing':
      const tasks = getMockTasks(params.user);
      return { success: true, data: { briefing: getMockBriefing(params.user, tasks) } };
    case 'completeTask':
      return { success: true, data: { taskId: params.taskId, status: 'done', completedDate: new Date().toISOString() } };
    case 'addTask':
      return { success: true, data: { taskId: 'T' + Date.now() } };
    case 'deleteTask':
      return { success: true, data: { taskId: params.taskId } };
    case 'addMember':
      return { success: true, data: { name: params.name } };
    case 'removeMember':
      return { success: true, data: { name: params.name } };
    default:
      return { success: false, error: 'Unknown action' };
  }
}

// =============================================
// UTILITY FUNCTIONS
// =============================================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function $(id) { return document.getElementById(id); }

function getTimeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

function getInitials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function showToast(message, type = 'success') {
  const toast = $('toast');
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  setTimeout(() => toast.classList.remove('show'), 2500);
}

function showError(message) {
  state.error = message;
  $('error-text').textContent = message;
  $('error-banner').style.display = 'flex';
}

function hideError() {
  state.error = null;
  $('error-banner').style.display = 'none';
}

// =============================================
// RENDERING
// =============================================
function renderUserPicker(members) {
  // Logic replaced by auth-overlay
}

// =============================================
// AUTHENTICATION LOGIC
// =============================================
let isSignUp = false;

function toggleAuthMode() {
  isSignUp = !isSignUp;
  $('auth-title').textContent = isSignUp ? 'Create an Account' : 'Welcome to SVM';
  $('auth-subtitle').textContent = isSignUp ? 'Sign up to manage your tasks' : 'Sign in to manage your tasks';
  $('auth-submit').textContent = isSignUp ? 'Sign Up' : 'Sign In';
  $('auth-toggle-text').innerHTML = isSignUp
    ? `Already have an account? <button type="button" class="btn-link" id="auth-toggle-btn-inner">Sign In</button>`
    : `Don't have an account? <button type="button" class="btn-link" id="auth-toggle-btn-inner">Sign Up</button>`;
  const nameGroup = $('auth-name-group');
  if (nameGroup) nameGroup.style.display = isSignUp ? 'block' : 'none';
  const roleGroup = $('auth-role-group');
  if (roleGroup) roleGroup.style.display = isSignUp ? 'block' : 'none';
  const forgotGroup = $('auth-forgot-password-group');
  if (forgotGroup) forgotGroup.style.display = isSignUp ? 'none' : 'block';
  $('auth-error').style.display = 'none';

  $('auth-toggle-btn-inner')?.addEventListener('click', (e) => {
    e.preventDefault();
    toggleAuthMode();
  });
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const email = $('auth-email').value;
  const password = $('auth-password').value;
  const name = $('auth-name')?.value.trim();
  const btn = $('auth-submit');

  btn.disabled = true;
  btn.textContent = isSignUp ? 'Signing up...' : 'Signing in...';
  $('auth-error').style.display = 'none';

  try {
    if (isSignUp) {
      const role = $('auth-role').value;
      if (!name) throw new Error('Please enter your Full Name.');

      const res = await apiFetch('signup', { name, email, role, password }, 'POST');
      if (!res.success) throw new Error(res.error || 'Signup failed');

      showToast('Signed up successfully! Please wait for Admin approval.');
      toggleAuthMode(); // Switch back to sign in
    } else {
      const res = await apiFetch('login', { email, password }, 'POST');
      if (!res.success) throw new Error(res.error || 'Login failed');

      handleUserSignedIn(res.data);
      showToast('Signed in successfully.');
    }
  } catch (err) {
    $('auth-error').textContent = err.message || 'Authentication failed.';
    $('auth-error').style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = isSignUp ? 'Sign Up' : 'Sign In';
  }
}

function openResetPasswordModal() {
  $('reset-step-1').style.display = 'block';
  $('reset-step-2').style.display = 'none';
  $('reset-email').value = $('auth-email').value || '';
  $('reset-otp').value = '';
  $('reset-new-password').value = '';
  $('reset-error-1').style.display = 'none';
  $('reset-error-2').style.display = 'none';
  $('reset-password-modal').style.display = 'flex';
}

function closeResetPasswordModal() {
  $('reset-password-modal').style.display = 'none';
}

async function handleSendOTP() {
  const email = $('reset-email').value.trim();
  const btn = $('btn-send-otp');
  const errorEl = $('reset-error-1');

  if (!email) {
    errorEl.textContent = 'Please enter your email.';
    errorEl.style.display = 'block';
    return;
  }

  const originalText = btn.textContent;
  btn.textContent = 'Sending...';
  btn.disabled = true;
  errorEl.style.display = 'none';

  try {
    const res = await apiFetch('sendResetOTP', { email }, 'POST');
    if (!res.success) throw new Error(res.error);

    showToast(res.message, 'success');
    $('reset-step-1').style.display = 'none';
    $('reset-step-2').style.display = 'block';
  } catch (err) {
    errorEl.textContent = err.message || 'Failed to send code.';
    errorEl.style.display = 'block';
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

async function handleVerifyAndReset() {
  const email = $('reset-email').value.trim();
  const otp = $('reset-otp').value.trim();
  const newPassword = $('reset-new-password').value.trim();
  const btn = $('btn-verify-reset');
  const errorEl = $('reset-error-2');

  if (!otp || !newPassword) {
    errorEl.textContent = 'OTP and New Password are required.';
    errorEl.style.display = 'block';
    return;
  }

  const originalText = btn.textContent;
  btn.textContent = 'Updating...';
  btn.disabled = true;
  errorEl.style.display = 'none';

  try {
    const res = await apiFetch('verifyAndResetPassword', { email, otp, newPassword }, 'POST');
    if (!res.success) throw new Error(res.error);

    showToast(res.message, 'success');
    closeResetPasswordModal();
  } catch (err) {
    errorEl.textContent = err.message || 'Verification failed.';
    errorEl.style.display = 'block';
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

function handleUserSignedOut() {
  state.currentUser = null;
  state.userRole = 'member';
  localStorage.removeItem('svm_session');

  $('auth-overlay').style.display = 'flex';
  $('app-header').style.display = 'none';
  $('app-footer').style.display = 'none';
  $('task-view-container').style.display = 'none';
  $('admin-dashboard-container').style.display = 'none';
}

function handleUserSignedIn(userData) {
  // Safety check for userData
  if (!userData || !userData.name) {
    handleUserSignedOut();
    return;
  }

  state.currentUser = userData.name;
  state.userRole = (userData.role || 'member').toLowerCase();

  // Save session
  localStorage.setItem('svm_session', JSON.stringify(userData));

  $('auth-overlay').style.display = 'none';
  $('app-header').style.display = 'flex';

  const isPrivileged = ['admin', 'coordinator', 'process_coordinator'].includes(state.userRole);
  $('header-view-all').style.display = isPrivileged ? 'flex' : 'none';
  $('header-add-task').style.display = 'flex';

  // Show navigation tabs to all roles (Admin, Coordinator, Member)
  const nav = $('header-nav');
  if (nav) {
    nav.style.display = 'flex';
    // Only Admin and Coordinator can see the "Team" (Dashboard) tab
    const teamTab = $('tab-team');
    if (teamTab) {
      const allowedRoles = ['admin', 'coordinator', 'process_coordinator'];
      teamTab.style.display = allowedRoles.includes(state.userRole) ? 'block' : 'none';
    }
  }

  state.currentView = 'tasks';
  state.tasksFilterUser = null;
  state.currentGlobalView = false;
  if ($('monitoring-header')) $('monitoring-header').style.display = 'none';
  if ($('admin-dashboard-container')) $('admin-dashboard-container').style.display = 'none';
  if ($('test-tracker-container')) $('test-tracker-container').style.display = 'none';
  if ($('task-view-container')) $('task-view-container').style.display = 'block';

  renderHeader(state.currentUser);
  initForUser(state.currentUser);

  // Request notification permission
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }

  // Bind tab events
  $('tab-my-tasks').onclick = () => {
    state.currentView = 'tasks';
    state.tasksFilterUser = null;
    state.currentGlobalView = false;
    setActiveTab('tab-my-tasks');
    if ($('monitoring-header')) $('monitoring-header').style.display = 'none';
    $('task-view-container').style.display = 'block';
    $('admin-dashboard-container').style.display = 'none';
    $('test-tracker-container').style.display = 'none';
    $('stats-section').style.display = 'block';
    $('briefing-section').style.display = 'block';
    initForUser(state.currentUser);
  };
  $('tab-team').onclick = () => {
    setActiveTab('tab-team');
    openDashboard();
    $('task-view-container').style.display = 'none';
    $('test-tracker-container').style.display = 'none';
  };
  $('tab-tests').onclick = () => {
    setActiveTab('tab-tests');
    state.testFmsFilter = 'all';
    openTestTracker('tests');
    $('task-view-container').style.display = 'none';
    $('admin-dashboard-container').style.display = 'none';
    $('test-tracker-container').style.display = 'block';
  };
  $('tab-videos').onclick = () => {
    setActiveTab('tab-videos');
    state.testFmsFilter = 'all';
    openTestTracker('videos');
    $('task-view-container').style.display = 'none';
    $('admin-dashboard-container').style.display = 'none';
    $('test-tracker-container').style.display = 'block';
  };

  checkBroadcast();
  $('loading-screen').classList.add('hidden');
}

function setActiveTab(id) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  $(id).classList.add('active');
}

async function openTestTracker(viewType = 'tests') {
  state.currentView = viewType;
  const container = $('test-list-content');
  container.innerHTML = '<div class="loading-spinner" style="margin: 3rem auto;"></div>';

  // Lock configuration to admin role only
  const isAdmin = state.userRole === 'admin';
  const btnSettings = $('btn-test-settings');
  if (btnSettings) {
    btnSettings.style.display = isAdmin ? 'flex' : 'none';
  }

  try {
    const [settingsRes, testsRes] = await Promise.all([
      apiFetch('getTestSettings'),
      apiFetch('getTests')
    ]);

    if (settingsRes.success) state.testSettings = settingsRes.data;
    if (testsRes.success) state.tests = testsRes.data;

    // Always validate & repair pipeline stages against canonical definitions
    sanitizeTestSettings();

    renderTests(state.tests);
  } catch (err) {
    console.error('Failed to load Test FMS:', err);
    container.innerHTML = '<div class="empty-state">Failed to load tests.</div>';
  }
}

function getTestStages(test) {
  const testType = test.type || 'Sheet';
  const globalSettings = (state.testSettings || []).filter(s => s.type === testType);
  const testStages = test.stages || [];

  if (testStages.length === 0) {
    return globalSettings.map(s => ({
      id: s.id,
      label: s.label,
      offset: s.offset,
      doer: s.doer,
      status: 'pending',
      actualDate: '',
      doneBy: '',
      doneAt: ''
    }));
  }

  return testStages.map(s => {
    const globalStage = globalSettings.find(g => g.id === s.id) || {};
    return {
      id: s.id,
      label: s.label || globalStage.label || 'Step',
      offset: s.offset !== undefined ? parseInt(s.offset) : (globalStage.offset || 0),
      doer: s.doer !== undefined ? s.doer : (globalStage.doer || ''),
      status: s.status || 'pending',
      actualDate: s.actualDate || '',
      doneBy: s.doneBy || '',
      doneAt: s.doneAt || ''
    };
  });
}

function renderTests(tests) {
  const container = $('test-list-content');

  // Update toolbar filter tabs visibility depending on active main tab
  const isVideoView = state.currentView === 'videos';
  const sheetPill = document.querySelector('.test-fms-tabs .tab-btn[data-filter="sheet"]');
  const appPill = document.querySelector('.test-fms-tabs .tab-btn[data-filter="app"]');
  const videoPill = document.querySelector('.test-fms-tabs .tab-btn[data-filter="video"]');
  
  if (sheetPill) sheetPill.style.display = isVideoView ? 'none' : 'inline-block';
  if (appPill) appPill.style.display = isVideoView ? 'none' : 'inline-block';
  if (videoPill) videoPill.style.display = 'none'; // Separate main nav tab takes care of video now, hide this pill

  // Dynamic header titles & add button label based on view type
  const fmsHeaderTitle = document.querySelector('.test-fms-title h2');
  if (fmsHeaderTitle) {
    fmsHeaderTitle.textContent = isVideoView ? 'Video FMS' : 'Test FMS';
  }

  const addBtn = $('btn-add-test');
  if (addBtn) {
    addBtn.textContent = isVideoView ? '+ Add Video' : '+ Add Test';
  }

  const fmsHeaderIcon = document.querySelector('.test-fms-title-icon');
  if (fmsHeaderIcon) {
    fmsHeaderIcon.innerHTML = isVideoView 
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';
  }

  // Apply complete/in-progress/sheet/app/search filters
  const filter = state.testFmsFilter || 'all';
  const searchQuery = state.testFmsSearch || '';

  let filteredTests = tests.filter(test => {
    const isVideo = (test.type || '').toLowerCase() === 'video';

    // 1. Partition by Main Navigation Tab
    if (isVideoView && !isVideo) return false;
    if (!isVideoView && isVideo) return false;

    // 2. Sub-tab Toolbar Filters
    const testStages = getTestStages(test);
    const totalStages = testStages.length;
    const completedStages = testStages.filter(s => s.status === 'done').length;
    const isCompleted = totalStages > 0 && completedStages === totalStages;

    if (filter === 'complete' && !isCompleted) return false;
    if (filter === 'progress' && isCompleted) return false;
    if (filter === 'sheet' && (test.type || '').toLowerCase() !== 'sheet') return false;
    if (filter === 'app' && (test.type || '').toLowerCase() !== 'app') return false;

    // 2. Search Query Filter
    if (searchQuery) {
      const nameMatch = (test.testName || '').toLowerCase().includes(searchQuery);
      const subMatch = (test.subject || '').toLowerCase().includes(searchQuery);
      const chapMatch = (test.chapter || '').toLowerCase().includes(searchQuery);
      if (!nameMatch && !subMatch && !chapMatch) return false;
    }

    return true;
  });

  // Apply sorting options
  const sortType = state.testFmsSort || 'held-desc';
  filteredTests.sort((a, b) => {
    if (sortType === 'held-desc') return new Date(b.heldOn) - new Date(a.heldOn);
    if (sortType === 'held-asc') return new Date(a.heldOn) - new Date(b.heldOn);
    if (sortType === 'subject-asc') return (a.subject || '').localeCompare(b.subject || '');
    if (sortType === 'subject-desc') return (b.subject || '').localeCompare(a.subject || '');
    if (sortType === 'class-asc') return parseInt(a.className || 0) - parseInt(b.className || 0);
    if (sortType === 'class-desc') return parseInt(b.className || 0) - parseInt(a.className || 0);
    if (sortType === 'max-desc') return parseFloat(b.maxScore || 0) - parseFloat(a.maxScore || 0);
    if (sortType === 'max-asc') return parseFloat(a.maxScore || 0) - parseFloat(b.maxScore || 0);
    return 0;
  });

  if (filteredTests.length === 0) {
    container.innerHTML = `<div class="empty-state">No tests match current filters.</div>`;
    return;
  }

  container.innerHTML = filteredTests.map(test => {
    const heldOnDate = new Date(test.heldOn);

    // Check if any stage is overdue to apply card styling
    const testType = test.type || 'Sheet';
    const relevantSettings = (state.testSettings || []).filter(s => s.type === testType);
    const hasOverdueStage = relevantSettings.some(stage => {
      const stages = test.stages || [];
      const testStage = stages.find(s => s.id === stage.id) || { status: 'pending' };
      if (testStage.status === 'done') return false;

      const pDate = new Date(heldOnDate);
      pDate.setDate(heldOnDate.getDate() + (stage.offset || 0));
      pDate.setHours(23, 59, 59, 999); // End of day check
      return new Date() > pDate;
    });

    // Calculate stage stats for the compact progress bar
    const testStages = getTestStages(test);
    const totalStages = testStages.length;
    const completedStages = testStages.filter(s => s.status === 'done').length;

    return `
      <div class="test-card ${hasOverdueStage ? 'overdue' : ''} ${completedStages === totalStages && totalStages > 0 ? 'complete' : ''}" data-test-id="${test.testId}">

        <!-- Top row: subject badge + type + status + actions -->
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            ${test.subject ? `<span class="subject-badge subject-${test.subject.toLowerCase()}">${test.subject === 'Math' ? 'Maths' : test.subject}</span>` : ''}
            <span class="test-type-pill">${test.type || ''}</span>
            ${totalStages > 0 ? (() => {
        const pct = Math.round((completedStages / totalStages) * 100);
        if (completedStages === totalStages) return `<span class="test-status-badge status-complete">✓ Complete</span>`;
        if (hasOverdueStage) return `<span class="test-status-badge status-overdue">⚠ Overdue</span>`;
        return `<span class="test-status-badge status-progress">${pct}% done</span>`;
      })() : ''}
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <button class="btn-ghost btn-sm" onclick="handleEditTestDetailsModal('${test.testId}')">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              Edit
            </button>
            <button class="btn-ghost btn-sm" style="color:var(--accent-red);" onclick="handleDeleteTestTracker('${test.testId}')">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              Delete
            </button>
            <div class="expand-chevron" style="transition:transform var(--transition-base); color:var(--text-muted); display:flex; align-items:center;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
          </div>
        </div>

        <!-- Test name -->
        <div class="test-name" style="margin-bottom:10px;">${test.testName}</div>

        <!-- 2-column meta grid -->
        <div class="test-meta-grid">
          <div class="meta-col">
            <div class="meta-kv">
              <span class="meta-k">Class</span>
              <span class="meta-v meta-bold">${test.className}</span>
            </div>
            <div class="meta-kv">
              <span class="meta-k">Max Marks</span>
              <span class="meta-v meta-bold">${test.maxScore}</span>
            </div>
            ${test.minScore !== undefined && test.minScore !== '' ? `
            <div class="meta-kv">
              <span class="meta-k">Min Marks</span>
              <span class="meta-v">${test.minScore}</span>
            </div>` : ''}
            ${test.avgScore !== undefined && test.avgScore !== '' ? `
            <div class="meta-kv">
              <span class="meta-k">Avg Marks</span>
              <span class="meta-v">${test.avgScore}</span>
            </div>` : ''}
          </div>
          <div class="meta-col">
            <div class="meta-kv">
              <span class="meta-k">Held On</span>
              <span class="meta-v meta-bold">${formatDate(test.heldOn)}</span>
            </div>
            ${totalStages > 0 ? (() => {
        const pct = Math.round((completedStages / totalStages) * 100);
        const pctColor = completedStages === totalStages ? 'var(--accent-emerald)' : (hasOverdueStage ? 'var(--accent-red)' : 'var(--accent-purple)');
        return `
            <div class="meta-kv">
              <span class="meta-k">Progress</span>
              <span class="meta-v" style="color:${pctColor}; font-weight:800;">${completedStages}/${totalStages} <span style="font-weight:600; font-size:0.7rem; opacity:0.8;">(${pct}%)</span></span>
            </div>
            <div style="margin-top:5px;">
              <div style="background:rgba(255,255,255,0.06); height:5px; border-radius:3px; overflow:hidden; display:flex; gap:2px; border:1px solid var(--border-glass);">
                ${testStages.map(stage => {
          const plannedDate = new Date(heldOnDate);
          plannedDate.setDate(heldOnDate.getDate() + (stage.offset || 0));
          plannedDate.setHours(23, 59, 59, 999);
          const isDelayed = stage.status !== 'done' && new Date() > plannedDate;
          let bg = 'rgba(255,255,255,0.12)';
          if (stage.status === 'done') bg = 'var(--accent-emerald)';
          else if (isDelayed) bg = 'var(--accent-red)';
          return `<div style="flex:1; background:${bg}; height:100%; transition:background 0.3s;" title="${stage.label || 'Stage'}: ${stage.status === 'done' ? 'Done' : (isDelayed ? 'Overdue' : 'Pending')}"></div>`;
        }).join('')}
              </div>
            </div>`;
      })() : ''}
          </div>
        </div>

        ${(test.sheetLink || test.folderLink) ? `
        <div style="display:flex; gap:8px; margin-top:10px; padding-top:10px; border-top:1px solid var(--border-glass);">
          ${test.sheetLink ? `
            <a href="${test.sheetLink}" target="_blank" class="btn-ghost btn-xs" style="display:inline-flex; align-items:center; gap:5px; text-decoration:none; color:var(--accent-emerald); font-weight:700; padding:4px 10px; font-size:0.75rem;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
              Sheet
            </a>` : ''}
          ${test.folderLink ? `
            <a href="${test.folderLink}" target="_blank" class="btn-ghost btn-xs" style="display:inline-flex; align-items:center; gap:5px; text-decoration:none; color:#818cf8; font-weight:700; padding:4px 10px; font-size:0.75rem;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
              Drive
            </a>` : ''}
        </div>` : ''}
        
        <div class="test-pipeline">
          ${testStages.map((stage, sIdx) => {
        const plannedDate = new Date(heldOnDate);
        plannedDate.setDate(heldOnDate.getDate() + (stage.offset || 0));
        const pDateCheck = new Date(plannedDate);
        pDateCheck.setHours(23, 59, 59, 999);
        const isDelayed = stage.status !== 'done' && new Date() > pDateCheck;
        const statusClass = stage.status === 'done' ? 'done' : (isDelayed ? 'delayed' : 'pending');
        const doneIcon = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

        return `
              <div class="pipeline-step ${statusClass}" onclick="handleToggleTestStage('${test.testId}', ${stage.id})" title="Click to toggle status.">
                <div class="pipeline-step-left">
                  <div class="step-indicator">${stage.status === 'done' ? doneIcon : (sIdx + 1)}</div>
                </div>
                <div class="step-details">
                  <div class="step-main-info">
                    <div class="step-label">${stage.label || 'Step'}</div>
                    <div class="step-date">Planned: ${formatDate(plannedDate)}</div>
                  </div>
                  <div class="step-meta-info">
                    <div><strong>Assigned:</strong> ${stage.doer || 'Unassigned'}</div>
                    ${stage.status === 'done' ? `
                      <div><strong>Done by:</strong> ${stage.doneBy || 'System'}</div>
                      <div><strong>At:</strong> ${stage.doneAt || 'N/A'}</div>
                    ` : `<div style="color:var(--text-dim);"><strong>Status:</strong> Pending</div>`}
                  </div>
                </div>
              </div>`;
      }).join('')}
        </div>
      </div>
    `;
  }).join('');

  // Bind click handlers to test cards for expand/collapse
  container.querySelectorAll('.test-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // If the user clicked a button, a link, or a step inside the card, ignore the expand/collapse toggle
      if (e.target.closest('button') || e.target.closest('.pipeline-step') || e.target.closest('a')) {
        return;
      }
      card.classList.toggle('expanded');
    });
  });
}

async function handleToggleTestStage(testId, stageId) {
  const test = state.tests.find(t => t.testId === testId);
  if (!test) return;

  const stage = test.stages.find(s => s.id === stageId);
  const newStatus = (!stage || stage.status !== 'done') ? 'done' : 'pending';
  const newDate = newStatus === 'done' ? new Date().toISOString() : '';
  const doneBy = newStatus === 'done' ? state.currentUser : '';
  const doneAt = newStatus === 'done' ? new Date().toLocaleString() : '';

  try {
    showToast('Updating stage...', 'info');
    const res = await apiFetch('updateTestStage', {
      testId,
      stageId,
      status: newStatus,
      actualDate: newDate,
      doneBy,
      doneAt
    }, 'POST');

    if (res.success) {
      if (stage) {
        stage.status = newStatus;
        stage.actualDate = newDate;
        stage.doneBy = doneBy;
        stage.doneAt = doneAt;
      } else {
        test.stages.push({
          id: stageId,
          status: newStatus,
          actualDate: newDate,
          doneBy,
          doneAt
        });
      }
      renderTests(state.tests);
      showToast(`${test.testName} updated.`);
    } else {
      throw new Error(res.error);
    }
  } catch (err) {
    showToast('Failed to update stage', 'error');
  }
}

async function handleDeleteTestTracker(testId) {
  if (!confirm('Permanently delete this Test FMS?')) return;

  try {
    const res = await apiFetch('deleteTestTracker', { testId }, 'POST');
    if (res.success) {
      state.tests = state.tests.filter(t => t.testId !== testId);
      renderTests(state.tests);
      showToast('Test FMS deleted.');
    }
  } catch (err) {
    showToast('Failed to delete tracker', 'error');
  }
}

// =============================================
// TEST SETTINGS
// =============================================
$('btn-test-settings')?.addEventListener('click', openTestSettingsModal);
$('test-settings-close-btn')?.addEventListener('click', () => $('test-settings-modal').style.display = 'none');
$('btn-add-setting-row')?.addEventListener('click', addSettingRow);
$('btn-save-test-settings')?.addEventListener('click', saveTestSettings);

function openTestSettingsModal() {
  if (state.userRole !== 'admin') {
    showToast('Only admins can change test settings.', 'error');
    return;
  }
  state.activeSettingsTab = 'Sheet';

  // Update active tab styles
  const sheetTab = $('settings-tab-sheet');
  const appTab = $('settings-tab-app');
  if (sheetTab) sheetTab.classList.add('active');
  if (appTab) appTab.classList.remove('active');

  renderTestSettingsRows();
  $('test-settings-modal').style.display = 'flex';
}

window.setSettingsActiveTab = function (type) {
  saveActiveSettingsFromDOM();
  state.activeSettingsTab = type;

  // Update tab classes
  const sheetTab = $('settings-tab-sheet');
  const appTab = $('settings-tab-app');
  const videoTab = $('settings-tab-video');
  if (sheetTab) sheetTab.classList.toggle('active', type === 'Sheet');
  if (appTab) appTab.classList.toggle('active', type === 'App');
  if (videoTab) videoTab.classList.toggle('active', type === 'Video');

  renderTestSettingsRows();
};

window.selectTypeSegment = function (type) {
  const input = document.getElementById('test-form-type');
  if (!input) return;
  input.value = type;

  // All segment buttons
  const allSegments = [
    { id: 'type-segment-sheet', match: 'Sheet' },
    { id: 'type-segment-app',   match: 'App' },
    { id: 'type-segment-video', match: 'Video' },
  ];

  allSegments.forEach(({ id, match }) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    if (match === type) {
      btn.classList.add('active');
      btn.style.background = 'var(--accent-purple)';
      btn.style.color = '#ffffff';
      btn.style.boxShadow = 'var(--shadow-glow-purple)';
    } else {
      btn.classList.remove('active');
      btn.style.background = 'none';
      btn.style.color = 'var(--text-muted)';
      btn.style.boxShadow = 'none';
    }
  });

  // Trigger change event so pipeline stages reload
  input.dispatchEvent(new Event('change'));
};

function renderTestSettingsRows() {
  const container = $('test-settings-list');
  const activeType = state.activeSettingsTab || 'Sheet';
  const activeSettings = (state.testSettings || []).filter(s => s.type === activeType);

  container.innerHTML = activeSettings.map((s, idx) => `
    <div class="form-row setting-row" data-index="${idx}" data-id="${s.id}" draggable="true" ondragstart="handleSettingDragStart(event)" ondragover="handleSettingDragOver(event)" ondrop="handleSettingDrop(event)" style="align-items: flex-end; margin-bottom: 10px; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px; cursor: move; position: relative;">
      <!-- Drag handle -->
      <div class="drag-handle" style="padding: 10px 5px; color: rgba(255,255,255,0.3); font-size: 1.2rem; display: flex; align-items: center; justify-content: center; height: 100%;">☰</div>
      <div class="form-group" style="flex: 2; margin-left: 5px;">
        <label>Label</label>
        <input type="text" class="setting-label" value="${s.label}">
      </div>
      <div class="form-group" style="flex: 1;">
        <label>Offset (Days)</label>
        <input type="number" class="setting-offset" value="${s.offset}">
      </div>
      <div class="form-group" style="flex: 1.5;">
        <label>Doer</label>
        <input type="text" class="setting-doer" value="${s.doer}">
      </div>
      <button class="btn-ghost" onclick="removeSettingRow(${idx})" style="padding: 10px; color: var(--accent-red); margin-left: 5px;">✕</button>
    </div>
  `).join('');
}

function addSettingRow() {
  const activeType = state.activeSettingsTab || 'Sheet';
  const newId = state.testSettings.length > 0 ? Math.max(...state.testSettings.map(s => s.id)) + 1 : 1;
  state.testSettings.push({ id: newId, label: 'New Stage', offset: 0, doer: '', type: activeType });
  renderTestSettingsRows();
}

function removeSettingRow(idx) {
  const activeType = state.activeSettingsTab || 'Sheet';
  const activeSettings = state.testSettings.filter(s => s.type === activeType);
  const otherSettings = state.testSettings.filter(s => s.type !== activeType);

  activeSettings.splice(idx, 1);
  state.testSettings = [...otherSettings, ...activeSettings];
  renderTestSettingsRows();
}

// Drag & Drop reordering support for Test Settings stages
let draggedIdx = null;

function saveActiveSettingsFromDOM() {
  const rows = document.querySelectorAll('.setting-row');
  const activeType = state.activeSettingsTab || 'Sheet';

  // First, filter out the old stages of the activeType
  const otherSettings = state.testSettings.filter(s => s.type !== activeType);

  // Create updated objects for the active type from inputs
  const updatedActiveSettings = Array.from(rows).map((row, idx) => {
    const existingId = parseInt(row.getAttribute('data-id'));
    return {
      id: !isNaN(existingId) ? existingId : idx + 100,
      label: row.querySelector('.setting-label').value.trim(),
      offset: parseInt(row.querySelector('.setting-offset').value) || 0,
      doer: row.querySelector('.setting-doer').value.trim(),
      type: activeType
    };
  });

  state.testSettings = [...otherSettings, ...updatedActiveSettings];
}

window.handleSettingDragStart = function (e) {
  saveActiveSettingsFromDOM();
  draggedIdx = parseInt(e.currentTarget.getAttribute('data-index'));
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.style.opacity = '0.5';
};

window.handleSettingDragOver = function (e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
};

window.handleSettingDrop = function (e) {
  e.preventDefault();
  const targetIdx = parseInt(e.currentTarget.getAttribute('data-index'));
  e.currentTarget.style.opacity = '1';

  const activeType = state.activeSettingsTab || 'Sheet';
  const activeSettings = state.testSettings.filter(s => s.type === activeType);
  const otherSettings = state.testSettings.filter(s => s.type !== activeType);

  if (draggedIdx !== null && targetIdx !== null && draggedIdx !== targetIdx) {
    const [draggedItem] = activeSettings.splice(draggedIdx, 1);
    activeSettings.splice(targetIdx, 0, draggedItem);
    state.testSettings = [...otherSettings, ...activeSettings];
    renderTestSettingsRows();
  }
  draggedIdx = null;
};

async function saveTestSettings() {
  // Save active tab edits first
  saveActiveSettingsFromDOM();

  try {
    const btn = $('btn-save-test-settings');
    btn.textContent = 'Saving...';
    btn.disabled = true;

    const res = await apiFetch('updateTestSettings', { settings: state.testSettings }, 'POST');
    if (res.success) {
      showToast('Configuration saved successfully.');
      $('test-settings-modal').style.display = 'none';
      renderTests(state.tests);
    }
  } catch (err) {
    showToast('Failed to save configuration', 'error');
  } finally {
    $('btn-save-test-settings').textContent = 'Save Configuration';
    $('btn-save-test-settings').disabled = false;
  }
}

function renderHeader(user, showFab = true) {
  $('greeting-text').textContent = `Good ${getTimeOfDay()}, ${user}`;
  $('app-header').style.display = 'flex';
  $('app-footer').style.display = 'block';
}

function renderBriefing(html) {
  const section = $('briefing-section');
  section.innerHTML = `
    <div class="briefing-card">
      <div class="briefing-header">
        <span class="briefing-label">AI Briefing</span>
      </div>
      <div class="briefing-text">${html}</div>
    </div>
  `;
  section.style.display = 'block';
}

function renderBriefingSkeleton() {
  const section = $('briefing-section');
  section.innerHTML = `
    <div class="briefing-card">
      <div class="briefing-header">
        <span class="briefing-label">AI Briefing</span>
      </div>
      <div class="briefing-skeleton">
        <div class="skeleton-line" style="width:95%"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
      </div>
    </div>
  `;
  section.style.display = 'block';
}

function renderTasks(tasks) {
  // Apply Search and Status Filters
  const filteredTasks = tasks.filter(t => {
    const matchesSearch = t.taskName.toLowerCase().includes(state.filters.search.toLowerCase());
    const matchesStatus = state.filters.status === 'all' ||
      t.status === state.filters.status ||
      (state.filters.status === 'overdue' && t.status === 'missed');
    return matchesSearch && matchesStatus;
  });

  // Sort by: Date → Time → Status (active before done within same date)
  filteredTasks.sort((a, b) => {
    // 1. Date first (earliest date first, no date goes last)
    const dateA = a.plannedDate ? a.plannedDate.substring(0, 10) : '9999-12-31';
    const dateB = b.plannedDate ? b.plannedDate.substring(0, 10) : '9999-12-31';
    if (dateA !== dateB) return dateA.localeCompare(dateB);

    // 2. Time (morning first, no-time goes last)
    const padTime = (t) => {
      if (!t) return '99:99';
      return t.split(':').map(p => p.trim().padStart(2, '0')).join(':');
    };
    const timeCmp = padTime(a.time).localeCompare(padTime(b.time));
    if (timeCmp !== 0) return timeCmp;

    // 3. Status within same date+time (active first, done last)
    const statusOrder = { 'in-progress': 0, 'stuck': 1, 'pending': 2, 'overdue': 3, 'missed': 4, 'done': 5 };
    return (statusOrder[a.status] ?? 2) - (statusOrder[b.status] ?? 2);
  });

  $('controls-section').style.display = 'flex';

  // --- Update tab badge counts ---
  const todayStr = getTodayStr();
  // ISO week bounds
  const nowD = new Date();
  const dayOfWeek = nowD.getDay() === 0 ? 7 : nowD.getDay(); // Mon=1 Sun=7
  const monday = new Date(nowD);
  monday.setDate(nowD.getDate() - dayOfWeek + 1);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const allForTab = (tab) => filteredTasks.filter(t => matchesTab(t, tab, monday, sunday));
  const pendingCountForTab = (tab) => allForTab(tab).filter(t => t.status !== 'done').length;

  ['all', 'daily', 'recurring', 'week', 'onetime'].forEach(tab => {
    const badge = $(`ttab-badge-${tab}`);
    if (!badge) return;
    const count = tab === 'all'
      ? filteredTasks.filter(t => t.status !== 'done').length
      : pendingCountForTab(tab);
    badge.textContent = count > 0 ? count : '';
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
  });

  // Show tab bar
  $('task-type-tabs').style.display = 'flex';

  // Filter by active tab
  const tabTasks = filteredTasks.filter(t => matchesTab(t, state.taskTab, monday, sunday));

  // Determine nice tab label
  const tabLabels = { all: 'All Tasks', daily: 'Daily Tasks', recurring: 'Recurring Tasks', week: 'This Week', onetime: 'One-Time Tasks' };
  const tabLabel = tabLabels[state.taskTab] || 'Tasks';

  renderTaskSection('recurring-section', '📋', tabLabel, tabTasks);
  $('onetime-section').style.display = 'none';

  // Check if all done for active tab
  const allDone = tasks.length > 0 && tasks.every(t => t.status === 'done');
  if (allDone) showAllDoneCelebration();
}

/** Returns true if a task belongs to the given tab */
function matchesTab(t, tab, monday, sunday) {
  switch (tab) {
    case 'all':
      return true; // show everything
    case 'daily':
      return t.taskType === 'daily';
    case 'recurring': {
      if (t.taskType === 'weekly') return true;
      if (t.taskType === 'recurring') return true;
      const rec = (t.recurrence || '').toLowerCase();
      if (rec && rec !== 'one-time' && t.taskType !== 'daily' && t.taskType !== 'one-time') return true;
      return false;
    }
    case 'week': {
      if (!t.plannedDate) return false;
      const d = new Date(t.plannedDate.substring(0, 10) + 'T00:00:00');
      return d >= monday && d <= sunday;
    }
    case 'onetime':
      return t.taskType === 'one-time';
    default:
      return true;
  }
}

/** Switch active tab and re-render */
function setTaskTab(tab) {
  state.taskTab = tab;
  // Update active class on tab buttons
  ['all', 'daily', 'recurring', 'week', 'onetime'].forEach(t => {
    const btn = $(`ttab-${t}`);
    if (btn) btn.classList.toggle('active', t === tab);
  });
  // Re-render with the new tab filter
  if (state.tasks && state.tasks.length > 0) {
    renderTasks(state.tasks);
  }
}

function renderTaskSection(sectionId, icon, title, tasks) {
  const section = $(sectionId);
  if (tasks.length === 0) {
    section.style.display = 'none';
    return;
  }

  const pendingCount = tasks.filter(t => t.status !== 'done').length;
  const doneCount = tasks.filter(t => t.status === 'done').length;

  section.innerHTML = `
    <div class="task-section">
      <div class="section-header">
        <div class="section-title">
          <span class="icon">${icon}</span>
          ${title}
        </div>
        <div class="section-count">${doneCount}/${tasks.length} done</div>
      </div>
      <div class="task-list">
        ${tasks.map(t => renderTaskCard(t)).join('')}
      </div>
    </div>
  `;
  section.style.display = 'block';

  // Bind click handlers for completing tasks
  section.querySelectorAll('.task-card:not(.done)').forEach(card => {
    card.addEventListener('click', (e) => {
      // Don't complete if clicking buttons
      if (e.target.closest('.task-delete-btn') || e.target.closest('.task-edit-btn')) return;
      handleTaskComplete(card.dataset.taskId);
    });
  });

  // Bind edit button handlers
  section.querySelectorAll('.task-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditTaskModal(btn.dataset.editId);
    });
  });

  // Bind delete button handlers
  section.querySelectorAll('.task-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const taskId = btn.dataset.deleteId;
      const task = state.tasks.find(t => t.taskId === taskId);
      showDeleteConfirm(taskId, task ? task.taskName : 'this task');
    });
  });

  // Bind shift button handlers
  section.querySelectorAll('.task-shift-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openShiftTaskModal(btn.dataset.shiftId);
    });
  });

  // Bind comment button handlers
  section.querySelectorAll('.task-comment-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openCommentsModal(btn.dataset.commentId);
    });
  });
}

function formatDate(dateStr, timeStr = '') {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;

  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();

  let formattedTime = '';
  if (timeStr) {
    const [h, m] = timeStr.split(':');
    const hh = parseInt(h);
    const ampm = hh >= 12 ? 'PM' : 'AM';
    const h12 = hh % 12 || 12;
    formattedTime = ` at ${h12}:${m} ${ampm}`;
  }

  if (isToday) return 'Today' + formattedTime;
  if (isTomorrow) return 'Tomorrow' + formattedTime;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + formattedTime;
}

function renderTaskCard(task) {
  const isDone = task.status === 'done';
  const isMissed = task.status === 'missed';
  const isInProgress = task.status === 'in-progress';
  const isStuck = task.status === 'stuck';

  // Check for overdue status
  let isOverdue = task.status === 'overdue' || isMissed;
  if (!isDone && !isOverdue && task.plannedDate) {
    const now = new Date();
    const planned = new Date(task.plannedDate);
    if (typeof task.plannedDate === 'string' && task.plannedDate.includes('-')) {
      const parts = task.plannedDate.split('T')[0].split('-');
      if (parts.length === 3) planned.setFullYear(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    }
    if (task.time) {
      const [h, m] = task.time.split(':');
      planned.setHours(parseInt(h), parseInt(m), 0, 0);
    } else planned.setHours(23, 59, 59, 999);
    const graceMs = (task.taskType === 'daily') ? 0 : (24 * 60 * 60 * 1000);
    if (now.getTime() > (planned.getTime() + graceMs)) isOverdue = true;
  }

  const badgeClass = task.taskType === 'daily' ? 'badge-daily' : task.taskType === 'weekly' ? 'badge-weekly' : 'badge-one-time';
  const prioClass = `priority-${(task.priority || 'Medium').toLowerCase()}`;
  let displayPriority = task.priority || 'Medium';
  if (displayPriority.includes('-') || displayPriority.includes(':')) displayPriority = 'Medium';

  const isProcessCoord = state.userRole === 'process_coordinator';
  const isAdminOrCoord = state.userRole === 'admin' || state.userRole === 'coordinator' || isProcessCoord;

  return `
    <div class="task-card ${isDone ? 'done' : ''} ${isOverdue ? 'overdue' : ''} ${isMissed ? 'missed' : ''}" 
         data-task-id="${task.taskId}" 
         id="task-${task.taskId}">
      <div class="task-checkbox">
        <span class="check-icon">✓</span>
      </div>
      <div class="task-info">
        <div class="task-name">${task.taskName}</div>
        <div class="task-meta">
          <span class="task-badge ${badgeClass}">${task.taskType}</span>
          <span class="priority-badge ${prioClass}">${displayPriority}</span>
          ${task.assignedTo && (isAdminOrCoord || state.currentView === 'tasks') ? `
            <span style="color:var(--accent-purple); font-weight:600;">
              @${task.assignedTo} ${task.assignedTo !== state.currentUser && !state.tasksFilterUser ? '(Buddy Task)' : ''}
            </span>
          ` : ''}
          ${task.plannedDate ? `<span class="task-date-text" style="color:var(--text-dim); font-size:0.75rem;">• ${formatDate(task.plannedDate, task.time)}</span>` : ''}
          ${isOverdue ? `<span class="task-badge badge-overdue">overdue</span>` : ''}
          ${isInProgress ? `<span class="task-badge badge-in-progress">in progress</span>` : ''}
          ${isStuck ? `<span class="task-badge badge-stuck">stuck</span>` : ''}
          ${isDone && task.completedDate ? `<span>Done at ${formatTime(task.completedDate)}</span>` : ''}
          ${task.recurrence && task.recurrence !== 'one-time' ? `
            <div class="recurrence-info" title="Recurring task">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17 2.1l4 4-4 4"/><path d="M3 12.2v-2a4 4 0 0 1 4-4h12.8"/><path d="M7 21.9l-4-4 4-4"/><path d="M21 11.8v2a4 4 0 0 1-4 4H4.2"/></svg>
              ${task.recurrence}
            </div>
          ` : ''}
        </div>
      </div>
      <div class="task-actions">
        ${isProcessCoord ? `
          <button class="task-nudge-btn" onclick="handleNudgeMember('${task.taskId}', '${task.assignedTo}', event)" title="Nudge Member" style="background:none; border:none; color:var(--accent-purple); cursor:pointer; padding:4px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
          </button>
        ` : ''}
        <button class="task-comment-btn" data-comment-id="${task.taskId}" title="Comments" aria-label="Task comments">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 1 1-7.6-13.5 8.38 8.38 0 0 1 3.8.9L21 3z"></path></svg>
        </button>
        ${(!isDone) ? `
          <button onclick="handleUpdateTaskStatus('${task.taskId}', 'in-progress', event)" title="Mark In Progress" style="background:none; border:none; color:var(--accent-blue); cursor:pointer; padding:4px; display:flex; align-items:center;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path></svg>
          </button>
          <button onclick="handleUpdateTaskStatus('${task.taskId}', 'stuck', event)" title="Mark Stuck" style="background:none; border:none; color:var(--accent-amber); cursor:pointer; padding:4px; display:flex; align-items:center;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>
          </button>
        ` : ''}
        ${(!isDone) ? `<button class="task-shift-btn" data-shift-id="${task.taskId}" title="Shift task" aria-label="Shift task">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
        </button>` : ''}
        ${(isAdminOrCoord || task.assignedTo === state.currentUser) ? `
        <button class="task-edit-btn" data-edit-id="${task.taskId}" title="Edit task" aria-label="Edit task">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
        </button>` : ''}
        ${(isAdminOrCoord || task.assignedTo === state.currentUser) ? `
        <button class="task-delete-btn" data-delete-id="${task.taskId}" title="Delete task" aria-label="Delete task">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
        ` : ''}
      </div>
    </div>
  `;
}

function applyTheme() {
  if (state.theme === 'light') {
    document.body.classList.add('light-theme');
  } else {
    document.body.classList.remove('light-theme');
  }
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme', state.theme);
  applyTheme();
}

function renderStats(stats) {
  const section = $('stats-section');
  if (!section) return;

  // Hide stats if viewing someone else's tasks or in global view
  if (state.tasksFilterUser || state.currentGlobalView || state.currentView !== 'tasks') {
    section.style.display = 'none';
    return;
  }

  const completedToday = state.tasks.filter(t => t.status === 'done').length;
  const totalToday = state.tasks.length;
  const pct = totalToday > 0 ? Math.round((completedToday / totalToday) * 100) : 0;

  section.innerHTML = `
    <div class="stats-card">
      <div class="stats-header">This Week</div>
      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-value purple">${stats.weekScore}</div>
          <div class="stat-label">Score</div>
        </div>
        <div class="stat-item">
          <div class="stat-value emerald">${stats.streak}</div>
          <div class="stat-label">Streak</div>
        </div>
        <div class="stat-item">
          <div class="stat-value amber">${completedToday}/${totalToday}</div>
          <div class="stat-label">Today</div>
        </div>
      </div>
      <div class="progress-section">
        <div class="progress-label">
          <span>Today's progress</span>
          <span>${pct}%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: 0%"></div>
        </div>
      </div>
      <div style="margin-top: 15px; display: flex; justify-content: center;">
        <button class="btn-secondary btn-sm" id="open-leave-modal-btn" style="width: auto; padding: 4px 12px; font-size: 0.75rem;">Request Leave</button>
      </div>
    </div>
  `;
  section.style.display = 'block';

  // Animate progress bar after paint
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const fill = section.querySelector('.progress-fill');
      if (fill) fill.style.width = pct + '%';
    });
  });
}

async function openDashboard() {
  state.currentView = 'dashboard';
  const container = $('admin-dashboard-container');
  const content = $('dashboard-content');

  if (container) container.style.display = 'block';
  if (content) content.innerHTML = '<div class="loading-spinner" style="margin: 3rem auto;"></div>';

  try {
    const [scoresRes, teamRes, leavesRes, perfRes, healthRes, modRes] = await Promise.all([
      apiFetch('getScores').catch(() => ({ success: true, data: [] })),
      apiFetch('getTeam').catch(() => ({ success: true, data: [] })),
      apiFetch('getLeaves').catch(() => ({ success: true, data: [] })),
      apiFetch('getTeamPerformance').catch(() => ({ success: true, data: [] })),
      (state.userRole === 'admin' || state.userRole === 'process_coordinator')
        ? apiFetch('getWorkflowHealth').catch(() => ({ success: true, data: null }))
        : Promise.resolve({ success: true, data: null }),
      apiFetch('getPendingModifications').catch(() => ({ success: true, data: [] }))
    ]);

    const scoresMap = new Map();
    if (scoresRes && scoresRes.data) {
      scoresRes.data.forEach(s => scoresMap.set(s.name, s));
    }

    const mergedScores = [];
    const pendingMembers = [];
    if (teamRes && teamRes.data) {
      teamRes.data.forEach(member => {
        const isActive = member.active === true || String(member.active).toUpperCase().trim() === 'TRUE';
        if (!isActive) {
          pendingMembers.push(member);
        } else {
          const stats = scoresMap.get(member.name) || {
            score: 0,
            tasksAssigned: 0,
            tasksCompleted: 0,
            tasksLate: 0,
            tasksMissed: 0
          };
          mergedScores.push({ ...member, ...stats });
        }
      });
    }

    console.log('Dashboard Data Fetched:', {
      scores: mergedScores.length,
      pendingMembers: pendingMembers.length,
      leaves: leavesRes.data ? leavesRes.data.length : 0,
      modifications: modRes.data ? modRes.data.length : 0
    });

    renderDashboard(mergedScores, pendingMembers, leavesRes.data || [], perfRes.data || [], healthRes.data, modRes.data || []);

    // Update tab badge
    const totalPending = (modRes.data ? modRes.data.length : 0) + pendingMembers.length + (leavesRes.data ? leavesRes.data.filter(l => l.status === 'pending').length : 0);
    const teamBadge = $('team-badge');
    if (teamBadge) {
      if (totalPending > 0) {
        teamBadge.style.display = 'block';
        teamBadge.textContent = totalPending;
      } else {
        teamBadge.style.display = 'none';
      }
    }
  } catch (err) {
    console.error('Dashboard error:', err);
    if (content) content.innerHTML = '<div class="empty-state">Failed to load dashboard data. Please try again.</div>';
  }
}

function renderDashboard(scores, pendingMembers = [], leaves = [], perfData = [], healthData = null, modifications = []) {
  const container = $('dashboard-content');
  if (!container) return;
  container.innerHTML = '';

  // Show User Role for verification
  const roleDisplay = document.createElement('div');
  roleDisplay.style = 'font-size:0.7rem; color:var(--text-muted); margin-bottom:10px; text-transform:uppercase; letter-spacing:0.05em;';
  roleDisplay.textContent = `Active Role: ${state.userRole}`;
  container.appendChild(roleDisplay);

  // 1. TASK MODIFICATION REQUESTS (TOP PRIORITY)
  if (state.userRole === 'admin' || state.userRole === 'coordinator' || state.userRole === 'process_coordinator') {
    const modSec = document.createElement('div');
    modSec.className = 'dashboard-section';
    modSec.style.marginBottom = '30px';

    let modHtml = `<h3 style="margin-bottom:15px; font-size:1.1rem; color:var(--accent-purple); display:flex; align-items:center; gap:10px;">
                     <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                     Task Change Approvals
                     ${modifications.length > 0 ? `<span class="badge-count" style="animation: pulse-scale 2s infinite;">${modifications.length}</span>` : ''}
                   </h3>`;

    if (modifications.length > 0) {
      modHtml += `<div class="pending-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:15px;">
        ${modifications.map(m => `
          <div class="kpi-card" style="padding:15px; border-top:3px solid var(--accent-purple); box-shadow: 0 4px 20px rgba(168, 85, 247, 0.1);">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
              <div>
                <div style="font-weight:700; color:var(--text-primary); font-size:0.95rem;">${m.taskName}</div>
                <div style="font-size:0.75rem; color:var(--text-muted);">From: <span style="color:var(--accent-purple); font-weight:600;">${m.requestedBy}</span></div>
              </div>
              <span class="task-badge ${m.type === 'delete' ? 'badge-overdue' : 'badge-in-progress'}" style="padding:2px 8px; font-size:0.6rem; border-radius:12px; letter-spacing:0.05em;">${m.type.toUpperCase()}</span>
            </div>
            ${m.type === 'edit' ? `
              <div style="font-size:0.75rem; color:var(--text-muted); background:rgba(168,85,247,0.05); padding:10px; border-radius:6px; border:1px solid rgba(168,85,247,0.1);">
                <div style="color:var(--accent-purple); font-weight:700; margin-bottom:6px; font-size:0.65rem; text-transform:uppercase; letter-spacing:0.05em;">New Values:</div>
                <div style="display:grid; grid-template-columns: 70px 1fr; gap:6px;">
                  <span>Task:</span> <span style="color:var(--text-primary); font-weight:600;">${m.newData.taskName}</span>
                  <span>Type:</span> <span style="color:var(--text-primary);">${m.newData.taskType}</span>
                  <span>Due:</span> <span style="color:var(--text-primary);">${m.newData.plannedDate} ${m.newData.time ? `at ${m.newData.time}` : ''}</span>
                </div>
              </div>
            ` : m.type === 'shift' ? `
              <div style="font-size:0.75rem; color:var(--text-muted); background:rgba(79,70,229,0.05); padding:10px; border-radius:6px; border:1px solid rgba(79,70,229,0.1);">
                <div style="color:var(--accent-indigo); font-weight:700; margin-bottom:6px; font-size:0.65rem; text-transform:uppercase; letter-spacing:0.05em;">Transfer Details:</div>
                <div style="display:grid; grid-template-columns: 80px 1fr; gap:6px;">
                  <span>Assign To:</span> <span style="color:var(--text-primary); font-weight:600;">${m.newData.newAssignee}</span>
                  <span>Type:</span> <span style="color:var(--text-primary);">${m.newData.shiftMode} ${m.newData.shiftMode === 'temporary' ? `(${m.newData.shiftDays} days)` : ''}</span>
                </div>
              </div>
            ` : `
              <div style="font-size:0.75rem; color:var(--accent-red); padding:10px; background:rgba(239,68,68,0.05); border-radius:6px; border:1px solid rgba(239,68,68,0.1); display:flex; align-items:center; gap:8px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                Requesting permanent deletion.
              </div>
            `}
            
            ${m.newData && m.newData.reason ? `
              <div style="margin-top:10px; font-size:0.75rem; color:var(--text-secondary); background:rgba(255,255,255,0.03); padding:10px; border-radius:6px; border:1px solid var(--border-glass);">
                <div style="font-weight:700; color:var(--text-dim); font-size:0.6rem; text-transform:uppercase; margin-bottom:4px;">Reason:</div>
                <div style="font-style:italic;">"${m.newData.reason}"</div>
              </div>
            ` : ''}

            <div style="display:flex; gap:10px; margin-top:15px;">
              <button class="btn-success btn-sm approve-mod-btn" data-id="${m.id}" style="flex:1; padding:10px; font-size:0.8rem;">Approve</button>
              <button class="btn-danger btn-sm reject-mod-btn" data-id="${m.id}" style="flex:1; padding:10px; font-size:0.8rem; background:none; border:1px solid rgba(239,68,68,0.3); color:var(--accent-red);">Reject</button>
            </div>
          </div>`).join('')}
      </div>`;
    } else {
      modHtml += `<div style="padding:30px; text-align:center; color:var(--text-dim); border:2px dashed var(--border-glass); border-radius:var(--radius-lg); font-size:0.85rem; background:rgba(255,255,255,0.02);">
                    <div style="font-size:1.5rem; margin-bottom:10px; opacity:0.3;">📋</div>
                    No pending task change requests.
                  </div>`;
    }
    modSec.innerHTML = modHtml;
    container.appendChild(modSec);
  }

  // 0. Workflow Health (Process Coordinator & Admin)
  if (healthData && (state.userRole === 'admin' || state.userRole === 'process_coordinator')) {
    const healthSec = document.createElement('div');
    healthSec.className = 'workflow-health-card';

    const stuckList = healthData.stuckTasksList || [];
    const overdueList = healthData.longOverdueList || [];

    healthSec.innerHTML = `
      <h3 style="margin-bottom:15px; font-size:1rem; color:var(--accent-purple);">Workflow Health Report</h3>

      <!-- Stuck Tasks -->
      <div class="health-item health-item-clickable" onclick="toggleHealthDetail('health-stuck-detail')">
        <span class="health-label">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px; opacity:0.6; vertical-align:middle;"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
          Stuck Tasks
        </span>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="health-value ${healthData.stuckTasks > 0 ? 'danger' : 'good'}">${healthData.stuckTasks}</span>
          ${stuckList.length > 0 ? `<svg class="health-chevron" id="chevron-health-stuck-detail" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.5; transition:transform 0.2s;"><polyline points="6 9 12 15 18 9"/></svg>` : ''}
        </div>
      </div>
      <div id="health-stuck-detail" class="health-task-detail" style="display:none;">
        ${stuckList.length === 0
        ? `<div class="health-detail-empty">No stuck tasks right now 🎉</div>`
        : stuckList.map(t => renderHealthTaskCard(t)).join('')}
      </div>

      <!-- Long-overdue Tasks -->
      <div class="health-item health-item-clickable" onclick="toggleHealthDetail('health-overdue-detail')" style="margin-top:4px;">
        <span class="health-label">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px; opacity:0.6; vertical-align:middle;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Long-overdue Tasks (&gt;48h)
        </span>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="health-value ${healthData.longOverdue > 2 ? 'danger' : healthData.longOverdue > 0 ? 'warning' : 'good'}">${healthData.longOverdue}</span>
          ${overdueList.length > 0 ? `<svg class="health-chevron" id="chevron-health-overdue-detail" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.5; transition:transform 0.2s;"><polyline points="6 9 12 15 18 9"/></svg>` : ''}
        </div>
      </div>
      <div id="health-overdue-detail" class="health-task-detail" style="display:none;">
        ${overdueList.length === 0
        ? `<div class="health-detail-empty">No long-overdue tasks 🎉</div>`
        : overdueList.map(t => renderHealthTaskCard(t)).join('')}
      </div>

      <!-- Bottleneck Members -->
      <div class="health-item" style="margin-top:4px;">
        <span class="health-label">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px; opacity:0.6; vertical-align:middle;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          Bottleneck Members (≥3 Overdue)
        </span>
        <span class="health-value ${healthData.bottleneckUsers.length > 0 ? 'warning' : 'good'}">
          ${healthData.bottleneckUsers.length > 0 ? healthData.bottleneckUsers.join(', ') : 'None'}
        </span>
      </div>
    `;
    container.appendChild(healthSec);
  }

  // 0. Admin Actions Bar
  if (state.userRole === 'admin') {
    const adminActions = document.createElement('div');
    adminActions.className = 'admin-actions-bar';
    adminActions.style = 'display:flex; gap:10px; margin-bottom:20px; flex-wrap:wrap;';
    adminActions.innerHTML = `
      <button class="btn-secondary" id="btn-reset-passwords">Reset All Passwords</button>
      <button class="btn-danger" id="btn-cleanup-tasks" style="background:none; border:1px solid rgba(239,68,68,0.3); color:var(--accent-red);">Cleanup Old Tasks (30d+)</button>
    `;
    container.appendChild(adminActions);
    $('btn-reset-passwords')?.addEventListener('click', handleResetAllPasswords);
    $('btn-cleanup-tasks')?.addEventListener('click', handleCleanupOldTasks);
  }

  // Process Coordinator & Admin Actions
  const roleLower = state.userRole?.toLowerCase();
  const isPrivileged = roleLower === 'admin' || roleLower === 'coordinator' || roleLower === 'process_coordinator';
  if (isPrivileged) {
    const processActions = document.createElement('div');
    processActions.className = 'admin-actions-bar';
    processActions.style = 'display:flex; gap:10px; margin-bottom:20px; flex-wrap:wrap;';
    processActions.innerHTML = `
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; width:100%;">
        <button class="btn-primary" id="btn-view-all-tasks" style="justify-content:center;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:8px;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
          View All
        </button>
        <button class="btn-secondary" id="btn-add-global-task" style="justify-content:center;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:8px;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          Add Task
        </button>
      </div>
    `;
    container.appendChild(processActions);
    $('btn-view-all-tasks')?.addEventListener('click', () => handleViewAllTasks());
    $('btn-add-global-task')?.addEventListener('click', () => openAddTaskModal());
  }

  // 2. Pending Approvals & Leaves (Admin only)
  if (state.userRole === 'admin') {
    const pendingSec = document.createElement('div');
    pendingSec.className = 'dashboard-section';

    let html = '';
    if (pendingMembers.length > 0) {
      html += `<h3 style="margin-bottom:15px; font-size:1rem; color:var(--accent-amber);">Pending Approvals (${pendingMembers.length})</h3>
               <div class="pending-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:15px; margin-bottom:20px;">
                 ${pendingMembers.map(m => `<div class="kpi-card" style="display:flex; justify-content:space-between; align-items:center; padding:15px; border:1px solid var(--border-glass);">
                   <div><div style="font-weight:600; color:var(--text-primary);">${m.name}</div><div style="font-size:0.75rem; color:var(--text-muted);">${m.email}</div></div>
                   <div style="display:flex; gap:10px;">
                     <button class="btn-success btn-sm approve-member-btn" data-email="${m.email}" style="display:flex; align-items:center; gap:6px;">
                       <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                       Approve
                     </button>
                     <button class="btn-danger btn-sm reject-member-btn" data-email="${m.email}" style="display:flex; align-items:center; gap:6px; background:none; border:1px solid rgba(239,68,68,0.3); color:var(--accent-red);">
                       <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                       Reject
                     </button>
                   </div>
                 </div>`).join('')}
               </div>`;
    }

    const pendingLeaves = leaves.filter(l => l.status === 'pending');
    if (pendingLeaves.length > 0) {
      html += `<h3 style="margin-bottom:15px; font-size:1rem; color:var(--accent-indigo);">Leave Requests (${pendingLeaves.length})</h3>
               <div class="pending-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:15px;">
                 ${pendingLeaves.map(l => `<div class="kpi-card" style="padding:15px;">
                   <div style="display:flex; justify-content:space-between;"><strong>${l.user}</strong><span style="font-size:0.75rem;">${l.startDate}</span></div>
                   <div style="font-size:0.85rem; color:var(--text-muted); margin:8px 0;">
                     ${l.reason || 'No reason provided'}
                     ${l.taskBuddy ? `<div style="margin-top:4px; color:var(--accent-purple); font-weight:600;">Buddy: ${l.taskBuddy}</div>` : ''}
                   </div>
                   <div style="display:flex; gap:8px;"><button class="btn-success btn-sm approve-leave-btn" data-user="${l.user}" data-created="${l.createdAt}">Approve</button></div>
                 </div>`).join('')}
               </div>`;
    }

    if (html) {
      pendingSec.innerHTML = html;
      container.appendChild(pendingSec);
    }
  }

  // 2. KPIs & Performance
  if (!scores || scores.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No performance data available yet.';
    container.appendChild(empty);
  } else {
    // KPI Row
    const totalAssigned = scores.reduce((sum, s) => sum + (s.tasksAssigned || 0), 0);
    const totalComp = scores.reduce((sum, s) => sum + (s.tasksCompleted || 0), 0);
    const rate = totalAssigned > 0 ? Math.min(100, Math.round((totalComp / totalAssigned) * 100)) : 0;

    const kpiRow = document.createElement('div');
    kpiRow.className = 'kpi-grid';
    kpiRow.innerHTML = `
      <div class="kpi-card"><div class="kpi-value purple">${scores.length}</div><div class="kpi-label">Team Members</div></div>
      <div class="kpi-card"><div class="kpi-value emerald">${rate}%</div><div class="kpi-label">Overall Completion</div></div>
      <div class="kpi-card"><div class="kpi-value amber">${totalAssigned - totalComp}</div><div class="kpi-label">Outstanding Tasks</div></div>
    `;
    container.appendChild(kpiRow);

    // Leaderboard
    const grid = document.createElement('div');
    grid.className = 'dashboard-grid';
    grid.style.marginTop = '20px';
    const sorted = [...scores].sort((a, b) => (b.score || 0) - (a.score || 0));
    grid.innerHTML = sorted.map((s, idx) => createDashboardCardHTML(s, idx + 1)).join('');
    container.appendChild(grid);
  }

  // 3. Trends (Admin only)
  if (state.userRole === 'admin' && perfData.length > 0) {
    const trendSec = document.createElement('div');
    trendSec.className = 'dashboard-section';
    trendSec.style.marginTop = '30px';
    trendSec.innerHTML = '<h3>Team Progress Trends</h3><div id="perf-chart" class="trend-chart"></div>';
    container.appendChild(trendSec);
    setTimeout(() => initChart(perfData), 100);
  }

  bindApprovalEvents();
  bindLeaveApprovalEvents();
  bindModificationEvents();

  // Animation trigger
  setTimeout(() => {
    document.querySelectorAll('.circular-fill').forEach(ring => {
      const target = ring.getAttribute('data-percentage');
      if (target) ring.style.strokeDasharray = `${target}, 100`;
    });
  }, 50);
}

function toggleHealthDetail(detailId) {
  const detail = document.getElementById(detailId);
  if (!detail) return;
  const isOpen = detail.style.display !== 'none';
  detail.style.display = isOpen ? 'none' : 'block';

  // Rotate chevron arrow
  const chevronId = 'chevron-' + detailId;
  const chevron = document.getElementById(chevronId);
  if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
}

function renderHealthTaskCard(t) {
  const badgeColor = t.status === 'stuck' ? 'var(--accent-amber)' : 'var(--accent-red)';
  const daysLabel = t.daysOverdue ? `<span style="color:var(--accent-red); font-size:0.7rem; font-weight:600;">${t.daysOverdue}d overdue</span>` : '';
  return `
    <div class="health-task-item" onclick="handleViewMemberTasks('${t.assignedTo}')" title="Click to view ${t.assignedTo}'s tasks">
      <div style="flex:1; min-width:0;">
        <div class="health-task-name">${t.taskName}</div>
        <div class="health-task-meta">
          <span style="color:var(--accent-purple); font-weight:600;">@${t.assignedTo}</span>
          ${t.plannedDate ? `<span>• ${formatDate(t.plannedDate)}</span>` : ''}
          ${daysLabel}
        </div>
      </div>
      <span style="background:${badgeColor}22; color:${badgeColor}; padding:2px 8px; border-radius:12px; font-size:0.65rem; font-weight:700; text-transform:uppercase; white-space:nowrap; border:1px solid ${badgeColor}44;">${t.status}</span>
    </div>
  `;
}

function createDashboardCardHTML(s, rank) {
  const total = s.tasksAssigned || 0;
  const comp = s.tasksCompleted || 0;
  const late = s.tasksLate || 0;
  const miss = s.tasksMissed || 0;

  let rawCompPct = total !== 0 ? ((comp - miss) / total * 100) : 0;
  if (rawCompPct > 100) rawCompPct = 100;
  if (rawCompPct < -100) rawCompPct = -100;
  const compPct = Math.round(rawCompPct);

  const compPctStr = total !== 0 ? Math.round(comp / total * 100) : 0;
  const latePctStr = total !== 0 ? Math.round(late / total * 100) : 0;
  const missPctStr = total !== 0 ? Math.round(miss / total * 100) : 0;

  const rankClass = rank <= 3 ? `rank-${rank}-card` : '';

  return `
    <div class="dashboard-card ${rankClass}" style="animation-delay: ${0.1 * Math.min(rank, 10)}s">
      <div class="dashboard-card-header">
        <div class="dashboard-rank rank-${rank}">${rank}</div>
        <div class="avatar avatar-sm">${getInitials(s.name)}</div>
        <div class="dashboard-card-name" onclick="handleViewMemberTasks('${s.name}')" style="cursor:pointer; text-decoration:underline; text-decoration-style:dotted; flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${s.name}">${s.name}</div>
        ${state.userRole === 'admin' ? `
          <button onclick="handleRemoveMemberPrompt('${s.name}', event)" class="member-remove-btn" title="Remove Member">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        ` : ''}
        ${(state.userRole === 'admin' || state.userRole === 'coordinator' || state.userRole === 'process_coordinator') ? `
          <button onclick="handleAdminPenalty('${s.name}', event)" class="member-penalty-btn" title="Give -20 Penalty" style="background:none; border:none; color:var(--accent-red); cursor:pointer; padding:4px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg>
          </button>
        ` : ''}
        <div class="dashboard-card-score" style="display: flex; flex-direction: column; align-items: flex-end; font-size: 0.9rem;">
          <div title="This Week's Score" style="display:flex; align-items:baseline;">
            <span style="font-size:0.6rem; color:var(--text-muted); margin-right:4px;">WEEK</span>
            <strong style="font-size:1.1rem;">${s.score || 0}</strong>
            ${s.negativeWeek ? `<span style="color:var(--accent-red); font-size:0.75rem; margin-left:4px;" title="Week Penalties">(${s.negativeWeek})</span>` : ''}
          </div>
          <div title="Today's Score" style="display:flex; align-items:baseline; margin-top:2px;">
            <span style="font-size:0.6rem; color:var(--text-muted); margin-right:4px;">TODAY</span>
            <span style="color:var(--accent-emerald); font-weight:600;">${s.todayScore || 0}</span>
            ${s.negativeToday ? `<span style="color:var(--accent-red); font-size:0.75rem; margin-left:4px;" title="Today Penalties">(${s.negativeToday})</span>` : ''}
          </div>
          <div title="Overall Score" style="display:flex; align-items:baseline; margin-top:2px;">
            <span style="font-size:0.6rem; color:var(--text-muted); margin-right:4px;">ALL-TIME</span>
            <span style="color:var(--accent-purple); font-weight:600;">${s.overallScore || 0}</span>
            ${s.negativeAllTime ? `<span style="color:var(--accent-red); font-size:0.75rem; margin-left:4px;" title="All-Time Penalties">(${s.negativeAllTime})</span>` : ''}
          </div>
        </div>
      </div>
      
      <div class="circular-chart-container">
        <svg viewBox="0 0 36 36" class="circular-chart">
          <path class="circular-bg"
            d="M18 2.0845
              a 15.9155 15.9155 0 0 1 0 31.831
              a 15.9155 15.9155 0 0 1 0 -31.831"
          />
          <path class="circular-fill"
            data-percentage="${Math.max(0, compPct)}"
            stroke-dasharray="0, 100"
            d="M18 2.0845
              a 15.9155 15.9155 0 0 1 0 31.831
              a 15.9155 15.9155 0 0 1 0 -31.831"
          />
          <text x="18" y="20.35" class="circular-text" style="${compPct < 0 ? 'fill: var(--accent-red);' : ''}">
            ${compPct}%
          </text>
        </svg>
        <div class="chart-stats-info">
          <div class="dashboard-stats-row">
            <span>Completed</span>
            <span class="dashboard-stat-val completed">${comp} <span style="font-size:0.75rem; color:var(--text-muted);">(${compPctStr}%)</span></span>
          </div>
          <div class="dashboard-stats-row">
            <span>Late</span>
            <span class="dashboard-stat-val late">${late} <span style="font-size:0.75rem; color:var(--text-muted);">(${latePctStr}%)</span></span>
          </div>
          <div class="dashboard-stats-row">
            <span>Missed</span>
            <span class="dashboard-stat-val missed">${miss} <span style="font-size:0.75rem; color:var(--text-muted);">(${missPctStr}%)</span></span>
          </div>
          <div class="dashboard-stats-row" style="border-top: 1px dashed rgba(255,255,255,0.05); padding-top: 4px; margin-top: 4px;">
            <span style="color:var(--accent-red); font-size: 0.75rem;">Negative Today</span>
            <span class="dashboard-stat-val" style="color:var(--accent-red); font-size: 0.85rem;">${s.negativeToday || 0}</span>
          </div>
        </div>
      </div>
      <div class="dashboard-stats-row" style="border-top: 1px solid rgba(255,255,255,0.05); padding-top: 8px;">
        <span>Total Assigned</span>
        <span class="dashboard-stat-val">${total}</span>
      </div>
    </div>
  `;
}

function handleExportCSV(scores) {
  if (!scores || scores.length === 0) return;

  const headers = ['Name', 'Score', 'Assigned', 'Completed', 'Late', 'Missed'];
  const rows = scores.map(s => [
    s.name,
    s.score || 0,
    s.tasksAssigned || 0,
    s.tasksCompleted || 0,
    s.tasksLate || 0,
    s.tasksMissed || 0
  ]);

  const csvContent = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `svm_team_analytics_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Exported successfully!');
}

async function handleAdminPenalty(memberName, e) {
  e.stopPropagation();

  // Open the penalty selection modal
  const modal = document.getElementById('admin-penalty-modal');
  if (!modal) return;

  document.getElementById('penalty-member-name').textContent = memberName;
  const listContainer = document.getElementById('penalty-tasks-list');
  listContainer.innerHTML = '<div class="loading-spinner" style="margin: 20px auto;"></div>';
  modal.style.display = 'flex';

  try {
    const res = await apiFetch('getTasks', { user: memberName, all: true });
    if (res.success) {
      // Show only completed tasks to penalize
      const doneTasks = res.data.filter(t => t.status === 'done');

      if (doneTasks.length === 0) {
        listContainer.innerHTML = '<p class="modal-body-text" style="text-align:center;">No completed tasks found for this member.</p>';
      } else {
        listContainer.innerHTML = doneTasks.map(t => `
          <div class="task-card done" style="margin-bottom: 10px; cursor: pointer; border: 1px solid var(--border-glass);" 
               onclick="confirmAdminTaskPenalty('${t.taskId}', '${memberName}', '${t.taskName.replace(/'/g, "\\'")}')">
            <div class="task-info">
              <div class="task-name" style="text-decoration: none;">${t.taskName}</div>
              <div class="task-meta">
                <span class="task-badge">${t.taskType}</span>
                <span class="priority-badge priority-${t.priority.toLowerCase()}">${t.priority}</span>
              </div>
            </div>
          </div>
        `).join('');
      }
    } else {
      listContainer.innerHTML = '<p class="modal-body-text" style="color:var(--accent-red);">Failed to load tasks.</p>';
    }
  } catch (err) {
    listContainer.innerHTML = '<p class="modal-body-text" style="color:var(--accent-red);">Network error.</p>';
  }
}

async function confirmAdminTaskPenalty(taskId, memberName, taskName) {
  if (!confirm(`Are you sure you want to mark "${taskName}" as undone and apply a penalty to ${memberName}?`)) return;

  document.getElementById('admin-penalty-modal').style.display = 'none';
  showToast('Applying penalty...', 'info');

  try {
    const res = await apiFetch('adminTaskPenalty', { taskId, memberName, fromUser: state.currentUser }, 'POST');
    if (res.success) {
      showToast(`Penalty applied to ${memberName}.`);
      openDashboard(); // Refresh dashboard
    } else {
      showToast(res.error || 'Failed to apply penalty', 'error');
    }
  } catch (err) {
    showToast('Network error applying penalty', 'error');
  }
}

function closeDashboard() {
  $('dashboard-modal').style.display = 'none';
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;

    const hours = d.getHours();
    const minutes = d.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours % 12 || 12;
    const mStr = String(minutes).padStart(2, '0');
    const timePart = `${h12}:${mStr} ${ampm}`;

    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();

    if (isToday) {
      return timePart;
    } else {
      const day = String(d.getDate()).padStart(2, '0');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const month = months[d.getMonth()];
      return `${day} ${month}, ${timePart}`;
    }
  } catch (err) {
    return dateStr;
  }
}

// =============================================
// TASK COMPLETION
// =============================================
let lastTaskCompleteTime = 0;

async function handleTaskComplete(taskId) {
  const now = Date.now();
  if (now - lastTaskCompleteTime < CONFIG.TASK_COOLDOWN_MS) {
    showToast('Please wait a moment before marking another task as done.', 'error');
    return;
  }

  const card = document.querySelector(`[data-task-id="${taskId}"]`);
  if (!card || card.classList.contains('done') || card.classList.contains('completing')) return;

  lastTaskCompleteTime = now;

  // Optimistic UI update
  card.classList.add('completing');
  const statusIcon = card.querySelector('.check-icon');
  if (statusIcon) statusIcon.style.opacity = '1';
  const checkbox = card.querySelector('.task-checkbox');
  if (checkbox) checkbox.innerHTML = '<span class="check-icon" style="opacity:1;transform:scale(1)">✓</span>';

  // Update local state
  const task = state.tasks.find(t => t.taskId === taskId);
  if (task) {
    task.status = 'done';
    task.completedDate = new Date().toISOString();
  }

  // After animation, mark as done
  setTimeout(() => {
    card.classList.remove('completing');
    card.classList.add('done');
    card.querySelector('.task-name').style.textDecoration = 'line-through';
    card.querySelector('.task-name').style.color = 'var(--text-muted)';

    // Remove click listener by cloning
    const parent = card.parentNode;
    const clone = card.cloneNode(true);
    parent.replaceChild(clone, card);

    // Update section counts
    updateSectionCounts();
    // Update stats
    if (state.stats) renderStats(state.stats);
    // Update briefing
    renderBriefing(getMockBriefing(state.currentUser, state.tasks));
  }, 600);

  showToast('Task completed.');

  // Check if all done
  const allDone = state.tasks.every(t => t.status === 'done');
  if (allDone) {
    setTimeout(() => showAllDoneCelebration(), 800);
  }

  // Background API call
  try {
    await apiFetch('completeTask', { taskId, user: state.currentUser, completedDate: new Date().toISOString() }, 'POST');
  } catch (err) {
    console.error('Failed to sync completion:', err);
    showToast('Synced locally, will retry', 'error');
  }
}

async function handleUpdateTaskStatus(taskId, status, event) {
  if (event) event.stopPropagation();
  try {
    const task = state.tasks.find(t => t.taskId === taskId);
    if (task) task.status = status;

    renderTasks(state.tasks);
    showToast(`Status updated to ${status}`);

    await apiFetch('updateTaskStatus', { taskId, status }, 'POST');
  } catch (err) {
    console.error('Failed to update status:', err);
    showToast('Failed to update status', 'error');
  }
}

async function handleNudgeMember(taskId, memberName, event) {
  if (event) event.stopPropagation();

  const comment = `Process Coordinator Nudge: Please update the status of this task or report any blockers.`;

  try {
    showToast(`Nudging ${memberName}...`);
    await apiFetch('addTaskComment', {
      taskId: taskId,
      user: state.currentUser,
      text: comment
    }, 'POST');

    showToast(`Nudge sent to ${memberName}`);
    // Refresh tasks
    if (state.currentView === 'tasks') {
      const res = await apiFetch('getTasks', { user: state.tasksFilterUser, all: !state.tasksFilterUser ? 'true' : 'false' });
      if (res.success) {
        state.tasks = res.data;
        renderTasks(state.tasks);
      }
    }
  } catch (err) {
    console.error('Failed to nudge:', err);
    showToast('Failed to send nudge', 'error');
  }
}

async function handleViewAllTasks() {
  state.currentView = 'tasks';
  state.currentGlobalView = true;

  const dash = $('admin-dashboard-container');
  if (dash) dash.style.display = 'none';
  const taskView = $('task-view-container');
  if (taskView) taskView.style.display = 'block';

  // Show monitoring header
  const monHeader = $('monitoring-header');
  if (monHeader) {
    monHeader.style.display = 'flex';
    $('monitoring-user-name').textContent = 'Team Overview: All Tasks';
  }

  $('stats-section').style.display = 'none';
  $('briefing-section').style.display = 'none';

  const content = $('recurring-section');
  if (content) content.innerHTML = '<div class="loading-spinner" style="margin: 3rem auto;"></div>';

  try {
    showToast('Loading all tasks...');
    const res = await apiFetch('getTasks', { all: 'true' });
    if (res.success) {
      state.tasks = res.data;
      renderTasks(state.tasks);
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      $('tab-tasks')?.classList.add('active');
    }
  } catch (err) {
    console.error('Failed to view all tasks:', err);
    showToast('Failed to load tasks', 'error');
  }
}

async function handleViewMemberTasks(userName) {
  state.currentView = 'tasks';
  state.tasksFilterUser = userName;
  state.currentGlobalView = false;

  const dash = $('admin-dashboard-container');
  if (dash) dash.style.display = 'none';
  const taskView = $('task-view-container');
  if (taskView) taskView.style.display = 'block';

  // Show monitoring header
  const monHeader = $('monitoring-header');
  if (monHeader) {
    monHeader.style.display = 'flex';
    $('monitoring-user-name').textContent = `Monitoring Tasks: ${userName}`;
  }

  $('stats-section').style.display = 'none';
  $('briefing-section').style.display = 'none';

  const content = $('recurring-section');
  if (content) content.innerHTML = '<div class="loading-spinner" style="margin: 3rem auto;"></div>';

  try {
    showToast(`Loading tasks for ${userName}...`);
    const res = await apiFetch('getTasks', { user: userName });
    if (res.success) {
      state.tasks = res.data;
      renderTasks(state.tasks);
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      $('tab-tasks')?.classList.add('active');
    }
  } catch (err) {
    console.error('Failed to view member tasks:', err);
    showToast('Failed to load tasks', 'error');
  }
}

let pendingRemoveMemberName = null;

function handleRemoveMemberPrompt(memberName, event) {
  if (event) event.stopPropagation();

  pendingRemoveMemberName = memberName;
  $('delete-member-target-name').textContent = memberName;
  $('delete-member-confirm-name-hint').textContent = memberName;
  $('delete-member-confirm-input').value = '';
  $('delete-member-confirm-btn').disabled = true;

  // Populate successors
  const select = $('delete-member-transfer-to');
  if (select) {
    select.innerHTML = '<option value="" disabled selected>Select Successor</option>';
    state.teamMembers
      .filter(m => m.name !== memberName && (m.active === true || m.active === 'TRUE'))
      .forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.name;
        opt.textContent = m.name;
        select.appendChild(opt);
      });
  }

  $('delete-member-modal').style.display = 'flex';
}

function closeDeleteMemberModal() {
  $('delete-member-modal').style.display = 'none';
  pendingRemoveMemberName = null;
}

async function handleDeleteMemberSubmit() {
  const successor = $('delete-member-transfer-to').value;
  const confirmName = $('delete-member-confirm-input').value.trim();

  if (!successor) {
    showToast('Please select a successor to take over tasks.', 'error');
    return;
  }

  if (confirmName.toLowerCase() !== pendingRemoveMemberName.toLowerCase()) {
    showToast('Confirmation name does not match.', 'error');
    return;
  }

  const btn = $('delete-member-confirm-btn');
  btn.disabled = true;
  btn.textContent = 'Removing...';

  try {
    showToast(`Removing ${pendingRemoveMemberName}...`);
    const res = await apiFetch('removeMember', {
      name: pendingRemoveMemberName,
      transferTo: successor
    }, 'POST');

    if (res.success) {
      showToast(`${pendingRemoveMemberName} removed. Tasks transferred to ${successor}.`);
      closeDeleteMemberModal();
      openDashboard();
    } else {
      throw new Error(res.error);
    }
  } catch (err) {
    console.error('Failed to remove member:', err);
    showToast('Removal failed: ' + (err.message || 'Unknown error'), 'error');
    btn.disabled = false;
    btn.textContent = 'Remove & Transfer';
  }
}

function handleExitMonitoring() {
  state.tasksFilterUser = null;
  state.currentGlobalView = false;
  $('monitoring-header').style.display = 'none';
  initForUser(state.currentUser);
}

function updateSectionCounts() {
  document.querySelectorAll('.task-section').forEach(section => {
    const cards = section.querySelectorAll('.task-card');
    const done = section.querySelectorAll('.task-card.done');
    const countEl = section.querySelector('.section-count');
    if (countEl) countEl.textContent = `${done.length}/${cards.length} done`;
  });
}

// =============================================
// CELEBRATIONS
// =============================================
function showAllDoneCelebration() {
  // Add celebration UI after the task sections
  const existing = document.querySelector('.all-done');
  if (existing) return;

  const div = document.createElement('div');
  div.className = 'all-done';
  div.innerHTML = `
    <h3>All tasks complete!</h3>
    <p>You're on fire today. Great work!</p>
  `;
  $('onetime-section').after(div);

  // Fire confetti
  launchConfetti();
}

function launchConfetti() {
  const canvas = $('confetti-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const pieces = [];
  const colors = ['#7c3aed', '#10b981', '#f59e0b', '#3b82f6', '#ef4444', '#ec4899', '#f97316'];

  for (let i = 0; i < 100; i++) {
    pieces.push({
      x: Math.random() * canvas.width,
      y: -Math.random() * canvas.height,
      w: Math.random() * 10 + 5,
      h: Math.random() * 6 + 3,
      color: colors[Math.floor(Math.random() * colors.length)],
      speed: Math.random() * 3 + 2,
      angle: Math.random() * 360,
      spin: (Math.random() - 0.5) * 8,
      opacity: 1,
    });
  }

  let frame = 0;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;

    pieces.forEach(p => {
      p.y += p.speed;
      p.angle += p.spin;
      p.x += Math.sin(p.angle * Math.PI / 180) * 0.5;
      p.opacity -= 0.003;

      if (p.opacity > 0 && p.y < canvas.height + 50) {
        alive = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle * Math.PI / 180);
        ctx.globalAlpha = Math.max(0, p.opacity);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
    });

    frame++;
    if (alive && frame < 300) {
      requestAnimationFrame(draw);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
  draw();
}

// =============================================
// iOS PWA OPTIMIZATION
// =============================================
function detectIOS() {
  return [
    'iPad Simulator',
    'iPhone Simulator',
    'iPod Simulator',
    'iPad',
    'iPhone',
    'iPod'
  ].includes(navigator.platform)
    // iPad on iOS 13 detection
    || (navigator.userAgent.includes("Mac") && "ontouchend" in document);
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
}

function initIOSInstallPrompt() {
  // Only show if it's iOS and NOT already in standalone mode
  if (detectIOS() && !isStandalone()) {
    // Also check if they've already dismissed it in this session
    if (localStorage.getItem('ios_prompt_dismissed')) return;

    const prompt = document.createElement('div');
    prompt.className = 'ios-install-prompt';
    prompt.id = 'ios-install-prompt';
    prompt.innerHTML = `
      <img src="icon-192.png" alt="App Icon" class="ios-install-icon">
      <div class="ios-install-content">
        <h4>Install SVM Tasks</h4>
        <p>Tap <svg class="ios-share-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg> then <strong>"Add to Home Screen"</strong> for a better experience.</p>
      </div>
      <button class="ios-install-close" id="ios-prompt-close" aria-label="Dismiss">✕</button>
    `;

    document.body.appendChild(prompt);

    const closeBtn = prompt.querySelector('#ios-prompt-close');
    const dismissPrompt = () => {
      prompt.style.opacity = '0';
      prompt.style.transform = 'translate(-50%, 20px)';
      setTimeout(() => prompt.remove(), 500);
      localStorage.setItem('ios_prompt_dismissed', 'true');
    };

    closeBtn.addEventListener('click', dismissPrompt);
    closeBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      dismissPrompt();
    }, { passive: false });
  }
}

// =============================================
// MASTER SYLLABUS DATA
// =============================================
const MASTER_SYLLABUS = {
  "9": {
    "Science": [
      "Exploration: Entering the World of Secondary Science",
      "Cell: The Building Block of Life",
      "Tissues in Action",
      "Describing Motion Around Us",
      "Exploring Mixtures and their Separation",
      "How Forces Affect Motion",
      "Work, Energy, and Simple Machines",
      "Journey Inside the Atom",
      "Atomic Foundations of Matter",
      "Sound Waves: Characteristics and Applications",
      "Reproduction: How Life Continues",
      "Patterns in Life: Diversity and Classification",
      "Earth as a System: Energy, Matter, and Life"
    ],
    "Math": [
      "Orienting Yourself: The Use of Coordinates",
      "Introduction to Linear Polynomials",
      "The World of Numbers",
      "Exploring Algebraic Identities",
      "Introduction to Euclid's Geometry",
      "I'm Up and Down, and Round and Round",
      "Measuring Space: Perimeter and Area",
      "The Mathematics of Maybe: Introduction to Probability",
      "Predicting What Comes Next: Exploring Sequences and Progression"
    ]
  },
  "10": {
    "Science": [
      "Chemical Reactions and Equations",
      "Acids, Bases and Salts",
      "Metals and Non-metals",
      "Carbon and its Compounds",
      "Life Processes",
      "Control and Coordination",
      "How do Organisms Reproduce?",
      "Heredity",
      "Light – Reflection and Refraction",
      "The Human Eye and the Colourful World",
      "Electricity",
      "Magnetic Effects of Electric Current",
      "Our Environment",
      "Sources of Energy"
    ],
    "Math": [
      "Real Numbers",
      "Polynomials",
      "Pair of Linear Equations in Two Variables",
      "Quadratic Equations",
      "Arithmetic Progressions",
      "Triangles",
      "Coordinate Geometry",
      "Introduction to Trigonometry",
      "Some Applications of Trigonometry",
      "Circles",
      "Constructions",
      "Areas Related to Circles",
      "Surface Areas and Volumes",
      "Statistics",
      "Probability"
    ]
  }
};

function initTestFormSyllabus() {
  const classSelect = $('test-form-class');
  const subjectSelect = $('test-form-subject');
  const chapterInput = $('test-form-chapter'); // now a hidden input
  const customChapterGroup = $('custom-chapter-group');
  const customChapterInput = $('test-form-custom-chapter');
  const testNameInput = $('test-form-name');

  if (!classSelect || !subjectSelect || !chapterInput) return;

  function updateChapters() {
    const cls = classSelect.value;
    const sub = subjectSelect.value;

    // Reset chapter
    chapterInput.value = '';
    const btn = $('chapter-dropdown-btn');
    const label = $('chapter-dropdown-label');
    if (btn) btn.style.color = 'var(--text-muted)';
    if (label) label.textContent = '-- Select Chapter --';
    customChapterGroup.style.display = 'none';
    customChapterInput.value = '';
    customChapterInput.removeAttribute('required');

    const menu = $('chapter-dropdown-menu');
    if (!menu) return;
    menu.innerHTML = `<div class="chapter-option chapter-placeholder" data-value="" onclick="selectChapterOption(this)">-- Select Chapter --</div>`;

    if (!cls || !sub) { updateTestName(); return; }

    const chapters = (MASTER_SYLLABUS[cls] && MASTER_SYLLABUS[cls][sub]) || [];
    chapters.forEach(ch => {
      const div = document.createElement('div');
      div.className = 'chapter-option';
      div.dataset.value = ch;
      div.textContent = ch;
      div.onclick = () => selectChapterOption(div);
      menu.appendChild(div);
    });

    // Custom option
    const customDiv = document.createElement('div');
    customDiv.className = 'chapter-option custom-option';
    customDiv.dataset.value = 'custom';
    customDiv.textContent = '✏️ Custom Chapter...';
    customDiv.onclick = () => selectChapterOption(customDiv);
    menu.appendChild(customDiv);

    updateTestName();
  }

  function updateTestName() {
    const sub = subjectSelect.value;
    const ch = chapterInput.value;
    if (!sub || !ch) { testNameInput.value = ''; return; }
    let chName = ch === 'custom' ? (customChapterInput.value.trim() || 'Custom') : ch;
    const subName = sub === 'Math' ? 'Maths' : sub;
    testNameInput.value = `${subName} - ${chName}`;
  }

  classSelect.addEventListener('change', updateChapters);
  subjectSelect.addEventListener('change', updateChapters);
  customChapterInput.addEventListener('input', updateTestName);

  // Expose updateTestName for selectChapterOption
  window._updateTestFormName = updateTestName;

  // Close chapter dropdown on outside click
  document.addEventListener('click', function (e) {
    const wrapper = $('chapter-dropdown-wrapper');
    if (wrapper && !wrapper.contains(e.target)) {
      const menu = $('chapter-dropdown-menu');
      if (menu) menu.style.display = 'none';
      const chev = $('chapter-dropdown-chevron');
      if (chev) chev.style.transform = '';
    }
  });
}

window.toggleChapterDropdown = function () {
  const menu = $('chapter-dropdown-menu');
  const chev = $('chapter-dropdown-chevron');
  if (!menu) return;
  const isOpen = menu.style.display !== 'none';
  menu.style.display = isOpen ? 'none' : 'block';
  if (chev) chev.style.transform = isOpen ? '' : 'rotate(180deg)';
};

window.selectChapterOption = function (el) {
  const value = el.dataset.value;
  const label = $('chapter-dropdown-label');
  const btn = $('chapter-dropdown-btn');
  const input = $('test-form-chapter');
  const customGroup = $('custom-chapter-group');
  const customInput = $('test-form-custom-chapter');

  // Highlight active using CSS class
  document.querySelectorAll('.chapter-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');

  if (label) label.textContent = value ? el.textContent : '-- Select Chapter --';
  if (btn) btn.style.color = value ? 'var(--text-primary)' : '';
  if (input) input.value = value;

  // Handle custom chapter
  if (value === 'custom') {
    if (customGroup) customGroup.style.display = 'block';
    if (customInput) { customInput.setAttribute('required', 'true'); customInput.focus(); }
  } else {
    if (customGroup) customGroup.style.display = 'none';
    if (customInput) { customInput.value = ''; customInput.removeAttribute('required'); }
  }

  // Close menu
  const menu = $('chapter-dropdown-menu');
  if (menu) menu.style.display = 'none';
  const chev = $('chapter-dropdown-chevron');
  if (chev) chev.style.transform = '';

  // Update test name
  if (window._updateTestFormName) window._updateTestFormName();
};

// =============================================
// INITIALIZATION
// =============================================
async function init() {
  applyTheme();
  initIOSInstallPrompt();
  initTestFormSyllabus();

  // Shift Mode Toggle
  document.querySelectorAll('input[name="shift-mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const daysGroup = $('shift-days-group');
      if (daysGroup) daysGroup.style.display = (e.target.value === 'temporary') ? 'block' : 'none';
    });
  });

  try {
    const teamRes = await apiFetch('getTeam');
    state.teamMembers = teamRes.data || [];
  } catch (err) {
    console.error('Could not load team data:', err);
    if (CONFIG.DEMO_MODE) state.teamMembers = MOCK_TEAM;
  } finally {
    const loader = $('loading-screen');
    if (loader) loader.classList.add('hidden');
  }

  // Check for local session
  const savedSession = localStorage.getItem('svm_session');
  if (savedSession) {
    try {
      const userData = JSON.parse(savedSession);
      handleUserSignedIn(userData);
    } catch (e) {
      handleUserSignedOut();
    }
  } else {
    handleUserSignedOut();
  }
}

async function initForUser(user) {
  if (!user) return;
  state.currentUser = user;
  hideError();

  // 1. Load from cache immediately — tasks show right away, no blank flash
  const cacheKey = `svm_cache_${user}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      const { tasks, stats, briefing } = JSON.parse(cached);
      if (tasks && tasks.length > 0) {
        state.tasks = tasks;
        renderTasks(state.tasks);
      }
      if (stats) {
        state.stats = stats;
        renderStats(state.stats);
      }
      if (briefing) {
        state.briefing = briefing;
        renderBriefing(state.briefing);
      }
    } catch (e) {
      console.warn('Cache load failed', e);
    }
  }

  // 2. Show briefing skeleton ONLY if we don't have a cached briefing
  if (!state.briefing) {
    renderBriefingSkeleton();
  }

  try {
    // Fetch tasks, stats and team in parallel — no sequential blocking
    const [tasksRes, statsRes, teamRes] = await Promise.all([
      apiFetch('getTasks', { user }),
      apiFetch('getScores', { user }),
      apiFetch('getTeam'),
    ]);

    state.tasks = tasksRes.data || [];
    state.stats = statsRes.data;
    state.teamMembers = teamRes.data || [];

    // Render fresh tasks
    if (state.tasks.length === 0) {
      renderEmptyState();
    } else {
      renderTasks(state.tasks);
    }

    // Render stats
    renderStats(state.stats);

    // Briefing: try AI API first, fall back to local — non-blocking
    apiFetch('getBriefing', { user })
      .then(briefRes => {
        state.briefing = briefRes.data.briefing;
        renderBriefing(state.briefing);
      })
      .catch(() => {
        state.briefing = getMockBriefing(user, state.tasks);
        renderBriefing(state.briefing);
      })
      .finally(() => {
        // Update cache after briefing resolves
        localStorage.setItem(cacheKey, JSON.stringify({
          tasks: state.tasks,
          stats: state.stats,
          briefing: state.briefing,
          timestamp: Date.now()
        }));
      });

  } catch (err) {
    console.error('Fetch error:', err);
    // If we have cached tasks, don't show a hard error — just warn
    if (state.tasks && state.tasks.length > 0) {
      showToast('Showing cached tasks (Server unreachable)', 'warning');
    } else {
      showError('Could not load tasks. Please check your connection.');
    }
  }
}

/**
 * Silent background refresh — fetches new task data WITHOUT wiping the DOM.
 * Only patches tasks whose status or data actually changed.
 * Called by the background sync interval to avoid the "tasks vanishing" flash.
 */
let _syncInProgress = false;
async function silentRefreshTasks(user) {
  if (!user || _syncInProgress) return;
  if (state.currentView !== 'tasks' || state.tasksFilterUser || state.currentGlobalView) return;

  _syncInProgress = true;
  try {
    const [tasksRes, statsRes] = await Promise.all([
      apiFetch('getTasks', { user }),
      apiFetch('getScores', { user }),
    ]);

    if (!tasksRes.success) return;

    const freshTasks = tasksRes.data || [];
    const oldTaskMap = new Map(state.tasks.map(t => [t.taskId, t]));
    const freshTaskMap = new Map(freshTasks.map(t => [t.taskId, t]));

    // Detect changes: new tasks added, old tasks removed, or status changed
    let hasStructuralChange = freshTasks.length !== state.tasks.length;
    if (!hasStructuralChange) {
      for (const [id, fresh] of freshTaskMap) {
        const old = oldTaskMap.get(id);
        if (!old || old.status !== fresh.status) {
          hasStructuralChange = true;
          break;
        }
      }
    }

    // Update state regardless
    state.tasks = freshTasks;
    if (statsRes.success) state.stats = statsRes.data;

    if (hasStructuralChange) {
      // Re-render tasks — only when something actually changed
      if (state.tasks.length === 0) {
        renderEmptyState();
      } else {
        renderTasks(state.tasks);
      }
      if (state.stats) renderStats(state.stats);
    } else {
      // Nothing changed — just silently update stats bar
      if (state.stats) renderStats(state.stats);
    }

    // Update cache quietly
    const cacheKey = `svm_cache_${user}`;
    const existing = localStorage.getItem(cacheKey);
    const briefing = existing ? (JSON.parse(existing).briefing || state.briefing) : state.briefing;
    localStorage.setItem(cacheKey, JSON.stringify({
      tasks: state.tasks,
      stats: state.stats,
      briefing,
      timestamp: Date.now()
    }));
  } catch (err) {
    // Silent fail — don't show errors on background refresh
    console.warn('Background sync failed silently:', err);
  } finally {
    _syncInProgress = false;
  }
}

function renderEmptyState() {
  const section = $('recurring-section');
  section.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">✓</div>
      <h3>No tasks for today!</h3>
      <p>Enjoy your free time or check back later.</p>
    </div>
  `;
  section.style.display = 'block';
}

// =============================================
// ADD TASK
// =============================================
// ============ RECURRENCE UI HELPERS ============
function populateRecurrenceDays() {
  const select = $('recurrence-day-val');
  if (!select) return;
  let html = '';
  for (let i = 1; i <= 31; i++) {
    let suffix = 'th';
    if (i === 1 || i === 21 || i === 31) suffix = 'st';
    else if (i === 2 || i === 22) suffix = 'nd';
    else if (i === 3 || i === 23) suffix = 'rd';
    html += `<option value="${i}">${i}${suffix}</option>`;
  }
  select.innerHTML = html;
}

function updateRecurrenceValue() {
  const type = $('recurrence-type-select').value;
  const val = $('recurrence-val').value || 1;
  const day = $('recurrence-day-val').value || 1;
  const weekday = $('recurrence-weekday-val').value || 1;

  let pattern = '';
  if (type === 'dayOfMonth') {
    pattern = `dayOfMonth:${day}`;
  } else if (type === 'dayOfWeek') {
    pattern = `dayOfWeek:${weekday}`;
  } else {
    const unit = type.split(':')[1];
    pattern = `interval:${val}:${unit}`;
  }
  $('new-task-recurrence').value = pattern;
}

function syncRecurrenceUI() {
  const type = $('recurrence-type-select').value;
  const intervalRow = $('recurrence-interval-row');
  const dayRow = $('recurrence-day-row');
  const weekdayRow = $('recurrence-weekday-row');

  if (type === 'dayOfMonth') {
    if (intervalRow) intervalRow.style.display = 'none';
    if (weekdayRow) weekdayRow.style.display = 'none';
    if (dayRow) dayRow.style.display = 'flex';
  } else if (type === 'dayOfWeek') {
    if (intervalRow) intervalRow.style.display = 'none';
    if (dayRow) dayRow.style.display = 'none';
    if (weekdayRow) weekdayRow.style.display = 'flex';
  } else {
    if (intervalRow) intervalRow.style.display = 'flex';
    if (dayRow) dayRow.style.display = 'none';
    if (weekdayRow) weekdayRow.style.display = 'none';
    const unit = type.split(':')[1];
    if ($('recurrence-suffix')) $('recurrence-suffix').textContent = unit.charAt(0).toUpperCase() + unit.slice(1);
  }
  updateRecurrenceValue();
}

function setRecurrenceUI(pattern) {
  if (!pattern || pattern === 'one-time') return;

  if (pattern.startsWith('interval:')) {
    const parts = pattern.split(':');
    $('recurrence-type-select').value = `interval:${parts[2]}`;
    $('recurrence-val').value = parts[1];
  } else if (pattern.startsWith('dayOfMonth:')) {
    $('recurrence-type-select').value = 'dayOfMonth';
    $('recurrence-day-val').value = pattern.split(':')[1];
  } else if (pattern.startsWith('dayOfWeek:')) {
    $('recurrence-type-select').value = 'dayOfWeek';
    $('recurrence-weekday-val').value = pattern.split(':')[1];
  } else if (pattern === 'daily') {
    $('recurrence-type-select').value = 'interval:days';
    $('recurrence-val').value = 1;
  } else if (pattern === 'weekly') {
    $('recurrence-type-select').value = 'interval:weeks';
    $('recurrence-val').value = 1;
  }
  syncRecurrenceUI();
}

function openAddTaskModal(defaultAssignee = null) {
  state.editingTaskId = null; // Clear edit mode
  const modal = $('add-task-modal');
  if (!modal) return;
  $('add-task-form').reset();
  $('task-modal-title').textContent = defaultAssignee ? `Assign to ${defaultAssignee}` : 'Add New Task';
  $('add-task-submit').textContent = 'Add Task';

  // Set default date to today
  $('new-task-date').value = getTodayStr();
  $('new-task-time').value = '';
  $('planned-date-group').style.display = 'none'; // Default is Daily
  $('planned-time-group').style.display = 'block';

  // Populate days 1-31
  populateRecurrenceDays();

  // Handle type change
  $('new-task-type').onchange = (e) => {
    const type = e.target.value;
    $('planned-date-group').style.display = (type === 'one-time') ? 'block' : 'none';
    $('recurrence-pattern-group').style.display = (type === 'recurring') ? 'block' : 'none';

    if (type === 'daily') $('new-task-recurrence').value = 'daily';
    else if (type === 'weekly') $('new-task-recurrence').value = 'weekly';
    else if (type === 'one-time') $('new-task-recurrence').value = 'one-time';
    else if (type === 'recurring') syncRecurrenceUI();
  };

  // Recurrence UI events
  $('recurrence-type-select').onchange = syncRecurrenceUI;
  $('recurrence-val').oninput = updateRecurrenceValue;
  $('recurrence-day-val').onchange = updateRecurrenceValue;
  $('recurrence-weekday-val').onchange = updateRecurrenceValue;

  // Initialize UI
  syncRecurrenceUI();

  if ($('change-reason-group')) $('change-reason-group').style.display = 'none';
  if ($('change-reason')) $('change-reason').value = '';

  if (state.userRole === 'admin' || state.userRole === 'coordinator') {
    $('admin-assign-group').style.display = 'block';
    loadAssigneeList(defaultAssignee);
  } else {
    $('admin-assign-group').style.display = 'none';
  }

  modal.style.display = 'flex';
}

function openAddTaskForMember(name) {
  openAddTaskModal(name);
}

function loadAssigneeList(defaultAssignee = null) {
  const select = $('new-task-assigned-to');
  if (!select) return;

  const populate = (members) => {
    select.innerHTML = members.map(m => `<option value="${m.name}" ${m.name === defaultAssignee ? 'selected' : ''}>${m.name}</option>`).join('');
    if (defaultAssignee) select.value = defaultAssignee;
  };

  if (state.teamMembers && state.teamMembers.length > 0) {
    populate(state.teamMembers);
  } else {
    apiFetch('getTeam').then(res => {
      if (res.success && res.data) {
        state.teamMembers = res.data;
        populate(res.data);
      }
    });
  }
}

// Voice Recognition
function startVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast('Voice recognition not supported in this browser', 'error');
    return;
  }

  const recognition = new SpeechRecognition();
  const btn = $('voice-btn');
  const input = $('new-task-name');

  recognition.lang = 'en-US';
  recognition.interimResults = false;

  recognition.onstart = () => {
    btn.classList.add('listening');
    showToast('Listening...', 'info');
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    input.value = transcript;
    btn.classList.remove('listening');
  };

  recognition.onerror = (event) => {
    btn.classList.remove('listening');
    showToast('Voice recognition error: ' + event.error, 'error');
  };

  recognition.onend = () => {
    btn.classList.remove('listening');
  };

  recognition.start();
};

function openEditTaskModal(taskId) {
  const task = state.tasks.find(t => t.taskId === taskId);
  if (!task) return;

  state.editingTaskId = taskId;
  $('task-modal-title').textContent = 'Edit Task';
  $('add-task-submit').textContent = 'Save Changes';
  $('add-task-modal').style.display = 'flex';

  $('new-task-name').value = task.taskName;
  $('new-task-type').value = task.taskType;
  $('new-task-date').value = task.plannedDate;
  $('new-task-time').value = task.time || '';
  $('new-task-notes').value = task.notes || '';
  $('new-task-priority').value = task.priority || 'Medium';

  // Admin/Coordinator reassignment
  if (state.userRole === 'admin' || state.userRole === 'coordinator') {
    $('admin-assign-group').style.display = 'block';
    $('new-task-assigned-to').value = task.assignedTo;
  } else {
    $('admin-assign-group').style.display = 'none';
  }

  // Ensure date group is visible if it's a one-time task
  $('planned-date-group').style.display = (task.taskType === 'one-time') ? 'block' : 'none';
  $('recurrence-pattern-group').style.display = (task.taskType === 'recurring') ? 'block' : 'none';

  if (task.taskType === 'recurring') {
    populateRecurrenceDays();
    setRecurrenceUI(task.recurrence);
  }

  // Show reason field for members
  if (state.userRole === 'member') {
    $('change-reason-group').style.display = 'block';
    $('change-reason').value = '';
  } else {
    $('change-reason-group').style.display = 'none';
  }
}

function closeAddTaskModal() {
  $('add-task-modal').style.display = 'none';
}

async function handleTaskSubmit(e) {
  e.preventDefault();
  const name = $('new-task-name').value.trim();
  const type = $('new-task-type').value;
  const date = $('new-task-date').value || getTodayStr();
  const time = $('new-task-time').value || '';
  const notes = $('new-task-notes').value.trim();
  const priority = $('new-task-priority').value;
  const recurrence = $('new-task-recurrence').value.trim() || type;

  if (!name) return;

  const submitBtn = $('add-task-submit');
  const isEdit = !!state.editingTaskId;
  submitBtn.disabled = true;
  submitBtn.textContent = isEdit ? 'Saving...' : 'Adding...';

  try {
    const action = isEdit ? 'editTask' : 'addTask';

    let assignedToUser;
    if (state.userRole === 'admin' || state.userRole === 'coordinator') {
      // Admins/Coordinators pick from dropdown
      assignedToUser = $('new-task-assigned-to').value;
    } else {
      // Members edit their own tasks or add for themselves
      if (isEdit) {
        const task = state.tasks.find(t => t.taskId === state.editingTaskId);
        assignedToUser = task ? task.assignedTo : state.currentUser;
      } else {
        assignedToUser = state.currentUser;
      }
    }

    const payload = {
      taskName: name,
      taskType: type,
      plannedDate: date,
      time: time,
      notes: notes,
      priority: priority,
      assignedTo: assignedToUser,
      recurrence: recurrence
    };
    if (isEdit) payload.taskId = state.editingTaskId;

    // If it's a member trying to edit, send for approval instead
    if (isEdit && state.userRole === 'member') {
      const reason = $('change-reason').value.trim();
      if (!reason) {
        showToast('Please provide a reason for the change', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save Changes';
        return;
      }

      payload.reason = reason; // Include reason in payload for approval
      showToast('Edit request sent for approval');
      await apiFetch('requestTaskChange', {
        taskId: state.editingTaskId,
        type: 'edit',
        newData: payload,
        requestedBy: state.currentUser
      }, 'POST');
      closeAddTaskModal();
      return;
    }

    const res = await apiFetch(action, payload, 'POST');

    if (isEdit) {
      const idx = state.tasks.findIndex(t => t.taskId === state.editingTaskId);
      if (idx !== -1) {
        state.tasks[idx] = { ...state.tasks[idx], ...payload };
      }
      showToast('Task updated.');
    } else {
      const newTask = {
        taskId: res.data.taskId,
        ...payload,
        completedDate: '',
        status: 'pending'
      };
      state.tasks.push(newTask);
      showToast('Task added.');
    }

    renderTasks(state.tasks);
    if (state.stats) renderStats(state.stats);
    closeAddTaskModal();
  } catch (err) {
    console.error('Failed to submit task:', err);
    showToast('Failed to save task', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = isEdit ? 'Save Changes' : 'Add Task';
  }
}

// =============================================
// DELETE TASK
// =============================================
let pendingDeleteTaskId = null;

function showDeleteConfirm(taskId, taskName) {
  pendingDeleteTaskId = taskId;
  $('delete-task-name').textContent = `"${taskName}" will be permanently removed.`;

  if (state.userRole === 'member') {
    $('delete-reason-group').style.display = 'block';
    $('delete-reason').value = '';
  } else {
    $('delete-reason-group').style.display = 'none';
  }

  $('delete-confirm-modal').style.display = 'flex';
}

function closeDeleteConfirm() {
  pendingDeleteTaskId = null;
  $('delete-confirm-modal').style.display = 'none';
}

async function handleManualGenerateTasks() {
  const btn = $('btn-generate-recurring');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = 'Generating...';

  try {
    const res = await apiFetch('generateRecurringTasks', {}, 'POST');
    if (!res.success) throw new Error(res.error);
    showToast(res.message || 'Recurring tasks generated for today!');
    openDashboard(); // Refresh
  } catch (err) {
    showToast(err.message || 'Failed to generate tasks.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

async function handleResetAllPasswords() {
  if (!confirm('Are you sure you want to reset ALL user passwords to Admin@12345 / Member@12345? This cannot be undone.')) return;

  const btn = $('btn-reset-passwords');
  const originalText = btn.textContent;
  btn.textContent = 'Resetting...';
  btn.disabled = true;

  try {
    const res = await apiFetch('resetAllPasswords', {}, 'POST');
    if (!res.success) throw new Error(res.error);
    showToast('All passwords have been reset to defaults.');
  } catch (err) {
    showToast(err.message || 'Failed to reset passwords.', 'error');
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

async function handleCleanupOldTasks() {
  if (!confirm('Are you sure? This will permanently delete all DONE and MISSED tasks older than 30 days.')) return;

  const btn = $('btn-cleanup-tasks');
  const originalText = btn.textContent;

  try {
    btn.disabled = true;
    btn.textContent = 'Cleaning up...';

    const res = await apiFetch('cleanupTasks', {}, 'POST');
    if (res.success) {
      showToast(`Success! Deleted ${res.count} old tasks.`);
      // Refresh if we are in a view that might have changed
      if (state.currentView === 'all-tasks') handleViewAllTasks();
      else if (state.currentView === 'team') renderDashboard();
    }
  } catch (err) {
    console.error('Cleanup failed:', err);
    showToast('Cleanup failed', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

async function handleDeleteTask() {
  if (!pendingDeleteTaskId) return;
  const taskId = pendingDeleteTaskId;
  if (state.userRole === 'member') {
    const reason = $('delete-reason').value.trim();
    if (!reason) {
      showToast('Please provide a reason for deletion', 'error');
      // Don't close modal yet
      $('delete-confirm-modal').style.display = 'flex';
      return;
    }

    try {
      showToast('Deletion request sent for approval...');
      await apiFetch('requestTaskChange', {
        taskId,
        type: 'delete',
        newData: { reason }, // Store reason in newData
        requestedBy: state.currentUser
      }, 'POST');
      closeDeleteConfirm();
    } catch (err) {
      console.error('Failed to request deletion:', err);
      showToast('Request failed', 'error');
    }
    return;
  }

  closeDeleteConfirm();

  // Optimistic removal from UI (Admin/Coord only)
  const card = document.querySelector(`[data-task-id="${taskId}"]`);
  if (card) {
    card.style.transition = 'all 0.3s ease';
    card.style.transform = 'translateX(100%)';
    card.style.opacity = '0';
    setTimeout(() => card.remove(), 300);
  }

  // Remove from local state
  state.tasks = state.tasks.filter(t => t.taskId !== taskId);

  // Update counts and stats
  setTimeout(() => {
    updateSectionCounts();
    if (state.stats) renderStats(state.stats);
    renderBriefing(getMockBriefing(state.currentUser, state.tasks));

    // Re-render if sections are now empty
    const recurring = state.tasks.filter(t => t.taskType === 'daily' || t.taskType === 'weekly');
    const oneTime = state.tasks.filter(t => t.taskType === 'one-time');
    if (recurring.length === 0) $('recurring-section').style.display = 'none';
    if (oneTime.length === 0) $('onetime-section').style.display = 'none';
    if (state.tasks.length === 0) renderEmptyState();
  }, 350);

  showToast('Task deleted.');

  // Background API call
  try {
    await apiFetch('deleteTask', { taskId, user: state.currentUser }, 'POST');
  } catch (err) {
    console.error('Failed to sync deletion:', err);
    showToast('Deleted locally, sync failed', 'error');
  }
}

// =============================================
// SHIFT TASK
// =============================================
let pendingShiftTaskId = null;

async function openShiftTaskModal(taskId) {
  pendingShiftTaskId = taskId;

  const assigneeSelect = $('shift-task-assignee');
  assigneeSelect.innerHTML = '';

  // Find current task to exclude current owner
  const task = state.tasks.find(t => t.taskId === taskId);
  const currentOwner = task ? task.assignedTo : '';

  state.teamMembers.forEach(m => {
    if (m.name !== currentOwner && (m.active === true || m.active === 'TRUE')) {
      const opt = document.createElement('option');
      opt.value = m.name;
      opt.textContent = m.name;
      assigneeSelect.appendChild(opt);
    }
  });

  if (assigneeSelect.options.length === 0) {
    showToast('No other active members available for transfer', 'error');
    return;
  }

  document.querySelector('input[name="shift-mode"][value="permanent"]').checked = true;
  $('shift-days-group').style.display = 'none';
  $('shift-days').value = 1;

  $('shift-task-modal').style.display = 'flex';
}

function closeShiftTaskModal() {
  pendingShiftTaskId = null;
  $('shift-task-modal').style.display = 'none';
}



// =============================================
// TASK COMMENTS
// =============================================
let activeCommentTaskId = null;

function openCommentsModal(taskId) {
  const task = state.tasks.find(t => t.taskId === taskId);
  if (!task) return;

  activeCommentTaskId = taskId;
  $('comments-task-name').textContent = `Comments: ${task.taskName}`;
  $('comments-modal').style.display = 'flex';
  renderComments(task.comments || []);
  $('new-comment-text').value = '';
  setTimeout(() => $('new-comment-text').focus(), 100);
}

function closeCommentsModal() {
  $('comments-modal').style.display = 'none';
  activeCommentTaskId = null;
}

function renderComments(comments) {
  const list = $('comments-list');
  if (comments.length === 0) {
    list.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-muted); font-size: 0.85rem;">No comments yet. Start the conversation!</div>';
    return;
  }

  list.innerHTML = comments.map(c => `
    <div style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: var(--radius-sm); border: 1px solid var(--border-glass);">
      <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
        <span style="font-weight: 700; font-size: 0.75rem; color: var(--accent-purple);">${c.user}</span>
        <span style="font-size: 0.65rem; color: var(--text-muted);">${formatTime(c.timestamp)}</span>
      </div>
      <div style="font-size: 0.85rem; line-height: 1.4;">${c.text}</div>
    </div>
  `).join('');

  // Scroll to bottom
  list.scrollTop = list.scrollHeight;
}

async function handleCommentSubmit() {
  const text = $('new-comment-text').value.trim();
  if (!text || !activeCommentTaskId) return;

  const btn = $('comment-submit-btn');
  btn.disabled = true;
  btn.textContent = '...';

  try {
    await apiFetch('addTaskComment', {
      taskId: activeCommentTaskId,
      user: state.currentUser,
      text: text
    }, 'POST');

    // Update local state
    const task = state.tasks.find(t => t.taskId === activeCommentTaskId);
    if (task) {
      if (!task.comments) task.comments = [];
      task.comments.push({
        user: state.currentUser,
        text: text,
        timestamp: new Date().toISOString()
      });
      renderComments(task.comments);

      // Update the card visually (the bubble count)
      const card = document.querySelector(`[data-task-id="${activeCommentTaskId}"]`);
      if (card) {
        // Just re-render the whole list for simplicity or find the indicator
        renderTasks(state.tasks);
      }
    }

    $('new-comment-text').value = '';
    $('new-comment-text').focus();
  } catch (err) {
    showToast('Failed to post comment', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send';
  }
}

// Event Listeners for Comments
$('comments-close-btn')?.addEventListener('click', closeCommentsModal);
$('comment-submit-btn')?.addEventListener('click', handleCommentSubmit);
$('new-comment-text')?.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleCommentSubmit();
});
async function handleShiftTaskSubmit() {
  if (!pendingShiftTaskId) return;
  const assigneeSelect = $('shift-task-assignee');
  const newAssignee = assigneeSelect.value;
  if (!newAssignee) return;

  const taskId = pendingShiftTaskId;
  const shiftMode = document.querySelector('input[name="shift-mode"]:checked').value;
  const shiftDays = parseInt($('shift-days').value) || 1;

  // If it's a member trying to shift, send for approval instead
  if (state.userRole === 'member') {
    const btn = $('shift-confirm-btn');
    btn.disabled = true;
    btn.textContent = 'Sending...';

    try {
      showToast('Transfer request sent for approval');
      await apiFetch('requestTaskChange', {
        taskId: taskId,
        type: 'shift',
        newData: {
          newAssignee: newAssignee,
          shiftMode: shiftMode,
          shiftDays: shiftDays,
          fromUser: state.currentUser
        },
        requestedBy: state.currentUser
      }, 'POST');
      closeShiftTaskModal();
    } catch (err) {
      showToast('Failed to send request.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Confirm Transfer';
    }
    return;
  }

  const btn = $('shift-confirm-btn');
  btn.disabled = true;
  btn.textContent = 'Transferring...';

  try {
    await apiFetch('shiftTask', {
      taskId: taskId,
      fromUser: state.currentUser,
      newAssignee: newAssignee,
      shiftMode: shiftMode,
      shiftDays: shiftDays
    }, 'POST');

    // Update local task state (remove from current view as it's no longer yours)
    const taskIdx = state.tasks.findIndex(t => t.taskId === taskId);
    if (taskIdx !== -1) {
      state.tasks.splice(taskIdx, 1);
      const card = document.querySelector(`[data-task-id="${taskId}"]`);
      if (card) {
        card.style.transition = 'all 0.3s ease';
        card.style.transform = 'translateX(100%)';
        card.style.opacity = '0';
        setTimeout(() => card.remove(), 300);
      }
    }

    setTimeout(() => {
      updateSectionCounts();
      if (state.tasks.length === 0) renderEmptyState();
    }, 350);

    showToast(`Task transferred to ${newAssignee}. 5 point penalty applied.`, 'warning');
    closeShiftTaskModal();
  } catch (err) {
    showToast('Failed to transfer task.', 'error');
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Transfer';
  }
}

// =============================================
// EVENT LISTENERS
// =============================================
document.addEventListener('DOMContentLoaded', init);

$('refresh-btn')?.addEventListener('click', () => {
  if (state.currentUser) {
    showToast('Refreshing...');
    initForUser(state.currentUser);
  }
});

$('logout-btn')?.addEventListener('click', () => {
  const confirmed = confirm('Are you sure you want to sign out?');
  if (!confirmed) return;

  localStorage.removeItem('svm_session');
  showToast('Signed out successfully');
  setTimeout(() => location.reload(), 500); // Small delay for toast
});

$('retry-btn')?.addEventListener('click', () => {
  hideError();
  init();
});

// Header navigation tabs
$('tab-my-tasks')?.addEventListener('click', () => switchView('tasks'));
$('tab-team')?.addEventListener('click', () => switchView('team'));
$('header-add-task')?.addEventListener('click', () => openAddTaskModal());
$('header-view-all')?.addEventListener('click', () => handleViewAllTasks());

async function switchView(view) {
  if (state.currentView === view && view === 'team') return; // Already there
  state.currentView = view;

  // 1. Update Tab Highlighting immediately
  const myTasksTab = $('tab-my-tasks');
  const teamTab = $('tab-team');

  if (view === 'tasks') {
    myTasksTab?.classList.add('active');
    teamTab?.classList.remove('active');
    $('task-view-container').style.display = 'block';
    $('admin-dashboard-container').style.display = 'none';
    await initForUser(state.currentUser);
  } else {
    myTasksTab?.classList.remove('active');
    teamTab?.classList.add('active');
    $('task-view-container').style.display = 'none';
    $('admin-dashboard-container').style.display = 'block';
    await openDashboard();
  }
}

// Add Task modal
$('modal-close-btn')?.addEventListener('click', closeAddTaskModal);
$('add-task-form')?.addEventListener('submit', handleTaskSubmit);
$('add-task-modal')?.addEventListener('click', (e) => {
  if (e.target === $('add-task-modal')) closeAddTaskModal();
});

// Delete confirmation
$('delete-cancel-btn')?.addEventListener('click', closeDeleteConfirm);
$('delete-confirm-btn')?.addEventListener('click', handleDeleteTask);
$('delete-confirm-modal')?.addEventListener('click', (e) => {
  if (e.target === $('delete-confirm-modal')) closeDeleteConfirm();
});

// Member Removal
$('delete-member-confirm-input')?.addEventListener('input', (e) => {
  const val = e.target.value.trim();
  $('delete-member-confirm-btn').disabled = (val.toLowerCase() !== pendingRemoveMemberName?.toLowerCase());
});
$('delete-member-confirm-btn')?.addEventListener('click', handleDeleteMemberSubmit);
$('delete-member-cancel-btn')?.addEventListener('click', closeDeleteMemberModal);
$('delete-member-close-btn')?.addEventListener('click', closeDeleteMemberModal);
$('delete-member-modal')?.addEventListener('click', (e) => {
  if (e.target === $('delete-member-modal')) closeDeleteMemberModal();
});

// Shift Task confirmation
$('shift-cancel-btn')?.addEventListener('click', closeShiftTaskModal);
$('shift-cancel-btn-top')?.addEventListener('click', closeShiftTaskModal);
$('shift-confirm-btn')?.addEventListener('click', handleShiftTaskSubmit);
$('shift-task-modal')?.addEventListener('click', (e) => {
  if (e.target === $('shift-task-modal')) closeShiftTaskModal();
});

// Authentication
$('auth-toggle-btn')?.addEventListener('click', (e) => {
  e.preventDefault();
  toggleAuthMode();
});
$('auth-form')?.addEventListener('submit', handleAuthSubmit);
$('auth-reset-btn')?.addEventListener('click', openResetPasswordModal);
$('reset-close-btn')?.addEventListener('click', closeResetPasswordModal);

// OTP Reset Listeners
$('btn-send-otp')?.addEventListener('click', handleSendOTP);
$('btn-verify-reset')?.addEventListener('click', handleVerifyAndReset);
$('btn-back-to-step1')?.addEventListener('click', () => {
  $('reset-step-1').style.display = 'block';
  $('reset-step-2').style.display = 'none';
});

$('reset-password-modal')?.addEventListener('click', (e) => {
  if (e.target === $('reset-password-modal')) closeResetPasswordModal();
});

// Dashboard
$('btn-export-dashboard')?.addEventListener('click', () => {
  const tableData = state.teamMembers.map(m => {
    const stats = currentDashboardScores.find(s => s.name === m.name) || {};
    return { ...m, ...stats };
  });
  handleExportCSV(tableData);
});

$('btn-reset-passwords')?.addEventListener('click', async () => {
  if (!confirm('Are you sure you want to reset ALL member passwords to Member@12345? (Admin will be Admin@12345)')) return;

  try {
    const res = await apiFetch('resetAllPasswords', { fromUser: state.currentUser }, 'POST');
    if (res.success) {
      showToast('All passwords have been reset successfully!', 'success');
    } else {
      throw new Error(res.error);
    }
  } catch (err) {
    showToast('Failed to reset passwords: ' + err.message, 'error');
  }
});

// Bulk Import
$('btn-import-tasks')?.addEventListener('click', () => $('bulk-upload-file').click());
$('bulk-upload-file')?.addEventListener('change', handleBulkUpload);

async function handleBulkUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (evt) => {
    try {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const json = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

      if (json.length === 0) {
        showToast('File is empty', 'error');
        return;
      }

      // Map headers dynamically
      const tasksToUpload = [];
      for (const row of json) {
        const getVal = (keyFragments) => {
          for (const key of Object.keys(row)) {
            const lowerKey = key.toLowerCase().replace(/[^a-z]/g, '');
            for (const frag of keyFragments) {
              if (lowerKey.includes(frag)) return String(row[key]).trim();
            }
          }
          return '';
        };

        const taskName = getVal(['taskname', 'task', 'name', 'title']);
        const assignedTo = getVal(['assigned', 'to', 'member', 'person']);
        if (!taskName || !assignedTo) continue;

        const typeRaw = getVal(['type', 'frequency']);
        let taskType = 'one-time';
        if (typeRaw.toLowerCase().includes('daily')) taskType = 'daily';
        if (typeRaw.toLowerCase().includes('weekly')) taskType = 'weekly';

        const rawDate = getVal(['date', 'due', 'planned']);
        let plannedDate = getTodayStr();
        if (rawDate) {
          const d = new Date(rawDate);
          if (!isNaN(d.valueOf())) {
            plannedDate = d.toISOString().split('T')[0];
          }
        }

        const time = getVal(['time', 'at', 'hour']);

        const priorityRaw = getVal(['priority', 'importance']);
        let priority = 'Medium';
        if (priorityRaw.toLowerCase().includes('high')) priority = 'High';
        if (priorityRaw.toLowerCase().includes('low')) priority = 'Low';

        const notes = getVal(['note', 'description', 'detail']);

        tasksToUpload.push({
          taskName,
          taskType,
          plannedDate,
          time,
          notes,
          priority,
          assignedTo
        });
      }

      if (tasksToUpload.length === 0) {
        showToast('No valid tasks found. Need "Task Name" and "Assigned To" columns.', 'error');
        return;
      }

      $('bulk-import-overlay').style.display = 'flex';
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < tasksToUpload.length; i++) {
        $('bulk-import-status').textContent = `Processing ${i + 1} / ${tasksToUpload.length} tasks...`;
        try {
          await apiFetch('addTask', tasksToUpload[i], 'POST');
          successCount++;
        } catch (err) {
          console.error('Row failed:', err);
          failCount++;
        }
      }

      $('bulk-import-overlay').style.display = 'none';
      showToast(`Import complete! ${successCount} added.`);

      openDashboard();

    } catch (err) {
      console.error(err);
      showToast('Error parsing file', 'error');
      $('bulk-import-overlay').style.display = 'none';
    } finally {
      $('bulk-upload-file').value = '';
    }
  };
  reader.readAsArrayBuffer(file);
}

// Theme Toggle
$('theme-toggle')?.addEventListener('click', toggleTheme);

// Search & Filter
$('task-search')?.addEventListener('input', (e) => {
  state.filters.search = e.target.value;
  renderTasks(state.tasks);
});

$('status-filter')?.addEventListener('change', (e) => {
  state.filters.status = e.target.value;
  renderTasks(state.tasks);
});

// Approval Logic
function bindApprovalEvents() {
  document.querySelectorAll('.approve-member-btn').forEach(btn => {
    btn.onclick = async () => {
      const email = btn.dataset.email;
      btn.disabled = true;
      btn.textContent = '...';
      await handleReviewMember(email, 'approve');
    };
  });
  document.querySelectorAll('.reject-member-btn').forEach(btn => {
    btn.onclick = async () => {
      const email = btn.dataset.email;
      if (!confirm(`Are you sure you want to reject and delete ${email}?`)) return;

      // Math Challenge
      const n1 = Math.floor(Math.random() * 9) + 2;
      const n2 = Math.floor(Math.random() * 9) + 2;
      const answer = n1 + n2;
      const userInput = prompt(`Verification Required: What is ${n1} + ${n2}? (Confirming rejection of ${email})`);

      if (parseInt(userInput) !== answer) {
        showToast('Incorrect verification answer. Rejection cancelled.', 'error');
        return;
      }

      btn.disabled = true;
      btn.textContent = '...';
      await handleReviewMember(email, 'reject');
    };
  });
}

async function handleReviewMember(email, action) {
  try {
    await apiFetch('approveMember', { email, decision: action }, 'POST');
    showToast(`Member ${action === 'approve' ? 'approved' : 'rejected'}`);
    openDashboard(); // Refresh
  } catch (err) {
    showToast('Action failed', 'error');
  }
}

// Pull-to-refresh (simple)
let touchStartY = 0;
document.addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: true });
document.addEventListener('touchend', e => {
  const diff = e.changedTouches[0].clientY - touchStartY;
  if (diff > 150 && window.scrollY === 0 && state.currentUser) {
    showToast('Refreshing...');
    initForUser(state.currentUser);
  }
}, { passive: true });

// =============================================
// PERFORMANCE CHARTS
// =============================================
let performanceChart = null;

function initChart(perfData) {
  const canvas = document.getElementById('performanceChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (performanceChart) {
    performanceChart.destroy();
  }

  const labels = perfData.map(d => `W${d.week}`);
  const completionRates = perfData.map(d => d.totalAssigned > 0 ? Math.round((d.totalCompleted / d.totalAssigned) * 100) : 0);

  performanceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Team Progress %',
        data: completionRates,
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99, 102, 241, 0.1)',
        borderWidth: 3,
        tension: 0.4,
        fill: true,
        pointBackgroundColor: '#6366f1',
        pointRadius: 4,
        pointHoverRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            label: (ctx) => `Completion: ${ctx.parsed.y}%`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#94a3b8', font: { size: 10 } }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#94a3b8', font: { size: 10 } }
        }
      }
    }
  });
}

// =============================================
// LEAVE MANAGEMENT
// =============================================
function openLeaveModal() {
  const today = new Date().toISOString().split('T')[0];
  $('leave-start-date').value = today;
  $('leave-end-date').value = today;
  $('leave-reason').value = '';

  // Populate Buddy list
  const buddySelect = $('leave-buddy');
  if (buddySelect) {
    buddySelect.innerHTML = '<option value="" disabled selected>Select Buddy</option>';
    if (state.team) {
      state.team
        .filter(m => m.name !== state.currentUser && m.active)
        .forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.name;
          opt.textContent = m.name;
          buddySelect.appendChild(opt);
        });
    }
  }

  $('leave-modal').style.display = 'flex';
}

function closeLeaveModal() {
  $('leave-modal').style.display = 'none';
}

async function handleLeaveSubmit() {
  const startDate = $('leave-start-date').value;
  const endDate = $('leave-end-date').value;
  const reason = $('leave-reason').value.trim();
  const taskBuddy = $('leave-buddy').value;

  if (!startDate || !endDate) {
    showToast('Please select dates', 'error');
    return;
  }

  if (!taskBuddy) {
    showToast('Please select a Task Buddy', 'error');
    return;
  }

  if (!reason) {
    showToast('Please provide a reason for leave', 'error');
    return;
  }

  const btn = $('leave-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Submitting...';

  try {
    showToast('Submitting leave request...');
    await apiFetch('requestLeave', {
      user: state.currentUser,
      startDate,
      endDate,
      reason,
      taskBuddy
    }, 'POST');

    showToast('Leave Submitted Successfully! Admin will review it.');
    closeLeaveModal();
  } catch (err) {
    console.error('Leave submission error:', err);
    showToast('Submission failed: ' + (err.message || 'Server error'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit Request';
  }
}

function bindLeaveApprovalEvents() {
  document.querySelectorAll('.approve-leave-btn').forEach(btn => {
    btn.onclick = () => handleLeaveApproval(btn.dataset.user, btn.dataset.created, 'approved');
  });
  document.querySelectorAll('.reject-leave-btn').forEach(btn => {
    btn.onclick = () => handleLeaveApproval(btn.dataset.user, btn.dataset.created, 'rejected');
  });
}

async function handleLeaveApproval(user, createdAt, status) {
  try {
    await apiFetch('approveLeave', { user, createdAt, status }, 'POST');
    showToast(`Leave request ${status}`);
    openDashboard(); // Refresh
  } catch (err) {
    showToast('Action failed', 'error');
  }
}

// Global listeners for Leave Modal
document.addEventListener('click', e => {
  if (e.target.id === 'open-leave-modal-btn') openLeaveModal();
});
$('leave-close-btn')?.addEventListener('click', closeLeaveModal);
$('leave-cancel-btn')?.addEventListener('click', closeLeaveModal);
$('leave-submit-btn')?.addEventListener('click', handleLeaveSubmit);

// =============================================
// BROADCAST SYSTEM
// =============================================
async function checkBroadcast() {
  try {
    const res = await apiFetch('getLatestBroadcast');
    if (res.data) {
      const { message, createdAt } = res.data;
      const lastDismissed = localStorage.getItem('last_broadcast_dismissed');

      if (lastDismissed !== createdAt) {
        $('broadcast-text').textContent = message;
        $('broadcast-banner').style.display = 'flex';
        $('broadcast-close-btn').onclick = () => {
          $('broadcast-banner').style.display = 'none';
          localStorage.setItem('last_broadcast_dismissed', createdAt);
        };
      }
    }
  } catch (e) {
    console.warn('Broadcast check failed');
  }
}

async function handleSendBroadcast() {
  const msgInput = $('broadcast-input');
  const msg = msgInput.value.trim();
  if (!msg) return;

  const btn = $('btn-send-broadcast');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    await apiFetch('sendBroadcast', { message: msg }, 'POST');
    showToast('Broadcast sent to all users!');
    msgInput.value = '';

    // Also show it locally immediately
    $('broadcast-text').textContent = msg;
    $('broadcast-banner').style.display = 'flex';
    $('broadcast-close-btn').onclick = () => {
      $('broadcast-banner').style.display = 'none';
    };
  } catch (e) {
    showToast('Failed to send broadcast', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send 📢';
  }
}

// Bind global events
document.addEventListener('click', e => {
  if (e.target.id === 'btn-send-broadcast') handleSendBroadcast();
  if (e.target.id === 'voice-close-btn') {
    $('voice-modal').style.display = 'none';
    if (recognition) recognition.stop();
  }
  if (e.target.id === 'btn-confirm-voice-task') confirmVoiceTask();
  if (e.target.id === 'member-actions-close-btn') $('member-actions-modal').style.display = 'none';
  if (e.target.id === 'btn-manual-task-member') {
    $('member-actions-modal').style.display = 'none';
    openAddTaskModal(selectedMember);
  }
  if (e.target.id === 'btn-voice-task-member') {
    $('member-actions-modal').style.display = 'none';
    startVoiceAssistant(selectedMember);
  }
  if (e.target.id === 'btn-view-member-tasks') openMemberTasksModal(selectedMember);
  if (e.target.id === 'member-tasks-close-btn') $('member-tasks-modal').style.display = 'none';
  if (e.target.id === 'btn-add-test') openAddTestModal();
});

// =============================================
// TEST FMS HANDLERS
// =============================================
// Global states for individual stages configuration inside the modal
let currentFormStages = [];

function renderIndividualFormStages() {
  const container = $('individual-test-stages-list');
  if (!container) return;

  const isAdmin = state.userRole === 'admin';
  const isUnlocked = isPipelineEditUnlocked(); // admin-approved temporary unlock
  const canEdit = isAdmin || isUnlocked;       // either permanent (admin) or temporary (approved)

  // Show/hide the + Add Stage button
  const addBtn = document.querySelector('button[onclick="addIndividualTestStageRow()"]');
  if (addBtn) addBtn.style.display = isAdmin ? 'block' : 'none'; // only real admin can add stages

  // Remove any old notice
  const oldNotice = document.getElementById('pipeline-stages-notice');
  if (oldNotice) oldNotice.remove();

  const parent = container.parentElement;

  if (isUnlocked && !isAdmin) {
    // ── UNLOCKED BANNER ──────────────────────────────────────────
    const remaining = state.pipelineUnlockExpiry - Date.now();
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    const notice = document.createElement('div');
    notice.id = 'pipeline-stages-notice';
    notice.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px; background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.3); border-radius:var(--radius-sm); padding:8px 12px; margin-top:6px;';
    notice.innerHTML = `
      <div style="display:flex; align-items:center; gap:6px; font-size:0.75rem; font-weight:600; color:var(--accent-emerald);">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Pipeline unlocked — <span id="pipeline-unlock-countdown">${mins}:${secs.toString().padStart(2, '0')}</span> remaining
      </div>
      <button type="button" onclick="lockPipelineNow()" style="font-size:0.7rem; padding:3px 8px; border:1px solid rgba(16,185,129,0.4); border-radius:4px; background:none; color:var(--accent-emerald); cursor:pointer; font-weight:600;">🔒 Lock Now</button>
    `;
    parent.appendChild(notice);
  } else if (!isAdmin) {
    // ── LOCKED BANNER ────────────────────────────────────────────
    const notice = document.createElement('div');
    notice.id = 'pipeline-stages-notice';
    notice.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px; background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.25); border-radius:var(--radius-sm); padding:8px 12px; margin-top:6px;';
    notice.innerHTML = `
      <div style="display:flex; align-items:center; gap:6px; font-size:0.75rem; font-weight:500; color:var(--accent-amber);">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Stage names &amp; doers require Admin approval. Offset days are always editable.
      </div>
      <button type="button" onclick="requestPipelineApproval()" style="white-space:nowrap; font-size:0.7rem; padding:3px 8px; border:1px solid rgba(245,158,11,0.4); border-radius:4px; background:none; color:var(--accent-amber); cursor:pointer; font-weight:600;">🔐 Request Approval</button>
    `;
    parent.appendChild(notice);
  }

  container.innerHTML = currentFormStages.map((s, idx) => `
    <div class="form-stage-row" data-index="${idx}" draggable="false"
      ondragstart="${isAdmin ? 'handleFormStageDragStart(event)' : 'event.preventDefault()'}"
      ondragover="${isAdmin ? 'handleFormStageDragOver(event)' : ''}"
      ondrop="${isAdmin ? 'handleFormStageDrop(event)' : ''}"
      ondragend="${isAdmin ? 'handleFormStageDragEnd(event)' : ''}"
      style="display:flex; flex-direction:row; align-items:center; flex-wrap:nowrap; gap:6px; margin-bottom:8px; padding:8px; background:rgba(255,255,255,0.015); border:1px solid ${isUnlocked && !isAdmin ? 'rgba(16,185,129,0.25)' : 'var(--border-glass)'}; border-radius:6px; transition:border-color 0.3s;">
      ${isAdmin ? `<div class="drag-handle" onmousedown="enableFormRowDrag(this)" style="flex-shrink:0; color:rgba(255,255,255,0.4); font-size:1.1rem; cursor:grab; line-height:1; padding:0 4px; user-select:none;">☰</div>` : ''}
      <input type="text" class="form-stage-label" value="${s.label || ''}" ${canEdit ? '' : 'readonly disabled'}
        style="flex:2; min-width:0; padding:6px 8px; font-size:0.8rem;
               background:${canEdit ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)'};
               border:1px solid var(--border-glass); border-radius:4px;
               color:${canEdit ? 'var(--text-primary)' : 'var(--text-muted)'};
               cursor:${canEdit ? 'text' : 'not-allowed'};" placeholder="Stage name">
      <input type="number" class="form-stage-offset" value="${s.offset || 0}"
        style="flex:0 0 55px; min-width:0; padding:6px 8px; font-size:0.8rem; font-weight:600;
               background:rgba(255,255,255,0.04);
               border:1px solid var(--accent-purple); border-radius:4px;
               color:var(--text-primary);" title="Offset days — always editable">
      <input type="text" class="form-stage-doer" value="${s.doer || ''}" ${canEdit ? '' : 'readonly disabled'}
        style="flex:1.5; min-width:0; padding:6px 8px; font-size:0.8rem;
               background:${canEdit ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)'};
               border:1px solid var(--border-glass); border-radius:4px;
               color:${canEdit ? 'var(--text-primary)' : 'var(--text-muted)'};
               cursor:${canEdit ? 'text' : 'not-allowed'};" placeholder="Assigned to">
      ${isAdmin ? `<button type="button" onclick="removeIndividualTestStageRow(${idx})" style="flex-shrink:0; background:none; border:none; color:var(--accent-red); cursor:pointer; font-size:1rem; line-height:1; padding:2px 4px;">✕</button>` : ''}
    </div>
  `).join('');
}

window.addIndividualTestStageRow = function () {
  if (state.userRole !== 'admin') {
    showToast('Adding stages requires admin approval.', 'error');
    return;
  }
  saveCurrentFormStagesFromDOM();
  const nextId = currentFormStages.length > 0 ? Math.max(...currentFormStages.map(s => s.id)) + 1 : 1;
  currentFormStages.push({
    id: nextId,
    label: '',
    offset: 0,
    doer: '',
    status: 'pending',
    actualDate: '',
    doneBy: '',
    doneAt: ''
  });
  renderIndividualFormStages();
};

window.removeIndividualTestStageRow = function (idx) {
  if (state.userRole !== 'admin') {
    showToast('Removing stages requires admin approval.', 'error');
    return;
  }
  saveCurrentFormStagesFromDOM();
  currentFormStages.splice(idx, 1);
  renderIndividualFormStages();
};

function saveCurrentFormStagesFromDOM() {
  const rows = document.querySelectorAll('.form-stage-row');
  currentFormStages = Array.from(rows).map((row, idx) => {
    const existing = currentFormStages[idx] || {};
    return {
      id: existing.id || idx + 1,
      label: row.querySelector('.form-stage-label').value.trim(),
      offset: parseInt(row.querySelector('.form-stage-offset').value) || 0,
      doer: row.querySelector('.form-stage-doer').value.trim(),
      status: existing.status || 'pending',
      actualDate: existing.actualDate || '',
      doneBy: existing.doneBy || '',
      doneAt: existing.doneAt || ''
    };
  });
}

let formDraggedIdx = null;

// Enable drag only when user grabs the ☰ handle
window.enableFormRowDrag = function (handle) {
  const row = handle.closest('.form-stage-row');
  if (!row) return;
  row.setAttribute('draggable', 'true');
  // Disable after mouseup so clicking inputs works normally
  document.addEventListener('mouseup', function cleanup() {
    row.setAttribute('draggable', 'false');
    document.removeEventListener('mouseup', cleanup);
  }, { once: true });
};

window.handleFormStageDragStart = function (e) {
  saveCurrentFormStagesFromDOM();
  formDraggedIdx = parseInt(e.currentTarget.getAttribute('data-index'));
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.style.opacity = '0.5';
};

window.handleFormStageDragEnd = function (e) {
  e.currentTarget.style.opacity = '1';
  e.currentTarget.setAttribute('draggable', 'false');
};

window.handleFormStageDragOver = function (e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
};

window.handleFormStageDrop = function (e) {
  e.preventDefault();
  const targetIdx = parseInt(e.currentTarget.getAttribute('data-index'));
  e.currentTarget.style.opacity = '1';

  if (formDraggedIdx !== null && targetIdx !== null && formDraggedIdx !== targetIdx) {
    const [draggedItem] = currentFormStages.splice(formDraggedIdx, 1);
    currentFormStages.splice(targetIdx, 0, draggedItem);
    renderIndividualFormStages();
  }
  formDraggedIdx = null;
};

function openAddTestModal() {
  $('add-test-form').reset();
  $('test-form-held-on').value = getTodayStr();

  // Clear dynamically populated fields
  $('test-form-chapter').value = '';
  const chBtn = $('chapter-dropdown-btn');
  const chLabel = $('chapter-dropdown-label');
  if (chBtn) chBtn.style.color = 'var(--text-muted)';
  if (chLabel) chLabel.textContent = '-- Select Chapter --';
  const chMenu = $('chapter-dropdown-menu');
  if (chMenu) chMenu.innerHTML = '<div class="chapter-option" data-value="" onclick="selectChapterOption(this)" style="padding:9px 12px;font-size:0.82rem;color:var(--text-dim);cursor:pointer;">-- Select Chapter --</div>';
  $('custom-chapter-group').style.display = 'none';
  $('test-form-custom-chapter').value = '';
  $('test-form-custom-chapter').removeAttribute('required');

  // Clear links
  $('test-form-sheet-link').value = '';
  $('test-form-folder-link').value = '';

  // Clear min & avg marks
  $('test-form-min').value = '';
  $('test-form-avg').value = '';

  // Set default type dynamically based on current view
  const isVideoView = state.currentView === 'videos';
  const defaultType = isVideoView ? 'Video' : 'Sheet';
  selectTypeSegment(defaultType);

  // Dynamic Modal Header and Form Groups based on view type
  const modalTitle = $('add-test-modal-title');
  const typeFormGroup = $('test-type-form-group');
  const submitBtn = $('add-test-modal')?.querySelector('button[type="submit"]');

  if (isVideoView) {
    if (modalTitle) modalTitle.textContent = 'Track New Video';
    if (typeFormGroup) typeFormGroup.style.display = 'none'; // Hide type segmented control completely
    if (submitBtn) submitBtn.textContent = 'Start Tracking Video';
  } else {
    if (modalTitle) modalTitle.textContent = 'Track New Test';
    if (typeFormGroup) typeFormGroup.style.display = 'block'; // Show type segmented control
    if (submitBtn) submitBtn.textContent = 'Start Tracking';

    // Under Test FMS, hide the Video option from the segmented control selector
    const videoSegmentBtn = $('type-segment-video');
    if (videoSegmentBtn) videoSegmentBtn.style.display = 'none';
    const sheetSegmentBtn = $('type-segment-sheet');
    if (sheetSegmentBtn) sheetSegmentBtn.style.display = 'block';
    const appSegmentBtn = $('type-segment-app');
    if (appSegmentBtn) appSegmentBtn.style.display = 'block';
  }

  // Pre-populate individual stages with global blueprints
  const blueprint = (state.testSettings || []).filter(s => s.type === defaultType);
  currentFormStages = blueprint.map(s => ({
    id: s.id,
    label: s.label,
    offset: s.offset,
    doer: s.doer,
    status: 'pending',
    actualDate: '',
    doneBy: '',
    doneAt: ''
  }));
  renderIndividualFormStages();

  $('add-test-modal').style.display = 'flex';
}

function closeAddTestModal() {
  $('add-test-modal').style.display = 'none';
}

window.setTestFmsFilter = function (filter) {
  document.querySelectorAll('.test-fms-tabs .tab-btn').forEach(btn => {
    if (btn.getAttribute('data-filter') === filter) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  state.testFmsFilter = filter;
  renderTests(state.tests);
};

window.handleTestFmsSearch = function (query) {
  state.testFmsSearch = (query || '').toLowerCase().trim();
  renderTests(state.tests);
};

window.handleTestFmsSort = function (sortType) {
  state.testFmsSort = sortType;
  renderTests(state.tests);
};

// ── Custom Sort Dropdown ──────────────────────────
const SORT_LABELS = {
  'held-desc': 'Date Held ↓',
  'held-asc': 'Date Held ↑',
  'subject-asc': 'Subject A–Z',
  'subject-desc': 'Subject Z–A',
  'class-asc': 'Class ↑',
  'class-desc': 'Class ↓',
  'max-desc': 'Max Marks ↓',
  'max-asc': 'Max Marks ↑'
};

window.toggleSortDropdown = function () {
  const menu = $('sort-dropdown-menu');
  const chevron = $('sort-dropdown-chevron');
  const isOpen = menu.style.display !== 'none';
  menu.style.display = isOpen ? 'none' : 'block';
  chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
};

window.selectSortOption = function (el) {
  const value = el.getAttribute('data-value');
  // Update active state
  document.querySelectorAll('.sort-option').forEach(o => o.classList.remove('active-sort'));
  el.classList.add('active-sort');
  // Update button label
  const label = $('sort-dropdown-label');
  if (label) label.textContent = SORT_LABELS[value] || value;
  // Close menu
  $('sort-dropdown-menu').style.display = 'none';
  $('sort-dropdown-chevron').style.transform = '';
  // Apply sort
  handleTestFmsSort(value);
};

// Close dropdown when clicking outside
document.addEventListener('click', function (e) {
  const wrapper = $('sort-dropdown-wrapper');
  if (wrapper && !wrapper.contains(e.target)) {
    const menu = $('sort-dropdown-menu');
    if (menu) menu.style.display = 'none';
    const chevron = $('sort-dropdown-chevron');
    if (chevron) chevron.style.transform = '';
  }
});

$('add-test-close-btn')?.addEventListener('click', closeAddTestModal);
$('add-test-form')?.addEventListener('submit', handleAddTestSubmit);
$('test-form-type')?.addEventListener('change', (e) => {
  const selectedType = e.target.value; // 'Sheet' or 'App'
  const blueprint = (state.testSettings || []).filter(s => s.type === selectedType);
  currentFormStages = blueprint.map(s => ({
    id: s.id,
    label: s.label,
    offset: s.offset,
    doer: s.doer,
    status: 'pending',
    actualDate: '',
    doneBy: '',
    doneAt: ''
  }));
  renderIndividualFormStages();
});

async function handleAddTestSubmit(e) {
  e.preventDefault();
  const name = $('test-form-name').value.trim();
  const className = $('test-form-class').value.trim();
  const maxScore = $('test-form-max').value;
  const heldOn = $('test-form-held-on').value;
  const type = $('test-form-type').value;

  const subject = $('test-form-subject').value;
  const chapterSelect = $('test-form-chapter').value;
  const chapter = chapterSelect === 'custom' ? $('test-form-custom-chapter').value.trim() : chapterSelect;

  const sheetLink = $('test-form-sheet-link').value.trim();
  const folderLink = $('test-form-folder-link').value.trim();

  const minScore = $('test-form-min').value.trim();
  const avgScore = $('test-form-avg').value.trim();

  saveCurrentFormStagesFromDOM();

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Starting...';

  try {
    const res = await apiFetch('addTest', {
      testName: name,
      className,
      maxScore,
      heldOn,
      type,
      subject,
      chapter,
      sheetLink,
      folderLink,
      minScore,
      avgScore,
      stages: currentFormStages
    }, 'POST');

    if (res.success) {
      showToast('Test Tracking Started!');
      closeAddTestModal();
      openTestTracker(); // Refresh
    }
  } catch (err) {
    showToast('Failed to start tracking', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Start Tracking';
  }
}

let editingTestTrackerId = null;

function handleEditTestDetailsModal(testId) {
  const test = state.tests.find(t => t.testId === testId);
  if (!test) return;

  editingTestTrackerId = testId;

  // Set dropdowns and fields
  $('test-form-class').value = test.className || '10';
  $('test-form-subject').value = test.subject || '';

  const classVal = $('test-form-class').value;
  const subVal = $('test-form-subject').value;
  // Rebuild chapter custom dropdown for the edit modal
  const chapterHiddenInput = $('test-form-chapter');
  const customChapterGroup = $('custom-chapter-group');
  const customChapterInput = $('test-form-custom-chapter');
  const chMenu = $('chapter-dropdown-menu');
  const chBtn = $('chapter-dropdown-btn');
  const chLabel = $('chapter-dropdown-label');

  chapterHiddenInput.value = '';
  customChapterGroup.style.display = 'none';
  customChapterInput.value = '';
  customChapterInput.removeAttribute('required');
  if (chBtn) chBtn.style.color = 'var(--text-muted)';
  if (chLabel) chLabel.textContent = '-- Select Chapter --';

  if (chMenu) {
    chMenu.innerHTML = `<div class="chapter-option" data-value="" onclick="selectChapterOption(this)" style="padding:9px 12px;font-size:0.82rem;color:var(--text-dim);cursor:pointer;border-left:2px solid transparent;">-- Select Chapter --</div>`;

    if (classVal && subVal) {
      const chapters = (MASTER_SYLLABUS[classVal] && MASTER_SYLLABUS[classVal][subVal]) || [];
      chapters.forEach(ch => {
        const div = document.createElement('div');
        div.className = 'chapter-option';
        div.dataset.value = ch;
        div.textContent = ch;
        div.onclick = () => selectChapterOption(div);
        div.style.cssText = 'padding:9px 12px;font-size:0.82rem;color:var(--text-normal);cursor:pointer;border-left:2px solid transparent;transition:background 0.12s,color 0.12s;';
        chMenu.appendChild(div);
      });

      const customDiv = document.createElement('div');
      customDiv.className = 'chapter-option';
      customDiv.dataset.value = 'custom';
      customDiv.textContent = '✏️ Custom Chapter...';
      customDiv.onclick = () => selectChapterOption(customDiv);
      customDiv.style.cssText = 'padding:9px 12px;font-size:0.82rem;color:var(--accent-purple);cursor:pointer;border-left:2px solid transparent;border-top:1px solid var(--border-glass);';
      chMenu.appendChild(customDiv);

      if (test.chapter) {
        const chapters2 = Array.from(chMenu.querySelectorAll('.chapter-option'));
        if ((MASTER_SYLLABUS[classVal][subVal] || []).includes(test.chapter)) {
          const matchEl = chapters2.find(o => o.dataset.value === test.chapter);
          if (matchEl) selectChapterOption(matchEl);
        } else {
          const customEl = chapters2.find(o => o.dataset.value === 'custom');
          if (customEl) selectChapterOption(customEl);
          customChapterInput.value = test.chapter;
        }
      }
    }
  }

  $('test-form-name').value = test.testName;
  $('test-form-max').value = test.maxScore;
  $('test-form-held-on').value = test.heldOn.substring(0, 10);
  selectTypeSegment(test.type || 'Sheet');

  // Set sheet & folder links
  $('test-form-sheet-link').value = test.sheetLink || '';
  $('test-form-folder-link').value = test.folderLink || '';

  // Set min & avg marks
  $('test-form-min').value = test.minScore || '';
  $('test-form-avg').value = test.avgScore || '';

  // Load individual stages configuration
  currentFormStages = getTestStages(test);
  renderIndividualFormStages();

  const isVideo = (test.type || '').toLowerCase() === 'video';
  const typeFormGroup = $('test-type-form-group');
  if (typeFormGroup) typeFormGroup.style.display = isVideo ? 'none' : 'block';

  if (!isVideo) {
    // Hide Video segment option from segment buttons when editing a test
    const videoSegmentBtn = $('type-segment-video');
    if (videoSegmentBtn) videoSegmentBtn.style.display = 'none';
    const sheetSegmentBtn = $('type-segment-sheet');
    if (sheetSegmentBtn) sheetSegmentBtn.style.display = 'block';
    const appSegmentBtn = $('type-segment-app');
    if (appSegmentBtn) appSegmentBtn.style.display = 'block';
  }

  $('add-test-modal').querySelector('h3').textContent = isVideo ? 'Edit Video Details' : 'Edit Test Details';
  $('add-test-modal').querySelector('button[type="submit"]').textContent = 'Save Changes';

  // Override form submit for edit mode
  const form = $('add-test-form');
  const originalHandler = handleAddTestSubmit;
  form.onsubmit = async (e) => {
    e.preventDefault();

    const className = $('test-form-class').value;
    const subject = $('test-form-subject').value;
    const chapterSel = $('test-form-chapter').value;
    const chapter = chapterSel === 'custom' ? $('test-form-custom-chapter').value.trim() : chapterSel;

    saveCurrentFormStagesFromDOM();

    const payload = {
      testId: editingTestTrackerId,
      testName: $('test-form-name').value.trim(),
      className,
      maxScore: $('test-form-max').value,
      heldOn: $('test-form-held-on').value,
      type: $('test-form-type').value,
      subject,
      chapter,
      sheetLink: $('test-form-sheet-link').value.trim(),
      folderLink: $('test-form-folder-link').value.trim(),
      minScore: $('test-form-min').value.trim(),
      avgScore: $('test-form-avg').value.trim(),
      stages: currentFormStages
    };

    try {
      const res = await apiFetch('editTestDetails', payload, 'POST');
      if (res.success) {
        showToast('Test details updated.');
        closeAddTestModal();
        openTestTracker();
      }
    } catch (err) {
      showToast('Update failed', 'error');
    }
  };

  $('add-test-modal').style.display = 'flex';
}

// Reset modal when closing
function closeAddTestModal() {
  $('add-test-modal').style.display = 'none';
  const defaultHeader = state.currentView === 'videos' ? 'Track New Video' : 'Track New Test';
  const defaultBtn = state.currentView === 'videos' ? 'Start Tracking Video' : 'Start Tracking';
  $('add-test-modal').querySelector('h3').textContent = defaultHeader;
  $('add-test-modal').querySelector('button[type="submit"]').textContent = defaultBtn;
  $('add-test-form').onsubmit = handleAddTestSubmit;
}

// =============================================
// MEMBER ACTIONS
// =============================================
let selectedMember = null;

function openMemberActions(name) {
  selectedMember = name;
  $('member-actions-title').textContent = `${name} Actions`;
  $('member-actions-modal').style.display = 'flex';
}

// =============================================
// AI VOICE ASSISTANT
// =============================================
let recognition = null;

function startVoiceAssistant(preSelectedUser = null) {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    showToast('Speech recognition not supported in this browser', 'error');
    return;
  }

  selectedMember = preSelectedUser;

  $('voice-modal').style.display = 'flex';
  $('voice-status').style.display = 'block';
  $('voice-result').style.display = 'none';
  $('voice-transcript').textContent = 'Speak now...';
  $('voice-instruction').textContent = preSelectedUser ? `Assigning task to ${preSelectedUser}...` : 'Listening...';

  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRec();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (event) => {
    let interimTranscript = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        handleVoiceFinalText(event.results[i][0].transcript);
      } else {
        interimTranscript += event.results[i][0].transcript;
        $('voice-transcript').textContent = interimTranscript;
      }
    }
  };

  recognition.onerror = (event) => {
    $('voice-instruction').textContent = 'Error: ' + event.error;
  };

  recognition.start();
}

async function handleVoiceFinalText(text) {
  $('voice-transcript').textContent = `"${text}"`;
  $('voice-instruction').textContent = 'AI is processing...';

  if (recognition) recognition.stop();

  try {
    const res = await apiFetch('processVoiceTask', { text }, 'POST');
    if (res.success && res.data) {
      const task = res.data;
      $('voice-res-name').value = task.taskName || '';
      $('voice-res-user').value = selectedMember || task.assignee || '';
      $('voice-res-date').value = task.date || '';
      $('voice-res-time').value = task.time || '';
      $('voice-res-type').value = task.type || 'one-time';

      $('voice-status').style.display = 'none';
      $('voice-result').style.display = 'block';
    } else {
      showToast('AI could not parse that task', 'error');
      $('voice-instruction').textContent = 'Could not parse. Try again?';
    }
  } catch (err) {
    showToast('AI Service Busy', 'error');
    $('voice-instruction').textContent = 'Error processing text.';
  }
}

async function confirmVoiceTask() {
  const name = $('voice-res-name').value;
  const user = $('voice-res-user').value;
  const date = $('voice-res-date').value;
  const time = $('voice-res-time').value;
  const type = $('voice-res-type').value;

  if (!name || !user || !date) {
    showToast('All fields required', 'error');
    return;
  }

  const btn = $('btn-confirm-voice-task');
  btn.disabled = true;
  btn.textContent = 'Creating...';

  try {
    await apiFetch('addTask', {
      taskName: name,
      assignedTo: user,
      taskType: type,
      plannedDate: date,
      time: time
    }, 'POST');

    showToast('Task created successfully!');
    $('voice-modal').style.display = 'none';
    openDashboard(); // Refresh
  } catch (err) {
    showToast('Failed to create task', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Task';
  }
}

async function openMemberTasksModal(name) {
  $('member-actions-modal').style.display = 'none';
  $('member-tasks-title').textContent = `${name}'s Tasks`;
  $('member-tasks-list').innerHTML = '<div class="empty-state">Loading tasks...</div>';
  $('member-tasks-modal').style.display = 'flex';

  try {
    const res = await apiFetch('getTasks', { user: name });
    const tasks = res.data || [];

    // Filter to show pending/overdue
    const activeTasks = tasks.filter(t => t.status !== 'done' && t.status !== 'missed');

    if (activeTasks.length === 0) {
      $('member-tasks-list').innerHTML = '<div class="empty-state">No active tasks for this member.</div>';
      return;
    }

    $('member-tasks-list').innerHTML = activeTasks.map(t => `
      <div class="member-task-item">
        <div style="display:flex; justify-content:space-between; align-items:start;">
          <div class="member-task-name">${t.taskName}</div>
          <div style="display:flex; gap:8px;">
             <button onclick="handleEditTask('${t.taskId}')" style="background:none; border:none; color:var(--text-secondary); cursor:pointer; padding:2px;" title="Edit">
               <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
             </button>
             <button onclick="handleDeleteTask('${t.taskId}')" style="background:none; border:none; color:var(--accent-red); cursor:pointer; padding:2px;" title="Delete">
               <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
             </button>
          </div>
        </div>
        <div class="member-task-meta">
          <span>📅 ${t.plannedDate}</span>
          <span class="task-badge badge-${t.taskType}">${t.taskType}</span>
          <span style="color:${t.status === 'overdue' ? 'var(--accent-red)' : 'inherit'}">${t.status}</span>
        </div>
      </div>
    `).join('');
  } catch (err) {
    $('member-tasks-list').innerHTML = '<div class="empty-state">Error loading tasks.</div>';
  }
}

// Synchronization
function startBackgroundSync() {
  setInterval(async () => {
    if (state.currentView === 'tests') {
      const container = $("test-list-content");
      if (container && !container.querySelector('.loading-spinner')) {
        const [settingsRes, testsRes] = await Promise.all([
          apiFetch('getTestSettings'),
          apiFetch('getTests')
        ]);
        if (settingsRes.success) state.testSettings = settingsRes.data;
        if (testsRes.success) state.tests = testsRes.data;
        renderTests(state.tests);
      }
    } else if (state.currentView === 'tasks' && state.currentUser) {
      // Use silent refresh — does NOT wipe/re-render the DOM unless data actually changed
      // This prevents the "tasks vanishing" flash on every sync cycle
      await silentRefreshTasks(state.currentUser);
    }

    // Always check for upcoming tasks if logged in
    if (state.currentUser) {
      checkUpcomingTasks();
    }
  }, 60000); // Sync every 60 seconds
}

function checkUpcomingTasks() {
  if (!("Notification" in window) || Notification.permission !== 'granted') return;
  if (!state.tasks || state.tasks.length === 0) return;

  const now = new Date();

  state.tasks.forEach(task => {
    // Only check active tasks
    if (task.status === 'done' || task.status === 'missed') return;
    if (!task.plannedDate || !task.time) return;

    try {
      // Parse task time. task.time is "HH:mm"
      const [hours, minutes] = task.time.split(':');
      const taskDate = new Date(task.plannedDate);
      taskDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);

      const diffMs = taskDate - now;
      const diffMin = diffMs / (1000 * 60);

      // Notify if task is due in 50-70 minutes (approx 1 hour)
      if (diffMin > 0 && diffMin <= 65) {
        const notifiedKey = `notified_1hr_${task.taskId}_${task.plannedDate}`;
        if (!localStorage.getItem(notifiedKey)) {
          showBrowserNotification(
            `Task Reminder: ${task.taskName}`,
            `This task is due in about 1 hour (${task.time}). Please complete it!`
          );
          localStorage.setItem(notifiedKey, 'true');
        }
      }
    } catch (e) {
      console.error('Error checking task time:', e);
    }
  });
}

function showBrowserNotification(title, body) {
  if (Notification.permission === 'granted') {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(registration => {
        registration.showNotification(title, {
          body,
          icon: 'icon-192.png',
          badge: 'icon-192.png',
          vibrate: [200, 100, 200],
          tag: 'task-reminder'
        });
      });
    } else {
      new Notification(title, { body, icon: 'icon-192.png' });
    }
  }
}

function bindModificationEvents() {
  document.querySelectorAll('.approve-mod-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = parseInt(btn.dataset.id);
      try {
        showToast('Processing approval...');
        await apiFetch('approveTaskChange', { requestId: id, decision: 'approved' }, 'POST');
        showToast('Task modification approved!');

        // Refresh everything
        if (state.currentView === 'tasks') {
          await fetchTasks();
        } else {
          openDashboard();
        }
      } catch (err) {
        showToast('Approval failed: ' + (err.message || 'Unknown error'), 'error');
      }
    };
  });

  document.querySelectorAll('.reject-mod-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = parseInt(btn.dataset.id);
      try {
        showToast('Rejecting request...');
        await apiFetch('approveTaskChange', { requestId: id, decision: 'rejected' }, 'POST');
        showToast('Request rejected');

        if (state.currentView === 'tasks') {
          await fetchTasks();
        } else {
          openDashboard();
        }
      } catch (err) {
        showToast('Rejection failed: ' + (err.message || 'Unknown error'), 'error');
      }
    };
  });
}

// Global Error Handling
window.onerror = function (msg, url, lineNo, columnNo, error) {
  console.error('Production Error:', msg, 'at', lineNo + ':' + columnNo);
  const loader = document.getElementById('loading-screen');
  if (loader) loader.classList.add('hidden');
  return false;
};

window.onunhandledrejection = function (event) {
  console.error('Unhandled Promise Rejection:', event.reason);
  const loader = document.getElementById('loading-screen');
  if (loader) loader.classList.add('hidden');
};

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  try {
    init();
    startBackgroundSync();
  } catch (err) {
    console.error('Initialization failed:', err);
    const loader = document.getElementById('loading-screen');
    if (loader) loader.classList.add('hidden');
  }
});
