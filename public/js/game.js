import * as THREE from 'three';
import { io } from 'socket.io';
import { WEAPONS, AGENTS, SHOP_ITEMS } from './config.js';
import { buildMap, colliders, collideMove, groundHeight, SITES } from './map.js';
import { sfxShot, sfxHit, sfxKill, sfxPlant, sfxReload, sfxStep, sfxAbility, sfxFlash } from './audio.js';

// ================= 로비 =================
let selectedAgent = 'jett';
const grid = document.getElementById('agent-grid');
for (const [id, a] of Object.entries(AGENTS)) {
  const div = document.createElement('div');
  div.className = 'agent' + (id === selectedAgent ? ' sel' : '');
  div.innerHTML = `<div class="ic">${a.icon}</div><h3>${a.name}</h3><div class="role">${a.role}</div><p>${a.desc}</p><p style="min-height:0;color:#fff">Q ${a.q.icon} ${a.q.name} · E ${a.e.icon} ${a.e.name} · X ${a.x.icon} ${a.x.name}</p>`;
  div.onclick = () => { selectedAgent = id; document.querySelectorAll('.agent').forEach(e => e.classList.remove('sel')); div.classList.add('sel'); };
  grid.appendChild(div);
}

// ================= 상태 =================
let socket = null, me = null;
let players = new Map(); // id -> server data + mesh
let roundState = null;
let myHp = 100, myArmor = 0, alive = true;
let myWeapon = 'vandal', ammo = {}, reloading = false, reloadEnd = 0;
let money = 800, ultPoints = 0;
let hasSpike = false;
for (const k of Object.keys(WEAPONS)) { const w = WEAPONS[k]; ammo[k] = { mag: w.mag, reserve: w.reserve }; }
ammo['vandal'] = { mag: 25, reserve: 75 };

let knives = 0, knivesMode = false; // 제트 궁
let cooldowns = { q: 0, e: 0, x: 0 };
let abilityCharges = { q: 1, e: 1 };
let slowedUntil = 0, blindUntil = 0, revealed = new Map(); // id -> until
let smokes = []; // {mesh, until, pos}
let slows = []; // {mesh, pos, until}
let spikeMesh = null, spikeLight = null;
let lastShotAt = new Map();

// ================= Three.js =================
const container = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.className = 'webgl';
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 400);
buildMap(scene);

// 총기 뷰모델 (화면 우하단)
const gunGroup = new THREE.Group();
camera.add(gunGroup);
scene.add(camera);
function buildViewmodel() {
  gunGroup.clear();
  const dark = new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: 0.5, metalness: 0.4 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xff4655, roughness: 0.4 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.55), dark);
  body.position.set(0.28, -0.24, -0.5);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3), dark);
  barrel.position.set(0.28, -0.21, -0.85);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.06), accent);
  sight.position.set(0.28, -0.16, -0.55);
  gunGroup.add(body, barrel, sight);
  if (WEAPONS[myWeapon]?.sniper) {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.25, 16), dark);
    scope.rotation.x = Math.PI / 2; scope.position.set(0.28, -0.16, -0.5);
    gunGroup.add(scope);
  }
}
buildViewmodel();
const muzzle = new THREE.PointLight(0xffaa33, 0, 8);
muzzle.position.set(0.28, -0.2, -1);
camera.add(muzzle);

// 원격 플레이어 메시
function makeNameSprite(name, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 30px sans-serif'; g.textAlign = 'center';
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(40, 6, 176, 40);
  g.fillStyle = color; g.fillText(name, 128, 37);
  const t = new THREE.CanvasTexture(c);
  const s = new THREE.SpriteMaterial({ map: t, depthTest: false });
  const sp = new THREE.Sprite(s); sp.scale.set(1.6, 0.4, 1);
  return sp;
}
function makePlayerMesh(p) {
  const grp = new THREE.Group();
  const teamColor = p.team === 'attack' ? 0xff4655 : 0x00e5cc;
  const bodyMat = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.7 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xe8b98a, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.42), bodyMat);
  body.position.y = 0.9; body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 16), headMat);
  head.position.y = 1.62; head.castShadow = true;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.8), new THREE.MeshStandardMaterial({ color: 0x111111 }));
  gun.position.set(0.3, 1.1, -0.4);
  const tag = makeNameSprite(p.name, p.team === 'attack' ? '#ff8089' : '#7df0e0');
  tag.position.y = 2.15;
  grp.add(body, head, gun, tag);
  grp.userData = { body, head, tag, teamColor };
  return grp;
}

// 트레이서
const tracers = [];
function spawnTracer(from, to, color = 0xffe08a) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  tracers.push({ line, life: 0.12 });
}
// 탄흔
function spawnImpact(pos) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffcc66 }));
  m.position.copy(pos); scene.add(m);
  setTimeout(() => scene.remove(m), 120);
}
// 연막 메시
function spawnSmokeMesh(pos) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, transparent: true, opacity: 0.92, roughness: 1 });
  const s = new THREE.Mesh(new THREE.SphereGeometry(2.6, 18, 18), mat);
  s.position.set(pos.x, 1.6, pos.z);
  scene.add(s);
  smokes.push({ mesh: s, until: performance.now() + 18000, pos });
  document.getElementById('vignette-smoke').style.opacity = 0; // 안개 안이면 갱신
}
// 스파이크 메시
function ensureSpikeMesh() {
  if (spikeMesh) return;
  spikeMesh = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xff4655, emissiveIntensity: 0.7 }));
  box.position.y = 0.28;
  spikeLight = new THREE.PointLight(0xff2222, 2, 12);
  spikeLight.position.y = 1;
  spikeMesh.add(box, spikeLight);
  spikeMesh.visible = false;
  scene.add(spikeMesh);
}
ensureSpikeMesh();

// ================= 입력 =================
const keys = {};
let yaw = 0, pitch = 0;
let pos = new THREE.Vector3(0, 0, -26);
let vel = new THREE.Vector3();
let onGround = true, crouch = false, ads = false;
let firing = false, lastFire = 0, spreadBloom = 0;
let pointerLocked = false;

