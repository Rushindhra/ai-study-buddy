# AI Study Buddy

A privacy-conscious study assistant that runs **on your own computer**. Paste or upload your notes, ask questions, get a structured summary, and generate a 5-question practice quiz. The AI is an open-weight model served locally by [Ollama](https://ollama.com). There are no hosted AI APIs, no accounts, and no tracking.

## Problem

Students collect long notes but have little time to turn them into revision material. Cloud AI tools help, but they require sending your notes to a third party and need a constant internet connection.

## Solution

AI Study Buddy keeps everything local: React frontend -> Express backend -> Ollama -> a model on your machine. After the one-time setup, it can run without internet.

## Features

- Notes workspace: paste text or upload a `.txt` file; file name and character count; clear-all button; 12,000-character limit.
- Ask questions about your notes. The model is told to rely on the notes and to say so when something is not covered.
- Summarize notes (main idea, concepts, definitions, relationships, revision points).
- Generate a 5-question multiple-choice quiz with an answer key (plain text).
- Model selector for `qwen3:4b`, `qwen2.5-coder:1.5b`, `gemma4:e2b`, with installed/not-installed detection.
- Live status badge for the local AI service, with clear error messages.
- Copy response, loading indicator with Cancel, duplicate-submission protection, responsive layout, keyboard-accessible controls.

**Not supported yet:** PDF, DOCX, and image input (text files only).

## Technology stack

| Layer    | Tech                                          |
| -------- | --------------------------------------------- |
| Frontend | React 18, Vite 6, plain CSS (system fonts)    |
| Backend  | Node.js, Express 4 (native `fetch`)           |
| AI       | Ollama HTTP API (`/api/chat`, `/api/tags`)    |

## Architecture overview

```
Browser (React) --/api--> Vite dev proxy --> Express (127.0.0.1:3001) --> Ollama (127.0.0.1:11434) --> local model
```

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Prerequisites

1. **Windows 10/11**, VS Code (optional but recommended).
2. **Node.js LTS** (18 or newer; 20+ recommended): <https://nodejs.org>.
3. **Ollama** installed and running: <https://ollama.com>.
4. The models already pulled. Check with `ollama list`. You need at least one of:
   `qwen3:4b`, `qwen2.5-coder:1.5b`, `gemma4:e2b`.
5. Git (optional, for version control).

Internet is needed **once**, to install Node/Ollama/models and to run `npm install`. This app never downloads models for you.

### Check prerequisites (PowerShell or Command Prompt)

```
node -v
npm -v
git --version
ollama list
```

## Quick start (Windows)

**Option A: double-click scripts**

1. Unzip the project, e.g. to `C:\Projects\ai-study-buddy`.
2. Double-click `setup.bat` (one time, needs internet).
3. Make sure Ollama is running (its tray icon is visible, or run `ollama list` successfully).
4. Double-click `start.bat`. Two server windows open and your browser opens `http://localhost:5173`.

**Option B: manual commands (use two separate terminals)**

Terminal 1 (backend):

```
cd C:\Projects\ai-study-buddy\server
npm install
npm start
```

Terminal 2 (frontend):

```
cd C:\Projects\ai-study-buddy\client
npm install
npm run dev
```

Open <http://localhost:5173>.

Do **not** run `ollama serve` if Ollama is already running as the Windows app. It would fail with "address already in use".

To stop: press `Ctrl+C` in each terminal (or close the two windows).

## Test the API without the browser (PowerShell)

```powershell
# Health check
Invoke-RestMethod http://127.0.0.1:3001/api/health

# Ask a question
$body = @{ action="ask"; notes="Normalization reduces database redundancy."; question="What does normalization do?"; model="qwen3:4b" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3001/api/study -ContentType "application/json" -Body $body
```

## Build and checks

```
cd client
npm run build

cd ..\server
npm run check
npm test
```

`npm test` runs automated backend tests against a **mock** Ollama (no model required).

## Offline operation

1. While online, run `setup.bat` (or both `npm install` commands) and confirm `ollama list` shows your models.
2. Start the app and confirm the badge says **Local AI available**.
3. Disconnect Wi-Fi / unplug Ethernet.
4. Open `http://localhost:5173` (use `localhost`, not a public URL).
5. Load the sample notes, ask a question, then generate a summary and a quiz.
6. Optional: open browser DevTools -> Network and confirm every request goes to `localhost`.

The source code contains no CDN scripts, web fonts, analytics, or cloud AI calls. **Offline operation has not been verified on your machine yet. Please run the steps above and record the result in [docs/TESTING.md](docs/TESTING.md).**

## Example prompts

- "Explain 2NF in simple words."
- "What is the difference between 3NF and BCNF?"
- "Give me a real-life example of a partial dependency."
- Click **Summarize notes**, then **Generate 5-question quiz**.
- Try asking something that is **not** in the notes. The answer should say it is not covered.

A ready-made notes file is in `sample-data/dbms-notes.txt`.

## Model guidance

| Model                | Suggested use                                      |
| -------------------- | -------------------------------------------------- |
| `qwen3:4b`           | General tutoring (default). Slower, usually better answers |
| `qwen2.5-coder:1.5b` | Fast, small; good for programming notes            |
| `gemma4:e2b`         | Alternative; compare its answers with the others   |

Speed and quality depend on your hardware and are **not benchmarked here**. Try each model with your own notes. Small models can ignore the quiz format or make mistakes, so always check important facts.

If `ollama list` shows different tag names than the three above, edit `ALLOWED_MODELS` in `server/server.js` and `MODELS` in `client/src/App.jsx`.

## Troubleshooting

| Problem | Fix |
| ------- | --- |
| Badge says "Local AI unavailable" | Start the Ollama app. Check `http://127.0.0.1:11434` opens in a browser ("Ollama is running"). |
| "Cannot reach the backend" | The backend window is not running. Start it with `npm start` in `server`. |
| `Port 3001/5173 already in use` | Close the old server window, or set another backend port: `set PORT=3002` (and update `client/vite.config.js` proxy target). |
| "Model ... is not installed" | Run `ollama list`; pick an installed model in the dropdown. This app never pulls models. |
| Very slow answers / timeout after 3 minutes | Use shorter notes or `qwen2.5-coder:1.5b`; close other heavy apps. |
| Out-of-memory error from Ollama | The app asks Ollama for an 8192-token context. Lower `num_ctx` in `server/server.js` (e.g. 4096). |
| `npm` not recognized | Reinstall Node.js and reopen the terminal. |
| PowerShell blocks `npm` scripts | Use Command Prompt, or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. |

## Privacy

- The browser talks only to the local backend; the backend talks only to local Ollama (`127.0.0.1`).
- Notes and questions are not stored on disk and are not written to logs (only method, path, status, timing).
- No analytics, telemetry, external fonts, or CDNs.
- Notes are treated as untrusted data in the prompt (the model is told not to follow instructions inside them). This reduces, but cannot fully remove, prompt-injection risk.
- Limits remain: browser extensions, other software on your PC, and OS-level logging/clipboard history can still see your text. The backend binds to `127.0.0.1` only.

## Known limitations

- Text files only; no PDF/DOCX/image extraction.
- 12,000-character notes limit; no chunking or retrieval for large documents.
- Responses are shown after completion (no streaming), so long answers need patience.
- Quiz is plain text, not interactive; format quality depends on the model.
- No history; refreshing the page clears the session.
- Tested with a mock Ollama only so far. See [docs/TESTING.md](docs/TESTING.md) for what is and is not verified.

## Future improvements (good first issues)

1. Streaming responses from Ollama for faster-feeling answers.
2. Interactive quiz mode with answer selection and scoring (parse the quiz text).
3. PDF text extraction (e.g. `pdfjs-dist`, locally bundled).
4. Save chat history locally (opt-in).
5. Split large notes into sections (simple retrieval) and cite which section an answer used.
6. Language selector / multilingual prompts.
7. Dark mode.
8. Export the response as `.txt` or `.md`.

## Contributing

```
git checkout -b feature/short-description
# make changes, then:
cd server && npm run check && npm test
cd ../client && npm run build
git add .
git commit -m "feat: short description"
git push origin feature/short-description
```

Then open a Pull Request on GitHub describing what changed and how you tested it. Keep PRs small. Do not add cloud AI APIs, telemetry, or external runtime assets.

**Hacktoberfest:** verify the organizers' current rules and any event-specific requirements before submitting. This project does not automatically qualify for any prize or recognition.

## License

Code is under the MIT license (see `LICENSE`). Please verify you have the right to license the whole project before publishing. Dependencies and the AI models (Qwen, Gemma, etc.) have their own separate licenses and terms.
