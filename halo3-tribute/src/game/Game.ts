import * as THREE from "three";
import { Input } from "./Input";
import { AudioBus } from "./Audio";
import { createWorld, type World } from "./World";
import { Player, type WeaponId } from "./Player";
import {
  createEnemy,
  spawnProjectile,
  makeExplosion,
  damageEnemy,
  type Enemy,
  type Projectile,
} from "./Combat";

export class Game {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  input: Input;
  audio = new AudioBus();
  world!: World;
  player!: Player;

  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  enemyProjectiles: Projectile[] = [];
  explosions: { mesh: THREE.Mesh; age: number; maxAge: number }[] = [];

  running = false;
  paused = false;
  wave = 1;
  maxWaves = 5;
  kills = 0;
  spawnTimer = 0;
  toSpawn = 0;
  clock = new THREE.Clock();

  private radar: HTMLCanvasElement;
  private radarCtx: CanvasRenderingContext2D;
  private hudEls: {
    shield: HTMLElement;
    health: HTMLElement;
    weapon: HTMLElement;
    mag: HTMLElement;
    reserve: HTMLElement;
    grenades: HTMLElement;
    wave: HTMLElement;
    killFeed: HTMLElement;
    vignette: HTMLElement;
    hud: HTMLElement;
    title: HTMLElement;
    pause: HTMLElement;
    end: HTMLElement;
    endTitle: HTMLElement;
    endDetail: HTMLElement;
  };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);
    this.input = new Input(canvas);

    this.radar = document.getElementById("radar") as HTMLCanvasElement;
    this.radarCtx = this.radar.getContext("2d")!;

    this.hudEls = {
      shield: document.getElementById("shield-fill")!,
      health: document.getElementById("health-fill")!,
      weapon: document.getElementById("weapon-name")!,
      mag: document.getElementById("ammo-mag")!,
      reserve: document.getElementById("ammo-reserve")!,
      grenades: document.getElementById("grenades")!,
      wave: document.getElementById("wave")!,
      killFeed: document.getElementById("kill-feed")!,
      vignette: document.getElementById("damage-vignette")!,
      hud: document.getElementById("hud")!,
      title: document.getElementById("title-screen")!,
      pause: document.getElementById("pause-screen")!,
      end: document.getElementById("end-screen")!,
      endTitle: document.getElementById("end-title")!,
      endDetail: document.getElementById("end-detail")!,
    };

    window.addEventListener("resize", () => this.onResize());
    document.addEventListener("pointerlockchange", () => {
      if (!this.running) return;
      if (!this.input.pointerLocked && this.player.alive) {
        this.paused = true;
        this.hudEls.pause.classList.remove("hidden");
      }
    });

    this.resetWorld();
    this.animate();
  }

  resetWorld() {
    while (this.scene.children.length) this.scene.remove(this.scene.children[0]);
    this.enemies = [];
    this.projectiles = [];
    this.enemyProjectiles = [];
    this.explosions = [];
    this.world = createWorld(this.scene);
    this.player = new Player(this.camera);
    this.scene.add(this.camera);
    this.wave = 1;
    this.kills = 0;
    this.prepareWave(1);
  }

  prepareWave(n: number) {
    this.wave = n;
    this.toSpawn = 2 + n;
    this.spawnTimer = 1.4;
    this.hudEls.wave.textContent = String(n);
    this.pushFeed(`Wave ${n} inbound`);
  }

  start() {
    this.audio.ensure();
    this.input.mouseDown = false;
    this.hudEls.title.classList.add("hidden");
    this.hudEls.end.classList.add("hidden");
    this.hudEls.pause.classList.add("hidden");
    this.hudEls.hud.classList.remove("hidden");
    this.resetWorld();
    this.running = true;
    this.paused = false;
    this.clock = new THREE.Clock();
    this.input.requestLock();
  }

  resume() {
    this.paused = false;
    this.hudEls.pause.classList.add("hidden");
    this.input.requestLock();
  }

  private onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private spawnPoint(): THREE.Vector3 {
    const player = this.camera.position;
    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 32 + Math.random() * 10;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      const y = this.world.getGroundHeight(x, z);
      const p = new THREE.Vector3(x, y, z);
      if (p.distanceTo(player) >= 24) return p;
    }
    return new THREE.Vector3(36, this.world.getGroundHeight(36, 0), 0);
  }

  private spawnOne() {
    const type = Math.random() < 0.28 + this.wave * 0.05 ? "elite" : "grunt";
    const enemy = createEnemy(type, this.spawnPoint());
    this.scene.add(enemy.group);
    this.enemies.push(enemy);
  }

  private pushFeed(text: string) {
    const row = document.createElement("div");
    row.textContent = text;
    this.hudEls.killFeed.prepend(row);
    setTimeout(() => row.remove(), 2800);
    while (this.hudEls.killFeed.childElementCount > 5) {
      this.hudEls.killFeed.lastChild?.remove();
    }
  }

  private shoot(origin: THREE.Vector3, dir: THREE.Vector3, weapon: WeaponId) {
    this.projectiles.push(spawnProjectile(this.scene, origin, dir, weapon));
  }

  private throwGrenade(origin: THREE.Vector3, dir: THREE.Vector3) {
    const p = spawnProjectile(this.scene, origin, dir, "grenade");
    p.velocity.y += 6;
    this.projectiles.push(p);
  }

  private melee() {
    const origin = this.camera.position;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const to = e.group.position.clone().sub(origin);
      if (to.length() > 2.2) continue;
      if (to.normalize().dot(dir) < 0.35) continue;
      if (damageEnemy(e, 55, this.audio)) {
        this.onEnemyKilled(e);
      }
    }
  }

  private onEnemyKilled(e: Enemy) {
    this.kills += 1;
    this.pushFeed(e.type === "elite" ? "Elite down" : "Grunt down");
    this.scene.remove(e.group);
    const fx = makeExplosion(this.scene, e.group.position.clone().add(new THREE.Vector3(0, 1, 0)), 0x88ffaa);
    this.explosions.push(fx);
  }

  private explode(pos: THREE.Vector3, damage: number) {
    this.audio.explosion();
    this.explosions.push(makeExplosion(this.scene, pos));
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = e.group.position.distanceTo(pos);
      if (d < 5.5) {
        const falloff = 1 - d / 5.5;
        if (damageEnemy(e, damage * falloff, this.audio)) this.onEnemyKilled(e);
      }
    }
    const pd = this.camera.position.distanceTo(pos);
    if (pd < 5) {
      this.player.takeDamage(damage * (1 - pd / 5) * 0.45, this.audio);
    }
  }

  private updateProjectiles(list: Projectile[], vsPlayer: boolean, dt: number) {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if (p.kind === "grenade") {
        p.velocity.y -= 18 * dt;
      }
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.life -= dt;

      const ground = this.world.getGroundHeight(p.mesh.position.x, p.mesh.position.z);
      let hit = false;

      if (p.mesh.position.y < ground + 0.15) {
        hit = true;
        if (p.kind === "grenade") {
          this.explode(p.mesh.position.clone(), p.damage);
        }
      }

      // Structure collisions
      for (const box of this.world.colliders) {
        if (box.containsPoint(p.mesh.position)) {
          hit = true;
          if (p.kind === "grenade") this.explode(p.mesh.position.clone(), p.damage);
          break;
        }
      }

      if (!vsPlayer) {
        for (const e of this.enemies) {
          if (!e.alive) continue;
          if (p.mesh.position.distanceTo(e.group.position.clone().setY(e.group.position.y + 1)) < e.radius + p.radius) {
            hit = true;
            if (p.kind === "grenade") this.explode(p.mesh.position.clone(), p.damage);
            else if (damageEnemy(e, p.damage, this.audio)) this.onEnemyKilled(e);
            break;
          }
        }
      } else if (this.player.alive) {
        if (p.mesh.position.distanceTo(this.camera.position) < 0.7 + p.radius) {
          hit = true;
          this.player.takeDamage(p.damage, this.audio);
        }
      }

      if (hit || p.life <= 0) {
        if (!hit && p.kind === "grenade" && p.life <= 0) {
          this.explode(p.mesh.position.clone(), p.damage);
        }
        this.scene.remove(p.mesh);
        list.splice(i, 1);
      }
    }
  }

  private updateEnemies(dt: number) {
    const playerPos = this.camera.position;
    for (const e of this.enemies) {
      if (!e.alive) continue;

      const toPlayer = playerPos.clone().sub(e.group.position);
      toPlayer.y = 0;
      const dist = toPlayer.length();
      if (dist > 0.1) {
        toPlayer.normalize();
        e.group.position.addScaledVector(toPlayer, e.speed * dt);
        e.group.lookAt(playerPos.x, e.group.position.y, playerPos.z);
      }
      const gh = this.world.getGroundHeight(e.group.position.x, e.group.position.z);
      e.group.position.y = gh;
      // Soft collision with props / bounds
      this.world.resolveCollisions(
        e.group.position,
        e.radius,
        e.type === "elite" ? 2.2 : 1.4,
      );
      e.group.position.y = Math.max(
        this.world.getGroundHeight(e.group.position.x, e.group.position.z),
        e.group.position.y,
      );

      if (e.hitFlash > 0) {
        e.hitFlash -= dt;
        e.group.traverse((obj) => {
          if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
            obj.material.emissive = new THREE.Color(e.hitFlash > 0 ? 0xffffff : 0x000000);
            obj.material.emissiveIntensity = e.hitFlash > 0 ? 0.6 : 0.05;
          }
        });
      }

      e.fireCooldown -= dt;
      if (e.fireCooldown <= 0 && dist < 38 && dist > 2.8) {
        const waveScale = 1 / (1 + (this.wave - 1) * 0.12);
        e.fireCooldown = (e.type === "elite" ? 1.0 : 1.55) * waveScale;
        const origin = e.group.position.clone().add(new THREE.Vector3(0, 1.2, 0));
        const dir = playerPos.clone().sub(origin).normalize();
        const spread = 0.12 - Math.min(0.05, this.wave * 0.008);
        dir.x += (Math.random() - 0.5) * spread;
        dir.y += (Math.random() - 0.5) * (spread * 0.7);
        dir.normalize();
        const bolt = spawnProjectile(this.scene, origin, dir, "plasma");
        bolt.damage = (e.type === "elite" ? 14 : 9) + (this.wave - 1) * 1.5;
        (bolt.mesh.material as THREE.MeshBasicMaterial).color.set(0x88ff66);
        this.enemyProjectiles.push(bolt);
      }

      // Contact damage
      if (dist < 1.35) {
        this.player.takeDamage((e.type === "elite" ? 14 : 8) * dt, this.audio);
      }
    }
  }

  private updateHud() {
    const p = this.player;
    this.hudEls.shield.style.width = `${(p.shields / p.maxShields) * 100}%`;
    this.hudEls.health.style.width = `${(p.health / p.maxHealth) * 100}%`;
    this.hudEls.weapon.textContent = p.weapon.name;
    this.hudEls.mag.textContent = String(Math.ceil(p.weapon.mag));
    this.hudEls.reserve.textContent =
      p.weapon.id === "plasma" ? "∞" : String(p.weapon.reserve);
    this.hudEls.grenades.textContent = String(p.grenades);
    const hurt = 1 - p.health / p.maxHealth;
    const shieldHurt = p.shields < 30 ? 0.25 : 0;
    this.hudEls.vignette.style.opacity = String(Math.min(0.85, hurt * 0.7 + shieldHurt));

    // Radar
    const ctx = this.radarCtx;
    const w = this.radar.width;
    const h = this.radar.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(10,40,36,0.9)";
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(94,200,255,0.35)";
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.25, 0, Math.PI * 2);
    ctx.stroke();
    // player
    ctx.fillStyle = "#7dffb3";
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 4, 0, Math.PI * 2);
    ctx.fill();
    const yaw = this.player.yaw;
    const range = 42;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = e.group.position.x - this.camera.position.x;
      const dz = e.group.position.z - this.camera.position.z;
      // rotate into player view
      const rx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
      const rz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
      const px = w / 2 + (rx / range) * (w / 2 - 8);
      const py = h / 2 + (rz / range) * (h / 2 - 8);
      if (px < 4 || px > w - 4 || py < 4 || py > h - 4) continue;
      ctx.fillStyle = e.type === "elite" ? "#ff6644" : "#ffaa44";
      ctx.beginPath();
      ctx.arc(px, py, e.type === "elite" ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private endGame(victory: boolean) {
    this.running = false;
    this.paused = false;
    document.exitPointerLock();
    this.hudEls.pause.classList.add("hidden");
    this.hudEls.end.classList.remove("hidden");
    this.hudEls.endTitle.textContent = victory ? "VICTORY" : "KIA";
    this.hudEls.endDetail.textContent = victory
      ? `LZ secure. ${this.kills} hostiles eliminated across ${this.maxWaves} waves.`
      : `You fell on wave ${this.wave}. ${this.kills} kills. Redeploy and hold the line.`;
    if (victory) this.audio.win();
    else this.audio.lose();
  }

  private animate = () => {
    requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.running && !this.paused && this.player.alive) {
      if (this.toSpawn > 0) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
          this.spawnOne();
          this.toSpawn -= 1;
          this.spawnTimer = 1.1;
        }
      }

      this.player.update(
        dt,
        this.input,
        this.world,
        this.audio,
        (o, d, w) => this.shoot(o, d, w),
        (o, d) => this.throwGrenade(o, d),
        () => this.melee(),
      );
      this.updateEnemies(dt);
      this.updateProjectiles(this.projectiles, false, dt);
      this.updateProjectiles(this.enemyProjectiles, true, dt);

      for (let i = this.explosions.length - 1; i >= 0; i--) {
        const ex = this.explosions[i];
        ex.age += dt;
        const t = ex.age / ex.maxAge;
        ex.mesh.scale.setScalar(1 + t * 8);
        const mat = ex.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = 1 - t;
        if (ex.age >= ex.maxAge) {
          this.scene.remove(ex.mesh);
          this.explosions.splice(i, 1);
        }
      }

      // Wave clear
      if (
        this.toSpawn <= 0 &&
        this.enemies.every((e) => !e.alive) &&
        this.enemies.length > 0
      ) {
        this.enemies = this.enemies.filter((e) => e.alive);
        if (this.wave >= this.maxWaves) {
          this.endGame(true);
        } else {
          this.prepareWave(this.wave + 1);
        }
      } else if (
        this.toSpawn <= 0 &&
        this.enemies.length === 0 &&
        this.wave === 1
      ) {
        // waiting first spawn
      }

      if (!this.player.alive) {
        this.endGame(false);
      }

      this.updateHud();
    } else if (this.running && this.player.alive) {
      this.updateHud();
    }

    this.renderer.render(this.scene, this.camera);
  };
}
