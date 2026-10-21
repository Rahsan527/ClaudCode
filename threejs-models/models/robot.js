import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Робот: руки, ноги и голова висят на группах-шарнирах.
// Анимация поворачивает только шарниры, детали двигаются вместе с ними.
export function createRobot() {
  const robot = new THREE.Group();
  robot.name = 'Robot';

  const shell = new THREE.MeshStandardMaterial({ color: 0x9cb8c9, roughness: 0.4, metalness: 0.45 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2c343d, roughness: 0.6, metalness: 0.5 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xf28c28, roughness: 0.5, metalness: 0.2 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x9ff8ff, emissive: 0x38e1ff, emissiveIntensity: 1.2 });
  const beacon = glow.clone();

  const rounded = (w, h, d, material, radius = 0.06) =>
    new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, radius), material);
  const place = (mesh, parent, x, y, z) => {
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };

  // Ноги: шарнир в бедре, сама нога и стопа ниже него
  const makeLeg = (x) => {
    const hip = place(new THREE.Group(), robot, x, 0.9, 0);
    place(rounded(0.24, 0.72, 0.26, shell), hip, 0, -0.38, 0);
    place(rounded(0.3, 0.14, 0.42, dark, 0.04), hip, 0, -0.8, 0.06);
    return hip;
  };
  const legL = makeLeg(-0.2);
  const legR = makeLeg(0.2);

  // Корпус в отдельной группе, чтобы он мог подпрыгивать при шаге
  const body = place(new THREE.Group(), robot, 0, 0, 0);
  place(rounded(0.62, 0.2, 0.36, dark), body, 0, 0.95, 0);
  place(rounded(0.84, 0.72, 0.52, shell, 0.1), body, 0, 1.42, 0);
  place(rounded(0.86, 0.08, 0.54, accent, 0.03), body, 0, 1.14, 0);
  place(rounded(0.42, 0.28, 0.04, dark, 0.02), body, 0, 1.48, 0.26);
  const heart = place(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 24), glow), body, -0.08, 1.48, 0.285);
  heart.rotation.x = Math.PI / 2;
  place(new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), accent), body, 0.09, 1.53, 0.28);
  place(new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), accent), body, 0.09, 1.43, 0.28);

  // Руки: шарнир в плече
  const makeArm = (x) => {
    const shoulder = place(new THREE.Group(), body, x, 1.66, 0);
    place(new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), dark), shoulder, 0, 0, 0);
    place(rounded(0.18, 0.56, 0.2, shell), shoulder, 0, -0.32, 0);
    place(rounded(0.2, 0.16, 0.22, accent, 0.05), shoulder, 0, -0.67, 0);
    return shoulder;
  };
  const armL = makeArm(-0.53);
  const armR = makeArm(0.53);

  // Голова: шарнир в шее
  place(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.12, 12), dark), body, 0, 1.84, 0);
  const head = place(new THREE.Group(), body, 0, 1.88, 0);
  place(rounded(0.64, 0.46, 0.5, shell, 0.1), head, 0, 0.24, 0);
  place(rounded(0.5, 0.2, 0.04, dark, 0.02), head, 0, 0.27, 0.25);
  place(rounded(0.22, 0.05, 0.03, dark, 0.01), head, 0, 0.1, 0.25);
  const eyes = [-0.12, 0.12].map((x) => {
    const eye = place(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.03, 20), glow), head, x, 0.27, 0.275);
    eye.rotation.x = Math.PI / 2;
    return eye;
  });
  for (const x of [-0.34, 0.34]) {
    const ear = place(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 16), accent), head, x, 0.25, 0);
    ear.rotation.z = Math.PI / 2;
  }
  place(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.24, 8), dark), head, 0, 0.58, 0);
  place(new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 10), beacon), head, 0, 0.72, 0);

  robot.userData.update = (time) => {
    const step = Math.sin(time * 3.2);
    legL.rotation.x = step * 0.4;
    legR.rotation.x = -step * 0.4;
    armL.rotation.x = -step * 0.5;
    armR.rotation.x = step * 0.5;
    body.position.y = Math.abs(Math.cos(time * 3.2)) * 0.03;
    head.rotation.y = Math.sin(time * 0.8) * 0.45;
    beacon.emissiveIntensity = Math.sin(time * 5) > 0 ? 2 : 0.3;
    // Моргание раз в три секунды: глаза сплющиваются по вертикали
    const blink = time % 3 > 2.88 ? 0.15 : 1;
    for (const eye of eyes) eye.scale.z = blink;
  };

  return robot;
}
