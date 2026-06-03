/* ============================================
   SVM Task Tracker — Application Logic
   ============================================ */

// =============================================
// CONFIGURATION
// =============================================
const CONFIG = {
  // Apps Script URL — kept for email/AI/scoring triggers and Sheet sync
  API_URL: 'https://script.google.com/macros/s/AKfycbygVjr3gtJUkUrxsGcLwqq1en4S-7YiNljeviu4XIe016HQZzY_t8fzdFyecRdZpEZp/exec',

  // Supabase — PRIMARY data store
  SUPABASE_URL: 'https://nslhzkthcgjyqlejlrxk.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zbGh6a3RoY2dqeXFsZWpscnhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxOTUzMDYsImV4cCI6MjA5NTc3MTMwNn0.KCXg7pm9gH2ulG7uNtVmJoYKWP2laosAhwnvEfh15V8',

  // Retry settings
  MAX_RETRIES: 2,
  RETRY_DELAY: 1000,

  // Anti-spam settings
  TASK_COOLDOWN_MS: 2000,

  // Demo mode — set to true to use mock data without a backend
  DEMO_MODE: false,
};

// =============================================
// SUPABASE CLIENT (Primary Data Store)
// =============================================
let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  }
  return _supabase;
}

// SHA-256 hash using Web Crypto API (mirrors Apps Script Utilities.computeDigest)
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ISO week number (mirrors Apps Script getISOWeekNumber)
function getISOWeekNum(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// =============================================
// BACKGROUND SHEET SYNC (fire-and-forget)
// =============================================
function syncToSheet(action, data) {
  // Non-blocking — we don't await this
  try {
    const url = new URL(CONFIG.API_URL);
    fetch(url.toString(), {
      method: 'POST',
      redirect: 'follow',
      credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'syncToSheet', syncAction: action, ...data }),
    }).catch(() => { }); // Silently ignore sheet sync errors
  } catch (e) { }
}

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
  ],
  BeforeFee: [
    { id: 20, label: 'Say Hi on Bot Number & Collect Details', offset: 1, doer: 'Sidhi/Komal', type: 'BeforeFee' },
    { id: 21, label: 'Show Orientation Video', offset: 2, doer: 'Sidhi/Komal', type: 'BeforeFee' },
    { id: 22, label: 'Show Classroom', offset: 3, doer: 'Sidhi/Komal', type: 'BeforeFee' },
    { id: 23, label: 'Show Student Dashboard', offset: 4, doer: 'Sidhi/Komal', type: 'BeforeFee' },
    { id: 24, label: 'Show Past Results', offset: 5, doer: 'Sidhi/Komal', type: 'BeforeFee' },
    { id: 25, label: 'Share Fee Structure from Telegram', offset: 6, doer: 'Sidhi/Komal', type: 'BeforeFee' },
  ],
  AfterFee: [
    { id: 26, label: 'Send Admission Confirmation Message', offset: 1, doer: 'Sidhi/Komal', type: 'AfterFee' },
    { id: 27, label: 'Change Name in Telegram', offset: 2, doer: 'Sidhi/Komal', type: 'AfterFee' },
    { id: 28, label: 'Create Leads for Parent and Student', offset: 3, doer: 'Sidhi/Komal', type: 'AfterFee' },
    { id: 29, label: 'Create Lead in Classroom Main', offset: 4, doer: 'Sidhi/Komal', type: 'AfterFee' },
    { id: 30, label: 'Save Contact Number', offset: 5, doer: 'Sidhi/Komal', type: 'AfterFee' },
    { id: 31, label: 'Change Level to Admission Done', offset: 6, doer: 'Sidhi/Komal', type: 'AfterFee' },
    { id: 32, label: 'Send Student Number to Shivang Sir', offset: 7, doer: 'Sidhi/Komal', type: 'AfterFee' },
    { id: 33, label: 'Add Student to Group', offset: 8, doer: 'Sidhi/Komal', type: 'AfterFee' },
    { id: 34, label: 'Send Biometric ID to SVM Group', offset: 9, doer: 'Sidhi/Komal', type: 'AfterFee' },
    { id: 35, label: 'Create Dashboard', offset: 10, doer: 'Sidhi/Komal', type: 'AfterFee' },
    { id: 36, label: 'Activate Class App', offset: 11, doer: 'Sidhi/Komal', type: 'AfterFee' }
  ],
  Parents: [
    { id: 37, label: 'Check Performance in Maths & Science', offset: 1, doer: 'Parents', type: 'Parents' },
    { id: 38, label: 'Ensure Child Understands Concepts', offset: 2, doer: 'Parents', type: 'Parents' },
    { id: 39, label: 'Encourage NCERT Science & Maths Practice', offset: 3, doer: 'Parents', type: 'Parents' },
    { id: 40, label: 'Practice Upadhyay Regularly', offset: 4, doer: 'Parents', type: 'Parents' },
    { id: 41, label: 'Watch Video Lectures for Doubt Solving', offset: 5, doer: 'Parents', type: 'Parents' },
    { id: 42, label: 'Monitor Mobile/Tablet Usage during Study', offset: 6, doer: 'Parents', type: 'Parents' },
    { id: 43, label: 'Discuss Daily Test Scores with Child', offset: 7, doer: 'Parents', type: 'Parents' },
    { id: 44, label: 'Avoid Copying, Focus on Practice & Matching', offset: 8, doer: 'Parents', type: 'Parents' }
  ]
};

/**
 * Validates and repairs state.testSettings against PIPELINE_DEFAULTS.
 * - Correct stage labels / doers are enforced (non-negotiable).
 * - Offset values are preserved from the API (user-editable).
 * - Missing stages are added; extra stages are left as-is (admin additions).
 */
function sanitizeTestSettings() {
  ['Sheet', 'App', 'Video', 'BeforeFee', 'AfterFee', 'Parents'].forEach(type => {
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
  pipelineUnlockTimer: null,    // setInterval ID for countdown
  taskViewMode: 'list',        // 'list' | 'calendar'
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth()
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
// API LAYER — Supabase primary, Apps Script for AI/email
// =============================================
const APPS_SCRIPT_ACTIONS = new Set([
  'getBriefing', 'processVoiceTask', 'generateRecurringTasks', 'recalculateScores',
  'sendResetOTP', 'parseRecurrence', 'resetAllPasswords', 'forgotPassword', 'getWorkflowHealth'
]);

async function apiFetch(action, params = {}, method = 'GET') {
  if (CONFIG.DEMO_MODE) return demoHandler(action, params, method);
  if (APPS_SCRIPT_ACTIONS.has(action)) return apiFetchSheet(action, params, method);
  return supabaseApiFetch(action, params);
}

async function apiFetchSheet(action, params = {}, method = 'GET') {
  const url = new URL(CONFIG.API_URL);
  let options = {};
  if (method === 'GET') {
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    options = { method: 'GET', redirect: 'follow', credentials: 'omit' };
  } else {
    options = {
      method: 'POST', redirect: 'follow', credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...params })
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
      if (attempt < CONFIG.MAX_RETRIES) await sleep(CONFIG.RETRY_DELAY * (attempt + 1));
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
  updateSplashUser('SVM');

  $('auth-overlay').style.display = 'flex';
  $('app-header').style.display = 'none';
  $('app-footer').style.display = 'none';
  $('task-view-container').style.display = 'none';
  $('admin-dashboard-container').style.display = 'none';
  if ($('fms-builder-container')) $('fms-builder-container').style.display = 'none';
  if ($('student-container')) $('student-container').style.display = 'none';
}

function handleUserSignedIn(userData) {
  // Safety check for userData
  if (!userData || !userData.name) {
    handleUserSignedOut();
    return;
  }

  state.currentUser = userData.name;
  state.userRole = (userData.role || 'member').toLowerCase();
  updateSplashUser(userData.name);

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
  if ($('fms-builder-container')) $('fms-builder-container').style.display = 'none';
  if ($('student-container')) $('student-container').style.display = 'none';
  if ($('task-view-container')) $('task-view-container').style.display = 'block';

  renderHeader(state.currentUser);
  initForUser(state.currentUser);

  // Request notification permission
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }

  // Bind tab events dynamically
  renderNavigationTabs();

  // Bind student webhook buttons
  const sendSubmittedBtn = $('btn-send-submitted');
  if (sendSubmittedBtn) {
    sendSubmittedBtn.onclick = () => triggerStudentWebhook('submitted');
  }
  const sendUnsubmittedBtn = $('btn-send-unsubmitted');
  if (sendUnsubmittedBtn) {
    sendUnsubmittedBtn.onclick = () => triggerStudentWebhook('unsubmitted');
  }

  const builderClose = $('custom-fms-builder-close-btn');
  if (builderClose) builderClose.onclick = closeCustomFmsBuilderModal;

  const showCreatorBtn = $('btn-show-fms-creator');
  if (showCreatorBtn) showCreatorBtn.onclick = openCustomFmsCreatorSection;

  const cancelCreatorBtn = $('btn-cancel-fms-blueprint');
  if (cancelCreatorBtn) cancelCreatorBtn.onclick = closeCustomFmsCreatorSection;

  const saveBlueprintBtn = $('btn-save-fms-blueprint');
  if (saveBlueprintBtn) saveBlueprintBtn.onclick = handleFmsBlueprintSubmit;

  checkBroadcast();
}

// =============================================
// DYNAMIC FMS BLUEPRINT BUILDER
// =============================================
// Static FMS types that support the scoring system (max score / min score fields).
// Enquiry FMS (BeforeFee) is intentionally excluded per design.
const FMS_SCORING_ENABLED = new Set(['Sheet', 'App', 'Video', 'AfterFee']);

function getCustomFmsBlueprints() {
  let blueprints = [];
  if (state.testSettings && state.testSettings.length > 0) {
    const blueprintRows = state.testSettings.filter(s => s.type === 'fms_blueprint');
    blueprints = blueprintRows.map(row => {
      try {
        const bp = JSON.parse(row.label);
        bp.id = bp.id || row.stage_id || row.id;
        return bp;
      } catch (e) {
        return null;
      }
    }).filter(Boolean);
    localStorage.setItem('svm_custom_fms_blueprints', JSON.stringify(blueprints));
  } else {
    blueprints = JSON.parse(localStorage.getItem('svm_custom_fms_blueprints') || '[]');
  }
  return blueprints;
}

function renderNavigationTabs() {
  const container = $('header-nav');
  if (!container) return;

  const isPrivileged = ['admin', 'coordinator', 'process_coordinator'].includes(state.userRole);

  let html = `
    <button class="nav-tab ${state.currentView === 'tasks' ? 'active' : ''}" id="tab-my-tasks">My Tasks</button>
    <button class="nav-tab ${state.currentView === 'dashboard' ? 'active' : ''}" id="tab-team" style="position:relative; display:${isPrivileged ? 'block' : 'none'};">Team <span id="team-badge" style="display:none; position:absolute; top:-5px; right:-5px; background:var(--accent-red); color:white; font-size:0.6rem; padding:2px 5px; border-radius:10px; border:2px solid var(--bg-primary);">!</span></button>
  `;

  // Append FMS Builder and Student tab beside the team tab, visible to ADMIN ONLY
  if (state.userRole === 'admin') {
    html += `
      <button class="nav-tab ${state.currentView === 'fms-builder' ? 'active' : ''}" id="tab-fms-builder">🛠️ FMS Builder</button>
      <button class="nav-tab ${state.currentView === 'student' ? 'active' : ''}" id="tab-student">🎓 Student</button>
    `;
  }

  html += `
    <button class="nav-tab ${state.currentView === 'tests' ? 'active' : ''}" id="tab-tests">Test FMS</button>
    <button class="nav-tab ${state.currentView === 'videos' ? 'active' : ''}" id="tab-videos">Video FMS</button>
    <button class="nav-tab ${state.currentView === 'enquiries' ? 'active' : ''}" id="tab-enquiries">Enquiry FMS</button>
    <button class="nav-tab ${state.currentView === 'admissions' ? 'active' : ''}" id="tab-admissions">Admission FMS</button>
    <button class="nav-tab ${state.currentView === 'parents' ? 'active' : ''}" id="tab-parents">Parents FMS</button>
  `;

  // Append custom blueprints — admin sees inline × delete button on the pill
  const blueprints = getCustomFmsBlueprints();
  blueprints.forEach(bp => {
    const allowed = bp.roles && bp.roles.length > 0 ? bp.roles.includes(state.userRole) : true;
    if (!allowed) return;

    const lowerSlug = bp.type.toLowerCase();
    if (state.userRole === 'admin') {
      // Admin gets a compound pill: tab label + inline × delete button
      html += `
        <span class="nav-tab-group ${state.currentView === lowerSlug ? 'active' : ''}" style="display:inline-flex;align-items:center;gap:0;">
          <button class="nav-tab nav-tab-custom ${state.currentView === lowerSlug ? 'active' : ''}" id="tab-custom-${lowerSlug}" style="border-radius:var(--radius-full) 0 0 var(--radius-full);border-right:none;padding-right:6px;">${bp.name}</button><button class="nav-tab-delete-btn" id="tab-custom-del-${lowerSlug}" title="Delete ${bp.name} FMS" style="border-radius:0 var(--radius-full) var(--radius-full) 0;padding:0 8px;font-size:0.85rem;line-height:1;">✕</button>
        </span>
      `;
    } else {
      html += `
        <button class="nav-tab ${state.currentView === lowerSlug ? 'active' : ''}" id="tab-custom-${lowerSlug}">${bp.name}</button>
      `;
    }
  });

  container.innerHTML = html;
  bindTabClickListeners();
}

function bindTabClickListeners() {
  const isPrivileged = ['admin', 'coordinator', 'process_coordinator'].includes(state.userRole);

  const myTasks = $('tab-my-tasks');
  if (myTasks) myTasks.onclick = () => {
    state.currentView = 'tasks';
    state.tasksFilterUser = null;
    state.currentGlobalView = false;
    setActiveTab('tab-my-tasks');
    if ($('monitoring-header')) $('monitoring-header').style.display = 'none';
    $('task-view-container').style.display = 'block';
    $('admin-dashboard-container').style.display = 'none';
    $('test-tracker-container').style.display = 'none';
    if ($('fms-builder-container')) $('fms-builder-container').style.display = 'none';
    if ($('student-container')) $('student-container').style.display = 'none';
    $('stats-section').style.display = 'block';
    $('briefing-section').style.display = 'block';
    initForUser(state.currentUser);
  };

  const teamTab = $('tab-team');
  if (teamTab) teamTab.onclick = () => {
    setActiveTab('tab-team');
    state.currentView = 'dashboard';
    openDashboard();
    $('task-view-container').style.display = 'none';
    $('test-tracker-container').style.display = 'none';
    if ($('fms-builder-container')) $('fms-builder-container').style.display = 'none';
    if ($('student-container')) $('student-container').style.display = 'none';
  };

  const staticFms = [
    { id: 'tab-tests', view: 'tests' },
    { id: 'tab-videos', view: 'videos' },
    { id: 'tab-enquiries', view: 'enquiries' },
    { id: 'tab-admissions', view: 'admissions' },
    { id: 'tab-parents', view: 'parents' }
  ];

  staticFms.forEach(f => {
    const el = $(f.id);
    if (el) el.onclick = () => {
      setActiveTab(f.id);
      state.testFmsFilter = 'all';
      openTestTracker(f.view);
      $('task-view-container').style.display = 'none';
      $('admin-dashboard-container').style.display = 'none';
      if ($('fms-builder-container')) $('fms-builder-container').style.display = 'none';
      if ($('student-container')) $('student-container').style.display = 'none';
      $('test-tracker-container').style.display = 'block';
    };
  });

  // Bind dynamic blueprint tabs
  const blueprints = getCustomFmsBlueprints();
  blueprints.forEach(bp => {
    const lowerSlug = bp.type.toLowerCase();
    const el = $(`tab-custom-${lowerSlug}`);
    if (el) {
      el.onclick = () => {
        setActiveTab(`tab-custom-${lowerSlug}`);
        state.testFmsFilter = 'all';
        openTestTracker(lowerSlug);
        $('task-view-container').style.display = 'none';
        $('admin-dashboard-container').style.display = 'none';
        if ($('fms-builder-container')) $('fms-builder-container').style.display = 'none';
        if ($('student-container')) $('student-container').style.display = 'none';
        $('test-tracker-container').style.display = 'block';
      };
    }
    // Bind inline delete button on nav pill (admin only)
    const delBtn = $(`tab-custom-del-${lowerSlug}`);
    if (delBtn) {
      delBtn.onclick = (e) => {
        e.stopPropagation();
        confirmDeleteFmsBlueprint(bp.id, bp.name);
      };
    }
  });

  // Bind FMS Builder tab (visible to admin only)
  const fmsBuilderTab = $('tab-fms-builder');
  if (fmsBuilderTab) {
    fmsBuilderTab.onclick = () => {
      setActiveTab('tab-fms-builder');
      state.currentView = 'fms-builder';
      $('task-view-container').style.display = 'none';
      $('admin-dashboard-container').style.display = 'none';
      $('test-tracker-container').style.display = 'none';
      if ($('fms-builder-container')) $('fms-builder-container').style.display = 'block';
      if ($('student-container')) $('student-container').style.display = 'none';
      renderCustomFmsBlueprintsList();
      closeCustomFmsCreatorSection();
    };
  }

  // Bind Student tab (visible to admin only)
  const studentTab = $('tab-student');
  if (studentTab) {
    studentTab.onclick = () => {
      setActiveTab('tab-student');
      state.currentView = 'student';
      $('task-view-container').style.display = 'none';
      $('admin-dashboard-container').style.display = 'none';
      $('test-tracker-container').style.display = 'none';
      if ($('fms-builder-container')) $('fms-builder-container').style.display = 'none';
      if ($('student-container')) $('student-container').style.display = 'block';
      renderStudentWebhookHistory();
    };
  }

}


function openCustomFmsBuilderModal() {
  const tab = $('tab-fms-builder');
  if (tab) {
    tab.click();
  } else {
    // Fallback if elements not ready
    if ($('fms-builder-container')) $('fms-builder-container').style.display = 'block';
    if ($('student-container')) $('student-container').style.display = 'none';
    renderCustomFmsBlueprintsList();
    closeCustomFmsCreatorSection();
  }
}

function closeCustomFmsBuilderModal() {
  if ($('fms-builder-container')) $('fms-builder-container').style.display = 'none';
  if ($('student-container')) $('student-container').style.display = 'none';
}

// Tracks the list of custom field definitions for the blueprint being created
let _fmsBlueprintFields = [];

function openCustomFmsCreatorSection() {
  $('fms-blueprint-form-section').style.display = 'block';
  $('fms-blueprint-form').reset();
  $('fms-bp-stages').checked = true;
  $('fms-bp-links').checked = true;
  $('fms-bp-offsets').checked = true;
  $('fms-bp-marks').checked = false;
  $('fms-bp-scoring').checked = false;

  // Reset scope to Dependent
  const depRadio = $('fms-bp-scope-dependent');
  if (depRadio) depRadio.checked = true;
  updateScopeLabels();

  // Reset custom fields
  _fmsBlueprintFields = [];
  renderBlueprintFieldRows();

  // Bind scope radio visual update
  document.querySelectorAll('input[name="fms-bp-scope"]').forEach(r => {
    r.onchange = updateScopeLabels;
  });

  // Bind add-field button
  const addFieldBtn = $('btn-add-fms-field');
  if (addFieldBtn) addFieldBtn.onclick = addBlueprintFieldRow;

  document.querySelectorAll('input[name="fms-bp-roles"]').forEach(cb => {
    if (cb.value !== 'admin') cb.checked = cb.value !== 'member';
  });
}

function updateScopeLabels() {
  const isDep = $('fms-bp-scope-dependent') && $('fms-bp-scope-dependent').checked;
  const depLabel = $('fms-scope-dependent-label');
  const indLabel = $('fms-scope-independent-label');
  if (depLabel) {
    depLabel.style.border = isDep ? '2px solid var(--accent-purple)' : '2px solid var(--border-glass)';
    depLabel.style.background = isDep ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.015)';
  }
  if (indLabel) {
    indLabel.style.border = isDep ? '2px solid var(--border-glass)' : '2px solid var(--accent-amber)';
    indLabel.style.background = isDep ? 'rgba(255,255,255,0.015)' : 'rgba(245,158,11,0.08)';
  }
}

/** Adds a new empty field definition row to the blueprint field list */
function addBlueprintFieldRow(existingField) {
  const id = existingField ? existingField.id : ('field_' + Date.now());
  const label = existingField ? existingField.label : '';
  const type = existingField ? existingField.type : 'text';
  const required = existingField ? existingField.required : false;
  const options = existingField ? (existingField.options || '') : '';

  _fmsBlueprintFields.push({ id, label, type, required, options });
  renderBlueprintFieldRows();
}

/** Re-renders all field-builder rows from `_fmsBlueprintFields` */
function renderBlueprintFieldRows() {
  const list = $('fms-custom-fields-list');
  const empty = $('fms-custom-fields-empty');
  if (!list) return;

  if (_fmsBlueprintFields.length === 0) {
    list.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  list.innerHTML = _fmsBlueprintFields.map((f, idx) => `
    <div style="display:grid;grid-template-columns:1fr 110px auto auto;gap:8px;align-items:center;padding:10px 12px;background:rgba(255,255,255,0.02);border:1px solid var(--border-glass);border-radius:var(--radius-md);" data-field-idx="${idx}">
      <input type="text" class="fms-field-label" placeholder="Field label (e.g. Student Name)" value="${f.label.replace(/"/g, '&quot;')}" oninput="updateBlueprintField(${idx},'label',this.value)" style="background:rgba(255,255,255,0.04);border:1px solid var(--border-glass);border-radius:var(--radius-sm);padding:7px 10px;font-size:0.82rem;color:var(--text-primary);width:100%;">
      <select class="fms-field-type" onchange="updateBlueprintField(${idx},'type',this.value)" style="background:rgba(255,255,255,0.04);border:1px solid var(--border-glass);border-radius:var(--radius-sm);padding:7px 8px;font-size:0.82rem;color:var(--text-primary);">
        <option value="text" ${f.type === 'text' ? 'selected' : ''}>Text</option>
        <option value="number" ${f.type === 'number' ? 'selected' : ''}>Number</option>
        <option value="date" ${f.type === 'date' ? 'selected' : ''}>Date</option>
        <option value="url" ${f.type === 'url' ? 'selected' : ''}>URL</option>
        <option value="select" ${f.type === 'select' ? 'selected' : ''}>Dropdown</option>
        <option value="textarea" ${f.type === 'textarea' ? 'selected' : ''}>Text Area</option>
      </select>
      <label title="Required?" style="display:flex;align-items:center;gap:4px;font-size:0.72rem;color:var(--text-muted);cursor:pointer;white-space:nowrap;">
        <input type="checkbox" ${f.required ? 'checked' : ''} onchange="updateBlueprintField(${idx},'required',this.checked)" style="accent-color:var(--accent-purple);"> Req
      </label>
      <button type="button" onclick="removeBlueprintField(${idx})" style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);border-radius:var(--radius-sm);color:#f87171;padding:6px 9px;cursor:pointer;font-size:0.8rem;">✕</button>
    </div>
    ${f.type === 'select' ? `
    <div style="margin:-4px 0 2px 0;padding:8px 12px;background:rgba(124,58,237,0.04);border:1px solid rgba(124,58,237,0.2);border-radius:0 0 var(--radius-md) var(--radius-md);">
      <label style="font-size:0.72rem;color:var(--accent-purple);font-weight:600;">Dropdown Options (comma-separated)</label>
      <input type="text" placeholder="e.g. Option A, Option B, Option C" value="${f.options.replace(/"/g, '&quot;')}" oninput="updateBlueprintField(${idx},'options',this.value)" style="width:100%;margin-top:5px;background:rgba(255,255,255,0.04);border:1px solid var(--border-glass);border-radius:var(--radius-sm);padding:6px 10px;font-size:0.8rem;color:var(--text-primary);">
    </div>` : ''}
  `).join('');
}

