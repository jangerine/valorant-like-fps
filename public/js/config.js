// 무기 / 요원 밸런스 (발로란트 오마주)
export const WEAPONS = {
  classic:  { name:'CLASSIC',  price:0,    damage:26, headMult:2.5, mag:12, reserve:36,  auto:false, rpm:400, spread:0.025, reload:1.6, range:50 },
  sheriff:  { name:'SHERIFF',  price:800,  damage:55, headMult:2.6, mag:6,  reserve:24,  auto:false, rpm:250, spread:0.012, reload:2.0, range:60 },
  spectre:  { name:'SPECTRE',  price:1600, damage:22, headMult:2.4, mag:30, reserve:90,  auto:true,  rpm:780, spread:0.035, reload:2.1, range:35 },
  phantom:  { name:'PHANTOM',  price:2900, damage:35, headMult:2.5, mag:25, reserve:75,  auto:true,  rpm:660, spread:0.022, reload:2.3, range:45 },
  vandal:   { name:'VANDAL',   price:2900, damage:40, headMult:2.5, mag:25, reserve:75,  auto:true,  rpm:600, spread:0.020, reload:2.4, range:60 },
  operator: { name:'OPERATOR', price:4700, damage:120,headMult:2.0, mag:5,  reserve:15,  auto:false, rpm:60,  spread:0.002, reload:3.2, range:100, sniper:true },
  knife:    { name:'KNIFE',    price:0,    damage:50, headMult:2.0, mag:Infinity, reserve:Infinity, auto:false, rpm:90, spread:0, reload:0, range:2.6, melee:true },
};

export const AGENTS = {
  jett: {
    name:'JETT', role:'DUELIST', icon:'🌪️', color:'#8fe3ff',
    desc:'기동력의 화신. 대시와 상승으로 전장을 뒤흔든다.',
    q:{ name:'업드래프트', icon:'⬆️', desc:'높이 점프' },
    e:{ name:'테일윈드', icon:'💨', desc:'앞으로 대시' },
    x:{ name:'블레이드 스톰', icon:'🔪', desc:'정확한 단검 5발' },
  },
  omen: {
    name:'OMEN', role:'CONTROLLER', icon:'🌑', color:'#8b7bff',
    desc:'그림자로 시야를 장악하는 전략가.',
    q:{ name:'파라노이아', icon:'👁️', desc:'전방 적 실명' },
    e:{ name:'다크 커버', icon:'💨', desc:'연막 설치' },
    x:{ name:'그림자 귀환', icon:'🌀', desc:'지정 위치로 텔포' },
  },
  sova: {
    name:'SOVA', role:'INITIATOR', icon:'🏹', color:'#4da6ff',
    desc:'정찰과 충격 화살의 사냥꾼.',
    q:{ name:'정찰 화살', icon:'📡', desc:'적 위치 미니맵 표시' },
    e:{ name:'쇼크 다트', icon:'⚡', desc:'범위 피해 40' },
    x:{ name:'헌터스 퓨리', icon:'☄️', desc:'벽 관통 광선 피해 80' },
  },
  sage: {
    name:'SAGE', role:'SENTINEL', icon:'🌿', color:'#5dffb0',
    desc:'아군을 지키는 수호자. 힐과 부활.',
    q:{ name:'슬로우 오브', icon:'❄️', desc:'적 둔화 장판' },
    e:{ name:'힐링 오브', icon:'💚', desc:'자신/조준 아군 +60' },
    x:{ name:'리저렉션', icon:'✨', desc:'죽은 아군 부활' },
  },
};

export const SHOP_ITEMS = [
  { id:'classic', desc:'기본 권총' },
  { id:'sheriff', desc:'고위력 리볼버 · 헤드 한방' },
  { id:'spectre', desc:'연사 SMG · 근거리 강함' },
  { id:'phantom', desc:'안정적 라이플 · 연막 관통' },
  { id:'vandal', desc:'정확한 라이플 · 헤드 한방' },
  { id:'operator', desc:'볼트 스나이퍼 · 몸샷 한방' },
];
