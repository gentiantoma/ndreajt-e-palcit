import { Timestamp } from 'firebase/firestore';

export type PostCategory = 'lajme' | 'histori' | 'njoftim' | 'events' | 'pajtimet' | 'takimet' | 'other';
export type UserRole = 'member' | 'admin';
export type ReactionType = 'like' | 'respect' | 'strong' | 'bravo' | 'honor' | 'fire' | 'sad';

/* `label` is an ngx-translate key — resolved per active language (sq/en).
   Ancient-themed emoji set to match the old-newspaper design:
   quill = like, temple = respect, swords = strength, laurel trophy = bravo,
   shield = honor (besa), eternal fire, wilted rose = sorrow. */
export const REACTIONS: { type: ReactionType; emoji: string; label: string }[] = [
  { type: 'like',    emoji: '🪶', label: 'reactions.like'    },
  { type: 'respect', emoji: '🏛️', label: 'reactions.respect' },
  { type: 'strong',  emoji: '⚔️', label: 'reactions.strong'  },
  { type: 'bravo',   emoji: '🏆', label: 'reactions.bravo'   },
  { type: 'honor',   emoji: '🛡️', label: 'reactions.honor'   },
  { type: 'fire',    emoji: '🔥', label: 'reactions.fire'    },
  { type: 'sad',     emoji: '🥀', label: 'reactions.sad'     },
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
  editedAt?: Timestamp | Date | any;
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
  /** Suspended accounts are signed out on sight and blocked from writing (rules) */
  suspended?: boolean;
  suspendedAt?: Timestamp | Date | any;
  /** Denormalised activity counters — read directly by the admin members list */
  commentCount?: number;
  reactionCount?: number;
  createdAt?: Timestamp | Date | any;
}

export type ReportReason = 'spam' | 'offensive' | 'harassment' | 'misinformation' | 'other';
export type ReportTargetType = 'post' | 'comment';

export interface Report {
  id?: string;
  targetType: ReportTargetType;
  targetId: string;      // comment id or post id
  postId: string;        // the post it lives under (for the admin link)
  reason: ReportReason;
  note?: string;         // optional free-text detail
  excerpt?: string;      // snapshot of the reported content
  reporterId: string;
  reporterName: string;
  resolved?: boolean;
  createdAt?: Timestamp | Date | any;
}

export interface Favorite {
  userId: string;
  postId: string;
  createdAt?: Timestamp | Date | any;
}

/**
 * A diaspora member's self-placed pin on the village map. Keyed by uid
 * (one pin per person). Coordinates are captured at high zoom so they land
 * on the person's actual home/city rather than a rough district centre.
 */
export interface DiasporaMember {
  uid: string;
  name: string;
  username?: string;
  photoURL?: string;
  /** Where they are now — reverse-geocoded, e.g. "Milano, Itali" */
  place?: string;
  /** Short note shown in the pin popup, e.g. "Me mall nga Palçi 🇦🇱" */
  message?: string;
  lat: number;
  lng: number;
  createdAt?: Timestamp | Date | any;
  updatedAt?: Timestamp | Date | any;
}

/**
 * A fixed landmark/point-of-interest around Palç, imported from OpenStreetMap
 * by scripts/import-places.mjs. Always shown on the map (separate from the
 * self-placed diaspora pins). `emoji` and `color` are precomputed by the
 * importer so the map can render without a category lookup.
 */
export interface Place {
  id?: string;         // deterministic: osm_<type>_<id>
  name: string;
  category: string;    // e.g. 'ferry', 'lodging', 'peak', 'food'...
  emoji: string;
  color: string;       // hex, drives the map dot colour
  rank?: number;       // importance (lower = more important); drives zoom reveal
  lat: number;
  lng: number;
  osmId?: number;
  osmType?: string;
  source?: string;     // 'osm'
}

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
}

export type NotificationType = 'comment' | 'reply' | 'reaction' | 'report';

export interface AppNotification {
  id?: string;
  recipientId: string;
  type: NotificationType;
  postId: string;
  postTitle: string;
  actorId: string;
  actorName: string;
  actorPhoto?: string;
  /** Short excerpt of the comment/reply text */
  text?: string;
  reaction?: ReactionType;
  read: boolean;
  createdAt?: Timestamp | Date | any;
}
