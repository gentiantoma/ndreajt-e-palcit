import { Component, inject, signal, computed } from '@angular/core';
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

  adminAvatarError = false;
  private readonly _avatarErrored = signal(false);
  onAvatarError() { this._avatarErrored.set(true); }

  /** Resolved photo URL — Firestore profile first, Firebase Auth fallback */
  readonly avatarPhotoUrl = computed(() => {
    if (this._avatarErrored()) return null;
    const profile  = this.auth.userProfile();
    const fireUser = this.auth.currentUser();
    return profile?.photoURL || fireUser?.photoURL || null;
  });

  /**
   * True  → show the avatar-img-wrap (skeleton + img when URL known)
   * False → show initials (only when profile is loaded AND has no photo)
   */
  readonly showAvatarSection = computed(() => {
    const loggedIn = this.auth.isLoggedIn();
    if (!loggedIn) return false;
    const profile = this.auth.userProfile();
    if (profile === null) return true;   // profile still loading → keep skeleton
    return !!this.avatarPhotoUrl();      // profile loaded → show section only if has photo
  });

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
      this.toast.success(this.translate.instant('auth.welcome'));
    } catch {
      this.toast.error(this.translate.instant('toast.login_error'));
    }
  }

  async logout() {
    await this.auth.logout();
    this.dropOpen.set(false);
    this.toast.info(this.translate.instant('auth.goodbye'));
  }

  getInitial(name: string) {
    return (name || 'A')[0].toUpperCase();
  }
}