document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Tab') { e.preventDefault(); document.getElementById('scoreboard').classList.add('on'); renderScoreboard(); }
  if (e.code === 'KeyB') toggleShop();
  if (e.code === 'Enter') {
    const ci = document.getElementById('chat-input');
    if (document.activeElement === ci) { sendChat(); } else { e.preventDefault(); ci.style.display = 'block'; ci.focus(); }
  }
  if (document.activeElement?.tagName === 'INPUT' && document.activeElement.id !== 'chat-input') return;
  if (document.activeElement?.id === 'chat-input') { if (e.code === 'Escape') { document.activeElement.blur(); document.activeElement.style.display = 'none'; } return; }
  if (e.code === 'KeyR') startReload();
  if (e.code === 'KeyQ') useQ();
  if (e.code === 'KeyE') useE();
  if (e.code === 'KeyX') useUlt();
  if (e.code === 'Digit3') switchToKnife();
  if (e.code === 'Digit1') switchToPrimary();
});
document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Tab') document.getElementById('scoreboard').classList.remove('on');
});
renderer.domElement.addEventListener('click', () => {
  if (document.getElementById('lobby').style.display !== 'none') return;
  if (!pointerLocked) renderer.domElement.requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
});
document.addEventListener('mousemove', (e) => {
  if (!pointerLocked || !alive) return;
  const sens = ads ? 0.0011 : 0.0021;
  yaw -= e.movementX * sens;
  pitch -= e.movementY * sens;
  pitch = Math.max(-1.45, Math.min(1.45, pitch));
});
document.addEventListener('mousedown', (e) => {
  if (!pointerLocked || !alive) return;
  if (document.getElementById('shop').classList.contains('on')) return;
  if (e.button === 0) firing = true;
  if (e.button === 2) ads = true;
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) firing = false;
  if (e.button === 2) ads = false;
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ================= 발사/판정 =================
function eyePos() {
  return new THREE.Vector3(pos.x, pos.y + (crouch ? 1.15 : 1.62), pos.z);
}
function shootDir() {
  const d = new THREE.Vector3(0, 0, -1);
  d.applyEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  return d;
}
// 벽까지 거리 (AABB 레이)
function rayWalls(origin, dir, maxDist) {
  let best = maxDist;
  const inv = new THREE.Vector3(1 / (dir.x || 1e-8), 1 / (dir.y || 1e-8), 1 / (dir.z || 1e-8));
  for (const c of colliders) {
    let t1 = (c.min.x - origin.x) * inv.x, t2 = (c.max.x - origin.x) * inv.x;
    let t3 = (c.min.y - origin.y) * inv.y, t4 = (c.max.y - origin.y) * inv.y;
    let t5 = (c.min.z - origin.z) * inv.z, t6 = (c.max.z - origin.z) * inv.z;
    const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4), Math.min(t5, t6));
    const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4), Math.max(t5, t6));
    if (tmax >= Math.max(tmin, 0) && tmin < best && tmin > 0) best = tmin;
  }
  // 바닥
  if (dir.y < -1e-4) {
    const t = (0.02 - origin.y) / dir.y;
    if (t > 0 && t < best) best = t;
  }
  return best;
}
// 적 히트 판정: head sphere + body AABB
function rayPlayer(origin, dir, p, maxDist) {
  const bp = new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z);
  // head
  const hc = new THREE.Vector3(bp.x, bp.y + 1.62, bp.z);
  const oc = hc.clone().sub(origin);
  const tProj = oc.dot(dir);
  if (tProj > 0 && tProj < maxDist) {
    const closest = origin.clone().add(dir.clone().multiplyScalar(tProj));
    if (closest.distanceTo(hc) < 0.32) return { dist: tProj, head: true };
  }
  // body: x±0.35, y 0..1.45, z±0.25 (yaw 무시 간소화)
  const min = new THREE.Vector3(bp.x - 0.38, bp.y, bp.z - 0.3);
  const max = new THREE.Vector3(bp.x + 0.38, bp.y + 1.45, bp.z + 0.3);
  const inv = new THREE.Vector3(1 / (dir.x || 1e-8), 1 / (dir.y || 1e-8), 1 / (dir.z || 1e-8));
  const t1 = (min.x - origin.x) * inv.x, t2 = (max.x - origin.x) * inv.x;
  const t3 = (min.y - origin.y) * inv.y, t4 = (max.y - origin.y) * inv.y;
  const t5 = (min.z - origin.z) * inv.z, t6 = (max.z - origin.z) * inv.z;
  const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4), Math.min(t5, t6));
  const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4), Math.max(t5, t6));
  if (tmax >= Math.max(tmin, 0) && tmin > 0 && tmin < maxDist) return { dist: tmin, head: false };
  return null;
}

function tryFire(now) {
  if (!alive || reloading || roundState?.phase !== 'live') return;
  const w = WEAPONS[myWeapon];
  if (!w) return;
  const interval = 60000 / w.rpm;
  if (now - lastFire < interval) return;
  if (knivesMode) {
    if (knives <= 0) { knivesMode = false; switchToPrimary(); return; }
    lastFire = now;
    knives--;
    fireOneShot({ ...w, damage: 55, headMult: 2.5, spread: 0.002 }, true);
    if (knives <= 0) { knivesMode = false; setTimeout(switchToPrimary, 300); }
    updateAmmoHud();
    return;
  }
  const a = ammo[myWeapon];
  if (a.mag <= 0) { startReload(); return; }
  lastFire = now;
  a.mag--;
  fireOneShot(w, false);
  updateAmmoHud();
  if (a.mag === 0) setTimeout(() => startReload(), 250);
}

function fireOneShot(w, isKnife) {
  const now = performance.now();
  const origin = eyePos();
  const moving = (keys['KeyW'] || keys['KeyA'] || keys['KeyS'] || keys['KeyD']);
  const movePenalty = moving ? (keys['ShiftLeft'] ? 0.5 : 1.6) : 0.25;
  const bloom = spreadBloom + (ads ? 0.15 : 1) * movePenalty;
  const spread = (ads && !w.sniper ? w.spread * 0.4 : w.spread) * bloom + (isKnife ? 0 : 0.004);
  const dir = shootDir();
  dir.x += (Math.random() - 0.5) * spread * 2;
  dir.y += (Math.random() - 0.5) * spread * 2;
  dir.z += (Math.random() - 0.5) * spread * 2;
  dir.normalize();
  spreadBloom = Math.min(3.2, spreadBloom + (w.auto ? 0.35 : 0.7));

  // 판정
  const maxDist = w.range || 60;
  const wallD = rayWalls(origin, dir, maxDist);
  let bestVictim = null, bestHit = null;
  for (const [id, p] of players) {
    if (id === socket.id || !p.alive || p.team === me?.team) continue;
    // 연막 안에 있으면 맞추기 어렵게? 연막 차단 체크
    const h = rayPlayer(origin, dir, p, Math.min(wallD, maxDist));
    if (h && (!bestHit || h.dist < bestHit.dist)) { bestHit = h; bestVictim = p; }
  }
  const end = origin.clone().add(dir.clone().multiplyScalar(bestHit ? bestHit.dist : wallD));
  spawnTracer(camera.localToWorld(new THREE.Vector3(0.28, -0.2, -1)), end);
  if (bestHit) spawnImpact(end);
  else if (wallD < maxDist) spawnImpact(end);
  muzzle.intensity = 3; setTimeout(() => muzzle.intensity = 0, 40);
  sfxShot(myWeapon, false);
  // 총구 반동 (화면)
  if (!ads) pitch += 0.0035;

  socket.emit('tracer', { from: [origin.x, origin.y, origin.z], dir: [dir.x, dir.y, dir.z] });
  lastShotAt.set(socket.id, now);

  if (bestVictim) {
    let dmg = w.damage;
    // 거리 감쇠 (operator 제외)
    const dist = bestHit.dist;
    if (!w.sniper && !w.melee && dist > 20) dmg = Math.round(dmg * Math.max(0.6, 1 - (dist - 20) / 80));
    socket.emit('hit', { victimId: bestVictim.id, damage: bestHit.head ? Math.round(dmg * w.headMult) : dmg, headshot: bestHit.head, weapon: myWeapon });
  }
}

