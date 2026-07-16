import {
  Component, Input, OnDestroy, OnInit, inject, signal, computed, ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription, filter, firstValueFrom } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { Post, Comment, Reply, ReactionType, REACTIONS } from '../../../core/models';
import { FirestoreService } from '../../../core/services/firestore.service';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { AudioService } from '../../../core/services/audio.service';
import { ReactionPickerService } from '../../../core/services/reaction-picker.service';
import { NotificationService } from '../../../core/services/notification.service';
import { LazyImgDirective } from '../../directives/lazy-img.directive';
import { fmtDateShort, fmtDateDay } from '../../../core/utils/date.util';

interface CommentState {
  replies: Reply[];
  showReplies: boolean;
  loadingReplies: boolean;
  replySub?: Subscription;
  replyText: string;
  showReplyInput: boolean;
  submittingReply: boolean;
}

@Component({
  selector: 'app-post-card',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule, FormsModule, LazyImgDirective],
  templateUrl: './post-card.component.html',
  styleUrls: ['./post-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.Default,
})
export class PostCardComponent implements OnInit, OnDestroy {
  @Input({ required: true }) post!: Post;
  @Input() userState?: { reaction: ReactionType | null; bookmarked: boolean };

  private fs      = inject(FirestoreService);
  private router  = inject(Router);
  auth            = inject(AuthService);
  private toast   = inject(ToastService);
  private audio   = inject(AudioService);
  private translate = inject(TranslateService);
  private pickerSvc = inject(ReactionPickerService);
  private notifSvc  = inject(NotificationService);

  /** Public-facing name/photo of the acting user (admin acts as the brand) */
  private get actorName(): string {
    return this.auth.publicDisplayName;
  }
  private get actorPhoto(): string {
    const p = this.auth.userProfile()?.photoURL || '';
    return this.auth.isAdmin() ? p : (p.includes('ibb.co') ? p : '');
  }

  myReaction   = signal<ReactionType | null>(null);
  bookmarked   = signal(false);
  likeCount    = signal(0);
  reactionCounts = signal<Partial<Record<ReactionType, number>>>({});
  showComments = signal(false);
  comments     = signal<Comment[]>([]);
  commentText  = signal('');
  submitting   = signal(false);
  lightboxImg  = signal<string | null>(null);

  showLikersModal = signal(false);
  likers          = signal<{ uid: string; displayName: string; photoURL?: string; reaction: ReactionType }[]>([]);
  reactionFilter  = signal<ReactionType | null>(null);

  readonly reactions = REACTIONS;

  get liked() { return this.myReaction() !== null; }

  reactionEmoji(r: ReactionType | null) {
    return REACTIONS.find(x => x.type === r)?.emoji ?? '🪶';
  }
  reactionLabel(r: ReactionType | null) {
    const key = REACTIONS.find(x => x.type === r)?.label ?? 'reactions.respect';
    return this.translate.instant(key);
  }
  getReactionColor(r: ReactionType | null): string {
    const colors: Record<ReactionType, string> = {
      like:    '#e0245e',
      respect: '#2563eb',
      strong:  '#dc2626',
      bravo:   '#16a34a',
      honor:   '#7c3aed',
      fire:    '#ea580c',
      sad:     '#4a90d9',
    };
    return r ? (colors[r] ?? '') : '';
  }

