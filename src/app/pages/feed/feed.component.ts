import { Component, OnInit, AfterViewInit, inject, signal, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { where, orderBy, limit } from '@angular/fire/firestore';
import { fmtDateFull } from '../../core/utils/date.util';
import { FirestoreService } from '../../core/services/firestore.service';
import { AuthService } from '../../core/services/auth.service';
import { SeoService } from '../../core/services/seo.service';
import { PostCardComponent } from '../../shared/components/post-card/post-card.component';
import { Post, ReactionType } from '../../core/models';
import { DEMO_POSTS } from '../../data/demo-posts';

interface CategoryFilter { key: string; label: string; }

@Component({
  selector: 'app-feed',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule, PostCardComponent],
  templateUrl: './feed.component.html',
  styleUrls: ['./feed.component.scss'],
})
export class FeedComponent implements OnInit, AfterViewInit {
  private fs    = inject(FirestoreService);
  auth          = inject(AuthService);
  private seo   = inject(SeoService);
  private translate = inject(TranslateService);

  /** Newspaper-style dateline shown under the masthead, in the active language */
  get todayLine(): string {
    return fmtDateFull(new Date(), this.translate.currentLang || 'sq');
  }


  posts          = signal<Post[]>([]);
  loading        = signal(true);
  activeCategory = signal<string>('all');
  loadingMore    = signal(false);
  hasMore        = signal(false);
  userFeedState  = signal(new Map<string, { reaction: ReactionType | null; bookmarked: boolean }>());

  readonly categories: CategoryFilter[] = [
    { key: 'all',      label: 'feed.all' },
    { key: 'lajme',    label: 'categories.lajme' },
    { key: 'histori',  label: 'categories.histori' },
    { key: 'njoftim',  label: 'categories.njoftim' },
    { key: 'events',   label: 'categories.events' },
    { key: 'pajtimet', label: 'categories.pajtimet' },
    { key: 'takimet',  label: 'categories.takimet' },
    { key: 'other',    label: 'categories.other' },
  ];

  trackById(_i: number, p: Post) { return p.id ?? _i; }
  trackByCatKey(_i: number, c: CategoryFilter) { return c.key; }

  readonly villageStats = signal({ posts: 0, members: 0 });

  async ngOnInit() {
    this.seo.reset();
    await this.loadPosts();
  }

  private async loadPosts() {
    this.loading.set(true);
    try {
      const cat = this.activeCategory();
      let data: Post[] = [];
      try {
        // Simple query without compound index requirement
        const filters = cat === 'all'
          ? [where('published', '==', true), orderBy('createdAt', 'desc'), limit(30)]
          : [where('published', '==', true), where('category', '==', cat), limit(30)];
        data = await this.fs.getPosts(filters);
        // Client-side sort only needed for category queries (no composite index yet)
        if (cat !== 'all') {
          data.sort((a: any, b: any) => {
            const ta = a.createdAt?.toDate?.() ?? new Date(a.createdAt ?? 0);
            const tb = b.createdAt?.toDate?.() ?? new Date(b.createdAt ?? 0);
            return tb.getTime() - ta.getTime();
          });
        }
      } catch (e) {
        console.warn('Firestore query failed, using demo posts', e);
      }

      if (data.length === 0) {
        const filtered = cat === 'all' ? DEMO_POSTS : DEMO_POSTS.filter(p => p.category === cat);
        this.posts.set(filtered);
        this.villageStats.set({ posts: DEMO_POSTS.length, members: 12 });
      } else {
        this.posts.set(data);
        this.villageStats.set({ posts: data.length, members: 0 });
        // Batch-load user state: 2 queries instead of N*2
        const user = this.auth.currentUser();
        if (user) {
          this.fs.getUserFeedState(data.map(p => p.id!), user.uid)
            .then(state => this.userFeedState.set(state));
        }
      }
      this.hasMore.set(data.length === 30);
    } finally {
      this.loading.set(false);
    }
  }

  async filterBy(cat: string) {
    this.activeCategory.set(cat);
    await this.loadPosts();
  }

  async loadMore() {
    if (this.loadingMore() || !this.hasMore()) return;
    this.loadingMore.set(true);
    try {
      const cat = this.activeCategory();
      const current = this.posts();
      const last = current[current.length - 1];
      if (!last?.createdAt) return;
      const { startAfter } = await import('@angular/fire/firestore');
      const filters = cat === 'all'
        ? [where('published', '==', true), orderBy('createdAt', 'desc'), startAfter(last.createdAt), limit(15)]
        : [where('published', '==', true), where('category', '==', cat), orderBy('createdAt', 'desc'), startAfter(last.createdAt), limit(15)];
      const more = await this.fs.getPosts(filters);
      this.posts.update(p => [...p, ...more]);
      this.hasMore.set(more.length === 15);
      const user = this.auth.currentUser();
      if (user && more.length) {
        this.fs.getUserFeedState(more.map(p => p.id!), user.uid).then(extra => {
          this.userFeedState.update(m => { extra.forEach((v, k) => m.set(k, v)); return new Map(m); });
        });
      }
    } finally {
      this.loadingMore.set(false);
    }
  }

  @ViewChild('chipScroll')        chipScroll!: ElementRef<HTMLDivElement>;
  @ViewChild('chipScrollDesktop') chipScrollDesktop!: ElementRef<HTMLDivElement>;

  canScrollLeftMobile   = signal(false);
  canScrollRightMobile  = signal(false);
  canScrollLeftDesktop  = signal(false);
  canScrollRightDesktop = signal(false);

  ngAfterViewInit() {
    this.attachScrollWatcher(this.chipScroll?.nativeElement, 'mobile');
    this.attachScrollWatcher(this.chipScrollDesktop?.nativeElement, 'desktop');
  }

  private attachScrollWatcher(el: HTMLElement | undefined, side: 'mobile' | 'desktop') {
    if (!el) return;
    const update = () => this.updateScrollBounds(el, side);
    el.addEventListener('scroll', update, { passive: true });
    setTimeout(update, 60);
  }

  private updateScrollBounds(el: HTMLElement, side: 'mobile' | 'desktop') {
    const atStart = el.scrollLeft <= 2;
    const atEnd   = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
    if (side === 'mobile') {
      this.canScrollLeftMobile.set(!atStart);
      this.canScrollRightMobile.set(!atEnd);
    } else {
      this.canScrollLeftDesktop.set(!atStart);
      this.canScrollRightDesktop.set(!atEnd);
    }
  }

  scrollChips(dir: 'left' | 'right') {
    const el = this.chipScroll?.nativeElement;
    if (el) el.scrollBy({ left: dir === 'right' ? 140 : -140, behavior: 'smooth' });
  }

  scrollChipsDesktop(dir: 'left' | 'right') {
    const el = this.chipScrollDesktop?.nativeElement;
    if (el) el.scrollBy({ left: dir === 'right' ? 140 : -140, behavior: 'smooth' });
  }

  get skeletonItems()  { return new Array(4); }
  get hasPosts()       { return this.posts().length > 0; }
  get trendingPosts()  { return this.posts().slice(0, 3); }
}
