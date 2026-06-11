import { Injectable, signal } from '@angular/core';
import { ReactionType } from '../models';

@Injectable({ providedIn: 'root' })
export class ReactionPickerService {
  readonly isOpen         = signal(false);
  readonly isFading       = signal(false);
  readonly position       = signal<{ top: number; left: number } | null>(null);
  readonly currentReaction = signal<ReactionType | null>(null);

  private onSelectCb?: (r: ReactionType) => void;

  toggle(
    pos: { top: number; left: number },
    current: ReactionType | null,
    onSelect: (r: ReactionType) => void
  ) {
    if (this.isOpen()) { this.dismiss(); return; }
    this.onSelectCb      = onSelect;
    this.currentReaction.set(current);
    this.position.set(pos);
    this.isFading.set(false);
    this.isOpen.set(true);
  }

  select(r: ReactionType) {
    this.onSelectCb?.(r);
    this.dismiss();
  }

  dismiss() {
    if (!this.isOpen()) return;
    this.isFading.set(true);
    setTimeout(() => {
      this.isOpen.set(false);
      this.position.set(null);
      this.isFading.set(false);
      this.onSelectCb = undefined;
    }, 180);
  }
}