window.updateBlueprintField = function (idx, key, value) {
  if (!_fmsBlueprintFields[idx]) return;
  _fmsBlueprintFields[idx][key] = value;
  if (key === 'type') renderBlueprintFieldRows(); // Re-render to show/hide options input
};

window.removeBlueprintField = function (idx) {
  _fmsBlueprintFields.splice(idx, 1);
  renderBlueprintFieldRows();
};

function closeCustomFmsCreatorSection() {
  $('fms-blueprint-form-section').style.display = 'none';
}

function renderCustomFmsBlueprintsList() {
  const blueprints = getCustomFmsBlueprints();
  const container = $('fms-blueprints-list');
  if (!container) return;

  if (blueprints.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: var(--space-md);">No custom pipelines created yet. Click "+ New Pipeline" to build one!</div>`;
    return;
  }

  container.innerHTML = blueprints.map(bp => {
    const isIndependent = false; // Forced false - everything connected to Supabase
    const fieldCount = (bp.fields || []).length;
    const scopeBadge = `<span style="font-size:0.62rem;padding:2px 7px;background:rgba(99,102,241,0.15);color:#818cf8;border-radius:99px;font-weight:700;border:1px solid rgba(99,102,241,0.3);">🌐 Dependent</span>`;
    const fieldBadge = fieldCount > 0
      ? `<span style="font-size:0.62rem;padding:2px 7px;background:rgba(16,185,129,0.12);color:var(--accent-emerald);border-radius:99px;font-weight:700;border:1px solid rgba(16,185,129,0.25);">⚡ ${fieldCount} field${fieldCount > 1 ? 's' : ''}</span>`
      : '';
    return `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:rgba(255,255,255,0.02);border:1px solid var(--border-glass);border-radius:var(--radius-md);gap:12px;">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:0.9rem;color:var(--text-primary);display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span>${bp.name}</span>
          <span style="font-size:0.65rem;padding:2px 7px;background:rgba(124,58,237,0.15);color:var(--accent-purple);border-radius:99px;font-weight:700;border:1px solid rgba(124,58,237,0.3);text-transform:uppercase;letter-spacing:0.05em;">${bp.type}</span>
          ${scopeBadge}
          ${fieldBadge}
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:5px;">
          ${[
        bp.stagesNeeded ? '📋 Stages' : '',
        bp.linksNeeded ? '🔗 Links' : '',
        bp.offsetsNeeded ? '↔️ Offsets' : '',
        bp.marksNeeded ? '🎯 Marks' : '',
        bp.scoringSystem ? '🏆 Scoring' : '',
        fieldCount > 0 ? ('📝 Fields: ' + (bp.fields || []).map(f => f.label).join(', ')) : ''
      ].filter(Boolean).join(' &nbsp;·&nbsp; ') || '📦 Pure Item Tracking'
      }
        </div>
      </div>
      <button onclick="confirmDeleteFmsBlueprint('${bp.id}','${bp.name.replace(/'/g, "\\'")}')" 
        style="flex-shrink:0;display:flex;align-items:center;gap:5px;padding:6px 12px;border-radius:99px;border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.08);color:#f87171;font-size:0.8rem;font-weight:600;cursor:pointer;transition:all 0.2s;white-space:nowrap;"
        onmouseover="this.style.background='rgba(239,68,68,0.18)';this.style.borderColor='rgba(239,68,68,0.7)'"
        onmouseout="this.style.background='rgba(239,68,68,0.08)';this.style.borderColor='rgba(239,68,68,0.4)'">
        🗑️ Delete
      </button>
    </div>`;
  }).join('');
}

