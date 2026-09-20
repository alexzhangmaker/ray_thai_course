# Checklist for Building Node.js Backend & Console App

## Phase 1: Backend Service (Completed)
- [x] Create `package.json` with dependencies and ES module type
- [x] Create `db.js` with SQLite connection, schema definition, helper functions, and default seed data
- [x] Create `server.js` with Express server and CRUD APIs for `/api/vocabulary`
- [x] Install dependencies (`npm install`)
- [x] Verify server startup and run SQLite query verification
- [x] Verify CRUD API endpoints via curl or post requests
- [x] Document final walkthrough

## Phase 2: Console App (Completed)
- [x] Add static file serving to `BEServices/server.js`
- [x] Develop `Pages/consoleCourseReview.html` using Tailwind CSS with Outfit/Sarabun styling
- [x] Verify server static file serving and dashboard CRUD actions
- [x] Document final walkthrough

## Phase 3: JSON Import & Upsert (Completed)
- [x] Modify `Pages/consoleCourseReview.html` to add "Import JSON" button, modal, and upsert logic
- [x] Verify validation errors and successful upsert operations
- [x] Update final walkthrough.md

## Phase 4: Student App Integration (Completed)
- [x] Modify `Pages/index.html` to fetch vocabularyData from backend API
- [x] Verify index page loads successfully on the server
- [x] Update final walkthrough.md

## Phase 5: Prompt Markdown Management (Completed)
- [x] Add prompt read/write API endpoints to `BEServices/server.js`
- [x] Modify `Pages/consoleCourseReview.html` link to index.html and add Prompt button & modal editor
- [x] Verify loading, editing, saving, and copying of Prompt markdown
- [x] Update final walkthrough.md

## Phase 6: Remote Deployment & Migration (Completed)
- [x] Modify default port to 3002 in `BEServices/server.js`
- [x] Create compressed archive `/tmp/vCourse.ThaiNotes.tar.gz`
- [x] Transfer archive to remote server `192.168.1.120` using `scp`
- [x] Connect to remote server via `ssh` and verify Node.js/npm env
- [x] Extract project archive and run `npm install` on remote server
- [x] Launch service in background on remote server and verify port 3002
- [x] Update final walkthrough.md

## Phase 7: Thai Vocabulary Dictation (听写) & SM-2 Spaced Repetition App (Completed)
- [x] Design and implement SQLite database schema: `dictation_collections`, `dictation_words`, `dictation_collection_words`, `dictation_review_logs` with initial realistic seed data
- [x] Implement core SM-2 algorithm utility (`BEServices/dictationSM2.js`) supporting 0-5 grading scale and next review scheduling
- [x] Implement secure RESTful API endpoints in `BEServices/server.js` (`X-API-Key` & `Bearer` token authentication):
  - Collections CRUD: `GET/POST /api/collections`, `GET/PUT/DELETE /api/collections/:id`
  - Words CRUD: `POST /api/collections/:id/words`, `GET/POST /api/words`, `GET/PUT/DELETE /api/words/:id`
  - Dictation flow & SM-2: `POST /api/dictation/review`, `GET /api/dictation/queue`, `GET /api/dictation/stats`, `POST /api/dictation/batch-import`
- [x] Build interactive Dictation Player (`Pages/appDictation.html`):
  - Audio playback with Web Speech API `th-TH` TTS, speed controls (0.8x/1.0x), auto-play, and custom audioUrl support
  - Minimalist "Paper Writing in Progress" view concealing spelling to prevent cheating
  - Reveal Answer with high-contrast Thai typography, phonetics, definition, and all associated example sentences
  - Touch-friendly supervisor grading buttons (`❌ 忘记 (0)`, `⚠️ 勉强 (3)`, `✅ 正确 (4)`, `⭐ 熟练 (5)`) with keyboard shortcuts
  - End-of-session summary with accuracy stats, review breakdown, and missed words retrying
- [x] Build Vocabulary & Collection Management Console (`Pages/consoleDictation.html`):
  - Collection CRUD management
  - Word CRUD table with dynamic multi-sentence example editor (`examples` JSON array)
  - Batch import & export utilities
  - Interactive REST API explorer and live tester
- [x] Register new apps into system navigation portal (`Pages/appPortal.html`)
- [x] Verify complete end-to-end integration and API test suite

## Phase 8: Thai Sentence Translation (造句/翻译) & SM-2 Spaced Repetition App (Completed)
- [x] Design and implement SQLite database schema: `sentence_groups`, `sentence_items`, and `sentence_review_logs` in `BEServices/db.js` with realistic seed data
- [x] Implement core SM-2 algorithm utility (`BEServices/sentenceSM2.js`) supporting 0-5 grading scale and next review scheduling
- [x] Implement backend RESTful API endpoints in `BEServices/server.js`:
  - Groups CRUD: `GET/POST /api/sentence-groups`, `GET/PUT/DELETE /api/sentence-groups/:id`
  - Sentences CRUD: `GET/POST /api/sentences`, `GET/PUT/DELETE /api/sentences/:id`, `POST /api/sentences/:id/reset-sm2`
  - Spaced Repetition & Flow: `GET /api/sentence-practice/group/:groupId`, `GET /api/sentence-practice/review`, `POST /api/sentence-practice/score`, `GET /api/sentence-practice/stats`
  - Batch Import: `POST /api/sentences/batch-import`
- [x] Build Student Practice Web App (`Pages/appSentence.html`):
  - Chinese sentence prompt with required Thai word constraint (`thai_word`)
  - Minimalist "Paper Writing in Progress" view with interactive writing stopwatch
  - Reveal Answer with high-contrast Thai typography, target word highlighting, vocabulary notes (`other_vocab_notes`) badges, and linguistic notes (`notes`)
  - Touch-friendly & keyboard-enabled tutor grading buttons (0-5 score scale)
  - Spaced Repetition (SM-2) review mode & Group practice mode
  - URL parameter launch support (`?group_id=<groupId>` and `?mode=review`)
  - End-of-session summary with review breakdown and missed sentences retry
- [x] Build Management Console (`Pages/consoleSentence.html`):
  - Word groups CRUD with sentence counts, due counts, and mastered counts
  - Sentences CRUD data table with filtering, search, and dynamic vocab note builder
  - Batch JSON import with validation and sample format generator
  - SM-2 logs & scheduling tracking
  - One-click practice launcher & direct URL copy
- [x] Register new apps into system navigation portal (`Pages/appPortal.html`)
- [x] Verify complete end-to-end integration and API test suite

