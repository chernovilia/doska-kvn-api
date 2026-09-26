# doska-kvn-api

Backend для сервиса **Доска/КВН**. Прод: https://api.доска-квн.рф/v1

Стек: **NestJS 10 + TypeScript + Prisma 5 + PostgreSQL**. Фото — Timeweb S3, почта — Unisender Go.

Документация проекта (состояние, roadmap, ранкинг) — в основном репозитории: [STATE.md](https://github.com/chernovilia/doska-kvn/blob/main/STATE.md), [ROADMAP.md](https://github.com/chernovilia/doska-kvn/blob/main/ROADMAP.md), [RANKING-AND-PROMO.md](https://github.com/chernovilia/doska-kvn/blob/main/RANKING-AND-PROMO.md).

## Локальный запуск

Требуется **Node.js 20+** и **PostgreSQL 14+**.

```bash
npm install
cp .env.example .env         # подставить DATABASE_URL и секреты
npx prisma db push           # создать таблицы по schema.prisma
SEED_ON_STARTUP=true npm run start:dev   # первый запуск: засеет регионы, города, тарифы
```

API будет на `http://localhost:3000/v1`.

Для локальной авторизации в `.env`: `COOKIE_DOMAIN=""`, `COOKIE_SECURE="false"`. Без `UNISENDER_GO_API_KEY` письмо с кодом не уйдёт. Для локальной отладки можно включить `AUTH_DEBUG_MODE="true"` и слать заголовок `X-Debug-User-Id: <id>` (на проде — только `false`).

## Эндпоинты

Все под префиксом `/v1`.

**Сервис**

| Метод | URL | |
|---|---|---|
| GET | `/`, `/health` | Инфо о сервисе, проверка БД |
| GET | `/regions`, `/cities` | Справочники |

**Авторизация** (httpOnly-cookies `access_token` / `refresh_token`)

| Метод | URL | |
|---|---|---|
| POST | `/auth/email/request` | Отправить 6-значный код на email |
| POST | `/auth/email/verify` | Проверить код, выставить cookies |
| POST | `/auth/refresh` | Ротация refresh-токена |
| POST | `/auth/logout` | Отзыв refresh, очистка cookies |
| GET | `/me` | Текущий пользователь (+ `isAdmin`) |
| PATCH | `/me` | Профиль и онбординг (`markOnboarded`, `agreeTerms`) |

**Объявления**

| Метод | URL | |
|---|---|---|
| GET | `/ads?place&section&chip&search&limit&offset&sort` | Лента (ранкинг — `ads.service.ts` → `computeScore`) |
| GET | `/ads/counts?place` | Счётчики по разделам |
| GET | `/ads/sitemap` | id и дата всех одобренных — для sitemap.xml фронта |
| GET | `/ads/:id` | Объявление |
| POST | `/ads` | Создать (auth; 5/час, 20/сутки; `photoUrls[]` до 10) |
| POST | `/ads/:id/bump` | Бесплатно поднять своё опубликованное (auth; пауза `ranking.bump_cooldown_hours`, по умолчанию 72 ч) |
| DELETE | `/ads/:id` | Удалить своё (auth); фото удаляются из S3 |
| GET | `/me/ads` | Свои объявления во всех статусах (auth) |
| POST | `/uploads/ad-photo` | Фото: multipart `file`, до 12 MB → WebP 1600px в S3 (auth; 30/час) |

**Админка** (`AdminGuard`: `role` admin/owner или email в `ADMIN_EMAILS`)

| Метод | URL | |
|---|---|---|
| GET | `/admin/stats` | Счётчики таблиц |
| GET | `/admin/users?limit&offset` | Пользователи |
| DELETE | `/admin/users/:id` | Удалить пользователя с его данными |
| GET | `/admin/ads?limit&offset&status` | Объявления с фильтром статуса |
| GET | `/admin/ads/:id` | Объявление с фото и контактами автора |
| PATCH | `/admin/ads/:id/status` | `approved` / `rejected` / `pending` / `archived` |
| DELETE | `/admin/ads/:id` | Удалить объявление |
| GET, PATCH | `/admin/moderation` | Автопубликация вкл/выкл (`Setting['moderation.autoApprove']`) |
| POST | `/admin/wipe?confirm=WIPE_ALL` | Стереть всех пользователей и объявления |

## Rate-limit

Глобальный `ThrottlerGuard`: 30 запросов/мин, 300/час, 5000/сутки. Отдельные лимиты — на `POST /ads` и `POST /uploads/ad-photo` (см. таблицу). Счётчики в памяти процесса.

## Деплой на Amvera

Push в `main` → Amvera: `npm install` → `prisma generate` (prebuild) → `npm run build`. Запуск — `npm run start:migrate:prod`, то есть `prisma db push --skip-generate --accept-data-loss && node dist/main`.

⚠️ `--accept-data-loss` молча удалит данные, если изменение схемы требует удалить или переименовать колонку. До публичного запуска планируется перейти на `prisma migrate deploy`.

Переменные окружения — в `.env.example` (полный список с комментариями) и в Amvera → Настройки → Переменные.
