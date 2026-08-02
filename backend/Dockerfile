FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY pyproject.toml ./
COPY app ./app
COPY alembic.ini ./
COPY alembic ./alembic
RUN pip install --no-cache-dir .
RUN groupadd --system flowledger \
    && useradd --system --gid flowledger --home-dir /app flowledger \
    && mkdir -p /var/log/flow-ledger \
    && chown -R flowledger:flowledger /app /var/log/flow-ledger

EXPOSE 8000
USER flowledger
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
