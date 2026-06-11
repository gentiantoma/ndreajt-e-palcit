/**
 * Seed the Firestore database with demo posts.
 * Run with: node scripts/seed-firestore.mjs
 *
 * Requires Firestore to allow unauthenticated writes (test mode rules).
 * If you get permission errors, set Firestore rules to test mode in the Firebase console.
 */

import { initializeApp } from '../node_modules/firebase/app/dist/index.esm2017.js';
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  where,
  Timestamp,
} from '../node_modules/firebase/firestore/dist/index.esm2017.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDp0-VW4jYgtM-6GWMigW7kmFgW6PslXlk',
  authDomain: 'bookingsystem-1f9e1.firebaseapp.com',
  databaseURL: 'https://bookingsystem-1f9e1-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'bookingsystem-1f9e1',
  storageBucket: 'bookingsystem-1f9e1.firebasestorage.app',
  messagingSenderId: '626285198203',
  appId: '1:626285198203:web:82ea23034c72d3d5535bde',
  measurementId: 'G-JFZ5QJ2TLM',
};

const DEMO_POSTS = [
  {
    titleSq: 'Pamja mahnitëse e Palçit nga lartësia',
    titleEn: 'Stunning aerial view of Palç',
    bodySq: 'Çdo herë që shoh fshatin tonë nga lartësia, zemra më mbushet me krenari. Palçi është xhevahiri i fshatrave të Shqipërisë — natyra e pastër, ajri i freskët dhe njerëzit e zemërgjerë. Kush e ka vizituar nuk e harron kurrë.',
    bodyEn: 'Every time I see our village from above, my heart fills with pride. Palç is the gem of Albanian villages — pure nature, fresh air and warm-hearted people.',
    category: 'lajme',
    authorId: 'seed-admin',
    authorName: 'Gentian Toma',
    authorPhoto: '',
    coverImage: 'https://picsum.photos/seed/palc-village1/900/500',
    images: [],
    likeCount: 47,
    commentCount: 12,
    published: true,
    createdAt: Timestamp.fromDate(new Date(Date.now() - 2 * 60 * 60 * 1000)),
    updatedAt: Timestamp.fromDate(new Date(Date.now() - 2 * 60 * 60 * 1000)),
  },
  {
    titleSq: 'Festa e Vjeshtës — Palç 2025',
    titleEn: 'Autumn Festival — Palç 2025',
    bodySq: 'Sivjet festa e vjeshtës ishte diçka e paharrueshme! Banorë nga e gjithë diaspora u mblodhën bashkë për të festuar traditat tona. Muzikë live, ushqime tradicionale dhe valle shqiptare deri në mesnatë. Faleminderit të gjithëve që e bënë të mundur!',
    bodyEn: 'This year\'s autumn festival was unforgettable! Residents from the diaspora gathered to celebrate our traditions. Live music, traditional food and Albanian dance until midnight.',
    category: 'kulture',
    authorId: 'seed-admin',
    authorName: 'Gentian Toma',
    authorPhoto: '',
    coverImage: 'https://picsum.photos/seed/palc-festa/900/500',
    images: [
      'https://picsum.photos/seed/palc-festa2/900/500',
      'https://picsum.photos/seed/palc-festa3/900/500',
    ],
    likeCount: 124,
    commentCount: 38,
    published: true,
    createdAt: Timestamp.fromDate(new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)),
    updatedAt: Timestamp.fromDate(new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)),
  },
  {
    titleSq: 'Rruga e re e Palçit — Punët kanë filluar!',
    titleEn: 'New road in Palç — Works have started!',
    bodySq: 'Lajm i mirë për të gjithë banorët! Punët për ndërtimin e rrugës së re të asfaltuar kanë filluar zyrtarisht. Projekti pritet të përfundojë brenda 6 muajve. Falënderojmë bashkinë dhe të gjithë ata që punuan për këtë moment historik.',
    bodyEn: 'Good news for all residents! Work on the new paved road has officially begun. The project is expected to complete within 6 months.',
    category: 'njoftim',
    authorId: 'seed-admin',
    authorName: 'Gentian Toma',
    authorPhoto: '',
    coverImage: 'https://picsum.photos/seed/palc-road/900/450',
    images: [],
    likeCount: 89,
    commentCount: 21,
    published: true,
    createdAt: Timestamp.fromDate(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)),
    updatedAt: Timestamp.fromDate(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)),
  },
  {
    titleSq: 'Histori nga të vjetrit — Palçi i dikurshëm',
    titleEn: 'Stories from elders — Palç of the past',
    bodySq: 'Gjyshja ime, 87 vjeçe, tregon se si ishte jeta në Palç 60 vjet më parë. "Kishim gjithçka — ujë të freskët, pyje të mbushura me kafshë, fqinjë si vëllezër." Sot ia kushtojmë këtë postim të gjithë të moshuarve tanë që mbajnë gjallë historinë e fshatit.',
    bodyEn: 'My grandmother tells how life was in Palç 60 years ago. "We had everything — fresh water, forests full of animals, neighbors like brothers."',
    category: 'histori',
    authorId: 'seed-admin',
    authorName: 'Gentian Toma',
    authorPhoto: '',
    coverImage: 'https://picsum.photos/seed/palc-history/900/500',
    images: ['https://picsum.photos/seed/palc-hist2/900/500'],
    likeCount: 203,
    commentCount: 54,
    published: true,
    createdAt: Timestamp.fromDate(new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)),
    updatedAt: Timestamp.fromDate(new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)),
  },
  {
    titleSq: 'Natyra e papërsëritur e Palçit',
    titleEn: 'The unrepeatable nature of Palç',
    bodySq: 'Pak vende në botë kanë natyrë kaq të pastër si fshati ynë. Këto foto janë marrë gjatë shëtitjes së mëngjesit pranë lumit. Ndaluni dhe shijoni bukurinë!',
    bodyEn: 'Few places in the world have such pristine nature as our village. These photos were taken during the morning walk near the river.',
    category: 'lajme',
    authorId: 'seed-admin',
    authorName: 'Gentian Toma',
    authorPhoto: '',
    coverImage: 'https://picsum.photos/seed/palc-nature1/900/600',
    images: [
      'https://picsum.photos/seed/palc-nature2/900/600',
      'https://picsum.photos/seed/palc-nature3/900/600',
      'https://picsum.photos/seed/palc-nature4/900/600',
    ],
    likeCount: 156,
    commentCount: 29,
    published: true,
    createdAt: Timestamp.fromDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
    updatedAt: Timestamp.fromDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
  },
];

async function seed() {
  const app = initializeApp(firebaseConfig);
  const db  = getFirestore(app);

  // Check if posts already exist
  const existing = await getDocs(query(collection(db, 'posts'), where('published', '==', true)));
  if (!existing.empty) {
    console.log(`ℹ️  Database already has ${existing.size} post(s). Skipping seed.`);
    process.exit(0);
  }

  console.log('🌱 Seeding Firestore with demo posts...\n');
  for (const post of DEMO_POSTS) {
    const ref = await addDoc(collection(db, 'posts'), post);
    console.log(`  ✅ Created: "${post.titleSq}" (id: ${ref.id})`);
  }

  console.log(`\n🎉 Done! ${DEMO_POSTS.length} posts added to Firestore.`);
  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