// Shows an in-app confirm modal before deleting — no jarring browser confirm()
function confirmDeleteFmsBlueprint(blueprintId, blueprintName) {
  // Build and inject an inline confirmation banner
  const existingConfirm = document.getElementById('fms-delete-confirm-banner');
  if (existingConfirm) existingConfirm.remove();

  const banner = document.createElement('div');
  banner.id = 'fms-delete-confirm-banner';
  banner.style.cssText = `
    position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
    background:linear-gradient(135deg,#1a0a0a,#2d0f0f);
    border:1px solid rgba(239,68,68,0.5);border-radius:16px;
    padding:16px 20px;z-index:9999;display:flex;flex-direction:column;
    gap:10px;min-width:300px;max-width:90vw;
    box-shadow:0 8px 32px rgba(239,68,68,0.25),0 0 0 1px rgba(239,68,68,0.15);
    animation:slideUpIn 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards;
  `;
  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;">
      <span style="font-size:1.3rem;">🗑️</span>
      <div>
        <div style="font-weight:700;font-size:0.9rem;color:#fca5a5;">Delete "${blueprintName}"?</div>
        <div style="font-size:0.75rem;color:rgba(252,165,165,0.7);margin-top:2px;">This will permanently remove the FMS and its tab.</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;">
      <button id="fms-del-confirm-yes"
        style="flex:1;padding:8px;border-radius:99px;border:1px solid rgba(239,68,68,0.6);background:rgba(239,68,68,0.2);color:#fca5a5;font-weight:700;font-size:0.82rem;cursor:pointer;"
        onmouseover="this.style.background='rgba(239,68,68,0.35)'"
        onmouseout="this.style.background='rgba(239,68,68,0.2)'">
        Yes, Delete
      </button>
      <button id="fms-del-confirm-no"
        style="flex:1;padding:8px;border-radius:99px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:var(--text-muted);font-weight:600;font-size:0.82rem;cursor:pointer;"
        onmouseover="this.style.background='rgba(255,255,255,0.1)'"
        onmouseout="this.style.background='rgba(255,255,255,0.05)'">
        Cancel
      </button>
    </div>
  `;
  document.body.appendChild(banner);

  document.getElementById('fms-del-confirm-no').onclick = () => banner.remove();
  document.getElementById('fms-del-confirm-yes').onclick = async () => {
    banner.remove();
    await deleteCustomFmsBlueprint(blueprintId);
  };

  // Auto-dismiss after 8s
  setTimeout(() => { if (banner.parentNode) banner.remove(); }, 8000);
}

async function deleteCustomFmsBlueprint(blueprintId) {
  // Identify the blueprint being deleted
  const blueprints = getCustomFmsBlueprints();
  const bpToDelete = blueprints.find(b => String(b.id) === String(blueprintId));

  // Fallback to My Tasks if currently viewing the tab being deleted
  if (bpToDelete && state.currentView === bpToDelete.type.toLowerCase()) {
    state.currentView = 'tasks';
    if ($('task-view-container')) $('task-view-container').style.display = 'block';
    if ($('fms-builder-container')) $('fms-builder-container').style.display = 'none';
    if ($('student-container')) $('student-container').style.display = 'none';
    if ($('test-tracker-container')) $('test-tracker-container').style.display = 'none';
    const myTasksTab = $('tab-my-tasks');
    if (myTasksTab) {
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      myTasksTab.classList.add('active');
    }
  }

  // If state.testSettings is empty/stale, fetch fresh data from Supabase first
  // so we don't accidentally wipe existing stage settings
  if (!state.testSettings || state.testSettings.length === 0) {
    const freshSettings = await apiFetch('getTestSettings');
    if (freshSettings.success) state.testSettings = freshSettings.data;
  }

  // Remove only the target blueprint row; leave all other settings intact
  state.testSettings = (state.testSettings || []).filter(s => {
    if (s.type === 'fms_blueprint') {
      try {
        const bp = JSON.parse(s.label);
        return String(bp.id) !== String(blueprintId);
      } catch (e) { return true; }
    }
    return true;
  });

  const res = await apiFetch('updateTestSettings', { settings: state.testSettings });
  if (res.success) {
    // Clear the localStorage slug cache immediately so the tab disappears at once
    const remaining = (state.testSettings || []).filter(s => s.type === 'fms_blueprint').map(s => {
      try { return JSON.parse(s.label); } catch (e) { return null; }
    }).filter(Boolean);
    localStorage.setItem('svm_custom_fms_blueprints', JSON.stringify(remaining));

    showToast('FMS "' + (bpToDelete ? bpToDelete.name : '') + '" deleted.', 'success');
    renderCustomFmsBlueprintsList();
    renderNavigationTabs();
  } else {
    showToast('Failed to delete: ' + res.error, 'error');
  }
}

async function saveCustomFmsBlueprint(blueprint) {
  // Use the same shape that getTestSettings returns (id/offset, not stage_id/offset_days)
  // so the updateTestSettings mapper in supabase-api.js can correctly build the INSERT row.
  const blueprintRow = {
    id: 2000 + Math.floor(Math.random() * 1000000),
    label: JSON.stringify(blueprint),
    offset: 0,
    doer: '',
    type: 'fms_blueprint',
    link: '',
    hidden: false
  };

  if (!state.testSettings) state.testSettings = [];
  state.testSettings = state.testSettings.filter(s => {
    if (s.type === 'fms_blueprint') {
      try {
        const bp = JSON.parse(s.label);
        return bp.id !== blueprint.id;
      } catch (e) { return true; }
    }
    return true;
  });
  state.testSettings.push(blueprintRow);

  const res = await apiFetch('updateTestSettings', { settings: state.testSettings });
  if (res.success) {
    showToast('FMS Blueprint saved successfully!', 'success');
    renderNavigationTabs();
  } else {
    showToast('Failed to save blueprint: ' + res.error, 'error');
  }
}

async function handleFmsBlueprintSubmit() {
  const name = $('fms-bp-name').value.trim();
  const slug = $('fms-bp-type').value.trim();

  if (!name || !slug) {
    showToast('Please fill in Name and Slug fields.', 'error');
    return;
  }

  if (!/^[a-zA-Z]+$/.test(slug)) {
    showToast('Slug must contain letters only, without spaces.', 'error');
    return;
  }

  const forbiddenSlugs = ['tests', 'videos', 'enquiries', 'admissions', 'parents', 'tasks', 'dashboard', 'sheet', 'app', 'video', 'beforefee', 'afterfee'];
  if (forbiddenSlugs.includes(slug.toLowerCase())) {
    showToast(`The slug key "${slug}" is reserved. Please use another slug.`, 'error');
    return;
  }

  const blueprints = getCustomFmsBlueprints();
  if (blueprints.some(bp => bp.type.toLowerCase() === slug.toLowerCase())) {
    showToast(`An FMS with slug "${slug}" already exists!`, 'error');
    return;
  }

  const stagesNeeded = $('fms-bp-stages').checked;
  const linksNeeded = $('fms-bp-links').checked;
  const offsetsNeeded = $('fms-bp-offsets').checked;
  const marksNeeded = $('fms-bp-marks').checked;
  const scoringSystem = $('fms-bp-scoring').checked;

  // Read scope
  const scopeRadio = document.querySelector('input[name="fms-bp-scope"]:checked');
  const scope = scopeRadio ? scopeRadio.value : 'dependent';

  // Validate + collect custom fields
  const fields = [];
  for (const f of _fmsBlueprintFields) {
    if (!f.label.trim()) {
      showToast('All custom fields must have a label.', 'error');
      return;
    }
    fields.push({
      id: f.id,
      label: f.label.trim(),
      type: f.type,
      required: !!f.required,
      options: f.type === 'select' ? f.options : ''
    });
  }

  const roles = ['admin'];
  document.querySelectorAll('input[name="fms-bp-roles"]:checked').forEach(cb => {
    roles.push(cb.value);
  });

  const blueprintId = 'fms_' + slug.toLowerCase() + '_' + Date.now();
  const newBlueprint = {
    id: blueprintId,
    name,
    type: slug,
    scope,
    stagesNeeded,
    linksNeeded,
    offsetsNeeded,
    marksNeeded,
    scoringSystem,
    fields,
    roles
  };

  await saveCustomFmsBlueprint(newBlueprint);
  closeCustomFmsCreatorSection();
  renderCustomFmsBlueprintsList();
}

window.deleteCustomFmsBlueprint = deleteCustomFmsBlueprint;
window.confirmDeleteFmsBlueprint = confirmDeleteFmsBlueprint;

// =============================================
// INDEPENDENT FMS — localStorage helpers
// =============================================

/** Returns the localStorage key for an independent FMS's entries */
function _independentFmsKey(type) {
  const user = (state.currentUser || 'anon').toString().toLowerCase().replace(/[^a-z0-9]/g, '_');
  return `svm_ind_fms_${type.toLowerCase()}_${user}`;
}

/** Get all entries for an independent FMS */
function getIndependentFmsEntries(type) {
  try {
    return JSON.parse(localStorage.getItem(_independentFmsKey(type)) || '[]');
  } catch (e) {
    return [];
  }
}

/** Upsert an entry into an independent FMS */
function saveIndependentFmsEntry(type, entry) {
  const entries = getIndependentFmsEntries(type);
  const idx = entries.findIndex(e => e.testId === entry.testId);
  if (idx > -1) {
    entries[idx] = entry;
  } else {
    entries.unshift(entry);
  }
  localStorage.setItem(_independentFmsKey(type), JSON.stringify(entries));
  return entries;
}

/** Delete an entry from an independent FMS */
function deleteIndependentFmsEntry(type, testId) {
  const entries = getIndependentFmsEntries(type).filter(e => e.testId !== testId);
  localStorage.setItem(_independentFmsKey(type), JSON.stringify(entries));
  return entries;
}

/** Update a single stage in an independent FMS entry */
function updateIndependentFmsStage(type, testId, stageId, update) {
  const entries = getIndependentFmsEntries(type);
  const entry = entries.find(e => e.testId === testId);
  if (!entry) return;
  if (!entry.stages) entry.stages = [];
  const stage = entry.stages.find(s => s.id === stageId);
  if (stage) {
    Object.assign(stage, update);
  } else {
    entry.stages.push({ id: stageId, ...update });
  }
  localStorage.setItem(_independentFmsKey(type), JSON.stringify(entries));
}

function setActiveTab(id) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  $(id).classList.add('active');
}

async function openTestTracker(viewType = 'tests', forceRefresh = false) {
  state.currentView = viewType;
  const container = $('test-list-content');

  // Lock configuration to admin role only
  const isAdmin = state.userRole === 'admin';
  const btnSettings = $('btn-test-settings');
  if (btnSettings) {
    btnSettings.style.display = isAdmin ? 'flex' : 'none';
  }

  // Check if the current view is an independent-scope custom FMS
  const blueprints = getCustomFmsBlueprints();
  const activeBp = blueprints.find(bp => bp.type.toLowerCase() === viewType.toLowerCase());
  const isIndependent = false; // Forced false - everything connected to Supabase

  // SWR Caching: If we already have cached data, render it INSTANTLY without showing a spinner or waiting!
  if (!forceRefresh && state.testSettings && state.testSettings.length > 0 && state.tests && state.tests.length > 0) {
    sanitizeTestSettings();
    renderTests(state.tests);

    // Fetch in the background silently to keep it up to date, without blocking the UI or showing a spinner!
    const oldSettingsStr = JSON.stringify(state.testSettings);
    const oldTestsStr = JSON.stringify(state.tests);

    Promise.all([
      apiFetch('getTestSettings'),
      apiFetch('getTests')
    ]).then(([settingsRes, testsRes]) => {
      const settingsChanged = settingsRes.success && oldSettingsStr !== JSON.stringify(settingsRes.data);
      const testsChanged = testsRes.success && oldTestsStr !== JSON.stringify(testsRes.data);

      if (settingsChanged || testsChanged) {
        if (settingsRes.success) state.testSettings = settingsRes.data;
        if (testsRes.success) state.tests = testsRes.data;
        sanitizeTestSettings();
        // Only re-render if we are still on an FMS view and the data actually changed!
        const blueprintsList = getCustomFmsBlueprints();
        const isCustomView = blueprintsList.some(bp => bp.type.toLowerCase() === state.currentView.toLowerCase());
        const fmsViews = ['tests', 'videos', 'enquiries', 'admissions', 'parents'];
        if (fmsViews.includes(state.currentView) || isCustomView) {
          renderTests(state.tests);
        }
      }
    }).catch(err => console.error('Background refresh failed:', err));

    return;
  }

  // If no cache, show spinner and fetch for the first time
  container.innerHTML = '<div class="premium-loader"><div class="premium-loader-bar"></div><div class="premium-loader-bar mid"></div><div class="premium-loader-bar short"></div></div>';

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
      doneAt: '',
      link: s.link || '',
      hidden: s.hidden || false
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
      doneAt: s.doneAt || '',
      link: s.link !== undefined ? s.link : (globalStage.link || ''),
      hidden: s.hidden !== undefined ? s.hidden : (globalStage.hidden || false)
    };
  });
}

window.toggleParentsChecklistRow = function (idx) {
  const email = state.currentUser ? state.currentUser.email : 'default';
  const checkedKey = `parents_fms_checked_${email}`;
  let checkedIndices = [];
  try {
    checkedIndices = JSON.parse(localStorage.getItem(checkedKey)) || [];
  } catch (e) {
    checkedIndices = [];
  }

  const foundIdx = checkedIndices.indexOf(idx);
  if (foundIdx > -1) {
    checkedIndices.splice(foundIdx, 1);
  } else {
    checkedIndices.push(idx);
  }

  localStorage.setItem(checkedKey, JSON.stringify(checkedIndices));
  renderTests(state.tests);
};

window.resetParentsChecklist = function () {
  const email = state.currentUser ? state.currentUser.email : 'default';
  const checkedKey = `parents_fms_checked_${email}`;
  localStorage.setItem(checkedKey, JSON.stringify([]));
  renderTests(state.tests);
  showToast('Checklist refreshed! Start your routine.');
};

function renderFmsSortDropdownOptions() {
  const isVideoView = state.currentView === 'videos';
  const isAdmissionView = state.currentView === 'admissions';
  const isEnquiryView = state.currentView === 'enquiries';

  const menu = $('sort-dropdown-menu');
  if (!menu) return;

  // Let's get current active sortType or set default
  let sortType = state.testFmsSort;

  let options = [];
  if (isEnquiryView) {
    // Enquiry FMS — no scoring, date/name only
    if (!sortType || !['held-desc', 'held-asc', 'name-asc', 'name-desc'].includes(sortType)) {
      sortType = 'held-desc';
      state.testFmsSort = 'held-desc';
    }
    options = [
      { value: 'held-desc', label: '📅 Date Registered (Newest First)', display: 'Date Registered ↓' },
      { value: 'held-asc', label: '📅 Date Registered (Oldest First)', display: 'Date Registered ↑' },
      { value: 'name-asc', label: '🔤 Student Name (A–Z)', display: 'Student Name A–Z' },
      { value: 'name-desc', label: '🔤 Student Name (Z–A)', display: 'Student Name Z–A' }
    ];
  } else if (isAdmissionView) {
    // Admissions FMS — has scoring (Fee / Score)
    if (!sortType || !['held-desc', 'held-asc', 'name-asc', 'name-desc', 'max-desc', 'max-asc'].includes(sortType)) {
      sortType = 'held-desc';
      state.testFmsSort = 'held-desc';
    }
    options = [
      { value: 'held-desc', label: '📅 Date Registered (Newest First)', display: 'Date Registered ↓' },
      { value: 'held-asc', label: '📅 Date Registered (Oldest First)', display: 'Date Registered ↑' },
      { value: 'name-asc', label: '🔤 Student Name (A–Z)', display: 'Student Name A–Z' },
      { value: 'name-desc', label: '🔤 Student Name (Z–A)', display: 'Student Name Z–A' },
      { value: 'max-desc', label: '💰 Fee / Score (High → Low)', display: 'Fee / Score ↓' },
      { value: 'max-asc', label: '💰 Fee / Score (Low → High)', display: 'Fee / Score ↑' }
    ];
  } else if (isVideoView) {
    // Video FMS — has scoring
    if (!sortType || !['held-desc', 'held-asc', 'name-asc', 'name-desc', 'max-desc', 'max-asc'].includes(sortType)) {
      sortType = 'held-desc';
      state.testFmsSort = 'held-desc';
    }
    options = [
      { value: 'held-desc', label: '📅 Date Created (Newest First)', display: 'Date Created ↓' },
      { value: 'held-asc', label: '📅 Date Created (Oldest First)', display: 'Date Created ↑' },
      { value: 'name-asc', label: '🎥 Video Title (A–Z)', display: 'Video Title A–Z' },
      { value: 'name-desc', label: '🎥 Video Title (Z–A)', display: 'Video Title Z–A' },
      { value: 'max-desc', label: '⭐ Score (High → Low)', display: 'Score ↓' },
      { value: 'max-asc', label: '⭐ Score (Low → High)', display: 'Score ↑' }
    ];
  } else { // default tests view
    if (!sortType || ['name-asc', 'name-desc'].includes(sortType)) {
      sortType = 'held-desc';
      state.testFmsSort = 'held-desc';
    }
    options = [
      { value: 'held-desc', label: '📅 Date Held (Newest First)', display: 'Date Held ↓' },
      { value: 'held-asc', label: '📅 Date Held (Oldest First)', display: 'Date Held ↑' },
      { value: 'subject-asc', label: '📚 Subject (A–Z)', display: 'Subject A–Z' },
      { value: 'subject-desc', label: '📚 Subject (Z–A)', display: 'Subject Z–A' },
      { value: 'class-asc', label: '🎓 Class (Ascending)', display: 'Class ↑' },
      { value: 'class-desc', label: '🎓 Class (Descending)', display: 'Class ↓' },
      { value: 'max-desc', label: '💯 Max Marks (High → Low)', display: 'Max Marks ↓' },
      { value: 'max-asc', label: '💯 Max Marks (Low → High)', display: 'Max Marks ↑' }
    ];
  }

  // Generate html
  menu.innerHTML = options.map(opt => `
    <div class="sort-option ${opt.value === sortType ? 'active-sort' : ''}" data-value="${opt.value}" onclick="selectSortOption(this)">${opt.label}</div>
  `).join('');

  // Update button label
  const labelEl = $('sort-dropdown-label');
  if (labelEl) {
    const currentOpt = options.find(o => o.value === sortType);
    labelEl.textContent = currentOpt ? currentOpt.display : 'Sort';
  }
}

function renderTests(tests) {
  const container = $('test-list-content');

  // Populate dynamic sorting options according to the current FMS view
  renderFmsSortDropdownOptions();

  // Update toolbar filter tabs visibility depending on active main tab
  const isVideoView = state.currentView === 'videos';
  const isAdmissionView = state.currentView === 'admissions';
  const isEnquiryView = state.currentView === 'enquiries';
  const isParentsView = state.currentView === 'parents';
  const isTestView = state.currentView === 'tests';

  const blueprints = getCustomFmsBlueprints();
  const activeCustomBlueprint = blueprints.find(bp => bp.type.toLowerCase() === state.currentView);
  const isCustomView = !!activeCustomBlueprint;

  const sheetPill = document.querySelector('.test-fms-tabs .tab-btn[data-filter="sheet"]');
  const appPill = document.querySelector('.test-fms-tabs .tab-btn[data-filter="app"]');
  const videoPill = document.querySelector('.test-fms-tabs .tab-btn[data-filter="video"]');
  const beforeFeePill = document.querySelector('.test-fms-tabs .tab-btn[data-filter="beforefee"]');
  const afterFeePill = document.querySelector('.test-fms-tabs .tab-btn[data-filter="afterfee"]');

  if (sheetPill) sheetPill.style.display = isTestView ? 'inline-block' : 'none';
  if (appPill) appPill.style.display = isTestView ? 'inline-block' : 'none';
  if (videoPill) videoPill.style.display = 'none';
  if (beforeFeePill) beforeFeePill.style.display = 'none';
  if (afterFeePill) afterFeePill.style.display = 'none';

  // Show/Hide FMS Toolbar (search/sort) and FMS subtabs for Parents FMS
  const toolbar = document.querySelector('.test-fms-toolbar');
  const filterTabs = document.querySelector('.test-fms-tabs');
  const settingsBtn = $('btn-test-settings');

  if (isParentsView) {
    if (toolbar) toolbar.style.display = 'none';
    if (filterTabs) filterTabs.style.display = 'none';
    // Admin and Coordinator can see settings for Parents FMS
    if (settingsBtn) {
      const allowed = state.userRole === 'admin' || state.userRole === 'coordinator' || state.userRole === 'process_coordinator';
      settingsBtn.style.display = allowed ? 'flex' : 'none';
    }
  } else {
    if (toolbar) toolbar.style.display = 'flex';
    if (filterTabs) filterTabs.style.display = isTestView ? 'flex' : 'none';
    if (settingsBtn) {
      const canEditSettings = state.userRole === 'admin' || state.userRole === 'coordinator' || state.userRole === 'process_coordinator';
      settingsBtn.style.display = canEditSettings ? 'flex' : 'none';
    }
  }

  // Dynamic header titles & add button label based on view type
  const fmsHeaderTitle = document.querySelector('.test-fms-title h2');
  if (fmsHeaderTitle) {
    if (isEnquiryView) fmsHeaderTitle.textContent = 'Enquiry FMS';
    else if (isAdmissionView) fmsHeaderTitle.textContent = 'Admission FMS';
    else if (isVideoView) fmsHeaderTitle.textContent = 'Video FMS';
    else if (isParentsView) fmsHeaderTitle.textContent = 'Parents FMS';
    else if (isCustomView) fmsHeaderTitle.textContent = activeCustomBlueprint.name;
    else fmsHeaderTitle.textContent = 'Test FMS';
  }

  const addBtn = $('btn-add-test');
  if (addBtn) {
    if (isEnquiryView) addBtn.textContent = '+ Add Enquiry';
    else if (isAdmissionView) addBtn.textContent = '+ Add Admission';
    else if (isVideoView) addBtn.textContent = '+ Add Video';
    else if (isParentsView) addBtn.textContent = '+ Reset Checklist';
    else if (isCustomView) addBtn.textContent = '+ Add ' + activeCustomBlueprint.name;
    else addBtn.textContent = '+ Add Test';
  }

  const fmsHeaderIcon = document.querySelector('.test-fms-title-icon');
  if (fmsHeaderIcon) {
    if (isAdmissionView || isEnquiryView) {
      fmsHeaderIcon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="17" y1="11" x2="23" y2="11"/></svg>';
    } else if (isVideoView) {
      fmsHeaderIcon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>';
    } else if (isParentsView) {
      fmsHeaderIcon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
    } else {
      fmsHeaderIcon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';
    }
  }

  // Bypassing filter/sort for Parents view and rendering the custom interactive checklist
  if (isParentsView) {
    const email = state.currentUser ? state.currentUser.email : 'default';
    const checkedKey = `parents_fms_checked_${email}`;
    let checkedIndices = [];
    try {
      checkedIndices = JSON.parse(localStorage.getItem(checkedKey)) || [];
    } catch (e) {
      checkedIndices = [];
    }

    const stages = (state.testSettings || []).filter(s => s.type === 'Parents');
    const displayStages = stages.length > 0 ? stages : PIPELINE_DEFAULTS.Parents;

    const completedCount = displayStages.filter((_, idx) => checkedIndices.includes(idx)).length;
    const pct = displayStages.length > 0 ? Math.round((completedCount / displayStages.length) * 100) : 0;

    container.innerHTML = `
      <div style="width: 100%; max-width: 600px; margin: 20px auto 0 auto; padding: var(--space-xl); background: var(--gradient-card); background-color: var(--bg-secondary); border: 1px solid var(--border-glass); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); animation: slideUp 0.4s ease;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap: 12px; margin-bottom: var(--space-md); width: 100%;">
          <div style="display:flex; align-items:center; gap:10px; flex: 1; min-width: 0;">
            <span style="font-size: 1.5rem; flex-shrink: 0;">👪</span>
            <div style="text-align: left; min-width: 0;">
              <h3 style="font-size: 1.1rem; font-weight: 800; color: var(--text-primary); margin: 0; line-height: 1.3;">Daily Parents Guidelines Checklist</h3>
              <p style="font-size: 0.72rem; color: var(--text-secondary); margin: 3px 0 0 0; line-height: 1.3;">Check off completed monitoring activities. Personal to your account.</p>
            </div>
          </div>
          <span class="test-status-badge ${pct === 100 ? 'status-complete' : 'status-progress'}" style="font-size: 0.72rem; font-weight: 700; padding: 4px 10px; flex-shrink: 0; white-space: nowrap;">
            ${pct === 100 ? '✓ All Done' : `${completedCount}/${displayStages.length} Done (${pct}%)`}
          </span>
        </div>

        <!-- Custom Progress Bar -->
        <div style="height: 6px; background: rgba(255,255,255,0.06); border-radius: 3px; overflow: hidden; margin-bottom: var(--space-lg); border: 1px solid var(--border-glass);">
          <div style="height: 100%; width: ${pct}%; background: var(--gradient-purple); transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: var(--shadow-glow-purple);"></div>
        </div>

        <!-- Guidelines Checklist list -->
        <div style="display: flex; flex-direction: column; gap: 12px;">
          ${displayStages.map((stage, idx) => {
      const isChecked = checkedIndices.includes(idx);
      return `
              <div onclick="toggleParentsChecklistRow(${idx})" class="parents-checklist-row" style="display: flex; align-items: center; gap: var(--space-md); padding: var(--space-md); background: ${isChecked ? 'rgba(16, 185, 129, 0.04)' : 'rgba(255, 255, 255, 0.015)'}; border: 1px solid ${isChecked ? 'rgba(16, 185, 129, 0.2)' : 'var(--border-glass)'}; border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s ease; user-select: none;">
                <!-- Checkbox -->
                <div style="flex-shrink: 0; width: 20px; height: 20px; border-radius: 6px; border: 2px solid ${isChecked ? 'var(--accent-emerald)' : 'var(--text-muted)'}; background: ${isChecked ? 'var(--accent-emerald)' : 'transparent'}; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease; box-shadow: ${isChecked ? '0 0 10px rgba(16, 185, 129, 0.25)' : 'none'};">
                  ${isChecked ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ''}
                </div>
                <!-- Label text -->
                <span style="font-size: 0.85rem; font-weight: 600; color: ${isChecked ? 'var(--accent-emerald)' : 'var(--text-primary)'}; text-decoration: ${isChecked ? 'line-through' : 'none'}; opacity: ${isChecked ? 0.75 : 1}; transition: all 0.2s ease; text-align: left; line-height: 1.4;">
                  ${stage.label}
                </span>
              </div>
            `;
    }).join('')}
        </div>
      </div>
    `;
    return;
  }

  // Apply complete/in-progress/sheet/app/search filters
  const filter = state.testFmsFilter || 'all';
  const searchQuery = state.testFmsSearch || '';

  let filteredTests = tests.filter(test => {
    const isVideo = (test.type || '').toLowerCase() === 'video';
    const isBeforeFee = (test.type || '').toLowerCase() === 'beforefee';
    const isAfterFee = (test.type || '').toLowerCase() === 'afterfee';
    const isParents = (test.type || '').toLowerCase() === 'parents';

    // 1. Partition by Main Navigation Tab Dynamically
    const currentViewLower = state.currentView;
    const testTypeLower = (test.type || '').toLowerCase();

    if (currentViewLower === 'tests') {
      if (testTypeLower !== 'sheet' && testTypeLower !== 'app') return false;
    } else if (currentViewLower === 'videos') {
      if (testTypeLower !== 'video') return false;
    } else if (currentViewLower === 'enquiries') {
      if (testTypeLower !== 'beforefee') return false;
    } else if (currentViewLower === 'admissions') {
      if (testTypeLower !== 'afterfee') return false;
    } else if (currentViewLower === 'parents') {
      if (testTypeLower !== 'parents') return false;
    } else if (isCustomView) {
      if (testTypeLower !== currentViewLower) return false;
    } else {
      return false; // Unknown view
    }

    // 2. Sub-tab Toolbar Filters
    const testStages = getTestStages(test).filter(s => !s.hidden);
    const totalStages = testStages.length;
    const completedStages = testStages.filter(s => s.status === 'done').length;
    const isCompleted = totalStages > 0 && completedStages === totalStages;

    if (filter === 'complete' && !isCompleted) return false;
    if (filter === 'progress' && isCompleted) return false;
    if (filter === 'sheet' && testTypeLower !== 'sheet') return false;
    if (filter === 'app' && testTypeLower !== 'app') return false;
    if (filter === 'beforefee' && !isBeforeFee) return false;
    if (filter === 'afterfee' && !isAfterFee) return false;

    // 3. Search Query Filter
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
    if (sortType === 'name-asc') return (a.testName || '').localeCompare(b.testName || '');
    if (sortType === 'name-desc') return (b.testName || '').localeCompare(a.testName || '');
    return 0;
  });

  if (filteredTests.length === 0) {
    container.innerHTML = `<div class="empty-state">No tests match current filters.</div>`;
    return;
  }

  container.innerHTML = filteredTests.map(test => {
    const heldOnDate = new Date(test.heldOn);
    const testType = test.type || 'Sheet';

    // Check if dynamic custom blueprint governs this card
    const bp = blueprints.find(b => b.type === testType);
    const isCustom = !!bp;
    const showOffsets = isCustom ? bp.offsetsNeeded : (testType !== 'BeforeFee' && testType !== 'AfterFee');
    const showLinks = isCustom ? bp.linksNeeded : true;
    const showStages = isCustom ? bp.stagesNeeded : true;
    const showMarks = isCustom
      ? (bp.marksNeeded || bp.scoringSystem)
      : FMS_SCORING_ENABLED.has(testType);

    // Friendly scoring label per FMS context
    const scoringLabel = testType === 'Video' ? 'Score / Rating'
      : testType === 'AfterFee' ? 'Fee / Score'
        : 'Marks';

    // Check if any stage is overdue to apply card styling
    const relevantSettings = (state.testSettings || []).filter(s => s.type === testType);
    const hasOverdueStage = showOffsets && relevantSettings.some(stage => {
      const stages = test.stages || [];
      const testStage = stages.find(s => s.id === stage.id) || { status: 'pending' };
      if (testStage.status === 'done') return false;
      if (testStage.hidden) return false;

      const pDate = new Date(heldOnDate);
      pDate.setDate(heldOnDate.getDate() + (stage.offset || 0));
      pDate.setHours(23, 59, 59, 999); // End of day check
      return new Date() > pDate;
    });

    // Calculate stage stats for the compact progress bar
    const testStages = getTestStages(test).filter(s => !s.hidden);
    const totalStages = testStages.length;
    const completedStages = testStages.filter(s => s.status === 'done').length;

    return `
      <div class="test-card ${hasOverdueStage ? 'overdue' : ''} ${completedStages === totalStages && totalStages > 0 ? 'complete' : ''}" data-test-id="${test.testId}">

        <!-- Top row: subject badge + type + status + actions -->
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            ${test.subject ? `<span class="subject-badge subject-${test.subject.toLowerCase()}">${test.subject === 'Math' ? 'Maths' : test.subject}</span>` : ''}
            <span class="test-type-pill type-${(test.type || '').toLowerCase()}">${test.type === 'BeforeFee' ? 'Enquiry' : (test.type === 'AfterFee' ? 'Admission' : (test.type || ''))}</span>
            ${totalStages > 0 && showStages ? (() => {
        const pct = Math.round((completedStages / totalStages) * 100);
        if (completedStages === totalStages) return `<span class="test-status-badge status-complete">✓ Complete</span>`;
        if (hasOverdueStage) return `<span class="test-status-badge status-overdue">⚠ Overdue</span>`;
        return `<span class="test-status-badge status-progress">${pct}% done</span>`;
      })() : ''}
            ${!showStages ? `
              <span class="test-status-badge ${test.status === 'done' ? 'status-complete' : 'status-progress'}">
                ${test.status === 'done' ? '✓ Complete' : '⏳ Pending'}
              </span>
            ` : ''}
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            ${!showStages ? `
              <button class="btn-ghost btn-sm" onclick="toggleCustomFmsCardStatus('${test.testId}')" style="color:${test.status === 'done' ? 'var(--text-muted)' : 'var(--accent-emerald)'}; font-weight:bold;">
                ${test.status === 'done' ? '⏳ Reopen' : '✓ Done'}
              </button>
            ` : ''}
            <button class="btn-ghost btn-sm" onclick="handleEditTestDetailsModal('${test.testId}')">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              Edit
            </button>
            <button class="btn-ghost btn-sm" style="color:var(--accent-red);" onclick="handleDeleteTestTracker('${test.testId}')">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              Delete
            </button>
            ${showStages ? `
            <div class="expand-chevron" style="transition:transform var(--transition-base); color:var(--text-muted); display:flex; align-items:center;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>` : ''}
          </div>
        </div>

        <!-- Test name -->
        <div class="test-name" style="margin-bottom:10px;">${test.testName}</div>

        <!-- 2-column meta grid -->
        <div class="test-meta-grid">
          <div class="meta-col">
            ${test.className && test.className !== 'undefined' ? `
            <div class="meta-kv">
              <span class="meta-k">Class</span>
              <span class="meta-v meta-bold">${test.className}</span>
            </div>` : ''}
          ${showMarks && test.maxScore ? `
            <div class="meta-kv">
              <span class="meta-k">${scoringLabel} (Max)</span>
              <span class="meta-v meta-bold">${test.maxScore}</span>
            </div>` : ''}
            ${showMarks && test.minScore !== undefined && test.minScore !== '' ? `
            <div class="meta-kv">
              <span class="meta-k">${scoringLabel} (Min)</span>
              <span class="meta-v">${test.minScore}${test.avgScore ? ` / avg ${test.avgScore}` : ''}</span>
            </div>` : ''}
          </div>
          <div class="meta-col">
            <div class="meta-kv">
              <span class="meta-k">Held On</span>
              <span class="meta-v meta-bold">${formatDate(test.heldOn)}</span>
            </div>
            ${totalStages > 0 && showStages ? (() => {
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
          else if (isDelayed && showOffsets) bg = 'var(--accent-red)';
          return `<div style="flex:1; background:${bg}; height:100%; transition:background 0.3s;" title="${stage.label || 'Stage'}: ${stage.status === 'done' ? 'Done' : (isDelayed && showOffsets ? 'Overdue' : 'Pending')}"></div>`;
        }).join('')}
                </div>
              </div>`;
      })() : ''}
          </div>
        </div>

        ${(() => {
        // Custom fields data display for custom blueprints
        if (!isCustom || !bp.fields || bp.fields.length === 0) return '';
        const customData = test.customData || {};
        const fieldPairs = bp.fields.filter(f => customData[f.id] !== undefined && customData[f.id] !== '');
        if (fieldPairs.length === 0) return '';
        const half = Math.ceil(fieldPairs.length / 2);
        const leftFields = fieldPairs.slice(0, half);
        const rightFields = fieldPairs.slice(half);
        const renderField = f => {
          let val = customData[f.id];
          if (f.type === 'url') val = `<a href="${val}" target="_blank" style="color:var(--accent-purple);text-decoration:underline;word-break:break-all;">${val}</a>`;
          else if (f.type === 'date') { try { val = formatDate(val); } catch (e) { } }
          else val = String(val).replace(/</g, '&lt;').replace(/>/g, '&gt;');
          return `<div class="meta-kv"><span class="meta-k">${f.label}</span><span class="meta-v">${val}</span></div>`;
        };
        return `
          <div class="test-meta-grid" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-glass);">
            <div class="meta-col">${leftFields.map(renderField).join('')}</div>
            <div class="meta-col">${rightFields.map(renderField).join('')}</div>
          </div>`;
      })()}

        ${(test.sheetLink || test.folderLink) && showLinks ? `
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
        
        ${showStages ? `
        <div class="test-pipeline">
          ${testStages.map((stage, sIdx) => {
        const plannedDate = new Date(heldOnDate);
        plannedDate.setDate(heldOnDate.getDate() + (stage.offset || 0));
        const pDateCheck = new Date(plannedDate);
        pDateCheck.setHours(23, 59, 59, 999);
        const isDelayed = stage.status !== 'done' && new Date() > pDateCheck;
        const statusClass = stage.status === 'done' ? 'done' : (isDelayed && showOffsets ? 'delayed' : 'pending');
        const doneIcon = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

        return `
              <div class="pipeline-step ${statusClass}" onclick="handleToggleTestStage('${test.testId}', ${stage.id})" title="Click to toggle status.">
                <div class="pipeline-step-left">
                  <div class="step-indicator">${stage.status === 'done' ? doneIcon : (sIdx + 1)}</div>
                </div>
                <div class="step-details">
                  <div class="step-main-info">
                    <div class="step-label" style="display:flex; align-items:center; gap:8px; width:100%;">
                      <span>${stage.label || 'Step'}</span>
                      ${stage.link && showLinks ? `
                        <a href="${stage.link}" target="_blank" onclick="event.stopPropagation();" class="btn-ghost btn-xs" style="display:inline-flex; align-items:center; gap:3px; text-decoration:none; color:var(--accent-purple); font-weight:700; padding:2px 6px; font-size:0.68rem; border-radius:4px; border:1px solid rgba(124,58,237,0.25); background:rgba(124,58,237,0.05); margin-left:auto;">
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="flex-shrink:0;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                          Link
                        </a>
                      ` : ''}
                    </div>
                    ${showOffsets ? `<div class="step-date">Planned: ${formatDate(plannedDate)}</div>` : ''}
                  </div>
                  <div class="step-meta-info">
                    ${showOffsets ? `<div><strong>Assigned:</strong> ${stage.doer || 'Unassigned'}</div>` : ''}
                    ${stage.status === 'done' ? `
                      <div><strong>Done by:</strong> ${stage.doneBy || 'System'}</div>
                      <div><strong>At:</strong> ${stage.doneAt || 'N/A'}</div>
                    ` : `<div style="color:var(--text-dim);"><strong>Status:</strong> Pending</div>`}
                  </div>
                </div>
              </div>`;
      }).join('')}
        </div>` : ''}
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

  const stage = (test.stages || []).find(s => s.id === stageId);
  const newStatus = (!stage || stage.status !== 'done') ? 'done' : 'pending';
  const newDate = newStatus === 'done' ? new Date().toISOString() : '';
  const doneBy = newStatus === 'done' ? state.currentUser : '';
  const doneAt = newStatus === 'done' ? new Date().toLocaleString() : '';

  // 1. Back up previous stage state in case we need to revert
  const prevStageState = stage ? { ...stage } : null;
  const wasNew = !stage;

  // 2. Apply updates locally and instantly render (Optimistic UI)
  if (!test.stages) test.stages = [];
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
  showToast('Updating stage...', 'info');

  // 3. Send API call in background
  try {
    const res = await apiFetch('updateTestStage', {
      testId,
      stageId,
      status: newStatus,
      actualDate: newDate,
      doneBy,
      doneAt
    }, 'POST');

    if (res.success) {
      showToast(`${test.testName} updated.`);
    } else {
      // Revert local state on failure
      if (prevStageState) {
        Object.assign(stage, prevStageState);
      } else if (wasNew) {
        test.stages = test.stages.filter(s => s.id !== stageId);
      }
      renderTests(state.tests);
      showToast('Failed to update stage: ' + (res.error || 'Unknown error'), 'error');
    }
  } catch (err) {
    // Revert local state on error
    if (prevStageState) {
      Object.assign(stage, prevStageState);
    } else if (wasNew) {
      test.stages = test.stages.filter(s => s.id !== stageId);
    }
    renderTests(state.tests);
    showToast('Failed to update stage', 'error');
  }
}

