import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule, NgIf, NgFor } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, CommonModule, NgIf, NgFor, TranslateModule],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss'],
})
export class HeaderComponent {
  auth    = inject(AuthService);
  toast   = inject(ToastService);
  private translate = inject(TranslateService);

  menuOpen    = signal(false);
  dropOpen    = signal(false);
  currentLang = signal(localStorage.getItem('lang') || 'sq');

  toggleMenu()   { this.menuOpen.update(v => !v); }
  closeMenu()    { this.menuOpen.set(false); this.dropOpen.set(false); }
  toggleDrop()   { this.dropOpen.update(v => !v); }

  switchLang() {
    const next = this.currentLang() === 'sq' ? 'en' : 'sq';
    this.currentLang.set(next);
    localStorage.setItem('lang', next);
    this.translate.use(next);
    this.dropOpen.set(false);
  }

  async login() {
    try {
      await this.auth.loginWithGoogle();
      this.toast.success('Mirë se erdhe!');
    } catch {
      this.toast.error('Ndodhi një gabim gjatë hyrjes.');
    }
  }

  async logout() {
    await this.auth.logout();
    this.dropOpen.set(false);
    this.toast.info('Shihemi!');
  }

  avatarError = false;

  onAvatarError() { this.avatarError = true; }

  get showAvatarImg() {
    return !!this.auth.currentUser()?.photoURL && !this.avatarError;
  }

  getInitial(name: string) {
    return (name || 'A')[0].toUpperCase();
  }
}
