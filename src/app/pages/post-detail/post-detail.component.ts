import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { fmtDateFull, fmtDateWithTime } from '../../core/utils/date.util';
import { FirestoreService } from '../../core/services/firestore.service';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { SeoService } from '../../core/services/seo.service';
import { LazyImgDirective } from '../../shared/directives/lazy-img.directive';
import { Post, Comment } from '../../core/models';
import { DEMO_POSTS } from '../../data/demo-posts';

@Component({
  selector: 'app-post-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule, FormsModule, LazyImgDirective],
  templateUrl: './post-detail.component.html',
  styleUrls: ['./post-detail.component.scss'],
})
export class PostDetailComponent implements OnInit, OnDestroy {
  private route     = inject(ActivatedRoute);
  private fs        = inject(FirestoreService);
  auth              = inject(AuthService);
  private toast     = inject(ToastService);
  private seo       = inject(SeoService);
  private translate = inject(TranslateService);

  post        = signal<Post | null>(null);
  authorAvatarError = signal(false);
  myAvatarError     = signal(false);
  loading     = signal(true);
  comments    = signal<Comment[]>([]);
  commentText = signal('');
  submitting  = signal(false);
  liked       = signal(false);
  likeCount   = signal(0);
  bookmarked  = signal(false);
  lightboxImg = signal<string | null>(null);

  private commentsSub?: Subscription;
  private postId = '';

  get lang()  { return this.translate.currentLang || 'sq'; }
  get title() { const p = this.post(); return p ? (this.lang === 'en' && p.titleEn ? p.titleEn : p.titleSq) : ''; }
  get body()  { const p = this.post(); return p ? (this.lang === 'en' && p.bodyEn  ? p.bodyEn  : p.bodySq)  : ''; }

  get allImages(): string[] {
    const p = this.post();
    if (!p) return [];
    const arr: string[] = [];
    if (p.coverImage) arr.push(p.coverImage);
    if (p.images?.length) arr.push(...p.images);
    return arr;
  }

  async ngOnInit() {
    this.postId = this.route.snapshot.paramMap.get('id') || '';
    if (!this.postId) return;

    let postData = await this.fs.getPost(this.postId);
    if (!postData && this.postId.startsWith('demo-')) {
      postData = DEMO_POSTS.find(p => p.id === this.postId) ?? null;
    }
    if (postData) {
      this.post.set(postData);
      this.likeCount.set(postData.likeCount || 0);
      this.seo.set({
        title: postData.titleSq,
        description: postData.bodySq.slice(0, 160),
        image: postData.coverImage,
      });
      await this.loadUserState();
    }
    this.loading.set(false);

    // Real-time comments
    this.commentsSub = this.fs.getComments$(this.postId).subscribe(c => this.comments.set(c));
  }

  private async loadUserState() {
    const user = this.auth.currentUser();
    if (!user) return;
    const [liked, bm] = await Promise.all([
      this.fs.hasLiked(this.postId, user.uid),
      this.fs.hasFavorited(this.postId, user.uid),
    ]);
    this.liked.set(liked);
    this.bookmarked.set(bm);
  }

  async toggleLike() {
    const user = this.auth.currentUser();
    if (!user) { this.toast.info('Duhet të hyni.'); return; }
    const nowLiked = await this.fs.toggleLike(this.postId, user.uid);
    this.liked.set(nowLiked);
    this.likeCount.update(c => nowLiked ? c + 1 : Math.max(0, c - 1));
    if (this.post()) this.post.update(p => p ? { ...p, likeCount: this.likeCount() } : p);
  }

  async toggleBookmark() {
    const user = this.auth.currentUser();
    if (!user) { this.toast.info('Duhet të hyni.'); return; }
    const saved = await this.fs.toggleFavorite(this.postId, user.uid);
    this.bookmarked.set(saved);
    this.toast.success(saved ? 'Postimi u ruajt.' : 'Postimi u hoq.');
  }

  async submitComment() {
    const user = this.auth.currentUser();
    if (!user) return;
    const text = this.commentText().trim();
    if (!text) return;
    this.submitting.set(true);
    try {
      await this.fs.addComment(this.postId, {
        authorId: user.uid,
        authorName: this.auth.isAdmin() ? 'Ndreajt e Palçit' : (user.displayName || 'Anëtar'),
        authorPhoto: this.auth.isAdmin() ? '' : (user.photoURL || ''),
        textSq: text,
      });
      this.commentText.set('');
    } catch { this.toast.error('Gabim.'); }
    finally { this.submitting.set(false); }
  }

  async deleteComment(id: string) {
    await this.fs.deleteComment(this.postId, id);
  }

  async share() {
    const url = `${window.location.origin}/post/${this.postId}`;
    if ('share' in navigator) await navigator.share({ title: this.title, url });
    else { await (navigator as any).clipboard.writeText(url); this.toast.success('Linku u kopjua!'); }
  }

  openLightbox(img: string) { this.lightboxImg.set(img); }
  closeLightbox() { this.lightboxImg.set(null); }

  getInitial(name: string) { return (name || 'A')[0].toUpperCase(); }

  trackById(_i: number, c: { id?: string }) { return c.id ?? _i; }
  trackByUrl(_i: number, url: string)        { return url; }

  formatDate(ts: any): string { return fmtDateFull(ts, this.lang); }
  formatCommentTime(ts: any): string { return fmtDateWithTime(ts, this.lang); }

  canDelete(comment: Comment): boolean {
    const u = this.auth.currentUser();
    return !!u && (u.uid === comment.authorId || (this.auth.isAdmin() ?? false));
  }

  ngOnDestroy() { this.commentsSub?.unsubscribe(); }
}
