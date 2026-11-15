# Пошаговый план перехода на Docker Compose

Ниже — план для **твоей** архитектуры (Node.js + whisper + внешний LLM). Это **пошаговый переход** от текущего локального запуска к `docker compose up -d`, с проверкой на каждом шаге. **LLM (llama.cpp / Ollama) выносится в отдельный контейнер** (или остаётся на хосте — см. Шаг 6).

---

## Шаг 0: Подготовка (до Docker)

**Цель:** убедиться, что текущее приложение работает локально (без Docker). Это база для сравнения.

1. **Запусти backend** (`cd server && pnpm start`) — проверь `http://localhost:3000`.
2. **Запусти frontend** (production build уже в `frontend/dist`, backend отдаёт статику — или dev на `:5175`).
3. **Запусти whisper** (`cd server && pnpm run whisper`) — проверь `:8081` и `:8082`.
4. **Запусти LLM** (llama.cpp на `:8080` или Ollama на `:11434`).
5. **Проверь чат** — отправь сообщение, проверь streaming, reasoning, prompts, params.

**Если всё работает** — переходи к Шагу 1. **Если нет** — сначала почини локально (Docker не починит то, что сломано в коде).

---

## Шаг 1: NVIDIA Container Toolkit (только если GPU)

**Цель:** Docker должен видеть GPU. **Пропусти, если LLM на хосте (Ollama/llama.cpp вне Docker) или нет NVIDIA GPU** (CPU-only whisper).

```bash
# Ubuntu/Debian
distribution=$(. /etc/os-release; echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/libnvidia-container/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

**Проверка:**
```bash
docker run --rm --gpus all nvidia/cuda:12.2.0-base-ubuntu22.04 nvidia-smi
```

Должен показать твою GPU. **Если нет** — Docker не видит GPU, whisper в контейнере будет на CPU (медленно, но работает).

**Важно:** `deploy.resources.reservations.devices` в `docker compose up` **не работает** (Swarm-only) . Используй `runtime: nvidia` + `NVIDIA_VISIBLE_DEVICES=all` .

---

## Шаг 2: `Dockerfile.app` (Node.js + frontend)

**Цель:** собрать образ приложения (backend + frontend static).

**Создай `Dockerfile.app` в корне:**

```dockerfile
# Stage 1: build frontend
FROM node:20-alpine AS frontend
WORKDIR /build
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm run build

# Stage 2: deps (better-sqlite3 native)
FROM node:20-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY server/package.json server/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Stage 3: runtime
FROM node:20-slim
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY server/ ./
COPY --from=frontend /build/dist /app/frontend/dist
RUN mkdir -p /app/data/uploads /app/data/uploads/thumbs && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:3000/api/providers').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
```

**Почему `python3 make g++` в deps-стадии:** `better-sqlite3` — native module, требует сборки. В runtime — **не нужны** (бинарник уже собран) .

**`.dockerignore` (создай в корне):**
```
node_modules
dist
.git
data
*.log
.env
server/.env
temp_audio
uploads
frontend/node_modules
```

**Проверка:**
```bash
docker build -f Dockerfile.app -t chat-app:local .
docker run --rm -p 3000:3000 chat-app:local
```

Открой `http://localhost:3000` — должен открыться frontend (но API провайдеров будет 503, пока нет LLM).

---

## Шаг 3: `Dockerfile.whisper` (whisper.cpp)

**Цель:** собрать образ whisper-server. **Можно пропустить, если whisper остаётся на хосте** (запускается `pnpm run whisper` вне Docker).

**Создай `Dockerfile.whisper`:**

```dockerfile
ARG USE_CUDA=true

FROM nvidia/cuda:12.2.0-devel-ubuntu22.04 AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
    git cmake build-essential && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch v1.6.2 https://github.com/ggerganov/whisper.cpp /whisper
WORKDIR /whisper
RUN if [ "$USE_CUDA" = "true" ]; then \
      cmake -B build -DGGML_CUDA=1 -DCMAKE_BUILD_TYPE=Release && cmake --build build -j; \
    else \
      cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j; \
    fi

FROM ${RUNTIME_BASE:-nvidia/cuda:12.2.0-runtime-ubuntu22.04}
RUN apt-get update && apt-get install -y --no-install-recommends curl libgomp1 && rm -rf /var/lib/apt/lists/*
COPY --from=build /whisper/build/bin/whisper-server /usr/local/bin/
COPY --from=build /whisper/build/bin/*.so /usr/local/lib/
RUN ldconfig
ENV LD_LIBRARY_PATH=/usr/local/lib
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD curl -f http://localhost:8081/health || exit 1
CMD ["whisper-server", "--model", "/models/ggml-medium.bin", "--host", "0.0.0.0", "--port", "8081"]
```

