// VALORANT-like Tactical FPS Server
// 팀, 라운드, 스파이크, 머니, 킬 처리 - Authoritative (판정 보조)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// ---------- 상수 ----------
const ROUND_BUY_TIME = 20;
const ROUND_LIVE_TIME = 100;
const ROUND_END_TIME = 6;
const PLANT_TIME = 4.0;
const DEFUSE_TIME = 7.0;
const SPIKE_EXPLODE_TIME = 40;
const WIN_SCORE = 7;
const HALF_ROUND = 6; // 6라운드 후 공수교대
const START_MONEY = 800;

const SITE_A = { x1: -24, x2: -10, z1: 2, z2: 18 };
const SITE_B = { x1: 10, x2: 24, z1: 2, z2: 18 };

function inSite(pos, site) {
  return pos.x >= site.x1 && pos.x <= site.x2 && pos.z >= site.z1 && pos.z <= site.z2;
}
function onSite(pos) {
  if (inSite(pos, SITE_A)) return 'A';
  if (inSite(pos, SITE_B)) return 'B';
  return null;
}

// ---------- 상태 ----------
const players = new Map(); // socketId -> player
let round = {
  number: 1,
  phase: 'buy', // buy | live | end
  timer: ROUND_BUY_TIME,
  scoreAtk: 0,
  scoreDef: 0,
  spike: {
    holder: null,      // playerId
    dropped: null,     // {x,z}
    planted: false,
    site: null,
    pos: null,
    plantProgress: 0,
    plantingBy: null,
    defusingBy: null,
    defuseProgress: 0,
    explodeTimer: 0,
  },
  endReason: '',
  winner: null,
};

function teamCounts() {
  let atk = 0, def = 0;
  for (const p of players.values()) {
    if (p.team === 'attack') atk++;
    else if (p.team === 'defense') def++;
  }
  return { atk, def };
}

function pickSpawn(team) {
  // 공격: 남쪽, 수비: 북쪽 + 약간 랜덤
  const r = () => (Math.random() - 0.5) * 6;
  if (team === 'attack') return { x: 0 + r(), y: 0, z: -26 + r() * 0.5 };
  return { x: 0 + r(), y: 0, z: 26 + r() * 0.5 };
}

function resetRoundPositions() {
  for (const p of players.values()) {
    const s = pickSpawn(p.team);
    p.pos = { ...s };
    p.hp = 100;
    p.alive = true;
    p.yaw = p.team === 'attack' ? Math.PI : 0; // 공격은 북쪽(+z?) 바라보게
    // 실제로: 공격 스폰 z=-26에서 +z 방향(북)을 봐야 함 => yaw=0 이 +z 가정시
    // 클라이언트와 맞춤: yaw=0 이 -z 를 보는 three.js 관례라면 반전 필요.
    // 여기선 단순화: attack yaw=Math.PI, defense yaw=0 으로 고정, 클라에서 해석.
    p.pitch = 0;
  }
}

function giveSpike() {
  const atks = [...players.values()].filter(p => p.team === 'attack');
  if (atks.length === 0) { round.spike.holder = null; return; }
  // 살아있는 랜덤 공격에게
  const holder = atks[Math.floor(Math.random() * atks.length)];
  round.spike.holder = holder.id;
  round.spike.dropped = null;
  round.spike.planted = false;
  round.spike.site = null;
  round.spike.pos = null;
  round.spike.plantProgress = 0;
  round.spike.plantingBy = null;
  round.spike.defusingBy = null;
  round.spike.defuseProgress = 0;
  holder.hasSpike = true;
  for (const p of players.values()) if (p.id !== holder.id) p.hasSpike = false;
}

function startRound() {
  round.phase = 'buy';
  round.timer = ROUND_BUY_TIME;
  round.endReason = '';
  round.winner = null;
  round.spike = {
    holder: null, dropped: null, planted: false, site: null, pos: null,
    plantProgress: 0, plantingBy: null, defusingBy: null, defuseProgress: 0, explodeTimer: 0,
  };
  resetRoundPositions();
  giveSpike();
  io.emit('round-start', snapshot());
}

function endRound(winnerTeam, reason) {
  if (round.phase === 'end') return;
  round.phase = 'end';
  round.timer = ROUND_END_TIME;
  round.winner = winnerTeam;
  round.endReason = reason;
  if (winnerTeam === 'attack') round.scoreAtk++;
  else if (winnerTeam === 'defense') round.scoreDef++;

  // 머니 지급
  for (const p of players.values()) {
    if (p.team === winnerTeam) p.money += 3000;
    else p.money += 1900;
    // 연패 보너스 간소화: 패배팀 추가 +500
    p.money = Math.min(p.money, 9000);
    p.hasSpike = false;
  }

  // 매치 종료 체크
  let matchOver = false, matchWinner = null;
  if (round.scoreAtk >= WIN_SCORE || round.scoreDef >= WIN_SCORE) {
    matchOver = true;
    matchWinner = round.scoreAtk > round.scoreDef ? 'attack' : 'defense';
  }

  io.emit('round-end', { ...snapshot(), reason, winnerTeam, matchOver, matchWinner });
  if (matchOver) {
    setTimeout(() => {
      round.number = 1; round.scoreAtk = 0; round.scoreDef = 0;
      // 팀 섞기? 그대로 유지
      for (const p of players.values()) p.money = START_MONEY;
      startRound();
    }, 10000);
  }
}