async function handleDeleteTestTracker(testId) {
  if (!confirm('Permanently delete this FMS entry?')) return;

  const test = state.tests.find(t => t.testId === testId);
  const blueprints = getCustomFmsBlueprints();
  const bp = test ? blueprints.find(b => b.type === test.type) : null;
  const isIndependent = false; // Forced false - everything connected to Supabase

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
  const allowed = state.userRole === 'admin' || state.userRole === 'coordinator' || state.userRole === 'process_coordinator';
  if (!allowed) {
    showToast('Only admins or coordinators can change settings.', 'error');
    return;
  }

  const blueprints = getCustomFmsBlueprints();
  const activeCustomBlueprint = blueprints.find(bp => bp.type.toLowerCase() === state.currentView);
  const isCustomView = !!activeCustomBlueprint;

  // Pre-select tab based on the active view
  if (isCustomView) {
    state.activeSettingsTab = activeCustomBlueprint.type;
  } else if (state.currentView === 'parents') {
    state.activeSettingsTab = 'Parents';
  } else if (state.currentView === 'enquiries') {
    state.activeSettingsTab = 'BeforeFee';
  } else if (state.currentView === 'admissions') {
    state.activeSettingsTab = 'AfterFee';
  } else if (state.currentView === 'videos') {
    state.activeSettingsTab = 'Video';
  } else {
    state.activeSettingsTab = 'Sheet';
  }

  // Update tab classes dynamically
  const sheetTab = $('settings-tab-sheet');
  const appTab = $('settings-tab-app');
  const videoTab = $('settings-tab-video');
  const beforeFeeTab = $('settings-tab-beforefee');
  const afterFeeTab = $('settings-tab-afterfee');
  const parentsTab = $('settings-tab-parents');

  // Dynamically filter visibility of settings tabs to prevent clutter and truncating
  const tabsContainer = document.querySelector('.test-settings-tabs');
  if (tabsContainer) {
    if (isCustomView) {
      tabsContainer.style.display = 'none'; // Only this custom FMS setting is active
    } else if (state.currentView === 'parents') {
      tabsContainer.style.display = 'none'; // Only Parents setting is available
    } else if (state.currentView === 'videos') {
      tabsContainer.style.display = 'none'; // Only Video setting is available
    } else if (state.currentView === 'enquiries') {
      tabsContainer.style.display = 'none'; // Only Enquiry setting is available
    } else if (state.currentView === 'admissions') {
      tabsContainer.style.display = 'none'; // Only Admission setting is available
    } else {
      tabsContainer.style.display = 'flex';

      if (sheetTab) sheetTab.style.display = 'inline-flex';
      if (appTab) appTab.style.display = 'inline-flex';
      if (videoTab) videoTab.style.display = 'none';
      if (beforeFeeTab) beforeFeeTab.style.display = 'none';
      if (afterFeeTab) afterFeeTab.style.display = 'none';
      if (parentsTab) parentsTab.style.display = 'none';
    }
  }

  if (sheetTab) sheetTab.classList.toggle('active', state.activeSettingsTab === 'Sheet');
  if (appTab) appTab.classList.toggle('active', state.activeSettingsTab === 'App');
  if (videoTab) videoTab.classList.toggle('active', state.activeSettingsTab === 'Video');
  if (beforeFeeTab) beforeFeeTab.classList.toggle('active', state.activeSettingsTab === 'BeforeFee');
  if (afterFeeTab) afterFeeTab.classList.toggle('active', state.activeSettingsTab === 'AfterFee');
  if (parentsTab) parentsTab.classList.toggle('active', state.activeSettingsTab === 'Parents');

  // Update FMS settings modal title and description dynamically
  updateTestSettingsModalTitleAndDesc();

  renderTestSettingsRows();
  $('test-settings-modal').style.display = 'flex';
}

function updateTestSettingsModalTitleAndDesc() {
  const titleEl = document.querySelector('#test-settings-modal .modal-header h3');
  const descEl = document.querySelector('#test-settings-modal .modal-body-text');
  const activeTab = state.activeSettingsTab || 'Sheet';

  const blueprints = getCustomFmsBlueprints();
  const activeCustomBlueprint = blueprints.find(bp => bp.type === activeTab);
  const isCustom = !!activeCustomBlueprint;

  if (titleEl) {
    if (isCustom) {
      titleEl.textContent = '⚙️ ' + activeCustomBlueprint.name + ' Settings';
    } else if (activeTab === 'Parents') {
      titleEl.textContent = '👪 Parents FMS Settings';
    } else if (activeTab === 'Video') {
      titleEl.textContent = '🎬 Video FMS Settings';
    } else if (activeTab === 'BeforeFee') {
      titleEl.textContent = '⏳ Enquiry Settings';
    } else if (activeTab === 'AfterFee') {
      titleEl.textContent = '💳 Admission Settings';
    } else if (activeTab === 'Sheet') {
      titleEl.textContent = '📄 Sheet Test FMS Settings';
    } else if (activeTab === 'App') {
      titleEl.textContent = '📱 App Test FMS Settings';
    } else {
      titleEl.textContent = 'FMS Pipeline Settings';
    }
  }

  if (descEl) {
    if (isCustom) {
      descEl.textContent = 'Configure the pipeline stages for the custom ' + activeCustomBlueprint.name + ' FMS. These templates will initialize stages for newly tracked records.';
    } else if (activeTab === 'Parents') {
      descEl.textContent = 'Configure the checklist guidelines for the Parents FMS. These settings will determine the checklist items displayed under the Parents Guidelines tab.';
    } else if (activeTab === 'Video') {
      descEl.textContent = 'Configure the stages for the Video FMS pipeline. These templates will initialize stages for newly tracked videos.';
    } else if (activeTab === 'BeforeFee') {
      descEl.textContent = 'Configure the pipeline stages for the Enquiry FMS. These templates will initialize stages for newly tracked enquiries.';
    } else if (activeTab === 'AfterFee') {
      descEl.textContent = 'Configure the pipeline stages for the Admission FMS. These templates will initialize stages for newly tracked admissions.';
    } else if (activeTab === 'Sheet') {
      descEl.textContent = 'Configure the stages for the Sheet Test FMS pipeline. These templates will initialize stages for newly tracked academic tests.';
    } else if (activeTab === 'App') {
      descEl.textContent = 'Configure the stages for the App Test FMS pipeline. These templates will initialize stages for newly tracked academic tests.';
    } else {
      descEl.textContent = 'Configure the template stages for the FMS pipelines. These templates will initialize stages for newly tracked records.';
    }
  }
}

