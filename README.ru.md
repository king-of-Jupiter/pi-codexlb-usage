# pi-codexlb-usage

*[English version](README.md)*

Расширение для [pi](https://github.com/badlogic/pi-mono) / [oh-my-pi](https://github.com/can1357/oh-my-pi):
полоса usage-лимитов из [codex-lb](https://github.com/Soju06/codex-lb) — виджет под редактором,
как в [usage-limit-tracker](https://github.com/mattstrayer/usage-limit-tracker),
но данные берутся с вашего балансировщика, как в
[paseocodexlbusage](https://github.com/king-of-Jupiter/paseocodexlbusage).

Одна строка — один балансировщик: окна `5h` / `7d` из `limits[]` usage-эндпоинта.
Цвет — **риск**, а не сырой процент (та же risk-модель, что в оригинале):

- `│` — сколько окна уже прошло. Заливка левее тика = идёте в темпе.
- `●` спокойно / в темпе, `▲` предупреждение / горячо.
- Палитра по умолчанию приглушённая (`sage → amber → dusty red`), есть `vivid` и `pastel`.

## Установка

**oh-my-pi**

```sh
omp install git:github.com/king-of-Jupiter/pi-codexlb-usage
```

(В npm-реестре пакета нет — ставится напрямую с GitHub. Поэтому же не сработает
`omp install npm:pi-codexlb-usage`.)

Без `bun` в PATH: склонируйте репозиторий и выполните
`omp plugin link ./pi-codexlb-usage`.

**pi**

```sh
pi install git:github.com/king-of-Jupiter/pi-codexlb-usage
```

Или скопируйте `index.ts` + `src/` + `hooks/` в
`~/.pi/agent/extensions/pi-codexlb-usage/` (pi) или
`~/.omp/agent/extensions/pi-codexlb-usage/` (omp).

Зависимостей нет. Нужен Node 22+ (хост выполняет TypeScript напрямую).

Не ставьте одновременно с оригинальным `usage-limit-tracker`: оба регистрируют
команду `/limits` и виджет `usage-limits`.

## Настройка

Самый удобный способ — командами прямо в чате (сохраняется в
`~/.config/pi-codexlb-usage/config.json` с правами `0600`, токен никуда не светится):

```
/limits set-url https://codexlb.example.com/v1/usage
/limits set-token <bearer-token>
/limits config    # показать файл, источник каждого поля, токен маскирован
```

Голый хост тоже можно — `/limits set-url codexlb.example.com`
сохранит `https://codexlb.example.com/v1/usage`, а неполный путь
дополнится (`…/v1` → `…/v1/usage`). Полные URL с собственным
путём используются как есть. Токеном должен быть **API-ключ** codex-lb
(дашборд → API keys), а не пароль от дашборда.

Переменные окружения тоже работают и побеждают файл попольно
(удобно для разовых запусков и CI):

```sh
export CODEXLB_URL="https://example.com/api/usage"
export CODEXLB_TOKEN="<bearer-token>"
```

| Переменная | Назначение | По умолчанию |
|---|---|---|
| `CODEXLB_URL` (`CODEXLB_USAGE_URL`) | Usage-эндпоинт балансировщика | — (берётся из файла) |
| `CODEXLB_TOKEN` (`CODEXLB_BEARER_TOKEN`) | Bearer-токен (`Authorization: Bearer …`) | — (берётся из файла) |
| `CODEXLB_LABEL` | Подпись строки в виджете | `CodexLB` |
| `CODEXLB_CONFIG` | Свой путь к config.json (для тестов/профилей) | `~/.config/…` (`$XDG_CONFIG_HOME` учитывается) |
| `CODEXLB_POLL_MS` | Интервал опроса (минимум 60 000) | `300000` (5 мин) |
| `USAGE_LIMITS_HIDDEN=1` | Старт со скрытым виджетом | видимый |
| `USAGE_LIMITS_PALETTE=vivid` | Палитра: `muted` / `vivid` / `pastel` | `muted` |
| `CODEXLB_DEBUG=1` | Отладочные логи в stderr (без токена) | выкл. |

Без настроек при старте сессии один раз показывается подсказка
с нужными командами. Штатного хранилища настроек у расширений pi/omp нет,
поэтому плагин ведёт собственный файл — root-лишнего не требует,
секреты в истории шелла не остаются (в отличие от `export`).

## Откуда цифры

Плагин опрашивает ваш codex-lb и разбирает `limits[]`
(при пустом — `upstream_limits[]`):

| `limit_window` | Окно виджета |
|---|---|
| `5h` | `5h` (18000 с) |
| `7d` | `7d` (604800 с) |
| остальное (`90m`, `credits`, …) | как есть |

- `used = current_value / max_value`, запасной вариант — `max_value - remaining_value`.
- Сброс — из `reset_at`. Без времени сброса — обычный пороговый бар без обратного отсчёта.
- `model_filter` даёт суффикс: `5h·opus`, `7d·codex-mini`.
- Как и во встроенных источниках, бар показывает **потраченную** долю
  (`current_value`), а дашборд codex-lb — **оставшуюся**; в сумме 100%.

Дополнительно ничего не подхватывается: без настроенного эндпоинта
виджет пуст. Опрос — на старте и каждые 5 минут, перерисовка — каждую минуту,
чтобы двигался обратный отсчёт.

## Команды

Команда — `/limits` (как в оригинале; встроенного конфликта с `/usage` нет).

| Команда | Эффект |
|---|---|
| `/limits` | Опросить сейчас и показать текстовую разбивку с источником |
| `/limits status` | Эндпоинт (только хост), лейбл, давность опроса, ошибка — без секретов |
| `/limits config` | Файл настроек, откуда взято каждое поле, маскированный токен |
| `/limits set-url <url>` | Сохранить эндпоинт в файл и опросить (голый хост дополняется `https://` + `/v1/usage`) |
| `/limits set-token <token>` | Сохранить токен в файл (0600) и опросить |
| `/limits toggle` | Скрыть / показать виджет |
| `/limits palette muted\|vivid\|pastel` | Сменить цвета |

## Разработка

```sh
npm test        # node --test, zero deps
npm run demo    # примеры строк
```

Структура:

- `src/smart-color.ts` — risk-модель, палитры (чистая, из оригинала без изменений)
- `src/render.ts` — бары/строки (чистая, без изменений)
- `src/sources/codexlb.ts` — fetch + маппинг `limits[]` (порт `server/usage.ts` из paseocodexlbusage на zero-deps)
- `src/config.ts` — конфиг-файл `~/.config/pi-codexlb-usage/config.json` (0600), env побеждает по́льно
- `src/store.ts` — слияние окон по провайдеру (без изменений)
- `src/extension.ts` — wiring хоста (события, виджет, таймеры, `/limits`)

## Благодарности

- Виджет, risk-раскраска, рендер: [mattstrayer/usage-limit-tracker](https://github.com/mattstrayer/usage-limit-tracker) (MIT).
  Идея risk-цвета — из [TokenEater](https://github.com/AThevon/TokenEater).
- Маппинг codex-lb `limits[]`: [king-of-Jupiter/paseocodexlbusage](https://github.com/king-of-Jupiter/paseocodexlbusage).
- Данные: [Soju06/codex-lb](https://github.com/Soju06/codex-lb).

MIT
