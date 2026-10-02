import * as THREE from "three";
import type { Input } from "./Input";
import type { World } from "./World";
import type { AudioBus } from "./Audio";

export type WeaponId = "br" | "plasma";

export interface WeaponState {
  id: WeaponId;
  name: string;
  mag: number;
  magSize: number;
  reserve: number;
  cooldown: number;
  fireInterval: number;
  reloadTime: number;
  reloading: number;
  burstLeft: number;
  burstGap: number;
}

export class Player {
  camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = -0.1;
  velocity = new THREE.Vector3();
  onGround = false;
  height = 1.7;
  radius = 0.4;

  shields = 100;
  maxShields = 100;
  health = 100;
  maxHealth = 100;
  shieldDelay = 0;
  alive = true;

  weapons: WeaponState[] = [
    {
      id: "br",
      name: "BATTLE RIFLE",
      mag: 36,
      magSize: 36,
      reserve: 216,
      cooldown: 0,
      fireInterval: 0.09,
      reloadTime: 1.6,
      reloading: 0,
      burstLeft: 0,
      burstGap: 0,
    },
    {
      id: "plasma",
      name: "PLASMA PISTOL",
      mag: 100,
      magSize: 100,
      reserve: 0,
      cooldown: 0,
      fireInterval: 0.18,
      reloadTime: 1.2,
      reloading: 0,
      burstLeft: 0,
      burstGap: 0,
    },
  ];
  weaponIndex = 0;
  grenades = 2;
  grenadeCooldown = 0;
  meleeCooldown = 0;
  muzzleFlash = 0;

  viewmodel: THREE.Group;
  gunMesh: THREE.Group;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.camera.position.set(0, 4, 18);

