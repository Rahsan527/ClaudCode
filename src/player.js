// Персонаж с анимациями из glTF и управлением с клавиатуры.
import * as THREE from 'three';

const WALK_SPEED = 2.2; // м/с
const RUN_SPEED = 6;
const TURN_SPEED = 10; // скорость поворота к направлению движения
const FADE = 0.25; // длительность плавного перехода между анимациями, с

// Клавиши 1–4 → одноразовые анимации-эмоции
const EMOTES = { Digit1: 'Wave', Digit2: 'Dance', Digit3: 'ThumbsUp', Digit4: 'Punch' };

export class Player {
  constructor(gltf, camera, bounds) {
    this.model = gltf.scene;
    this.camera = camera;
    this.bounds = bounds;
    this.keys = new Set();

    // AnimationMixer проигрывает клипы (Actions из Blender) на этой модели
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const clip of gltf.animations) {
      this.actions[clip.name] = this.mixer.clipAction(clip);
    }

    // Анимации, которые проигрываются один раз, а потом возвращают к ходьбе/покою
    for (const name of [...Object.values(EMOTES), 'Jump', 'WalkJump']) {
      const action = this.actions[name];
      if (!action) continue;
      action.setLoop(THREE.LoopOnce);
      action.clampWhenFinished = true;
    }
    this.mixer.addEventListener('finished', () => {
      this.oneShot = null;
      this.play(this.locomotionState(), FADE);
    });

    this.current = null;
    this.oneShot = null;
    this.play('Idle', 0);

    addEventListener('keydown', (e) => this.onKey(e, true));
    addEventListener('keyup', (e) => this.onKey(e, false));
    addEventListener('blur', () => this.keys.clear());
  }

  onKey(e, down) {
    if (down) this.keys.add(e.code);
    else this.keys.delete(e.code);
    if (!down || e.repeat || this.oneShot) return;

    if (e.code === 'Space') {
      e.preventDefault();
      this.playOnce(this.moveDirection().lengthSq() > 0 ? 'WalkJump' : 'Jump');
    } else if (EMOTES[e.code]) {
      this.playOnce(EMOTES[e.code]);
    }
  }

  // Плавный переход (crossfade) к другой анимации
  play(name, fade = FADE) {
    const next = this.actions[name];
    if (!next || next === this.current) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    this.current?.fadeOut(fade);
    this.current = next;
  }

  playOnce(name) {
    if (!this.actions[name]) return;
    this.oneShot = name;
    this.play(name, 0.15);
  }

  // Направление движения относительно камеры (W — «от камеры»)
  moveDirection() {
    const k = this.keys;
    const x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const z = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
    const dir = new THREE.Vector3(x, 0, z);
    if (dir.lengthSq() === 0) return dir;

    const yaw = Math.atan2(
      this.camera.position.x - this.model.position.x,
      this.camera.position.z - this.model.position.z,
    );
    return dir.normalize().applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
  }

  isRunning() {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  locomotionState() {
    if (this.moveDirection().lengthSq() === 0) return 'Idle';
    return this.isRunning() ? 'Running' : 'Walking';
  }

  update(dt) {
    this.mixer.update(dt);

    // Во время эмоций стоим на месте (прыжок с разбега — исключение)
    if (this.oneShot && this.oneShot !== 'WalkJump') return;

    const dir = this.moveDirection();
    if (!this.oneShot) this.play(this.locomotionState());
    if (dir.lengthSq() === 0) return;

    const speed = this.isRunning() ? RUN_SPEED : WALK_SPEED;
    const pos = this.model.position;
    pos.addScaledVector(dir, speed * dt);
    pos.x = THREE.MathUtils.clamp(pos.x, -this.bounds, this.bounds);
    pos.z = THREE.MathUtils.clamp(pos.z, -this.bounds, this.bounds);

    // Модель смотрит вдоль +Z, поворачиваем её по направлению движения
    const target = new THREE.Quaternion().setFromAxisAngle(
      THREE.Object3D.DEFAULT_UP,
      Math.atan2(dir.x, dir.z),
    );
    this.model.quaternion.rotateTowards(target, TURN_SPEED * dt);
  }
}
