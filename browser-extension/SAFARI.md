# «В Хочу» — Safari Web Extension

В этой папке лежит полный исходник Web Extension: `manifest.json`, фоновый worker, DOM-экстрактор, настройки и иконка. Он рассчитан на Safari 15+ и Chrome с Manifest V3.

## Быстрая проверка на Mac без Xcode

1. Safari → Настройки → Дополнения → включи инструменты разработчика.
2. Safari → Настройки → Разработчик → **Add Temporary Extension…**.
3. Выбери эту папку или ZIP с её содержимым.
4. Разреши расширению доступ к текущему сайту, открой товар и нажми «В Хочу».

Временное расширение Safari удаляет после выхода или через 24 часа.

## Создать Xcode-проект для iPhone, iPad и Mac

На Mac с актуальным Xcode выполни из этой папки:

```bash
chmod +x BUILD_SAFARI_XCODE.command
./BUILD_SAFARI_XCODE.command
```

Или напрямую:

```bash
xcrun safari-web-extension-packager . \
  --project-location ../Safari-Xcode \
  --app-name "В Хочу" \
  --bundle-identifier "ua.ivan.hochu.webextension" \
  --swift \
  --copy-resources
```

В Xcode выбери iOS-схему и Simulator либо подключённый iPhone/iPad, затем Product → Run. После установки включи расширение: Настройки iPhone/iPad → Приложения → Safari → Расширения → «В Хочу».

Для запуска на физическом iPhone/iPad требуется членство Apple Developer Program. В Simulator и временно в Safari на Mac исходник можно проверить без него.

## Упаковать без Mac и Xcode

1. Создай приложение iOS/macOS в App Store Connect.
2. Открой Xcode Cloud → Safari Web Extension Packager → Upload.
3. Загрузи ZIP, в корне которого лежит `manifest.json`.
4. После сборки установи через TestFlight либо отправь в App Store.

Подписанный iOS/macOS-контейнер создаёт Apple/Xcode под твоим Bundle ID и Developer Team. Исходный ZIP специально не содержит чужой подписи и сертификатов.
