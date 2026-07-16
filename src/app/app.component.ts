import { Component, OnInit, HostListener, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { HeaderComponent } from './shared/components/header/header.component';
import { ToastComponent } from './shared/components/toast/toast.component';
import { SplashComponent } from './shared/components/splash/splash.component';
import { AuthService } from './core/services/auth.service';
import { ReactionPickerService } from './core/services/reaction-picker.service';
import { REACTIONS } from './core/models';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule, TranslateModule, HeaderComponent, ToastComponent, SplashComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnInit {
  private translate = inject(TranslateService);
  private auth      = inject(AuthService);
  readonly picker   = inject(ReactionPickerService);
  readonly reactions = REACTIONS;

  /** Ancient intro splash — shown on every load, removed after its animation */
  readonly showSplash = signal(true);

  ngOnInit() {
    const saved = localStorage.getItem('lang') || 'sq';
    this.translate.use(saved);
    this.auth.init();
    setTimeout(() => this.showSplash.set(false), 3150);
  }

  @HostListener('document:click')
  onDocClick() { this.picker.dismiss(); }

  @HostListener('window:scroll')
  onScroll() { this.picker.dismiss(); }
}
