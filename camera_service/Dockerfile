FROM python:3.11-slim
WORKDIR /app
COPY camera_service/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY camera_service /app/camera_service
ENV PYTHONUNBUFFERED=1
CMD ["sh", "-c", "uvicorn camera_service.app:app --host 0.0.0.0 --port ${PORT:-8080} --no-access-log"]
