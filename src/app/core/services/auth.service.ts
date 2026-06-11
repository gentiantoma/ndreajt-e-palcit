import { Injectable, inject, signal } from '@angular/core';
import { Auth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, user } from '@angular/fire/auth';
import { Firestore, doc, getDoc, setDoc, serverTimestamp } from '@angular/fire/firestore';
import { Router } from '@angular/router';
import { map, firstValueFrom } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { UserProfile } from '../models';
import { FirestoreService } from './firestore.service';

export const ADMIN_EMAILS = ['gentiantoma403@gmail.com'];

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private router = inject(Router);
  private fs = inject(FirestoreService);

  readonly user$ = user(this.auth);
  readonly currentUser = toSignal(this.user$);
  readonly isAdmin = toSignal(
    this.user$.pipe(map(u => !!u && ADMIN_EMAILS.includes(u.email ?? '')))
  );

  readonly isLoggedIn = toSignal(
    this.user$.pipe(map(u => !!u))
  );

  readonly authReady = signal(false);
  readonly userProfile = signal<UserProfile | null>(null);

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
          this.userProfile.set(profile);
          if (ADMIN_EMAILS.includes(u.email ?? '') && profile.photoURL) {
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
    return cred.user;
  }

  async logout() {
    await signOut(this.auth);
    this.router.navigate(['/']);
  }

  async getCurrentUser() {
    return firstValueFrom(this.user$);
  }

  /** Returns "Ndreajt e Palçit" for admin users — use everywhere a name is displayed publicly */
  get publicDisplayName(): string {
    return this.isAdmin() ? 'Ndreajt e Palçit' : (this.currentUser()?.displayName || 'Anëtar');
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
        displayName: fireUser.displayName ?? 'Anëtar',
        photoURL: fireUser.photoURL ?? '',
        bio: '',
        role: ADMIN_EMAILS.includes(fireUser.email ?? '') ? 'admin' : 'member',
        createdAt: serverTimestamp(),
      };
      await setDoc(ref, profile);
    }
  }
}