**CPU-only (Apple Silicon / нет NVIDIA):**
```bash
docker build -f Dockerfile.whisper -t chat-app-whisper:local \
  --build-arg USE_CUDA=false \
  --build-arg RUNTIME_BASE=ubuntu:22.04 .
```

**Модель:** `ggml-medium.bin` (~1.5 ГБ) — **не** в образе (иначе образ ~10 ГБ). Volume `./models/` + скачивание вручную (или entrypoint — см. Шаг 4).

**Проверка:**
```bash
# Модель должна лежать в ./models/ggml-medium.bin
docker run --rm --gpus all -p 8081:8081 -v $(pwd)/models:/models:ro chat-app-whisper:local
curl http://localhost:8081/health
```

---

## Шаг 4: `docker-compose.yml`

**Цель:** оркестрация `app` + `whisper` (+ `ollama` опционально).

**Создай `docker-compose.yml` в корне:**

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile.app
    image: chat-app:local
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    extra_hosts:
      - "host.docker.internal:host-gateway"   # Linux: LLM на хосте
    env_file:
      - ./server/.env
    environment:
      - NODE_ENV=production
    depends_on:
      whisper:
        condition: service_healthy
    restart: unless-stopped
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "3" }

  whisper:
    build:
      context: .
      dockerfile: Dockerfile.whisper
      args:
        USE_CUDA: "true"
    image: chat-app-whisper:local
    ports:
      - "8081:8081"
      - "8082:8081"   # второй порт на тот же whisper (опционально)
    volumes:
      - ./models:/models:ro
    runtime: nvidia
    environment:
      - NVIDIA_VISIBLE_DEVICES=all
    restart: unless-stopped
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "3" }

  ollama:
    image: ollama/ollama:latest
    profiles: ["ollama"]
    ports:
      - "11434:11434"
    volumes:
      - ollama-models:/root/.ollama
    runtime: nvidia
    environment:
      - NVIDIA_VISIBLE_DEVICES=all
    restart: unless-stopped
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "3" }

volumes:
  ollama-models:
```

**Ключевые моменты:**
- **`extra_hosts`** — на Linux `host.docker.internal` **не работает** без этого . На macOS/Windows — работает из коробки, `extra_hosts` не мешает.
- **`depends_on: whisper: condition: service_healthy`** — app стартует **после** whisper (healthcheck). Ollama — **опционально** (profile), app **не** зависит от неё.
- **`runtime: nvidia`** — работает в `compose up` (в отличие от `deploy.resources`).
- **`env_file: ./server/.env`** — секреты **не** в образе (только runtime). В `server/.env` — `CONTEXT_BASE_DIR` (если нужен Project mode), `DEFAULT_PROVIDER`.

**Проверка:**
```bash
docker compose up -d
docker compose ps
docker compose logs app | tail -20
```

---

## Шаг 5: `server/.env` — настройка под Docker

**Цель:** убедиться, что app обращается к правильным URL внутри Docker-сети.

**Создай/отредактируй `server/.env`:**

```env
# Provider (ollama | llama_cpp)
DEFAULT_PROVIDER=ollama

# Ollama (если profile ollama — внутренний DNS; иначе localhost)
# OLLAMA_URL=http://ollama:11434       # для profile ollama
OLLAMA_URL=http://localhost:11434       # native
OLLAMA_ENABLED=true

# llama.cpp на хосте (Linux/macOS/Windows)
LLAMA_CPP_URL=http://host.docker.internal:8080
LLAMA_CPP_ENABLED=false

# Whisper (один контейнер — оба URL на него)
WHISPER_USER_URL=http://whisper:8081/inference
WHISPER_INTERLOCUTOR_URL=http://whisper:8081/inference

# Server
PORT=3000

# Project mode (опционально)
# CONTEXT_BASE_DIR=/projects

# Max reference file size (default 1MB)
# MAX_REFERENCE_FILE_SIZE=1048576
```

**Логика:**
- **Ollama в Docker** (profile) → `OLLAMA_URL=http://ollama:11434` (внутренний DNS).
- **Ollama на хосте** → `OLLAMA_URL=http://host.docker.internal:11434`.
- **llama.cpp на хосте** → `LLAMA_CPP_URL=http://host.docker.internal:8080`.
- **whisper в Docker** → `WHISPER_*_URL=http://whisper:8081/inference`.
- **whisper на хосте** (пропустил Шаг 3/4 whisper) → `WHISPER_*_URL=http://host.docker.internal:8081/inference`.

**Проверка:**
```bash
docker compose exec app printenv | grep -E "OLLAMA|LLAMA|WHISPER"
```

---

## Шаг 6: LLM — Ollama в Docker **или** llama.cpp на хосте

**Выбери один вариант:**

