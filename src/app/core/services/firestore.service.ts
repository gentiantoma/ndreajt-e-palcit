import { Injectable, inject } from '@angular/core';
import {
  Firestore, collection, doc, getDoc, getDocs, setDoc, addDoc,
  updateDoc, deleteDoc, query, where, orderBy, limit, collectionData,
  collectionGroup, QueryConstraint, serverTimestamp, increment, writeBatch,
  DocumentData
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Post, Comment, Reply, UserProfile, Favorite } from '../models';

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

  async deletePost(id: string): Promise<void> {
    await deleteDoc(doc(this.db, 'posts', id));
    // also delete likes for this post
    const likeSnap = await getDocs(query(collection(this.db, 'likes'), where('postId', '==', id)));
    const batch = writeBatch(this.db);
    likeSnap.docs.forEach(d => batch.delete(d.ref));
    if (likeSnap.docs.length) await batch.commit();
  }

  /* ── likes ── */
  async toggleLike(postId: string, userId: string): Promise<boolean> {
    const likeId = `${postId}_${userId}`;
    const likeRef = doc(this.db, 'likes', likeId);
    const postRef = doc(this.db, 'posts', postId);
    const snap = await getDoc(likeRef);
    if (snap.exists()) {
      await deleteDoc(likeRef);
      await updateDoc(postRef, { likeCount: increment(-1) });
      return false;
    } else {
      await setDoc(likeRef, { postId, userId, createdAt: serverTimestamp() });
      await updateDoc(postRef, { likeCount: increment(1) });
      return true;
    }
  }

  async hasLiked(postId: string, userId: string): Promise<boolean> {
    const snap = await getDoc(doc(this.db, 'likes', `${postId}_${userId}`));
    return snap.exists();
  }

  async getLikesForPost(postId: string): Promise<{ userId: string }[]> {
    const q = query(collection(this.db, 'likes'), where('postId', '==', postId), limit(20));
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data() as { userId: string });
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
  }

  async deleteComment(postId: string, commentId: string): Promise<void> {
    await deleteDoc(doc(this.db, 'posts', postId, 'comments', commentId));
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