function startReload() {
  if (!alive || reloading || knivesMode) return;
  const w = WEAPONS[myWeapon];
  const a = ammo[myWeapon];
  if (!w || a.mag >= w.mag || a.reserve <= 0) return;
  reloading = true;
  reloadEnd = performance.now() + w.reload * 1000;
  sfxReload();
  setTimeout(() => {
    const need = w.mag - a.mag, take = Math.min(need, a.reserve);
    a.mag += take; a.reserve -= take;
    reloading = false;
    updateAmmoHud();
  }, w.reload * 1000);
  updateAmmoHud();
}
function switchToKnife() {
  if (myWeapon === 'knife') return;
  prevWeapon = myWeapon; myWeapon = 'knife';
  buildViewmodel(); updateAmmoHud(); updateWeaponHud();
}
let prevWeapon = 'vandal';
function switchToPrimary() {
  myWeapon = prevWeapon || 'vandal';
  if (!WEAPONS[myWeapon]) myWeapon = 'vandal';
  knivesMode = false;
  buildViewmodel(); updateAmmoHud(); updateWeaponHud();
}

// ================= 스킬 =================
function useQ() {
  if (!alive || !canUse('q')) return;
  const now = performance.now();
  const agent = me?.agent || selectedAgent;
  sfxAbility();
  if (agent === 'jett') {
    vel.y = 8.5; // 업드래프트
    socket.emit('ability', { type: 'updraft' });
    setCd('q', 12);
  } else if (agent === 'omen') {
    // 파라노이아: 전방 25m 적 실명
    const o = eyePos(), d = shootDir();
    for (const [id, p] of players) {
      if (id === socket.id || p.team === me.team || !p.alive) continue;
      const to = new THREE.Vector3(p.pos.x - o.x, 0, p.pos.z - o.z);
      if (to.length() < 26 && to.normalize().dot(new THREE.Vector3(d.x, 0, d.z).normalize()) > 0.5) {
        socket.emit('ability', { type: 'blind', targetId: id });
      }
    }
    flashOverlay(0.4, false);
    socket.emit('ability', { type: 'paranoia' });
    setCd('q', 18);
  } else if (agent === 'sova') {
    // 정찰 화살: 조준점 40m 지점 AoE 15m 적 공개
    const o = eyePos(), d = shootDir();
    const wallD = rayWalls(o, d, 45);
    const at = o.clone().add(d.clone().multiplyScalar(Math.min(wallD, 45)));
    let found = 0;
    for (const [id, p] of players) {
      if (id === socket.id || p.team === me.team || !p.alive) continue;
      const dd = Math.hypot(p.pos.x - at.x, p.pos.z - at.z);
      if (dd < 16) { revealed.set(id, now + 5000); found++; }
    }
    socket.emit('ability', { type: 'recon', at: [at.x, at.z], found });
    addFeed(`📡 정찰 화살 — ${found}명 탐지`);
    setCd('q', 20);
  } else if (agent === 'sage') {
    // 슬로우 오브
    const o = eyePos(), d = shootDir();
    const wallD = rayWalls(o, d, 40);
    const at = o.clone().add(d.clone().multiplyScalar(Math.min(wallD, 40)));
    const m = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 0.15, 24),
      new THREE.MeshStandardMaterial({ color: 0x5dffb0, transparent: true, opacity: 0.5 }));
    m.position.set(at.x, 0.08, at.z); scene.add(m);
    slows.push({ mesh: m, pos: { x: at.x, z: at.z }, until: now + 8000 });
    socket.emit('ability', { type: 'slow', at: [at.x, at.z] });
    setCd('q', 16);
  }
  renderAbilities();
}
function useE() {
  if (!alive || !canUse('e')) return;
  const agent = me?.agent || selectedAgent;
  sfxAbility();
  if (agent === 'jett') {
    // 대시: 바라보는 방향 8m
    const d = shootDir(); d.y = 0; d.normalize();
    const target = pos.clone().add(d.multiplyScalar(7.5));
    target.y = pos.y;
    collideMove(target);
    target.y = groundHeight(target.x, target.z, target.y + 1);
    pos.copy(target);
    socket.emit('teleport', { x: pos.x, y: pos.y, z: pos.z });
    socket.emit('ability', { type: 'dash' });
    setCd('e', 14);
  } else if (agent === 'omen') {
    const o = eyePos(), d = shootDir();
    const wallD = rayWalls(o, d, 45);
    const at = o.clone().add(d.clone().multiplyScalar(Math.min(wallD, 42)));
    spawnSmokeMesh(at);
    socket.emit('ability', { type: 'smoke', at: [at.x, at.z] });
    setCd('e', 18);
  } else if (agent === 'sova') {
    const o = eyePos(), d = shootDir();
    const wallD = rayWalls(o, d, 45);
    const at = o.clone().add(d.clone().multiplyScalar(Math.min(wallD, 45)));
    // 범위 피해
    for (const [id, p] of players) {
      if (id === socket.id || p.team === me.team || !p.alive) continue;
      const dd = Math.hypot(p.pos.x - at.x, p.pos.z - at.z);
      if (dd < 4.5) socket.emit('ability', { type: 'shock', targetId: id, damage: 40 });
    }
    spawnImpact(at);
    addFeed('⚡ 쇼크 다트 폭발');
    socket.emit('ability', { type: 'shock-fx', at: [at.x, at.z] });
    setCd('e', 16);
  } else if (agent === 'sage') {
    // 힐: 조준한 아군 or 자신
    const o = eyePos(), d = shootDir();
    let best = null, bestD = 6;
    for (const [id, p] of players) {
      if (id === socket.id || p.team !== me.team || !p.alive) continue;
      const h = rayPlayer(o, d, p, 6);
      if (h && h.dist < bestD) { bestD = h.dist; best = p; }
    }
    if (best) { socket.emit('ability', { type: 'heal', targetId: best.id }); addFeed(`💚 ${best.name} 치유`); }
    else { myHp = Math.min(100, myHp + 40); updateHpHud(); addFeed('💚 자가 치유 +40'); socket.emit('ability', { type: 'heal-self' }); }
    setCd('e', 20);
  }
  renderAbilities();
}
function useUlt() {
  if (!alive || ultPoints < 6) { addFeed('🔒 궁극기 충전 필요 (킬로 충전)'); return; }
  const agent = me?.agent || selectedAgent;
  sfxAbility();
  if (agent === 'jett') {
    knives = 5; knivesMode = true; prevWeapon = myWeapon === 'knife' ? 'vandal' : myWeapon;
    myWeapon = 'vandal'; // 데미지는 knivesMode로 처리
    socket.emit('ability', { type: 'blades', spendUlt: true });
    addFeed('🔪 블레이드 스톰!');
    ultPoints = 0;
  } else if (agent === 'omen') {
    // 텔포: 조준점 최대 45m
    const o = eyePos(), d = shootDir();
    const wallD = rayWalls(o, d, 45);
    const at = o.clone().add(d.clone().multiplyScalar(Math.min(wallD - 1, 42)));
    pos.set(at.x, groundHeight(at.x, at.z, 2), at.z);
    collideMove(pos);
    socket.emit('teleport', { x: pos.x, y: pos.y, z: pos.z });
    socket.emit('ability', { type: 'tp', spendUlt: true });
    ultPoints = 0;
  } else if (agent === 'sova') {
    // 헌터스퓨리: 전방 벽관통 50m
    const o = eyePos(), d = shootDir();
    for (const [id, p] of players) {
      if (id === socket.id || p.team === me.team || !p.alive) continue;
      const h = rayPlayer(o, d, p, 55);
      if (h) socket.emit('ability', { type: 'fury', targetId: id, damage: 80 });
    }
    const end = o.clone().add(d.clone().multiplyScalar(55));
    spawnTracer(o, end, 0x4da6ff);
    socket.emit('ability', { type: 'fury-fx', spendUlt: true });
    addFeed('☄️ 헌터스 퓨리!');
    ultPoints = 0;
  } else if (agent === 'sage') {
    // 부활: 10m 내 죽은 아군
    let best = null, bd = 12;
    for (const [id, p] of players) {
      if (p.team !== me.team || p.alive) continue;
      const dd = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
      if (dd < bd) { bd = dd; best = p; }
    }
    if (best) {
      socket.emit('ability', { type: 'resurrect', targetId: best.id, spendUlt: true });
      addFeed(`✨ ${best.name} 부활 요청`);
      // 로컬 즉시 부활 표시 (서버는 체력만 관리하므로 클라에서 살리기)
      best.alive = true;
      ultPoints = 0;
    } else addFeed('주변에 부활할 아군이 없음');
    if (ultPoints !== 0) return;
  }
  renderAbilities(); updateUltHud();
}
function canUse(slot) {
  const now = performance.now();
  if (cooldowns[slot] > now) return false;
  if (slot !== 'x' && abilityCharges[slot] <= 0) { addFeed('스킬 충전 없음 (상점에서 구매 B)'); return false; }
  return true;
}
function setCd(slot, sec) {
  cooldowns[slot] = performance.now() + sec * 1000;
  if (slot === 'q' || slot === 'e') abilityCharges[slot] = Math.max(0, abilityCharges[slot] - 1);
}
function flashOverlay(strength, enemy = true) {
  const f = document.getElementById('flash-overlay');
  f.style.transition = 'none'; f.style.opacity = strength;
  requestAnimationFrame(() => { f.style.transition = 'opacity 1.2s'; f.style.opacity = 0; });
  blindUntil = performance.now() + strength * 2500;
  sfxFlash();
}

