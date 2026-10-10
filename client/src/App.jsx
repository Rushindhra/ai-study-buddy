import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_NOTES_CHARS = 12000; // keep in sync with server/server.js
const MAX_QUESTION_CHARS = 500;
const REQUEST_TIMEOUT_MS = 200000; // slightly above the server timeout so the server answers first

const MODELS = [
  { id: 'qwen3:4b', label: 'qwen3:4b', hint: 'Best for general tutoring' },
  { id: 'qwen2.5-coder:1.5b', label: 'qwen2.5-coder:1.5b', hint: 'Fast, good for code notes' },
  { id: 'gemma4:e2b', label: 'gemma4:e2b', hint: 'Alternative model' },
];

const EXAMPLE_QUESTIONS = [
  'Explain the main idea in simple words.',
  'What are the key definitions I should remember?',
  'Give me one real-life example of this topic.',
];

const SAMPLE_NOTES = `Normalization in DBMS

Normalization is the process of organizing a database to reduce redundancy and improve data integrity.

First Normal Form (1NF): every column holds atomic (indivisible) values and each row is unique.
Second Normal Form (2NF): the table is in 1NF and has no partial dependency, meaning no non-key attribute depends on only part of a composite primary key.
Third Normal Form (3NF): the table is in 2NF and has no transitive dependency, meaning non-key attributes depend only on the primary key.
BCNF: for every functional dependency X -> Y, X must be a super key.

Anomalies caused by poor design: insertion anomaly, update anomaly, and deletion anomaly.`;

const ACTION_LABELS = { ask: 'Answer', summarize: 'Summary', quiz: 'Quiz' };

function StatusBadge({ status, onRecheck }) {
  const text =
    status === 'checking'
      ? 'Checking local AI service…'
      : status === 'online'
      ? 'Local AI available'
      : 'Local AI unavailable';
  return (
    <div className="status" role="status" aria-live="polite">
      <span className={`dot dot-${status}`} aria-hidden="true" />
      <span>{text}</span>
      {status === 'offline' && (
        <button type="button" className="link-btn" onClick={onRecheck}>
          Retry
        </button>
      )}
    </div>
  );
}

