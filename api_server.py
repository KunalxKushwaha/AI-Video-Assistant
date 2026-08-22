# """
# api_server.py
# --------------
# Thin FastAPI wrapper around your existing main.py pipeline.

# It exposes three endpoints the front-end (script.js) already calls:
#   POST /api/analyze         { source: <youtube url>, language }
#   POST /api/analyze/upload  multipart: file=<upload>, language
#   POST /api/chat            { session_id, question }

# Drop this file next to main.py (same folder), so `from main import run_pipeline`
# resolves correctly, then run:

#     uvicorn api_server:app --reload --port 8000

# See README.md for the full setup.
# """

# import os
# import re
# import shutil
# import tempfile
# import uuid

# from fastapi import FastAPI, File, HTTPException, UploadFile, Form
# from fastapi.middleware.cors import CORSMiddleware
# from starlette.concurrency import run_in_threadpool
# from pydantic import BaseModel

# from main import run_pipeline
# from core.rag_engine import ask_question

# app = FastAPI(title="Wavelength API")

# # Dev-friendly CORS. Tighten allow_origins to your actual frontend origin
# # (e.g. "http://localhost:5500") before shipping this anywhere real.
# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=["*"],
#     allow_methods=["*"],
#     allow_headers=["*"],
# )

# # In-memory session store: session_id -> rag_chain
# # Swap for Redis/a DB if you need this to survive a restart or scale
# # past a single process.
# SESSIONS: dict = {}


# class AnalyzeRequest(BaseModel):
#     source: str
#     language: str = "english"


# class ChatRequest(BaseModel):
#     session_id: str
#     question: str


# def normalize_list(value):
#     """extractor functions may return a list or a newline-delimited string —
#     make sure the API always hands the frontend a clean list of strings."""
#     if isinstance(value, list):
#         return [str(v).strip("-*• \t") for v in value if str(v).strip()]
#     if isinstance(value, str):
#         lines = re.split(r"\r?\n", value)
#         return [re.sub(r"^[-*•\d.)\s]+", "", ln).strip() for ln in lines if ln.strip()]
#     return []


# def package_result(result: dict, source_label: str, language: str) -> dict:
#     session_id = str(uuid.uuid4())
#     SESSIONS[session_id] = result["rag_chain"]

#     return {
#         "session_id": session_id,
#         "title": result.get("title", "Untitled"),
#         "transcript": result.get("transcript", ""),
#         "summary": result.get("summary", ""),
#         "action_items": normalize_list(result.get("action_items")),
#         "key_decisions": normalize_list(result.get("key_decisions")),
#         "open_questions": normalize_list(result.get("open_questions")),
#         "meta": {
#             "source": source_label,
#             "language": language,
#         },
#     }


# @app.post("/api/analyze")
# async def analyze(req: AnalyzeRequest):
#     """Analyze a YouTube URL (or any source string your process_input handles)."""
#     try:
#         result = await run_in_threadpool(run_pipeline, req.source, req.language)
#     except Exception as exc:  # noqa: BLE001 — surface pipeline errors to the UI
#         raise HTTPException(status_code=500, detail=str(exc)) from exc
#     return package_result(result, req.source, req.language)


# @app.post("/api/analyze/upload")
# async def analyze_upload(file: UploadFile = File(...), language: str = Form("english")):
#     """Analyze an uploaded local video/audio file."""
#     suffix = os.path.splitext(file.filename or "")[1] or ".mp4"
#     tmp_path = None
#     try:
#         with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
#             shutil.copyfileobj(file.file, tmp)
#             tmp_path = tmp.name

#         result = await run_in_threadpool(run_pipeline, tmp_path, language)
#     except Exception as exc:  # noqa: BLE001
#         raise HTTPException(status_code=500, detail=str(exc)) from exc
#     finally:
#         file.file.close()
#         if tmp_path and os.path.exists(tmp_path):
#             os.remove(tmp_path)

#     return package_result(result, file.filename, language)


# @app.post("/api/chat")
# async def chat(req: ChatRequest):
#     rag_chain = SESSIONS.get(req.session_id)
#     if rag_chain is None:
#         raise HTTPException(
#             status_code=404,
#             detail="Unknown session_id — analyze a video first, or it may have expired since the server restarted.",
#         )
#     try:
#         answer = await run_in_threadpool(ask_question, rag_chain, req.question)
#     except Exception as exc:  # noqa: BLE001
#         raise HTTPException(status_code=500, detail=str(exc)) from exc
#     return {"answer": answer}


# @app.get("/api/health")
# async def health():
#     return {"status": "ok", "active_sessions": len(SESSIONS)}
"""
api_server.py
--------------
Thin FastAPI wrapper around your existing main.py pipeline.

It exposes three endpoints the front-end (script.js) already calls:
  POST /api/analyze         { source: <youtube url>, language }
  POST /api/analyze/upload  multipart: file=<upload>, language
  POST /api/chat            { session_id, question }

Drop this file next to main.py (same folder), so `from main import run_pipeline`
resolves correctly, then run:

    uvicorn api_server:app --reload --port 8000

See README.md for the full setup.

--------------------------------------------------------------
Why there's a disk cache
--------------------------------------------------------------
run_pipeline() does two very different kinds of work: the expensive part
(extracting audio, transcribing, summarizing, extracting insights) and the
part needed for chat (embedding the transcript into a vector store).
SESSIONS below only holds the in-memory rag_chain object, which disappears
the moment this process restarts (including on every `--reload` reload).

To avoid re-running transcription + summarization for a video you've
already processed, results are also written to cache/analysis_cache.json,
keyed by a hash of (source, language). On a cache hit, only
build_rag_chain(transcript) is re-run — the transcript, summary, action
items, decisions and questions are reused as-is.
"""