  /* Top reaction emojis for the stats row: 1 type → 1 emoji, 2 → 2, 3+ → 3 (most frequent first).
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

  reactionTabs = computed(() => {
    const counts = new Map<ReactionType, number>();
    this.likers().forEach(l => counts.set(l.reaction, (counts.get(l.reaction) ?? 0) + 1));
    return REACTIONS
      .filter(r => counts.has(r.type))
      .map(r => ({ type: r.type, emoji: r.emoji, count: counts.get(r.type)! }));
  });

  filteredLikers = computed(() => {
    const filter = this.reactionFilter();
    return filter ? this.likers().filter(l => l.reaction === filter) : this.likers();
  });
  loadingLikers   = signal(false);

  // Per-comment reply state keyed by comment.id
  replyStates: Record<string, CommentState> = {};

  private commentsSub?: Subscription;

  get lang()  { return this.translate.currentLang || 'sq'; }
  get title() { return this.lang === 'en' && this.post.titleEn ? this.post.titleEn : this.post.titleSq; }
  get body()  { return this.lang === 'en' && this.post.bodyEn  ? this.post.bodyEn  : this.post.bodySq; }

  get allImages(): string[] {
    const arr: string[] = [];
    if (this.post.coverImage) arr.push(this.post.coverImage);
    if (this.post.images?.length) arr.push(...this.post.images);
    return arr;
  }

  get galleryClass(): string {
    const n = this.allImages.length;
    if (n === 1) return 'g1';
    if (n === 2) return 'g2';
    if (n === 3) return 'g3';
    return 'g4';
  }

  private postSub?: Subscription;

  ngOnInit() {
    this.likeCount.set(this.post.likeCount || 0);
    this.reactionCounts.set({ ...(this.post.reactionCounts ?? {}) });
    // Live counters: reactions/comments update instantly (own taps via latency
    // compensation, other people's activity in real time — no refresh needed)
    if (this.post.id) {
      this.postSub = this.fs.getPost$(this.post.id).subscribe(p => {
        if (!p) return;
        this.likeCount.set(p.likeCount || 0);
        this.reactionCounts.set({ ...(p.reactionCounts ?? {}) });
        this.post = { ...this.post, likeCount: p.likeCount, commentCount: p.commentCount, reactionCounts: p.reactionCounts };
        this.backfillReactionCounts(p);
      });
    }
    if (this.userState) {
      // Pre-loaded by feed — zero extra Firestore calls
      this.myReaction.set(this.userState.reaction);
      this.bookmarked.set(this.userState.bookmarked);
    } else {
      this.loadUserState();
    }
  }

  private async loadUserState() {
    const user = this.auth.currentUser();
    if (!user || !this.post.id) return;
    const [reaction, bm] = await Promise.all([
      this.fs.getUserReaction(this.post.id, user.uid),
      this.fs.hasFavorited(this.post.id, user.uid),
    ]);
    this.myReaction.set(reaction);
    this.bookmarked.set(bm);
  }

  private async getResolvedUser() {
    let u = this.auth.currentUser();
    if (u === undefined) {
      u = await firstValueFrom(this.auth.user$.pipe(filter(x => x !== undefined))) as any;
    }
    return u;
  }

  openPicker(event: MouseEvent) {
    event.stopPropagation();
    const btn  = event.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    const pickerWidth  = window.innerWidth <= 600 ? 300 : 420;
    const pickerHeight = window.innerWidth <= 600 ? 50  : 62;
    const top  = rect.top - pickerHeight - 15;
    // Center on the card; card is the closest <article> ancestor
    const card     = btn.closest('article') as HTMLElement;
    const cardRect = card ? card.getBoundingClientRect() : rect;
    const left = Math.max(8, Math.min(
      window.innerWidth - pickerWidth - 8,
      cardRect.left + cardRect.width / 2 - pickerWidth / 2
    ));
    this.pickerSvc.toggle({ top, left }, this.myReaction(), r => this.setReaction(r));
  }

  async setReaction(reaction: ReactionType) {
    const user = await this.getResolvedUser();
    if (!user) { this.toast.info(this.translate.instant('toast.login_to_react')); return; }
    if (!this.post.id) return;
    this.pickerSvc.dismiss();
    try {
      const prev = this.myReaction();
      const result = await this.fs.setReaction(this.post.id, user.uid, reaction);
      this.myReaction.set(result);
      this.applyReactionDelta(prev, result);
      if (result === null) {
        this.likeCount.update(c => Math.max(0, c - 1));
        this.audio.unlike();
      } else if (prev === null) {
        this.likeCount.update(c => c + 1);
        this.audio.like();
        this.notifSvc.notifyReaction(this.post, user.uid, this.actorName, this.actorPhoto, result);
      }
    } catch (e: any) {
      this.toast.error(this.translate.instant('toast.error_generic'));
    }
  }

  /* Posts reacted on before per-type counters existed have likes but no breakdown —
     rebuild it from the actual likes so the top-3 emoji stack is always complete,
     and persist it (signed-in users only) so it's a one-time cost per post. */
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

  /** Mirror the Firestore reaction-counter change locally so the emoji stack updates instantly */
  private applyReactionDelta(prev: ReactionType | null, next: ReactionType | null) {
    this.reactionCounts.update(c => {
      const n = { ...c };
      if (prev && prev !== next) n[prev] = Math.max(0, (n[prev] ?? 0) - 1);
      if (next && prev !== next) n[next] = (n[next] ?? 0) + 1;
      return n;
    });
  }

  async toggleBookmark() {
    const user = this.auth.currentUser();
    if (!user) { this.toast.info(this.translate.instant('toast.login_to_save')); return; }
    if (!this.post.id) return;
    const saved = await this.fs.toggleFavorite(this.post.id, user.uid);
    this.bookmarked.set(saved);
    this.audio.bookmark();
    this.toast.success(this.translate.instant(saved ? 'toast.post_saved' : 'toast.post_unsaved'));
  }

  toggleComments() {
    const open = !this.showComments();
    this.showComments.set(open);
    if (open && !this.commentsSub) {
      this.commentsSub = this.fs.getComments$(this.post.id!).subscribe(c => this.comments.set(c));
    }
  }

