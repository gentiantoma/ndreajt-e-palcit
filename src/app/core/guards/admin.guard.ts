import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService, ADMIN_EMAILS } from '../services/auth.service';
import { map, take } from 'rxjs';

export const adminGuard: CanActivateFn = () => {
  const auth   = inject(AuthService);
  const router = inject(Router);

  return auth.user$.pipe(
    take(1),
    map(user => {
      if (user && ADMIN_EMAILS.includes(user.email ?? '')) return true;
      router.navigate(['/']);
      return false;
    })
  );
};
