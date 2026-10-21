FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN addgroup --system app && adduser --system --ingroup app app && mkdir /data && chown app:app /data
COPY pyproject.toml README.md ./
COPY app ./app
RUN pip install --no-cache-dir .
USER app
ENV DATABASE_PATH=/data/fesi.sqlite3
EXPOSE 8000
CMD ["python", "-m", "app"]
