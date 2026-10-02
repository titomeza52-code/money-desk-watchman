import * as THREE from "three";
import type { WeaponId } from "./Player";
import type { AudioBus } from "./Audio";

export interface Projectile {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  damage: number;
  kind: "bullet" | "plasma" | "grenade";
  radius: number;
}

export interface Enemy {
  group: THREE.Group;
  type: "grunt" | "elite";
  hp: number;
  maxHp: number;
  speed: number;
  fireCooldown: number;
  hitFlash: number;
  alive: boolean;
  radius: number;
}

export function createEnemy(type: "grunt" | "elite", position: THREE.Vector3): Enemy {
  const group = new THREE.Group();
  group.position.copy(position);

  if (type === "grunt") {
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xc45c28, roughness: 0.7 }),
    );
    body.position.y = 0.55;
    body.castShadow = true;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0xe8a060 }),
    );
    head.position.set(0, 1.05, 0.1);
    const mask = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.18, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.5 }),
    );
    mask.position.set(0, 1.05, 0.32);
    group.add(body, head, mask);
    return {
      group,
      type,
      hp: 40,
      maxHp: 40,
      speed: 3.4,
      fireCooldown: 2.2 + Math.random(),
      hitFlash: 0,
      alive: true,
      radius: 0.55,
    };
  }

  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.4, 0.7, 6, 10),
    new THREE.MeshStandardMaterial({
      color: 0x2a6b4a,
      metalness: 0.55,
      roughness: 0.35,
      emissive: 0x0a2018,
    }),
  );
  torso.position.y = 1.1;
  torso.castShadow = true;
  const helm = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.4, 0.55),
    new THREE.MeshStandardMaterial({
      color: 0x1e4a38,
      metalness: 0.7,
      roughness: 0.25,
      emissive: 0x2ecc9a,
      emissiveIntensity: 0.15,
    }),
  );
  helm.position.y = 1.85;
  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.7, 0.18),
    new THREE.MeshStandardMaterial({ color: 0x245a42, metalness: 0.5 }),
  );
  arm.position.set(0.55, 1.2, 0);
  group.add(torso, helm, arm);
  return {
    group,
    type,
    hp: 120,
    maxHp: 120,
    speed: 4.2,
    fireCooldown: 2.5 + Math.random() * 0.8,
    hitFlash: 0,
    alive: true,
    radius: 0.65,
  };
}

export function spawnProjectile(
  scene: THREE.Scene,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  kind: WeaponId | "grenade",
): Projectile {
  let mesh: THREE.Mesh;
  let speed: number;
  let damage: number;
  let life: number;
  let radius: number;
  let projKind: Projectile["kind"];

  if (kind === "br") {
    mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe08a }),
    );
    speed = 95;
    damage = 18;
    life = 1.2;
    radius = 0.08;
    projKind = "bullet";
  } else if (kind === "plasma") {
    mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x5ec8ff }),
    );
    speed = 42;
    damage = 28;
    life = 1.8;
    radius = 0.18;
    projKind = "plasma";
  } else {
    mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a4a32, metalness: 0.4, roughness: 0.5 }),
    );
    speed = 22;
    damage = 90;
    life = 3.5;
    radius = 0.2;
    projKind = "grenade";
  }

  mesh.position.copy(origin);
  scene.add(mesh);
  return {
    mesh,
    velocity: dir.clone().normalize().multiplyScalar(speed),
    life,
    damage,
    kind: projKind,
    radius,
  };
}

export function makeExplosion(scene: THREE.Scene, pos: THREE.Vector3, color = 0xff8844) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 12, 12),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }),
  );
  mesh.position.copy(pos);
  scene.add(mesh);
  return { mesh, age: 0, maxAge: 0.35 };
}

export function damageEnemy(enemy: Enemy, amount: number, audio: AudioBus) {
  if (!enemy.alive) return false;
  enemy.hp -= amount;
  enemy.hitFlash = 0.12;
  if (enemy.hp <= 0) {
    enemy.alive = false;
    audio.enemyDie();
    return true;
  }
  return false;
}
