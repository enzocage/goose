/* ═══ GENERATIVE AUDIO ENGINE (Web Audio API) ═══ */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ready = false;
    this._ambientOscs = [];
    this._balanceNodes = null;
  }

  init() {
    if (this.ready) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.ready = true;
    } catch(e) { /* no audio */ }
  }

  _now() { return this.ctx.currentTime; }

  playRoll() {
    if (!this.ready) return;
    const t = this._now();
    const len = this.ctx.sampleRate * 0.05;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i=0;i<len;i++) d[i] = Math.random()*2-1;
    const noise = this.ctx.createBufferSource(); noise.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass'; filt.frequency.value = 700 + Math.random()*500; filt.Q.value = 0.6;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.2, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t+0.05);
    noise.connect(filt); filt.connect(ng); ng.connect(this.master);
    noise.start(t); noise.stop(t+0.06);

    const osc = this.ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.value = 85 + Math.random()*35;
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.4, t);
    og.gain.exponentialRampToValueAtTime(0.001, t+0.07);
    osc.connect(og); og.connect(this.master);
    osc.start(t); osc.stop(t+0.08);
  }

  playIce() {
    if (!this.ready) return;
    const t = this._now();
    const len = this.ctx.sampleRate * 0.08;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i=0;i<len;i++) d[i] = Math.random()*2-1;
    const noise = this.ctx.createBufferSource(); noise.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'highpass'; filt.frequency.value = 2000;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.12, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t+0.08);
    noise.connect(filt); filt.connect(ng); ng.connect(this.master);
    noise.start(t); noise.stop(t+0.09);
  }

  playBalanceStart() {
    if (!this.ready) return;
    const t = this._now();
    const osc = this.ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 200;
    const lfo = this.ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 7;
    const lfoG = this.ctx.createGain(); lfoG.gain.value = 60;
    lfo.connect(lfoG); lfoG.connect(osc.frequency);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.12, t+0.15);
    gain.gain.linearRampToValueAtTime(0.22, t+0.5);
    osc.connect(gain); gain.connect(this.master);
    osc.start(t); lfo.start(t);
    this._balanceNodes = { osc, lfo, gain };
  }

  playBalanceStop() {
    if (!this._balanceNodes) return;
    const t = this._now();
    const { osc, lfo, gain } = this._balanceNodes;
    gain.gain.linearRampToValueAtTime(0, t+0.1);
    osc.stop(t+0.15); lfo.stop(t+0.15);
    this._balanceNodes = null;
  }

  playFall() {
    if (!this.ready) return;
    const t = this._now();
    const osc = this.ctx.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.exponentialRampToValueAtTime(60, t+0.45);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t+0.5);
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.setValueAtTime(1500, t);
    filt.frequency.exponentialRampToValueAtTime(200, t+0.4);
    osc.connect(filt); filt.connect(gain); gain.connect(this.master);
    osc.start(t); osc.stop(t+0.55);
    this.playBalanceStop();
  }

  playLand() {
    if (!this.ready) return;
    const t = this._now();
    const osc = this.ctx.createOscillator(); osc.type = 'triangle';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(35, t+0.18);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t+0.2);
    osc.connect(gain); gain.connect(this.master);
    osc.start(t); osc.stop(t+0.22);
  }

  playShrink() {
    if (!this.ready) return;
    const t = this._now();
    const osc = this.ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(350, t);
    osc.frequency.exponentialRampToValueAtTime(1000, t+0.2);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t+0.22);
    osc.connect(gain); gain.connect(this.master);
    osc.start(t); osc.stop(t+0.24);
  }

  playGrow() {
    if (!this.ready) return;
    const t = this._now();
    const osc = this.ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(800, t);
    osc.frequency.exponentialRampToValueAtTime(250, t+0.25);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t+0.27);
    osc.connect(gain); gain.connect(this.master);
    osc.start(t); osc.stop(t+0.3);
  }

  playCollect() {
    if (!this.ready) return;
    const t = this._now();
    const freqs = [880, 1108, 1320];
    freqs.forEach((f,i) => {
      const osc = this.ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = f;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.18, t + i*0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i*0.04 + 0.35);
      osc.connect(gain); gain.connect(this.master);
      osc.start(t + i*0.04); osc.stop(t + i*0.04 + 0.4);
    });
  }

  playSwitch() {
    if (!this.ready) return;
    const t = this._now();
    [600, 900].forEach((f,i) => {
      const osc = this.ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = f;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.1, t + i*0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i*0.04 + 0.1);
      osc.connect(gain); gain.connect(this.master);
      osc.start(t + i*0.04); osc.stop(t + i*0.04 + 0.12);
    });
  }

  playTeleport() {
    if (!this.ready) return;
    const t = this._now();
    const osc = this.ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(1200, t+0.15);
    osc.frequency.exponentialRampToValueAtTime(800, t+0.25);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t+0.3);
    osc.connect(gain); gain.connect(this.master);
    osc.start(t); osc.stop(t+0.35);
  }

  playBreak() {
    if (!this.ready) return;
    const t = this._now();
    const len = this.ctx.sampleRate * 0.12;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i=0;i<len;i++) d[i] = Math.random()*2-1;
    const noise = this.ctx.createBufferSource(); noise.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.setValueAtTime(800, t);
    filt.frequency.exponentialRampToValueAtTime(100, t+0.12);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t+0.15);
    noise.connect(filt); filt.connect(gain); gain.connect(this.master);
    noise.start(t); noise.stop(t+0.16);
  }

  playRespawn() {
    if (!this.ready) return;
    const t = this._now();
    const osc = this.ctx.createOscillator(); osc.type = 'triangle';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(300, t+0.15);
    osc.frequency.exponentialRampToValueAtTime(200, t+0.3);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.linearRampToValueAtTime(0, t+0.35);
    osc.connect(gain); gain.connect(this.master);
    osc.start(t); osc.stop(t+0.4);
  }

  playComplete() {
    if (!this.ready) return;
    const t = this._now();
    const notes = [523, 659, 784, 1047];
    notes.forEach((f,i) => {
      const osc = this.ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = f;
      const gain = this.ctx.createGain();
      const st = t + i*0.12;
      gain.gain.setValueAtTime(0.02, st);
      gain.gain.linearRampToValueAtTime(0.2, st+0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, st+0.7);
      osc.connect(gain); gain.connect(this.master);
      osc.start(st); osc.stop(st+0.75);
    });
  }

  // ── Editor: compound-object grouping cues ──
  playGroupStart() {
    if (!this.ready) return;
    const t = this._now();
    [440, 660].forEach((f, i) => {
      const osc = this.ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = f;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t + i*0.06);
      gain.gain.exponentialRampToValueAtTime(0.16, t + i*0.06 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i*0.06 + 0.22);
      osc.connect(gain); gain.connect(this.master);
      osc.start(t + i*0.06); osc.stop(t + i*0.06 + 0.25);
    });
  }

  // A short tick when a block joins the group; pitch climbs with the count.
  playGroupAdd(count = 1) {
    if (!this.ready) return;
    const t = this._now();
    const osc = this.ctx.createOscillator(); osc.type = 'square';
    osc.frequency.value = Math.min(1500, 660 + (count - 1) * 80);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(gain); gain.connect(this.master);
    osc.start(t); osc.stop(t + 0.1);
  }

  playGroupEnd() {
    if (!this.ready) return;
    const t = this._now();
    [660, 440].forEach((f, i) => {
      const osc = this.ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = f;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t + i*0.05);
      gain.gain.exponentialRampToValueAtTime(0.14, t + i*0.05 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i*0.05 + 0.18);
      osc.connect(gain); gain.connect(this.master);
      osc.start(t + i*0.05); osc.stop(t + i*0.05 + 0.2);
    });
  }

  startAmbient(worldIdx) {
    if (!this.ready) return;
    this.stopAmbient();
    const t = this._now();
    const baseFreq = [55, 65, 73, 82, 98][worldIdx % 5];
    [1, 1.005, 2, 2.01, 3, 3.005].forEach(ratio => {
      const osc = this.ctx.createOscillator(); osc.type = 'sine';
      osc.frequency.value = baseFreq * ratio;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.03, t+1);
      osc.connect(gain); gain.connect(this.master);
      osc.start(t);
      this._ambientOscs.push({ osc, gain });
    });
  }

  stopAmbient() {
    if (!this.ready) return;
    const t = this._now();
    this._ambientOscs.forEach(({ osc, gain }) => {
      gain.gain.linearRampToValueAtTime(0, t+0.5);
      osc.stop(t+0.6);
    });
    this._ambientOscs = [];
  }
}
