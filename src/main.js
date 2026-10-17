import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { gltfLoader, enableShadows } from './loader.js';
import { Player } from './player.js';
import { ModelViewer } from './viewer.js';
import { World } from './world.js';
import { LEVELS } from './levels.js';
import { updateStats } from './stats.js';

const WORLD_SIZE = 40; // сторона поляны, м
const loadingEl = document.getElementById('loading');
const creditEl = document.getElementById('credit');

// --- Рендерер, сцена, камера ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa8d0ff);
scene.fog = new THREE.Fog(0xa8d0ff, 25, 60);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 3, 6);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 2;
controls.maxDistance = 25;
controls.maxPolarAngle = Math.PI * 0.48; // не опускать камеру под землю

// --- Свет ---
scene.add(new THREE.HemisphereLight(0xffffff, 0x7a6a50, 1.6));

const sun = new THREE.DirectionalLight(0xffffff, 2.5);
sun.position.set(8, 15, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15 });
scene.add(sun, sun.target);

// --- Поляна: земля и простые декорации ---
const meadow = new THREE.Group();
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE),
  new THREE.MeshStandardMaterial({ color: 0x7fbf6a }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
const grid = new THREE.GridHelper(WORLD_SIZE, WORLD_SIZE, 0x000000, 0x000000);
grid.material.opacity = 0.08;
grid.material.transparent = true;
meadow.add(ground, grid, createScenery());
scene.add(meadow);

const meadowBounds = new THREE.Box3(
  new THREE.Vector3(-WORLD_SIZE / 2 + 1, -10, -WORLD_SIZE / 2 + 1),
  new THREE.Vector3(WORLD_SIZE / 2 - 1, 50, WORLD_SIZE / 2 - 1),
);

// --- Персонаж, столкновения, просмотрщик своих моделей ---
const world = new World();
world.setColliders([meadow], meadowBounds);

let player = null;
const viewer = new ModelViewer(scene, () => player?.model.position ?? new THREE.Vector3());

// Модель: RobotExpressive by Tomás Laulhé (Quaternius), CC0
gltfLoader.load(
  '/models/RobotExpressive.glb',
  (gltf) => {
    // В файле робот ~4,8 м ростом. Приводим к 1,8 м — скорости и камера рассчитаны на рост человека.
    // Свои модели лучше сразу делать в метрах в Blender, тогда это не понадобится.
    const height = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3()).y;
    gltf.scene.scale.setScalar(1.8 / height);
    enableShadows(gltf.scene);
    scene.add(gltf.scene);
    player = new Player(gltf, camera, world);
    loadingEl.hidden = true;

    const start = new URLSearchParams(location.search).get('level');
    if (LEVELS[start]) {
      levelSelect.value = start;
      loadLevel(start);
    }
  },
  undefined,
  (err) => {
    console.error(err);
    loadingEl.textContent = 'Ошибка загрузки модели — см. консоль';
  },
);

// --- Уровни ---
const levelSelect = document.getElementById('level');
for (const [key, level] of Object.entries(LEVELS)) {
  levelSelect.add(new Option(level.title, key));
}
levelSelect.addEventListener('change', () => {
  levelSelect.blur(); // чтобы стрелки снова управляли персонажем
  loadLevel(levelSelect.value);
});

let level = null; // { root, mixer }
let loadId = 0;

function loadLevel(key) {
  const def = LEVELS[key];
  const id = ++loadId;
  unloadLevel();

  if (!def.url) {
    showLevel(def, null);
    return;
  }

  loadingEl.hidden = false;
  loadingEl.textContent = 'Загрузка сцены…';
  const t0 = performance.now();

  gltfLoader.load(
    def.url,
    (gltf) => {
      if (id !== loadId) return; // пока грузилось, выбрали другой уровень
      const seconds = ((performance.now() - t0) / 1000).toFixed(1);
      showLevel(def, gltf);
      loadingEl.hidden = true;
      console.log(`Уровень «${key}» загружен за ${seconds} с`);
    },
    (e) => {
      if (id !== loadId) return;
      const mb = (e.loaded / 1024 / 1024).toFixed(1);
      const pct = e.total ? ` (${Math.round((e.loaded / e.total) * 100)}%)` : '';
      loadingEl.textContent = `Загрузка сцены: ${mb} МБ${pct}`;
    },
    (err) => {
      if (id !== loadId) return;
      console.error(err);
      loadingEl.innerHTML =
        'Сцена не найдена. Сначала скачайте её командой<br><code>npm run models</code>';
      showLevel(LEVELS.meadow, null);
      levelSelect.value = 'meadow';
    },
  );
}

