import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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
import { Post, Comment, Reply, ReactionType, REACTIONS } from '../../core/models';
import { ReactionPickerService } from '../../core/services/reaction-picker.service';
import { NotificationService } from '../../core/services/notification.service';

interface CommentState {
  replies: Reply[];
  showReplies: boolean;
  replySub?: Subscription;
  replyText: string;
  showReplyInput: boolean;
  submittingReply: boolean;
}

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
  private notifSvc   = inject(NotificationService);
  private router     = inject(Router);

  /** Public-facing name/photo of the acting user (admin acts as the brand) */
  private get actorName(): string {
    return this.auth.publicDisplayName;
  }
  private get actorPhoto(): string {
    const p = this.auth.userProfile()?.photoURL || '';
    return this.auth.isAdmin() ? p : (p.includes('ibb.co') ? p : '');
  }

  /** The signed-in user's own avatar for the compose box — profile photo first, Google photo fallback */
  get myPhoto(): string {
    return this.auth.userProfile()?.photoURL || this.auth.currentUser()?.photoURL || '';
  }

  post        = signal<Post | null>(null);
  authorAvatarError = signal(false);
  myAvatarError     = signal(false);
  loading     = signal(true);
  comments       = signal<Comment[]>([]);
  commentsLimit  = signal(10);
  visibleComments = computed(() => this.comments().slice(0, this.commentsLimit()));
  get hasMoreComments() { return this.comments().length > this.commentsLimit(); }
  get nextBatchCount()  { return Math.min(10, this.comments().length - this.commentsLimit()); }
  loadMoreComments()    { this.commentsLimit.update(n => n + 10); }
  commentText = signal('');
  submitting  = signal(false);
  myReaction  = signal<ReactionType | null>(null);
  likeCount   = signal(0);
  reactionCounts = signal<Partial<Record<ReactionType, number>>>({});

  /* Top reaction emojis: 1 type → 1 emoji, 2 → 2, 3+ → 3 (most frequent first).
     Older posts have no per-type counters — fall back to a single emoji. */
  topReactions = computed(() => {
    const entries = (Object.entries(this.reactionCounts()) as [ReactionType, number][])
      .filter(([, n]) => (n ?? 0) > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    if (entries.length === 0) {
      return this.likeCount() > 0 ? [this.reactionEmoji(this.myReaction() ?? 'like')] : [];
    }
    return entries.map(([type]) => this.reactionEmoji(type));
  });
  bookmarked  = signal(false);
  lightboxImg = signal<string | null>(null);
  carouselIndex = signal(0);

  readonly reactions = REACTIONS;
  get liked() { return this.myReaction() !== null; }
  reactionEmoji(r: ReactionType | null) { return REACTIONS.find(x => x.type === r)?.emoji ?? '🪶'; }
  reactionLabel(r: ReactionType | null) {
    const key = REACTIONS.find(x => x.type === r)?.label ?? 'reactions.respect';
    return this.translate.instant(key);
  }
  getReactionColor(r: ReactionType | null): string {
    const c: Record<ReactionType, string> = {
      like: '#e0245e', respect: '#2563eb', strong: '#dc2626',
      bravo: '#16a34a', honor: '#7c3aed', fire: '#ea580c', sad: '#4a90d9',
    };
    return r ? (c[r] ?? '') : '';
  }

  private commentsSub?: Subscription;
  private postDocSub?: Subscription;
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

    const postData = await this.fs.getPost(this.postId);
    if (postData) {
      this.post.set(postData);
      this.carouselIndex.set(0);
      this.likeCount.set(postData.likeCount || 0);
      this.reactionCounts.set({ ...(postData.reactionCounts ?? {}) });
      this.seo.set({
        title: postData.titleSq,
        description: postData.bodySq.slice(0, 160),
        image: postData.coverImage,
      });
      // Show content immediately — load user state + comments in background
      this.loading.set(false);
      this.loadUserState();
      this.commentsSub = this.fs.getComments$(this.postId).subscribe(c => this.comments.set(c));
      // Live counters — reactions update in real time, no refresh needed
      this.postDocSub = this.fs.getPost$(this.postId).subscribe(p => {
        if (!p) return;
        this.likeCount.set(p.likeCount || 0);
        this.reactionCounts.set({ ...(p.reactionCounts ?? {}) });
        this.post.update(cur => cur ? { ...cur, likeCount: p.likeCount, commentCount: p.commentCount, reactionCounts: p.reactionCounts } : cur);
        this.backfillReactionCounts(p);
      });
    } else {
      this.loading.set(false);
    }
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

  /* Rebuild missing per-type counters from the actual likes (pre-counter posts) */
  private backfillDone = false;
  private async backfillReactionCounts(p: Post) {
    if (this.backfillDone || !p.id) return;
    const total = Object.values(p.reactionCounts ?? {}).reduce((s, n) => s + Math.max(0, n ?? 0), 0);
    if ((p.likeCount || 0) === 0 || total > 0) return;
    this.backfillDone = true;
    try {
      const likes = await this.fs.getLikesForPost(p.id);
      if (!likes.length) return;
      const built: Partial<Record<ReactionType, number>> = {};
      likes.forEach(l => built[l.reaction] = (built[l.reaction] ?? 0) + 1);
      this.reactionCounts.set(built);
      if (this.auth.currentUser()) {
        this.fs.setReactionCounts(p.id, built).catch(() => {});
      }
    } catch { /* display keeps the fallback */ }
  }

  openPicker(event: MouseEvent) {
    event.stopPropagation();
    const btn  = event.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    const pickerWidth  = window.innerWidth <= 600 ? 300 : 420;
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
    if (!user) { this.toast.info(this.translate.instant('toast.login_to_react')); return; }
    this.pickerSvc.dismiss();
    const prev = this.myReaction();
    const result = await this.fs.setReaction(this.postId, user.uid, reaction);
    this.myReaction.set(result);
    this.reactionCounts.update(c => {
      const n = { ...c };
      if (prev && prev !== result) n[prev] = Math.max(0, (n[prev] ?? 0) - 1);
      if (result && prev !== result) n[result] = (n[result] ?? 0) + 1;
      return n;
    });
    if (result === null) this.likeCount.update(c => Math.max(0, c - 1));
    else if (prev === null) {
      this.likeCount.update(c => c + 1);
      const p = this.post();
      if (p) this.notifSvc.notifyReaction(p, user.uid, this.actorName, this.actorPhoto, result);
    }
    this.post.update(p => p ? { ...p, likeCount: this.likeCount() } : p);
  }

  async toggleBookmark() {
    const user = this.auth.currentUser();
    if (!user) { this.toast.info(this.translate.instant('toast.login_to_save')); return; }
    const saved = await this.fs.toggleFavorite(this.postId, user.uid);
    this.bookmarked.set(saved);
    this.toast.success(this.translate.instant(saved ? 'toast.post_saved' : 'toast.post_unsaved'));
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
        authorName: this.actorName,
        authorPhoto: this.actorPhoto,
        textSq: text,
      });
      this.commentText.set('');
      const p = this.post();
      if (p) this.notifSvc.notifyComment(p, user.uid, this.actorName, this.actorPhoto, text);
    } catch { this.toast.error(this.translate.instant('toast.error_generic')); }
    finally { this.submitting.set(false); }
  }

  // Confirmed comment/reply deletion
  pendingDelete = signal<{ commentId: string; replyId?: string } | null>(null);
  askDeleteComment(commentId: string) { this.pendingDelete.set({ commentId }); }
  askDeleteReply(commentId: string, replyId: string) { this.pendingDelete.set({ commentId, replyId }); }
  async confirmDelete() {
    const t = this.pendingDelete();
    if (!t) return;
    this.pendingDelete.set(null);
    if (t.replyId) await this.deleteReply(t.commentId, t.replyId);
    else await this.deleteComment(t.commentId);
  }

  async deleteComment(id: string) {
    await this.fs.deleteComment(this.postId, id);
    this.replyStates[id]?.replySub?.unsubscribe();
    delete this.replyStates[id];
  }

  /* ── Replies (same behaviour as the feed cards) ── */

  replyStates: Record<string, CommentState> = {};

  getReplyState(commentId: string): CommentState {
    if (!this.replyStates[commentId]) {
      this.replyStates[commentId] = {
        replies: [], showReplies: false,
        replyText: '', showReplyInput: false, submittingReply: false,
      };
    }
    return this.replyStates[commentId];
  }

  toggleReplies(comment: Comment) {
    const s = this.getReplyState(comment.id!);
    s.showReplies = !s.showReplies;
    if (s.showReplies && !s.replySub) {
      s.replySub = this.fs.getReplies$(this.postId, comment.id!).subscribe(r => { s.replies = r; });
    }
  }

  openReplyInput(comment: Comment) {
    const s = this.getReplyState(comment.id!);
    s.showReplyInput = !s.showReplyInput;
    s.replyText = '';
    if (!s.showReplies) this.toggleReplies(comment);
  }

  async submitReply(comment: Comment) {
    const user = this.auth.currentUser();
    if (!user) { this.toast.info(this.translate.instant('toast.login_to_comment')); return; }
    const s = this.getReplyState(comment.id!);
    const text = s.replyText.trim();
    if (!text) return;
    s.submittingReply = true;
    try {
      const profilePhoto = this.auth.userProfile()?.photoURL || '';
      const photo = this.auth.isAdmin() ? profilePhoto : (profilePhoto.includes('ibb.co') ? profilePhoto : '');
      await this.fs.addReply(this.postId, comment.id!, {
        authorId: user.uid,
        authorName: this.actorName,
        authorPhoto: photo,
        textSq: text,
        mentionName: comment.authorName,
      });
      s.replyText = '';
      s.showReplyInput = false;
      const p = this.post();
      if (p) this.notifSvc.notifyReply(p, comment, user.uid, this.actorName, this.actorPhoto, text);
    } catch {
      this.toast.error(this.translate.instant('toast.error_generic'));
    } finally {
      s.submittingReply = false;
    }
  }

  async deleteReply(commentId: string, replyId: string) {
    await this.fs.deleteReply(this.postId, commentId, replyId);
  }

  async share() {
    const url = `${window.location.origin}/post/${this.postId}`;
    if ('share' in navigator) await navigator.share({ title: this.title, url });
    else { await (navigator as any).clipboard.writeText(url); this.toast.success(this.translate.instant('toast.link_copied')); }
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

  canDelete(item: Comment | Reply): boolean {
    const u = this.auth.currentUser();
    return !!u && (u.uid === item.authorId || this.auth.isAdminUser());
  }

  /** Brand (admin) comments have no personal profile to visit */
  canVisit(item: Comment | Reply): boolean {
    return item.authorName !== 'Ndreajt e Palçit' && !!item.authorId;
  }

  goToProfile(item: Comment | Reply) {
    if (this.canVisit(item)) this.router.navigate(['/profile', item.authorId]);
  }

  ngOnDestroy() {
    this.commentsSub?.unsubscribe();
    this.postDocSub?.unsubscribe();
    Object.values(this.replyStates).forEach(s => s.replySub?.unsubscribe());
  }
}
