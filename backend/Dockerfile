# API image for compose.prod.yml: migrates the DB, then serves FastAPI on :8000.
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.12.20 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PATH="/app/.venv/bin:$PATH"
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY . .
RUN uv sync --frozen --no-dev
EXPOSE 8000
# one process: escalation runs as a background task inside it
CMD ["sh", "-c", "alembic upgrade head && exec fastapi run app/main.py --host 0.0.0.0 --port 8000"]
