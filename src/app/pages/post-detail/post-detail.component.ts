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
import { Post, Comment, ReactionType, REACTIONS } from '../../core/models';
import { ReactionPickerService } from '../../core/services/reaction-picker.service';
import { DEMO_POSTS } from '../../data/demo-posts';

@Component({
  selector: 'app-post-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule, FormsModule, LazyImgDirective],
  templateUrl: './post-detail.component.html',
  styleUrls: ['./post-detail.component.scss'],
})
export class PostDetailComponent implements OnInit, OnDestroy {
  private route      = inject(ActivatedRoute);
  private fs         = inject(FirestoreService);
  auth               = inject(AuthService);
  private toast      = inject(ToastService);
  private seo        = inject(SeoService);
  private translate  = inject(TranslateService);
  private pickerSvc  = inject(ReactionPickerService);

  post        = signal<Post | null>(null);
  authorAvatarError = signal(false);
  myAvatarError     = signal(false);
  loading     = signal(true);
  comments    = signal<Comment[]>([]);
  commentText = signal('');
  submitting  = signal(false);
  myReaction  = signal<ReactionType | null>(null);
  likeCount   = signal(0);
  bookmarked  = signal(false);
  lightboxImg = signal<string | null>(null);
  carouselIndex = signal(0);

  readonly reactions = REACTIONS;
  get liked() { return this.myReaction() !== null; }
  reactionEmoji(r: ReactionType | null) { return REACTIONS.find(x => x.type === r)?.emoji ?? '❤️'; }
  reactionLabel(r: ReactionType | null) { return REACTIONS.find(x => x.type === r)?.label ?? 'Pëlqej'; }
  getReactionColor(r: ReactionType | null): string {
    const c: Record<ReactionType, string> = { like: '#e0245e', haha: '#f7c948', wow: '#f7c948', sad: '#4fa3e0', angry: '#e05e30', celebrate: '#9b59b6' };
    return r ? c[r] : '';
  }

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
      this.carouselIndex.set(0);
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
    const [reaction, bm] = await Promise.all([
      this.fs.getUserReaction(this.postId, user.uid),
      this.fs.hasFavorited(this.postId, user.uid),
    ]);
    this.myReaction.set(reaction);
    this.bookmarked.set(bm);
  }

  openPicker(event: MouseEvent) {
    event.stopPropagation();
    const btn  = event.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    const pickerWidth  = window.innerWidth <= 600 ? 268 : 380;
    const pickerHeight = window.innerWidth <= 600 ? 50  : 62;
    const top  = rect.top - pickerHeight - 15;
    const article     = btn.closest('article') as HTMLElement;
    const articleRect = article ? article.getBoundingClientRect() : rect;
    const left = Math.max(8, Math.min(
      window.innerWidth - pickerWidth - 8,
      articleRect.left + articleRect.width / 2 - pickerWidth / 2
    ));
    this.pickerSvc.toggle({ top, left }, this.myReaction(), r => this.setReaction(r));
  }

  async setReaction(reaction: ReactionType) {
    const user = this.auth.currentUser();
    if (!user) { this.toast.info('Duhet të hyni.'); return; }
    this.pickerSvc.dismiss();
    const prev = this.myReaction();
    const result = await this.fs.setReaction(this.postId, user.uid, reaction);
    this.myReaction.set(result);
    if (result === null) this.likeCount.update(c => Math.max(0, c - 1));
    else if (prev === null) this.likeCount.update(c => c + 1);
    this.post.update(p => p ? { ...p, likeCount: this.likeCount() } : p);
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
        authorPhoto: (() => { const p = this.auth.userProfile()?.photoURL || ''; return this.auth.isAdmin() ? p : (p.includes('ibb.co') ? p : ''); })(),
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

  prevImage() {
    const len = this.allImages.length;
    this.carouselIndex.update(i => (i - 1 + len) % len);
  }

  nextImage() {
    const len = this.allImages.length;
    this.carouselIndex.update(i => (i + 1) % len);
  }

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
