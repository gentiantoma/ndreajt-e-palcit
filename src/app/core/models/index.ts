import { Timestamp } from 'firebase/firestore';

export type PostCategory = 'lajme' | 'histori' | 'njoftim' | 'events' | 'pajtimet' | 'takimet' | 'other';
export type UserRole = 'member' | 'admin';
export type ReactionType = 'like' | 'haha' | 'wow' | 'sad' | 'angry' | 'celebrate';

export const REACTIONS: { type: ReactionType; emoji: string; label: string }[] = [
  { type: 'like',      emoji: '❤️',  label: 'Pëlqej'   },
  { type: 'haha',      emoji: '😂',  label: 'Haha'     },
  { type: 'wow',       emoji: '😮',  label: 'Wow'      },
  { type: 'sad',       emoji: '😢',  label: 'Pikëllim' },
  { type: 'angry',     emoji: '😡',  label: 'Zemërim'  },
  { type: 'celebrate', emoji: '🎉',  label: 'Festoj'   },
];

export interface Post {
  id?: string;
  titleSq: string;
  titleEn?: string;
  bodySq: string;
  bodyEn?: string;
  coverImage?: string;
  images?: string[];
  authorId: string;
  authorName: string;
  authorPhoto?: string;
  authorIsAdmin?: boolean;
  category: PostCategory;
  likeCount: number;
  commentCount: number;
  published: boolean;
  createdAt?: Timestamp | Date | any;
  updatedAt?: Timestamp | Date | any;
}

export interface Comment {
  id?: string;
  authorId: string;
  authorName: string;
  authorPhoto?: string;
  textSq: string;
  replyCount?: number;
  createdAt?: Timestamp | Date | any;
}

export interface Reply {
  id?: string;
  authorId: string;
  authorName: string;
  authorPhoto?: string;
  textSq: string;
  mentionName?: string;   // "@Name" of who they replied to
  createdAt?: Timestamp | Date | any;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  bio?: string;
  role: UserRole;
  createdAt?: Timestamp | Date | any;
}

export interface Favorite {
  userId: string;
  postId: string;
  createdAt?: Timestamp | Date | any;
}

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
}
