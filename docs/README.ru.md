# Locus

> Локальная постоянная память для AI coding tools. Работает через MCP. Основной фокус сейчас — Codex CLI.

![Locus hero image](assets/social-preview-github.jpg)

[English](../README.md) · [Русский](README.ru.md) · [简体中文](README.zh-CN.md)

## Что это

AI-агент начинает новую сессию почти с нуля: не помнит решения, ошибки, стиль пользователя и то, что делали вчера. Locus добавляет локальную память, которую агент может искать через MCP.

Locus хранит:

- карту проекта: файлы, exports, imports
- важные решения: архитектура, ограничения, предпочтения
- историю Codex-сессий: ошибки, следующие шаги, отвергнутые варианты
- диагностику: что импортировано, что сохранено, какой режим capture включён

Данные остаются локально. По умолчанию Locus не требует облака, аккаунта, внешней базы, embeddings-провайдера или LLM-вызова для записи памяти.

## Установка для Codex

```bash
npx -y locus-memory@latest install codex --yes
```

Перезапустите Codex и проверьте:

```bash
npx -y locus-memory@latest doctor codex
```

Удалить MCP-настройку, но оставить локальные данные памяти:

```bash
npx -y locus-memory@latest uninstall codex --yes
```

Команда установки добавляет MCP-сервер Locus, устанавливает Codex skill, включает практичный `redacted` режим и закрепляет runtime-команду на установленную версию пакета.

## Что нового в v3.7

Track D добавляет надежность памяти для Codex: project-scoped recall, date buckets, `memory_calendar` для вопросов по периодам и `memory_project_state` для текущего состояния проекта.

`memory_recall` также лучше отвечает на вопросы о прошлой работе: "что мы делали вчера?", "почему отказались от варианта X?", "какой у меня стиль?", "что осталось сделать?". Он использует redacted Codex-сессии, durable memories, `memory_remember`, rejected alternatives, validation facts и dated recall.

Если найдено несколько похожих контекстов, Locus возвращает `candidateGroups`, чтобы агент задал уточняющий вопрос, а не выдумывал ответ.

## Почему Locus

| Нужно | Как делает Locus |
| --- | --- |
| Простая установка Codex | `npx -y locus-memory@latest install codex --yes` |
| Локальное хранение | SQLite в `$CODEX_HOME/memory/`, `~/.claude/memory/` или `~/.locus/memory/` |
| Низкая цена по токенам | Запись памяти локальная; токены тратятся только при recall |
| Контроль приватности | `metadata`, `redacted`, `full`; `full` — только осознанный режим |
| Память проекта | Структурный scan + решения + события диалога |
| Прозрачность | `memory_status`, `memory_project_state`, `memory_doctor`, `memory_audit`, `memory_review` |

## Режимы capture

| Режим | Для чего | Что сохраняется |
| --- | --- | --- |
| `metadata` | Максимально безопасная диагностика | Минимум содержимого, слабый recall |
| `redacted` | Практичная память для Codex | Ограниченные фрагменты и ключевые фразы с best-effort redaction |
| `full` | Максимальный recall | Больше текста локально после redaction; не считать безопасным по умолчанию |

Рекомендуемый режим для Codex:

```bash
LOCUS_CODEX_CAPTURE=redacted
LOCUS_CAPTURE_LEVEL=redacted
```

## Сравнение

Locus не пытается быть full agent runtime или облачной memory-платформой. Его ниша — лёгкая локальная память для coding agents, особенно Codex.

| Проект | Сильная сторона | Отличие Locus |
| --- | --- | --- |
| [agentmemory](https://github.com/rohitg00/agentmemory) | Большой memory stack для coding agents | Locus меньше, проще, Codex-first, один npm MCP runtime |
| [AIDE Memory](https://www.aide-memory.dev/) | Path-scoped локальная память | Locus сильнее упирается в MCP tools, Codex JSONL import и диагностику |
| [Mem0](https://github.com/mem0ai/mem0) | Популярный общий memory layer для AI agents | Locus готов к использованию в coding tools через MCP без отдельной app-интеграции |
| [Letta](https://github.com/letta-ai/letta) | Полноценная stateful-agent платформа | Locus не заменяет ваш агент, а подключается к существующему инструменту |
| [Zep / Graphiti](https://github.com/getzep/graphiti) | Temporal knowledge graph и production context infrastructure | Locus легче и локален по умолчанию для индивидуального coding workflow |

Полная таблица: [comparison.md](comparison.md)

## Основные инструменты

- `memory_recall` — краткий ответ по прошлой работе
- `memory_search` — поиск по структуре, решениям и событиям
- `memory_remember` — сохранить важное решение
- `memory_review` — посмотреть, что сохранено и почему
- `memory_import_codex` — импортировать Codex rollout JSONL
- `memory_status` / `memory_doctor` — диагностика
- `memory_audit` — аудит приватности и данных
- `memory_forget` / `memory_purge` — удаление памяти с защитой от случайного стирания

## Статус клиентов

| Клиент | Статус |
| --- | --- |
| Codex CLI | Основной проверенный путь |
| Claude Code | Поддерживается через hooks и shared runtime |
| Codex desktop / extension | Та же MCP-модель, но parity пока не заявляется как полностью проверенный |
| Cursor / Windsurf / Cline / Zed | MCP tools работают; пассивные adapters — будущая задача |

## Разработка

```bash
git clone https://github.com/Magnifico4625/locus.git
cd locus
npm install
npm run check
npm run build
```

Лицензия: MIT.
