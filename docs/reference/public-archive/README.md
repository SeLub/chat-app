# public-archive — Golden Master легаси-фронта

**Golden master для сверки поведения. Не изменять.**

Снимок прежнего фронтенда (`public/` до миграции на React), сохранён при Фазе F
(TZ «Миграция на React», п. F.3) как эталон для сравнения поведения/верстки.

- Ссылок из `src/app.js` на этот каталог нет (бэкенд отдаёт `webq98/dist` + `public/vad-assets`).
- Файлы не участвуют в сборке и раздаче; предназначены только для чтения/диффа.
- Корневой `ort-wasm-simd-threaded.wasm` — зависимость легаси `script.js`; актуальный
  фронт грузит ORT из `public/vad-assets/` (`vadManager.ts`, `onnxWASMBasePath: '/vad-assets/'`).
