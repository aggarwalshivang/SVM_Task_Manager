# SVM Task Tracker

A mobile-first daily task management system for the Saraswati Vidya Mandir team — backed by Google Sheets, powered by Google Apps Script, and enhanced with AI-generated daily briefings via OpenRouter GPT-3.5 Turbo.

---

## Approach & Design Decisions (Writeup)

**SVM Task Tracker** is built as a zero-infrastructure system — Google Sheets serves as the database, Google Apps Script as the serverless API, and a static HTML/CSS/JS frontend for the mobile-first interface. Team members open a single link on their phone, pick their name, and immediately see only their tasks for today — split into recurring (daily/weekly) and one-time categories. Marking a task done is a single tap with an optimistic UI update; the sheet syncs in the background. AI adds genuine value in three places: a personalized daily briefing that summarizes workload and flags overdue items, auto-detection of at-risk tasks based on historical late/missed patterns, and plain-English weekly performance summaries written to the scores sheet. The scoring system rewards consistency (on-time = +10, late = +5/+2, missed = -10) with streak bonuses, making accountability feel like a game rather than surveillance.

---

## Architecture

```
Frontend (Static HTML/CSS/JS)
      │
      ├── GET  ?action=getTasks&user=X     → Today's tasks
      ├── GET  ?action=getBriefing&user=X   → AI briefing
      ├── GET  ?action=getScores&user=X     → Weekly stats
      ├── POST {action:"completeTask",...}   → Mark done
      │
  Google Apps Script (Serverless API)
      │
      ├── Code.gs     → Request routing, CRUD
      ├── Scoring.gs  → Performance scoring engine
      ├── AI.gs       → OpenRouter GPT-3.5 Turbo
      │
  Google Sheets (Database)
      ├── Tasks        → All task records
      ├── Team         → Team members
      └── WeeklyScores → Aggregated scores + AI summaries
```

---

## Setup Instructions

### Step 1: Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new spreadsheet
2. Rename it to **"SVM Task Tracker"**
3. Create **3 tabs** (sheets) named exactly:
   - `Tasks`
   - `Team`
   - `WeeklyScores`
4. Copy the **Sheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit
   ```

### Step 2: Set Up Apps Script

1. In the spreadsheet, go to **Extensions → Apps Script**
2. Delete any default code in `Code.gs`
3. Paste the contents of `apps-script/Code.gs`
4. Create a new file (+ button) → `Scoring.gs` → Paste `apps-script/Scoring.gs`
5. Create a new file (+ button) → `AI.gs` → Paste `apps-script/AI.gs`
6. In `Code.gs`, replace `YOUR_GOOGLE_SHEET_ID_HERE` with your Sheet ID
7. Click **Run** → Select `setupSheetHeaders` → Run it (authorize when prompted)
8. Then run `seedSampleTasks` to populate sample data

### Step 3: Configure OpenRouter API Key

1. Get a free API key from [openrouter.ai](https://openrouter.ai/)
2. In Apps Script, go to **Project Settings** (gear icon on the left)
3. Scroll to **Script Properties** → **Add Script Property**:
   - Property: `OPENROUTER_API_KEY`
   - Value: `your_api_key_here`

### Step 4: Deploy the Web App

1. In Apps Script, click **Deploy → New deployment**
2. Click the gear icon → Select **Web app**
3. Settings:
   - Description: `SVM Task Tracker API`
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Click **Deploy** → Copy the **Web app URL**

### Step 5: Connect the Frontend

1. Open `app.js`
2. Replace `YOUR_DEPLOYMENT_ID` in `CONFIG.API_URL` with the deployed URL
3. Set `CONFIG.DEMO_MODE` to `false`

### Step 6: Host the Frontend

**Option A — GitHub Pages (Recommended):**
1. Push the repo to GitHub
2. Go to Settings → Pages → Source: `main` branch, root `/`
3. Your app will be live at `https://yourusername.github.io/svm-task-tracker/`

**Option B — Local testing:**
```bash
# Any static server works
npx serve .
```

### Step 7: Set Up Triggers (Optional but Recommended)

In Apps Script, go to **Triggers** (clock icon on the left):

1. **Daily task generator**: `generateDailyTasks` → Time-driven → Day timer → 6:00 AM
2. **Overdue marker**: `markOverdueTasks` → Time-driven → Day timer → 11:55 PM
3. **Weekly scores**: `recalculateWeeklyScores` → Time-driven → Week timer → Sunday 11:55 PM

---

## Scoring System

| Action | Points |
|--------|--------|
| ✅ Completed on time | +10 |
| ⏰ Late (same day) | +5 |
| ⏰ Late (1 day) | +2 |
| ⏰ Late (2+ days) | +1 |
| ❌ Missed task | -10 |
| 🔥 Streak bonus (per day) | +3 |
| ⭐ Perfect day bonus | +5 |

---

## AI Features

1. **Daily Briefing**: Personalized 2-3 sentence summary of today's workload with overdue alerts
2. **Risk Flagging**: Auto-detects tasks that a user frequently misses or completes late
3. **Weekly Summary**: Plain-English recap of each person's performance written to the WeeklyScores sheet

All AI calls go through **OpenRouter GPT-3.5 Turbo** from the Apps Script backend (API key is never exposed to the frontend). If the API is unavailable, the system gracefully falls back to locally-generated messages.

---

## Demo Mode

The app ships with `DEMO_MODE: true` in `app.js` so you can preview the UI immediately without any backend setup. It uses realistic mock data (6 team members, school-related tasks). Set to `false` after completing the setup above.

---

## File Structure

```
svm-task-tracker/
├── index.html              # Main SPA
├── styles.css              # Design system (dark glassmorphism)
├── app.js                  # Application logic + API layer
├── README.md               # This file
└── apps-script/
    ├── Code.gs             # Main API handlers
    ├── Scoring.gs          # Scoring engine + setup
    └── AI.gs               # OpenRouter GPT-3.5 integration
```
