import { Injectable } from '@angular/core';

type SoundName = 'like' | 'unlike' | 'comment_send' | 'bookmark';

@Injectable({ providedIn: 'root' })
export class AudioService {
  private ctx?: AudioContext;
  private enabled = true;

  private getCtx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  private play(fn: (ctx: AudioContext) => void) {
    if (!this.enabled) return;
    try {
      const ctx = this.getCtx();
      if (ctx.state === 'suspended') ctx.resume();
      fn(ctx);
    } catch { /* silent */ }
  }

  /* Like sound — short rising pop (Facebook-like) */
  like() {
    this.play(ctx => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.2);
    });
  }

  /* Unlike sound — short falling pop */
  unlike() {
    this.play(ctx => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(330, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.18);
    });
  }

  /* Comment sent — soft double-tap */
  commentSend() {
    this.play(ctx => {
      [0, 0.08].forEach(delay => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(520, ctx.currentTime + delay);
        gain.gain.setValueAtTime(0.1, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.12);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + 0.12);
      });
    });
  }

  /* Bookmark — soft click */
  bookmark() {
    this.play(ctx => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.1);
    });
  }
}
