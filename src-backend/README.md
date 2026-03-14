# ReadAware Backend

FastAPI backend for the ReadAware web app.

## Quick Start

```bash
uv sync
uv run uvicorn read_aware_backend.main:app --reload
```

The API will be available at `http://127.0.0.1:8000`.

## Helpful Commands

```bash
uv run pytest
uv run ruff check .
uv run python -m read_aware_backend
```

## Environment

Settings are loaded from environment variables with the `READ_AWARE_` prefix.

Examples:

- `READ_AWARE_ENVIRONMENT=development`
- `READ_AWARE_HOST=127.0.0.1`
- `READ_AWARE_PORT=8000`
- `READ_AWARE_CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173`
