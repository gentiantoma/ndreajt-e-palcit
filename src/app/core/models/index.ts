import { Timestamp } from 'firebase/firestore';

export type PostCategory = 'lajme' | 'histori' | 'njoftim' | 'events' | 'pajtimet' | 'takimet' | 'other';
export type UserRole = 'member' | 'admin';
export type ReactionType = 'like' | 'respect' | 'strong' | 'bravo' | 'honor' | 'fire' | 'sad';

export const REACTIONS: { type: ReactionType; emoji: string; label: string }[] = [
  { type: 'like',    emoji: '❤️', label: 'Pëlqej'   },
  { type: 'respect', emoji: '🤝', label: 'Respekt'  },
  { type: 'strong',  emoji: '💪', label: 'Forcë'    },
  { type: 'bravo',   emoji: '🙌', label: 'Bravo'    },
  { type: 'honor',   emoji: '🫡', label: 'Nderim'   },
  { type: 'fire',    emoji: '🔥', label: 'Zjarr'    },
  { type: 'sad',     emoji: '💔', label: 'Pikëllim' },
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
