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

# --------------------------------------------------------------
# Why there's a disk cache
# --------------------------------------------------------------
# run_pipeline() does two very different kinds of work: the expensive part
# (extracting audio, transcribing, summarizing, extracting insights) and the
# part needed for chat (embedding the transcript into a vector store).
# SESSIONS below only holds the in-memory rag_chain object, which disappears
# the moment this process restarts (including on every `--reload` reload).

# To avoid re-running transcription + summarization for a video you've
# already processed, results are also written to cache/analysis_cache.json,
# keyed by a hash of (source, language). On a cache hit, only
# build_rag_chain(transcript) is re-run — the transcript, summary, action
# items, decisions and questions are reused as-is.
# """

# import hashlib
# import json
# import os
# import re
# import shutil
# import tempfile
# import uuid
# from pathlib import Path

# from fastapi import FastAPI, File, HTTPException, UploadFile, Form
# from fastapi.middleware.cors import CORSMiddleware
# from starlette.concurrency import run_in_threadpool
# from pydantic import BaseModel

# from main import run_pipeline
# from core.rag_engine import ask_question, build_rag_chain

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
# # This still resets on restart — that part is unavoidable without persisting
# # the vector store itself, which is a bigger change specific to whatever
# # vector DB build_rag_chain uses under the hood.
# SESSIONS: dict = {}

# # --------------------------------------------------------------
# # Disk cache for the expensive (non-rag_chain) parts of a result
# # --------------------------------------------------------------
# CACHE_DIR = Path(__file__).parent / "cache"
# CACHE_FILE = CACHE_DIR / "analysis_cache.json"


# def _load_cache() -> dict:
#     if not CACHE_FILE.exists():
#         return {}
#     try:
#         return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
#     except (json.JSONDecodeError, OSError):
#         return {}


# def _save_cache(cache: dict) -> None:
#     CACHE_DIR.mkdir(parents=True, exist_ok=True)
#     CACHE_FILE.write_text(json.dumps(cache, indent=2), encoding="utf-8")


# def _cache_key(fingerprint: str, language: str) -> str:
#     return hashlib.sha256(f"{fingerprint}|{language}".encode("utf-8")).hexdigest()


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


# def _fields_from_fresh_result(result: dict) -> dict:
#     return {
#         "title": result.get("title", "Untitled"),
#         "transcript": result.get("transcript", ""),
#         "summary": result.get("summary", ""),
#         "action_items": normalize_list(result.get("action_items")),
#         "key_decisions": normalize_list(result.get("key_decisions")),
#         "open_questions": normalize_list(result.get("open_questions")),
#     }


# def _new_session(rag_chain) -> str:
#     session_id = str(uuid.uuid4())
#     SESSIONS[session_id] = rag_chain
#     return session_id


# async def _analyze_with_cache(fingerprint: str, source_for_pipeline: str, source_label: str, language: str) -> dict:
#     """fingerprint identifies the source for caching (URL, or file content hash).
#     source_for_pipeline is what actually gets passed into run_pipeline (a URL,
#     or a temp file path)."""
#     cache = _load_cache()
#     key = _cache_key(fingerprint, language)

#     if key in cache:
#         fields = cache[key]
#         print(f"✅ Cache hit for this source — skipping transcription, only rebuilding the vector index.")
#         # Rebuild only the vector index — cheap compared to re-transcribing.
#         rag_chain = await run_in_threadpool(build_rag_chain, fields["transcript"])
#         was_cached = True
#     else:
#         print(f"⏳ Cache miss — running the full pipeline (this is the slow part).")
#         result = await run_in_threadpool(run_pipeline, source_for_pipeline, language)
#         fields = _fields_from_fresh_result(result)
#         rag_chain = result["rag_chain"]
#         cache[key] = fields
#         _save_cache(cache)
#         was_cached = False

#     session_id = _new_session(rag_chain)
#     return {
#         "session_id": session_id,
#         **fields,
#         "meta": {"source": source_label, "language": language, "cached": was_cached},
#     }


# @app.post("/api/analyze")
# async def analyze(req: AnalyzeRequest):
#     """Analyze a YouTube URL (or any source string your process_input handles)."""
#     try:
#         return await _analyze_with_cache(
#             fingerprint=req.source, source_for_pipeline=req.source,
#             source_label=req.source, language=req.language,
#         )
#     except Exception as exc:  # noqa: BLE001 — surface pipeline errors to the UI
#         raise HTTPException(status_code=500, detail=str(exc)) from exc


# @app.post("/api/analyze/upload")
# async def analyze_upload(file: UploadFile = File(...), language: str = Form("english")):
#     """Analyze an uploaded local video/audio file."""
#     suffix = os.path.splitext(file.filename or "")[1] or ".mp4"
#     tmp_path = None
#     try:
#         content = await file.read()
#         fingerprint = hashlib.sha256(content).hexdigest()

#         with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
#             tmp.write(content)
#             tmp_path = tmp.name

