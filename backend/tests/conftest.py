"""Tests run against a separate `fastabc_test` database; each test is rolled back."""

import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, make_url, text

load_dotenv(Path(__file__).resolve().parents[2] / ".env")
_url = make_url(os.environ["DATABASE_URL"]).set(database="fastabc_test")
os.environ["DATABASE_URL"] = _url.render_as_string(hide_password=False)  # before app.core.db is imported

import pytest  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

import app.models  # noqa: E402, F401  registers every model
from app.core.db import Base, engine  # noqa: E402


@pytest.fixture(scope="session")
def schema():
    admin = create_engine(_url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        if not conn.scalar(text("SELECT 1 FROM pg_database WHERE datname = 'fastabc_test'")):
            conn.execute(text("CREATE DATABASE fastabc_test"))
    admin.dispose()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield


@pytest.fixture
def db(schema):
    with engine.connect() as conn:
        trans = conn.begin()
        session = Session(conn, join_transaction_mode="create_savepoint", expire_on_commit=False)
        yield session
        session.close()
        trans.rollback()


@pytest.fixture(autouse=True)
def no_sampling(monkeypatch):
    """Random audit sampling off by default so counts are deterministic; tests opt in."""
    monkeypatch.setattr("app.grading.engine.SAMPLE_RATE", 0.0)
