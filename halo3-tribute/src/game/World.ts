import * as THREE from "three";

const ARENA_HALF = 48;

export function createWorld(scene: THREE.Scene) {
  scene.background = new THREE.Color(0x87a0b0);
  scene.fog = new THREE.Fog(0x87a0b0, 40, 120);

  const hemi = new THREE.HemisphereLight(0xd8e8ff, 0x6b5a3c, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d0, 1.15);
  sun.position.set(40, 60, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 150;
  sun.shadow.camera.left = -60;
  sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60;
  sun.shadow.camera.bottom = -60;
  scene.add(sun);

  // Sandy canyon floor
  const groundGeo = new THREE.PlaneGeometry(ARENA_HALF * 2.4, ARENA_HALF * 2.4, 64, 64);
  const pos = groundGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const n =
      Math.sin(x * 0.12) * Math.cos(y * 0.1) * 0.35 +
      Math.sin(x * 0.35 + y * 0.2) * 0.15;
    pos.setZ(i, n);
  }
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshStandardMaterial({
      color: 0xb8955c,
      roughness: 0.95,
      metalness: 0.05,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Cliff walls
  const cliffMat = new THREE.MeshStandardMaterial({
    color: 0x6e5738,
    roughness: 0.92,
    metalness: 0.02,
  });
  const walls: THREE.Mesh[] = [];
  const wallSpecs = [
    { w: ARENA_HALF * 2.2, h: 18, d: 4, x: 0, z: -ARENA_HALF },
    { w: ARENA_HALF * 2.2, h: 16, d: 4, x: 0, z: ARENA_HALF },
    { w: 4, h: 17, d: ARENA_HALF * 2.2, x: -ARENA_HALF, z: 0 },
    { w: 4, h: 17, d: ARENA_HALF * 2.2, x: ARENA_HALF, z: 0 },
  ];
  for (const s of wallSpecs) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.d), cliffMat);
    m.position.set(s.x, s.h / 2 - 1, s.z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    walls.push(m);
  }

  // Forerunner-inspired metallic structures
  const forgeMat = new THREE.MeshStandardMaterial({
    color: 0x2a3f3c,
    metalness: 0.75,
    roughness: 0.28,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0x2ecc9a,
    emissive: 0x0a4a38,
    metalness: 0.4,
    roughness: 0.4,
  });

  const colliders: THREE.Box3[] = [];

  function addBlock(
    x: number,
    y: number,
    z: number,
   sx: number,
    sy: number,
    sz: number,
    mat = forgeMat,
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    const box = new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(x, y, z),
      new THREE.Vector3(sx, sy, sz),
    );
    colliders.push(box);
    return mesh;
  }

  // Central "man cannon" style platform + ramps
  addBlock(0, 1.2, 0, 14, 2.4, 14);
  addBlock(0, 3.5, 0, 6, 2, 6, accentMat);
  addBlock(-10, 0.8, 0, 8, 1.6, 4);
  addBlock(10, 0.8, 0, 8, 1.6, 4);
  addBlock(0, 0.8, -10, 4, 1.6, 8);
  addBlock(0, 0.8, 10, 4, 1.6, 8);

  // Side bases
  addBlock(-28, 2, -22, 10, 4, 10);
  addBlock(-28, 5, -22, 4, 2, 4, accentMat);
  addBlock(28, 2, 22, 10, 4, 10);
  addBlock(28, 5, 22, 4, 2, 4, accentMat);
  addBlock(-22, 1.5, 28, 12, 3, 8);
  addBlock(22, 1.5, -28, 12, 3, 8);

  // Cover rock stacks
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a734e, roughness: 0.9 });
  for (const [x, z, s] of [
    [-16, 12, 3],
    [18, -8, 2.5],
    [-8, -20, 3.2],
    [12, 18, 2.8],
    [-32, 8, 4],
    [32, -12, 3.5],
    [5, -32, 3],
    [-5, 32, 3],
  ] as const) {
    addBlock(x, s / 2, z, s, s, s * 0.85, rockMat);
  }

  // Distant ring suggestion (atmospheric prop)
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(90, 1.2, 8, 64),
    new THREE.MeshBasicMaterial({ color: 0xa8c4d8, transparent: true, opacity: 0.35 }),
  );
  ring.rotation.x = Math.PI / 2.4;
  ring.position.set(0, 55, -30);
  scene.add(ring);

  // Boundary collider (soft wall)
  const bounds = ARENA_HALF - 2;

  return {
    colliders,
    bounds,
    getGroundHeight(x: number, z: number) {
      // Approximate same noise as ground mesh
      return (
        Math.sin(x * 0.12) * Math.cos(z * 0.1) * 0.35 +
        Math.sin(x * 0.35 + z * 0.2) * 0.15
      );
    },
    resolveCollisions(pos: THREE.Vector3, radius: number, height: number) {
      pos.x = THREE.MathUtils.clamp(pos.x, -bounds, bounds);
      pos.z = THREE.MathUtils.clamp(pos.z, -bounds, bounds);

      const feet = pos.y - height * 0.5;
      let standY = this.getGroundHeight(pos.x, pos.z);

      for (const box of colliders) {
        const expanded = box.clone();
        expanded.min.x -= radius;
        expanded.max.x += radius;
        expanded.min.z -= radius;
        expanded.max.z += radius;

        if (
          pos.x > expanded.min.x &&
          pos.x < expanded.max.x &&
          pos.z > expanded.min.z &&
          pos.z < expanded.max.z
        ) {
          // Standing on top?
          if (feet >= box.max.y - 0.55 && feet <= box.max.y + 0.85 && pos.y >= box.max.y) {
            standY = Math.max(standY, box.max.y);
            continue;
          }
          // Push out horizontally from nearest face
          const dxL = Math.abs(pos.x - expanded.min.x);
          const dxR = Math.abs(expanded.max.x - pos.x);
          const dzB = Math.abs(pos.z - expanded.min.z);
          const dzF = Math.abs(expanded.max.z - pos.z);
          const minPush = Math.min(dxL, dxR, dzB, dzF);
          if (minPush === dxL) pos.x = expanded.min.x;
          else if (minPush === dxR) pos.x = expanded.max.x;
          else if (minPush === dzB) pos.z = expanded.min.z;
          else pos.z = expanded.max.z;
        }
      }
      return standY;
    },
  };
}

export type World = ReturnType<typeof createWorld>;