#         return await _analyze_with_cache(
#             fingerprint=fingerprint, source_for_pipeline=tmp_path,
#             source_label=file.filename, language=language,
#         )
#     except Exception as exc:  # noqa: BLE001
#         raise HTTPException(status_code=500, detail=str(exc)) from exc
#     finally:
#         file.file.close()
#         if tmp_path and os.path.exists(tmp_path):
#             os.remove(tmp_path)


# @app.post("/api/chat")
# async def chat(req: ChatRequest):
#     rag_chain = SESSIONS.get(req.session_id)
#     if rag_chain is None:
#         raise HTTPException(
#             status_code=404,
#             detail="Unknown session_id — the server may have restarted. Re-analyze the same source; "
#                    "if it's a URL, this will be near-instant thanks to the cache.",
#         )
#     try:
#         answer = await run_in_threadpool(ask_question, rag_chain, req.question)
#     except Exception as exc:  # noqa: BLE001
#         raise HTTPException(status_code=500, detail=str(exc)) from exc
#     return {"answer": answer}


# @app.get("/api/health")
# async def health():
#     cache_size = len(_load_cache())
#     return {"status": "ok", "active_sessions": len(SESSIONS), "cached_analyses": cache_size}
"""
api_server.py
--------------
FastAPI backend for Wavelength.

Wraps your existing main.py pipeline (unchanged) and adds:
  - JWT auth (register/login), so results are tied to a real account
  - MongoDB Atlas storage, so results survive restarts and reloads
  - A per-user history of past analyses that can be reopened instantly,
    without re-running transcription

Drop this file (plus auth.py and db.py) next to main.py so
`from main import run_pipeline` resolves, then:

    pip install -r requirements-api.txt
    cp .env.example .env      # fill in MONGODB_URI and JWT_SECRET
    uvicorn api_server:app --reload --port 8000

See README.md for full setup, including getting a MongoDB Atlas URI.

--------------------------------------------------------------
Endpoints
--------------------------------------------------------------
  POST   /api/auth/register        { email, password }
  POST   /api/auth/login           { email, password }
  GET    /api/auth/me              (auth required)
  POST   /api/analyze              { source, language }             (auth required)
  POST   /api/analyze/upload       multipart: file, language        (auth required)
  POST   /api/chat                 { session_id, question }         (auth required)
  GET    /api/history                                               (auth required)
  GET    /api/history/{id}                                          (auth required)
  DELETE /api/history/{id}                                          (auth required)
  GET    /api/health

--------------------------------------------------------------
How caching works now
--------------------------------------------------------------
Every analysis is stored in the `analyses` collection, keyed by a
fingerprint of (source, language). If ANY user has already analyzed that
exact source, a new analysis is still inserted for you (so it shows up in
your own history), but the expensive part — transcription, summarization,
extraction — is skipped and the stored transcript/summary/etc are reused.
Only the vector index (needed for chat) is rebuilt, which is comparatively
fast.
"""

import hashlib
import os
import re
import shutil
import tempfile
import uuid
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from starlette.concurrency import run_in_threadpool

from main import run_pipeline
from core.rag_engine import ask_question, build_rag_chain

from db import analyses_collection, users_collection
from auth import create_token, get_current_user, hash_password, verify_password

load_dotenv()

app = FastAPI(title="Wavelength API")

# Dev-friendly CORS. Tighten allow_origins to your actual frontend origin
# before shipping this anywhere real.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# session_id -> { rag_chain, user_id, analysis_id }
# Still in-memory and still resets on restart — that part is unavoidable
# without persisting the vector index itself. What's new is that the
# transcript behind it is safe in Mongo, so recovering just means rebuilding
# the index via /api/history/{id}, not re-transcribing.
SESSIONS: dict = {}


@app.on_event("startup")
async def on_startup():
    users_collection().create_index("email", unique=True)
    analyses_collection().create_index([("user_id", 1), ("created_at", -1)])
    analyses_collection().create_index("fingerprint")


# ================================================================
# Auth
# ================================================================

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


def _user_public(user_doc) -> dict:
    return {"id": str(user_doc["_id"]), "email": user_doc["email"]}


@app.post("/api/auth/register")
async def register(req: RegisterRequest):
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")

    email = req.email.lower()
    if users_collection().find_one({"email": email}):
        raise HTTPException(status_code=409, detail="An account with that email already exists.")

    doc = {
        "email": email,
        "password_hash": hash_password(req.password),
        "created_at": datetime.now(timezone.utc),
    }
    inserted = users_collection().insert_one(doc)
    doc["_id"] = inserted.inserted_id

    token = create_token(str(doc["_id"]), doc["email"])
    return {"token": token, "user": _user_public(doc)}


@app.post("/api/auth/login")
async def login(req: LoginRequest):
    user = users_collection().find_one({"email": req.email.lower()})
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")

    token = create_token(str(user["_id"]), user["email"])
    return {"token": token, "user": _user_public(user)}


