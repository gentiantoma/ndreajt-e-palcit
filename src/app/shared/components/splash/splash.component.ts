import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

/*
 * Ancient "chronicle opening" splash — plays on every app load / refresh.
 * A hand-drawn mountain emblem is inked in, the title is revealed with a gold
 * shimmer, rules expand, embers drift up, then the whole thing fades to reveal
 * the parchment app behind it. Pure CSS/SVG — no assets, no network cost.
 */
@Component({
  selector: 'app-splash',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './splash.component.html',
  styleUrls: ['./splash.component.scss'],
})
export class SplashComponent {
  /** Ten embers with pre-computed drift positions/timings */
  readonly embers = Array.from({ length: 12 });
}
