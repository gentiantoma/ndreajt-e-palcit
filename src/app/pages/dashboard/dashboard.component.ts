import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
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
    if (user) this.fs.migrateAdminPosts(user.uid).catch(() => {});
    await this.loadPosts();
    this.loading.set(false);
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

  async loadUsers() {
    this.loadingUsers.set(true);
    try {
      const raw = await this.fs.getAllUsers();
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
      this.toast.error('Titulli dhe teksti janë të detyrueshëm.'); return;
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

      const postData: Partial<Post> = {
        titleSq: this.formTitleSq().trim(),
        titleEn: this.formTitleEn().trim() || undefined,
        bodySq: this.formBodySq().trim(),
        bodyEn: this.formBodyEn().trim() || undefined,
        category: this.formCategory(),
        published: this.formPublished(),
        coverImage: coverImage || undefined,
        images,
        authorId: user.uid,
        authorName: 'Ndreajt e Palçit',
        authorPhoto: '',
        authorIsAdmin: true,
      };

      const editing = this.editingPost();
      if (editing?.id) {
        await this.fs.updatePost(editing.id, postData);
        this.toast.success('Postimi u përditësua.');
      } else {
        await this.fs.createPost(postData);
        this.toast.success('Postimi u krijua.');
      }

      await this.loadPosts();
      this.resetForm();
      this.activeTab.set('posts');
    } catch (e) {
      this.toast.error('Gabim gjatë ruajtjes.');
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
    this.toast.success('Postimi u fshi.');
  }

  async deleteComment(postId: string, commentId: string) {
    await this.fs.deleteComment(postId, commentId);
    this.comments.update(list => list.filter(c => c.id !== commentId));
    this.toast.success('Komenti u fshi.');
  }

  formatDate(ts: any): string { return fmtDateShort(ts, 'sq') || '—'; }

  getInitial(name?: string) { return ((name || '?')[0] || '?').toUpperCase(); }

  trackByUid(_i: number, u: UserWithStats) { return u.uid; }

  get skeletonRows() { return new Array(5); }
}
