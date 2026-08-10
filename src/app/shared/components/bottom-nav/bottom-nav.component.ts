import { Component, inject, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth.service';

interface NavItem {
  labelKey: string;
  icon: 'feed' | 'map' | 'weather' | 'profile';
  route: any[] | string;
  exact: boolean;
}

/**
 * Phone-only bottom navigation — Feed · Map · Weather · Profile.
 * Modeled on the lis-doctor bottom-nav: fixed sheet, rounded top, equal
 * columns, active marker + label, safe-area inset, and a solid "slab" shadow
 * so iOS never shows the page background through it during toolbar transitions.
 * Hidden from 992px up, where the header nav takes over.
 */
@Component({
  selector: 'app-bottom-nav',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, TranslateModule],
  templateUrl: './bottom-nav.component.html',
  styleUrls: ['./bottom-nav.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BottomNavComponent {
  private auth = inject(AuthService);

  /** Profile anchors the last slot; it routes to the user's page or to login. */
  readonly items = computed<NavItem[]>(() => {
    const uid = this.auth.currentUser()?.uid;
    return [
      { labelKey: 'nav.feed',      icon: 'feed',    route: '/',        exact: true  },
      { labelKey: 'map.tab',       icon: 'map',     route: '/map',     exact: false },
      { labelKey: 'weather.tab',   icon: 'weather', route: '/weather', exact: false },
      {
        labelKey: 'nav.profile',
        icon: 'profile',
        route: uid ? ['/profile', uid] : '/login',
        exact: false,
      },
    ];
  });

  trackByIcon(_: number, item: NavItem) { return item.icon; }
}
