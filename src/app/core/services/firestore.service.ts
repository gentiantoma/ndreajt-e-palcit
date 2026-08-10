import { Injectable, inject } from '@angular/core';
import {
  Firestore, collection, doc, getDoc, getDocs, setDoc, addDoc,
  updateDoc, deleteDoc, query, where, orderBy, limit, collectionData, docData,
  collectionGroup, QueryConstraint, serverTimestamp, increment, writeBatch,
  DocumentData
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Post, Comment, Reply, UserProfile, Favorite, ReactionType, Report, AppNotification, DiasporaMember, Place } from '../models';

@Injectable({ providedIn: 'root' })
export class FirestoreService {
  private db = inject(Firestore);

  /* ── posts ── */
  async getPosts(filters: QueryConstraint[] = []): Promise<Post[]> {
    const q = query(collection(this.db, 'posts'), ...filters);
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Post);
  }

  async getPost(id: string): Promise<Post | null> {
    const snap = await getDoc(doc(this.db, 'posts', id));
    return snap.exists() ? ({ id: snap.id, ...snap.data() } as Post) : null;
  }

  /** Live post document — counters (likes/reactions/comments) update in real time */
  getPost$(id: string): Observable<Post | undefined> {
    return docData(doc(this.db, 'posts', id), { idField: 'id' }) as Observable<Post | undefined>;
  }

  async createPost(data: Partial<Post>): Promise<string> {
    const ref = await addDoc(collection(this.db, 'posts'), {
      ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      likeCount: 0, commentCount: 0,
    });
    return ref.id;
  }

  async updatePost(id: string, data: Partial<Post>): Promise<void> {
    await updateDoc(doc(this.db, 'posts', id), { ...data, updatedAt: serverTimestamp() });
  }

  /**
   * Fully delete a post AND everything attached to it — comments, their replies,
   * likes, favorites and notifications. Firestore does NOT cascade into
   * subcollections on its own, so we walk the tree and batch-delete every doc.
   * Deletes are chunked to respect the 500-writes-per-batch limit.
   */
  async deletePost(id: string): Promise<void> {
    const refs: any[] = [];

    // 1) Comments + their reply subcollections
    const commentsSnap = await getDocs(collection(this.db, 'posts', id, 'comments'));
    for (const c of commentsSnap.docs) {
      const repliesSnap = await getDocs(collection(this.db, 'posts', id, 'comments', c.id, 'replies'));
      repliesSnap.docs.forEach(r => refs.push(r.ref));
      refs.push(c.ref);
    }

    // 2) Likes/reactions, favorites and notifications that point at this post
    const [likeSnap, favSnap, notifSnap] = await Promise.all([
      getDocs(query(collection(this.db, 'likes'),         where('postId', '==', id))),
      getDocs(query(collection(this.db, 'favorites'),      where('postId', '==', id))),
      getDocs(query(collection(this.db, 'notifications'),  where('postId', '==', id))),
    ]);
    likeSnap.docs.forEach(d => refs.push(d.ref));
    favSnap.docs.forEach(d => refs.push(d.ref));
    notifSnap.docs.forEach(d => refs.push(d.ref));

    // 3) The post itself, then commit everything in ≤500-doc batches
    refs.push(doc(this.db, 'posts', id));
    await this.batchDelete(refs);
  }

  /** Delete a list of document refs in Firestore-safe 500-doc batches. */
  private async batchDelete(refs: any[]): Promise<void> {
    for (let i = 0; i < refs.length; i += 450) {
      const batch = writeBatch(this.db);
      refs.slice(i, i + 450).forEach(r => batch.delete(r));
      await batch.commit();
    }
  }

  /* ── reactions ── */
  async setReaction(postId: string, userId: string, reaction: ReactionType): Promise<ReactionType | null> {
    const likeId = `${postId}_${userId}`;
    const likeRef = doc(this.db, 'likes', likeId);
    const postRef = doc(this.db, 'posts', postId);
    const snap = await getDoc(likeRef);
    if (snap.exists()) {
      const current = (snap.data()['reaction'] as ReactionType) || 'like';
      if (current === reaction) {
        await deleteDoc(likeRef);
        await updateDoc(postRef, {
          likeCount: increment(-1),
          [`reactionCounts.${current}`]: increment(-1),
        });
        this.bumpUserStat(userId, 'reactionCount', -1);
        return null;
      }
      await updateDoc(likeRef, { reaction });
      await updateDoc(postRef, {
        [`reactionCounts.${current}`]: increment(-1),
        [`reactionCounts.${reaction}`]: increment(1),
      });
      return reaction;
    }
    await setDoc(likeRef, { postId, userId, reaction, createdAt: serverTimestamp() });
    await updateDoc(postRef, {
      likeCount: increment(1),
      [`reactionCounts.${reaction}`]: increment(1),
    });
    this.bumpUserStat(userId, 'reactionCount', 1);
    return reaction;
  }

  /** Persist a computed per-type reaction breakdown (backfill for pre-counter posts) */
  async setReactionCounts(postId: string, counts: Partial<Record<ReactionType, number>>): Promise<void> {
    await updateDoc(doc(this.db, 'posts', postId), { reactionCounts: counts });
  }

  async getUserReaction(postId: string, userId: string): Promise<ReactionType | null> {
    const snap = await getDoc(doc(this.db, 'likes', `${postId}_${userId}`));
    if (!snap.exists()) return null;
    return (snap.data()['reaction'] as ReactionType) || 'like';
  }

  async getLikesForPost(postId: string): Promise<{ userId: string; reaction: ReactionType }[]> {
    const q = query(collection(this.db, 'likes'), where('postId', '==', postId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({
      userId: d.data()['userId'] as string,
      reaction: (d.data()['reaction'] as ReactionType) || 'like',
    }));
  }

  async hasLiked(postId: string, userId: string): Promise<boolean> {
    const snap = await getDoc(doc(this.db, 'likes', `${postId}_${userId}`));
    return snap.exists();
  }

  /* ── favorites ── */
  async toggleFavorite(postId: string, userId: string): Promise<boolean> {
    const favId = `${userId}_${postId}`;
    const ref = doc(this.db, 'favorites', favId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await deleteDoc(ref);
      return false;
    } else {
      await setDoc(ref, { postId, userId, createdAt: serverTimestamp() } as Favorite);
      return true;
    }
  }

  async hasFavorited(postId: string, userId: string): Promise<boolean> {
    const snap = await getDoc(doc(this.db, 'favorites', `${userId}_${postId}`));
    return snap.exists();
  }

  // Single-round-trip batch: get all reactions + bookmarks for a list of posts
  async getUserFeedState(postIds: string[], userId: string): Promise<Map<string, { reaction: ReactionType | null; bookmarked: boolean }>> {
    const result = new Map<string, { reaction: ReactionType | null; bookmarked: boolean }>();
    postIds.forEach(id => result.set(id, { reaction: null, bookmarked: false }));
    if (!postIds.length) return result;

    // Firestore `in` supports up to 30 values — split if needed
    const chunks: string[][] = [];
    for (let i = 0; i < postIds.length; i += 30) chunks.push(postIds.slice(i, i + 30));

    await Promise.all(chunks.flatMap(chunk => [
      getDocs(query(collection(this.db, 'likes'),     where('userId', '==', userId), where('postId', 'in', chunk))),
      getDocs(query(collection(this.db, 'favorites'), where('userId', '==', userId), where('postId', 'in', chunk))),
    ])).then(snaps => {
      // odd indices = likes, even = favorites per chunk pair
      snaps.forEach((snap, i) => {
        const isLikes = i % 2 === 0;
        snap.docs.forEach((d: any) => {
          const pid = d.data()['postId'] as string;
          const entry = result.get(pid) ?? { reaction: null, bookmarked: false };
          if (isLikes) entry.reaction = (d.data()['reaction'] as ReactionType) || 'like';
          else entry.bookmarked = true;
          result.set(pid, entry);
        });
      });
    });
    return result;
  }

  async getUserFavorites(userId: string): Promise<Favorite[]> {
    // No orderBy to avoid requiring a composite index
    const q = query(collection(this.db, 'favorites'), where('userId', '==', userId));
    const snap = await getDocs(q);
    const favs = snap.docs.map(d => ({ id: d.id, ...d.data() } as unknown as Favorite));
    // Sort client-side by createdAt descending
    return favs.sort((a: any, b: any) => {
      const ta = a.createdAt?.toDate?.()?.getTime() ?? 0;
      const tb = b.createdAt?.toDate?.()?.getTime() ?? 0;
      return tb - ta;
    });
  }

  /* ── comments (real-time) ── */
  getComments$(postId: string): Observable<Comment[]> {
    const q = query(
      collection(this.db, 'posts', postId, 'comments'),
      orderBy('createdAt', 'asc')
    );
    return collectionData(q, { idField: 'id' }) as Observable<Comment[]>;
  }

  async addComment(postId: string, comment: Partial<Comment>): Promise<void> {
    await addDoc(collection(this.db, 'posts', postId, 'comments'), {
      ...comment, createdAt: serverTimestamp(),
    });
    await updateDoc(doc(this.db, 'posts', postId), { commentCount: increment(1) });
    if (comment.authorId) this.bumpUserStat(comment.authorId, 'commentCount', 1);
  }

  /** Edit the text of an existing comment (author only, enforced by rules). */
  async editComment(postId: string, commentId: string, textSq: string): Promise<void> {
    await updateDoc(doc(this.db, 'posts', postId, 'comments', commentId), {
      textSq, editedAt: serverTimestamp(),
    });
  }

  /** Delete a comment AND its replies subcollection, and fix the counters. */
  async deleteComment(postId: string, commentId: string): Promise<void> {
    const repliesSnap = await getDocs(collection(this.db, 'posts', postId, 'comments', commentId, 'replies'));
    const refs = repliesSnap.docs.map(r => r.ref);
    refs.push(doc(this.db, 'posts', postId, 'comments', commentId));
    await this.batchDelete(refs);
    await updateDoc(doc(this.db, 'posts', postId), { commentCount: increment(-1) });
  }

  /* ── replies (subcollection under each comment) ── */
  getReplies$(postId: string, commentId: string): Observable<Reply[]> {
    const q = query(
      collection(this.db, 'posts', postId, 'comments', commentId, 'replies'),
      orderBy('createdAt', 'asc'),
      limit(10)
    );
    return collectionData(q, { idField: 'id' }) as Observable<Reply[]>;
  }

  async addReply(postId: string, commentId: string, reply: Partial<Reply>): Promise<void> {
    await addDoc(
      collection(this.db, 'posts', postId, 'comments', commentId, 'replies'),
      { ...reply, createdAt: serverTimestamp() }
    );
    // Increment comment's replyCount
    await updateDoc(
      doc(this.db, 'posts', postId, 'comments', commentId),
      { replyCount: increment(1) }
    );
    if (reply.authorId) this.bumpUserStat(reply.authorId, 'commentCount', 1);
  }

  /**
   * Denormalised per-user activity counters kept on the user doc, so the admin
   * members list reads them directly instead of running O(users) aggregate
   * queries. Fire-and-forget; a lost increment is cosmetic, never fatal.
   */
  private bumpUserStat(uid: string, field: 'commentCount' | 'reactionCount', by: number): void {
    updateDoc(doc(this.db, 'users', uid), { [field]: increment(by) }).catch(() => {});
  }

  async deleteReply(postId: string, commentId: string, replyId: string): Promise<void> {
    await deleteDoc(
      doc(this.db, 'posts', postId, 'comments', commentId, 'replies', replyId)
    );
    await updateDoc(
      doc(this.db, 'posts', postId, 'comments', commentId),
      { replyCount: increment(-1) }
    );
  }

  /* ── users ── */
  async getUser(uid: string): Promise<UserProfile | null> {
    const snap = await getDoc(doc(this.db, 'users', uid));
    return snap.exists() ? (snap.data() as UserProfile) : null;
  }

  async updateUser(uid: string, data: Partial<UserProfile>): Promise<void> {
    await updateDoc(doc(this.db, 'users', uid), data as DocumentData);
  }

  async getPostsByAuthor(authorId: string): Promise<Post[]> {
    const q = query(
      collection(this.db, 'posts'),
      where('authorId', '==', authorId),
      where('published', '==', true)
    );
    const snap = await getDocs(q);
    const posts = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Post);
    return posts.sort((a, b) => {
      const ta = a.createdAt?.toDate?.() ?? new Date(a.createdAt ?? 0);
      const tb = b.createdAt?.toDate?.() ?? new Date(b.createdAt ?? 0);
      return tb.getTime() - ta.getTime();
    });
  }

  /** Anonymises all posts authored by the given admin UID and applies the brand photo */
  async migrateAdminPosts(adminUid: string, brandPhoto = ''): Promise<void> {
    const q = query(collection(this.db, 'posts'), where('authorId', '==', adminUid));
    const snap = await getDocs(q);
    const batch = writeBatch(this.db);
    snap.docs.forEach(d => {
      const data = d.data();
      const needsUpdate = !data['authorIsAdmin'] || (brandPhoto && data['authorPhoto'] !== brandPhoto);
      if (needsUpdate) {
        batch.update(d.ref, {
          authorName: 'Ndreajt e Palçit',
          authorPhoto: brandPhoto,
          authorIsAdmin: true,
        });
      }
    });
    if (snap.docs.length) await batch.commit();
  }

  /* ── reports (community flagging) ── */
  async addReport(report: Omit<Report, 'id' | 'createdAt' | 'resolved'>): Promise<void> {
    await addDoc(collection(this.db, 'reports'), {
      ...report, resolved: false, createdAt: serverTimestamp(),
    });
  }

  /** Live stream of open + recent reports for the admin dashboard (newest first). */
  getReports$(): Observable<Report[]> {
    const q = query(collection(this.db, 'reports'), orderBy('createdAt', 'desc'), limit(100));
    return collectionData(q, { idField: 'id' }) as Observable<Report[]>;
  }

  async resolveReport(id: string): Promise<void> {
    await updateDoc(doc(this.db, 'reports', id), { resolved: true });
  }

  async deleteReport(id: string): Promise<void> {
    await deleteDoc(doc(this.db, 'reports', id));
  }

  /* ── notifications maintenance ── */
  /**
   * Keep each recipient's notifications bounded: whenever they load their list,
   * trim anything past the newest `keep`. Self-maintaining, no Cloud Function
   * needed — the owner can delete their own notifications (allowed by rules).
   */
  async trimNotifications(uid: string, keep = 60): Promise<void> {
    const snap = await getDocs(query(collection(this.db, 'notifications'), where('recipientId', '==', uid)));
    if (snap.docs.length <= keep) return;
    const sorted = snap.docs.sort((a, b) => {
      const ta = a.data()['createdAt']?.toMillis?.() ?? 0;
      const tb = b.data()['createdAt']?.toMillis?.() ?? 0;
      return tb - ta; // newest first
    });
    await this.batchDelete(sorted.slice(keep).map(d => d.ref));
  }

  /** Admin moderation: block/unblock an account platform-wide */
  async setUserSuspended(uid: string, suspended: boolean): Promise<void> {
    await updateDoc(doc(this.db, 'users', uid), {
      suspended,
      suspendedAt: suspended ? serverTimestamp() : null,
    });
  }

  async getAllUsers(): Promise<any[]> {
    const snap = await getDocs(collection(this.db, 'users'));
    return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  }

  async getLikesCountByUser(userId: string): Promise<number> {
    const q = query(collection(this.db, 'likes'), where('userId', '==', userId));
    const snap = await getDocs(q);
    return snap.docs.length;
  }

  async getCommentsCountByUser(userId: string): Promise<number> {
    try {
      const q = query(collectionGroup(this.db, 'comments'), where('authorId', '==', userId));
      const snap = await getDocs(q);
      return snap.docs.length;
    } catch {
      return 0;
    }
  }

  /* ── diaspora map ── */

  /** Live stream of every member pin on the village map. */
  diasporaMembers$(): Observable<DiasporaMember[]> {
    return collectionData(collection(this.db, 'diaspora'), { idField: 'uid' }) as Observable<DiasporaMember[]>;
  }

  /** My own pin, if I've placed one (used to prefill / show "you're on the map"). */
  async getMyDiasporaPin(uid: string): Promise<DiasporaMember | null> {
    const snap = await getDoc(doc(this.db, 'diaspora', uid));
    return snap.exists() ? ({ uid: snap.id, ...snap.data() } as DiasporaMember) : null;
  }

  /** Place or move my pin. Keyed by uid so a person can only ever have one. */
  async setMyDiasporaPin(uid: string, data: Omit<DiasporaMember, 'uid' | 'createdAt' | 'updatedAt'>): Promise<void> {
    const ref = doc(this.db, 'diaspora', uid);
    const exists = (await getDoc(ref)).exists();
    // Include `uid` (the security rule checks it) and drop any undefined optional
    // fields — Firestore rejects undefined values outright.
    const payload: DocumentData = { uid };
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) payload[k] = v;
    }
    payload['updatedAt'] = serverTimestamp();
    if (!exists) payload['createdAt'] = serverTimestamp();
    await setDoc(ref, payload, { merge: true });
  }

  /** Remove my pin from the map. */
  async removeMyDiasporaPin(uid: string): Promise<void> {
    await deleteDoc(doc(this.db, 'diaspora', uid));
  }

  /** Live stream of the fixed landmarks/POIs around Palç (imported from OSM). */
  places$(): Observable<Place[]> {
    return collectionData(collection(this.db, 'places'), { idField: 'id' }) as Observable<Place[]>;
  }

  /* ── admin: all comments ── */
  async getAllComments(limitCount = 50): Promise<(Comment & { postId: string })[]> {
    const q = query(collectionGroup(this.db, 'comments'), limit(limitCount));
    const snap = await getDocs(q);
    const comments = snap.docs.map(d => {
      const postId = d.ref.parent.parent?.id ?? '';
      return { id: d.id, postId, ...d.data() } as Comment & { postId: string };
    });
    return comments.sort((a: any, b: any) => {
      const ta = a.createdAt?.toDate?.()?.getTime() ?? 0;
      const tb = b.createdAt?.toDate?.()?.getTime() ?? 0;
      return tb - ta;
    });
  }
}
