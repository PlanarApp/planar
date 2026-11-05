---
type: reference
status: active
module: cloud-link
updated: 2026-11-05
summary: Связь инстанса Planar с облаком planar-cloud - ENV, setup с одноразовым входом, API состояния триала/оплаты и своего домена, правила блокировки по окончании триала
related: []
---

# cloud-link v1 — инстанс ↔ облако

Копия — в planar-cloud `docs/contracts/cloud-link.md`; правится в обоих репо одним изменением (PLANARAPP-61, PLANARSAAS-7).
Источник истины о триале/оплате — облако; инстанс сам забирает состояние (pull) и хранит последнее полученное у себя.

## ENV инстанса

| Переменная | Кто пишет | Смысл |
|---|---|---|
| `CLOUD_URL` | CLI из `config.json` `cloud_url` | базовый URL cloud-app, без `/` в конце; пусто — инстанс не облачный: таба «Облако», бейджа и блокировки нет |
| `CLOUD_TOKEN` | CLI из env `PLANAR_CLOUD_TOKEN` | секрет инстанса: им инстанс ходит в облако, облако — в инстанс; в облаке хранится открыто (`instances.cloud_token`), как и в `.env` инстанса на том же хосте |

Обе пишутся в `.env` при `instance create`, только если заданы обе; смена домена и upgrade их не трогают.

## Создание инстанса (облако → CLI → инстанс)

cloud-app вызывает `planar-cloud instance create <name> <email>` с env:
`PLANAR_ADMIN_PASSWORD` (≥ 8 символов), `PLANAR_LOGIN_TOKEN` (base64url, 32 байта), `PLANAR_CLOUD_TOKEN` (base64url, 32 байта).
Без `PLANAR_ADMIN_PASSWORD` CLI генерирует пароль и отдаёт его в JSON-ответе `password`.

CLI после `/health` вызывает инстанс (то же делает `instance reset` после очистки, с `PLANAR_ADMIN_PASSWORD`/`PLANAR_LOGIN_TOKEN`):

    POST https://<domain>/api/setup
    X-Setup-Token: <SETUP_TOKEN>
    {"login": "admin", "name": "Admin", "password": "…", "email": "<email>", "loginToken": "…"}

- `email` — необязательный; `loginToken` — необязательный, ≥ 32 символов.
- С `loginToken` инстанс заводит владельцу сессию с id = sha256(loginToken), сроком 10 минут.

Одноразовый вход: `GET https://<domain>/api/auth/handoff?token=<loginToken>` — сессия токена удаляется, ставится новая обычная сессия (cookie), 302 на `/`. Токен неизвестен или просрочен — 302 на `/login`.
Облако после успешного create перенаправляет браузер на этот адрес.

## API облака для инстанса

Авторизация: `Authorization: Bearer <CLOUD_TOKEN>`; инстанс находится по sha256 токена среди неудалённых. Чужой/пустой токен — 401.

`GET {CLOUD_URL}/api/link/state` → `CloudState`:

```ts
interface CloudState {
  status: 'trial' | 'active' | 'expired'; // expired = в облаке stopped (триал кончился / подписка отменена)
  trialEndsAt: string;                    // ISO
  deleteAfter: string | null;             // ISO, когда облако удалит данные (только для expired)
  domain: string;                         // <name>.<base_domain>
  customDomain: string | null;
  serverIp: string | null;                // куда направить A-запись своего домена
  checkout: Record<string, string>;       // провайдер → ссылка на оплату (только настроенные)
  manageUrl: string | null;               // управление подпиской у провайдера
}
```

`POST {CLOUD_URL}/api/link/domain` `{"host": "tasks.example.com" | null}` → `CloudState` после привязки (null — снять).
Ошибка — HTTP 4xx/5xx, `statusMessage` = код: `invalid_host`, `domain_taken`, `dns_missing` (в `data` — IP), `bad_state`, `server_ip_missing`.

`POST {CLOUD_URL}/api/link/reset` `{"confirm": "<name>", "password": "≥ 8"}` → `{"ticket": "…"}`: очистка данных с бэкапом идёт в фоне (она перезапускает сам инстанс). Браузер уходит на `{CLOUD_URL}/reset/<ticket>`: страница опрашивает `GET {CLOUD_URL}/api/reset/<ticket>` → `{state: running|done|failed|unknown, url?}` и при `done` переходит на `url` — одноразовый вход владельцем admin с новым паролем. Ошибки: `confirm_mismatch`, `invalid_input`, `bad_state`, `busy`.

`POST {CLOUD_URL}/api/link/delete` `{"confirm": "<name>"}` → `{"ok": true}`: облако удаляет инстанс (с бэкапом), ответ приходит до остановки контейнера не гарантированно. `confirm` ≠ имя — 400 `confirm_mismatch`. Имя инстанса = первая метка `domain`.

## API инстанса для облака

`POST https://<host>/api/cloud/handoff`, `Authorization: Bearer <CLOUD_TOKEN>` → `{"token": "…"}` — одноразовый вход первого активного владельца на 10 минут (`GET /api/auth/handoff?token=…`). Чужой токен — 401. Облако зовёт его из админки («Войти в инстанс»), `<host>` — свой домен, если привязан, иначе базовый; вход пишется в лог облака (`type: impersonation`).

## Инстанс

- Состояние хранится в `settings` (id `cloud_state`, value = `CloudState` + `fetchedAt`). Обновление: при старте, раз в час, по `POST /api/cloud/refresh`. Облако недоступно — остаётся последнее сохранённое.
- `GET /api/setup` (публичный) отдаёт `cloud: {status, trialEndsAt} | null`.
- `GET /api/cloud` (админ) — сохранённый `CloudState`; `POST /api/cloud/refresh` (админ); `POST /api/cloud/domain` (админ), `POST /api/cloud/delete` и `POST /api/cloud/reset` (владелец; reset отвечает `{url}` страницы ожидания облака) — проксируют в облако.
- Истёк = `status === 'expired'` или (`status === 'trial'` и `trialEndsAt` ≤ сейчас). Пока истёк:
  - вход и любые запросы обычных пользователей — 401/403 `trial_expired`;
  - владелец/админ входит, но доступны только `/api/auth/*`, `/api/setup`, `/api/cloud*`; веб показывает только экран оплаты;
  - WebSocket синхронизации, MCP, collab — закрыты для всех.
- До конца триала ≤ 30 дней: бейдж в тулбаре у всех; владельцам и админам — одно уведомление `trial_ending` (повтор — только после новой даты триала).
