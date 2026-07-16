import { Injectable, inject, signal } from '@angular/core';
import { Auth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, user } from '@angular/fire/auth';
import { Firestore, doc, getDoc, setDoc, serverTimestamp } from '@angular/fire/firestore';
import { Router } from '@angular/router';
import { map, firstValueFrom } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslateService } from '@ngx-translate/core';
import { UserProfile } from '../models';
import { FirestoreService } from './firestore.service';
import { ToastService } from './toast.service';

export const ADMIN_EMAILS = ['gentiantoma403@gmail.com'];

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private router = inject(Router);
  private fs = inject(FirestoreService);
  private toast = inject(ToastService);
  private translate = inject(TranslateService);

  readonly user$ = user(this.auth);
  readonly currentUser = toSignal(this.user$);
  readonly isAdmin = toSignal(
    this.user$.pipe(map(u => !!u && ADMIN_EMAILS.includes(u.email ?? '')))
  );

  readonly isLoggedIn = toSignal(
    this.user$.pipe(map(u => !!u))
  );

  /** Synchronous admin check off the resolved current user — avoids the
   *  separate `isAdmin` signal lagging behind `currentUser` on first render. */
  isAdminUser(): boolean {
    return ADMIN_EMAILS.includes(this.currentUser()?.email ?? '');
  }

  readonly authReady = signal(false);
  readonly userProfile = signal<UserProfile | null>(null);
  private migrationDone = false;

  private get isIOS(): boolean {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  init() {
    // Handle redirect result from iOS Google sign-in
    getRedirectResult(this.auth)
      .then(cred => { if (cred?.user) this.ensureUserDoc(cred.user).catch(() => {}); })
      .catch(() => {});

    this.user$.subscribe(async u => {
      if (!this.authReady()) this.authReady.set(true);
      if (u) {
        await this.ensureUserDoc(u);
        const snap = await getDoc(doc(this.firestore, 'users', u.uid));
        if (snap.exists()) {
          const profile = snap.data() as UserProfile;
          // Suspended accounts are ejected immediately — no session survives suspension
          if (profile.suspended && !ADMIN_EMAILS.includes(u.email ?? '')) {
            this.userProfile.set(null);
            await signOut(this.auth);
            this.toast.error(this.translate.instant('toast.account_suspended'));
            this.router.navigate(['/']);
            return;
          }
          this.userProfile.set(profile);
          if (!this.migrationDone && ADMIN_EMAILS.includes(u.email ?? '') && profile.photoURL) {
            this.migrationDone = true;
            this.fs.migrateAdminPosts(u.uid, profile.photoURL).catch(() => {});
          }
        }
      } else {
        this.userProfile.set(null);
      }
    });
  }

  async loginWithGoogle() {
    const provider = new GoogleAuthProvider();
    if (this.isIOS) {
      // iOS Safari blocks popups — use redirect flow instead
      await signInWithRedirect(this.auth, provider);
      return null;
    }
    const cred = await signInWithPopup(this.auth, provider);
    await this.ensureUserDoc(cred.user);
    // Refuse the session outright if the account is suspended
    const snap = await getDoc(doc(this.firestore, 'users', cred.user.uid));
    const profile = snap.exists() ? (snap.data() as UserProfile) : null;
    if (profile?.suspended && !ADMIN_EMAILS.includes(cred.user.email ?? '')) {
      await signOut(this.auth);
      throw { code: 'auth/suspended' };
    }
    return cred.user;
  }

  async logout() {
    await signOut(this.auth);
    this.router.navigate(['/']);
  }

  async getCurrentUser() {
    return firstValueFrom(this.user$);
  }

  /** Returns "Ndreajt e Palçit" for admin users — use everywhere a name is displayed publicly.
   *  For members: Firestore profile name → Google name → email prefix → "Anëtar". */
  get publicDisplayName(): string {
    if (this.isAdmin()) return 'Ndreajt e Palçit';
    const u = this.currentUser();
    return this.userProfile()?.displayName?.trim()
      || u?.displayName?.trim()
      || this.nameFromEmail(u?.email)
      || 'Anëtar';
  }

  /** "gjovalin.beka" → "Gjovalin Beka" — a friendly fallback when no name is set */
  private nameFromEmail(email?: string | null): string {
    if (!email) return '';
    const local = email.split('@')[0];
    return local
      .split(/[._-]+/)
      .filter(Boolean)
      .map(p => p.charAt(0).toUpperCase() + p.slice(1))
      .join(' ');
  }

  async refreshProfile(): Promise<void> {
    const u = this.currentUser();
    if (!u) return;
    const snap = await getDoc(doc(this.firestore, 'users', u.uid));
    if (snap.exists()) this.userProfile.set(snap.data() as UserProfile);
  }

  private async ensureUserDoc(fireUser: any) {
    const ref = doc(this.firestore, 'users', fireUser.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const profile: UserProfile = {
        uid: fireUser.uid,
        email: fireUser.email ?? '',
        displayName: fireUser.displayName?.trim() || this.nameFromEmail(fireUser.email) || 'Anëtar',
        photoURL: fireUser.photoURL ?? '',
        bio: '',
        role: ADMIN_EMAILS.includes(fireUser.email ?? '') ? 'admin' : 'member',
        createdAt: serverTimestamp(),
      };
      await setDoc(ref, profile);
    }
  }
}
