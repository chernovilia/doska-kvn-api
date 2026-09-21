# doska-kvn-api

Backend для сервиса **Доска/КВН**.

Стек: **NestJS 10 + TypeScript + Prisma + PostgreSQL**.

Полная архитектура и Prisma-схема: [`ARCHITECTURE.md`](https://github.com/chernovilia/doska-kvn/blob/main/ARCHITECTURE.md) в основном репозитории.

## Локальный запуск

Требуется **Node.js 20+** и **PostgreSQL 14+**.

```bash
# 1. Клонировать и установить зависимости
git clone <repo>
cd doska-kvn-api
npm install

# 2. Скопировать .env.example → .env, подставить DATABASE_URL
cp .env.example .env

# 3. Прогнать миграции и посеять демо-данными
npx prisma migrate dev --name init
npm run seed

# 4. Запустить в dev-режиме
npm run start:dev
```

API будет на `http://localhost:3000`.

## Основные endpoints

| Метод | URL | Описание |
|---|---|---|
| `GET` | `/` | Инфо о сервисе |
| `GET` | `/health` | Проверка здоровья (в т.ч. БД) |
| `GET` | `/v1/regions` | Список регионов с городами |
| `GET` | `/v1/cities` | Все города |
| `GET` | `/v1/ads?place&section&chip&search&limit&offset&sort` | Лента объявлений |
| `GET` | `/v1/ads/counts?place` | Счётчик по разделам |
| `GET` | `/v1/ads/:id` | Карточка объявления |
| `POST` | `/v1/ads` | Создать (требует auth) |
| `GET` | `/v1/me` | Текущий пользователь (требует auth) |

## Тестовая авторизация

На этапе 2 работает в **debug-режиме**. В `.env` установлено `AUTH_DEBUG_MODE="true"`.

Клиент шлёт заголовок `X-Debug-User-Id: u-ilya` — сервер обрабатывает запрос как от этого пользователя.

Пример:

```bash
curl http://localhost:3000/v1/me -H "X-Debug-User-Id: u-ilya"
```

На **этапе 3** заменим на настоящий JWT (SMS + e-mail + Yandex ID).

## Деплой на Amvera

Сконфигурировано через `amvera.yaml`. Amvera:

1. Запускает `npm install`
2. `prisma generate` (через `prebuild`)
3. `npm run build`
4. При старте — `prisma migrate deploy && node dist/main`

Переменные окружения задаются в Amvera → **Настройки → Переменные**:

- `DATABASE_URL` — из Managed PostgreSQL
- `CORS_ORIGINS` — `https://xn----7sbhf4acwc1a.xn--p1ai,https://доска-квн.рф`
- `AUTH_DEBUG_MODE` — `true` пока, потом `false`
- `PORT` — Amvera выставит автоматически

## Планы (см. ROADMAP.md в основном репо)

- **Сейчас**: этап 2 — REST API + БД + тестовая авторизация
- **Дальше**: этап 3 — SMS/email авторизация, S3 для фото, форма подачи
- **Потом**: мессенджер, модерация, ЮKassa, PWA