    this.viewmodel = new THREE.Group();
    this.gunMesh = this.buildGun("br");
    this.viewmodel.add(this.gunMesh);
    this.camera.add(this.viewmodel);
  }

  get weapon() {
    return this.weapons[this.weaponIndex];
  }

  private buildGun(id: WeaponId) {
    const g = new THREE.Group();
    g.position.set(0.28, -0.28, -0.55);

    if (id === "br") {
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.14, 0.55),
        new THREE.MeshStandardMaterial({ color: 0x3a4238, metalness: 0.5, roughness: 0.4 }),
      );
      const barrel = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.05, 0.35),
        new THREE.MeshStandardMaterial({ color: 0x222822, metalness: 0.6, roughness: 0.3 }),
      );
      barrel.position.set(0, 0.02, -0.4);
      const scope = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.08, 0.14),
        new THREE.MeshStandardMaterial({ color: 0x2ecc9a, emissive: 0x0a3a28 }),
      );
      scope.position.set(0, 0.12, -0.05);
      g.add(body, barrel, scope);
    } else {
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 12, 12),
        new THREE.MeshStandardMaterial({
          color: 0x3a5a88,
          emissive: 0x102848,
          metalness: 0.3,
          roughness: 0.35,
        }),
      );
      const nozzle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.05, 0.2, 8),
        new THREE.MeshStandardMaterial({ color: 0x7ec8ff, emissive: 0x204060 }),
      );
      nozzle.rotation.x = Math.PI / 2;
      nozzle.position.z = -0.18;
      g.add(body, nozzle);
    }
    return g;
  }

  switchWeapon(index: number) {
    if (index === this.weaponIndex || index < 0 || index > 1) return;
    this.weaponIndex = index;
    this.viewmodel.remove(this.gunMesh);
    this.gunMesh = this.buildGun(this.weapon.id);
    this.viewmodel.add(this.gunMesh);
  }

  takeDamage(amount: number, audio: AudioBus) {
    if (!this.alive) return;
    this.shieldDelay = 3.2;
    let remaining = amount;
    if (this.shields > 0) {
      const absorbed = Math.min(this.shields, remaining);
      this.shields -= absorbed;
      remaining -= absorbed;
      if (this.shields <= 0) audio.shieldBreak();
    }
    if (remaining > 0) {
      this.health -= remaining;
      audio.hit();
    }
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
    }
  }

  update(
    dt: number,
    input: Input,
    world: World,
    audio: AudioBus,
    onShoot: (origin: THREE.Vector3, dir: THREE.Vector3, weapon: WeaponId) => void,
    onGrenade: (origin: THREE.Vector3, dir: THREE.Vector3) => void,
    onMelee: () => void,
  ) {
    if (!this.alive) return;

    const { dx, dy } = input.consumeMouseDelta();
    this.yaw -= dx * 0.0022;
    this.pitch -= dy * 0.0022;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.4, 1.4);

    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new THREE.Vector3();
    if (input.pressed("KeyW")) wish.add(forward);
    if (input.pressed("KeyS")) wish.sub(forward);
    if (input.pressed("KeyD")) wish.add(right);
    if (input.pressed("KeyA")) wish.sub(right);
    if (wish.lengthSq() > 0) wish.normalize();

    const sprint = input.pressed("ShiftLeft") || input.pressed("ShiftRight");
    const speed = sprint ? 14 : 9.5;
    const target = wish.multiplyScalar(speed);
    this.velocity.x = THREE.MathUtils.damp(this.velocity.x, target.x, 12, dt);
    this.velocity.z = THREE.MathUtils.damp(this.velocity.z, target.z, 12, dt);

    if (this.onGround && input.pressed("Space")) {
      this.velocity.y = 8.5;
      this.onGround = false;
    }
    this.velocity.y -= 22 * dt;

    const next = this.camera.position.clone();
    next.x += this.velocity.x * dt;
    next.z += this.velocity.z * dt;
    next.y += this.velocity.y * dt;

    const standY = world.resolveCollisions(next, this.radius, this.height);
    const feet = next.y - this.height * 0.45;
    if (feet <= standY + 0.05 && this.velocity.y <= 0) {
      next.y = standY + this.height * 0.45;
      this.velocity.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }
    this.camera.position.copy(next);

    // Shields recharge
    if (this.shieldDelay > 0) this.shieldDelay -= dt;
    else if (this.shields < this.maxShields) {
      this.shields = Math.min(this.maxShields, this.shields + 28 * dt);
    }

    // Weapon switch
    if (input.pressed("Digit1")) this.switchWeapon(0);
    if (input.pressed("Digit2")) this.switchWeapon(1);

    const w = this.weapon;
    if (w.cooldown > 0) w.cooldown -= dt;
    if (w.reloading > 0) {
      w.reloading -= dt;
      if (w.reloading <= 0) {
        if (w.id === "br") {
          const need = w.magSize - w.mag;
          const take = Math.min(need, w.reserve);
          w.mag += take;
          w.reserve -= take;
        } else {
          w.mag = w.magSize;
        }
      }
    }
    if (w.burstGap > 0) w.burstGap -= dt;

    if (input.pressed("KeyR") && w.reloading <= 0) {
      if (w.id === "br" && w.mag < w.magSize && w.reserve > 0) {
        w.reloading = w.reloadTime;
        audio.reload();
      } else if (w.id === "plasma" && w.mag < w.magSize) {
        w.reloading = w.reloadTime;
        audio.reload();
      }
    }

    // Fire
    const origin = this.camera.position.clone();
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);

    if (w.id === "br") {
      if (input.mouseDown && w.reloading <= 0 && w.cooldown <= 0 && w.burstLeft <= 0 && w.mag > 0) {
        w.burstLeft = 3;
      }
      if (w.burstLeft > 0 && w.burstGap <= 0 && w.mag > 0) {
        w.mag -= 1;
        w.burstLeft -= 1;
        w.burstGap = 0.045;
        w.cooldown = w.burstLeft === 0 ? 0.28 : 0;
        this.muzzleFlash = 0.05;
        audio.shootBR();
        const spread = dir.clone();
        spread.x += (Math.random() - 0.5) * 0.02;
        spread.y += (Math.random() - 0.5) * 0.02;
        spread.normalize();
        onShoot(origin, spread, "br");
      }
      if (w.mag <= 0 && w.reserve > 0 && w.reloading <= 0) {
        w.reloading = w.reloadTime;
        audio.reload();
      }
    } else {
      if (input.mouseDown && w.reloading <= 0 && w.cooldown <= 0 && w.mag > 0) {
        w.mag -= 4;
        if (w.mag < 0) w.mag = 0;
        w.cooldown = w.fireInterval;
        this.muzzleFlash = 0.06;
        audio.shootPlasma();
        onShoot(origin, dir.clone(), "plasma");
      }
    }

    if (this.grenadeCooldown > 0) this.grenadeCooldown -= dt;
    if (input.pressed("KeyG") && this.grenades > 0 && this.grenadeCooldown <= 0) {
      this.grenades -= 1;
      this.grenadeCooldown = 1.1;
      audio.grenadeThrow();
      onGrenade(origin.clone().add(dir.clone().multiplyScalar(0.6)), dir.clone());
      input.keys["KeyG"] = false;
    }

    if (this.meleeCooldown > 0) this.meleeCooldown -= dt;
    if (input.pressed("KeyF") && this.meleeCooldown <= 0) {
      this.meleeCooldown = 0.55;
      audio.melee();
      onMelee();
      input.keys["KeyF"] = false;
    }

    // Viewmodel bob + recoil settle
    if (this.muzzleFlash > 0) this.muzzleFlash -= dt;
    const bob = Math.sin(performance.now() * 0.008 * (sprint ? 1.6 : 1)) * (wish.length() > 0.1 ? 0.012 : 0);
    this.viewmodel.position.y = bob;
    this.viewmodel.position.z = this.muzzleFlash > 0 ? 0.04 : 0;
  }
}
