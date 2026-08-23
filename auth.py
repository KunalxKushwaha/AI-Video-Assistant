"""
auth.py
-------
Password hashing (bcrypt) + JWT issuing/verification for Wavelength.
Set JWT_SECRET in your .env — see .env.example. Anyone who has that
secret can forge tokens, so keep it out of source control and don't
reuse the placeholder value in production.

Social login (Google/Microsoft/Apple) lives in oauth.py — this file only
handles email/password accounts plus the JWT session tokens issued after
ANY login method succeeds (password or social).
"""

import os
from datetime import datetime, timedelta, timezone

import jwt
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import Header, HTTPException
from passlib.context import CryptContext

from db import users_collection

JWT_SECRET = os.getenv("JWT_SECRET", "dev-only-secret-change-me")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 7

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash) -> bool:
    if not password_hash:
        return False  # social-login account with no password set
    return pwd_context.verify(password, password_hash)


def create_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired — please log in again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid session — please log in again.")


async def get_current_user(authorization: str = Header(None)) -> dict:
    """FastAPI dependency: Depends(get_current_user) on any route that needs a logged-in user."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header.")

    token = authorization[len("Bearer "):].strip()
    payload = decode_token(token)

    try:
        user = users_collection().find_one({"_id": ObjectId(payload["sub"])})
    except InvalidId:
        raise HTTPException(status_code=401, detail="Invalid session — please log in again.")

    if not user:
        raise HTTPException(status_code=401, detail="Account no longer exists.")

    return {"id": str(user["_id"]), "email": user["email"], "name": user.get("name", "")}