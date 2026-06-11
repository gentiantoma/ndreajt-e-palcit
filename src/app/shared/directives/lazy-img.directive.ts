import { Directive, ElementRef, Input, OnDestroy, OnInit, inject } from '@angular/core';

@Directive({
  selector: 'img[lazyImg]',
  standalone: true,
})
export class LazyImgDirective implements OnInit, OnDestroy {
  @Input('lazyImg') src = '';

  private el = inject(ElementRef<HTMLImageElement>);
  private observer?: IntersectionObserver;

  ngOnInit() {
    const img    = this.el.nativeElement;
    const parent = img.parentElement;

    img.classList.add('img-cover');
    img.decoding = 'async';

    parent?.classList.add('img-loading');

    const finish = () => {
      img.classList.add('loaded');
      parent?.classList.remove('img-loading');
    };

    const load = () => {
      if (!this.src) {
        parent?.classList.remove('img-loading');
        return;
      }
      img.src = this.src;
      img.onload  = finish;
      img.onerror = finish;
      this.observer?.disconnect();
    };

    // If already in (or near) viewport, load immediately
    if ('IntersectionObserver' in window) {
      this.observer = new IntersectionObserver(
        entries => { if (entries[0].isIntersecting) load(); },
        { rootMargin: '600px 0px' }   // pre-fetch 600px before visible
      );
      this.observer.observe(img);
    } else {
      load();
    }
  }

  ngOnDestroy() {
    this.observer?.disconnect();
  }
}