// ================= HUD =================
function updateHpHud() {
  document.getElementById('hp-num').textContent = Math.max(0, Math.ceil(myHp));
  document.getElementById('hp-fill').style.width = Math.max(0, myHp) + '%';
  document.getElementById('armor-num').textContent = '🛡 ' + myArmor;
}
function updateAmmoHud() {
  if (knivesMode) { document.getElementById('ammo-num').textContent = `🔪 ${knives}`; return; }
  const a = ammo[myWeapon];
  document.getElementById('ammo-num').textContent = a.mag === Infinity ? '— / —' : `${a.mag} / ${a.reserve}${reloading ? ' …장전중' : ''}`;
}
function updateWeaponHud() { document.getElementById('weapon-name').textContent = knivesMode ? 'BLADE STORM' : (WEAPONS[myWeapon]?.name || myWeapon); }
function updateUltHud() { renderAbilities(); }
function renderAbilities() {
  const agent = AGENTS[me?.agent || selectedAgent];
  const el = document.getElementById('abilities');
  const now = performance.now();
  const mk = (slot, key, ab, charges) => {
    const cd = cooldowns[slot] > now;
    const cls = slot === 'x' ? `ab ult ${ultPoints >= 6 ? 'ready' : 'cd'}` : `ab ${(!cd && charges > 0) ? 'ready' : 'cd'}`;
    const sub = slot === 'x' ? `${ultPoints}/6` : `x${charges}`;
    return `<div class="${cls}"><span class="key">${key}</span><div>${ab.icon}</div><small>${sub}</small></div>`;
  };
  el.innerHTML = mk('q', 'Q', agent.q, abilityCharges.q) + mk('e', 'E', agent.e, abilityCharges.e) + mk('x', 'X', agent.x, 0);
}
function addFeed(html) {
  const kf = document.getElementById('killfeed');
  const div = document.createElement('div');
  div.className = 'kf'; div.innerHTML = html;
  kf.prepend(div);
  while (kf.children.length > 6) kf.lastChild.remove();
  setTimeout(() => div.remove(), 6000);
}
function addKillFeed(killer, victim, headshot, weapon) {
  addFeed(`<b style="color:${killer.team === 'attack' ? '#ff8089' : '#7df0e0'}">${killer.name}</b> <span style="color:#8fa3b0">[${weapon||''}${headshot ? ' <span class=hs>HEAD</span>' : ''}]</span> <b>${victim.name}</b>`);
}
function renderScoreboard() {
  const sb = document.getElementById('scoreboard');
  const atks = [...players.values()].filter(p => p.team === 'attack');
  const defs = [...players.values()].filter(p => p.team === 'defense');
  const row = (p) => `<tr><td>${p.name} ${p.id === socket?.id ? '(나)' : ''} ${p.hasSpike ? '💣' : ''}</td><td>${AGENTS[p.agent]?.name || ''}</td><td>${p.kills}</td><td>${p.deaths}</td><td>$${p.money}</td><td>${p.alive ? '🟢' : '💀'}</td></tr>`;
  sb.innerHTML = `<h3 style="color:#ff8089">ATTACK ${roundState?.scoreAtk ?? 0}</h3><table><tr><th>플레이어</th><th>요원</th><th>K</th><th>D</th><th>$</th><th></th></tr>${atks.map(row).join('')}</table>
  <h3 style="color:#7df0e0;margin-top:10px">DEFENSE ${roundState?.scoreDef ?? 0}</h3><table><tr><th>플레이어</th><th>요원</th><th>K</th><th>D</th><th>$</th><th></th></tr>${defs.map(row).join('')}</table>`;
}
function fmtTime(s) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

