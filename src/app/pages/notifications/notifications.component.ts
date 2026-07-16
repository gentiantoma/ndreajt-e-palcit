import { Component, OnDestroy, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription, filter, firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';
import { SeoService } from '../../core/services/seo.service';
import { AppNotification, REACTIONS } from '../../core/models';
import { fmtDateWithTime } from '../../core/utils/date.util';

const PAGE_SIZE = 20;

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  templateUrl: './notifications.component.html',
  styleUrls: ['./notifications.component.scss'],
})
export class NotificationsComponent implements OnInit, OnDestroy {
  auth              = inject(AuthService);
  private notifSvc  = inject(NotificationService);
  private router    = inject(Router);
  private translate = inject(TranslateService);
  private seo       = inject(SeoService);

  loading       = signal(true);
  notifications = signal<AppNotification[]>([]);
  visibleCount  = signal(PAGE_SIZE);
  unreadCount   = computed(() => this.notifications().filter(n => !n.read).length);
  visible       = computed(() => this.notifications().slice(0, this.visibleCount()));
  hasMore       = computed(() => this.notifications().length > this.visibleCount());

  private sub?: Subscription;

  async ngOnInit() {
    this.seo.reset();
    const user = await firstValueFrom(this.auth.user$.pipe(filter(u => u !== undefined))) as any;
    if (!user?.uid) { this.loading.set(false); return; }
    this.sub = this.notifSvc.notifications$(user.uid).subscribe(list => {
      this.notifications.set(list);
      this.loading.set(false);
    });
  }

  open(n: AppNotification) {
    if (!n.read && n.id) this.notifSvc.markRead(n.id);
    this.router.navigate(['/post', n.postId]);
  }

  markAllRead() { this.notifSvc.markAllRead(this.notifications()); }

  loadMore() { this.visibleCount.update(c => c + PAGE_SIZE); }

  icon(n: AppNotification): string {
    if (n.type === 'reaction') return REACTIONS.find(r => r.type === n.reaction)?.emoji ?? '🪶';
    return '📜';
  }

  time(n: AppNotification): string {
    return fmtDateWithTime(n.createdAt, this.translate.currentLang || 'sq');
  }

  trackById(_i: number, n: AppNotification) { return n.id ?? _i; }

  ngOnDestroy() { this.sub?.unsubscribe(); }
}