function nextRound() {
  // 하프타임 공수교대 (점수는 사이드 기준 유지, 플레이어 팀만 스왑)
  if (round.number === HALF_ROUND) {
    for (const p of players.values()) {
      p.team = p.team === 'attack' ? 'defense' : 'attack';
    }
    io.emit('half-time', { message: '하프타임! 공수가 교대됩니다.' });
  }
  round.number++;
  startRound();
}

function snapshot() {
  return {
    round: {
      number: round.number,
      phase: round.phase,
      timer: Math.ceil(round.timer),
      scoreAtk: round.scoreAtk,
      scoreDef: round.scoreDef,
      spike: { ...round.spike },
      winner: round.winner,
      endReason: round.endReason,
    },
    players: [...players.values()].map(p => ({ ...p })),
    sites: { A: SITE_A, B: SITE_B },
  };
}

// ---------- 틱 루프 ----------
setInterval(() => {
  if (players.size === 0) return;
  round.timer -= 0.25;

  // 설치 중/해체 중 진행 (plantingBy가 계속 plant-hold를 보내야 함)
  const sp = round.spike;

  if (round.phase === 'buy' && round.timer <= 0) {
    round.phase = 'live';
    round.timer = ROUND_LIVE_TIME;
    io.emit('phase', snapshot());
  } else if (round.phase === 'live') {
    // 스파이크 폭발
    if (sp.planted) {
      sp.explodeTimer -= 0.25;
      if (sp.explodeTimer <= 0) {
        io.emit('spike-exploded', { pos: sp.pos });
        endRound('attack', '스파이크 폭발');
      } else if (sp.explodeTimer <= 10 && Math.abs(sp.explodeTimer % 1) < 0.26) {
        io.emit('spike-beep', { timeLeft: sp.explodeTimer });
      }
    } else if (round.timer <= 0) {
      endRound('defense', '시간 만료 - 수비 승리');
    }
    // 전멸 체크
    const atkAlive = [...players.values()].some(p => p.team === 'attack' && p.alive);
    const defAlive = [...players.values()].some(p => p.team === 'defense' && p.alive);
    const hasAtk = [...players.values()].some(p => p.team === 'attack');
    const hasDef = [...players.values()].some(p => p.team === 'defense');
    if (hasAtk && hasDef) {
      if (!atkAlive && !sp.planted) endRound('defense', '공격팀 전멸');
      else if (!defAlive && !sp.planted) endRound('attack', '수비팀 전멸');
      else if (!defAlive && sp.planted) {
        // 설치 후 수비 전멸이어도 해체자가 없으면 공격 승리까지 대기 → 폭발까지 기다리지 않고 바로 끝내지 않음
        // 수비 전원 사망 시 공격 승리로 간주 (설치됨)
        endRound('attack', '수비팀 전멸 (스파이크 설치됨)');
      } else if (!atkAlive && sp.planted) {
        // 공격 전멸 + 설치됨 → 수비는 해체해야 함. 바로 끝내지 않고 해체/폭발까지 대기.
      }
    }
  } else if (round.phase === 'end' && round.timer <= 0) {
    nextRound();
  }

  io.emit('tick', snapshot());
}, 250);

