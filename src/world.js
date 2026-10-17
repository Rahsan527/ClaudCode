// Столкновения персонажа со сценой: стены, колонны и пол.
// three-mesh-bvh строит для каждой геометрии дерево (BVH), поэтому луч
// по сцене в сотни тысяч треугольников стоит доли миллисекунды.
import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const RADIUS = 0.35; // «толщина» персонажа
const STEP = 0.45; // на какую высоту можно шагнуть (ступенька)
const PROBE_HEIGHTS = [0.5, 1.3]; // лучи на уровне колен и груди

const AXES = { x: new THREE.Vector3(1, 0, 0), z: new THREE.Vector3(0, 0, 1) };
const DOWN = new THREE.Vector3(0, -1, 0);

export class World {
  constructor() {
    this.colliders = [];
    this.bounds = new THREE.Box3();
    this.raycaster = new THREE.Raycaster();
    this.raycaster.firstHitOnly = true;
    this.origin = new THREE.Vector3();
    this.dir = new THREE.Vector3();
  }

  // roots — объекты, о которые можно споткнуться; bounds — границы карты
  setColliders(roots, bounds) {
    this.colliders = [];
    for (const root of roots) {
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        // Анимированные меши и полупрозрачные листья/решётки не мешают ходить
        if (!o.isMesh || o.isSkinnedMesh) return;
        const m = o.material;
        if (m.transparent || m.alphaTest > 0) return;
        o.geometry.boundsTree ??= o.geometry.computeBoundsTree();
        this.colliders.push(o);
      });
    }
    this.bounds.copy(bounds);
  }

  cast(origin, dir, far) {
    this.raycaster.set(origin, dir);
    this.raycaster.far = far;
    return this.raycaster.intersectObjects(this.colliders, false)[0];
  }

  // Двигает pos на delta с учётом стен (скольжение вдоль них) и высоты пола
  move(pos, delta) {
    for (const axis of ['x', 'z']) {
      const d = delta[axis];
      if (!d) continue;
      this.dir.copy(AXES[axis]).multiplyScalar(Math.sign(d));
      const blocked = PROBE_HEIGHTS.some((h) =>
        this.cast(this.origin.set(pos.x, pos.y + h, pos.z), this.dir, Math.abs(d) + RADIUS),
      );
      if (!blocked) pos[axis] += d;
    }

    pos.x = THREE.MathUtils.clamp(pos.x, this.bounds.min.x, this.bounds.max.x);
    pos.z = THREE.MathUtils.clamp(pos.z, this.bounds.min.z, this.bounds.max.z);

    // Встаём на пол: луч вниз чуть выше колен
    const hit = this.cast(this.origin.set(pos.x, pos.y + STEP + 0.05, pos.z), DOWN, STEP + 5);
    if (hit) pos.y = hit.point.y;
  }
}
