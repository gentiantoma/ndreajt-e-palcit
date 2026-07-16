import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { filter, firstValueFrom } from 'rxjs';
import { fmtMonthYear } from '../../core/utils/date.util';
import { FirestoreService } from '../../core/services/firestore.service';
import { AuthService } from '../../core/services/auth.service';
import { ImageUploadService } from '../../core/services/image-upload.service';
import { ToastService } from '../../core/services/toast.service';
import { PostCardComponent } from '../../shared/components/post-card/post-card.component';
import { UserProfile, Post } from '../../core/models';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule, FormsModule, PostCardComponent],
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.scss'],
})
export class ProfileComponent implements OnInit {
  private route   = inject(ActivatedRoute);
  private fs      = inject(FirestoreService);
  auth            = inject(AuthService);
  private imgUp   = inject(ImageUploadService);
  private toast   = inject(ToastService);
  private translate = inject(TranslateService);

  profile     = signal<UserProfile | null>(null);
  posts       = signal<Post[]>([]);
  loading     = signal(true);
  editMode    = signal(false);
  saving      = signal(false);
  uploading   = signal(false);

  editName    = signal('');
  editBio     = signal('');
  previewPhoto = signal<string | null>(null);
  newPhotoFile = signal<File | null>(null);

  isOwn = signal(false);
  profileAvatarError = signal(false);

  async ngOnInit() {
    const uid = this.route.snapshot.paramMap.get('uid') || '';
    if (!uid) { this.loading.set(false); return; }

    // Wait for auth state to be known before proceeding
    let current = this.auth.currentUser();
    if (current === undefined) {
      current = await firstValueFrom(
        this.auth.user$.pipe(filter(u => u !== undefined))
      ) as any;
    }

    this.isOwn.set(!!current && (current as any)?.uid === uid);

    try {
      const [firestoreProfile, posts] = await Promise.all([
        this.fs.getUser(uid),
        this.fs.getPostsByAuthor(uid),
      ]);

      // If Firestore doc doesn't exist yet but it's own profile, build from auth
      let profile: UserProfile | null = firestoreProfile;
      if (!profile && current && (current as any).uid === uid) {
        const u = current as any;
        profile = {
          uid: u.uid,
          email: u.email ?? '',
          displayName: u.displayName ?? 'Anëtar',
          photoURL: u.photoURL ?? '',
          bio: '',
          role: 'member',
          createdAt: new Date(),
        } as UserProfile;
      }

      this.profile.set(profile);
      this.profileAvatarError.set(false);
      this.posts.set(posts);
    } catch (e) {
      console.error('Profile load error:', e);
      // Still show own profile data from auth even if Firestore fails
      if (current && (current as any).uid === uid) {
        const u = current as any;
        this.profile.set({
          uid: u.uid,
          email: u.email ?? '',
          displayName: u.displayName ?? 'Anëtar',
          photoURL: u.photoURL ?? '',
          bio: '',
          role: 'member',
          createdAt: new Date(),
        } as UserProfile);
      }
    } finally {
      this.loading.set(false);
    }
  }

  startEdit() {
    const p = this.profile();
    if (!p) return;
    const displayName = p.role === 'admin' ? 'Ndreajt e Palçit' : p.displayName;
    this.editName.set(displayName);
    this.editBio.set(p.bio || '');
    this.editMode.set(true);
  }

  cancelEdit() {
    this.editMode.set(false);
    this.previewPhoto.set(null);
    this.newPhotoFile.set(null);
  }

  onPhotoChange(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.newPhotoFile.set(file);
    this.previewPhoto.set(this.imgUp.previewUrl(file));
  }

  async save() {
    const user = this.auth.currentUser();
    if (!user) return;
    if (this.editName().trim().length < 2) { this.toast.error(this.translate.instant('toast.name_too_short')); return; }
    if (this.editBio().length > 300) { this.toast.error(this.translate.instant('toast.bio_too_long')); return; }

    this.saving.set(true);
    try {
      let photoURL = this.profile()?.photoURL || '';
      if (this.newPhotoFile()) {
        this.uploading.set(true);
        photoURL = await this.imgUp.upload(this.newPhotoFile()!);
        this.uploading.set(false);
      }

      const updates: Partial<UserProfile> = {
        displayName: this.editName().trim(),
        bio: this.editBio().trim(),
        photoURL,
      };

      await this.fs.updateUser(user.uid, updates);
      this.profile.update(p => p ? { ...p, ...updates } : p);
      this.editMode.set(false);
      this.previewPhoto.set(null);
      this.newPhotoFile.set(null);
      await this.auth.refreshProfile();
      if (this.auth.isAdmin() && photoURL) {
        this.fs.migrateAdminPosts(user.uid, photoURL).catch(() => {});
      }
      this.toast.success(this.translate.instant('toast.profile_updated'));
    } catch { this.toast.error(this.translate.instant('toast.error_saving')); }
    finally { this.saving.set(false); this.uploading.set(false); }
  }

  getInitial(name: string) { return (name || 'A')[0].toUpperCase(); }

  trackById(_i: number, p: { id?: string }) { return p.id ?? _i; }

  formatJoined(ts: any): string { return fmtMonthYear(ts, 'sq'); }

  get bioCount() { return this.editBio().length; }
}
