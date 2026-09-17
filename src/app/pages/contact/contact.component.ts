import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ContactService } from '../../core/services/contact.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-contact',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule],
  templateUrl: './contact.component.html',
  styleUrls: ['./contact.component.scss'],
})
export class ContactComponent {
  private contact   = inject(ContactService);
  private toast     = inject(ToastService);
  private translate = inject(TranslateService);
  auth               = inject(AuthService);

  name    = signal(this.auth.currentUser()?.displayName || '');
  email   = signal(this.auth.currentUser()?.email || '');
  message = signal('');
  sending = signal(false);
  sent    = signal(false);

  async submit() {
    const name = this.name().trim();
    const email = this.email().trim();
    const message = this.message().trim();
    if (name.length < 2 || !email.includes('@') || message.length < 5) {
      this.toast.error(this.translate.instant('contact.form_invalid'));
      return;
    }

    this.sending.set(true);
    try {
      await this.contact.send({ name, email, message });
      this.sent.set(true);
      this.message.set('');
    } catch {
      this.toast.error(this.translate.instant('toast.error_generic'));
    } finally {
      this.sending.set(false);
    }
  }
}