// 상점
function toggleShop(force) {
  const shop = document.getElementById('shop');
  const show = force !== undefined ? force : !shop.classList.contains('on');
  if (show && roundState?.phase !== 'buy') { addFeed('구매는 BUY 페이즈에만!'); return; }
  shop.classList.toggle('on', show);
  if (show) { document.exitPointerLock?.(); renderShop(); }
  else if (pointerLocked === false && alive && document.getElementById('lobby').style.display === 'none') renderer.domElement.requestPointerLock();
}
function renderShop() {
  document.getElementById('money').textContent = '$' + money;
  const g = document.getElementById('shop-grid');
  g.innerHTML = '';
  for (const it of SHOP_ITEMS) {
    const w = WEAPONS[it.id];
    const d = document.createElement('div');
    d.className = 'gun' + (myWeapon === it.id ? ' cur' : '');
    d.innerHTML = `<div><b>${w.name}</b><br><span>${it.desc} · ${w.damage} dmg</span></div><div class="price">$${w.price}</div>`;
    d.onclick = () => { socket.emit('buy', { item: it.id }); };
    g.appendChild(d);
  }
  const extra = [
    { id: 'armor', name: 'HEAVY SHIELD', desc: '아머 50', price: 1000 },
    { id: 'ability', name: 'SKILL CHARGE', desc: 'Q/E 충전 +1', price: 300 },
  ];
  for (const e of extra) {
    const d = document.createElement('div');
    d.className = 'gun';
    d.innerHTML = `<div><b>${e.name}</b><br><span>${e.desc}</span></div><div class="price">$${e.price}</div>`;
    d.onclick = () => { socket.emit('buy', { item: e.id }); if (e.id === 'ability') { abilityCharges.q++; abilityCharges.e++; renderAbilities(); } };
    g.appendChild(d);
  }
}

// 미니맵
const mm = document.getElementById('minimap').getContext('2d');
function drawMinimap() {
  const W = 200, S = W / 72;
  const tx = (x) => (x + 36) * S, tz = (z) => (z + 36) * S;
  mm.fillStyle = '#0d1620'; mm.fillRect(0, 0, W, W);
  // 사이트
  mm.fillStyle = 'rgba(255,70,85,0.25)'; mm.fillRect(tx(SITES.A.x1), tz(SITES.A.z1), (SITES.A.x2 - SITES.A.x1) * S, (SITES.A.z2 - SITES.A.z1) * S);
  mm.fillStyle = 'rgba(0,229,204,0.25)'; mm.fillRect(tx(SITES.B.x1), tz(SITES.B.z1), (SITES.B.x2 - SITES.B.x1) * S, (SITES.B.z2 - SITES.B.z1) * S);
  mm.fillStyle = '#8fa3b0'; mm.font = 'bold 12px sans-serif';
  mm.fillText('A', tx(-17) - 4, tz(10) + 4); mm.fillText('B', tx(17) - 4, tz(10) + 4);
  mm.fillText('ATK', 85, tz(-26)); mm.fillText('DEF', 85, tz(26));
  // 연막
  mm.fillStyle = 'rgba(200,200,200,0.7)';
  for (const s of smokes) { mm.beginPath(); mm.arc(tx(s.pos.x), tz(s.pos.z), 8, 0, 7); mm.fill(); }
  // 스파이크
  const sp = roundState?.spike;
  if (sp?.planted && sp.pos) { mm.fillStyle = '#ff2222'; mm.fillRect(tx(sp.pos.x) - 3, tz(sp.pos.z) - 3, 6, 6); }
  else if (sp?.dropped) { mm.fillStyle = '#ffaa00'; mm.fillRect(tx(sp.dropped.x) - 3, tz(sp.dropped.z) - 3, 6, 6); }
  const now = performance.now();
  for (const [id, p] of players) {
    if (!p.alive) continue;
    const isMe = id === socket?.id;
    const isMate = p.team === me?.team;
    const revealedNow = revealed.get(id) > now;
    const shotRecently = now - (lastShotAt.get(id) || 0) < 2500;
    const nearMe = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z) < 16;
    if (!isMe && !isMate && !revealedNow && !shotRecently && !nearMe) continue;
    mm.fillStyle = isMe ? '#ffffff' : (p.team === 'attack' ? '#ff4655' : '#00e5cc');
    if (!isMate && !isMe) mm.fillStyle = '#ff2222';
    mm.beginPath(); mm.arc(tx(p.pos.x), tz(p.pos.z), isMe ? 4 : 3, 0, 7); mm.fill();
    if (isMe) {
      mm.strokeStyle = '#fff';
      mm.beginPath(); mm.moveTo(tx(p.pos.x), tz(p.pos.z));
      mm.lineTo(tx(p.pos.x) + Math.sin(-yaw) * -10, tz(p.pos.z) + Math.cos(-yaw) * -10); mm.stroke();
    }
  }
}

// ================= 네트워크 =================
document.getElementById('start-btn').onclick = () => {
  const nick = document.getElementById('nick').value.trim() || ('요원' + Math.floor(Math.random() * 900 + 100));
  const custom = document.getElementById('server-url').value.trim();
  const url = custom || undefined;
  socket = url ? io(url) : io();
  bindSocket();
  socket.emit('join', { name: nick, agent: selectedAgent });
};

