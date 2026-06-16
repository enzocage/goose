// ============================================================================
// SIDForge — Standalone JavaScript SID Synthesizer module (MOS 6581/8580 Emulation)
// ============================================================================

const processorCode = `
class SidCoreProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.voices = [
      this.createVoice(),
      this.createVoice(),
      this.createVoice()
    ];
    this.filter = {
      low: 0,
      band: 0,
      modeLP: false,
      modeBP: false,
      modeHP: false,
      cutoff: 0.5,
      resonance: 0
    };
    
    this.samplesPerTick = Math.floor(sampleRate / 50);
    this.sampleCount = 0;
    
    // Sequencer states
    this.playingSong = false;
    this.songData = null;
    this.songTick = 0;
    this.songRow = 0;
    this.songOrderIdx = 0;
    this.songSpeed = 6;
    
    // Voice allocation & SFX
    this.voiceAlloc = ["music", "music", "music"];
    this.sfxActive = [null, null, null];
    this.musicStates = [{}, {}, {}];
    
    // Channels volume
    this.musicVolume = 0.10;
    this.sfxVolume = 1.0;
    this.masterVolume = 0.55;

    // Listen to messages from the facade class
    this.port.onmessage = (e) => this.handleMessage(e.data);
  }

  createVoice() {
    return {
      phase: 0,
      freq: 0,
      wave: "triangle",
      pw: 2048,
      adsr: [0, 0, 15, 0], // a, d, s, r
      gate: false,
      env: 0,
      envState: 0, // 0: idle, 1: attack, 2: decay/sustain, 3: release
      ringMod: false,
      sync: false,
      filterEnabled: false,
      prevBit19: 0,
      lfsr: 0x7FFFFF
    };
  }

  handleMessage(msg) {
    switch (msg.type) {
      case "init":
        break;
      case "sfx":
        this.triggerSfx(msg.name, msg.sfxData);
        break;
      case "song":
        this.songData = msg.songData;
        this.playingSong = true;
        this.songTick = 0;
        this.songRow = 0;
        this.songOrderIdx = 0;
        this.songSpeed = msg.songData.speed || 6;
        this.musicStates = [{}, {}, {}];
        this.voiceAlloc = ["music", "music", "music"];
        this.sfxActive = [null, null, null];
        break;
      case "stopSong":
        this.playingSong = false;
        for (let v = 0; v < 3; v++) {
          if (this.voiceAlloc[v] === "music") {
            this.voices[v].gate = false;
          }
        }
        break;
      case "resumeSong":
        this.playingSong = true;
        break;
      case "volume":
        if (msg.music !== undefined) this.musicVolume = msg.music;
        if (msg.sfx !== undefined) this.sfxVolume = msg.sfx;
        break;
      case "stopAll":
        this.playingSong = false;
        this.sfxActive = [null, null, null];
        this.voiceAlloc = ["music", "music", "music"];
        for (let v = 0; v < 3; v++) {
          this.voices[v].gate = false;
          this.voices[v].envState = 0;
          this.voices[v].env = 0;
        }
        break;
      case "poke":
        const voice = this.voices[msg.voice];
        if (voice) {
          voice[msg.reg] = msg.val;
        }
        const activeSfx = this.sfxActive[msg.voice];
        if (activeSfx) {
          if (msg.reg === "freq") activeSfx.currentFreq = msg.val;
          if (msg.reg === "gate") activeSfx.gate = msg.val;
        }
        break;
    }
  }

  triggerSfx(name, sfxData) {
    let targetVoice = -1;
    
    if (typeof sfxData.voice === "number" && sfxData.voice >= 0 && sfxData.voice < 3) {
      targetVoice = sfxData.voice;
    } else {
      // 1. Look for a voice currently NOT playing anything
      for (let v = 0; v < 3; v++) {
        if (this.voiceAlloc[v] === "music" && this.voices[v].envState === 0) {
          targetVoice = v;
          break;
        }
      }
      
      // 2. Look for a voice playing music (voice stealing)
      if (targetVoice === -1) {
        // Steal Voice 3 (arpeggio/drums) first, then Voice 2, then Voice 1
        const order = [2, 1, 0];
        for (const v of order) {
          if (this.voiceAlloc[v] === "music") {
            targetVoice = v;
            break;
          }
        }
      }
      
      // 3. Look for a voice playing a lower priority SFX
      if (targetVoice === -1) {
        const priority = sfxData.priority || 0;
        for (let v = 0; v < 3; v++) {
          if (this.voiceAlloc[v] !== "music") {
            const activeSfx = this.sfxActive[v];
            if (activeSfx && activeSfx.priority < priority) {
              targetVoice = v;
              break;
            }
          }
        }
      }
    }
    
    if (targetVoice === -1) {
      return; // Could not allocate a voice (all taken by higher priority sfx)
    }
    
    let startFreq = 440;
    if (sfxData.pitch && sfxData.pitch.startNote) {
      const midi = this.parseNote(sfxData.pitch.startNote);
      if (midi !== null) {
        startFreq = 440.0 * Math.pow(2.0, (midi - 69.0) / 12.0);
      }
    } else if (sfxData.pitch && sfxData.pitch.startFreq) {
      startFreq = sfxData.pitch.startFreq;
    }
    
    const sfx = {
      name: name,
      priority: sfxData.priority || 0,
      wave: sfxData.wave || "triangle",
      adsr: sfxData.adsr || [0, 8, 0, 4],
      pitch: sfxData.pitch || null,
      currentFreq: isNaN(startFreq) ? 440 : startFreq,
      pw: sfxData.pw || null,
      currentPw: (sfxData.pw && sfxData.pw.start !== undefined) ? sfxData.pw.start : 2048,
      pwSpeed: (sfxData.pw && sfxData.pw.speed !== undefined) ? sfxData.pw.speed : 0,
      filter: sfxData.filter || null,
      currentFilterCutoff: (sfxData.filter && sfxData.filter.cutoff !== undefined) ? sfxData.filter.cutoff : 0.5,
      filterSweep: (sfxData.filter && sfxData.filter.sweep !== undefined) ? sfxData.filter.sweep : 0,
      ringMod: sfxData.ringMod || false,
      sync: sfxData.sync || false,
      vibrato: sfxData.vibrato || null,
      vibratoPhase: 0,
      arp: sfxData.arp || null,
      arpTimer: 0,
      gate: true,
      age: 0,
      duration: sfxData.frames ? sfxData.frames.len : 30
    };
    
    this.voiceAlloc[targetVoice] = sfx;
    this.sfxActive[targetVoice] = sfx;
    
    const voice = this.voices[targetVoice];
    voice.gate = false;
    voice.gate = true;
    voice.envState = 1; // Force Attack
  }

  parseNote(str) {
    if (!str || str === "---" || str === "...") return null;
    // Accepts "C-4", "C#4", "C#-4", "Db4", "Db-4"
    // NOTE: this code lives inside a template literal, so the regex digit
    // class must be written as \\d to survive template escape processing
    const m = /^([A-Ga-g])([#b]?)-?(\\d)$/.exec(str);
    if (!m) return null;
    const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    let noteIdx = NOTES.indexOf(m[1].toUpperCase() + (m[2] === "#" ? "#" : ""));
    if (noteIdx === -1) return null;
    if (m[2] === "b") noteIdx = (noteIdx + 11) % 12;
    const oct = parseInt(m[3]);
    return 12 + oct * 12 + noteIdx;
  }

  process(inputs, outputs, parameters) {
    const output = outputs && outputs[0];
    if (!output || output.length === 0) return true;
    const channel0 = output[0];
    if (!channel0) return true;
    const len = channel0.length;
    const numChannels = output.length;
    
    for (let i = 0; i < len; i++) {
      this.sampleCount++;
      if (this.sampleCount >= this.samplesPerTick) {
        this.sampleCount = 0;
        this.run50HzTick();
      }
      const sample = this.renderSample();
      for (let c = 0; c < numChannels; c++) {
        if (output[c]) {
          output[c][i] = sample;
        }
      }
    }
    return true;
  }

  run50HzTick() {
    // 1. Process active SFX
    for (let v = 0; v < 3; v++) {
      const sfx = this.sfxActive[v];
      if (sfx) {
        sfx.age++;
        if (sfx.age >= sfx.duration || (sfx.gate === false && this.voices[v].envState === 0)) {
          this.sfxActive[v] = null;
          this.voiceAlloc[v] = "music";
          this.voices[v].gate = false;
        } else {
          if (sfx.pitch) {
            const slide = sfx.pitch.slide || 0;
            if (sfx.pitch.curve === "exp") {
              sfx.currentFreq *= (1.0 + slide / 100.0);
            } else {
              sfx.currentFreq += slide;
            }
            if (isNaN(sfx.currentFreq)) {
              sfx.currentFreq = sfx.pitch.startFreq || 440;
            }
            sfx.currentFreq = Math.max(10, Math.min(20000, sfx.currentFreq));
          }
          if (sfx.pw) {
            const speed = sfx.pwSpeed || 0;
            sfx.currentPw += speed;
            if (isNaN(sfx.currentPw)) sfx.currentPw = 2048;
            sfx.currentPw = Math.max(0, Math.min(4095, sfx.currentPw));
          }
          if (sfx.filter) {
            const sweep = sfx.filterSweep || 0;
            sfx.currentFilterCutoff += sweep;
            if (isNaN(sfx.currentFilterCutoff)) sfx.currentFilterCutoff = 0.5;
            sfx.currentFilterCutoff = Math.max(0, Math.min(1.0, sfx.currentFilterCutoff));
          }
          
          const voice = this.voices[v];

          // C64 ring modulation & hard sync
          voice.ringMod = sfx.ringMod;
          voice.sync = sfx.sync;

          // Vibrato (SID-style LFO on frequency)
          let modFreq = sfx.currentFreq;
          if (sfx.vibrato) {
            sfx.vibratoPhase += (sfx.vibrato.speed || 0.15);
            const vibDepth = sfx.vibrato.depth || 8;
            modFreq += Math.sin(sfx.vibratoPhase) * vibDepth;
          }

          // Arpeggio (trademark SID fast note cycling)
          if (sfx.arp) {
            sfx.arpTimer++;
            if (sfx.arpTimer >= (sfx.arp.speed || 2)) {
              sfx.arpTimer = 0;
              sfx.arpStep = ((sfx.arpStep || 0) + 1) % sfx.arp.offsets.length;
            }
            const arpOffset = sfx.arp.offsets[sfx.arpStep || 0];
            modFreq *= Math.pow(2.0, arpOffset / 12.0);
          }

          voice.freq = Math.max(10, Math.min(20000, modFreq));
          voice.wave = sfx.wave;
          if (sfx.pw) voice.pw = sfx.currentPw;
          voice.adsr = sfx.adsr;
          voice.gate = sfx.gate;

          if (sfx.filter) {
            voice.filterEnabled = true;
            this.filter.cutoff = sfx.currentFilterCutoff * 8000 + 80;
            const res = sfx.filter.res !== undefined ? sfx.filter.res : 0;
            this.filter.resonance = res / 15.0;
            this.filter.modeLP = sfx.filter.mode === "lp";
            this.filter.modeBP = sfx.filter.mode === "bp";
            this.filter.modeHP = sfx.filter.mode === "hp";
          } else {
            voice.filterEnabled = false;
          }
        }
      }
    }
    
    // 2. Process active tracker song
    if (this.playingSong && this.songData) {
      this.songTick++;
      if (this.songTick >= this.songSpeed) {
        this.songTick = 0;
        this.playNextTrackerRow();
      }
      
      for (let v = 0; v < 3; v++) {
        if (this.voiceAlloc[v] === "music") {
          this.updateTrackerEffects(v);
        }
      }
    }
  }

  playNextTrackerRow() {
    const song = this.songData;
    const orderlist = song.orderlist;
    
    const v1Orders = orderlist.v1 || [];
    const v2Orders = orderlist.v2 || [];
    const v3Orders = orderlist.v3 || [];
    const maxOrders = Math.max(v1Orders.length, v2Orders.length, v3Orders.length);
    
    if (this.songOrderIdx >= maxOrders) {
      if (song.loop !== undefined) {
        this.songOrderIdx = song.loop;
        this.songRow = 0;
      } else {
        this.playingSong = false;
        return;
      }
    }
    
    const voicesList = ["v1", "v2", "v3"];
    for (let v = 0; v < 3; v++) {
      const order = orderlist[voicesList[v]] || [];
      const patName = order[this.songOrderIdx];
      
      if (!patName) {
        if (this.voiceAlloc[v] === "music") {
          this.voices[v].gate = false;
        }
        continue;
      }
      
      const pat = song.patterns[patName];
      if (!pat || this.songRow >= pat.length) {
        continue;
      }
      
      const row = pat[this.songRow];
      const noteStr = row[0];
      const instName = row[1];
      const effCode = row[2];
      const effParam = row[3];
      
      const voice = this.voices[v];
      const mState = this.musicStates[v];
      
      if (noteStr && noteStr !== "---" && noteStr !== "...") {
        if (noteStr === "off" || noteStr === "OFF" || noteStr === "keyOff" || noteStr === "===") {
          voice.gate = false;
        } else {
          const midi = this.parseNote(noteStr);
          if (midi !== null) {
            mState.noteMidi = midi;
            mState.baseFreq = 440.0 * Math.pow(2.0, (midi - 69.0) / 12.0);
            mState.currentFreq = mState.baseFreq;
            mState.arpTimer = 0;
            
            const inst = song.instruments[instName];
            if (inst) {
              mState.inst = inst;
              voice.wave = inst.wave || "triangle";
              voice.adsr = inst.adsr || [0, 6, 10, 4];
              voice.pw = inst.pw !== undefined ? inst.pw.start : 2048;
              mState.currentPw = voice.pw;
              mState.pwSpeed = inst.pw !== undefined ? inst.pw.speed : 0;
              mState.pwMin = inst.pw !== undefined ? inst.pw.min : 1024;
              mState.pwMax = inst.pw !== undefined ? inst.pw.max : 3072;
              
              if (inst.filter) {
                voice.filterEnabled = true;
                this.filter.cutoff = inst.filter.cutoff * 8000 + 80;
                this.filter.resonance = inst.filter.res / 15.0;
                this.filter.modeLP = inst.filter.mode === "lp";
                this.filter.modeBP = inst.filter.mode === "bp";
                this.filter.modeHP = inst.filter.mode === "hp";
              } else {
                voice.filterEnabled = false;
              }
            }
            
            voice.gate = false;
            voice.gate = true;
          }
        }
      }
      
      mState.effCode = effCode;
      mState.effParam = effParam;
      
      if (effCode === "arp" || effCode === 0) {
        if (effParam) {
          const semi1 = (effParam >> 4) & 0xF;
          const semi2 = effParam & 0xF;
          mState.arpOffsets = [0, semi1, semi2];
        } else {
          mState.arpOffsets = null;
        }
      } else if (effCode === "slide" || effCode === 1) {
        mState.slideSpeed = effParam;
      }
    }
    
    this.songRow++;
    let patLen = 32;
    for (let v = 0; v < 3; v++) {
      const order = orderlist[voicesList[v]] || [];
      const patName = order[this.songOrderIdx];
      if (patName && song.patterns[patName]) {
        patLen = song.patterns[patName].length;
        break;
      }
    }
    
    if (this.songRow >= patLen) {
      this.songRow = 0;
      this.songOrderIdx++;
    }
  }

  updateTrackerEffects(v) {
    const voice = this.voices[v];
    const mState = this.musicStates[v];
    const inst = mState.inst;
    
    let freq = mState.baseFreq;
    if (!freq || freq <= 0) return;
    
    if (mState.arpOffsets) {
      mState.arpTimer = (mState.arpTimer + 1) % mState.arpOffsets.length;
      const offset = mState.arpOffsets[mState.arpTimer];
      freq = mState.baseFreq * Math.pow(2.0, offset / 12.0);
    }
    
    if (mState.effCode === "slide" || mState.effCode === 1) {
      mState.baseFreq += mState.slideSpeed;
      freq = mState.baseFreq;
    }
    
    if (inst && inst.vibrato) {
      mState.vibratoPhase = (mState.vibratoPhase || 0) + (inst.vibrato.speed || 0.1);
      const vibOffset = Math.sin(mState.vibratoPhase) * (inst.vibrato.depth || 5.0);
      freq += vibOffset;
    }
    
    voice.freq = freq;
    
    if (mState.pwSpeed !== 0) {
      mState.currentPw += mState.pwSpeed;
      if (mState.currentPw <= mState.pwMin || mState.currentPw >= mState.pwMax) {
        mState.pwSpeed = -mState.pwSpeed;
      }
      voice.pw = Math.max(0, Math.min(4095, mState.currentPw));
    }
  }

  updateAdsr(voice) {
    const ATTACK_RATES = [0.002, 0.008, 0.016, 0.024, 0.038, 0.056, 0.068, 0.080, 0.1, 0.25, 0.5, 0.8, 1.0, 3.0, 5.0, 8.0];
    const DECAY_RATES  = [0.006, 0.024, 0.048, 0.072, 0.114, 0.168, 0.204, 0.240, 0.3, 0.75, 1.5, 2.4, 3.0, 9.0, 15.0, 24.0];
    
    const a = voice.adsr[0];
    const d = voice.adsr[1];
    const s = voice.adsr[2];
    const r = voice.adsr[3];
    
    const sustainLevel = s / 15.0;
    
    if (voice.gate) {
      if (voice.envState === 0 || voice.envState === 3) {
        voice.envState = 1;
      }
    } else {
      if (voice.envState === 1 || voice.envState === 2) {
        voice.envState = 3;
      }
    }
    
    switch (voice.envState) {
      case 0:
        voice.env = 0;
        break;
      case 1:
        const aSec = ATTACK_RATES[a];
        const attackStep = 1.0 / (aSec * sampleRate);
        voice.env += attackStep;
        if (voice.env >= 1.0) {
          voice.env = 1.0;
          voice.envState = 2;
        }
        break;
      case 2:
        const dSec = DECAY_RATES[d];
        const decayFactor = 1.0 - Math.exp(-5.0 / (dSec * sampleRate));
        voice.env += (sustainLevel - voice.env) * decayFactor;
        break;
      case 3:
        const rSec = DECAY_RATES[r];
        const releaseFactor = 1.0 - Math.exp(-5.0 / (rSec * sampleRate));
        voice.env += (0.0 - voice.env) * releaseFactor;
        if (voice.env <= 0.001) {
          voice.env = 0;
          voice.envState = 0;
        }
        break;
    }
  }

  renderSample() {
    const voiceOutputs = [0, 0, 0];
    const wrapped = [false, false, false];
    
    for (let v = 0; v < 3; v++) {
      const voice = this.voices[v];
      this.updateAdsr(voice);
      
      // Sanity check parameters to prevent NaN pollution
      if (isNaN(voice.phase) || !isFinite(voice.phase)) {
        voice.phase = 0;
      }
      if (isNaN(voice.freq) || !isFinite(voice.freq)) {
        voice.freq = 440;
      }
      if (isNaN(voice.env) || !isFinite(voice.env)) {
        voice.env = 0;
      }

      if (voice.freq <= 0) {
        voiceOutputs[v] = 0;
        continue;
      }
      
      const phaseInc = voice.freq / sampleRate;
      const oldPhase = voice.phase;
      voice.phase += phaseInc;
      if (voice.phase >= 1.0) {
        voice.phase -= 1.0;
        wrapped[v] = true;
      }
    }
    
    for (let v = 0; v < 3; v++) {
      const voice = this.voices[v];
      if (voice.sync) {
        const prevIdx = (v + 2) % 3;
        if (wrapped[prevIdx]) {
          voice.phase = 0;
        }
      }
    }
    
    for (let v = 0; v < 3; v++) {
      const voice = this.voices[v];
      let out = 0;
      
      // C64 combined waveform support (e.g. "triangle+pulse", "sawtooth+noise")
      const waves = voice.wave.split("+");
      for (let wi = 0; wi < waves.length; wi++) {
        let wOut = 0;
        switch (waves[wi]) {
          case "triangle":
            wOut = (voice.phase < 0.5) ? (4.0 * voice.phase - 1.0) : (3.0 - 4.0 * voice.phase);
            break;
          case "sawtooth":
            wOut = 2.0 * voice.phase - 1.0;
            break;
          case "pulse":
            const duty = voice.pw / 4096.0;
            wOut = (voice.phase < duty) ? 1.0 : -1.0;
            break;
          case "noise":
            const phaseInt = Math.floor(voice.phase * 16777216);
            const bit19 = (phaseInt >> 19) & 1;
            if (bit19 !== voice.prevBit19) {
              voice.prevBit19 = bit19;
              const bit = ((voice.lfsr >> 22) ^ (voice.lfsr >> 17)) & 1;
              voice.lfsr = ((voice.lfsr << 1) | bit) & 0x7FFFFF;
            }
            wOut = ((voice.lfsr & 0xFF) / 127.5) - 1.0;
            break;
        }
        out += wOut;
      }
      // Normalize when combining waveforms (SID style)
      if (waves.length > 1) out = Math.tanh(out);
      
      if (voice.ringMod && voice.wave.includes("triangle")) {
        const prevIdx = (v + 2) % 3;
        const prevVoice = this.voices[prevIdx];
        const prevSign = (prevVoice.phase < 0.5) ? 1.0 : -1.0;
        out *= prevSign;
      }
      
      voiceOutputs[v] = out * voice.env;
    }
    
    let filterInput = 0;
    let nonFilteredOutput = 0;
    
    for (let v = 0; v < 3; v++) {
      const voice = this.voices[v];
      const vol = (this.voiceAlloc[v] === "music") ? this.musicVolume : this.sfxVolume;
      const outVal = voiceOutputs[v] * vol;
      
      if (voice.filterEnabled) {
        filterInput += outVal;
      } else {
        nonFilteredOutput += outVal;
      }
    }
    
    // Safety check filter states to prevent NaN loop feedback
    if (isNaN(this.filter.low) || !isFinite(this.filter.low)) this.filter.low = 0;
    if (isNaN(this.filter.band) || !isFinite(this.filter.band)) this.filter.band = 0;

    const f_cutoff = Math.max(0.01, Math.min(0.99, 2.0 * Math.PI * (this.filter.cutoff || 1000) / sampleRate));
    const q_damp = 1.5 * (1.0 - (this.filter.resonance || 0)) + 0.05;
    
    const low = this.filter.low + f_cutoff * this.filter.band;
    const high = filterInput - low - q_damp * this.filter.band;
    const band = f_cutoff * high + this.filter.band;
    
    this.filter.low = isNaN(low) ? 0 : low;
    this.filter.band = isNaN(band) ? 0 : band;
    
    let filteredOutput = 0;
    if (this.filter.modeLP) filteredOutput += this.filter.low;
    if (this.filter.modeBP) filteredOutput += this.filter.band;
    if (this.filter.modeHP) filteredOutput += high;
    
    if (isNaN(filteredOutput) || !isFinite(filteredOutput)) {
      filteredOutput = 0;
    }
    if (isNaN(nonFilteredOutput) || !isFinite(nonFilteredOutput)) {
      nonFilteredOutput = 0;
    }
    
    let mixedOutput = (filteredOutput + nonFilteredOutput) * this.masterVolume;
    mixedOutput = Math.tanh(mixedOutput * 1.25);
    
    if (isNaN(mixedOutput) || !isFinite(mixedOutput)) {
      mixedOutput = 0;
    }
    
    return mixedOutput;
  }
}
registerProcessor("sid-core-processor", SidCoreProcessor);
`;

