import * as THREE from 'three';
import { createRandom } from './utils.js';

// Low-poly дерево: шестигранный ствол и крона из «помятых» икосаэдров.
// Другой seed даёт другое дерево с теми же пропорциями.
export function createTree({ seed = 7, height = 1.4 } = {}) {
  const random = createRandom(seed);
  const tree = new THREE.Group();
  tree.name = 'Tree';

  const bark = new THREE.MeshStandardMaterial({ color: 0x7b5034, roughness: 0.95, flatShading: true });
  const leaves = new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true });
  leaves.color.setHSL(0.27 + (random() - 0.5) * 0.06, 0.5, 0.36 + (random() - 0.5) * 0.08);

  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.17, height, 6), bark);
  trunk.position.y = height / 2;
  tree.add(trunk);

  const crown = new THREE.Group();
  crown.position.y = height * 0.85;
  tree.add(crown);

  // [x, y, z, радиус] шаров кроны
  const blobs = [
    [0, 0.45, 0, 0.62],
    [-0.38, 0.2, 0.12, 0.42],
    [0.36, 0.25, -0.1, 0.46],
    [0.04, 0.95, 0.04, 0.4],
  ];
  for (const [x, y, z, r] of blobs) {
    const blob = new THREE.Mesh(crumple(new THREE.IcosahedronGeometry(r, 1), r * 0.18, random), leaves);
    blob.position.set(x, y, z);
    blob.rotation.set(random() * Math.PI, random() * Math.PI, 0);
    crown.add(blob);
  }

  // Ветер: крона покачивается вокруг верхушки ствола
  const phase = random() * Math.PI * 2;
  tree.userData.update = (time) => {
    crown.rotation.z = Math.sin(time * 1.4 + phase) * 0.05;
    crown.rotation.x = Math.sin(time * 1.1 + phase) * 0.03;
  };

  return tree;
}

// Сдвигает каждую вершину на случайный вектор. Совпадающие вершины соседних граней
// получают одинаковый сдвиг, иначе в поверхности появятся щели.
function crumple(geometry, amount, random) {
  const position = geometry.attributes.position;
  const offsets = new Map();
  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    const key = `${Math.round(v.x * 1e4)},${Math.round(v.y * 1e4)},${Math.round(v.z * 1e4)}`;
    if (!offsets.has(key)) {
      offsets.set(key, new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).multiplyScalar(amount * 2));
    }
    v.add(offsets.get(key));
    position.setXYZ(i, v.x, v.y, v.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}
