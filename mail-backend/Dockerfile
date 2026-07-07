FROM python:3.12-alpine

RUN apk add --no-cache openssl

WORKDIR /app
COPY app/ /app/

EXPOSE 8080
CMD ["python", "server.py"]
