import * as THREE from 'three';

// Low-poly домик из стандартных примитивов, собранных в одну группу.
export function createHouse() {
  const house = new THREE.Group();
  house.name = 'House';

  const wall = new THREE.MeshStandardMaterial({ color: 0xf1e4cc, roughness: 0.9 });
  const roof = new THREE.MeshStandardMaterial({ color: 0xb4462f, roughness: 0.75, flatShading: true });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6e4428, roughness: 0.85 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x9c9a91, roughness: 1, flatShading: true });
  const brass = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.3, metalness: 0.8 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0xffe7a3,
    emissive: 0xffb340,
    emissiveIntensity: 0.55,
    roughness: 0.25,
  });

  const W = 2.4; // ширина стен
  const D = 1.9; // глубина стен
  const H = 1.3; // высота стен
  const baseH = 0.2; // фундамент
  const roofH = 1.05; // высота фронтона
  const top = baseH + H; // отметка, где начинается крыша

  const part = (geometry, material, x, y, z, parent = house) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };

  // Фундамент и стены
  part(new THREE.BoxGeometry(W + 0.24, baseH, D + 0.24), stone, 0, baseH / 2, 0);
  part(new THREE.BoxGeometry(W, H, D), wall, 0, baseH + H / 2, 0);

  // Фронтон: треугольный контур, вытянутый на глубину дома
  const gableShape = new THREE.Shape();
  gableShape.moveTo(-W / 2, 0);
  gableShape.lineTo(W / 2, 0);
  gableShape.lineTo(0, roofH);
  const gable = new THREE.ExtrudeGeometry(gableShape, { depth: D, bevelEnabled: false });
  gable.translate(0, 0, -D / 2);
  part(gable, wall, 0, top, 0);

  // Скаты крыши: две плоские коробки, повёрнутые на угол фронтона, со свесом
  const overhang = 0.22;
  const thickness = 0.12;
  const hyp = Math.hypot(W / 2, roofH);
  const angle = Math.atan2(roofH, W / 2);
  const slope = hyp + overhang;
  for (const side of [-1, 1]) {
    const ux = (-side * W) / 2 / hyp; // направление от карниза к коньку
    const uy = roofH / hyp;
    const nx = (side * roofH) / hyp; // нормаль ската наружу
    const ny = W / 2 / hyp;
    const shift = slope / 2 - overhang;
    const slab = part(
      new THREE.BoxGeometry(slope, thickness, D + overhang * 2),
      roof,
      (side * W) / 2 + ux * shift + (nx * thickness) / 2,
      top + uy * shift + (ny * thickness) / 2,
      0,
    );
    slab.rotation.z = -side * angle;
  }
  const ridge = part(new THREE.BoxGeometry(0.17, 0.17, D + overhang * 2 + 0.04), roof, 0, top + roofH + 0.08, 0);
  ridge.rotation.z = Math.PI / 4;

  // Труба стоит на правом скате
  const chimneyX = W / 4;
  part(new THREE.BoxGeometry(0.3, 0.9, 0.3), stone, chimneyX, top + roofH / 2 + 0.2, -D * 0.2);
  part(new THREE.BoxGeometry(0.38, 0.08, 0.38), stone, chimneyX, top + roofH / 2 + 0.67, -D * 0.2);

  // Дверь, ручка и ступенька
  part(new THREE.BoxGeometry(0.52, 0.9, 0.08), wood, -0.55, baseH + 0.45, D / 2 + 0.01);
  part(new THREE.SphereGeometry(0.035, 12, 8), brass, -0.37, baseH + 0.45, D / 2 + 0.07);
  part(new THREE.BoxGeometry(0.75, 0.12, 0.3), stone, -0.55, 0.06, D / 2 + 0.27);

  // Окно: рама, стекло, переплёт и подоконник в одной группе
  const addWindow = (x, y, z, rotationY) => {
    const frame = new THREE.Group();
    frame.position.set(x, y, z);
    frame.rotation.y = rotationY;
    part(new THREE.BoxGeometry(0.56, 0.56, 0.06), wood, 0, 0, 0, frame);
    part(new THREE.BoxGeometry(0.44, 0.44, 0.08), glass, 0, 0, 0, frame);
    part(new THREE.BoxGeometry(0.44, 0.04, 0.1), wood, 0, 0, 0, frame);
    part(new THREE.BoxGeometry(0.04, 0.44, 0.1), wood, 0, 0, 0, frame);
    part(new THREE.BoxGeometry(0.66, 0.06, 0.16), wood, 0, -0.31, 0.04, frame);
    house.add(frame);
  };
  const windowY = baseH + H * 0.55;
  addWindow(0.55, windowY, D / 2, 0);
  addWindow(0.55, windowY, -D / 2, Math.PI);
  addWindow(-0.55, windowY, -D / 2, Math.PI);
  addWindow(W / 2, windowY, 0, Math.PI / 2);
  addWindow(-W / 2, windowY, 0, -Math.PI / 2);

  // Дорожка из плоских камней
  [
    [-0.5, 0.65, 0.17],
    [-0.62, 0.98, 0.15],
    [-0.48, 1.3, 0.16],
  ].forEach(([x, dz, r], i) => {
    const flagstone = part(new THREE.CylinderGeometry(r, r, 0.04, 6), stone, x, 0.02, D / 2 + dz);
    flagstone.rotation.y = i * 0.7;
  });

  return house;
}