function bindSocket() {
  socket.on('joined', ({ me: m, snapshot }) => {
    me = m;
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('hud').classList.add('on');
    applySnapshot(snapshot);
    pos.set(me.pos.x, 0, me.pos.z);
    yaw = me.team === 'attack' ? Math.PI : 0;
    myWeapon = me.weapon || 'vandal';
    money = me.money; hasSpike = !!me.hasSpike;
    buildViewmodel(); updateAllHud();
    renderAbilities();
    renderer.domElement.requestPointerLock();
    addFeed(`✅ ${me.name} — ${me.team === 'attack' ? '공격팀' : '수비팀'} (${AGENTS[me.agent].name})`);
    setInterval(sendMove, 50);
  });
  socket.on('players', (list) => { for (const p of list) upsertPlayer(p); });
  socket.on('player-joined', (p) => { upsertPlayer(p); addFeed(`➕ ${p.name} 참가 (${p.team === 'attack' ? '공격' : '수비'})`); });
  socket.on('player-left', (id) => { const m = players.get(id)?.mesh; if (m) scene.remove(m); players.delete(id); });
  socket.on('tick', applySnapshot);
  socket.on('phase', applySnapshot);
  socket.on('round-start', (s) => {
    applySnapshot(s);
    alive = true; myHp = 100;
    document.getElementById('respawn-msg').style.display = 'none';
    const p = players.get(socket.id);
    if (p) { pos.set(p.pos.x, 0, p.pos.z); yaw = me?.team === 'attack' ? Math.PI : 0; }
    for (const k of Object.keys(ammo)) { const w = WEAPONS[k]; if (isFinite(w.mag)) ammo[k] = { mag: w.mag, reserve: w.reserve }; }
    abilityCharges = { q: 1, e: 1 };
    knivesMode = false;
    myWeapon = players.get(socket.id)?.weapon || myWeapon;
    buildViewmodel(); updateAllHud(); renderAbilities();
    showBanner(`ROUND ${s.round.number}`, s.round.phase === 'buy' ? 'BUY PHASE — B를 눌러 구매' : '');
    if (s.round.phase === 'buy') toggleShop(true);
  });
  socket.on('round-end', (s) => {
    applySnapshot(s);
    const win = s.winnerTeam === me?.team;
    showBanner(win ? 'VICTORY' : 'DEFEAT', s.reason + ` — ${s.round.scoreAtk} : ${s.round.scoreDef}`);
    document.getElementById('shop').classList.remove('on');
    if (s.matchOver) showBanner('MATCH END', (s.matchWinner === me?.team ? '승리!' : '패배...') + ' 10초 후 재시작');
  });
  socket.on('half-time', ({ message }) => addFeed('🔄 ' + message));
  socket.on('tracer', ({ from, dir, id }) => {
    const p = players.get(id);
    if (!p) return;
    lastShotAt.set(id, performance.now());
    const o = new THREE.Vector3(from[0], from[1], from[2]);
    const d = new THREE.Vector3(dir[0], dir[1], dir[2]);
    const e = o.clone().add(d.clone().multiplyScalar(40));
    spawnTracer(o, e, 0xff8888);
    sfxShot('phantom', true);
  });
  socket.on('damage', ({ victimId, attackerId, damage, headshot }) => {
    if (victimId === socket.id) {
      myHp -= damage;
      updateHpHud();
      const v = document.getElementById('dmg-vignette');
      v.style.boxShadow = 'inset 0 0 140px rgba(255,0,0,0.85)';
      setTimeout(() => v.style.boxShadow = 'inset 0 0 120px rgba(255,0,0,0)', 180);
      if (myHp <= 0) die();
    }
    if (attackerId === socket.id) {
      hitmarker(headshot);
      sfxHit(headshot);
    }
  });
  socket.on('hit-confirm', () => {});
  socket.on('kill', ({ killer, victim }) => {
    const kp = players.get(killer.id), vp = players.get(victim.id);
    if (vp) vp.alive = false;
    if (kp) kp.kills = killer.killerKills ?? kp.kills;
    addKillFeed(killer, victim, killer.headshot, killer.weapon);
    if (killer.id === socket.id) {
      sfxKill(); ultPoints = Math.min(8, ultPoints + 1); renderAbilities();
      showKillBanner(victim.name);
    }
    if (victim.id === socket.id) die();
  });
  socket.on('healed', ({ targetId, hp }) => {
    if (targetId === socket.id) { myHp = hp; updateHpHud(); }
  });
  socket.on('ability', onRemoteAbility);
  socket.on('plant-progress', ({ progress, by }) => {
    const w = document.getElementById('progress-wrap');
    if (progress > 0) { w.style.display = 'block'; document.getElementById('progress-label').textContent = `💣 ${by} 설치 중...`; document.getElementById('progress-fill').style.width = (progress * 100) + '%'; }
    else w.style.display = 'none';
  });
  socket.on('defuse-progress', ({ progress, by }) => {
    const w = document.getElementById('progress-wrap');
    if (progress > 0) { w.style.display = 'block'; document.getElementById('progress-label').textContent = `🛠️ ${by} 해체 중...`; document.getElementById('progress-fill').style.background = '#00e5cc'; document.getElementById('progress-fill').style.width = (progress * 100) + '%'; }
    else { w.style.display = 'none'; document.getElementById('progress-fill').style.background = '#ff4655'; }
  });
  socket.on('spike-planted', ({ site, pos: sp, by }) => {
    sfxPlant();
    addFeed(`💣 ${by} 스파이크 설치! [${site}] — 40초!`);
    showBanner('SPIKE PLANTED', `${site} 사이트 — 수비팀은 해체하라!`);
    spikeMesh.visible = true; spikeMesh.position.set(sp.x, 0, sp.z);
  });
  socket.on('spike-beep', () => sfxPlant(true));
  socket.on('spike-exploded', () => { addFeed('💥 스파이크 폭발!'); spikeMesh.visible = false; });
  socket.on('spike-pickup', ({ by }) => addFeed(`💣 ${by} 스파이크 획득`));
  socket.on('bought', ({ weapon, money: m, armor }) => {
    money = m; myArmor = armor; myWeapon = weapon; prevWeapon = weapon;
    const w = WEAPONS[weapon];
    ammo[weapon] = { mag: w.mag, reserve: w.reserve };
    buildViewmodel(); updateAllHud(); renderShop();
    document.getElementById('money-hud').textContent = '$' + money;
  });
  socket.on('chat', ({ name, team, text }) => {
    const c = document.getElementById('chat');
    const d = document.createElement('div');
    d.className = 'msg' + (team === 'attack' ? ' atk' : '');
    d.textContent = `${name}: ${text}`;
    c.appendChild(d);
    while (c.children.length > 6) c.firstChild.remove();
    setTimeout(() => d.remove(), 8000);
  });
}

function upsertPlayer(p) {
  let e = players.get(p.id);
  if (!e) {
    const mesh = p.id === socket?.id ? null : makePlayerMesh(p);
    if (mesh) scene.add(mesh);
    e = { ...p, mesh, interp: { x: p.pos.x, z: p.pos.z } };
    players.set(p.id, e);
  } else {
    const mesh = e.mesh;
    Object.assign(e, p);
    e.mesh = mesh;
  }
  if (p.id === socket?.id) {
    me = { ...me, ...p };
    hasSpike = !!p.hasSpike;
    money = p.money; myArmor = p.armor; ultPoints = p.ultPoints ?? ultPoints;
    if (!alive && p.alive) { alive = true; myHp = 100; document.getElementById('respawn-msg').style.display = 'none'; }
    if (!p.alive && alive) { /* 서버가 죽음 처리 */ }
    document.getElementById('money-hud').textContent = '$' + money;
  }
}

