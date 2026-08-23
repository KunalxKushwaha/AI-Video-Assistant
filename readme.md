# AI Video Assistant (Wavelength)

Turn any video or meeting recording into a searchable, structured, conversational record — automatically.

## The problem

Meeting recordings and long-form videos are easy to create and hard to use. The information inside them — decisions made, action items assigned, questions left open — is trapped in raw audio that nobody has time to rewatch. Manually transcribing, summarizing, and combing through a recording for "wait, what did we agree on?" doesn't scale past a handful of meetings.

## What this does

Give it a YouTube URL or a local video/audio file, and it:

1. **Transcribes** the audio — locally via Whisper for English, or via Sarvam AI's speech-to-text-translate API for Hinglish content (translating to English while transcribing).
2. **Summarizes** the transcript into a concise, readable overview using an LLM (Mistral).
3. **Extracts structure** from the conversation: action items (with owner and deadline where mentioned), key decisions, and open questions — each as its own reviewable list.
4. **Builds a chat interface** over the transcript using retrieval-augmented generation (RAG), so you can ask follow-up questions ("what did we decide about the launch date?") and get answers grounded in what was actually said — not hallucinated.

Everything is saved to an account, so past analyses are available later without re-processing the same video twice — and if the exact same source has already been analyzed by anyone, re-running it reuses the stored result instead of re-transcribing from scratch.

## Features

- YouTube URL or local file upload as input, English or Hinglish
- AI-generated title, summary, action items, decisions, and open questions
- Chat with the transcript via a RAG pipeline (LangChain + Chroma + Mistral)
- Accounts with email/password or Google / Microsoft sign-in
- Per-user history of past analyses, reopenable without re-processing
- A polished web UI (Wavelength) — not just a CLI script

## How it works, at a glance

```
YouTube URL / file
        │
        ▼
  Audio extraction & chunking  (yt-dlp, pydub, ffmpeg)
        │
        ▼
  Transcription                (Whisper / Sarvam AI)
        │
        ├──▶ Summary + title            (Mistral LLM)
        ├──▶ Action items / decisions / questions   (Mistral LLM)
        └──▶ Vector index for chat      (Chroma + Mistral embeddings)
        │
        ▼
  Stored per-user in MongoDB Atlas
        │
        ▼
  Web UI: results dashboard + chat
```

## Tech stack

**Pipeline**: Python, OpenAI Whisper, Sarvam AI, LangChain (LCEL), Mistral AI, ChromaDB, yt-dlp, pydub

**Backend**: FastAPI, MongoDB Atlas, JWT auth, Authlib (Google/Microsoft OAuth)

**Frontend**: Plain HTML/CSS/JavaScript — no framework, no build step

## Project structure

```
.
├── main.py                  # CLI entry point / pipeline orchestration
├── core/
│   ├── transcriber.py        # Whisper + Sarvam transcription
│   ├── summarizer.py         # Title + summary generation
│   ├── extractor.py          # Action items / decisions / questions
│   ├── vector_store.py       # Chroma vector store + embeddings
│   └── rag_engine.py         # RAG chain for chat
├── utils/
│   └── audio_processor.py    # Download, convert, chunk audio
├── api_server.py             # FastAPI backend (wraps the pipeline above)
├── auth.py                   # Password hashing + JWT
├── db.py                     # MongoDB connection
├── oauth.py                  # Google / Microsoft sign-in
└── frontend/                 # index.html, style.css, script.js
```

## Running it

See `frontend/README.md` for full setup, environment variables, and free deployment instructions (Render + Vercel/Netlify + MongoDB Atlas).