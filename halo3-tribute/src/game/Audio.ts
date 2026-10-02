/** Lightweight procedural SFX — no copyrighted audio. */
export class AudioBus {
  private ctx: AudioContext | null = null;

  ensure() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private tone(
    freq: number,
    duration: number,
    type: OscillatorType,
    gain = 0.08,
    slideTo?: number,
  ) {
    const ctx = this.ensure();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), ctx.currentTime + duration);
    }
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  private noise(duration: number, gain = 0.05) {
    const ctx = this.ensure();
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    src.buffer = buffer;
    g.gain.value = gain;
    src.connect(g);
    g.connect(ctx.destination);
    src.start();
  }

  shootBR() {
    this.noise(0.04, 0.06);
    this.tone(180, 0.06, "square", 0.04, 90);
  }

  shootPlasma() {
    this.tone(420, 0.12, "sawtooth", 0.05, 180);
  }

  reload() {
    this.tone(220, 0.08, "triangle", 0.04);
    setTimeout(() => this.tone(280, 0.1, "triangle", 0.04), 120);
  }

  grenadeThrow() {
    this.tone(140, 0.15, "sine", 0.05, 80);
  }

  explosion() {
    this.noise(0.35, 0.12);
    this.tone(90, 0.3, "sawtooth", 0.08, 40);
  }

  melee() {
    this.noise(0.08, 0.08);
    this.tone(100, 0.1, "square", 0.06, 60);
  }

  hit() {
    this.tone(90, 0.12, "sawtooth", 0.07, 40);
  }

  enemyDie() {
    this.tone(300, 0.2, "sawtooth", 0.05, 60);
  }

  shieldBreak() {
    this.tone(600, 0.25, "sine", 0.06, 120);
  }

  win() {
    this.tone(440, 0.2, "triangle", 0.06);
    setTimeout(() => this.tone(554, 0.25, "triangle", 0.06), 180);
    setTimeout(() => this.tone(659, 0.35, "triangle", 0.07), 360);
  }

  lose() {
    this.tone(220, 0.4, "sawtooth", 0.06, 80);
  }
}