function applySnapshot(s) {
  roundState = s.round;
  for (const p of s.players) upsertPlayer(p);
  // 떠난 플레이어 정리
  const ids = new Set(s.players.map(p => p.id));
  for (const [id, e] of players) if (!ids.has(id)) { if (e.mesh) scene.remove(e.mesh); players.delete(id); }
  // 스파이크 표시
  const sp = s.round.spike;
  if (sp.planted && sp.pos) { spikeMesh.visible = true; spikeMesh.position.set(sp.pos.x, 0, sp.pos.z); }
  else if (!sp.planted && !sp.holder && sp.dropped) {
    spikeMesh.visible = true; spikeMesh.position.set(sp.dropped.x, 0, sp.dropped.z);
  } else if (sp.holder) {
    // 들고 있으면 숨김 (미니맵에만)
    if (!sp.planted) spikeMesh.visible = false;
  } else spikeMesh.visible = false;
  updateTopbar();
}

function sendMove() {
  if (!socket || !me) return;
  socket.emit('move', { x: pos.x, y: pos.y, z: pos.z, yaw, pitch, moving: !!(keys['KeyW'] || keys['KeyA'] || keys['KeyS'] || keys['KeyD']), crouch });
}

function onRemoteAbility({ id, type, at, targetId }) {
  lastShotAt.set(id, performance.now());
  if (type === 'smoke' && at) spawnSmokeMesh({ x: at[0], z: at[1] });
  if (type === 'slow' && at) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 0.15, 24),
      new THREE.MeshStandardMaterial({ color: 0x5dffb0, transparent: true, opacity: 0.5 }));
    m.position.set(at[0], 0.08, at[1]); scene.add(m);
    slows.push({ mesh: m, pos: { x: at[0], z: at[1] }, until: performance.now() + 8000 });
  }
  if (type === 'blind' && targetId === socket.id) flashOverlay(0.9);
  if (type === 'recon') addFeed('📡 적 정찰 화살!');
  if (type === 'shock-fx' && at) { spawnImpact(new THREE.Vector3(at[0], 1, at[1])); }
  if (type === 'fury-fx') addFeed('☄️ 적 헌터스 퓨리!');
  if (type === 'dash' || type === 'updraft' || type === 'tp') { /* 원격 위치는 move로 동기화 */ }
}

function sendChat() {
  const ci = document.getElementById('chat-input');
  const t = ci.value.trim();
  if (t) socket.emit('chat', t);
  ci.value = ''; ci.blur(); ci.style.display = 'none';
  renderer.domElement.requestPointerLock();
}

// ================= 죽음/리스폰 =================
function die() {
  if (!alive) return;
  alive = false; firing = false;
  document.getElementById('respawn-msg').style.display = 'block';
  document.getElementById('shop').classList.remove('on');
}
function showKillBanner(name) {
  const b = document.getElementById('kill-banner');
  b.textContent = `☠ ${name} 처치`;
  b.style.display = 'block'; b.style.color = '#ff4655';
  setTimeout(() => b.style.display = 'none', 1200);
}
let bannerTO = null;
function showBanner(h, p) {
  const b = document.getElementById('round-banner');
  b.querySelector('h2').textContent = h; b.querySelector('p').textContent = p;
  b.style.display = 'block';
  clearTimeout(bannerTO);
  bannerTO = setTimeout(() => b.style.display = 'none', 3500);
}
function hitmarker(hs) {
  const h = document.getElementById('hitmarker');
  h.classList.remove('show', 'hs'); void h.offsetWidth;
  if (hs) h.classList.add('hs');
  h.classList.add('show');
}

// ================= 메인 루프 =================
const clock = new THREE.Clock();
let stepTimer = 0, plantTick = 0, hintCd = 0;

function updateTopbar() {
  if (!roundState) return;
  document.getElementById('score-atk').textContent = roundState.scoreAtk;
  document.getElementById('score-def').textContent = roundState.scoreDef;
  document.getElementById('round-timer').textContent = fmtTime(roundState.timer);
  const phaseKr = roundState.phase === 'buy' ? 'BUY PHASE' : roundState.phase === 'live' ? 'COMBAT' : 'ROUND END';
  document.getElementById('round-num').textContent = `ROUND ${roundState.number} • ${phaseKr}`;
  const pl = document.getElementById('phase-label');
  pl.textContent = roundState.phase.toUpperCase();
  pl.classList.toggle('live', roundState.phase === 'live');
  // 스파이크 HUD
  const sh = document.getElementById('spike-hud');
  const sp = roundState.spike;
  if (sp.planted) { sh.style.display = 'block'; sh.textContent = `💣 SPIKE ${fmtTime(Math.ceil(sp.explodeTimer))} — ${sp.site} 사이트`; }
  else if (hasSpike) { sh.style.display = 'block'; sh.textContent = '💣 스파이크 보유 중 — 사이트에서 [4] 길게 눌러 설치'; }
  else if (sp.dropped) { sh.style.display = 'block'; sh.textContent = '💣 스파이크 드랍됨 — 주우러 가세요 (공격팀)'; }
  else { sh.style.display = 'none'; }
}