@app.get("/api/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {"user": user}


# ================================================================
# Pipeline helpers
# ================================================================

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


def _fingerprint(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _serialize_analysis(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "title": doc["title"],
        "transcript": doc["transcript"],
        "summary": doc["summary"],
        "action_items": doc["action_items"],
        "key_decisions": doc["key_decisions"],
        "open_questions": doc["open_questions"],
        "meta": {
            "source": doc["source_label"],
            "language": doc["language"],
            "created_at": doc["created_at"].isoformat(),
        },
    }


async def _open_session(rag_chain, user_id: str, analysis_id: str) -> str:
    session_id = str(uuid.uuid4())
    SESSIONS[session_id] = {"rag_chain": rag_chain, "user_id": user_id, "analysis_id": analysis_id}
    return session_id


async def _get_or_create_analysis(fingerprint: str, source_for_pipeline: str, source_label: str,
                                   language: str, user_id: str) -> dict:
    key = _fingerprint(f"{fingerprint}|{language}")

    # Has ANY user already analyzed this exact source? Reuse the heavy lifting.
    existing = analyses_collection().find_one({"fingerprint": key})

    if existing:
        fields = {
            "title": existing["title"],
            "transcript": existing["transcript"],
            "summary": existing["summary"],
            "action_items": existing["action_items"],
            "key_decisions": existing["key_decisions"],
            "open_questions": existing["open_questions"],
        }
        was_cached = True
    else:
        result = await run_in_threadpool(run_pipeline, source_for_pipeline, language)
        fields = _fields_from_fresh_result(result)
        was_cached = False

    doc = {
        "user_id": user_id,
        "fingerprint": key,
        "source_label": source_label,
        "language": language,
        "created_at": datetime.now(timezone.utc),
        **fields,
    }
    inserted = analyses_collection().insert_one(doc)
    doc["_id"] = inserted.inserted_id

    rag_chain = await run_in_threadpool(build_rag_chain, fields["transcript"])
    session_id = await _open_session(rag_chain, user_id, str(doc["_id"]))

    payload = _serialize_analysis(doc)
    payload["session_id"] = session_id
    payload["meta"]["cached"] = was_cached
    return payload


# ================================================================
# Analyze / chat
# ================================================================

class AnalyzeRequest(BaseModel):
    source: str
    language: str = "english"


class ChatRequest(BaseModel):
    session_id: str
    question: str


@app.post("/api/analyze")
async def analyze(req: AnalyzeRequest, user: dict = Depends(get_current_user)):
    try:
        return await _get_or_create_analysis(
            fingerprint=req.source, source_for_pipeline=req.source,
            source_label=req.source, language=req.language, user_id=user["id"],
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/analyze/upload")
async def analyze_upload(file: UploadFile = File(...), language: str = Form("english"),
                          user: dict = Depends(get_current_user)):
    suffix = os.path.splitext(file.filename or "")[1] or ".mp4"
    tmp_path = None
    try:
        content = await file.read()
        fingerprint = hashlib.sha256(content).hexdigest()

        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        return await _get_or_create_analysis(
            fingerprint=fingerprint, source_for_pipeline=tmp_path,
            source_label=file.filename, language=language, user_id=user["id"],
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        file.file.close()
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


@app.post("/api/chat")
async def chat(req: ChatRequest, user: dict = Depends(get_current_user)):
    session = SESSIONS.get(req.session_id)
    if session is None or session["user_id"] != user["id"]:
        raise HTTPException(
            status_code=404,
            detail="Unknown or expired session. Reopen this analysis from History to get a fresh one — "
                   "it won't re-run transcription.",
        )
    try:
        answer = await run_in_threadpool(ask_question, session["rag_chain"], req.question)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"answer": answer}


# ================================================================
# History
# ================================================================

@app.get("/api/history")
async def history(user: dict = Depends(get_current_user)):
    docs = analyses_collection().find({"user_id": user["id"]}).sort("created_at", -1)
    return {
        "items": [
            {
                "id": str(d["_id"]),
                "title": d["title"],
                "source": d["source_label"],
                "language": d["language"],
                "created_at": d["created_at"].isoformat(),
            }
            for d in docs
        ]
    }


@app.get("/api/history/{analysis_id}")
async def history_item(analysis_id: str, user: dict = Depends(get_current_user)):
    try:
        doc = analyses_collection().find_one({"_id": ObjectId(analysis_id), "user_id": user["id"]})
    except InvalidId:
        doc = None
    if not doc:
        raise HTTPException(status_code=404, detail="Analysis not found.")

    rag_chain = await run_in_threadpool(build_rag_chain, doc["transcript"])
    session_id = await _open_session(rag_chain, user["id"], analysis_id)

    payload = _serialize_analysis(doc)
    payload["session_id"] = session_id
    payload["meta"]["cached"] = True
    return payload


@app.delete("/api/history/{analysis_id}")
async def delete_history_item(analysis_id: str, user: dict = Depends(get_current_user)):
    try:
        result = analyses_collection().delete_one({"_id": ObjectId(analysis_id), "user_id": user["id"]})
    except InvalidId:
        result = None
    if not result or result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Analysis not found.")
    return {"deleted": True}


@app.get("/api/health")
async def health():
    try:
        analyses_collection().estimated_document_count()
        database_connected = True
    except Exception:  # noqa: BLE001
        database_connected = False
    return {"status": "ok", "active_sessions": len(SESSIONS), "database_connected": database_connected}