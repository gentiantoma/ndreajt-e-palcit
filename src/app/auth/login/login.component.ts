import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
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
  private auth   = inject(AuthService);
  private toast  = inject(ToastService);
  private router = inject(Router);

  loading = signal(false);

  async loginGoogle() {
    this.loading.set(true);
    try {
      const user = await this.auth.loginWithGoogle();
      // null means redirect was triggered (iOS) — page will navigate away automatically
      if (user) {
        this.toast.success('Mirë se erdhe!');
        this.router.navigate(['/']);
      }
    } catch (err: any) {
      this.loading.set(false);
      if (err?.code !== 'auth/popup-closed-by-user') {
        this.toast.error('Ndodhi një gabim. Provoni sërish.');
      }
    }
  }
}