function inSite(posv) {
  for (const [k, s] of Object.entries(SITES)) {
    if (posv.x >= s.x1 && posv.x <= s.x2 && posv.z >= s.z1 && posv.z <= s.z2) return k;
  }
  return null;
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now();

  // 원격 플레이어 보간 + 메시 갱신
  for (const [id, p] of players) {
    if (id === socket?.id || !p.mesh) continue;
    p.interp.x += (p.pos.x - p.interp.x) * Math.min(1, dt * 12);
    p.interp.z += (p.pos.z - p.interp.z) * Math.min(1, dt * 12);
    p.mesh.position.set(p.interp.x, p.pos.y || 0, p.interp.z);
    p.mesh.rotation.y = -p.yaw + Math.PI;
    p.mesh.visible = p.alive;
    // 공개(정찰) 시 외곽선
    const rev = revealed.get(id) > now;
    p.mesh.userData.body.material.emissive = new THREE.Color(rev ? 0xff0000 : 0x000000);
  }

  if (me) {
    // 이동 물리
    if (alive) {
      const slowed = slows.some(s => Math.hypot(pos.x - s.pos.x, pos.z - s.pos.z) < 3 && s.until > now);
      const inSlow = slowed || now < slowedUntil;
      let speed = keys['ShiftLeft'] ? 2.7 : 5.3;
      if (keys['KeyC']) speed = 2.6;
      if (ads) speed *= 0.6;
      if (inSlow) speed *= 0.45;
      crouch = !!keys['KeyC'];
      const f = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
      const s = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);
      const sin = Math.sin(yaw), cos = Math.cos(yaw);
      // yaw=0 이 -z 를 보는 three 관례: 전진 = (-sin, -cos)
      const wish = new THREE.Vector3((-sin) * f + (cos) * s, 0, (-cos) * f + (-sin) * s);
      if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);
      const accel = onGround ? 14 : 3;
      vel.x += (wish.x - vel.x) * Math.min(1, dt * accel);
      vel.z += (wish.z - vel.z) * Math.min(1, dt * accel);
      // 중력/점프
      vel.y -= 20 * dt;
      if (keys['Space'] && onGround) { vel.y = 6.8; onGround = false; }
      pos.x += vel.x * dt; pos.z += vel.z * dt; pos.y += vel.y * dt;
      collideMove(pos);
      const g = groundHeight(pos.x, pos.z, pos.y + 0.5);
      if (pos.y <= g) { pos.y = g; vel.y = 0; onGround = true; }
      else if (pos.y > g + 0.05) onGround = false;

      // 발소리
      if (wish.lengthSq() > 1 && onGround) {
        stepTimer -= dt * (keys['ShiftLeft'] ? 0.5 : 1);
        if (stepTimer <= 0) { stepTimer = 0.38; if (!keys['ShiftLeft']) sfxStep(); }
      }
      // 카메라
      camera.position.set(pos.x, pos.y + (crouch ? 1.15 : 1.62), pos.z);
      camera.rotation.set(0, 0, 0);
      camera.rotation.order = 'YXZ';
      camera.rotation.y = yaw; camera.rotation.x = pitch;
      // ADS 줌
      const targetFov = ads ? (WEAPONS[myWeapon]?.sniper ? 25 : 55) : 75;
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
      camera.updateProjectionMatrix();
      // 총 반동 회복
      spreadBloom = Math.max(0, spreadBloom - dt * 4);
      updateCrosshair();

      // 발사
      if (firing) {
        if (WEAPONS[myWeapon]?.auto || knivesMode) tryFire(now);
        else { tryFire(now); firing = false; }
      }
      if (reloading && now > reloadEnd - 100) updateAmmoHud();

      // 스파이크 설치/해체 (4번 홀드)
      if (keys['Digit4'] && roundState?.phase === 'live') {
        plantTick -= dt;
        if (plantTick <= 0) {
          plantTick = 0.25;
          if (me.team === 'attack' && hasSpike) {
            if (inSite(pos)) socket.emit('plant-hold');
            else if (hintCd < now) { hint('사이트 안(A/B 주황 구역)에서 설치 가능!', now); }
          } else if (me.team === 'defense' && roundState.spike.planted) {
            socket.emit('defuse-hold');
          }
        }
      } else {
        if (plantTick !== 0) { socket.emit('plant-stop'); socket.emit('defuse-stop'); plantTick = 0; }
      }
      // 힌트
      updateHint(now);
    } else {
      // 사망 시 카메라는 그대로
    }
  }

  // 트레이서 페이드
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    t.life -= dt;
    t.line.material.opacity = Math.max(0, t.life / 0.12);
    if (t.life <= 0) { scene.remove(t.line); tracers.splice(i, 1); }
  }
  // 연막/슬로우 만료
  for (let i = smokes.length - 1; i >= 0; i--) {
    if (smokes[i].until < now) { scene.remove(smokes[i].mesh); smokes.splice(i, 1); }
  }
  for (let i = slows.length - 1; i >= 0; i--) {
    if (slows[i].until < now) { scene.remove(slows[i].mesh); slows.splice(i, 1); }
  }
  // 스파이크 점멸
  if (spikeMesh?.visible && spikeLight) spikeLight.intensity = 1.5 + Math.sin(now * 0.012) * 1.2;
  // 실명 페이드
  if (blindUntil < now && document.getElementById('flash-overlay').style.opacity > 0) {
    // flashOverlay가 알아서 페이드
  }

  drawMinimap();
  renderer.render(scene, camera);
}

function updateCrosshair() {
  const moving = (keys['KeyW'] || keys['KeyA'] || keys['KeyS'] || keys['KeyD']);
  const gap = 6 + spreadBloom * 5 + (moving ? 6 : 0) + (onGround ? 0 : 8) - (ads ? 5 : 0);
  const len = ads ? 5 : 9;
  const t = document.getElementById('ch-t'), b = document.getElementById('ch-b'), l = document.getElementById('ch-l'), r = document.getElementById('ch-r');
  const th = 2;
  t.style.cssText = `left:50%;top:50%;width:${th}px;height:${len}px;transform:translate(-50%,calc(-100% - ${gap}px))`;
  b.style.cssText = `left:50%;top:50%;width:${th}px;height:${len}px;transform:translate(-50%,${gap}px)`;
  l.style.cssText = `left:50%;top:50%;width:${len}px;height:${th}px;transform:translate(calc(-100% - ${gap}px),-50%)`;
  r.style.cssText = `left:50%;top:50%;width:${len}px;height:${th}px;transform:translate(${gap}px,-50%)`;
}
function hint(text, now) {
  const h = document.getElementById('hint');
  h.textContent = text; h.style.display = 'block';
  hintCd = now + 2500;
  setTimeout(() => h.style.display = 'none', 2000);
}
function updateHint(now) {
  if (hintCd > now) return;
  const h = document.getElementById('hint');
  if (!roundState) return;
  if (roundState.phase === 'buy') { h.textContent = 'B — 상점 열기 · 곧 전투 시작! 클릭으로 조준 고정'; h.style.display = 'block'; return; }
  if (!pointerLocked) { h.textContent = '클릭하여 조준 고정 (마우스 락)'; h.style.display = 'block'; return; }
  if (!alive) { h.style.display = 'none'; return; }
  const site = inSite(pos);
  if (me?.team === 'attack' && hasSpike && site) { h.textContent = `[4] 길게 눌러 스파이크 설치 (${site} 사이트)`; h.style.display = 'block'; return; }
  if (me?.team === 'defense' && roundState.spike.planted) { h.textContent = '스파이크 찾아가 [4] 길게 눌러 해체 (7초)'; h.style.display = 'block'; return; }
  h.style.display = 'none';
}

function updateAllHud() {
  updateHpHud(); updateAmmoHud(); updateWeaponHud(); renderAbilities();
  document.getElementById('money-hud').textContent = '$' + money;
  updateTopbar();
}

// 초기 카메라 (로비 배경)
camera.position.set(0, 14, -40);
camera.lookAt(0, 0, 10);
(function lobbyCam() {
  if (document.getElementById('lobby').style.display !== 'none') {
    const t = performance.now() * 0.0001;
    camera.position.set(Math.sin(t) * 30, 16, Math.cos(t) * 30 - 5);
    camera.lookAt(0, 0, 5);
    renderer.render(scene, camera);
    requestAnimationFrame(lobbyCam);
  } else animate();
})();
