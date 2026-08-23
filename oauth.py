"""
oauth.py
--------
"Sign in with Google / Microsoft / Apple" via Authlib.

Each provider only registers itself if its credentials are present in
.env — see .env.example. A provider with no credentials simply won't be
offered on the login screen (see /api/auth/providers in api_server.py),
so it's fine to configure just one or two of these.

Google & Microsoft: free, work fine with plain http://localhost redirect
URIs during development.

Apple: requires a paid Apple Developer Program membership and an HTTPS
redirect URI — Apple will not accept http://localhost at all. Leave the
APPLE_* vars blank until you have a real domain if you don't want to deal
with that yet; everything else here works without it.
"""

import os
import time

import jwt as pyjwt
from authlib.integrations.starlette_client import OAuth

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5500")
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")

oauth = OAuth()

# ---------------- Google ----------------
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
if GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET:
    oauth.register(
        name="google",
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )

# ---------------- Microsoft ----------------
MICROSOFT_CLIENT_ID = os.getenv("MICROSOFT_CLIENT_ID")
MICROSOFT_CLIENT_SECRET = os.getenv("MICROSOFT_CLIENT_SECRET")
MICROSOFT_TENANT = os.getenv("MICROSOFT_TENANT", "common")  # "common" = personal + work/school accounts
if MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET:
    oauth.register(
        name="microsoft",
        client_id=MICROSOFT_CLIENT_ID,
        client_secret=MICROSOFT_CLIENT_SECRET,
        server_metadata_url=f"https://login.microsoftonline.com/{MICROSOFT_TENANT}/v2.0/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )

# ---------------- Apple ----------------
APPLE_CLIENT_ID = os.getenv("APPLE_CLIENT_ID")       # your "Services ID" identifier
APPLE_TEAM_ID = os.getenv("APPLE_TEAM_ID")
APPLE_KEY_ID = os.getenv("APPLE_KEY_ID")
APPLE_PRIVATE_KEY = os.getenv("APPLE_PRIVATE_KEY")   # contents of the .p8 key file
APPLE_CONFIGURED = all([APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY])


def _apple_client_secret() -> str:
    """Apple doesn't use a static client secret — you sign a JWT with your
    .p8 private key instead. Valid up to 6 months (Apple's max), generated
    once at startup so it doesn't need refreshing mid-session."""
    now = int(time.time())
    payload = {
        "iss": APPLE_TEAM_ID,
        "iat": now,
        "exp": now + 15_777_000,  # ~6 months, Apple's maximum
        "aud": "https://appleid.apple.com",
        "sub": APPLE_CLIENT_ID,
    }
    private_key = APPLE_PRIVATE_KEY.replace("\\n", "\n")
    return pyjwt.encode(payload, private_key, algorithm="ES256", headers={"kid": APPLE_KEY_ID})


if APPLE_CONFIGURED:
    oauth.register(
        name="apple",
        client_id=APPLE_CLIENT_ID,
        client_secret=_apple_client_secret(),
        server_metadata_url="https://appleid.apple.com/.well-known/openid-configuration",
        client_kwargs={"scope": "name email", "response_mode": "form_post"},
    )


def enabled_providers() -> list:
    names = []
    if GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET:
        names.append("google")
    if MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET:
        names.append("microsoft")
    if APPLE_CONFIGURED:
        names.append("apple")
    return names
