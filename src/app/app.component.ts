import { Component, OnInit, HostListener, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';
import { HeaderComponent } from './shared/components/header/header.component';
import { ToastComponent } from './shared/components/toast/toast.component';
import { AuthService } from './core/services/auth.service';
import { ReactionPickerService } from './core/services/reaction-picker.service';
import { REACTIONS } from './core/models';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule, HeaderComponent, ToastComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnInit {
  private translate = inject(TranslateService);
  private auth      = inject(AuthService);
  readonly picker   = inject(ReactionPickerService);
  readonly reactions = REACTIONS;

  ngOnInit() {
    const saved = localStorage.getItem('lang') || 'sq';
    this.translate.use(saved);
    this.auth.init();
  }

  @HostListener('document:click')
  onDocClick() { this.picker.dismiss(); }

  @HostListener('window:scroll')
  onScroll() { this.picker.dismiss(); }
}
