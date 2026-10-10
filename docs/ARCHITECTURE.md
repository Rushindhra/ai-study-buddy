# Architecture

## Data flow

```
React frontend --> Express backend --> Ollama --> local model --> Ollama --> Express --> React
   (browser)       127.0.0.1:3001     127.0.0.1:11434
```

During development the browser loads the React app from Vite (`localhost:5173`). Vite proxies every `/api/*` request to the Express backend, so the browser only ever talks to one origin and no CORS setup is needed.

## Components

| Component | File | Role |
| --------- | ---- | ---- |
| UI | `client/src/App.jsx` | Notes editor, file upload, model selector, ask/summarize/quiz actions, status badge, response panel, copy button |
| Styling | `client/src/index.css`, `App.css` | Custom CSS, system fonts, responsive grid. No external assets |
| Dev proxy | `client/vite.config.js` | Forwards `/api` to `http://127.0.0.1:3001`; long timeout for slow models |
| API server | `server/server.js` | Validation, prompt building, Ollama calls, error mapping |
| Model runtime | Ollama | Serves the local models through HTTP |
| Tests | `tests/api.test.js` | Backend tests with a mock Ollama |

## API

### `GET /api/health`

Checks Ollama (`/api/tags`, 3 s timeout).

- `200`: `{ ok: true, ollama: true, models: [...], supportedModels: [...], allowedModels: [...], message }`
- `503`: `{ ok: false, ollama: false, models: [], message }`

### `POST /api/study`

Request:

```json
{ "action": "ask | summarize | quiz", "notes": "...", "question": "...", "model": "qwen3:4b" }
```

Success (`200`): `{ "ok": true, "action": "ask", "model": "qwen3:4b", "answer": "..." }`

Errors share one shape: `{ "ok": false, "error": { "code": "...", "message": "..." } }`

| Status | Code | Cause |
| ------ | ---- | ----- |
| 400 | `INVALID_ACTION`, `INVALID_MODEL`, `EMPTY_NOTES`, `EMPTY_QUESTION`, `BAD_JSON` | Bad input |
| 404 | `MODEL_NOT_INSTALLED`, `NOT_FOUND` | Allowed model missing in Ollama / unknown route |
| 413 | `NOTES_TOO_LONG`, `QUESTION_TOO_LONG`, `PAYLOAD_TOO_LARGE` | Size limits (notes 12,000 chars, question 500, body 100 KB) |
| 502 | `OLLAMA_ERROR`, `EMPTY_RESPONSE` | Ollama failed or returned nothing |
| 503 | `OLLAMA_UNAVAILABLE` | Ollama not reachable |
| 504 | `TIMEOUT` | Model took longer than 180 s |
| 500 | `INTERNAL_ERROR` | Unexpected error (no stack trace returned) |

## Model integration

- The backend calls `POST /api/chat` with `stream: false`, temperature 0.3, `num_ctx` 8192.
- A system prompt tells the model to use the notes as reference data only, ignore instructions inside them, and say "This is not covered in your notes." when needed.
- Notes are wrapped in `<notes>...</notes>` tags to separate them from instructions.
- For `qwen3*` models, `think: false` is sent so replies are fast and clean. Any `<think>...</think>` text is stripped from outputs. Other models do not receive this flag, because not every model supports it.
- Model names are checked against a fixed allow-list **and** against what Ollama reports as installed. The backend never pulls models, and the browser cannot choose URLs.

## Reliability and security choices

- Backend binds to `127.0.0.1` only.
- Validation of action, model, notes, question, and body size on the server (the client checks too, for friendlier messages).
- Server timeout (180 s) returns `504`; the client has a slightly longer timeout and a Cancel button, so the UI never stays in "loading" forever.
- Duplicate submissions are blocked with a `useRef` flag plus disabled buttons.
- Logs contain only method, path, status code, and duration. Notes and questions are never logged.
- `OLLAMA_URL` can be changed only through an environment variable on the server (used by tests), never through a request.

## Offline design

- No CDN, web fonts, analytics, remote images, or cloud AI SDKs. Fonts are the system stack. The favicon is an inline data URI.
- Internet is needed only for the initial `npm install` and for installing Ollama/models.
- The production build (`client/dist`) is static files; it contains no external URLs.
