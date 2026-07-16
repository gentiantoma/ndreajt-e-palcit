import { Injectable, inject } from '@angular/core';
import {
  Firestore, collection, doc, addDoc, updateDoc, query, where, limit,
  collectionData, serverTimestamp, writeBatch,
} from '@angular/fire/firestore';
import { Observable, map, catchError, of } from 'rxjs';
import { AppNotification, Comment, Post, ReactionType } from '../models';

/*
 * Notifications live in a flat `notifications` collection keyed by recipient.
 * They are created client-side at action time:
 *  - comment  → the post author (the admin authors all posts, so admin sees everything)
 *  - reply    → the parent comment's author, plus the post author when different
 *  - reaction → the post author
 * A notification is never sent to the person who performed the action.
 *
 * The query uses only an equality filter (no orderBy) so no composite index is
 * required — sorting happens client-side on the ≤100 loaded docs.
 */
const MAX_LOADED = 300;
const EXCERPT_LEN = 110;

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private db = inject(Firestore);

  /** Live stream of the user's notifications, newest first. */
  notifications$(uid: string): Observable<AppNotification[]> {
    const q = query(
      collection(this.db, 'notifications'),
      where('recipientId', '==', uid),
      limit(MAX_LOADED),
    );
    return (collectionData(q, { idField: 'id' }) as Observable<AppNotification[]>).pipe(
      map(list => [...list].sort((a, b) => this.ts(b) - this.ts(a))),
      // Missing rules / offline → empty list instead of a crashing stream
      catchError(() => of([])),
    );
  }

  private ts(n: AppNotification): number {
    const d = n.createdAt?.toDate ? n.createdAt.toDate() : new Date(n.createdAt ?? 0);
    return d.getTime();
  }

  async markRead(id: string): Promise<void> {
    await updateDoc(doc(this.db, 'notifications', id), { read: true });
  }

  async markAllRead(items: AppNotification[]): Promise<void> {
    const unread = items.filter(n => !n.read && n.id);
    if (!unread.length) return;
    const batch = writeBatch(this.db);
    unread.forEach(n => batch.update(doc(this.db, 'notifications', n.id!), { read: true }));
    await batch.commit();
  }

  /* ── creation helpers — silent failures must never break the user's action ── */

  private async create(n: Omit<AppNotification, 'id' | 'read' | 'createdAt'>): Promise<void> {
    if (!n.recipientId || n.recipientId === n.actorId) return;
    try {
      await addDoc(collection(this.db, 'notifications'), {
        ...n,
        actorPhoto: n.actorPhoto || '',
        read: false,
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn('Notification create failed', e);
    }
  }

  async notifyComment(post: Post, actorId: string, actorName: string, actorPhoto: string, text: string) {
    await this.create({
      recipientId: post.authorId, type: 'comment',
      postId: post.id!, postTitle: post.titleSq,
      actorId, actorName, actorPhoto, text: text.slice(0, EXCERPT_LEN),
    });
  }

  async notifyReply(post: Post, comment: Comment, actorId: string, actorName: string, actorPhoto: string, text: string) {
    const base = {
      type: 'reply' as const,
      postId: post.id!, postTitle: post.titleSq,
      actorId, actorName, actorPhoto, text: text.slice(0, EXCERPT_LEN),
    };
    // The comment's author hears about the reply…
    await this.create({ ...base, recipientId: comment.authorId });
    // …and the post author (admin) tracks all activity too.
    if (post.authorId !== comment.authorId) {
      await this.create({ ...base, recipientId: post.authorId });
    }
  }

  async notifyReaction(post: Post, actorId: string, actorName: string, actorPhoto: string, reaction: ReactionType) {
    await this.create({
      recipientId: post.authorId, type: 'reaction',
      postId: post.id!, postTitle: post.titleSq,
      actorId, actorName, actorPhoto, reaction,
    });
  }
}
