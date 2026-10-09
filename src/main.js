import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { gltfLoader, enableShadows } from './loader.js';
import { Player } from './player.js';
import { ModelViewer } from './viewer.js';

const WORLD_SIZE = 40; // сторона площадки, м

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
Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15 });
scene.add(sun, sun.target);

// --- Окружение: земля и простые декорации ---
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE),
  new THREE.MeshStandardMaterial({ color: 0x7fbf6a }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(WORLD_SIZE, WORLD_SIZE, 0x000000, 0x000000);
grid.material.opacity = 0.08;
grid.material.transparent = true;
scene.add(grid);

addScenery();

// --- Персонаж и просмотрщик своих моделей ---
const viewer = new ModelViewer(scene, () => player?.model.position ?? new THREE.Vector3());
let player = null;

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
    player = new Player(gltf, camera, WORLD_SIZE / 2 - 1);
    document.getElementById('loading').remove();
  },
  undefined,
  (err) => {
    console.error(err);
    document.getElementById('loading').textContent = 'Ошибка загрузки модели — см. консоль';
  },
);

// --- Игровой цикл ---
const clock = new THREE.Clock();
const followOffset = new THREE.Vector3();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);

  if (player) {
    // Камера едет за персонажем, сохраняя угол, выбранный мышью
    const pos = player.model.position;
    followOffset.copy(camera.position).sub(controls.target);
    player.update(dt);
    controls.target.set(pos.x, pos.y + 1.2, pos.z);
    camera.position.copy(controls.target).add(followOffset);

    // Тень «следует» за игроком, чтобы хватило shadow map
    sun.position.set(pos.x + 8, 15, pos.z + 6);
    sun.target.position.copy(pos);
  }
  viewer.update(dt);

  controls.update();
  renderer.render(scene, camera);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Деревья и камни из примитивов — замените на свои модели из Blender
function addScenery() {
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

    const group = new THREE.Group();
    if (rand() < 0.7) {
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 0.6;
      const leaves = new THREE.Mesh(leavesGeo, leavesMat);
      leaves.position.y = 2;
      group.add(trunk, leaves);
      group.scale.setScalar(0.8 + rand() * 0.8);
    } else {
      const rock = new THREE.Mesh(rockGeo, rockMat);
      rock.position.y = 0.25;
      rock.scale.set(1 + rand(), 0.6 + rand() * 0.6, 1 + rand());
      group.add(rock);
    }
    group.position.set(x, 0, z);
    group.rotation.y = rand() * Math.PI * 2;
    enableShadows(group);
    scene.add(group);
  }
}
