"""
db.py
-----
MongoDB Atlas connection. Reads MONGODB_URI from your .env (see .env.example).
Import get_db()/users_collection()/analyses_collection() wherever you need them —
the client is created lazily and reused across requests.
"""

import os
from pymongo import MongoClient
from pymongo.server_api import ServerApi

MONGODB_URI = os.getenv("MONGODB_URI")
DB_NAME = os.getenv("MONGODB_DB", "wavelength")

_client: MongoClient | None = None


def get_client() -> MongoClient:
    global _client
    if _client is None:
        if not MONGODB_URI:
            raise RuntimeError(
                "MONGODB_URI is not set. Add it to your .env file — see .env.example "
                "for the format and README.md for how to get one from Atlas."
            )
        _client = MongoClient(MONGODB_URI, server_api=ServerApi("1"))
    return _client


def get_db():
    return get_client()[DB_NAME]


def users_collection():
    return get_db()["users"]


def analyses_collection():
    return get_db()["analyses"]