window.setSettingsActiveTab = function (type) {
  saveActiveSettingsFromDOM();
  state.activeSettingsTab = type;

  // Update tab classes
  const sheetTab = $('settings-tab-sheet');
  const appTab = $('settings-tab-app');
  const videoTab = $('settings-tab-video');
  const beforeFeeTab = $('settings-tab-beforefee');
  const afterFeeTab = $('settings-tab-afterfee');
  const parentsTab = $('settings-tab-parents');
  if (sheetTab) sheetTab.classList.toggle('active', type === 'Sheet');
  if (appTab) appTab.classList.toggle('active', type === 'App');
  if (videoTab) videoTab.classList.toggle('active', type === 'Video');
  if (beforeFeeTab) beforeFeeTab.classList.toggle('active', type === 'BeforeFee');
  if (afterFeeTab) afterFeeTab.classList.toggle('active', type === 'AfterFee');
  if (parentsTab) parentsTab.classList.toggle('active', type === 'Parents');

  // Update title and description for the switched tab
  updateTestSettingsModalTitleAndDesc();

  renderTestSettingsRows();
};

window.selectTypeSegment = function (type) {
  const input = document.getElementById('test-form-type');
  if (!input) return;
  input.value = type;

  // All segment buttons
  const allSegments = [
    { id: 'type-segment-sheet', match: 'Sheet' },
    { id: 'type-segment-app', match: 'App' },
    { id: 'type-segment-video', match: 'Video' },
    { id: 'type-segment-beforefee', match: 'BeforeFee' },
    { id: 'type-segment-afterfee', match: 'AfterFee' },
    { id: 'type-segment-parents', match: 'Parents' },
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

  // Toggle visibility of Class, Subject, Chapter, and Marks rows based on type
  toggleAcademicFields(type);

  // Trigger change event so pipeline stages reload
  input.dispatchEvent(new Event('change'));
};

function toggleAcademicFields(type) {
  const isAcademic = type === 'Sheet' || type === 'App';
  const hasScoring = FMS_SCORING_ENABLED.has(type); // Video, AfterFee also score-enabled

  const classSubRow = $('form-row-class-subject');
  const chapterRow = $('form-row-chapter');
  const marksRow = $('form-row-marks');
  const customChapterGrp = $('custom-chapter-group');

  const classSel = $('test-form-class');
  const subjectSel = $('test-form-subject');
  const chapterInput = $('test-form-chapter');
  const customChapterInput = $('test-form-custom-chapter');
  const maxInput = $('test-form-max');
  const maxLabel = document.querySelector('label[for="test-form-max"]');
  const minLabel = document.querySelector('label[for="test-form-min"]');

  // Adapt label text for non-academic scoring types
  if (maxLabel) {
    if (type === 'Video') { maxLabel.textContent = 'Video Score (Max)'; }
    else if (type === 'AfterFee') { maxLabel.textContent = 'Fee / Score (Max)'; }
    else { maxLabel.textContent = 'Max Marks'; }
  }
  if (minLabel) {
    if (type === 'Video') { minLabel.textContent = 'Video Score (Min)'; }
    else if (type === 'AfterFee') { minLabel.textContent = 'Fee / Score (Min)'; }
    else { minLabel.textContent = 'Min Marks'; }
  }

  if (isAcademic) {
    if (classSubRow) classSubRow.style.display = 'flex';
    if (chapterRow) chapterRow.style.display = 'flex';
    if (marksRow) marksRow.style.display = 'flex';

    if (classSel) classSel.setAttribute('required', 'required');
    if (subjectSel) subjectSel.setAttribute('required', 'required');
    if (chapterInput) chapterInput.setAttribute('required', 'required');
    if (maxInput) maxInput.setAttribute('required', 'required');
  } else {
    if (classSubRow) classSubRow.style.display = 'none';
    if (chapterRow) chapterRow.style.display = 'none';
    if (customChapterGrp) customChapterGrp.style.display = 'none';

    if (classSel) classSel.removeAttribute('required');
    if (subjectSel) subjectSel.removeAttribute('required');
    if (chapterInput) chapterInput.removeAttribute('required');
    if (customChapterInput) customChapterInput.removeAttribute('required');

    // Show marks row for score-enabled non-academic types (Video, AfterFee)
    if (marksRow) marksRow.style.display = hasScoring ? 'flex' : 'none';
    // Max score is optional for these types (not required)
    if (maxInput) maxInput.removeAttribute('required');
  }
}

function renderTestSettingsRows() {
  const container = $('test-settings-list');
  const activeType = state.activeSettingsTab || 'Sheet';

  const blueprints = getCustomFmsBlueprints();
  const bp = blueprints.find(b => b.type === activeType);
  const isCustom = !!bp;

  if (isCustom && !bp.stagesNeeded) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px var(--space-md); color: var(--text-dim);">
        <span style="font-size: 2.2rem; display: block; margin-bottom: var(--space-md);">⚙️</span>
        <h4 style="font-weight: 700; color: var(--text-primary); margin-bottom: 5px;">Checklist Stages Disabled</h4>
        <p style="font-size: 0.78rem; line-height: 1.4; max-width: 320px; margin: 0 auto; color: var(--text-muted);">This FMS pipeline blueprint does not use stages checklist. Individual stages template configuration is not needed.</p>
      </div>
    `;
    const addBtn = $('btn-add-setting-row');
    if (addBtn) addBtn.style.display = 'none';
    return;
  }

  // Restore normal Add Stage button if enabled
  const addBtn = $('btn-add-setting-row');
  if (addBtn) addBtn.style.display = 'flex';

  const activeSettings = (state.testSettings || []).filter(s => s.type === activeType);
  const hideOffsetsAndDoer = isCustom ? !bp.offsetsNeeded : (activeType === 'Parents' || activeType === 'BeforeFee' || activeType === 'AfterFee');
  const hideLinks = isCustom ? !bp.linksNeeded : false;

  container.innerHTML = activeSettings.map((s, idx) => `
    <div class="form-row setting-row" data-index="${idx}" data-id="${s.id}" draggable="true" ondragstart="handleSettingDragStart(event)" ondragover="handleSettingDragOver(event)" ondrop="handleSettingDrop(event)" style="display:flex; flex-direction:column; gap:6px; margin-bottom: 10px; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px; cursor: move; position: relative;">
      
      <!-- Row 1: Label, Offset, Doer, Delete -->
      <div style="display:flex; flex-direction:row; align-items:center; flex-wrap:nowrap; gap:6px; width:100%;">
        <!-- Drag handle -->
        <div class="drag-handle" style="padding: 10px 5px; color: rgba(255,255,255,0.3); font-size: 1.2rem; display: flex; align-items: center; justify-content: center; height: 100%; user-select:none;">☰</div>
        <div class="form-group" style="flex: 2; margin-left: 5px;">
          <label>Label</label>
          <input type="text" class="setting-label" value="${s.label}">
        </div>
        <div class="form-group" style="flex: 1; ${hideOffsetsAndDoer ? 'display: none;' : ''}">
          <label>Offset (Days)</label>
          <input type="number" class="setting-offset" value="${s.offset}">
        </div>
        <div class="form-group" style="flex: 1.5; ${hideOffsetsAndDoer ? 'display: none;' : ''}">
          <label>Doer</label>
          <select class="setting-doer" style="width:100%; padding:6px 8px; font-size:0.8rem; background:rgba(255,255,255,0.05); border:1px solid var(--border-glass); border-radius:4px; color:var(--text-primary); cursor:pointer;">
            ${getDoerDropdownOptions(s.doer)}
          </select>
        </div>
        <button class="btn-ghost" onclick="removeSettingRow(${idx})" style="padding: 10px; color: var(--accent-red); margin-left: 5px;">✕</button>
      </div>

      <!-- Row 2: Link and Admin Hide option -->
      <div style="display:flex; flex-direction:row; align-items:center; gap:8px; width:100%; padding-left:25px;">
        <!-- Link Field -->
        <div class="form-group" style="flex:1; ${hideLinks ? 'display: none;' : ''}">
          <label style="display:flex; align-items:center; gap:4px;">🔗 Link <span style="font-size:0.65rem; font-weight:normal; color:var(--text-muted);">(optional URL)</span></label>
          <input type="text" class="setting-link" value="${s.link || ''}" style="width:100%;" placeholder="Stage Link URL">
        </div>
        <!-- Hide Stage option -->
        <div class="form-group" style="flex-shrink:0; display:flex; align-items:center; margin-top:20px;">
          <label style="display:flex; align-items:center; gap:4px; font-size:0.75rem; color:var(--text-muted); cursor:pointer; user-select:none;">
            <input type="checkbox" class="setting-hidden" ${s.hidden ? 'checked' : ''} style="cursor:pointer; width:14px; height:14px;">
            <span>Hide Stage</span>
          </label>
        </div>
      </div>

    </div>
  `).join('');
}

function addSettingRow() {
  const activeType = state.activeSettingsTab || 'Sheet';
  const newId = state.testSettings.length > 0 ? Math.max(...state.testSettings.map(s => s.id)) + 1 : 1;
  state.testSettings.push({ id: newId, label: 'New Stage', offset: 0, doer: '', type: activeType, link: '', hidden: false });
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
  const otherSettings = (state.testSettings || []).filter(s => s.type !== activeType);

  // Create updated objects for the active type from inputs
  const updatedActiveSettings = Array.from(rows).map((row, idx) => {
    const existingId = parseInt(row.getAttribute('data-id'));
    const existing = (state.testSettings || []).find(s => s.id === existingId) || {};
    const labelInput = row.querySelector('.setting-label');
    const offsetInput = row.querySelector('.setting-offset');
    const doerSelect = row.querySelector('.setting-doer');
    const linkInput = row.querySelector('.setting-link');
    const hiddenCheckbox = row.querySelector('.setting-hidden');
    return {
      id: !isNaN(existingId) ? existingId : idx + 100,
      label: labelInput ? labelInput.value.trim() : (existing.label || 'Stage ' + (idx + 1)),
      offset: offsetInput ? (parseInt(offsetInput.value) || 0) : (existing.offset || 0),
      doer: doerSelect ? doerSelect.value.trim() : (existing.doer || ''),
      type: activeType,
      link: linkInput ? linkInput.value.trim() : (existing.link || ''),
      hidden: hiddenCheckbox ? hiddenCheckbox.checked : (existing.hidden || false)
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
  let displayedTasks = tasks;

  // If not in calendar view, only show today's tasks or active/overdue/stuck/missed tasks (emulate legacy backend filter for task lists)
  if (state.taskViewMode !== 'calendar') {
    const todayDate = getTodayStr();
    displayedTasks = tasks.filter(t => {
      const d = (t.plannedDate || '').substring(0, 10);
      return d === todayDate || ['overdue', 'stuck', 'in-progress', 'missed'].includes(t.status);
    });
  }

  // Apply Search and Status Filters
  const filteredTasks = displayedTasks.filter(t => {
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

  // Handle Calendar View Toggle
  if (state.taskViewMode === 'calendar') {
    $('task-type-tabs').style.display = 'none';
    $('recurring-section').style.display = 'none';
    $('onetime-section').style.display = 'none';
    $('task-calendar-container').style.display = 'block';
    renderCalendarView(filteredTasks);
    return;
  } else {
    $('task-calendar-container').style.display = 'none';
  }

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
      if (t.taskType !== 'weekly') return false;
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

  // SWR Caching: If we already have cached data, render it INSTANTLY without showing a spinner!
  if (state.dashboardCache) {
    const { scoresRes, teamRes, leavesRes, perfRes, healthRes, modRes } = state.dashboardCache;
    renderDashboardWithRes(scoresRes, teamRes, leavesRes, perfRes, healthRes, modRes);

    // Silently fetch fresh data in the background to detect updates
    Promise.all([
      apiFetch('getScores').catch(() => ({ success: true, data: [] })),
      apiFetch('getTeam').catch(() => ({ success: true, data: [] })),
      apiFetch('getLeaves').catch(() => ({ success: true, data: [] })),
      apiFetch('getTeamPerformance').catch(() => ({ success: true, data: [] })),
      (state.userRole === 'admin' || state.userRole === 'process_coordinator')
        ? apiFetch('getWorkflowHealth').catch(() => ({ success: true, data: null }))
        : Promise.resolve({ success: true, data: null }),
      apiFetch('getPendingModifications').catch(() => ({ success: true, data: [] }))
    ]).then(([scoresResNew, teamResNew, leavesResNew, perfResNew, healthResNew, modResNew]) => {
      const oldCacheStr = JSON.stringify(state.dashboardCache);
      const newCache = {
        scoresRes: scoresResNew,
        teamRes: teamResNew,
        leavesRes: leavesResNew,
        perfRes: perfResNew,
        healthRes: healthResNew,
        modRes: modResNew
      };

      // Only re-render if the fetched data actually changed!
      if (oldCacheStr !== JSON.stringify(newCache)) {
        state.dashboardCache = newCache;
        if (state.currentView === 'dashboard') {
          renderDashboardWithRes(scoresResNew, teamResNew, leavesResNew, perfResNew, healthResNew, modResNew);
        }
      }
    }).catch(err => console.error('Dashboard background sync failed:', err));

    return;
  }

  // If no cache, show spinner and fetch for the first time
  if (content) content.innerHTML = '<div class="premium-loader"><div class="premium-loader-bar"></div><div class="premium-loader-bar mid"></div><div class="premium-loader-bar short"></div></div>';

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

    state.dashboardCache = { scoresRes, teamRes, leavesRes, perfRes, healthRes, modRes };
    renderDashboardWithRes(scoresRes, teamRes, leavesRes, perfRes, healthRes, modRes);
  } catch (err) {
    console.error('Dashboard error:', err);
    if (content) content.innerHTML = '<div class="empty-state">Failed to load dashboard data. Please try again.</div>';
  }
}

// Helper function to process and render dashboard from raw responses
function renderDashboardWithRes(scoresRes, teamRes, leavesRes, perfRes, healthRes, modRes) {
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
      </div>

      <div class="dashboard-scores-summary" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-xs); text-align: center; background: var(--bg-glass); padding: 8px; border-radius: var(--radius-md); border: 1px solid var(--border-glass); margin-bottom: var(--space-xs);">
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <span style="font-size: 0.6rem; color: var(--text-muted); font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;">Week</span>
          <strong style="font-size: 1rem; color: var(--text-primary); margin-top: 2px;">
            ${s.score || 0}
            ${s.negativeWeek ? `<span style="color:var(--accent-red); font-size:0.7rem; font-weight:normal; margin-left:2px;">(-${s.negativeWeek})</span>` : ''}
          </strong>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; border-left: 1px solid var(--border-glass); border-right: 1px solid var(--border-glass);">
          <span style="font-size: 0.6rem; color: var(--text-muted); font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;">Today</span>
          <span style="font-size: 1rem; color: var(--accent-emerald); font-weight: 700; margin-top: 2px;">
            ${s.todayScore || 0}
            ${s.negativeToday ? `<span style="color:var(--accent-red); font-size:0.7rem; font-weight:normal; margin-left:2px;">(-${s.negativeToday})</span>` : ''}
          </span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <span style="font-size: 0.6rem; color: var(--text-muted); font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;">All-Time</span>
          <span style="font-size: 1rem; color: var(--accent-purple); font-weight: 700; margin-top: 2px;">
            ${s.overallScore || 0}
            ${s.negativeAllTime ? `<span style="color:var(--accent-red); font-size:0.7rem; font-weight:normal; margin-left:2px;">(-${s.negativeAllTime})</span>` : ''}
          </span>
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
  listContainer.innerHTML = '<div class="premium-loader"><div class="premium-loader-bar"></div><div class="premium-loader-bar mid"></div><div class="premium-loader-bar short"></div></div>';
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
  if (content) content.innerHTML = '<div class="premium-loader"><div class="premium-loader-bar"></div><div class="premium-loader-bar mid"></div><div class="premium-loader-bar short"></div></div>';

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
  if (content) content.innerHTML = '<div class="premium-loader"><div class="premium-loader-bar"></div><div class="premium-loader-bar mid"></div><div class="premium-loader-bar short"></div></div>';

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

  customChapterInput.addEventListener('input', updateTestName);

  // Expose updateTestName and updateChapters for custom dropdown selections
  window._updateTestFormName = updateTestName;
  window._updateTestFormChapters = updateChapters;

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

  // Close class dropdown on outside click
  document.addEventListener('click', function (e) {
    const wrapper = $('class-dropdown-wrapper');
    if (wrapper && !wrapper.contains(e.target)) {
      const menu = $('class-dropdown-menu');
      if (menu) menu.style.display = 'none';
      const chev = $('class-dropdown-chevron');
      if (chev) chev.style.transform = '';
    }
  });

  // Close subject dropdown on outside click
  document.addEventListener('click', function (e) {
    const wrapper = $('subject-dropdown-wrapper');
    if (wrapper && !wrapper.contains(e.target)) {
      const menu = $('subject-dropdown-menu');
      if (menu) menu.style.display = 'none';
      const chev = $('subject-dropdown-chevron');
      if (chev) chev.style.transform = '';
    }
  });
}

// ── Custom Class & Subject Dropdowns ────────────────
window.toggleClassDropdown = function () {
  const menu = $('class-dropdown-menu');
  const chev = $('class-dropdown-chevron');
  if (!menu) return;
  const isOpen = menu.style.display !== 'none';
  menu.style.display = isOpen ? 'none' : 'block';
  if (chev) chev.style.transform = isOpen ? '' : 'rotate(180deg)';
};

window.selectClassOption = function (el) {
  const value = el.dataset.value;
  const label = $('class-dropdown-label');
  const btn = $('class-dropdown-btn');
  const input = $('test-form-class');

  document.querySelectorAll('.class-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');

  if (label) label.textContent = el.textContent;
  if (input) {
    input.value = value;
    // Trigger chapter update
    if (window._updateTestFormChapters) window._updateTestFormChapters();
  }

  const menu = $('class-dropdown-menu');
  if (menu) menu.style.display = 'none';
  const chev = $('class-dropdown-chevron');
  if (chev) chev.style.transform = '';
};

window.toggleSubjectDropdown = function () {
  const menu = $('subject-dropdown-menu');
  const chev = $('subject-dropdown-chevron');
  if (!menu) return;
  const isOpen = menu.style.display !== 'none';
  menu.style.display = isOpen ? 'none' : 'block';
  if (chev) chev.style.transform = isOpen ? '' : 'rotate(180deg)';
};

window.selectSubjectOption = function (el) {
  const value = el.dataset.value;
  const label = $('subject-dropdown-label');
  const btn = $('subject-dropdown-btn');
  const input = $('test-form-subject');

  document.querySelectorAll('.subject-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');

  if (label) label.textContent = value ? el.textContent : '-- Select Subject --';
  if (btn) btn.style.color = value ? 'var(--text-primary)' : 'var(--text-muted)';
  if (input) {
    input.value = value;
    // Trigger chapter update
    if (window._updateTestFormChapters) window._updateTestFormChapters();
  }

  const menu = $('subject-dropdown-menu');
  if (menu) menu.style.display = 'none';
  const chev = $('subject-dropdown-chevron');
  if (chev) chev.style.transform = '';
};

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

function updateSplashUser(name) {
  if (!name) return;
  const cleanName = name.trim();
  const splashShape = document.getElementById('splash-shape');
  if (splashShape) {
    if (splashShape.getAttribute('data-user') === cleanName) {
      return;
    }
    splashShape.setAttribute('data-user', cleanName);
  }

  const firstLetter = cleanName.charAt(0).toUpperCase();
  const restOfName = cleanName.slice(1);

  let baseSize = '3.8rem';
  let svgFontSize = '82';

  if (cleanName.length > 12) {
    baseSize = '2.2rem';
    svgFontSize = '48';
  } else if (cleanName.length > 8) {
    baseSize = '2.8rem';
    svgFontSize = '60';
  } else if (cleanName.length > 5) {
    baseSize = '3.3rem';
    svgFontSize = '72';
  }

  // Update the first letter S or any other letter
  if (splashShape) {
    if (firstLetter === 'S') {
      splashShape.innerHTML = `
        <div class="splash-shape-inner"></div>
        <svg class="splash-svg-s" viewBox="0 0 100 100">
          <path class="path-s-top" d="M50,50 C43,47 38,42 38,32 C38,18 62,18 62,32" fill="none" stroke="url(#s-grad)" stroke-width="12" stroke-linecap="round" />
          <path class="path-s-bottom" d="M50,50 C57,53 62,58 62,68 C62,82 38,82 38,68" fill="none" stroke="url(#s-grad)" stroke-width="12" stroke-linecap="round" />
          <defs>
            <linearGradient id="s-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#c084fc" />
              <stop offset="100%" stop-color="#7c3aed" />
            </linearGradient>
          </defs>
        </svg>
      `;
    } else {
      splashShape.innerHTML = `
        <div class="splash-shape-inner"></div>
        <svg class="splash-svg-s" viewBox="0 0 100 100">
          <text x="50%" y="52%" dominant-baseline="central" text-anchor="middle" font-family="'Outfit', sans-serif" font-size="${svgFontSize}" font-weight="900" fill="url(#s-grad)">${firstLetter}</text>
          <defs>
            <linearGradient id="s-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#c084fc" />
              <stop offset="100%" stop-color="#7c3aed" />
            </linearGradient>
          </defs>
        </svg>
      `;
    }
  }

  // Update the remaining letters
  const logoText = document.getElementById('splash-logo-text');
  if (logoText) {
    const delayStart = 2.1;
    logoText.innerHTML = restOfName.split('').map((char, index) => {
      const delay = delayStart + (index * 0.1);
      return `<span class="letter-hivang" style="font-size: ${baseSize}; animation: spawn-hivang-letter 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) ${delay}s forwards;">${char}</span>`;
    }).join('');
  }
}

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

  // Animation gate: minimum splash duration (4.5s cinematic reveal + 1s admire pause)
  const animationPromise = new Promise(resolve => setTimeout(resolve, 5500));

  const savedSession = localStorage.getItem('svm_session');

  // ─── PHASE 1: FIRE ALL NETWORK FETCHES IMMEDIATELY ───────────────────────
  // Data loads in parallel with the splash animation — no waiting.
  let networkPromise;
  if (savedSession) {
    try {
      const userData = JSON.parse(savedSession);
      state.currentUser = userData.name;
      state.userRole = (userData.role || 'member').toLowerCase();
      updateSplashUser(userData.name);

      networkPromise = Promise.all([
        apiFetch('getTeam').then(res => { state.teamMembers = res.data || []; }).catch(() => { }),
        apiFetch('getTasks', { user: state.currentUser, allDates: true }).then(res => { state.tasks = res.data || []; }).catch(() => { }),
        apiFetch('getScores', { user: state.currentUser }).then(res => { state.stats = res.data; }).catch(() => { }),
        apiFetch('getTestSettings').then(res => { if (res.success) state.testSettings = res.data; }).catch(() => { }),
        apiFetch('getTests').then(res => { if (res.success) state.tests = res.data; }).catch(() => { })
      ]);
    } catch (e) {
      networkPromise = Promise.all([
        apiFetch('getTeam').then(res => { state.teamMembers = res.data || []; }).catch(() => { })
      ]);
    }
  } else {
    networkPromise = Promise.all([
      apiFetch('getTeam').then(res => { state.teamMembers = res.data || []; }).catch(() => { })
    ]);
  }

  // ─── PHASE 2: RENDER UI AS SOON AS DATA IS READY ─────────────────────────
  // UI renders behind the splash screen the moment data arrives.
  // This runs independently — does NOT wait for the animation to finish.
  networkPromise.then(() => {
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
  });

  // ─── PHASE 3: CURTAIN RISE AFTER FULL ANIMATION COMPLETES ────────────────
  // Only the visual reveal waits for the animation gate.
  // By this point the workspace is fully rendered and waiting beneath the splash.
  await animationPromise;

  const loader = $('loading-screen');
  if (loader) {
    loader.classList.add('pull-up-reveal');
    setTimeout(() => loader.classList.add('hidden'), 1300);
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
      apiFetch('getTasks', { user, allDates: true }),
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

    // Pre-load FMS pipelines and Team Dashboard in the background immediately!
    preloadAllTabsData();

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
 * Pre-warms and pre-loads all tabs (Test FMS, Parents FMS, Team Dashboard) 
 * silently in the background immediately upon startup/login.
 * This completely eliminates loading spinners and delay on the first tab switches!
 */
function preloadAllTabsData() {
  console.log('Starting background pre-load of all tabs...');

  // 1. Pre-load FMS settings and pipelines
  Promise.all([
    apiFetch('getTestSettings'),
    apiFetch('getTests')
  ]).then(([settingsRes, testsRes]) => {
    if (settingsRes.success) state.testSettings = settingsRes.data;
    if (testsRes.success) state.tests = testsRes.data;
    sanitizeTestSettings();
    console.log('FMS Pipelines successfully preloaded in background.');
  }).catch(err => console.error('Failed to preload FMS data:', err));

  // 2. Pre-load Dashboard metrics & pending approvals
  Promise.all([
    apiFetch('getScores').catch(() => ({ success: true, data: [] })),
    apiFetch('getTeam').catch(() => ({ success: true, data: [] })),
    apiFetch('getLeaves').catch(() => ({ success: true, data: [] })),
    apiFetch('getTeamPerformance').catch(() => ({ success: true, data: [] })),
    (state.userRole === 'admin' || state.userRole === 'process_coordinator')
      ? apiFetch('getWorkflowHealth').catch(() => ({ success: true, data: null }))
      : Promise.resolve({ success: true, data: null }),
    apiFetch('getPendingModifications').catch(() => ({ success: true, data: [] }))
  ]).then(([scoresRes, teamRes, leavesRes, perfRes, healthRes, modRes]) => {
    state.dashboardCache = { scoresRes, teamRes, leavesRes, perfRes, healthRes, modRes };

    // Update the notification badge next to the "Team" tab on startup!
    const pendingMembersCount = teamRes.data ? teamRes.data.filter(m => !(m.active === true || String(m.active).toUpperCase().trim() === 'TRUE')).length : 0;
    const pendingLeavesCount = leavesRes.data ? leavesRes.data.filter(l => l.status === 'pending').length : 0;
    const pendingModsCount = modRes.data ? modRes.data.length : 0;
    const totalPending = pendingMembersCount + pendingLeavesCount + pendingModsCount;

    const teamBadge = $('team-badge');
    if (teamBadge) {
      if (totalPending > 0) {
        teamBadge.style.display = 'block';
        teamBadge.textContent = totalPending;
      } else {
        teamBadge.style.display = 'none';
      }
    }
    console.log('Dashboard metrics successfully preloaded in background.');
  }).catch(err => console.error('Failed to preload Dashboard data:', err));
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
      apiFetch('getTasks', { user, allDates: true }),
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

function addTaskTimeRow(val = '') {
  const container = $('new-task-times-container');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'time-input-row';
  row.style.display = 'flex';
  row.style.gap = '8px';
  row.style.alignItems = 'center';
  row.style.marginTop = '4px';
  row.innerHTML = `
    <input type="time" class="task-time-input" value="${val}" style="flex:1;">
    <button type="button" class="btn-danger" onclick="this.parentElement.remove()" style="width:auto; padding:0 var(--space-sm); margin:0; height:36px; display:flex; align-items:center; justify-content:center;">-</button>
  `;
  container.appendChild(row);
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
  
  const container = $('new-task-times-container');
  if (container) {
    container.innerHTML = `
      <div class="time-input-row" style="display:flex; gap:8px; align-items:center;">
        <input type="time" class="task-time-input" style="flex:1;">
        <button type="button" class="btn-primary" id="btn-add-time-row" style="width:auto; padding:0 var(--space-sm); margin:0; height:36px; display:flex; align-items:center; justify-content:center;">+</button>
      </div>
    `;
    const addBtn = $('btn-add-time-row');
    if (addBtn) addBtn.onclick = () => addTaskTimeRow();
  }

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
  
  const container = $('new-task-times-container');
  if (container) {
    container.innerHTML = `
      <div class="time-input-row" style="display:flex; gap:8px; align-items:center;">
        <input type="time" class="task-time-input" value="${task.time || ''}" style="flex:1;">
      </div>
    `;
  }
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

function getKolkataDateParts(dateObj) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(dateObj);
  const map = {};
  parts.forEach(p => { map[p.type] = p.value; });
  return map;
}

function isPastDateTimeKolkata(dateStr, timeStr) {
  const now = new Date();
  const parts = getKolkataDateParts(now);
  const nowKolkataStr = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  const targetKolkataStr = `${dateStr}T${timeStr || '23:59:59'}`;
  return targetKolkataStr < nowKolkataStr;
}

function formatTime12Hr(timeStr) {
  if (!timeStr) return '';
  const [hoursStr, minutesStr] = timeStr.split(':');
  let hours = parseInt(hoursStr, 10);
  const minutes = minutesStr;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${hours}:${minutes} ${ampm}`;
}

async function handleTaskSubmit(e) {
  e.preventDefault();
  const name = $('new-task-name').value.trim();
  const type = $('new-task-type').value;
  const date = $('new-task-date').value || getTodayStr();
  
  const timeInputs = Array.from(document.querySelectorAll('#new-task-times-container .task-time-input'));
  const times = timeInputs.map(input => input.value).filter(val => val !== '');
  const finalTimes = times.length > 0 ? times : [''];

  const notes = $('new-task-notes').value.trim();
  const priority = $('new-task-priority').value;
  const recurrence = $('new-task-recurrence').value.trim() || type;

  if (!name) return;

  const submitBtn = $('add-task-submit');
  const isEdit = !!state.editingTaskId;
  
  // Past date/time validation for task creation (using Kolkata time zone)
  if (!isEdit) {
    for (const t of finalTimes) {
      if (isPastDateTimeKolkata(date, t)) {
        showToast("Past date/time task cannot be added.", "error");
        closeAddTaskModal();
        return;
      }
    }
  }

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

      payload.time = finalTimes[0];
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

    if (isEdit) {
      payload.time = finalTimes[0];
      const res = await apiFetch(action, payload, 'POST');
      const idx = state.tasks.findIndex(t => t.taskId === state.editingTaskId);
      if (idx !== -1) {
        state.tasks[idx] = { ...state.tasks[idx], ...payload };
      }
      showToast('Task updated.');
    } else {
      for (const t of finalTimes) {
        const singlePayload = { ...payload, time: t };
        const res = await apiFetch(action, singlePayload, 'POST');
        const newTask = {
          taskId: res.data.taskId,
          ...singlePayload,
          completedDate: '',
          status: 'pending'
        };
        state.tasks.push(newTask);
      }
      showToast(`${finalTimes.length} task(s) added.`);
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
    if ($('fms-builder-container')) $('fms-builder-container').style.display = 'none';
    if ($('student-container')) $('student-container').style.display = 'none';
    await initForUser(state.currentUser);
  } else {
    myTasksTab?.classList.remove('active');
    teamTab?.classList.add('active');
    $('task-view-container').style.display = 'none';
    $('admin-dashboard-container').style.display = 'block';
    if ($('fms-builder-container')) $('fms-builder-container').style.display = 'none';
    if ($('student-container')) $('student-container').style.display = 'none';
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

$('btn-toggle-task-view')?.addEventListener('click', () => {
  state.taskViewMode = state.taskViewMode === 'calendar' ? 'list' : 'calendar';
  const btn = $('btn-toggle-task-view');
  if (btn) {
    btn.innerHTML = state.taskViewMode === 'calendar' ? '📋 List View' : '📅 Calendar View';
  }
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
  if (e.target.id === 'btn-add-test') {
    if (state.currentView === 'parents') {
      window.resetParentsChecklist();
    } else {
      openAddTestModal();
    }
  }
});

// =============================================
// TEST FMS HANDLERS
// =============================================
// Global states for individual stages configuration inside the modal
let currentFormStages = [];

/**
 * Returns HTML options for a "Doer" (Assigned To) select dropdown.
 * Populates with "Unassigned", "All", and all names from state.teamMembers.
 * If the current value is not in state.teamMembers, it is preserved as an option.
 */
function getDoerDropdownOptions(currentDoer) {
  const names = (state.teamMembers || []).map(m => m.name);
  const options = [];

  options.push(`<option value=""${!currentDoer ? ' selected' : ''}>Unassigned</option>`);
  options.push(`<option value="All"${currentDoer === 'All' ? ' selected' : ''}>All</option>`);

  (state.teamMembers || []).forEach(m => {
    options.push(`<option value="${m.name}"${currentDoer === m.name ? ' selected' : ''}>${m.name}</option>`);
  });

  if (currentDoer && currentDoer !== 'All' && !names.includes(currentDoer)) {
    options.push(`<option value="${currentDoer}" selected>${currentDoer}</option>`);
  }

  return options.join('');
}

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

  const type = $('test-form-type').value;
  const isParents = type === 'Parents';

  container.innerHTML = currentFormStages.map((s, idx) => `
    <div class="form-stage-row" data-index="${idx}" draggable="false"
      ondragstart="${isAdmin ? 'handleFormStageDragStart(event)' : 'event.preventDefault()'}"
      ondragover="${isAdmin ? 'handleFormStageDragOver(event)' : ''}"
      ondrop="${isAdmin ? 'handleFormStageDrop(event)' : ''}"
      ondragend="${isAdmin ? 'handleFormStageDragEnd(event)' : ''}"
      style="display:flex; flex-direction:column; gap:6px; margin-bottom:8px; padding:8px; background:rgba(255,255,255,0.015); border:1px solid ${isUnlocked && !isAdmin ? 'rgba(16,185,129,0.25)' : 'var(--border-glass)'}; border-radius:6px; transition:border-color 0.3s;">
      
      <!-- Row 1: Core Fields -->
      <div style="display:flex; flex-direction:row; align-items:center; flex-wrap:nowrap; gap:6px; width:100%;">
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
                 color:var(--text-primary); ${isParents ? 'display: none;' : ''}" title="Offset days — always editable">
        <select class="form-stage-doer"
          style="flex:1.5; min-width:0; padding:6px 8px; font-size:0.8rem;
                 background:rgba(255,255,255,0.05);
                 border:1px solid var(--border-glass); border-radius:4px;
                 color:var(--text-primary);
                 cursor:pointer; ${isParents ? 'display: none;' : ''}">
          ${getDoerDropdownOptions(s.doer)}
        </select>
        ${isAdmin ? `<button type="button" onclick="removeIndividualTestStageRow(${idx})" style="flex-shrink:0; background:none; border:none; color:var(--accent-red); cursor:pointer; font-size:1rem; line-height:1; padding:2px 4px;">✕</button>` : ''}
      </div>

      <!-- Row 2: Link and Admin Hide option -->
      <div style="display:flex; flex-direction:row; align-items:center; gap:8px; width:100%;">
        <!-- Link Field -->
        <div style="display:flex; align-items:center; gap:4px; flex:1;">
          <span style="font-size:0.75rem; color:var(--text-muted); flex-shrink:0;">🔗</span>
          <input type="text" class="form-stage-link" value="${s.link || ''}" ${canEdit ? '' : 'readonly disabled'}
            style="flex:1; padding:4px 8px; font-size:0.75rem;
                   background:${canEdit ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)'};
                   border:1px solid var(--border-glass); border-radius:4px;
                   color:${canEdit ? 'var(--text-primary)' : 'var(--text-muted)'};
                   cursor:${canEdit ? 'text' : 'not-allowed'};" placeholder="Stage Link (Optional URL)">
        </div>
        <!-- Hide Stage option -->
        ${isAdmin ? `
        <label style="display:flex; align-items:center; gap:4px; font-size:0.72rem; color:var(--text-muted); cursor:pointer; user-select:none; flex-shrink:0;">
          <input type="checkbox" class="form-stage-hidden" ${s.hidden ? 'checked' : ''} style="cursor:pointer; width:12px; height:12px;">
          <span>Hide Stage</span>
        </label>
        ` : ''}
      </div>

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
    doneAt: '',
    link: '',
    hidden: false
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
    const linkInput = row.querySelector('.form-stage-link');
    const hiddenCheckbox = row.querySelector('.form-stage-hidden');
    return {
      id: existing.id || idx + 1,
      label: row.querySelector('.form-stage-label').value.trim(),
      offset: parseInt(row.querySelector('.form-stage-offset').value) || 0,
      doer: row.querySelector('.form-stage-doer').value.trim(),
      status: existing.status || 'pending',
      actualDate: existing.actualDate || '',
      doneBy: existing.doneBy || '',
      doneAt: existing.doneAt || '',
      link: linkInput ? linkInput.value.trim() : (existing.link || ''),
      hidden: hiddenCheckbox ? hiddenCheckbox.checked : (existing.hidden || false)
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

  // Reset custom Class dropdown to default (Class 10)
  const defaultClassOption = Array.from(document.querySelectorAll('.class-option')).find(o => o.dataset.value === '10');
  if (defaultClassOption) selectClassOption(defaultClassOption);

  // Reset custom Subject dropdown to default (empty)
  const defaultSubjectOption = Array.from(document.querySelectorAll('.subject-option')).find(o => o.dataset.value === '');
  if (defaultSubjectOption) selectSubjectOption(defaultSubjectOption);

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
  const isAdmissionView = state.currentView === 'admissions';
  const isEnquiryView = state.currentView === 'enquiries';
  const isParentsView = state.currentView === 'parents';

  const blueprints = getCustomFmsBlueprints();
  const activeCustomBlueprint = blueprints.find(bp => bp.type.toLowerCase() === state.currentView);
  const isCustomView = !!activeCustomBlueprint;

  const defaultType = isCustomView ? activeCustomBlueprint.type : (isParentsView ? 'Parents' : (isEnquiryView ? 'BeforeFee' : (isAdmissionView ? 'AfterFee' : (isVideoView ? 'Video' : 'Sheet'))));
  selectTypeSegment(defaultType);

  // Dynamic Modal Header and Form Groups based on view type
  const modalTitle = $('add-test-modal-title');
  const typeFormGroup = $('test-type-form-group');
  const submitBtn = $('add-test-modal')?.querySelector('button[type="submit"]');
  const nameLabel = document.querySelector('label[for="test-form-name"]');
  const nameInput = $('test-form-name');

  // Configure segments display
  const sheetSeg = $('type-segment-sheet');
  const appSeg = $('type-segment-app');
  const videoSeg = $('type-segment-video');
  const beforeFeeSeg = $('type-segment-beforefee');
  const afterFeeSeg = $('type-segment-afterfee');
  const parentsSeg = $('type-segment-parents');

  if (isParentsView) {
    if (modalTitle) modalTitle.textContent = 'Track Parents Checklist';
    if (typeFormGroup) typeFormGroup.style.display = 'none'; // Hide type segmented control completely
    if (submitBtn) submitBtn.textContent = 'Start Tracking Checklist';
    if (nameLabel) nameLabel.textContent = 'Checklist Title';
    if (nameInput) nameInput.placeholder = 'e.g., Student Rahul Kumar - Parents Checklist';
  } else if (isCustomView) {
    if (modalTitle) modalTitle.textContent = 'Track New ' + activeCustomBlueprint.name;
    if (typeFormGroup) typeFormGroup.style.display = 'none'; // Hide type segmented control completely
    if (submitBtn) submitBtn.textContent = 'Start Tracking ' + activeCustomBlueprint.name;
    if (nameLabel) nameLabel.textContent = activeCustomBlueprint.name + ' Student/Item Name';
    if (nameInput) nameInput.placeholder = 'e.g., Rahul Kumar';
  } else if (isEnquiryView) {
    if (modalTitle) modalTitle.textContent = 'Track New Enquiry';
    if (typeFormGroup) typeFormGroup.style.display = 'none'; // Hide type segmented control completely
    if (submitBtn) submitBtn.textContent = 'Start Tracking Enquiry';
    if (nameLabel) nameLabel.textContent = 'Student Name';
    if (nameInput) nameInput.placeholder = 'e.g., Rahul Kumar';
  } else if (isAdmissionView) {
    if (modalTitle) modalTitle.textContent = 'Track New Admission';
    if (typeFormGroup) typeFormGroup.style.display = 'none'; // Hide type segmented control completely
    if (submitBtn) submitBtn.textContent = 'Start Tracking Admission';
    if (nameLabel) nameLabel.textContent = 'Student Name';
    if (nameInput) nameInput.placeholder = 'e.g., Rahul Kumar';
  } else if (isVideoView) {
    if (modalTitle) modalTitle.textContent = 'Track New Video';
    if (typeFormGroup) typeFormGroup.style.display = 'none'; // Hide type segmented control completely
    if (submitBtn) submitBtn.textContent = 'Start Tracking Video';
    if (nameLabel) nameLabel.textContent = 'Video Title';
    if (nameInput) nameInput.placeholder = 'e.g., Coordinate Geometry Animation Video';
  } else {
    if (modalTitle) modalTitle.textContent = 'Track New Test';
    if (typeFormGroup) typeFormGroup.style.display = 'block'; // Show type segmented control
    if (submitBtn) submitBtn.textContent = 'Start Tracking';
    if (nameLabel) nameLabel.textContent = 'Test Name';
    if (nameInput) nameInput.placeholder = 'e.g., UT-1 Maths';

    if (sheetSeg) sheetSeg.style.display = 'block';
    if (appSeg) appSeg.style.display = 'block';
    if (videoSeg) videoSeg.style.display = 'none';
    if (beforeFeeSeg) beforeFeeSeg.style.display = 'none';
    if (afterFeeSeg) afterFeeSeg.style.display = 'none';
    if (parentsSeg) parentsSeg.style.display = 'none';
  }

  // Pre-populate individual stages with global blueprints
  const currentFmsBp = blueprints.find(b => b.type === defaultType);
  if (currentFmsBp && !currentFmsBp.stagesNeeded) {
    currentFormStages = [{
      id: 999,
      label: 'Complete',
      offset: 0,
      doer: 'All',
      status: 'pending',
      actualDate: '',
      doneBy: '',
      doneAt: '',
      link: '',
      hidden: false
    }];
  } else {
    const blueprint = (state.testSettings || []).filter(s => s.type === defaultType);
    currentFormStages = blueprint.map(s => ({
      id: s.id,
      label: s.label,
      offset: s.offset,
      doer: s.doer,
      status: 'pending',
      actualDate: '',
      doneBy: '',
      doneAt: '',
      link: s.link || '',
      hidden: s.hidden || false
    }));
  }
  renderIndividualFormStages();

  // Inject custom fields for custom blueprints
  const customFieldsContainer = $('custom-fms-fields-container');
  const pipelineSection = $('pipeline-stages-section');
  const formRowClassSubject = $('form-row-class-subject');
  const formRowChapter = $('form-row-chapter');
  const formRowMarks = $('form-row-marks');
  const heldOnLabel = $('test-form-held-on-label');
  const nameLabel2 = $('test-form-name-label');

  if (isCustomView && activeCustomBlueprint.fields && activeCustomBlueprint.fields.length > 0) {
    // Hide standard test-specific rows for custom FMS
    if (formRowClassSubject) formRowClassSubject.style.display = 'none';
    if (formRowChapter) formRowChapter.style.display = 'none';
    if (formRowMarks) formRowMarks.style.display = activeCustomBlueprint.marksNeeded ? 'flex' : 'none';

    // Update labels
    if (nameLabel2) nameLabel2.textContent = activeCustomBlueprint.name + ' Entry Title';
    if (heldOnLabel) heldOnLabel.textContent = 'Entry Date';

    // Render custom fields
    const fieldRows = activeCustomBlueprint.fields.map(f => {
      const isRequired = f.required ? 'required' : '';
      const reqMark = f.required ? ' <span style="color:var(--accent-red);">*</span>' : '';
      if (f.type === 'select') {
        const opts = (f.options || '').split(',').map(o => o.trim()).filter(Boolean);
        return `
          <div class="form-group">
            <label>${f.label}${reqMark}</label>
            <select id="custom-field-${f.id}" data-field-id="${f.id}" ${isRequired} style="width:100%;">
              <option value="">-- Select --</option>
              ${opts.map(o => `<option value="${o}">${o}</option>`).join('')}
            </select>
          </div>`;
      } else if (f.type === 'textarea') {
        return `
          <div class="form-group">
            <label>${f.label}${reqMark}</label>
            <textarea id="custom-field-${f.id}" data-field-id="${f.id}" ${isRequired} rows="3" style="width:100%;resize:vertical;" placeholder="Enter ${f.label}..."></textarea>
          </div>`;
      } else {
        return `
          <div class="form-group">
            <label>${f.label}${reqMark}</label>
            <input type="${f.type}" id="custom-field-${f.id}" data-field-id="${f.id}" ${isRequired} placeholder="Enter ${f.label}..." style="width:100%;box-sizing:border-box;">
          </div>`;
      }
    }).join('');

    customFieldsContainer.innerHTML = `
      <div style="border-top:1px solid var(--border-glass);padding-top:var(--space-md);margin-top:var(--space-sm);margin-bottom:var(--space-md);">
        <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:var(--accent-purple);margin-bottom:var(--space-md);">📋 ${activeCustomBlueprint.name} Details</div>
        ${fieldRows}
      </div>`;
    customFieldsContainer.style.display = 'block';
    if (pipelineSection) pipelineSection.style.display = currentFmsBp && currentFmsBp.stagesNeeded ? 'block' : 'none';
  } else if (isCustomView) {
    // Custom FMS but no custom fields defined
    if (formRowClassSubject) formRowClassSubject.style.display = 'none';
    if (formRowChapter) formRowChapter.style.display = 'none';
    if (formRowMarks) formRowMarks.style.display = activeCustomBlueprint.marksNeeded ? 'flex' : 'none';
    if (customFieldsContainer) { customFieldsContainer.innerHTML = ''; customFieldsContainer.style.display = 'none'; }
    if (pipelineSection) pipelineSection.style.display = currentFmsBp && currentFmsBp.stagesNeeded ? 'block' : 'none';
  } else {
    // Standard FMS — show all standard rows
    if (formRowClassSubject) formRowClassSubject.style.display = isEnquiryView || isAdmissionView || isVideoView || isParentsView ? 'none' : 'flex';
    if (formRowChapter) formRowChapter.style.display = isEnquiryView || isAdmissionView || isVideoView || isParentsView ? 'none' : 'flex';
    if (formRowMarks) formRowMarks.style.display = isEnquiryView || isParentsView ? 'none' : 'flex';
    if (customFieldsContainer) { customFieldsContainer.innerHTML = ''; customFieldsContainer.style.display = 'none'; }
    if (pipelineSection) pipelineSection.style.display = 'block';
    if (nameLabel2) nameLabel2.textContent = isEnquiryView || isAdmissionView ? 'Student Name' : isVideoView ? 'Video Title' : 'Test Name (Auto-generated)';
    if (heldOnLabel) heldOnLabel.textContent = isAdmissionView ? 'Date Registered' : isEnquiryView ? 'Date Registered' : 'Held On';
  }

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
  'max-asc': 'Max Marks ↑',
  'name-asc': 'Name A–Z',
  'name-desc': 'Name Z–A'
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

  // Update button label dynamically based on active FMS view context
  const label = $('sort-dropdown-label');
  if (label) {
    let displayLabel = el.textContent;
    // Strip emoji prefixes
    displayLabel = displayLabel.replace(/[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, '').trim();
    if (value === 'held-desc') {
      if (state.currentView === 'admissions' || state.currentView === 'enquiries') displayLabel = 'Date Registered ↓';
      else if (state.currentView === 'videos') displayLabel = 'Date Created ↓';
      else displayLabel = 'Date Held ↓';
    } else if (value === 'held-asc') {
      if (state.currentView === 'admissions' || state.currentView === 'enquiries') displayLabel = 'Date Registered ↑';
      else if (state.currentView === 'videos') displayLabel = 'Date Created ↑';
      else displayLabel = 'Date Held ↑';
    } else if (value === 'name-asc') {
      if (state.currentView === 'admissions' || state.currentView === 'enquiries') displayLabel = 'Student Name A–Z';
      else if (state.currentView === 'videos') displayLabel = 'Video Title A–Z';
      else displayLabel = 'Name A–Z';
    } else if (value === 'name-desc') {
      if (state.currentView === 'admissions' || state.currentView === 'enquiries') displayLabel = 'Student Name Z–A';
      else if (state.currentView === 'videos') displayLabel = 'Video Title Z–A';
      else displayLabel = 'Name Z–A';
    }
    label.textContent = displayLabel;
  }

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
if ($('add-test-form')) $('add-test-form').onsubmit = handleAddTestSubmit;
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
    doneAt: '',
    link: s.link || '',
    hidden: s.hidden || false
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

  // Collect custom fields data
  const customData = {};
  document.querySelectorAll('#custom-fms-fields-container [data-field-id]').forEach(el => {
    customData[el.dataset.fieldId] = el.value;
  });

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving...';

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
      customData: JSON.stringify(customData),
      stages: currentFormStages
    }, 'POST');

    if (res.success) {
      showToast('Test Tracking Started!');
      closeAddTestModal();

      // 1. Construct the new test object locally
      const newTest = {
        testId: res.data?.testId || ('TEST' + Date.now()),
        testName: name,
        className,
        maxScore: maxScore || '',
        type,
        heldOn: heldOn || getTodayStr(),
        stages: currentFormStages.map(s => ({ ...s })),
        subject: subject || '',
        chapter: chapter || '',
        sheetLink: sheetLink || '',
        folderLink: folderLink || '',
        minScore: minScore || '',
        avgScore: avgScore || '',
        customData
      };

      // 2. Add to local state and render instantly
      if (!state.tests) state.tests = [];
      state.tests = [newTest, ...state.tests];
      renderTests(state.tests);

      // 3. Trigger silent background reload
      openTestTracker(state.currentView, true);
    } else {
      throw new Error(res.error || 'Failed to start tracking');
    }
  } catch (err) {
    showToast(err.message || 'Failed to start tracking', 'error');
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
  const clsVal = test.className || '10';
  let subVal = test.subject || '';

  const classOption = Array.from(document.querySelectorAll('.class-option')).find(o => o.dataset.value === clsVal);
  if (classOption) selectClassOption(classOption);

  const subjectOption = Array.from(document.querySelectorAll('.subject-option')).find(o => o.dataset.value === subVal);
  if (subjectOption) selectSubjectOption(subjectOption);
  else {
    const defaultSubOption = Array.from(document.querySelectorAll('.subject-option')).find(o => o.dataset.value === '');
    if (defaultSubOption) selectSubjectOption(defaultSubOption);
  }

  const classVal = $('test-form-class').value;
  subVal = $('test-form-subject').value;
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

  const blueprints = getCustomFmsBlueprints();
  const activeCustomBlueprint = blueprints.find(bp => bp.type === test.type);
  const isCustom = !!activeCustomBlueprint;

  const isVideo = (test.type || '').toLowerCase() === 'video';
  const isBeforeFee = (test.type || '').toLowerCase() === 'beforefee';
  const isAfterFee = (test.type || '').toLowerCase() === 'afterfee';
  const isParents = (test.type || '').toLowerCase() === 'parents';
  const isAdmission = isBeforeFee || isAfterFee;

  const typeFormGroup = $('test-type-form-group');
  if (typeFormGroup) typeFormGroup.style.display = (isVideo || isParents || isCustom) ? 'none' : 'block';

  const sheetSeg = $('type-segment-sheet');
  const appSeg = $('type-segment-app');
  const videoSeg = $('type-segment-video');
  const beforeFeeSeg = $('type-segment-beforefee');
  const afterFeeSeg = $('type-segment-afterfee');
  const parentsSeg = $('type-segment-parents');

  if (isAdmission) {
    if (sheetSeg) sheetSeg.style.display = 'none';
    if (appSeg) appSeg.style.display = 'none';
    if (videoSeg) videoSeg.style.display = 'none';
    if (beforeFeeSeg) beforeFeeSeg.style.display = 'block';
    if (afterFeeSeg) afterFeeSeg.style.display = 'block';
    if (parentsSeg) parentsSeg.style.display = 'none';
  } else if (!isVideo && !isParents && !isCustom) {
    if (sheetSeg) sheetSeg.style.display = 'block';
    if (appSeg) appSeg.style.display = 'block';
    if (videoSeg) videoSeg.style.display = 'none';
    if (beforeFeeSeg) beforeFeeSeg.style.display = 'none';
    if (afterFeeSeg) afterFeeSeg.style.display = 'none';
    if (parentsSeg) parentsSeg.style.display = 'none';
  }

  const nameLabel = document.querySelector('label[for="test-form-name"]');
  if (nameLabel) {
    if (isAdmission) nameLabel.textContent = 'Student Name';
    else if (isVideo) nameLabel.textContent = 'Video Title';
    else if (isParents) nameLabel.textContent = 'Checklist Title';
    else if (isCustom) nameLabel.textContent = activeCustomBlueprint.name + ' Entry Title';
    else nameLabel.textContent = 'Test Name';
  }

  $('add-test-modal').querySelector('h3').textContent = isAdmission ? 'Edit Admission Details' : (isVideo ? 'Edit Video Details' : (isParents ? 'Edit Parents Checklist' : (isCustom ? 'Edit ' + activeCustomBlueprint.name + ' Details' : 'Edit Test Details')));
  $('add-test-modal').querySelector('button[type="submit"]').textContent = 'Save Changes';

  // Inject custom fields for edit mode
  const customFieldsContainerEdit = $('custom-fms-fields-container');
  const formRowCSEdit = $('form-row-class-subject');
  const formRowChEdit = $('form-row-chapter');
  const formRowMkEdit = $('form-row-marks');
  const pipelineSectionEdit = $('pipeline-stages-section');
  const heldOnLabelEdit = $('test-form-held-on-label');

  if (isCustom && activeCustomBlueprint.fields && activeCustomBlueprint.fields.length > 0) {
    if (formRowCSEdit) formRowCSEdit.style.display = 'none';
    if (formRowChEdit) formRowChEdit.style.display = 'none';
    if (formRowMkEdit) formRowMkEdit.style.display = activeCustomBlueprint.marksNeeded ? 'flex' : 'none';
    if (heldOnLabelEdit) heldOnLabelEdit.textContent = 'Entry Date';

    const customDataEdit = test.customData || {};
    const fieldRows = activeCustomBlueprint.fields.map(f => {
      const isRequired = f.required ? 'required' : '';
      const reqMark = f.required ? ' <span style="color:var(--accent-red);">*</span>' : '';
      const val = (customDataEdit[f.id] || '').toString().replace(/"/g, '&quot;');
      if (f.type === 'select') {
        const opts = (f.options || '').split(',').map(o => o.trim()).filter(Boolean);
        return `
          <div class="form-group">
            <label>${f.label}${reqMark}</label>
            <select id="custom-field-${f.id}" data-field-id="${f.id}" ${isRequired} style="width:100%;">
              <option value="">-- Select --</option>
              ${opts.map(o => `<option value="${o}" ${customDataEdit[f.id] === o ? 'selected' : ''}>${o}</option>`).join('')}
            </select>
          </div>`;
      } else if (f.type === 'textarea') {
        return `
          <div class="form-group">
            <label>${f.label}${reqMark}</label>
            <textarea id="custom-field-${f.id}" data-field-id="${f.id}" ${isRequired} rows="3" style="width:100%;resize:vertical;">${val}</textarea>
          </div>`;
      } else {
        return `
          <div class="form-group">
            <label>${f.label}${reqMark}</label>
            <input type="${f.type}" id="custom-field-${f.id}" data-field-id="${f.id}" ${isRequired} value="${val}" style="width:100%;box-sizing:border-box;">
          </div>`;
      }
    }).join('');

    if (customFieldsContainerEdit) {
      customFieldsContainerEdit.innerHTML = `
        <div style="border-top:1px solid var(--border-glass);padding-top:var(--space-md);margin-top:var(--space-sm);margin-bottom:var(--space-md);">
          <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:var(--accent-purple);margin-bottom:var(--space-md);">📋 ${activeCustomBlueprint.name} Details</div>
          ${fieldRows}
        </div>`;
      customFieldsContainerEdit.style.display = 'block';
    }
    if (pipelineSectionEdit) pipelineSectionEdit.style.display = activeCustomBlueprint.stagesNeeded ? 'block' : 'none';
  } else if (isCustom) {
    if (formRowCSEdit) formRowCSEdit.style.display = 'none';
    if (formRowChEdit) formRowChEdit.style.display = 'none';
    if (formRowMkEdit) formRowMkEdit.style.display = activeCustomBlueprint.marksNeeded ? 'flex' : 'none';
    if (customFieldsContainerEdit) { customFieldsContainerEdit.innerHTML = ''; customFieldsContainerEdit.style.display = 'none'; }
    if (pipelineSectionEdit) pipelineSectionEdit.style.display = activeCustomBlueprint.stagesNeeded ? 'block' : 'none';
  } else {
    if (formRowCSEdit) formRowCSEdit.style.display = isAdmission || isVideo || isParents ? 'none' : 'flex';
    if (formRowChEdit) formRowChEdit.style.display = isAdmission || isVideo || isParents ? 'none' : 'flex';
    if (formRowMkEdit) formRowMkEdit.style.display = isParents ? 'none' : 'flex';
    if (customFieldsContainerEdit) { customFieldsContainerEdit.innerHTML = ''; customFieldsContainerEdit.style.display = 'none'; }
    if (pipelineSectionEdit) pipelineSectionEdit.style.display = 'block';
  }

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

    // Collect custom fields
    const editCustomData = {};
    document.querySelectorAll('#custom-fms-fields-container [data-field-id]').forEach(el => {
      editCustomData[el.dataset.fieldId] = el.value;
    });

    const isIndependent = activeCustomBlueprint && activeCustomBlueprint.scope === 'independent';

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
      stages: currentFormStages,
      customData: editCustomData
    };

    try {
      const res = await apiFetch('editTestDetails', { ...payload, customData: JSON.stringify(editCustomData) }, 'POST');
      if (res.success) {
        showToast('Test details updated.');
        closeAddTestModal();

        // 1. Update in local state instantly
        const stateIdx = state.tests.findIndex(t => t.testId === payload.testId);
        if (stateIdx > -1) {
          state.tests[stateIdx] = {
            ...state.tests[stateIdx],
            ...payload
          };
        }

        // 2. Render instantly
        renderTests(state.tests);

        // 3. Silently refresh background cache
        openTestTracker(state.currentView, true);
      } else {
        throw new Error(res.error || 'Update failed');
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
  const defaultHeader = state.currentView === 'videos' ? 'Track New Video' : (state.currentView === 'enquiries' ? 'Track New Enquiry' : (state.currentView === 'admissions' ? 'Track New Admission' : (state.currentView === 'parents' ? 'Track Parents Checklist' : 'Track New Test')));
  const defaultBtn = state.currentView === 'videos' ? 'Start Tracking Video' : (state.currentView === 'enquiries' ? 'Start Tracking Enquiry' : (state.currentView === 'admissions' ? 'Start Tracking Admission' : (state.currentView === 'parents' ? 'Start Tracking Checklist' : 'Start Tracking')));
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
    const blueprintsList = getCustomFmsBlueprints();
    const isCustomView = blueprintsList.some(bp => bp.type.toLowerCase() === state.currentView.toLowerCase());
    const fmsViews = ['tests', 'videos', 'enquiries', 'admissions', 'parents'];
    const isFmsView = fmsViews.includes(state.currentView) || isCustomView;

    if (isFmsView) {
      const container = $("test-list-content");
      if (container && !container.querySelector('.premium-loader') && !container.querySelector('.loading-spinner')) {
        try {
          const [settingsRes, testsRes] = await Promise.all([
            apiFetch('getTestSettings'),
            apiFetch('getTests')
          ]);

          const oldSettingsStr = JSON.stringify(state.testSettings);
          const oldTestsStr = JSON.stringify(state.tests);
          const settingsChanged = settingsRes.success && oldSettingsStr !== JSON.stringify(settingsRes.data);
          const testsChanged = testsRes.success && oldTestsStr !== JSON.stringify(testsRes.data);

          if (settingsChanged || testsChanged) {
            if (settingsRes.success) state.testSettings = settingsRes.data;
            if (testsRes.success) state.tests = testsRes.data;
            sanitizeTestSettings();
            renderTests(state.tests);
          }
        } catch (e) {
          console.error('FMS background sync error:', e);
        }
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
      const id = btn.dataset.id;
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
      const id = btn.dataset.id;
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

async function toggleCustomFmsCardStatus(testId) {
  const test = (state.tests || []).find(t => t.testId === testId);
  if (!test) return;
  const newStatus = test.status === 'done' ? 'pending' : 'done';

  test.status = newStatus;

  // Update locally and render instantly (optimistic UI)
  renderTests(state.tests);

  try {
    const res = await apiFetch('editTestDetails', {
      testId: test.testId,
      testName: test.testName,
      className: test.className,
      maxScore: test.maxScore,
      type: test.type,
      heldOn: test.heldOn,
      stages: test.stages || [],
      subject: test.subject,
      chapter: test.chapter,
      sheetLink: test.sheetLink,
      folderLink: test.folderLink,
      minScore: test.minScore,
      avgScore: test.avgScore
    });

    if (res.success) {
      showToast('FMS card status updated!', 'success');
    } else {
      // Revert status on failure
      test.status = newStatus === 'done' ? 'pending' : 'done';
      renderTests(state.tests);
      showToast('Failed to update status: ' + (res.error || 'Unknown error'), 'error');
    }
  } catch (err) {
    // Revert status on error
    test.status = newStatus === 'done' ? 'pending' : 'done';
    renderTests(state.tests);
    showToast('Failed to update status', 'error');
  }
}
window.toggleCustomFmsCardStatus = toggleCustomFmsCardStatus;

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  try {
    init();
    startBackgroundSync();

    // Horizontal scrolling support for PC/desktop
    const nav = document.getElementById('header-nav');
    if (nav) {
      // 1. Wheel translation: Translate vertical wheel scrolling into horizontal scrolling
      nav.addEventListener('wheel', (e) => {
        if (e.deltaY !== 0) {
          nav.scrollLeft += e.deltaY * 0.8;
          e.preventDefault();
        }
      }, { passive: false });

      // 2. Click-and-drag scrolling support
      let isDown = false;
      let startX;
      let scrollLeft;
      let hasMoved = false;

      nav.addEventListener('mousedown', (e) => {
        isDown = true;
        startX = e.pageX - nav.offsetLeft;
        scrollLeft = nav.scrollLeft;
        hasMoved = false;
      });

      nav.addEventListener('mouseleave', () => {
        isDown = false;
      });

      nav.addEventListener('mouseup', () => {
        isDown = false;
      });

      nav.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        const x = e.pageX - nav.offsetLeft;
        const walk = (x - startX) * 1.5; // Scroll speed multiplier
        if (Math.abs(walk) > 3) {
          hasMoved = true;
        }
        nav.scrollLeft = scrollLeft - walk;
      });

      // Prevent triggering click on tabs when dragging
      nav.addEventListener('click', (e) => {
        if (hasMoved) {
          e.preventDefault();
          e.stopPropagation();
        }
      }, true);
    }
  } catch (err) {
    console.error('Initialization failed:', err);
    const loader = document.getElementById('loading-screen');
    if (loader) loader.classList.add('hidden');
  }
});

// =============================================
// STUDENT WEBHOOK MANAGEMENT
// =============================================

function renderStudentWebhookHistory() {
  const historyList = document.getElementById('student-webhook-history');
  if (!historyList) return;

  let history = [];
  try {
    history = JSON.parse(localStorage.getItem('svm_student_webhook_history') || '[]');
  } catch (e) {
    history = [];
  }

  if (history.length === 0) {
    historyList.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 15px; border: 1px dashed var(--border-glass); border-radius: var(--radius-md);">No triggers recorded yet. Click a button to send list.</div>`;
    return;
  }

  historyList.innerHTML = history.map(item => {
    const isSuccess = item.success;
    const badgeBg = isSuccess ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)';
    const badgeColor = isSuccess ? 'var(--accent-emerald)' : 'var(--accent-red)';
    const badgeBorder = isSuccess ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)';
    const statusText = isSuccess ? 'Success' : 'Failed';
    const typeLabel = item.type === 'submitted' ? 'Submitted' : 'Unsubmitted';
    const typeBg = item.type === 'submitted' ? 'rgba(124, 58, 237, 0.15)' : 'rgba(245, 158, 11, 0.15)';
    const typeColor = item.type === 'submitted' ? 'var(--accent-purple)' : 'var(--accent-amber)';
    const typeBorder = item.type === 'submitted' ? 'rgba(124, 58, 237, 0.3)' : 'rgba(245, 158, 11, 0.3)';

    return `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-glass); border-radius: var(--radius-md); gap: 10px;">
        <div>
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <span style="font-size: 0.72rem; padding: 2px 7px; background: ${typeBg}; color: ${typeColor}; border: 1px solid ${typeBorder}; border-radius: 99px; font-weight: 700; text-transform: uppercase;">${typeLabel}</span>
            <span style="font-size: 0.78rem; font-weight: 600; color: var(--text-primary);">Sent by ${item.user}</span>
          </div>
          <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px;">
            ${new Date(item.timestamp).toLocaleString()}
          </div>
        </div>
        <div style="font-size: 0.7rem; padding: 3px 8px; background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder}; border-radius: 99px; font-weight: 700;">
          ${statusText}
        </div>
      </div>
    `;
  }).join('');
}