function showLevel(def, gltf) {
  meadow.visible = def.meadow !== false;
  creditEl.textContent = def.credit ?? '';
  const colliders = meadow.visible ? [meadow] : [];

  if (gltf) {
    const root = gltf.scene;
    enableShadows(root);

    // Вписываем диораму в заданный размер и ставим на землю
    if (def.fit) {
      const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
      root.scale.setScalar(def.fit / Math.max(size.x, size.z));
      const box = new THREE.Box3().setFromObject(root);
      const center = box.getCenter(new THREE.Vector3());
      root.position.set(def.at[0] - center.x, def.at[1] - box.min.y, def.at[2] - center.z);
    }
    scene.add(root);
    colliders.push(root);

    let mixer = null;
    if (gltf.animations.length) {
      mixer = new THREE.AnimationMixer(root);
      for (const clip of gltf.animations) mixer.clipAction(clip).play();
    }
    level = { root, mixer };
  }

  const bounds = level && !meadow.visible
    ? new THREE.Box3().setFromObject(level.root).expandByScalar(-0.5)
    : meadowBounds;
  world.setColliders(colliders, bounds);

  // Ставим персонажа на точку старта и разворачиваем камеру
  const spawn = def.spawn ?? [0, 0, 0];
  player.model.position.set(...spawn);
  player.model.rotation.set(0, Math.PI, 0);
  world.move(player.model.position, new THREE.Vector3()); // встать на пол
  const [cx, cy, cz] = def.camera ?? [0, 3, 6];
  controls.target.copy(player.model.position).y += 1.2;
  camera.position.copy(controls.target).add(new THREE.Vector3(cx, cy, cz));
}

// Удаляем уровень и освобождаем память видеокарты
function unloadLevel() {
  if (!level) return;
  scene.remove(level.root);
  level.mixer?.stopAllAction();
  level.root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.disposeBoundsTree?.();
    o.geometry.dispose();
    for (const m of [o.material].flat()) {
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
      m.dispose();
    }
  });
  level = null;
}

// --- Игровой цикл ---
const clock = new THREE.Clock();
const followOffset = new THREE.Vector3();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t0 = performance.now();

  if (player) {
    // Камера едет за персонажем, сохраняя угол, выбранный мышью
    const pos = player.model.position;
    followOffset.copy(camera.position).sub(controls.target);
    player.update(dt);
    controls.target.set(pos.x, pos.y + 1.2, pos.z);
    camera.position.copy(controls.target).add(followOffset);

    // Тень «следует» за игроком, чтобы хватило shadow map
    sun.position.set(pos.x + 8, pos.y + 15, pos.z + 6);
    sun.target.position.copy(pos);
  }
  level?.mixer?.update(dt);
  viewer.update(dt);

  controls.update();
  renderer.render(scene, camera);
  updateStats(renderer, dt, performance.now() - t0);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Деревья и камни из примитивов — замените на свои модели из Blender
function createScenery() {
  const group = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });
  const leavesMat = new THREE.MeshStandardMaterial({ color: 0x2f8f3a, flatShading: true });
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, flatShading: true });
  const trunkGeo = new THREE.CylinderGeometry(0.15, 0.2, 1.2, 6);
  const leavesGeo = new THREE.ConeGeometry(0.9, 2, 7);
  const rockGeo = new THREE.DodecahedronGeometry(0.5);

  // Детерминированный «рандом», чтобы сцена всегда выглядела одинаково
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  for (let i = 0; i < 40; i++) {
    const x = (rand() - 0.5) * (WORLD_SIZE - 4);
    const z = (rand() - 0.5) * (WORLD_SIZE - 4);
    if (Math.hypot(x, z) < 6) continue; // свободное место в центре
    // и место под диораму Littlest Tokyo
    if (Math.abs(x) < 9.5 && z > -19 && z < -1) continue;

    const item = new THREE.Group();
    if (rand() < 0.7) {
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 0.6;
      const leaves = new THREE.Mesh(leavesGeo, leavesMat);
      leaves.position.y = 2;
      item.add(trunk, leaves);
      item.scale.setScalar(0.8 + rand() * 0.8);
    } else {
      const rock = new THREE.Mesh(rockGeo, rockMat);
      rock.position.y = 0.25;
      rock.scale.set(1 + rand(), 0.6 + rand() * 0.6, 1 + rand());
      item.add(rock);
    }
    item.position.set(x, 0, z);
    item.rotation.y = rand() * Math.PI * 2;
    enableShadows(item);
    group.add(item);
  }
  return group;
}
