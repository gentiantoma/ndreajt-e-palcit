import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { Post } from '../models';

/*
 * Admin-facing email via Formspree. Formspree always delivers to whichever
 * inbox the form was created under (the admin's), which is exactly what a
 * "new contact message" / "new comment" ping needs — there is no guest-facing
 * email in this app, so no EmailJS-style arbitrary-recipient sending is needed.
 *
 * Every call is fire-and-forget: a failed/unconfigured send must never break
 * the user's actual action (submitting the form, posting the comment).
 */
@Injectable({ providedIn: 'root' })
export class EmailService {
  /** False until a real Formspree endpoint is filled into environment.ts. */
  get configured(): boolean {
    return !environment.formspreeEndpoint.includes('YOUR_FORM_ID');
  }

  private post(fields: Record<string, string>): void {
    if (!this.configured) {
      console.warn('[email] Formspree endpoint not set — skipping. See environment.ts');
      return;
    }
    fetch(environment.formspreeEndpoint, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    }).catch(() => { /* best-effort — the in-app record already exists */ });
  }

  sendContactMessage(payload: { name: string; email: string; message: string }): void {
    this.post({
      _subject: `📬 Mesazh i ri nga ${payload.name} — Ndreajt e Palçit`,
      name: payload.name,
      email: payload.email,
      message: payload.message,
      _replyto: payload.email,
    });
  }

  notifyNewComment(post: Post, actorName: string, text: string, kind: 'comment' | 'reply' = 'comment'): void {
    this.post({
      _subject: `💬 Koment i ri te "${post.titleSq}" — Ndreajt e Palçit`,
      type: kind,
      post: post.titleSq,
      from: actorName,
      message: text,
      link: `${location.origin}/post/${post.id}`,
    });
  }
}