// ---------- 소켓 ----------
io.on('connection', (socket) => {
  console.log('join', socket.id);

  socket.on('join', ({ name, agent }) => {
    const { atk, def } = teamCounts();
    const team = atk <= def ? 'attack' : 'defense';
    const spawn = pickSpawn(team);
    const player = {
      id: socket.id,
      name: (name || '요원').slice(0, 12),
      agent: agent || 'jett',
      team,
      pos: { ...spawn },
      yaw: team === 'attack' ? Math.PI : 0,
      pitch: 0,
      hp: 100,
      armor: 0,
      alive: true,
      kills: 0,
      deaths: 0,
      money: START_MONEY,
      weapon: 'vandal',
      hasSpike: false,
      ultPoints: 0,
      killsThisRound: 0,
    };
    players.set(socket.id, player);
    // 첫 접속자에게 스파이크가 없을 때 공격이면 재분배
    if (!round.spike.holder && team === 'attack') giveSpike();
    socket.emit('joined', { me: player, snapshot: snapshot() });
    socket.broadcast.emit('player-joined', player);
    io.emit('players', [...players.values()]);
  });

  socket.on('move', (d) => {
    const p = players.get(socket.id);
    if (!p || !p.alive) return;
    // 기본 검증: 맵 범위, 순간이동 방지
    if (typeof d.x !== 'number' || typeof d.z !== 'number') return;
    if (Math.abs(d.x) > 40 || Math.abs(d.z) > 40) return;
    const dx = d.x - p.pos.x, dz = d.z - p.pos.z;
    if (dx * dx + dz * dz > 25) return; // 너무 큰 이동 무시 (텔포 스킬은 별도 이벤트)
    p.pos = { x: d.x, y: d.y || 0, z: d.z };
    p.yaw = d.yaw; p.pitch = d.pitch;
    p.moving = !!d.moving;
    p.crouch = !!d.crouch;
    // 스파이크 드랍줍기
    const sp = round.spike;
    if (!sp.planted && !sp.holder && sp.dropped && p.team === 'attack' && p.alive) {
      const ddx = p.pos.x - sp.dropped.x, ddz = p.pos.z - sp.dropped.z;
      if (ddx * ddx + ddz * ddz < 2.5) {
        sp.holder = p.id; sp.dropped = null; p.hasSpike = true;
        io.emit('spike-pickup', { by: p.name, holder: p.id });
      }
    }
  });

  // 위치 강제 설정 (대시/텔포/업드래프트 승인)
  socket.on('teleport', (pos) => {
    const p = players.get(socket.id);
    if (!p || !p.alive) return;
    if (Math.abs(pos.x) > 35 || Math.abs(pos.z) > 35) return;
    p.pos = { x: pos.x, y: pos.y || 0, z: pos.z };
  });

  socket.on('tracer', (d) => {
    socket.broadcast.emit('tracer', { id: socket.id, ...d });
  });

  socket.on('hit', ({ victimId, damage, headshot, weapon }) => {
    const atk = players.get(socket.id);
    const vic = players.get(victimId);
    if (!atk || !vic || !atk.alive || !vic.alive) return;
    if (atk.team === vic.team) return;
    if (round.phase !== 'live') return;
    // 거리 검증 (월샷 간소화 허용 60m)
    const dx = atk.pos.x - vic.pos.x, dz = atk.pos.z - vic.pos.z;
    if (dx * dx + dz * dz > 3600) return;
    let dmg = Math.max(1, Math.min(200, damage | 0));
    if (vic.armor > 0) { dmg = Math.round(dmg * 0.66); vic.armor = Math.max(0, vic.armor - 25); }
    vic.hp -= dmg;
    socket.emit('hit-confirm', { victimId, headshot, damage: dmg, hpLeft: Math.max(0, vic.hp) });
    io.emit('damage', { victimId, attackerId: socket.id, damage: dmg, headshot });

    if (vic.hp <= 0) {
      vic.hp = 0; vic.alive = false; vic.deaths++;
      atk.kills++; atk.killsThisRound++;
      atk.money = Math.min(9000, atk.money + 300);
      atk.ultPoints = Math.min(8, (atk.ultPoints || 0) + 1);
      // 스파이크 드랍
      const sp = round.spike;
      if (sp.holder === vic.id) {
        sp.holder = null; vic.hasSpike = false;
        sp.dropped = { x: vic.pos.x, z: vic.pos.z };
      }
      io.emit('kill', {
        killer: { id: atk.id, name: atk.name, team: atk.team, weapon, headshot },
        victim: { id: vic.id, name: vic.name, team: vic.team },
        killerKills: atk.kills,
      });
    }
  });

  // 스킬 브로드캐스트 (연막, 섬광, 정찰 등 위치 공유)
  socket.on('ability', (d) => {
    const p = players.get(socket.id);
    if (!p || !p.alive) return;
    if (round.phase !== 'live' && round.phase !== 'buy') return;
    // 궁 포인트 차감은 클라이언트에서 체크, 서버는 브로드캐스트
    if (d.spendUlt) { if ((p.ultPoints || 0) < 6) return; p.ultPoints = 0; }
    socket.broadcast.emit('ability', { id: socket.id, team: p.team, agent: p.agent, ...d });
    // 자가 효과: 힐
    if (d.type === 'heal' && d.targetId) {
      const t = players.get(d.targetId);
      if (t && t.alive && t.team === p.team) {
        t.hp = Math.min(100, t.hp + 60);
        io.emit('healed', { targetId: t.id, hp: t.hp });
      }
    }
    // 쇼크다트/헌터스퓨리 데미지
    if ((d.type === 'shock' || d.type === 'fury') && d.targetId && d.damage) {
      const t = players.get(d.targetId);
      if (t && t.alive && t.team !== p.team) {
        t.hp -= d.damage;
        io.emit('damage', { victimId: t.id, attackerId: p.id, damage: d.damage, headshot: false });
        if (t.hp <= 0) {
          t.hp = 0; t.alive = false; t.deaths++; p.kills++;
          p.money = Math.min(9000, p.money + 300);
          io.emit('kill', {
            killer: { id: p.id, name: p.name, team: p.team, weapon: d.type, headshot: false },
            victim: { id: t.id, name: t.name, team: t.team },
            killerKills: p.kills,
          });
        }
      }
    }
  });

  // 설치 / 해체: 누르고 있는 동안 클라이언트가 4Hz로 hold 전송
  socket.on('plant-hold', () => {
    const p = players.get(socket.id);
    const sp = round.spike;
    if (!p || !p.alive || round.phase !== 'live' || sp.planted) return;
    if (sp.holder !== p.id) return;
    if (p.team !== 'attack') return;
    const site = onSite(p.pos);
    if (!site) { sp.plantProgress = 0; sp.plantingBy = null; return; }
    sp.plantingBy = p.id;
    sp.plantProgress += 0.25; // tick 250ms마다 호출 가정
    io.emit('plant-progress', { progress: sp.plantProgress / PLANT_TIME, by: p.name });
    if (sp.plantProgress >= PLANT_TIME) {
      sp.planted = true; sp.site = site;
      sp.pos = { x: p.pos.x, z: p.pos.z };
      sp.explodeTimer = SPIKE_EXPLODE_TIME;
      sp.holder = null; p.hasSpike = false;
      sp.plantProgress = 0; sp.plantingBy = null;
      round.timer = Math.max(round.timer, SPIKE_EXPLODE_TIME); // 라운드 시간 연장
      io.emit('spike-planted', { site, pos: sp.pos, by: p.name });
    }
  });

  socket.on('plant-stop', () => {
    const sp = round.spike;
    if (sp.plantingBy === socket.id && !sp.planted) {
      sp.plantProgress = 0; sp.plantingBy = null;
      io.emit('plant-progress', { progress: 0, by: null });
    }
  });

  socket.on('defuse-hold', () => {
    const p = players.get(socket.id);
    const sp = round.spike;
    if (!p || !p.alive || !sp.planted || round.phase !== 'live') return;
    if (p.team !== 'defense') return;
    const dx = p.pos.x - sp.pos.x, dz = p.pos.z - sp.pos.z;
    if (dx * dx + dz * dz > 9) { sp.defuseProgress = 0; sp.defusingBy = null; return; }
    sp.defusingBy = p.id;
    sp.defuseProgress += 0.25;
    io.emit('defuse-progress', { progress: sp.defuseProgress / DEFUSE_TIME, by: p.name });
    if (sp.defuseProgress >= DEFUSE_TIME) {
      sp.defusingBy = null;
      endRound('defense', `${p.name} 스파이크 해체 성공`);
    }
  });

  socket.on('defuse-stop', () => {
    const sp = round.spike;
    if (sp.defusingBy === socket.id) {
      // 발로란트처럼 해체 진도 절반 유지? 여기선 절반 유지
      sp.defuseProgress = sp.defuseProgress >= DEFUSE_TIME / 2 ? DEFUSE_TIME / 2 : 0;
      sp.defusingBy = null;
      io.emit('defuse-progress', { progress: sp.defuseProgress / DEFUSE_TIME, by: null });
    }
  });

  socket.on('buy', ({ item }) => {
    const p = players.get(socket.id);
    if (!p || round.phase !== 'buy') return;
    const PRICES = {
      spectre: 1600, phantom: 2900, vandal: 2900, operator: 4700,
      sheriff: 800, armor: 1000, ability: 300,
    };
    const cost = PRICES[item];
    if (cost == null || p.money < cost) return;
    // 총기류면 교체
    if (['spectre', 'phantom', 'vandal', 'operator', 'sheriff'].includes(item)) p.weapon = item;
    if (item === 'armor') p.armor = 50;
    p.money -= cost;
    socket.emit('bought', { weapon: p.weapon, money: p.money, armor: p.armor });
  });

  socket.on('chat', (msg) => {
    const p = players.get(socket.id);
    if (!p) return;
    io.emit('chat', { name: p.name, team: p.team, text: String(msg).slice(0, 80) });
  });

  socket.on('disconnect', () => {
    const p = players.get(socket.id);
    if (p) {
      // 스파이크 홀더가 나가면 드랍
      const sp = round.spike;
      if (sp.holder === socket.id) { sp.holder = null; sp.dropped = { x: p.pos.x, z: p.pos.z }; }
      players.delete(socket.id);
      io.emit('player-left', socket.id);
      io.emit('players', [...players.values()]);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`VALORANT-like FPS on http://localhost:${PORT}`));