export class SidForge {
  constructor(audioCtx, workletNode) {
    this.ctx = audioCtx;
    this.node = workletNode;
    this.sfxBank = {};
    
    // Connect worklet node to destination
    this.node.connect(this.ctx.destination);

    // Prevent AudioWorkletNode from being garbage collected by connecting a dummy active source
    try {
      this.dummySource = this.ctx.createConstantSource();
      this.dummySource.offset.value = 0;
      this.dummySource.connect(this.node);
      this.dummySource.start();
    } catch (e) {
      console.warn("ConstantSourceNode connection failed:", e);
    }
  }

  static async create(options = {}) {
    const audioCtx = options.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    
    const blob = new Blob([processorCode], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    
    try {
      await audioCtx.audioWorklet.addModule(url);
    } catch (err) {
      console.error("Failed to load SidCore AudioWorklet:", err);
      throw err;
    } finally {
      URL.revokeObjectURL(url);
    }

    const workletNode = new AudioWorkletNode(audioCtx, "sid-core-processor", {
      numberOfInputs: 1, // Enabled input to hold reference and prevent GC
      numberOfOutputs: 1,
      outputChannelCount: [1]
    });

    return new SidForge(audioCtx, workletNode);
  }

  loadSfxBank(bank) {
    this.sfxBank = bank;
  }

  playSfx(name, options = {}) {
    const sfxData = this.sfxBank[name];
    if (!sfxData) {
      console.warn(`SFX "${name}" not found in bank`);
      return;
    }
    
    // Support options overrides (e.g. custom pitch or priority)
    const activeData = { ...sfxData, ...options };
    this.node.port.postMessage({
      type: "sfx",
      name: name,
      sfxData: activeData
    });
  }

  loadSong(songData) {
    this.songData = songData;
  }

  playSong(options = {}) {
    if (!this.songData) return;
    this.node.port.postMessage({
      type: "song",
      songData: this.songData,
      loop: options.loop !== false
    });
  }

  stopSong() {
    this.node.port.postMessage({ type: "stopSong" });
  }

  resumeSong() {
    this.node.port.postMessage({ type: "resumeSong" });
  }

  setVolume(musicVol, sfxVol) {
    this.node.port.postMessage({
      type: "volume",
      music: musicVol,
      sfx: sfxVol
    });
  }

  stopAll() {
    this.node.port.postMessage({ type: "stopAll" });
  }

  poke(voice, reg, val) {
    this.node.port.postMessage({
      type: "poke",
      voice: voice,
      reg: reg,
      val: val
    });
  }
}
