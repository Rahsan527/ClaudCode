# Модели для Three.js

Шесть учебных процедурных моделей, каждая показывает свой приём моделирования кодом, и два корабля в реальном масштабе.

| Модель | Файл | Приём |
| --- | --- | --- |
| Домик | `models/house.js` | примитивы (`BoxGeometry`), `ExtrudeGeometry`, `Group` |
| Дерево | `models/tree.js` | деформация вершин икосаэдра, `flatShading`, seed |
| Ракета | `models/rocket.js` | тела вращения `LatheGeometry`, стабилизаторы через `ExtrudeGeometry` |
| Ваза | `models/vase.js` | `SplineCurve` + `LatheGeometry`, роспись через `CanvasTexture` |
| Робот | `models/robot.js` | иерархия шарниров и анимация, `RoundedBoxGeometry` |
| Остров | `models/island.js` | своя `BufferGeometry`: вершины, индексы, цвета граней |
| Адмирал Кузнецов | `models/kuznetsov.js` | авианосец 305 м: корпус по сечениям, подводная часть, авиагруппа |
| Пётр Великий | `models/orlan.js` | крейсер проекта 1144, 249 м; вооружение задаётся объектом `FIT_PETR_VELIKY` |

## Корабли

Масштаб реальный, в метрах: ось Y вверх, ватерлиния на `y = 0`, нос в сторону +X.
Каждая деталь — отдельный именованный объект (`Hull`, `Hull_Underwater`, `Radar_FregatM`, `Propeller_1`…),
материалы тоже названы. Радары вращаются через `userData.update(time)`, а та же анимация лежит
клипом в `group.animations` и в `.glb` (`RadarRotation` у «Кузнецова», `Radars_Rotate` у «Петра Великого»).

Готовые файлы Blender лежат в `blend/` (сохранены в Blender 5.2, текстуры упакованы внутрь).
Можно и импортировать `.glb` вручную: File → Import → glTF 2.0. Blender сам переведёт оси в Z-up,
анимация появится как Action.

`tools/glb2blend.py` конвертирует любой `.glb` в `.blend` без интерфейса Blender:

```bash
pip install bpy   # Blender как Python-модуль
python tools/glb2blend.py glb/orlan.glb blend/orlan.blend
```

Готовые файлы в формате glTF лежат в `glb/`. Их можно открыть в Blender или загрузить через `GLTFLoader`.

## Просмотр

`index.html` — витрина с вращением, каркасным режимом, числом треугольников, исходным кодом и экспортом в `.glb`.
Модули грузятся через `import`, поэтому страницу нужно открывать через локальный сервер, а не как файл:

```bash
npx serve threejs-models
# или
python3 -m http.server -d threejs-models 8000
```

## Как подключить модель

Каждая модель — функция, которая возвращает `THREE.Group`. Модули импортируют `three` и
`three/addons/...`, как в официальной документации, поэтому нужна import map или сборщик (Vite и т.п.).

```js
import * as THREE from 'three';
import { createRobot } from './models/robot.js';

const robot = createRobot();
scene.add(robot);

// У анимированных моделей в userData.update лежит функция кадра
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  robot.userData.update?.(clock.getElapsedTime());
  renderer.render(scene, camera);
});
```

У некоторых функций есть параметры: `createTree({ seed, height })`, `createRocket({ fins })`,
`createIsland({ seed, size, segments })`, `createOrlan({ fit })`.

Загрузка готового `.glb`:

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const gltf = await new GLTFLoader().loadAsync('glb/house.glb');
scene.add(gltf.scene);
```

`vase.js` рисует текстуру на `<canvas>`, поэтому работает только в браузере.
Проверено на three.js r170.
