import type { Priority } from '../sim/types';

/** Akoestische alarmhoorn via Web Audio. Patroon hangt af van de hoogste prioriteit. */
export class Horn {
  private ctx: AudioContext | null = null;
  private timer: number | null = null;
  private last = 0;
  priority: Priority | null = null;
  sounding = false;

  /** Moet na een user gesture aangeroepen worden (browser autoplay policy). */
  unlock(): void {
    try {
      this.ctx ??= new AudioContext();
      void this.ctx.resume();
    } catch {
      /* geen audio beschikbaar */
    }
    if (this.timer === null) this.timer = window.setInterval(() => this.tick(), 250);
  }

  set(sounding: boolean, priority: Priority | null): void {
    this.sounding = sounding;
    this.priority = priority;
  }

  private beep(freq: number, dur: number): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    g.gain.value = 0.04;
    o.connect(g).connect(this.ctx.destination);
    o.start();
    o.stop(this.ctx.currentTime + dur);
  }

  private tick(): void {
    if (!this.sounding || !this.priority) return;
    const now = performance.now();
    const cfg = { CRITICAL: [900, 500, 0.18], WARNING: [660, 1200, 0.25], ADVISORY: [440, 3000, 0.3], LOG: [0, 1e9, 0] }[this.priority];
    if (now - this.last >= cfg[1]) {
      this.last = now;
      this.beep(cfg[0], cfg[2]);
    }
  }
}
