import { Timestamp } from 'firebase/firestore';

export type PostCategory = 'lajme' | 'histori' | 'njoftim' | 'events' | 'pajtimet' | 'takimet' | 'other';
export type UserRole = 'member' | 'admin';
export type ReactionType = 'like' | 'respect' | 'strong' | 'bravo' | 'honor' | 'fire' | 'sad';

/* `label` is an ngx-translate key — resolved per active language (sq/en) */
export const REACTIONS: { type: ReactionType; emoji: string; label: string }[] = [
  { type: 'like',    emoji: '❤️', label: 'reactions.like'    },
  { type: 'respect', emoji: '🤝', label: 'reactions.respect' },
  { type: 'strong',  emoji: '💪', label: 'reactions.strong'  },
  { type: 'bravo',   emoji: '🙌', label: 'reactions.bravo'   },
  { type: 'honor',   emoji: '🫡', label: 'reactions.honor'   },
  { type: 'fire',    emoji: '🔥', label: 'reactions.fire'    },
  { type: 'sad',     emoji: '💔', label: 'reactions.sad'     },
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
  /** Per-reaction counters (e.g. { respect: 12, fire: 3 }) — used to render the top-3 emoji stack */
  reactionCounts?: Partial<Record<ReactionType, number>>;
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
