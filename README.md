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
| GET | `/ads?place&section&group&authorId&attr&chip&search&priceMin&priceMax&limit&offset&sort` | Лента. `attr` — JSON фильтров по характеристикам: `{"rooms":"2","area":{"gte":40}}` (до 10 полей). `section=free` — «Отдам даром» (цена 0 в товарных разделах), `sort`: top (ранкинг — `computeScore`) / recent / cheap / expensive |
| GET | `/ads/counts?place` | Счётчики по разделам |
| GET | `/ads/sitemap` | id и дата всех одобренных — для sitemap.xml фронта |
| GET | `/ads/:id` | Объявление |
| POST | `/ads/:id/view` | Просмотр страницы: +1 к `viewsCount`, один раз в сутки на пользователя / `sessionId` браузера / хэш IP; автор не считается |
| GET | `/users/:id` | Публичный профиль продавца: имя, аватар, «о себе», город, рейтинг, дата регистрации, число активных объявлений. Почту и телефон не отдаёт |
| GET | `/favorites` | Избранные объявления (auth; только опубликованные, свежие сверху, до 200) |
| GET | `/favorites/ids` | id избранного — для сердечек в ленте (auth) |
| POST | `/favorites/:adId` | Добавить (auth; повтор — не ошибка; своё нельзя) |
| DELETE | `/favorites/:adId` | Убрать (auth) |
| GET | `/users/:id/reviews` | Отзывы о пользователе (публично, до 100, свежие сверху) |
| GET | `/conversations/:id/review` | Можно ли оставить отзыв по диалогу: `{ eligible, reason: 'no_dialog' \| 'already' \| null, review }` (auth) |
| POST | `/reviews` | Отзыв `{ conversationId, rating 1–5, text? до 1000 }`: только участник диалога, где писали оба, один на диалог; пересчитывает `rating`/`reviewsCount`, уведомляет (auth; 20/сутки) |
| GET | `/notifications` | Последние 50 уведомлений (auth) |
| GET | `/notifications/unread-count` | Непрочитанные (auth; опрос раз в минуту) |
| POST | `/notifications/read-all` · `/notifications/:id/read` | Прочитать все / одно (auth) |
| POST | `/ads` | Создать (auth; 5/час, 20/сутки; `photoUrls[]` до 10; `attributes` — плоский объект характеристик, до 20 полей; `eventDate` — у афиши) |
| POST | `/ads/:id/bump` | Бесплатно поднять своё опубликованное (auth; пауза `ranking.bump_cooldown_hours`, по умолчанию 72 ч) |
| DELETE | `/ads/:id` | Удалить своё (auth); фото удаляются из S3 |
| GET | `/me/ads` | Свои объявления во всех статусах (auth) |
| POST | `/uploads/ad-photo` | Фото: multipart `file`, до 12 MB → WebP 1600px в S3 (auth; 30/час) |

**Сообщения** (только вошедшие; чужой диалог — 404)

| Метод | URL | |
|---|---|---|
| GET | `/ads/:id/contact` | Телефон продавца, если он выбрал связь по телефону (30/час) |
| POST | `/conversations` | `{ adId }` → найти или создать диалог (себе нельзя) |
| GET | `/conversations` | Список: объявление, собеседник, последнее сообщение, непрочитанные |
| GET | `/conversations/unread-count` | Непрочитанные для значка |
| GET | `/conversations/:id/messages?after=` | Сообщения; `after` — только новые (для опроса). Отмечает прочитанным |
| POST | `/conversations/:id/messages` | `{ text }` 1–2000 символов (20/мин). Письмо получателю — на первое непрочитанное |

**Админка** (`AdminGuard`: `role` admin/owner или email в `ADMIN_EMAILS`)

| Метод | URL | |
|---|---|---|
| GET | `/admin/stats` | Счётчики таблиц |
| GET | `/admin/users?limit&offset` | Пользователи |
| DELETE | `/admin/users/:id` | Удалить пользователя с его данными |
| GET | `/admin/ads?limit&offset&status` | Объявления с фильтром статуса |
| GET | `/admin/ads/:id` | Объявление с фото и контактами автора |
| PATCH | `/admin/ads/:id/status` | `{ status: approved / rejected / pending / archived, note? }` — автору уведомление при публикации и отклонении (с причиной) |
| DELETE | `/admin/ads/:id?reason=` | Удалить объявление, автору — уведомление с причиной |
| GET | `/admin/reviews` | Последние 200 отзывов |
| DELETE | `/admin/reviews/:id` | Удалить отзыв, пересчитать рейтинг |
| GET, PATCH | `/admin/moderation` | Автопубликация вкл/выкл (`Setting['moderation.autoApprove']`) |
| POST | `/admin/wipe?confirm=WIPE_ALL` | Стереть всех пользователей и объявления |

## Rate-limit

`AppThrottlerGuard` (ключ — `userId` из access-токена, для гостей `CF-Connecting-IP`): глобально 300 запросов/мин, 5000/час, 50 000/сутки. Строгие лимиты — точечные, на эндпоинтах из таблиц выше. Счётчики в памяти процесса.

## Деплой на Amvera

Push в `main` → Amvera: `npm install` → `prisma generate` (prebuild) → `npm run build`. Запуск — `npm run start:migrate:prod`, то есть `prisma db push --skip-generate && node dist/main`.

`db push` сам применяет добавления (таблицы, колонки, индексы). Если изменение схемы удаляет данные (удалить или переименовать колонку, сменить тип, добавить unique на колонку с дублями), он останавливается с ошибкой, и API не стартует. Такое изменение нужно выкатывать вручную: сначала перенести данные, потом менять схему.

Переход на `prisma migrate deploy` отложен: 21.09 он падал на Amvera CNPG с `permission denied to create database`, а проверить его вне прода пока негде.

Переменные окружения — в `.env.example` (полный список с комментариями) и в Amvera → Настройки → Переменные.
