import { Component, inject, signal, computed, effect } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule, NgIf, NgFor } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AppNotification, REACTIONS } from '../../../core/models';
import { fmtDateWithTime } from '../../../core/utils/date.util';

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
  private notifSvc  = inject(NotificationService);
  private router    = inject(Router);

  menuOpen    = signal(false);
  dropOpen    = signal(false);
  currentLang = signal(localStorage.getItem('lang') || 'sq');

  /* ── Notifications ── */
  private readonly NOTIF_PAGE = 20;
  notifOpen     = signal(false);
  notifications = signal<AppNotification[]>([]);
  notifVisible  = signal(this.NOTIF_PAGE);
  unreadCount   = computed(() => this.notifications().filter(n => !n.read).length);
  visibleNotifs = computed(() => this.notifications().slice(0, this.notifVisible()));
  hasMoreNotifs = computed(() => this.notifications().length > this.notifVisible());
  loadMoreNotifs() { this.notifVisible.update(c => c + this.NOTIF_PAGE); }
  private notifSub?: Subscription;

  /** Re-subscribe to the notification stream whenever the signed-in user changes */
  private readonly notifWatch = effect(() => {
    const user = this.auth.currentUser();
    this.notifSub?.unsubscribe();
    if (user?.uid) {
      this.notifSub = this.notifSvc.notifications$(user.uid)
        .subscribe(list => this.notifications.set(list));
    } else {
      this.notifications.set([]);
    }
  }, { allowSignalWrites: true });

  toggleNotif() {
    this.notifOpen.update(v => !v);
    this.notifVisible.set(this.NOTIF_PAGE); // reset pagination each open
    this.dropOpen.set(false);
    this.menuOpen.set(false);
  }

  async openNotification(n: AppNotification) {
    this.notifOpen.set(false);
    if (!n.read && n.id) this.notifSvc.markRead(n.id);
    this.router.navigate(['/post', n.postId]);
  }

  markAllRead() { this.notifSvc.markAllRead(this.notifications()); }

  notifIcon(n: AppNotification): string {
    if (n.type === 'reaction') return REACTIONS.find(r => r.type === n.reaction)?.emoji ?? '🪶';
    return '📜';
  }

  notifTime(n: AppNotification): string {
    return fmtDateWithTime(n.createdAt, this.currentLang());
  }

  trackByNotif(_i: number, n: AppNotification) { return n.id ?? _i; }

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

  toggleMenu()   { this.menuOpen.update(v => !v); this.notifOpen.set(false); }
  closeMenu()    { this.menuOpen.set(false); this.dropOpen.set(false); this.notifOpen.set(false); }
  toggleDrop()   { this.dropOpen.update(v => !v); this.notifOpen.set(false); }

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
    } catch (err: any) {
      if (err?.code === 'auth/suspended') {
        this.toast.error(this.translate.instant('toast.account_suspended'));
      } else {
        this.toast.error(this.translate.instant('toast.login_error'));
      }
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
