// WebAudio 합성 사운드 (에셋 없이 발로란트 느낌)
let ctx = null;
function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
function env(g, t0, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
}
export function sfxShot(weapon = 'vandal', distant = false) {
  try {
    const c = ac(), t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    o.type = 'square';
    const base = { vandal: 150, phantom: 180, spectre: 220, sheriff: 110, operator: 70, classic: 260 }[weapon] || 150;
    o.frequency.setValueAtTime(base * 3, t);
    o.frequency.exponentialRampToValueAtTime(base * 0.5, t + 0.12);
    f.type = 'lowpass'; f.frequency.value = weapon === 'operator' ? 900 : 2500;
    const n = c.createBufferSource();
    const buf = c.createBuffer(1, c.sampleRate * 0.15, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    n.buffer = buf;
    const ng = c.createGain(); ng.gain.value = distant ? 0.15 : 0.5;
    o.connect(f); f.connect(g); g.connect(c.destination);
    n.connect(ng); ng.connect(c.destination);
    env(g, t, 0.004, distant ? 0.12 : 0.35, 0.14);
    o.start(t); o.stop(t + 0.2); n.start(t);
  } catch (e) {}
}
export function sfxHit(head = false) {
  try {
    const c = ac(), t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = head ? 1400 : 1000;
    env(g, t, 0.002, 0.25, 0.08);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.12);
  } catch (e) {}
}
export function sfxKill() {
  try {
    const c = ac(), t = c.currentTime;
    [523, 659, 784].forEach((fq, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.value = fq;
      env(g, t + i * 0.07, 0.005, 0.22, 0.15);
      o.connect(g); g.connect(c.destination); o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.25);
    });
  } catch (e) {}
}
export function sfxPlant(beep = false) {
  try {
    const c = ac(), t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'square'; o.frequency.value = beep ? 1200 : 600;
    env(g, t, 0.003, 0.2, beep ? 0.15 : 0.3);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.4);
  } catch (e) {}
}
export function sfxReload() {
  try {
    const c = ac(), t = c.currentTime;
    [0, 0.18].forEach((dt) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'square'; o.frequency.value = 400 + Math.random() * 200;
      env(g, t + dt, 0.002, 0.12, 0.07);
      o.connect(g); g.connect(c.destination); o.start(t + dt); o.stop(t + dt + 0.1);
    });
  } catch (e) {}
}
export function sfxStep() {
  try {
    const c = ac(), t = c.currentTime;
    const n = c.createBufferSource();
    const buf = c.createBuffer(1, c.sampleRate * 0.06, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.3 * (1 - i / d.length);
    n.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    const g = c.createGain(); g.gain.value = 0.25;
    n.connect(f); f.connect(g); g.connect(c.destination); n.start(t);
  } catch (e) {}
}
export function sfxAbility() {
  try {
    const c = ac(), t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(800, t + 0.25);
    env(g, t, 0.01, 0.2, 0.3);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.4);
  } catch (e) {}
}
export function sfxFlash() {
  try {
    const c = ac(), t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(2000, t);
    o.frequency.exponentialRampToValueAtTime(200, t + 0.5);
    env(g, t, 0.005, 0.3, 0.5);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.6);
  } catch (e) {}
}
