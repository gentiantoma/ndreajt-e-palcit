import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent {
  private auth      = inject(AuthService);
  private toast     = inject(ToastService);
  private router    = inject(Router);
  private translate = inject(TranslateService);

  loading = signal(false);

  async loginGoogle() {
    this.loading.set(true);
    try {
      const user = await this.auth.loginWithGoogle();
      // null means redirect was triggered (iOS) — page will navigate away automatically
      if (user) {
        this.toast.success(this.translate.instant('auth.welcome'));
        this.router.navigate(['/']);
      }
    } catch (err: any) {
      this.loading.set(false);
      if (err?.code === 'auth/suspended') {
        this.toast.error(this.translate.instant('toast.account_suspended'));
      } else if (err?.code !== 'auth/popup-closed-by-user') {
        this.toast.error(this.translate.instant('toast.login_error'));
      }
    }
  }
}
