import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { filter, firstValueFrom } from 'rxjs';
import { FirestoreService } from '../../core/services/firestore.service';
import { AuthService } from '../../core/services/auth.service';
import { PostCardComponent } from '../../shared/components/post-card/post-card.component';
import { Post } from '../../core/models';

@Component({
  selector: 'app-favorites',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule, PostCardComponent],
  templateUrl: './favorites.component.html',
  styleUrls: ['./favorites.component.scss'],
})
export class FavoritesComponent implements OnInit {
  private fs = inject(FirestoreService);
  auth       = inject(AuthService);

  posts   = signal<Post[]>([]);
  loading = signal(true);

  async ngOnInit() {
    try {
      // Wait for Firebase auth to resolve (signal is undefined until first emission)
      const user = await firstValueFrom(this.auth.user$.pipe(filter(u => !!u)));
      if (!user) { this.loading.set(false); return; }

      const favs = await this.fs.getUserFavorites(user.uid);
      const results = await Promise.all(favs.map(f => this.fs.getPost(f.postId)));
      this.posts.set(results.filter((p): p is Post => !!p));
    } catch {
      // user not logged in or error
    } finally {
      this.loading.set(false);
    }
  }

  get skeletonItems() { return new Array(3); }
}
