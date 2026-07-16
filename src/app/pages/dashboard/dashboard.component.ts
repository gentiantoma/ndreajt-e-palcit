import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { RouterLink } from '@angular/router';
import { where, orderBy } from '@angular/fire/firestore';
import { fmtDateShort } from '../../core/utils/date.util';
import { FirestoreService } from '../../core/services/firestore.service';
import { AuthService } from '../../core/services/auth.service';
import { ImageUploadService } from '../../core/services/image-upload.service';
import { ToastService } from '../../core/services/toast.service';
import { Post, Comment, PostCategory } from '../../core/models';

type Tab = 'posts' | 'create' | 'comments' | 'users';

interface UserWithStats {
  uid: string;
  displayName?: string;
  email?: string;
  photoURL?: string;
  role?: string;
  suspended?: boolean;
  commentCount: number;
  likeCount: number;
  createdAt?: any;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit {
  private fs    = inject(FirestoreService);
  auth          = inject(AuthService);
  private imgUp = inject(ImageUploadService);
  private toast = inject(ToastService);
  private translate = inject(TranslateService);

  activeTab    = signal<Tab>('posts');
  posts        = signal<Post[]>([]);
  comments     = signal<(Comment & { postId: string })[]>([]);
  users        = signal<UserWithStats[]>([]);
  loading      = signal(true);
  loadingUsers = signal(false);
  saving       = signal(false);
  deleteTarget = signal<string | null>(null);
  editingPost  = signal<Post | null>(null);

  /* form fields */
  formTitleSq  = signal('');
  formTitleEn  = signal('');
  formBodySq   = signal('');
  formBodyEn   = signal('');
  formCategory = signal<PostCategory>('lajme');
  formPublished = signal(true);
  formCoverFile = signal<File | null>(null);
  formCoverPreview = signal<string | null>(null);
  formExtraFiles = signal<File[]>([]);
  formExtraPreviews = signal<string[]>([]);
  uploadingImages = signal(false);

  readonly categories: PostCategory[] = ['lajme', 'histori', 'njoftim', 'events', 'pajtimet', 'takimet', 'other'];

  async ngOnInit() {
    const user = this.auth.currentUser();
    if (user) {
      this.fs.getUser(user.uid).then(profile => {
        this.fs.migrateAdminPosts(user.uid, profile?.photoURL || '').catch(() => {});
      });
    }
    await this.loadPosts();
    this.loading.set(false);
    // Warm the members list in the background so the "Anëtarët N" badge is instant
    this.loadUsers();
  }

  async loadPosts() {
    const data = await this.fs.getPosts([orderBy('createdAt', 'desc')]);
    this.posts.set(data);
  }

  async loadComments() {
    const data = await this.fs.getAllComments(50);
    this.comments.set(data);
  }

  switchTab(tab: Tab) {
    this.activeTab.set(tab);
    if (tab === 'comments' && this.comments().length === 0) this.loadComments();
    if (tab === 'users'    && this.users().length === 0)    this.loadUsers();
    if (tab === 'create') this.resetForm();
  }

  /* ── Account suspension (with confirmation) ── */
  suspendTarget = signal<UserWithStats | null>(null);

  requestSuspend(u: UserWithStats) { this.suspendTarget.set(u); }

  async confirmSuspend() {
    const u = this.suspendTarget();
    if (!u) return;
    this.suspendTarget.set(null);
    const next = !u.suspended;
    try {
      await this.fs.setUserSuspended(u.uid, next);
      this.users.update(list => list.map(x => x.uid === u.uid ? { ...x, suspended: next } : x));
      this.toast.success(this.translate.instant(next ? 'toast.user_suspended' : 'toast.user_unsuspended'));
    } catch {
      this.toast.error(this.translate.instant('toast.error_generic'));
    }
  }

  /* ── Comment deletion (with confirmation) ── */
  commentDeleteTarget = signal<{ postId: string; id: string } | null>(null);

  requestCommentDelete(postId: string, id: string) { this.commentDeleteTarget.set({ postId, id }); }

  async confirmCommentDelete() {
    const t = this.commentDeleteTarget();
    if (!t) return;
    this.commentDeleteTarget.set(null);
    await this.deleteComment(t.postId, t.id);
  }

  private usersLoaded = false;
  async loadUsers() {
    if (this.usersLoaded) return;
    this.usersLoaded = true;
    this.loadingUsers.set(true);
    try {
      // 1) Show the list + count immediately (one fast query)
      const raw = await this.fs.getAllUsers();
      this.users.set(raw.map(u => ({ ...u, commentCount: 0, likeCount: 0 }) as UserWithStats));
      this.loadingUsers.set(false);

      // 2) Enrich each row's stats in the background, then re-sort
      const withStats = await Promise.all(raw.map(async u => {
        const [commentCount, likeCount] = await Promise.all([
          this.fs.getCommentsCountByUser(u.uid),
          this.fs.getLikesCountByUser(u.uid),
        ]);
        return { ...u, commentCount, likeCount } as UserWithStats;
      }));
      withStats.sort((a, b) => b.commentCount - a.commentCount);
      this.users.set(withStats);
    } catch (e) {
      console.error('loadUsers error', e);
      this.usersLoaded = false;
    } finally {
      this.loadingUsers.set(false);
    }
  }

  onCoverChange(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.formCoverFile.set(file);
    this.formCoverPreview.set(this.imgUp.previewUrl(file));
  }

  onExtraChange(event: Event) {
    const files = Array.from((event.target as HTMLInputElement).files || []);
    this.formExtraFiles.update(prev => [...prev, ...files]);
    this.formExtraPreviews.update(prev => [...prev, ...files.map(f => this.imgUp.previewUrl(f))]);
  }

  removeExtra(i: number) {
    this.formExtraFiles.update(arr => arr.filter((_, idx) => idx !== i));
    this.formExtraPreviews.update(arr => arr.filter((_, idx) => idx !== i));
  }

  removeCover() {
    this.formCoverFile.set(null);
    this.formCoverPreview.set(null);
  }

  resetForm() {
    this.formTitleSq.set(''); this.formTitleEn.set('');
    this.formBodySq.set(''); this.formBodyEn.set('');
    this.formCategory.set('lajme'); this.formPublished.set(true);
    this.formCoverFile.set(null); this.formCoverPreview.set(null);
    this.formExtraFiles.set([]); this.formExtraPreviews.set([]);
    this.editingPost.set(null);
  }

  editPost(post: Post) {
    this.editingPost.set(post);
    this.formTitleSq.set(post.titleSq);
    this.formTitleEn.set(post.titleEn || '');
    this.formBodySq.set(post.bodySq);
    this.formBodyEn.set(post.bodyEn || '');
    this.formCategory.set(post.category);
    this.formPublished.set(post.published);
    this.formCoverPreview.set(post.coverImage || null);
    this.formExtraPreviews.set(post.images || []);
    this.activeTab.set('create');
  }

  async savePost() {
    if (!this.formTitleSq().trim() || !this.formBodySq().trim()) {
      this.toast.error(this.translate.instant('toast.required_title_body')); return;
    }
    const user = this.auth.currentUser();
    if (!user) return;

    this.saving.set(true);
    try {
      this.uploadingImages.set(true);
      let coverImage = this.editingPost()?.coverImage || '';
      if (this.formCoverFile()) {
        coverImage = await this.imgUp.upload(this.formCoverFile()!);
      }

      let images: string[] = this.editingPost()?.images?.filter(
        url => this.formExtraPreviews().includes(url)
      ) || [];
      if (this.formExtraFiles().length > 0) {
        const newUrls = await this.imgUp.uploadAll(this.formExtraFiles());
        images = [...images, ...newUrls];
      }
      this.uploadingImages.set(false);

      const titleEn = this.formTitleEn().trim();
      const bodyEn = this.formBodyEn().trim();
      const postData: Partial<Post> = {
        titleSq: this.formTitleSq().trim(),
        ...(titleEn ? { titleEn } : {}),
        bodySq: this.formBodySq().trim(),
        ...(bodyEn ? { bodyEn } : {}),
        category: this.formCategory(),
        published: this.formPublished(),
        ...(coverImage ? { coverImage } : {}),
        images,
        authorId: user.uid,
        authorName: 'Ndreajt e Palçit',
        authorPhoto: (await this.fs.getUser(user.uid))?.photoURL || '',
        authorIsAdmin: true,
      };

      const editing = this.editingPost();
      if (editing?.id) {
        await this.fs.updatePost(editing.id, postData);
        this.toast.success(this.translate.instant('toast.post_updated'));
      } else {
        await this.fs.createPost(postData);
        this.toast.success(this.translate.instant('toast.post_created'));
      }

      await this.loadPosts();
      this.resetForm();
      this.activeTab.set('posts');
    } catch (e) {
      this.toast.error(this.translate.instant('toast.error_saving'));
      console.error(e);
    } finally {
      this.saving.set(false);
      this.uploadingImages.set(false);
    }
  }

  async togglePublished(post: Post) {
    if (!post.id) return;
    await this.fs.updatePost(post.id, { published: !post.published });
    this.posts.update(list => list.map(p => p.id === post.id ? { ...p, published: !p.published } : p));
  }

  confirmDelete(postId: string) { this.deleteTarget.set(postId); }
  cancelDelete() { this.deleteTarget.set(null); }

  async doDelete() {
    const id = this.deleteTarget();
    if (!id) return;
    await this.fs.deletePost(id);
    this.posts.update(list => list.filter(p => p.id !== id));
    this.deleteTarget.set(null);
    this.toast.success(this.translate.instant('toast.post_deleted'));
  }

  async deleteComment(postId: string, commentId: string) {
    await this.fs.deleteComment(postId, commentId);
    this.comments.update(list => list.filter(c => c.id !== commentId));
    this.toast.success(this.translate.instant('toast.comment_deleted'));
  }

  formatDate(ts: any): string { return fmtDateShort(ts, 'sq') || '—'; }

  getInitial(name?: string) { return ((name || '?')[0] || '?').toUpperCase(); }

  trackByUid(_i: number, u: UserWithStats) { return u.uid; }

  get skeletonRows() { return new Array(5); }
}
