import { SidForge } from './sidforge.js';

/* ═══ GENERATIVE AUDIO ENGINE (SidForge C64 SID Emulation) ═══ */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ready = false;
    this.initializing = false;
    this.sid = null;
  }

  async init() {
    if (this.ready || this.initializing) return;
    this.initializing = true;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      // Keep master gain comfortable
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);

      // Initialize SidForge
      this.sid = await SidForge.create({ audioCtx: this.ctx });
      this.sid.loadSfxBank(this.getSfxBank());
      // Adjust volumes: low music tracker background (if any) and moderate arcade SFX
      this.sid.setVolume(0.15, 0.45);

      this.ready = true;
    } catch (e) {
      console.error("Failed to initialize SidForge audio engine:", e);
    } finally {
      this.initializing = false;
    }
  }

  _resumeCtx() {
    if (this.ctx && this.ctx.state !== 'running') {
      this.ctx.resume().catch(err => console.warn("AudioContext resume failed:", err));
    }
  }

  getSfxBank() {
    return {
      // --- SUBTLE & FREQUENT EVENTS ---
      roll: {
        wave: "triangle",
        adsr: [0, 2, 0, 1], // Snap/pop envelope
        pitch: { startFreq: 500, slide: -80 }, // Soft micro-pop
        frames: { len: 2 } // Extremely short, unobtrusive
      },
      enemyRoll: {
        wave: "triangle",
        adsr: [0, 4, 0, 2],
        pitch: { startFreq: 45, slide: -2 }, // Distinctly lower, soft rotation bump for chasers
        frames: { len: 4 }
      },
      ice: {
        wave: "noise",
        adsr: [1, 4, 0, 2],
        pitch: { startFreq: 3000, slide: -20 },
        filter: { cutoff: 0.9, sweep: -0.02, res: 2, mode: "hp" }, // Soft highpass breeze/whisper
        frames: { len: 5 }
      },
      click: {
        wave: "triangle",
        adsr: [0, 2, 0, 1],
        pitch: { startFreq: 800, slide: -100 }, // Minimalist microscopic wood-block click
        frames: { len: 2 }
      },
      typewriterTick: {
        wave: "noise",
        adsr: [0, 1, 0, 1],
        pitch: { startFreq: 3000 }, // Extremely tiny, soft mechanical snap
        frames: { len: 1 }
      },
      heightChangeUp: {
        wave: "triangle",
        adsr: [0, 3, 0, 2],
        pitch: { startFreq: 300, slide: 16 }, // Gentle pitch-up cue for raising height
        frames: { len: 5 }
      },
      heightChangeDown: {
        wave: "triangle",
        adsr: [0, 3, 0, 2],
        pitch: { startFreq: 380, slide: -16 }, // Gentle pitch-down cue for lowering height
        frames: { len: 5 }
      },
      groupAdd: {
        wave: "pulse",
        adsr: [0, 3, 0, 1],
        pitch: { startFreq: 500 }, // Cute, short pulse tick when linking block to a group
        frames: { len: 3 }
      },
      toolSelect: {
        wave: "triangle",
        adsr: [0, 3, 0, 2],
        pitch: { startFreq: 400, slide: 20 }, // Tiny positive blip for selecting a designer tool
        frames: { len: 5 }
      },

      // --- PROMINENT & GAMEPLAY-SIGNIFICANT EVENTS ---
      collect: {
        wave: "triangle",
        adsr: [3, 5, 0, 6],
        pitch: { startFreq: 523.25, slide: 12 }, // Soft, warm chime with gentle upward lift
        vibrato: { speed: 0.25, depth: 5 },
        frames: { len: 10 }
      },
      teleport: {
        wave: "triangle+sawtooth",
        adsr: [4, 8, 4, 8],
        pitch: { startFreq: 150, slide: 35 },
        vibrato: { speed: 0.5, depth: 25 },
        filter: { cutoff: 0.1, sweep: 0.04, res: 14, mode: "bp" }, // Rich bandpass sweep representing spatial shift
        frames: { len: 25 }
      },
      booster: {
        wave: "pulse",
        adsr: [1, 4, 1, 2],
        pitch: { startFreq: 350, slide: 20 },
        pw: { start: 1024, speed: 150 }, // Soft chiptune pulse shift
        frames: { len: 8 }
      },
      leap: {
        wave: "triangle",
        adsr: [1, 4, 0, 2],
        pitch: { startFreq: 220, slide: 12 }, // Gentle upward sweep
        frames: { len: 8 }
      },
      fall: {
        wave: "triangle",
        adsr: [2, 10, 0, 8],
        pitch: { startFreq: 350, slide: -8 }, // Soft descending pitch slide
        vibrato: { speed: 0.4, depth: 15 },
        frames: { len: 25 }
      },
      land: {
        wave: "triangle",
        adsr: [0, 5, 0, 2],
        pitch: { startFreq: 90, slide: -3 }, // Low warm felt thump
        filter: { cutoff: 0.18, sweep: -0.01, res: 1, mode: "lp" },
        frames: { len: 6 }
      },
      shrink: {
        wave: "triangle",
        adsr: [2, 6, 0, 4],
        pitch: { startFreq: 250, slide: 30 },
        vibrato: { speed: 0.4, depth: 15 }, // Playful ascending magic spell effect
        frames: { len: 15 }
      },
      grow: {
        wave: "triangle",
        adsr: [2, 6, 0, 4],
        pitch: { startFreq: 900, slide: -30 },
        vibrato: { speed: 0.4, depth: 15 }, // Playful descending magic spell effect
        frames: { len: 15 }
      },
      switch: {
        wave: "noise+pulse",
        adsr: [0, 4, 0, 2],
        pitch: { startFreq: 1500, slide: -150 }, // Solid, crisp mechanical relay click
        frames: { len: 6 }
      },
      break: {
        wave: "noise",
        adsr: [0, 10, 0, 8],
        pitch: { startFreq: 800, slide: -40 },
        filter: { cutoff: 0.7, sweep: -0.04, res: 6, mode: "lp" }, // Crumbling block collapse/fracture crash
        frames: { len: 18 }
      },
      respawn: {
        wave: "pulse",
        adsr: [1, 4, 10, 4],
        pitch: { startFreq: 261.63 },
        arp: { offsets: [0, 3, 7, 12, 15, 19, 24], speed: 3 }, // Uplifting minor-to-major retro chiptune melody
        pw: { start: 2048, speed: 100 },
        frames: { len: 25 }
      },
      complete: {
        wave: "triangle+pulse",
        adsr: [2, 6, 12, 8],
        pitch: { startFreq: 261.63 },
        arp: { offsets: [0, 4, 7, 12, 16, 19, 24, 28, 31, 36, 40], speed: 3 }, // Grand victory fanfare chord run
        pw: { start: 2048, speed: 100 },
        frames: { len: 55 }
      },
      damage: {
        wave: "sawtooth+noise",
        adsr: [1, 12, 0, 8],
        pitch: { startFreq: 220, slide: -6 },
        filter: { cutoff: 0.7, sweep: -0.02, res: 10, mode: "lp" }, // Glitchy, detuned painful hazard collision hit
        frames: { len: 24 }
      },
      gameOver: {
        wave: "square",
        adsr: [3, 8, 4, 6],
        pitch: { startFreq: 392.00 },
        arp: { offsets: [0, -2, -4, -5, -7, -9, -11, -12], speed: 6 }, // Tragic, heavy descending game over minor run
        frames: { len: 50 }
      },
      linkSuccess: {
        wave: "triangle",
        adsr: [1, 3, 6, 3],
        pitch: { startFreq: 880 },
        arp: { offsets: [0, 5, 12, 17], speed: 2 }, // Satisfying chord when links are built
        frames: { len: 14 }
      },
      linkCancel: {
        wave: "sawtooth",
        adsr: [1, 6, 0, 3],
        pitch: { startFreq: 150, slide: -5 }, // Low warning buzz for linking failures
        frames: { len: 10 }
      },
      starEarned: {
        wave: "pulse",
        adsr: [1, 8, 4, 6],
        pitch: { startFreq: 523.25 },
        arp: { offsets: [0, 4, 7, 12, 16], speed: 2 }, // Sparkling chime for collecting levels stars
        pw: { start: 2048, speed: 150 },
        frames: { len: 22 }
      },
      groupStart: {
        wave: "triangle",
        adsr: [1, 5, 4, 3],
        pitch: { startFreq: 330 },
        arp: { offsets: [0, 5, 10], speed: 3 }, // Creative high-tech group initialization chime
        frames: { len: 12 }
      },
      groupEnd: {
        wave: "triangle",
        adsr: [1, 5, 4, 3],
        pitch: { startFreq: 660 },
        arp: { offsets: [0, -5, -10], speed: 3 }, // Secure high-tech group finalized locking blip
        frames: { len: 12 }
      },
      undo: {
        wave: "triangle",
        adsr: [1, 6, 0, 3],
        pitch: { startFreq: 200, slide: 25 }, // "Temporal rewind" ascending sweep
        frames: { len: 10 }
      },
      clear: {
        wave: "noise",
        adsr: [2, 12, 0, 8],
        pitch: { startFreq: 800, slide: -60 },
        filter: { cutoff: 0.8, sweep: -0.06, res: 8, mode: "lp" }, // Digital black-hole grid-wiping sweep
        frames: { len: 22 }
      },
      playtestEnter: {
        wave: "square",
        adsr: [2, 5, 3, 4],
        pitch: { startFreq: 330 },
        arp: { offsets: [0, 4, 7, 12], speed: 3 }, // Game start playtest countdown signature
        frames: { len: 15 }
      },
      playtestExit: {
        wave: "sawtooth",
        adsr: [1, 5, 3, 4],
        pitch: { startFreq: 523.25 },
        arp: { offsets: [0, -4, -7, -12], speed: 3 }, // Exiting playtest return-to-editor signature
        frames: { len: 15 }
      },
      balance: {
        wave: "triangle",
        adsr: [3, 4, 15, 4],
        pitch: { startFreq: 220 },
        vibrato: { speed: 0.25, depth: 10 }, // Ongoing wobbly balancing hum
        frames: { len: 9999 }
      },

      // --- NEWLY ADDED CREATIVE SOUNDS (29 SOUNDS) ---
      // Editor placement signatures
      place_normal: {
        wave: "triangle",
        adsr: [0, 4, 0, 2],
        pitch: { startFreq: 180, slide: -15 },
        frames: { len: 5 }
      },
      place_fragile: {
        wave: "triangle",
        adsr: [0, 5, 0, 2],
        pitch: { startFreq: 280, slide: -25 },
        frames: { len: 6 }
      },
      place_ice: {
        wave: "triangle",
        adsr: [0, 4, 0, 2],
        pitch: { startFreq: 1200, slide: -60 },
        frames: { len: 5 }
      },
      place_switch: {
        wave: "pulse",
        adsr: [0, 4, 0, 2],
        pitch: { startFreq: 400, slide: 30 },
        pw: { start: 1024, speed: 100 },
        frames: { len: 6 }
      },
      place_bridge: {
        wave: "triangle",
        adsr: [1, 5, 0, 2],
        pitch: { startFreq: 220, slide: -10 },
        frames: { len: 7 }
      },
      place_teleporter: {
        wave: "sawtooth",
        adsr: [2, 6, 0, 3],
        pitch: { startFreq: 150, slide: 50 },
        frames: { len: 10 }
      },
      place_moving: {
        wave: "pulse",
        adsr: [0, 5, 0, 2],
        pitch: { startFreq: 300, slide: -20 },
        pw: { start: 2048, speed: 50 },
        frames: { len: 6 }
      },
      place_pushable: {
        wave: "triangle",
        adsr: [0, 6, 0, 3],
        pitch: { startFreq: 140, slide: -8 },
        frames: { len: 8 }
      },
      place_pressureplate: {
        wave: "pulse",
        adsr: [0, 4, 0, 2],
        pitch: { startFreq: 600, slide: -40 },
        pw: { start: 1024, speed: 50 },
        frames: { len: 5 }
      },
      place_danger: {
        wave: "noise",
        adsr: [0, 6, 0, 4],
        pitch: { startFreq: 500, slide: -20 },
        frames: { len: 8 }
      },
      place_shaker: {
        wave: "triangle",
        adsr: [1, 6, 0, 3],
        pitch: { startFreq: 250, slide: -15 },
        frames: { len: 8 }
      },
      place_booster: {
        wave: "sawtooth",
        adsr: [1, 4, 0, 2],
        pitch: { startFreq: 350, slide: 40 },
        frames: { len: 6 }
      },
      place_start: {
        wave: "triangle",
        adsr: [0, 4, 8, 4],
        pitch: { startFreq: 440 },
        arp: { offsets: [0, 4, 7, 12], speed: 2 },
        frames: { len: 10 }
      },
      place_exit: {
        wave: "pulse",
        adsr: [1, 4, 8, 4],
        pitch: { startFreq: 523 },
        arp: { offsets: [0, 7, 12, 19], speed: 2 },
        pw: { start: 2048, speed: 100 },
        frames: { len: 12 }
      },
      place_prism: {
        wave: "pulse",
        adsr: [0, 3, 6, 3],
        pitch: { startFreq: 880 },
        arp: { offsets: [0, 12], speed: 2 },
        frames: { len: 6 }
      },
      place_miniprism: {
        wave: "pulse",
        adsr: [0, 3, 6, 3],
        pitch: { startFreq: 1200 },
        arp: { offsets: [0, 12], speed: 2 },
        frames: { len: 6 }
      },
      place_enemy: {
        wave: "sawtooth",
        adsr: [1, 5, 0, 3],
        pitch: { startFreq: 180, slide: -15 },
        frames: { len: 8 }
      },
      // X-ray toggle chiptune sweep
      xrayToggle: {
        wave: "sawtooth",
        adsr: [1, 5, 0, 4],
        pitch: { startFreq: 1000, slide: -80 },
        filter: { cutoff: 0.8, sweep: -0.05, res: 10, mode: "bp" },
        frames: { len: 10 }
      },
      // Pause toggle audio cue
      pauseToggle: {
        wave: "triangle",
        adsr: [2, 6, 0, 4],
        pitch: { startFreq: 330, slide: -20 },
        frames: { len: 12 }
      },
      // Shaker block shaking
      shakerShake: {
        wave: "triangle+noise",
        adsr: [0, 8, 0, 6],
        pitch: { startFreq: 90, slide: -2 },
        vibrato: { speed: 0.8, depth: 8 },
        frames: { len: 15 }
      },
      // Bridge extending/retracting
      bridgeExtend: {
        wave: "pulse",
        adsr: [2, 6, 4, 4],
        pitch: { startFreq: 300, slide: 15 },
        pw: { start: 1024, speed: 80 },
        frames: { len: 12 }
      },
      bridgeRetract: {
        wave: "pulse",
        adsr: [1, 6, 0, 4],
        pitch: { startFreq: 400, slide: -20 },
        pw: { start: 2048, speed: -80 },
        frames: { len: 10 }
      },
      // Crate physics sounds
      cratePush: {
        wave: "triangle",
        adsr: [0, 6, 0, 4],
        pitch: { startFreq: 100, slide: -5 },
        frames: { len: 8 }
      },
      crateLand: {
        wave: "triangle+noise",
        adsr: [0, 8, 0, 4],
        pitch: { startFreq: 80, slide: -3 },
        frames: { len: 10 }
      },
      crateFall: {
        wave: "sawtooth",
        adsr: [3, 15, 0, 10],
        pitch: { startFreq: 180, slide: -4 },
        frames: { len: 25 }
      },
      // Pressure plates pressed/released
      platePress: {
        wave: "pulse",
        adsr: [0, 4, 0, 2],
        pitch: { startFreq: 500, slide: 30 },
        pw: { start: 1024, speed: 50 },
        frames: { len: 6 }
      },
      plateRelease: {
        wave: "pulse",
        adsr: [0, 4, 0, 2],
        pitch: { startFreq: 650, slide: -30 },
        pw: { start: 1024, speed: 50 },
        frames: { len: 6 }
      },
      // Dynamic combo scoring reward
      combo: {
        wave: "pulse",
        adsr: [0, 3, 6, 3],
        pitch: { startFreq: 523.25 },
        arp: { offsets: [0, 4, 7, 12], speed: 1 },
        pw: { start: 1500, speed: 200 },
        frames: { len: 10 }
      },
      // AI generators successful load signature
      aiGenerate: {
        wave: "triangle+pulse",
        adsr: [3, 6, 8, 6],
        pitch: { startFreq: 220 },
        arp: { offsets: [0, 4, 7, 12, 16, 19, 24], speed: 2 },
        frames: { len: 35 }
      },
      // Threatening warning alarm sound when plutonium is about to explode
      plutoniumWarning: {
        wave: "sawtooth+noise",
        adsr: [0, 8, 0, 6],
        pitch: { startFreq: 110, slide: -4 },
        vibrato: { speed: 1.0, depth: 30 },
        filter: { cutoff: 0.4, sweep: 0.05, res: 10, mode: "lp" },
        frames: { len: 12 }
      }
    };
  }

  playRoll() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('roll');
  }

  playIce() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('ice');
  }

  playBalanceStart() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    // Play on dedicated voice 2 to allow stopping it via poke
    this.sid.playSfx('balance', { voice: 2 });
  }

  playBalanceStop() {
    if (!this.ready || !this.sid) return;
    this.sid.poke(2, 'gate', false);
  }

  playFall() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('fall');
    this.playBalanceStop();
  }

  playLand() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('land');
  }

  playShrink() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('shrink');
  }

  playGrow() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('grow');
  }

  playCollect() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('collect');
  }

  playSwitch() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('switch');
  }

  playTeleport() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('teleport');
  }

  playBreak() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('break');
  }

  playRespawn() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('respawn');
  }

  playComplete() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('complete');
  }

  playBooster() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('booster');
  }

  playLeap() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('leap');
  }

  playEnemyRoll() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('enemyRoll');
  }

  playDamage() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('damage');
  }

  playGameOver() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('gameOver');
  }

  playLinkSuccess() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('linkSuccess');
  }

  playLinkCancel() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('linkCancel');
  }

  playHeightChange(isUp) {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx(isUp ? 'heightChangeUp' : 'heightChangeDown');
  }

  playClick() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('click');
  }

  playStarEarned(index) {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    const notes = [523.25, 659.25, 783.99];
    const f = notes[index % 3];
    this.sid.playSfx('starEarned', { pitch: { startFreq: f } });
  }

  playTypewriterTick() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('typewriterTick');
  }

  playGroupStart() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('groupStart');
  }

  playGroupAdd(count = 1) {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    const startF = Math.min(1500, 660 + (count - 1) * 80);
    this.sid.playSfx('groupAdd', { pitch: { startFreq: startF } });
  }

  playGroupEnd() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('groupEnd');
  }

  // ── Level Editor Sound Effects ──────────────────────────
  playToolSelect() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('toolSelect');
  }

  playUndo() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('undo');
  }

  playClear() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('clear');
  }

  playPlaytestEnter() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('playtestEnter');
  }

  playPlaytestExit() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('playtestExit');
  }

  // ── New Play Methods ─────────────────────────────────────
  playXrayToggle(isOn) {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('xrayToggle', { pitch: { startFreq: isOn ? 1200 : 800 }, pitch: { slide: isOn ? -60 : -40 } });
  }

  playPauseToggle(isPaused) {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('pauseToggle', { pitch: { startFreq: isPaused ? 300 : 440 } });
  }

  playShakerShake() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('shakerShake');
  }

  playBridgeExtend() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('bridgeExtend');
  }

  playBridgeRetract() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('bridgeRetract');
  }

  playCratePush() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('cratePush');
  }

  playCrateLand() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('crateLand');
  }

  playCrateFall() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('crateFall');
  }

  playPlatePress() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('platePress');
  }

  playPlateRelease() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('plateRelease');
  }

  playCombo(comboCount) {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    // Scale pitch upward depending on combo size
    const baseFreq = 523.25 * Math.pow(1.12, comboCount - 2);
    this.sid.playSfx('combo', { pitch: { startFreq: baseFreq } });
  }

  playAIGenerate() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('aiGenerate');
  }

  playPlutoniumWarning() {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    this.sid.playSfx('plutoniumWarning');
  }

  playPlace(tool) {
    this._resumeCtx();
    if (!this.ready || !this.sid) return;
    const sfxName = `place_${tool}`;
    if (this.sid.sfxBank[sfxName]) {
      this.sid.playSfx(sfxName);
    } else {
      this.sid.playSfx('click');
    }
  }

  startAmbient(worldIdx) {
    // Background ambient sound deleted per user request
    return;
  }

  stopAmbient() {
    // Background ambient sound deleted per user request
    return;
  }
}
