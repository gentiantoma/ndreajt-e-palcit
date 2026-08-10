import { Component, OnInit, HostListener, inject, signal, Injector } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { HeaderComponent } from './shared/components/header/header.component';
import { ToastComponent } from './shared/components/toast/toast.component';
import { SplashComponent } from './shared/components/splash/splash.component';
import { BottomNavComponent } from './shared/components/bottom-nav/bottom-nav.component';
import { AuthService } from './core/services/auth.service';
import { ReactionPickerService } from './core/services/reaction-picker.service';
import { REACTIONS } from './core/models';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule, TranslateModule, HeaderComponent, ToastComponent, SplashComponent, BottomNavComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnInit {
  private translate = inject(TranslateService);
  private auth      = inject(AuthService);
  private injector  = inject(Injector);
  readonly picker   = inject(ReactionPickerService);
  readonly reactions = REACTIONS;

  /** Ancient intro splash — shown on every load, removed after its animation */
  readonly showSplash = signal(true);

  ngOnInit() {
    const saved = localStorage.getItem('lang') || 'sq';
    this.translate.use(saved);
    this.auth.init();
    setTimeout(() => this.showSplash.set(false), 3150);

    // Pre-build the map off-screen once the app is idle, so tapping "Map"
    // reparents an already-rendered canvas instead of cold-starting MapLibre.
    // Loaded via dynamic import so MapLibre stays out of the initial bundle.
    const warm = () => import('./core/services/map-warmup.service')
      .then(m => this.injector.get(m.MapWarmupService).warmUp())
      .catch(() => {});
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(warm, { timeout: 5000 });
    } else {
      setTimeout(warm, 3500);
    }
  }

  @HostListener('document:click')
  onDocClick() { this.picker.dismiss(); }

  @HostListener('window:scroll')
  onScroll() { this.picker.dismiss(); }
}
