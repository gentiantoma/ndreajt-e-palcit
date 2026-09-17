import { Injectable, inject } from '@angular/core';
import { Firestore, collection, addDoc, serverTimestamp } from '@angular/fire/firestore';
import { EmailService } from './email.service';

export interface ContactMessage {
  name: string;
  email: string;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class ContactService {
  private db    = inject(Firestore);
  private email = inject(EmailService);

  async send(payload: ContactMessage): Promise<void> {
    // Firestore keeps a permanent record even if the Formspree send fails.
    await addDoc(collection(this.db, 'contacts'), {
      ...payload,
      read: false,
      createdAt: serverTimestamp(),
    });
    this.email.sendContactMessage(payload);
  }
}