import hashlib
import json
import os
import re
import shutil
import tempfile
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel

from main import run_pipeline
from core.rag_engine import ask_question, build_rag_chain

app = FastAPI(title="Wavelength API")

# Dev-friendly CORS. Tighten allow_origins to your actual frontend origin
# (e.g. "http://localhost:5500") before shipping this anywhere real.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory session store: session_id -> rag_chain
# This still resets on restart — that part is unavoidable without persisting
# the vector store itself, which is a bigger change specific to whatever
# vector DB build_rag_chain uses under the hood.
SESSIONS: dict = {}

# --------------------------------------------------------------
# Disk cache for the expensive (non-rag_chain) parts of a result
# --------------------------------------------------------------
CACHE_DIR = Path(__file__).parent / "cache"
CACHE_FILE = CACHE_DIR / "analysis_cache.json"


def _load_cache() -> dict:
    if not CACHE_FILE.exists():
        return {}
    try:
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _save_cache(cache: dict) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(json.dumps(cache, indent=2), encoding="utf-8")


def _cache_key(fingerprint: str, language: str) -> str:
    return hashlib.sha256(f"{fingerprint}|{language}".encode("utf-8")).hexdigest()


class AnalyzeRequest(BaseModel):
    source: str
    language: str = "english"


class ChatRequest(BaseModel):
    session_id: str
    question: str


def normalize_list(value):
    """extractor functions may return a list or a newline-delimited string —
    make sure the API always hands the frontend a clean list of strings."""
    if isinstance(value, list):
        return [str(v).strip("-*• \t") for v in value if str(v).strip()]
    if isinstance(value, str):
        lines = re.split(r"\r?\n", value)
        return [re.sub(r"^[-*•\d.)\s]+", "", ln).strip() for ln in lines if ln.strip()]
    return []


def _fields_from_fresh_result(result: dict) -> dict:
    return {
        "title": result.get("title", "Untitled"),
        "transcript": result.get("transcript", ""),
        "summary": result.get("summary", ""),
        "action_items": normalize_list(result.get("action_items")),
        "key_decisions": normalize_list(result.get("key_decisions")),
        "open_questions": normalize_list(result.get("open_questions")),
    }


def _new_session(rag_chain) -> str:
    session_id = str(uuid.uuid4())
    SESSIONS[session_id] = rag_chain
    return session_id


async def _analyze_with_cache(fingerprint: str, source_for_pipeline: str, source_label: str, language: str) -> dict:
    """fingerprint identifies the source for caching (URL, or file content hash).
    source_for_pipeline is what actually gets passed into run_pipeline (a URL,
    or a temp file path)."""
    cache = _load_cache()
    key = _cache_key(fingerprint, language)

    if key in cache:
        fields = cache[key]
        print(f"✅ Cache hit for this source — skipping transcription, only rebuilding the vector index.")
        # Rebuild only the vector index — cheap compared to re-transcribing.
        rag_chain = await run_in_threadpool(build_rag_chain, fields["transcript"])
        was_cached = True
    else:
        print(f"⏳ Cache miss — running the full pipeline (this is the slow part).")
        result = await run_in_threadpool(run_pipeline, source_for_pipeline, language)
        fields = _fields_from_fresh_result(result)
        rag_chain = result["rag_chain"]
        cache[key] = fields
        _save_cache(cache)
        was_cached = False

    session_id = _new_session(rag_chain)
    return {
        "session_id": session_id,
        **fields,
        "meta": {"source": source_label, "language": language, "cached": was_cached},
    }


@app.post("/api/analyze")
async def analyze(req: AnalyzeRequest):
    """Analyze a YouTube URL (or any source string your process_input handles)."""
    try:
        return await _analyze_with_cache(
            fingerprint=req.source, source_for_pipeline=req.source,
            source_label=req.source, language=req.language,
        )
    except Exception as exc:  # noqa: BLE001 — surface pipeline errors to the UI
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/analyze/upload")
async def analyze_upload(file: UploadFile = File(...), language: str = Form("english")):
    """Analyze an uploaded local video/audio file."""
    suffix = os.path.splitext(file.filename or "")[1] or ".mp4"
    tmp_path = None
    try:
        content = await file.read()
        fingerprint = hashlib.sha256(content).hexdigest()

        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        return await _analyze_with_cache(
            fingerprint=fingerprint, source_for_pipeline=tmp_path,
            source_label=file.filename, language=language,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        file.file.close()
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


@app.post("/api/chat")
async def chat(req: ChatRequest):
    rag_chain = SESSIONS.get(req.session_id)
    if rag_chain is None:
        raise HTTPException(
            status_code=404,
            detail="Unknown session_id — the server may have restarted. Re-analyze the same source; "
                   "if it's a URL, this will be near-instant thanks to the cache.",
        )
    try:
        answer = await run_in_threadpool(ask_question, rag_chain, req.question)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"answer": answer}


@app.get("/api/health")
async def health():
    cache_size = len(_load_cache())
    return {"status": "ok", "active_sessions": len(SESSIONS), "cached_analyses": cache_size}