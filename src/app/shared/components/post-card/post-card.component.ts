import {
  Component, Input, OnDestroy, OnInit, inject, signal, computed, ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription, filter, firstValueFrom } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { Post, Comment, Reply, UserProfile } from '../../../core/models';
import { FirestoreService } from '../../../core/services/firestore.service';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { AudioService } from '../../../core/services/audio.service';
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

  private fs     = inject(FirestoreService);
  private router = inject(Router);
  auth           = inject(AuthService);
  private toast = inject(ToastService);
  private audio = inject(AudioService);
  private translate = inject(TranslateService);

  liked        = signal(false);
  bookmarked   = signal(false);
  likeCount    = signal(0);
  showComments = signal(false);
  comments     = signal<Comment[]>([]);
  commentText  = signal('');
  submitting   = signal(false);
  expanded     = signal(false);
  lightboxImg  = signal<string | null>(null);

  showLikersModal = signal(false);
  likers          = signal<UserProfile[]>([]);
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

  ngOnInit() {
    this.likeCount.set(this.post.likeCount || 0);
    this.loadUserState();
  }

  private async loadUserState() {
    const user = this.auth.currentUser();
    if (!user || !this.post.id) return;
    const [liked, bm] = await Promise.all([
      this.fs.hasLiked(this.post.id, user.uid),
      this.fs.hasFavorited(this.post.id, user.uid),
    ]);
    this.liked.set(liked);
    this.bookmarked.set(bm);
  }

  private async getResolvedUser() {
    let u = this.auth.currentUser();
    if (u === undefined) {
      u = await firstValueFrom(this.auth.user$.pipe(filter(x => x !== undefined))) as any;
    }
    return u;
  }

  async toggleLike() {
    const user = await this.getResolvedUser();
    if (!user) { this.toast.info('Duhet të hyni për të pëlqyer.'); return; }
    if (!this.post.id) return;
    try {
      const nowLiked = await this.fs.toggleLike(this.post.id, user.uid);
      this.liked.set(nowLiked);
      this.likeCount.update(c => nowLiked ? c + 1 : Math.max(0, c - 1));
      if (nowLiked) this.audio.like(); else this.audio.unlike();
    } catch (e: any) {
      this.toast.error('Gabim: ' + (e?.message ?? 'Provo sërish'));
    }
  }

  async toggleBookmark() {
    const user = this.auth.currentUser();
    if (!user) { this.toast.info('Duhet të hyni për të ruajtur.'); return; }
    if (!this.post.id) return;
    const saved = await this.fs.toggleFavorite(this.post.id, user.uid);
    this.bookmarked.set(saved);
    this.audio.bookmark();
    this.toast.success(saved ? 'Postimi u ruajt.' : 'Postimi u hoq nga të ruajturit.');
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
    if (!user) { this.toast.info('Duhet të hyni për të komentuar.'); return; }
    const text = this.commentText().trim();
    if (!text) return;
    this.submitting.set(true);
    try {
      const profilePhoto = this.auth.userProfile()?.photoURL || '';
      const photo = this.auth.isAdmin() ? profilePhoto : (profilePhoto.includes('ibb.co') ? profilePhoto : '');
      await this.fs.addComment(this.post.id!, {
        authorId: user.uid,
        authorName: this.auth.isAdmin() ? 'Ndreajt e Palçit' : (user.displayName || 'Anëtar'),
        authorPhoto: photo,
        textSq: text,
      });
      this.commentText.set('');
      this.audio.commentSend();
    } catch {
      this.toast.error('Ndodhi një gabim.');
    } finally {
      this.submitting.set(false);
    }
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

  openReplyInput(comment: Comment) {
    const s = this.getReplyState(comment.id!);
    s.showReplyInput = !s.showReplyInput;
    s.replyText = '';
    // Also show replies when opening reply input
    if (!s.showReplies) this.toggleReplies(comment);
  }

  async submitReply(comment: Comment) {
    const user = this.auth.currentUser();
    if (!user) { this.toast.info('Duhet të hyni.'); return; }
    const s = this.getReplyState(comment.id!);
    const text = s.replyText.trim();
    if (!text) return;
    s.submittingReply = true;
    try {
      const profilePhoto = this.auth.userProfile()?.photoURL || '';
      const photo = this.auth.isAdmin() ? profilePhoto : (profilePhoto.includes('ibb.co') ? profilePhoto : '');
      await this.fs.addReply(this.post.id!, comment.id!, {
        authorId: user.uid,
        authorName: this.auth.isAdmin() ? 'Ndreajt e Palçit' : (user.displayName || 'Anëtar'),
        authorPhoto: photo,
        textSq: text,
        mentionName: comment.authorName,
      });
      s.replyText = '';
      s.showReplyInput = false;
      this.audio.commentSend();
    } catch {
      this.toast.error('Ndodhi një gabim.');
    } finally {
      s.submittingReply = false;
    }
  }

  async deleteReply(commentId: string, replyId: string) {
    await this.fs.deleteReply(this.post.id!, commentId, replyId);
  }

  canDelete(item: Comment | Reply): boolean {
    const u = this.auth.currentUser();
    return !!u && (u.uid === item.authorId || (this.auth.isAdmin() ?? false));
  }

  // ── Share / Likers ──

  async share() {
    const url = `${window.location.origin}/post/${this.post.id}`;
    if ('share' in navigator) {
      await navigator.share({ title: this.title, url });
    } else {
      await (navigator as any).clipboard.writeText(url);
      this.toast.success('Linku u kopjua!');
    }
  }

  async showLikers() {
    if (this.likeCount() === 0) return;
    this.showLikersModal.set(true);
    if (this.likers().length > 0) return;
    this.loadingLikers.set(true);
    try {
      const likes = await this.fs.getLikesForPost(this.post.id!);
      const userProfiles = await Promise.all(likes.slice(0, 20).map(l => this.fs.getUser(l.userId)));
      this.likers.set(userProfiles.filter((u): u is UserProfile => !!u));
    } finally {
      this.loadingLikers.set(false);
    }
  }

  closeLikersModal() { this.showLikersModal.set(false); }

  openLightbox(img: string) { this.lightboxImg.set(img); }
  closeLightbox()            { this.lightboxImg.set(null); }

  getInitial(name: string) { return (name || 'A')[0].toUpperCase(); }

  trackById(_i: number, item: { id?: string }) { return item.id ?? _i; }
  trackByUrl(_i: number, url: string)           { return url; }

  navigateToPost(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('.expand-btn, .action-btn, .bookmark-btn, .comment-input-row, .comments-section, .stat-item, a'))
      return;
    if (this.post.id) this.router.navigate(['/post', this.post.id]);
  }

  formatDate(ts: any): string { return fmtDateShort(ts, this.lang); }
  formatTime(ts: any): string { return fmtDateDay(ts, this.lang); }

  toggleExpanded() { this.expanded.update(v => !v); }

  get bodyTooLong()    { return this.body.length > 280; }
  get hasImages()      { return this.allImages.length > 0; }
  get extraImageCount(){ return Math.max(0, this.allImages.length - 4); }
  get hasMoreImages()  { return this.allImages.length > 4; }
  get hasLikes()       { return this.likeCount() > 0; }
  get hasComments()    { return this.post.commentCount > 0; }
  isLastVisible(i: number) { return i === 3 && this.allImages.length > 4; }

  bodyPreview = computed(() => {
    const b = this.body;
    return b.length > 280 ? b.slice(0, 280) : b;
  });

  ngOnDestroy() {
    this.commentsSub?.unsubscribe();
    Object.values(this.replyStates).forEach(s => s.replySub?.unsubscribe());
  }
}
