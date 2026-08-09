# Хочу v1.1.8

Личный журнал желаний с мультиаккаунтами и администрированием.

## v1.1.8 — Brand Icon Update

- новая утверждённая иконка используется во всём интерфейсе;
- обновлены favicon, Apple Touch Icon и PWA icons 192/512/1024;
- старый master icon заменён на новую исходную картинку;
- функциональность покупок, аккаунтов и парсеров не изменялась;
- исправление Makeup Image Fix из v1.1.7 сохранено в этой сборке.

## Деплой через GitHub Desktop → Railway

1. Распакуй ZIP прямо в корень локального репозитория.
2. Разреши Finder заменить существующие файлы.
3. В GitHub Desktop проверь Changes.
4. Commit to main → Push origin.
5. Railway автоматически пересоберёт приложение.

## Railway Variables

Обязательные переменные:

- `DATABASE_URL`
- `SESSION_SECRET`
- `ADMIN_NAME`
- `ADMIN_USERNAME`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

Архив предназначен для GitHub Desktop и содержит только актуальные файлы проекта — без исторических `UPDATE_v*.txt`, `.DS_Store`, `__MACOSX` и прочего мусора.
