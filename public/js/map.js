// 발로란트식 맵: A/B 사이트 + 미드 + 박스 — 어센트 오마주
import * as THREE from 'three';

export const SITES = {
  A: { x1: -24, x2: -10, z1: 2, z2: 18 },
  B: { x1: 10, x2: 24, z1: 2, z2: 18 },
};

// 충돌 박스 목록 {min:Vector3, max:Vector3}
export const colliders = [];

function addCollider(minX, minY, minZ, maxX, maxY, maxZ) {
  colliders.push({ min: new THREE.Vector3(minX, minY, minZ), max: new THREE.Vector3(maxX, maxY, maxZ) });
}

export function buildMap(scene) {
  // 라이트
  scene.background = new THREE.Color(0x87a0b5);
  scene.fog = new THREE.Fog(0x87a0b5, 60, 160);
  const hemi = new THREE.HemisphereLight(0xdfefff, 0x334155, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(30, 50, -20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -45; sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
  scene.add(sun);

  const mat = {
    ground: new THREE.MeshStandardMaterial({ color: 0x9aa78f, roughness: 1 }),
    groundSite: new THREE.MeshStandardMaterial({ color: 0xa8b39a, roughness: 1 }),
    wall: new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.9 }),
    wallDark: new THREE.MeshStandardMaterial({ color: 0x5b6b78, roughness: 0.9 }),
    box: new THREE.MeshStandardMaterial({ color: 0x7a8b99, roughness: 0.85 }),
    boxWood: new THREE.MeshStandardMaterial({ color: 0x8a6f4d, roughness: 0.9 }),
    accent: new THREE.MeshStandardMaterial({ color: 0xff4655, roughness: 0.6 }),
    teal: new THREE.MeshStandardMaterial({ color: 0x00e5cc, emissive: 0x00e5cc, emissiveIntensity: 0.4 }),
  };

  // 바닥 (60x70)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(70, 80), mat.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // 사이트 바닥 표시
  for (const [key, s] of Object.entries(SITES)) {
    const w = s.x2 - s.x1, d = s.z2 - s.z1;
    const zone = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
      new THREE.MeshStandardMaterial({ color: key === 'A' ? 0xd8cfae : 0xc2d6cf, roughness: 1 }));
    zone.rotation.x = -Math.PI / 2;
    zone.position.set((s.x1 + s.x2) / 2, 0.02, (s.z1 + s.z2) / 2);
    zone.receiveShadow = true;
    scene.add(zone);
    // 사이트 글자 기둥
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 5, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x0f1923 }));
    pillar.position.set((s.x1 + s.x2) / 2, 2.5, (s.z1 + s.z2) / 2);
    scene.add(pillar);
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x0f1923, emissive: key === 'A' ? 0xff4655 : 0x00e5cc, emissiveIntensity: 0.8 }));
    top.position.set((s.x1 + s.x2) / 2, 5.2, (s.z1 + s.z2) / 2);
    scene.add(top);
  }

  const walls = new THREE.Group();
  scene.add(walls);
  function wall(x, z, w, h, d, material = mat.wall) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    walls.add(m);
    addCollider(x - w / 2, 0, z - d / 2, x + w / 2, h, z + d / 2);
    return m;
  }
  function crate(x, z, s = 1.6, h = 1.6, material = mat.box) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, h, s), material);
    m.position.set(x, h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    addCollider(x - s / 2, 0, z - s / 2, x + s / 2, h, z + s / 2);
    return m;
  }

  // 외벽
  wall(0, -34, 70, 6, 1);
  wall(0, 34, 70, 6, 1);
  wall(-34, 0, 1, 6, 70);
  wall(34, 0, 1, 6, 70);

  // 미드 구조물 (발로식 미드 도어)
  wall(0, -8, 12, 4, 1.2, mat.wallDark);          // 미드 월
  wall(-8, -4, 1.2, 4, 10);                        // 미드 좌
  wall(8, -4, 1.2, 4, 10);                         // 미드 우
  crate(-5, -12, 1.6, 1.6); crate(5, -12, 1.6, 1.6);
  crate(0, -14, 2.2, 1.2, mat.boxWood);

  // A 사이트 (서쪽): 박스 + 엄폐
  wall(-17, 2, 14, 3.5, 1, mat.wall);              // A 입구 벽
  wall(-27, 10, 1, 3.5, 16);                       // A 외벽 안쪽
  crate(-20, 8, 1.6); crate(-18.2, 8, 1.6); crate(-19.1, 8, 1.6, 3.0);
  crate(-14, 12, 2.0, 1.4, mat.boxWood); crate(-22, 14, 1.8);
  wall(-13, 16, 8, 2.5, 1);                        // A 백월
  crate(-17, 5, 1.4, 1.2, mat.boxWood);

  // B 사이트 (동쪽) 대칭
  wall(17, 2, 14, 3.5, 1, mat.wall);
  wall(27, 10, 1, 3.5, 16);
  crate(20, 8, 1.6); crate(18.2, 8, 1.6); crate(19.1, 8, 1.6, 3.0);
  crate(14, 12, 2.0, 1.4, mat.boxWood); crate(22, 14, 1.8);
  wall(13, 16, 8, 2.5, 1);
  crate(17, 5, 1.4, 1.2, mat.boxWood);

  // A/B 롱 통로 벽
  wall(-12, -18, 1.2, 3.5, 14);  // A 롱
  wall(12, -18, 1.2, 3.5, 14);   // B 롱
  wall(-20, -18, 12, 3.5, 1.2);  // 공격 스폰 앞
  wall(20, -18, 12, 3.5, 1.2);
  wall(-20, 24, 10, 3.5, 1.2, mat.wallDark); // 수비 스폰
  wall(20, 24, 10, 3.5, 1.2, mat.wallDark);

  // 중앙 추가 엄폐
  crate(-3, 4, 1.8, 1.5); crate(3, 4, 1.8, 1.5);
  crate(0, 10, 2.4, 1.2, mat.boxWood);

  // 수비 스폰 장식 + 공격 스폰 장식
  const atkSign = new THREE.Mesh(new THREE.BoxGeometry(6, 1, 0.4), mat.accent);
  atkSign.position.set(0, 4, -33.2); scene.add(atkSign);
  const defSign = new THREE.Mesh(new THREE.BoxGeometry(6, 1, 0.4), mat.teal);
  defSign.position.set(0, 4, 33.2); scene.add(defSign);

  // 하늘 장식 건물 (멀리)
  for (let i = 0; i < 10; i++) {
    const h = 10 + Math.random() * 20;
    const b = new THREE.Mesh(new THREE.BoxGeometry(8, h, 8),
      new THREE.MeshStandardMaterial({ color: 0x6b7f8f, roughness: 1 }));
    const a = (i / 10) * Math.PI * 2;
    b.position.set(Math.cos(a) * 70, h / 2, Math.sin(a) * 70);
    scene.add(b);
  }
}

