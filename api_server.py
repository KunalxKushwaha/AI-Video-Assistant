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
from starlette.middleware.sessions import SessionMiddleware
from starlette.requests import Request
from starlette.responses import RedirectResponse

from main import run_pipeline
from core.rag_engine import ask_question, build_rag_chain

from db import analyses_collection, users_collection
from auth import JWT_SECRET, create_token, get_current_user, hash_password, verify_password
from oauth import BACKEND_URL, FRONTEND_URL, enabled_providers, oauth

load_dotenv()

app = FastAPI(title="Wavelength API")

# Required by Authlib to stash OAuth state/nonce between the redirect out
# and the callback. Reuses JWT_SECRET so there's only one secret to manage;
# feel free to split this into its own SESSION_SECRET env var later.
app.add_middleware(SessionMiddleware, secret_key=JWT_SECRET)

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
    name: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


def _user_public(user_doc) -> dict:
    return {"id": str(user_doc["_id"]), "email": user_doc["email"], "name": user_doc.get("name", "")}


@app.post("/api/auth/register")
async def register(req: RegisterRequest):
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")
    if not req.name.strip():
        raise HTTPException(status_code=400, detail="Please enter your name.")

    email = req.email.lower()
    existing = users_collection().find_one({"email": email})
    if existing:
        if not existing.get("password_hash"):
            raise HTTPException(
                status_code=409,
                detail=f"That email is already registered via {existing.get('oauth_provider', 'a social')} sign-in — use that button instead.",
            )
        raise HTTPException(status_code=409, detail="An account with that email already exists.")

    doc = {
        "email": email,
        "name": req.name.strip(),
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
    if not user or not user.get("password_hash"):
        raise HTTPException(
            status_code=401,
            detail="Incorrect email or password, or this account uses Google/Microsoft/Apple sign-in instead.",
        )
    if not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")

    token = create_token(str(user["_id"]), user["email"])
    return {"token": token, "user": _user_public(user)}


@app.get("/api/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {"user": user}


@app.get("/api/auth/providers")
async def auth_providers():
    return {"providers": enabled_providers()}


def _find_or_create_oauth_user(email: str, provider: str, sub: str, name: str = "") -> dict:
    user = users_collection().find_one({"email": email})
    if user:
        if name and not user.get("name"):
            users_collection().update_one({"_id": user["_id"]}, {"$set": {"name": name}})
            user["name"] = name
        return user
    doc = {
        "email": email,
        "name": name or email.split("@")[0],
        "password_hash": None,
        "oauth_provider": provider,
        "oauth_sub": sub,
        "created_at": datetime.now(timezone.utc),
    }
    inserted = users_collection().insert_one(doc)
    doc["_id"] = inserted.inserted_id
    return doc


async def _finish_oauth(provider: str, request: Request) -> RedirectResponse:
    client = oauth.create_client(provider)
    if client is None:
        raise HTTPException(status_code=404, detail=f"'{provider}' sign-in isn't configured on this server.")

    try:
        token = await client.authorize_access_token(request)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"{provider} sign-in failed: {exc}") from exc

    userinfo = token.get("userinfo")
    if not userinfo:
        userinfo = await client.parse_id_token(request, token)

    email = (userinfo.get("email") or "").lower()
    if not email:
        raise HTTPException(status_code=400, detail=f"{provider} didn't share an email address — try a different method.")

    user = _find_or_create_oauth_user(email, provider, userinfo.get("sub"), userinfo.get("name", ""))
    jwt_token = create_token(str(user["_id"]), user["email"])
    # Hand the token back to the frontend via a query param; script.js
    # picks it up on load and stores it, then cleans the URL.
    return RedirectResponse(url=f"{FRONTEND_URL}/?token={jwt_token}")


@app.get("/api/auth/oauth/{provider}/login")
async def oauth_login(provider: str, request: Request):
    client = oauth.create_client(provider)
    if client is None:
        raise HTTPException(status_code=404, detail=f"'{provider}' sign-in isn't configured on this server.")
    redirect_uri = f"{BACKEND_URL}/api/auth/oauth/{provider}/callback"
    return await client.authorize_redirect(request, redirect_uri)


@app.get("/api/auth/oauth/{provider}/callback")
async def oauth_callback(provider: str, request: Request):
    return await _finish_oauth(provider, request)


@app.post("/api/auth/oauth/apple/callback")
async def oauth_callback_apple(request: Request):
    # Apple posts the result back (response_mode=form_post) instead of a GET redirect.
    return await _finish_oauth("apple", request)


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