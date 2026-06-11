import { Injectable, inject } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';

@Injectable({ providedIn: 'root' })
export class SeoService {
  private title = inject(Title);
  private meta  = inject(Meta);

  set(opts: { title?: string; description?: string; image?: string }) {
    if (opts.title) {
      this.title.setTitle(`${opts.title} — Ndreajt e Palçit`);
      this.meta.updateTag({ property: 'og:title', content: opts.title });
    }
    if (opts.description) {
      this.meta.updateTag({ name: 'description', content: opts.description });
      this.meta.updateTag({ property: 'og:description', content: opts.description });
    }
    if (opts.image) {
      this.meta.updateTag({ property: 'og:image', content: opts.image });
    }
  }

  reset() {
    this.title.setTitle('Ndreajt e Palçit');
    this.meta.updateTag({ name: 'description', content: 'Platforma informative e fshatit Palç, Shqipëri.' });
  }
}