// AABB 충돌 해결: pos(발바닥) + radius + height
export function collideMove(pos, radius = 0.45, height = 1.7) {
  // pos는 THREE.Vector3 (발바닥 기준). XZ와 Y 분리 해결.
  // XZ 해결
  for (const c of colliders) {
    // 플레이어 Y범위와 박스 Y 겹치는지
    if (pos.y + height < c.min.y || pos.y + 0.2 > c.max.y) continue;
    const nx = Math.max(c.min.x, Math.min(pos.x, c.max.x));
    const nz = Math.max(c.min.z, Math.min(pos.z, c.max.z));
    const dx = pos.x - nx, dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (radius - d) / d;
        pos.x += dx * push; pos.z += dz * push;
      } else {
        // 안에 박힘: 가장 얇은 축으로 밀기
        const px1 = pos.x - c.min.x, px2 = c.max.x - pos.x;
        const pz1 = pos.z - c.min.z, pz2 = c.max.z - pos.z;
        const m = Math.min(px1, px2, pz1, pz2);
        if (m === px1) pos.x = c.min.x - radius;
        else if (m === px2) pos.x = c.max.x + radius;
        else if (m === pz1) pos.z = c.min.z - radius;
        else pos.z = c.max.z + radius;
      }
    }
  }
  // 맵 경계
  pos.x = Math.max(-33, Math.min(33, pos.x));
  pos.z = Math.max(-33, Math.min(33, pos.z));
}

// 바닥 높이 (박스 위에 올라갈 수 있게): 발바닥 y를 받으면 서 있을 높이 반환
export function groundHeight(x, z, y) {
  let g = 0;
  for (const c of colliders) {
    if (x >= c.min.x - 0.3 && x <= c.max.x + 0.3 && z >= c.min.z - 0.3 && z <= c.max.z + 0.3) {
      if (c.max.y <= y + 0.6 && c.max.y > g) g = c.max.y;
    }
  }
  return g;
}