async function triggerStudentWebhook(status) {
  const btnId = status === 'submitted' ? 'btn-send-submitted' : 'btn-send-unsubmitted';
  const btn = document.getElementById(btnId);
  if (!btn) return;

  const originalContent = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<div class="loading-spinner" style="width:16px;height:16px;border-width:2px;margin:0 auto;"></div>`;

  const webhookUrl = `https://n8n.saraswatividyamandir.com/webhook/list-student`;
  let isSuccess = false;
  let errorMsg = '';

  try {
    const payload = {
      status: status,
      type: status,
      sender: state.currentUser || 'admin',
      timestamp: new Date().toISOString()
    };

    // Send query parameter just in case
    const fullUrl = `${webhookUrl}?status=${status}&type=${status}`;

    const response = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      isSuccess = true;
      showToast(`Student list (${status}) sent successfully!`);
    } else {
      errorMsg = `Server returned ${response.status} ${response.statusText}`;
      showToast(`Webhook failed: ${errorMsg}`, 'error');
    }
  } catch (err) {
    errorMsg = err.message || 'Network error';
    showToast(`Webhook error: ${errorMsg}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalContent;

    // Log to history
    let history = [];
    try {
      history = JSON.parse(localStorage.getItem('svm_student_webhook_history') || '[]');
    } catch (e) {
      history = [];
    }

    history.unshift({
      id: 'webhook_' + Date.now(),
      type: status,
      user: state.currentUser || 'admin',
      timestamp: new Date().toISOString(),
      success: isSuccess,
      error: errorMsg
    });

    if (history.length > 50) history = history.slice(0, 50);

    localStorage.setItem('svm_student_webhook_history', JSON.stringify(history));
    renderStudentWebhookHistory();
  }
}

window.renderStudentWebhookHistory = renderStudentWebhookHistory;
window.triggerStudentWebhook = triggerStudentWebhook;

// =============================================
// TASK CALENDAR VIEW FUNCTIONALITY
// =============================================

function renderCalendarView(tasks) {
  const container = document.getElementById('task-calendar-container');
  if (!container) return;

  const year = state.calendarYear;
  const month = state.calendarMonth;

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const firstDayIndex = new Date(year, month, 1).getDay();
  const firstDay = firstDayIndex === 0 ? 6 : firstDayIndex - 1; // Mon=0, Sun=6

  const totalDays = new Date(year, month + 1, 0).getDate();
  const prevMonthTotalDays = new Date(year, month, 0).getDate();

  let html = `
    <div class="calendar-container">
      <div class="calendar-header">
        <div class="calendar-title">
          🗓 ${monthNames[month]} ${year}
        </div>
        <div class="calendar-nav">
          <button class="calendar-nav-btn" onclick="changeCalendarMonth(-1)">◀</button>
          <button class="calendar-nav-btn" onclick="changeCalendarMonth(1)">▶</button>
        </div>
      </div>
      <div class="calendar-grid">
        <div class="calendar-day-label">Mon</div>
        <div class="calendar-day-label">Tue</div>
        <div class="calendar-day-label">Wed</div>
        <div class="calendar-day-label">Thu</div>
        <div class="calendar-day-label">Fri</div>
        <div class="calendar-day-label">Sat</div>
        <div class="calendar-day-label">Sun</div>
  `;

  const formatYYYYMMDD = (y, m, d) => {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };

  const todayStr = getTodayStr();
  let cellCount = 0;
  
  // Render previous month's blank/overflow days
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = prevMonthTotalDays - i;
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    const cellDateStr = formatYYYYMMDD(prevYear, prevMonth, d);
    
    html += renderCalendarCell(d, cellDateStr, true, todayStr, tasks);
    cellCount++;
  }

  // Render current month days
  for (let d = 1; d <= totalDays; d++) {
    const cellDateStr = formatYYYYMMDD(year, month, d);
    
    html += renderCalendarCell(d, cellDateStr, false, todayStr, tasks);
    cellCount++;
  }

  // Render next month's blank/overflow days
  let nextMonthDay = 1;
  while (cellCount % 7 !== 0) {
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    const cellDateStr = formatYYYYMMDD(nextYear, nextMonth, nextMonthDay);

    html += renderCalendarCell(nextMonthDay, cellDateStr, true, todayStr, tasks);
    nextMonthDay++;
    cellCount++;
  }

  html += `
      </div>
    </div>
  `;

  container.innerHTML = html;

  // Bind click handlers to task items
  container.querySelectorAll('.calendar-task-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const taskId = item.dataset.taskId;
      openCommentsModal(taskId);
    });
  });
}

function renderCalendarCell(dayNum, cellDateStr, isOtherMonth, todayStr, tasks) {
  const isToday = cellDateStr === todayStr;
  
  const cellDate = new Date(cellDateStr + 'T00:00:00');
  const isSunday = cellDate.getDay() === 0;

  const dayTasks = [];
  tasks.forEach(t => {
    if (t.taskType === 'daily') {
      if (!isSunday) {
        let status = t.status;
        if (cellDateStr !== todayStr) {
          status = cellDateStr < todayStr ? 'done' : 'pending';
        }
        dayTasks.push({ ...t, status });
      }
    } else {
      if (t.plannedDate && t.plannedDate.substring(0, 10) === cellDateStr) {
        dayTasks.push(t);
      }
    }
  });

  let taskItemsHtml = '';
  if (dayTasks.length > 0) {
    taskItemsHtml = `<div class="calendar-task-list">`;
    dayTasks.forEach(t => {
      let statusClass = `status-${t.status}`;
      // Check overdue
      if (t.status !== 'done') {
        const now = new Date();
        const planned = new Date(t.plannedDate);
        if (t.time) {
          const [h, m] = t.time.split(':');
          planned.setHours(parseInt(h), parseInt(m), 0, 0);
        } else planned.setHours(23, 59, 59, 999);
        const graceMs = (t.taskType === 'daily') ? 0 : (24 * 60 * 60 * 1000);
        if (now.getTime() > (planned.getTime() + graceMs)) {
          statusClass = 'status-overdue';
        }
      }
      taskItemsHtml += `
        <div class="calendar-task-item ${statusClass}" data-task-id="${t.taskId}" title="${t.taskName} (${t.status})">
          ${t.taskName}
        </div>
      `;
    });
    taskItemsHtml += `</div>`;
  }

  return `
    <div class="calendar-cell ${isOtherMonth ? 'other-month' : ''} ${isToday ? 'today' : ''}">
      <span class="calendar-day-num">${dayNum}</span>
      ${taskItemsHtml}
    </div>
  `;
}

window.changeCalendarMonth = function(offset) {
  state.calendarMonth += offset;
  if (state.calendarMonth < 0) {
    state.calendarMonth = 11;
    state.calendarYear -= 1;
  } else if (state.calendarMonth > 11) {
    state.calendarMonth = 0;
    state.calendarYear += 1;
  }
  renderTasks(state.tasks);
};
