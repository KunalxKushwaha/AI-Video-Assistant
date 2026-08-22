# Wavelength — UI for your AI Video Assistant

A frontend for the pipeline in `main.py`: paste a YouTube URL or upload a
file, watch it get transcribed and analyzed, then chat with it.

```
wavelength/
├── index.html            the app
├── style.css              design system + animations
├── script.js               all interactivity + API calls
├── api_server.py          FastAPI wrapper around main.py (put next to main.py)
├── requirements-api.txt    extra deps needed only for api_server.py
└── README.md
```

The UI works two ways:

- **Demo mode** — open `index.html` with no backend running. Every request
  automatically falls back to a sample meeting transcript, so you can see
  the whole flow (analysis → tabs → chat) immediately.
- **Live mode** — run `api_server.py` next to your existing `main.py`, and
  the same UI calls your real pipeline instead.

---

## 1. Try it in demo mode (no setup)

Just open `index.html` in a browser. Paste any text into the URL field (or
pick a file) and hit **Analyze** — you'll see the full simulated pipeline,
sample results across all five tabs, and a working chat that answers from
the sample transcript. This is the fastest way to review the design.

---

## 2. Wire it to your real pipeline

### a. Install the API layer's dependencies

Your existing project already has whatever `main.py` needs (whisper/transcription
lib, LLM client, `python-dotenv`, etc.) — keep that environment. On top of it,
install just the web-server pieces:

```bash
pip install -r requirements-api.txt
```

### b. Place `api_server.py` next to `main.py`

It imports `from main import run_pipeline` and
`from core.rag_engine import ask_question`, so it needs to sit in your
project root, alongside `main.py` and the `core/`/`utils/` packages.

```
your-project/
├── main.py
├── api_server.py      <- copy it here
├── core/
├── utils/
└── .env
```

### c. Start the backend

```bash
uvicorn api_server:app --reload --port 8000
```

This exposes:

| Method | Route                | Body                                  |
|--------|-----------------------|----------------------------------------|
| POST   | `/api/analyze`        | `{ "source": "<youtube url>", "language": "english" }` |
| POST   | `/api/analyze/upload` | multipart: `file`, `language`          |
| POST   | `/api/chat`           | `{ "session_id": "...", "question": "..." }` |
| GET    | `/api/health`         | —                                       |

`run_pipeline` and `ask_question` are called exactly as they're defined in
`main.py` / `core/rag_engine.py` — nothing about your pipeline changes.

### d. Serve the frontend

Opening `index.html` directly still works, but serving it avoids any
browser quirks with `file://` origins:

```bash
# from the wavelength/ folder, in a second terminal
python3 -m http.server 5500
```

Then visit `http://localhost:5500`.

### e. Point the frontend at your backend

`script.js` has one constant at the top:

```js
const API_BASE = "http://localhost:8000";
```

Update it if your backend runs somewhere else (a different port, a deployed
URL, etc.).

Once both are running, the "Demo mode" chip you saw earlier disappears and
every result comes straight from your pipeline. If the backend is
unreachable for any reason, the UI quietly falls back to demo data again
instead of breaking — worth knowing if results look suspiciously tidy.

---

## Notes on the file-upload path

Browsers never expose a local file's real filesystem path, so
`/api/analyze/upload` writes the uploaded bytes to a temp file server-side
and passes that path into `run_pipeline`, then deletes it once processing
finishes. If `process_input` in `utils/audio_processor.py` expects something
other than a plain file path (e.g. a specific object), adjust that endpoint
in `api_server.py` accordingly.

## Customizing the design

Everything visual is token-driven at the top of `style.css`:

- Colors: the `--bg-*`, `--violet`, `--amber`, `--teal`, `--rose` variables.
- Type: `--font-display` / `--font-body` / `--font-mono` (loaded from Google
  Fonts in `index.html` — swap the `<link>` tags if you change these).
- The waveform-bar motif (`makeBars()` in `script.js`) is reused for the
  hero, the processing loader, and the chat typing indicator — change the
  bar count/height there if you want it louder or quieter.

## Accessibility & polish already baked in

- Keyboard-visible focus rings on every interactive element.
- `prefers-reduced-motion` disables/shortens animations.
- Tabs use proper `role="tab"`/`aria-selected` semantics.
- Fully responsive from ~360px phones up through wide desktop.
