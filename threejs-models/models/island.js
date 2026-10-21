import * as THREE from 'three';
import { createTree } from './tree.js';
import { createRandom } from './utils.js';

// Остров на собственной BufferGeometry: сетка вершин, высота из функции рельефа,
// цвет каждой грани зависит от её высоты.
export function createIsland({ seed = 4, size = 4, segments = 56 } = {}) {
  const random = createRandom(seed);
  const heightAt = createHeightField(random, size);
  const island = new THREE.Group();
  island.name = 'Island';

  // 1. Вершины: регулярная сетка (segments + 1) × (segments + 1) в плоскости XZ
  const positions = [];
  const step = size / segments;
  for (let row = 0; row <= segments; row++) {
    for (let col = 0; col <= segments; col++) {
      const x = -size / 2 + col * step;
      const z = -size / 2 + row * step;
      positions.push(x, heightAt(x, z), z);
    }
  }

  // 2. Индексы: каждая клетка сетки — два треугольника
  const indices = [];
  for (let row = 0; row < segments; row++) {
    for (let col = 0; col < segments; col++) {
      const a = row * (segments + 1) + col;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  indexed.setIndex(indices);

  // 3. Разворачиваем индексы, чтобы у каждой грани были свои вершины и свой цвет
  const terrain = indexed.toNonIndexed();
  indexed.dispose();
  const position = terrain.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i += 3) {
    const h = (position.getY(i) + position.getY(i + 1) + position.getY(i + 2)) / 3;
    color.set(terrainColor(h)).offsetHSL(0, 0, (random() - 0.5) * 0.04);
    for (let k = 0; k < 3; k++) color.toArray(colors, (i + k) * 3);
  }
  terrain.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrain.computeVertexNormals();
  island.add(
    new THREE.Mesh(terrain, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true })),
  );

  // Вода — полупрозрачный блок, грунт — плита под ним: получается диорама
  const waterDepth = 0.36;
  const water = new THREE.Mesh(
    new THREE.BoxGeometry(size, waterDepth, size),
    new THREE.MeshStandardMaterial({ color: 0x2f8fbf, transparent: true, opacity: 0.72, roughness: 0.15 }),
  );
  water.position.y = -waterDepth / 2;
  island.add(water);
  const soil = new THREE.Mesh(
    new THREE.BoxGeometry(size, 0.12, size),
    new THREE.MeshStandardMaterial({ color: 0x4a3b2c, roughness: 1 }),
  );
  soil.position.y = -waterDepth - 0.06;
  island.add(soil);

  // Деревья — та же модель из tree.js, только с разными seed
  const trees = [];
  for (let attempt = 0; attempt < 400 && trees.length < 14; attempt++) {
    const x = (random() - 0.5) * size * 0.8;
    const z = (random() - 0.5) * size * 0.8;
    const y = heightAt(x, z);
    if (y < 0.12 || y > 0.6) continue;
    if (trees.some((t) => Math.hypot(t.position.x - x, t.position.z - z) < 0.35)) continue;
    const tree = createTree({ seed: Math.floor(random() * 1e6), height: 1.1 });
    tree.scale.setScalar(0.2 + random() * 0.08);
    tree.position.set(x, y - 0.02, z);
    island.add(tree);
    trees.push(tree);
  }

  island.userData.update = (time) => {
    water.position.y = -waterDepth / 2 + Math.sin(time * 0.8) * 0.01;
    for (const tree of trees) tree.userData.update(time);
  };

  return island;
}

// Рельеф: несколько синусоид со случайными направлениями, гора и спад к краям.
// Ниже нуля — под водой.
function createHeightField(random, size) {
  const waves = Array.from({ length: 5 }, (_, i) => ({
    fx: (random() * 2 - 1) * (1.2 + i),
    fz: (random() * 2 - 1) * (1.2 + i),
    phase: random() * Math.PI * 2,
    amp: 0.22 / (i + 1),
  }));
  const peak = { x: (random() - 0.5) * size * 0.25, z: (random() - 0.5) * size * 0.25 };
  return (x, z) => {
    const r = Math.hypot(x, z) / (size / 2); // 0 в центре, 1 на краю
    const falloff = 1 - THREE.MathUtils.smoothstep(r, 0.4, 1.05);
    let noise = 0;
    for (const w of waves) noise += Math.sin(x * w.fx + z * w.fz + w.phase) * w.amp;
    const mountain = Math.exp(-((x - peak.x) ** 2 + (z - peak.z) ** 2) / 0.35) * 1.1;
    return falloff * (0.45 + noise + mountain) - 0.3;
  };
}

function terrainColor(h) {
  if (h < -0.12) return 0xb9a676; // дно
  if (h < 0.06) return 0xdcc68f; // песок
  if (h < 0.45) return 0x72aa4c; // трава
  if (h < 0.75) return 0x4d863a; // лес
  if (h < 1.05) return 0x8b857a; // скалы
  return 0xf3f5f7; // снег
}