export default function App() {
  const [health, setHealth] = useState({ status: 'checking', models: [], message: '' });
  const [model, setModel] = useState(MODELS[0].id);
  const [notes, setNotes] = useState('');
  const [fileName, setFileName] = useState('');
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState('');
  const [result, setResult] = useState(null); // { action, model, answer }
  const [error, setError] = useState('');
  const [notesMessage, setNotesMessage] = useState({ type: '', text: '' });
  const [copyMessage, setCopyMessage] = useState('');

  const inFlight = useRef(false); // blocks duplicate submissions even before React re-renders
  const abortRef = useRef(null);
  const fileInputRef = useRef(null);

  const checkHealth = useCallback(async () => {
    setHealth((h) => ({ ...h, status: 'checking' }));
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      if (data.ollama) {
        setHealth({ status: 'online', models: data.models || [], message: data.message });
        // If the default model is missing but another supported one is installed, switch to it.
        const supported = MODELS.map((m) => m.id).filter((id) => (data.models || []).includes(id));
        setModel((current) => (supported.length && !supported.includes(current) ? supported[0] : current));
      } else {
        setHealth({ status: 'offline', models: [], message: data.message });
      }
    } catch {
      setHealth({
        status: 'offline',
        models: [],
        message: 'Cannot reach the backend. Make sure the server is running (see README).',
      });
    }
  }, []);

  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  // Cancel any running request if the page is closed
  useEffect(() => () => abortRef.current?.abort(), []);

  const modelInstalled = health.models.includes(model);

  function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    const isTxt = file.name.toLowerCase().endsWith('.txt') && (file.type === 'text/plain' || file.type === '');
    if (!isTxt) {
      setNotesMessage({ type: 'error', text: 'Only plain-text (.txt) files are supported right now.' });
      return;
    }
    if (file.size > 200 * 1024) {
      setNotesMessage({ type: 'error', text: 'That file is too large. Please use a .txt file under 200 KB.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      if (!text.trim()) {
        setNotesMessage({ type: 'error', text: 'That file is empty.' });
        return;
      }
      if (text.length > MAX_NOTES_CHARS) {
        setNotesMessage({
          type: 'error',
          text: `That file has ${text.length.toLocaleString()} characters. The limit is ${MAX_NOTES_CHARS.toLocaleString()}. Please upload a shorter section.`,
        });
        return;
      }
      setNotes(text);
      setFileName(file.name);
      setNotesMessage({ type: 'success', text: `Loaded ${file.name}.` });
    };
    reader.onerror = () => setNotesMessage({ type: 'error', text: 'Could not read that file.' });
    reader.readAsText(file);
  }

  function clearAll() {
    abortRef.current?.abort();
    inFlight.current = false;
    setLoading(false);
    setLoadingAction('');
    setNotes('');
    setFileName('');
    setQuestion('');
    setResult(null);
    setError('');
    setCopyMessage('');
    setNotesMessage({ type: '', text: '' });
  }

  async function run(action) {
    if (inFlight.current) return; // duplicate-submit guard
    setError('');
    setCopyMessage('');

    if (!notes.trim()) {
      setError('Please paste or upload some study notes first.');
      return;
    }
    if (action === 'ask' && !question.trim()) {
      setError('Please type a question first.');
      return;
    }
    if (health.status === 'online' && !modelInstalled) {
      setError(`"${model}" is not installed. Run "ollama list" to check, or choose another model.`);
      return;
    }

    inFlight.current = true;
    setLoading(true);
    setLoadingAction(action);
    setResult(null);

    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(() => controller.abort('timeout'), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch('/api/study', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, notes, question, model }),
        signal: controller.signal,
      });
      let data = null;
      try {
        data = await res.json();
      } catch {
        /* non-JSON response */
      }
      if (!res.ok || !data?.ok) {
        setError(data?.error?.message || `Request failed (HTTP ${res.status}). Is the backend running?`);
      } else {
        setResult({ action: data.action, model: data.model, answer: data.answer });
      }
    } catch (err) {
      if (controller.signal.aborted && controller.signal.reason === 'timeout') {
        setError('The request took too long and was stopped. Try shorter notes or a smaller model.');
      } else if (controller.signal.aborted) {
        // cancelled by the user (Clear / Cancel): no message needed
      } else {
        setError('Cannot reach the backend. Make sure the server is running (see README).');
      }
    } finally {
      clearTimeout(timer);
      inFlight.current = false;
      setLoading(false);
      setLoadingAction('');
    }
  }

  function cancelRequest() {
    abortRef.current?.abort();
  }

  async function copyResponse() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.answer);
      setCopyMessage('Copied to clipboard.');
    } catch {
      // Fallback for browsers/contexts where the Clipboard API is blocked
      try {
        const ta = document.createElement('textarea');
        ta.value = result.answer;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        setCopyMessage(ok ? 'Copied to clipboard.' : 'Copy failed. Please select the text and press Ctrl+C.');
      } catch {
        setCopyMessage('Copy failed. Please select the text and press Ctrl+C.');
      }
    }
    setTimeout(() => setCopyMessage(''), 4000);
  }

  const busy = loading;

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 9l10-5 10 5-10 5L2 9z" />
              <path d="M6 11.5V16c0 1.700 2.700 3 6 3s6-1.300 6-3v-4.500" />
            </svg>
          </span>
          <span className="brand-name">AI Study Buddy</span>
        </div>
        <StatusBadge status={health.status} onRecheck={checkHealth} />
      </header>

      <main>
        <section className="hero">
          <h1>Learn smarter. Not harder.</h1>
          <p>
            Paste your notes, ask questions, get summaries and practice quizzes, all powered by an AI model running on
            your own computer.
          </p>
        </section>

        {health.status === 'offline' && (
          <div className="banner banner-error" role="alert">
            <strong>Local AI is unavailable.</strong> {health.message}
          </div>
        )}
        {health.status === 'online' && health.message.includes('Not installed') && (
          <div className="banner banner-info">{health.message}</div>
        )}

        <div className="workspace">
          {/* ---------- Left: notes ---------- */}
          <section className="card" aria-labelledby="notes-title">
            <div className="card-head">
              <h2 id="notes-title">Your notes</h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setNotes(SAMPLE_NOTES); setFileName('sample notes'); setNotesMessage({ type: 'success', text: 'Sample notes loaded.' }); }} disabled={busy}>
                Load sample
              </button>
            </div>

            <label htmlFor="notes" className="sr-only">Study notes</label>
            <textarea
              id="notes"
              value={notes}
              maxLength={MAX_NOTES_CHARS}
              onChange={(e) => { setNotes(e.target.value); setNotesMessage({ type: '', text: '' }); }}
              placeholder="Paste your study notes here, or upload a .txt file…"
              rows={12}
            />

            <div className="notes-meta">
              <span>
                {fileName ? <>File: <strong>{fileName}</strong> · </> : null}
                {notes.length.toLocaleString()} / {MAX_NOTES_CHARS.toLocaleString()} characters
              </span>
            </div>

            {notesMessage.text && (
              <p className={`msg msg-${notesMessage.type}`} role={notesMessage.type === 'error' ? 'alert' : 'status'}>
                {notesMessage.text}
              </p>
            )}

            <div className="row">
              <input ref={fileInputRef} id="file" type="file" accept=".txt,text/plain" onChange={handleFile} className="sr-only" />
              <button type="button" className="btn btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={busy}>
                Upload .txt file
              </button>
              <button type="button" className="btn btn-ghost" onClick={clearAll}>
                Clear all
              </button>
            </div>

            <div className="field">
              <label htmlFor="model">Local model</label>
              <select id="model" value={model} onChange={(e) => setModel(e.target.value)} disabled={busy}>
                {MODELS.map((m) => {
                  const known = health.status === 'online';
                  const installed = health.models.includes(m.id);
                  return (
                    <option key={m.id} value={m.id}>
                      {m.label} — {m.hint}{known && !installed ? ' (not installed)' : ''}
                    </option>
                  );
                })}
              </select>
            </div>

            <p className="privacy">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
              Your notes stay on this computer. They go only to the local server and your local Ollama model, and are not saved.
            </p>
          </section>

          {/* ---------- Right: AI ---------- */}
          <section className="card" aria-labelledby="ai-title">
            <h2 id="ai-title">Ask your Study Buddy</h2>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                run('ask');
              }}
            >
              <label htmlFor="question">Ask a question about your notes</label>
              <div className="ask-row">
                <input
                  id="question"
                  type="text"
                  value={question}
                  maxLength={MAX_QUESTION_CHARS}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="e.g. Explain 2NF in simple words"
                  disabled={busy}
                />
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {loadingAction === 'ask' ? 'Thinking…' : 'Ask'}
                </button>
              </div>
            </form>

            <div className="chips" aria-label="Example questions">
              {EXAMPLE_QUESTIONS.map((q) => (
                <button key={q} type="button" className="chip" onClick={() => setQuestion(q)} disabled={busy}>
                  {q}
                </button>
              ))}
            </div>

            <div className="row">
              <button type="button" className="btn btn-secondary" onClick={() => run('summarize')} disabled={busy}>
                {loadingAction === 'summarize' ? 'Summarizing…' : 'Summarize notes'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => run('quiz')} disabled={busy}>
                {loadingAction === 'quiz' ? 'Creating quiz…' : 'Generate 5-question quiz'}
              </button>
            </div>

            <div className="response" aria-live="polite" aria-busy={busy}>
              {busy && (
                <div className="loading">
                  <span className="spinner" aria-hidden="true" />
                  <div>
                    <p><strong>Your local model is working…</strong></p>
                    <p className="muted">This can take from a few seconds to a couple of minutes on a laptop.</p>
                    <button type="button" className="link-btn" onClick={cancelRequest}>Cancel</button>
                  </div>
                </div>
              )}

              {!busy && error && (
                <div className="banner banner-error" role="alert">{error}</div>
              )}

              {!busy && !error && !result && (
                <div className="empty">
                  <p><strong>Nothing here yet.</strong></p>
                  <p className="muted">Add your notes first, then ask a question, summarize, or generate a quiz.</p>
                </div>
              )}

              {!busy && result && (
                <article>
                  <div className="response-head">
                    <span className="tag">{ACTION_LABELS[result.action]}</span>
                    <span className="muted">Generated by {result.model}</span>
                    <button type="button" className="btn btn-ghost btn-sm push-right" onClick={copyResponse}>
                      Copy response
                    </button>
                  </div>
                  <div className="response-text">{result.answer}</div>
                  {copyMessage && <p className="msg msg-success" role="status">{copyMessage}</p>}
                  <p className="muted small">AI can make mistakes. Check important facts against your notes and textbook.</p>
                </article>
              )}
            </div>
          </section>
        </div>
      </main>

      <footer className="footer">
        <p>Built with React · Express · Ollama · Local-first: no cloud AI, no tracking.</p>
      </footer>
    </div>
  );
}