  async submitComment() {
    const user = this.auth.currentUser();
    if (!user) { this.toast.info(this.translate.instant('toast.login_to_comment')); return; }
    const text = this.commentText().trim();
    if (!text) return;
    this.submitting.set(true);
    try {
      const profilePhoto = this.auth.userProfile()?.photoURL || '';
      const photo = this.auth.isAdmin() ? profilePhoto : (profilePhoto.includes('ibb.co') ? profilePhoto : '');
      await this.fs.addComment(this.post.id!, {
        authorId: user.uid,
        authorName: this.actorName,
        authorPhoto: photo,
        textSq: text,
      });
      this.commentText.set('');
      this.audio.commentSend();
      this.notifSvc.notifyComment(this.post, user.uid, this.actorName, this.actorPhoto, text);
    } catch {
      this.toast.error(this.translate.instant('toast.error_generic'));
    } finally {
      this.submitting.set(false);
    }
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

  async deleteComment(commentId: string) {
    await this.fs.deleteComment(this.post.id!, commentId);
    // clean up reply state
    if (this.replyStates[commentId]?.replySub) {
      this.replyStates[commentId].replySub!.unsubscribe();
    }
    delete this.replyStates[commentId];
  }

  // ── Reply methods ──

  getReplyState(commentId: string): CommentState {
    if (!this.replyStates[commentId]) {
      this.replyStates[commentId] = {
        replies: [], showReplies: false, loadingReplies: false,
        replyText: '', showReplyInput: false, submittingReply: false,
      };
    }
    return this.replyStates[commentId];
  }

  toggleReplies(comment: Comment) {
    const s = this.getReplyState(comment.id!);
    s.showReplies = !s.showReplies;
    if (s.showReplies && !s.replySub) {
      s.replySub = this.fs.getReplies$(this.post.id!, comment.id!).subscribe(r => {
        s.replies = r;
      });
    }
  }

  /** Replying is a details-page interaction — the feed card only previews the thread */
  openReplyInput(_comment: Comment) {
    if (this.post.id) this.router.navigate(['/post', this.post.id]);
  }

  async deleteReply(commentId: string, replyId: string) {
    await this.fs.deleteReply(this.post.id!, commentId, replyId);
  }

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

  // ── Share / Likers ──

  async share() {
    const url = `${window.location.origin}/post/${this.post.id}`;
    if ('share' in navigator) {
      await navigator.share({ title: this.title, url });
    } else {
      await (navigator as any).clipboard.writeText(url);
      this.toast.success(this.translate.instant('toast.link_copied'));
    }
  }

  async showLikers() {
    if (this.likeCount() === 0) return;
    this.showLikersModal.set(true);
    this.likers.set([]);
    this.loadingLikers.set(true);
    try {
      const likes = await this.fs.getLikesForPost(this.post.id!);
      const withProfiles = await Promise.all(
        likes.map(async l => {
          const p = await this.fs.getUser(l.userId);
          return p ? { uid: p.uid, displayName: p.displayName, photoURL: p.photoURL, reaction: l.reaction } : null;
        })
      );
      this.likers.set(withProfiles.filter((u): u is NonNullable<typeof u> => !!u));
    } finally {
      this.loadingLikers.set(false);
    }
  }

  closeLikersModal() { this.showLikersModal.set(false); this.reactionFilter.set(null); }


  openLightbox(img: string) { this.lightboxImg.set(img); }
  closeLightbox()            { this.lightboxImg.set(null); }

  getInitial(name: string) { return (name || 'A')[0].toUpperCase(); }

  trackById(_i: number, item: { id?: string })                        { return item.id ?? _i; }
  trackByUrl(_i: number, url: string)                                  { return url; }
  trackByType(_i: number, item: { type: string })                      { return item.type; }
  trackByUid(_i: number, item: { uid: string })                        { return item.uid; }

  navigateToPost(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('.action-btn, .bookmark-btn, .comment-input-row, .comments-section, .stat-item, a'))
      return;
    if (this.post.id) this.router.navigate(['/post', this.post.id]);
  }

  formatDate(ts: any): string { return fmtDateShort(ts, this.lang); }
  formatTime(ts: any): string { return fmtDateDay(ts, this.lang); }

  get hasImages()      { return this.allImages.length > 0; }
  get extraImageCount(){ return Math.max(0, this.allImages.length - 4); }
  get hasMoreImages()  { return this.allImages.length > 4; }
  get hasLikes()       { return this.likeCount() > 0; }
  get hasComments()    { return this.post.commentCount > 0; }
  isLastVisible(i: number) { return i === 3 && this.allImages.length > 4; }


  ngOnDestroy() {
    this.postSub?.unsubscribe();
    this.commentsSub?.unsubscribe();
    Object.values(this.replyStates).forEach(s => s.replySub?.unsubscribe());
  }
}
