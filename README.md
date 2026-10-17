# Демо: 3D-модели из Blender в игре на Node.js + Three.js

Маленькая сцена от третьего лица: управляемый персонаж с анимациями из glTF
и просмотрщик, в который можно перетащить свой `.glb` из Blender.

## Запуск

```bash
npm install
npm run models         # скачать и оптимизировать тяжёлые сцены (~56 МБ исходников → 15 МБ)
npm run dev            # разработка: http://localhost:5173 (горячая перезагрузка)

npm run build          # сборка клиента в dist/
npm start              # Node.js (Express) раздаёт игру: http://localhost:3000
```

## Управление

| Клавиша | Действие |
|---|---|
| WASD / стрелки | ходьба |
| Shift | бег |
| Пробел | прыжок |
| 1 / 2 / 3 / 4 | помахать / танец / лайк / удар |
| Мышь, колесо | вращение и зум камеры |

## Тяжёлые сцены (уровни)

В панели слева выберите уровень — персонаж окажется внутри сцены, со столкновениями
со стенами и полом (через [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh)).
Слева внизу — панель производительности: FPS, треугольники и draw calls в кадре.

| Уровень | Сложность | Файл после `npm run models` |
|---|---|---|
| **Sponza** — дворец Crytek | 262 тыс. треугольников, 25 материалов, 69 PBR-текстур | 11,7 МБ (из 52 МБ) |
| **Littlest Tokyo** — анимированный квартал | ~140 тыс. треугольников, анимации | 2,9 МБ (из 4,1 МБ) |

`scripts/fetch-models.mjs` скачивает исходники и прогоняет их через
`gltf-transform optimize` (Meshopt-сжатие геометрии, текстуры в WebP) — тот же
конвейер подойдёт для ваших моделей из Blender. Сцены не хранятся в репозитории:
они большие, а у Sponza своя лицензия. Уровень можно открыть сразу по ссылке:
`http://localhost:5173/?level=sponza`.

## Проверка своей модели

Перетащите `.glb` в окно браузера или нажмите «Открыть .glb…». Модель встанет
рядом с персонажем (рост 1,8 м) **в своём реальном масштабе**, а справа появятся
габариты в метрах, число треугольников, материалов, текстур и список анимаций
с подсказками о типичных ошибках экспорта.

Экспорт из Blender: **File → Export → glTF 2.0**, формат *glTF Binary (.glb)*,
*+Y Up*, перед экспортом примените трансформации (**Ctrl+A → All Transforms**).

Чтобы модель стала частью игры, положите файл в `public/models/` и загрузите его
через `gltfLoader` из `src/loader.js` (см. `src/main.js`).

## Структура

```
server.js           Express-сервер, раздаёт собранную игру из dist/
index.html          страница и интерфейс
src/main.js         сцена, свет, камера, игровой цикл
src/player.js       персонаж: AnimationMixer, переходы анимаций, управление
src/viewer.js       просмотр своих .glb (drag & drop) и статистика модели
src/loader.js       GLTFLoader с поддержкой Draco и Meshopt
src/levels.js       список уровней (тяжёлых сцен)
src/world.js        столкновения со сценой (BVH-лучи)
src/stats.js        панель производительности
scripts/fetch-models.mjs  скачивание и оптимизация сцен
public/models/      модели (.glb)
```

## Модели и лицензии

- Sponza — © Crytek, PBR-текстуры Alexandre Pestana, Cryengine Limited License
  (из [glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets)).
- Littlest Tokyo — Glen Fox, CC BY 4.0 (из примеров three.js).
- `public/models/RobotExpressive.glb` — автор [Tomás Laulhé (Quaternius)](https://quaternius.com),
доработка Don McCurdy, лицензия **CC0 1.0**. Взята из примеров three.js.
