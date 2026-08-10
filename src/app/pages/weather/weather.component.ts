import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { WeatherService, WeatherBundle, PALC_COORDS } from '../../core/services/weather.service';

@Component({
  selector: 'app-weather',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  templateUrl: './weather.component.html',
  styleUrls: ['./weather.component.scss'],
})
export class WeatherComponent implements OnInit {
  private weatherSvc = inject(WeatherService);
  private translate  = inject(TranslateService);

  readonly coords = PALC_COORDS;

  loading = signal(true);
  error   = signal(false);
  data    = signal<WeatherBundle | null>(null);

  ngOnInit() { this.load(); }

  load() {
    this.loading.set(true);
    this.error.set(false);
    this.weatherSvc.fetch().subscribe(bundle => {
      this.loading.set(false);
      if (!bundle) { this.error.set(true); return; }
      this.data.set(bundle);
    });
  }

  /* ── presentation helpers ── */

  desc(code: number, isDay = true) {
    return this.weatherSvc.describe(code, isDay);
  }

  /** iOS-Weather-style sky gradient class, driven by condition + day/night. */
  sky(): string {
    const wx = this.data();
    if (!wx) return 'sky-clear-day';
    const c = wx.now.code;
    const day = wx.now.isDay;
    if (c >= 95) return 'sky-storm';
    if (c >= 71 && c <= 86 || c === 77) return 'sky-snow';
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 'sky-rain';
    if (c === 45 || c === 48) return 'sky-fog';
    if (c === 2 || c === 3) return day ? 'sky-cloudy-day' : 'sky-cloudy-night';
    // clear / mostly clear
    return day ? 'sky-clear-day' : 'sky-clear-night';
  }

  descText(code: number, isDay = true): string {
    return this.translate.instant(this.desc(code, isDay).key);
  }

  private lang() { return this.translate.currentLang || 'sq'; }

  hourLabel(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleTimeString(this.lang() === 'sq' ? 'sq-AL' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  timeOnly(iso: string): string {
    if (!iso) return '';
    return this.hourLabel(iso);
  }

  dayName(iso: string, index: number): string {
    if (index === 0) return this.translate.instant('weather.today');
    if (index === 1) return this.translate.instant('weather.tomorrow');
    const d = new Date(iso);
    return d.toLocaleDateString(this.lang() === 'sq' ? 'sq-AL' : 'en-GB', { weekday: 'long' });
  }

  dayShort(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString(this.lang() === 'sq' ? 'sq-AL' : 'en-GB', { day: '2-digit', month: 'short' });
  }

  updatedLabel(ms: number): string {
    return new Date(ms).toLocaleTimeString(this.lang() === 'sq' ? 'sq-AL' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  /** Temperature-range bar (iOS style): fill spans this day's min→max within
      the whole week's min→max, expressed as left/right inset percentages. */
  private weekRange(days: { tMin: number; tMax: number }[]): { lo: number; hi: number } {
    const lo = Math.min(...days.map(d => d.tMin));
    const hi = Math.max(...days.map(d => d.tMax));
    return { lo, hi: hi === lo ? lo + 1 : hi };
  }
  barLeft(d: { tMin: number; tMax: number }, days: { tMin: number; tMax: number }[]): number {
    const { lo, hi } = this.weekRange(days);
    return ((d.tMin - lo) / (hi - lo)) * 100;
  }
  barRight(d: { tMin: number; tMax: number }, days: { tMin: number; tMax: number }[]): number {
    const { lo, hi } = this.weekRange(days);
    return ((hi - d.tMax) / (hi - lo)) * 100;
  }

  /** 8-point compass abbreviation from a wind bearing. */
  windCompass(deg: number): string {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(deg / 45) % 8];
  }

  trackByDate = (_: number, d: { date?: string; time?: string }) => d.date ?? d.time ?? _;
}
