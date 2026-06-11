import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { adminGuard } from './core/guards/admin.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/feed/feed.component').then(m => m.FeedComponent),
  },
  {
    path: 'post/:id',
    loadComponent: () => import('./pages/post-detail/post-detail.component').then(m => m.PostDetailComponent),
  },
  {
    path: 'profile/:uid',
    loadComponent: () => import('./pages/profile/profile.component').then(m => m.ProfileComponent),
    canActivate: [authGuard],
  },
  {
    path: 'favorites',
    loadComponent: () => import('./pages/favorites/favorites.component').then(m => m.FavoritesComponent),
    canActivate: [authGuard],
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./pages/dashboard/dashboard.component').then(m => m.DashboardComponent),
    canActivate: [authGuard, adminGuard],
  },
  {
    path: 'login',
    loadComponent: () => import('./auth/login/login.component').then(m => m.LoginComponent),
  },
  {
    path: '**',
    redirectTo: '',
  },
];