### Вариант A: Ollama в Docker (проще для старта)

```bash
# Запуск с профилем ollama
docker compose --profile ollama up -d

# Скачать модель (пример)
docker compose exec ollama ollama pull qwen2.5-coder:7b

# Проверить
docker compose exec ollama ollama list
```

В `server/.env`: `OLLAMA_URL=http://ollama:11434`, `OLLAMA_ENABLED=true`, `DEFAULT_PROVIDER=ollama`.

### Вариант B: llama.cpp на хосте (если уже настроен)

1. **На хосте** запусти `llama-server` (как обычно, порт `8080`).
2. В `server/.env`: `LLAMA_CPP_URL=http://host.docker.internal:8080`, `LLAMA_CPP_ENABLED=true`, `DEFAULT_PROVIDER=llama_cpp`.
3. **Проверка:** `docker compose exec app curl http://host.docker.internal:8080/health`.

**Почему llama.cpp не в Docker:** модель ~20 ГБ (Qwen3.6-35B), GPU-управление, `--ctx-size` — проще на хосте. Ollama — если хочется «всё в Docker» (модель ~4 ГБ для 7B).

---

## Шаг 7: Проверка сквозного сценария

**Цель:** убедиться, что всё работает end-to-end.

1. **Frontend:** `http://localhost:3000` — открывается.
2. **Провайдеры:** `GET /api/providers/status` (через UI) — Ollama/llama.cpp `connected`.
3. **Чат:** отправь сообщение — streaming (SSE) идёт, reasoning (если модель) — в блоке.
4. **Prompts:** вкладка Prompts в левой панели — system/templates видны (P0.2).
5. **Params:** `⚙ Params` в футере — пресеты работают (P0.1).
6. **STT:** микрофон в composer — транскрипция (whisper).
7. **AI Helper:** оверлей — resize, drag, транскрипты.

**Если что-то не так:**
```bash
docker compose logs app
docker compose logs whisper
docker compose logs ollama
```

---

## Шаг 8: Project Mode (CONTEXT_BASE_DIR) — опционально

**Цель:** если используешь PROJECT mode, примонтировать папку проектов.

**Создай `docker-compose.override.yml`:**

```yaml
services:
  app:
    volumes:
      - /home/user/Documents/progs:/projects:ro
    environment:
      - CONTEXT_BASE_DIR=/projects
```

**Почему не в основном `docker-compose.yml`:** пустой `CONTEXT_BASE_DIR` → Compose ошибка (`invalid mount path`). Пользователь **должен** явно указать путь.

**Проверка:** `GET /api/config` → `contextBaseDir.ok: true`.

---

## Шаг 9: Финальная проверка и очистка

1. **`docker compose down`** — остановить.
2. **`docker compose up -d`** — поднять заново.
3. **Проверить persistence:** `./data/chat.db` сохранился (сессии, сообщения, prompts, reasoning).
4. **`docker compose ps`** — все `healthy`.
5. **`docker compose logs --tail 50`** — нет ошибок.

**Если всё ОК** — переход завершён. **README** — обновить секцию Installation (Docker-вариант).

---

## Чек-лист (сводка)

| Шаг | Что | Проверка |
|---|---|---|
| 0 | Локальный запуск работает | Чат, streaming, STT |
| 1 | NVIDIA Toolkit | `docker run --gpus all nvidia-smi` |
| 2 | `Dockerfile.app` | `docker build` + `docker run` → `:3000` |
| 3 | `Dockerfile.whisper` | `docker run` → `:8081/health` |
| 4 | `docker-compose.yml` | `docker compose up -d` → `ps` healthy |
| 5 | `server/.env` | `docker compose exec app printenv` |
| 6 | LLM (Ollama / llama.cpp) | `providers/status` → connected |
| 7 | Сквозной сценарий | Чат, streaming, prompts, params, STT |
| 8 | Project mode (опц.) | `GET /api/config` → ok |
| 9 | Persistence + restart | `./data/chat.db` сохранился |

---

## Что **не** делать (частые ошибки)

- **Не используй `deploy.resources.reservations.devices`** — не работает в `compose up` (Swarm-only) .
- **Не монтируй `CONTEXT_BASE_DIR` с пустым значением** — Compose ошибка.
- **Не копируй `server/.env` в образ** — секреты в образе (`.dockerignore`).
- **Не используй `host.docker.internal` на Linux без `extra_hosts`** — не резолвится .
- **Не запускай `whisper` в том же контейнере, что `app`** — разные base images, healthcheck сложный.
- **Не забывай `python3 make g++` в build-стадии для `better-sqlite3`** .

**Готово.** После Шага 9 — обнови README (Docker-секция: `docker compose up -d`, `--profile ollama`, `extra_hosts`, `CONTEXT_BASE_DIR` override).