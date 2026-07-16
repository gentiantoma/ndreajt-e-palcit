import { ApplicationConfig, importProvidersFrom, isDevMode } from '@angular/core';
import { provideRouter, withPreloading, PreloadAllModules, withInMemoryScrolling } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';
import { initializeApp, provideFirebaseApp, getApp } from '@angular/fire/app';
import {
  initializeFirestore, provideFirestore,
  persistentLocalCache, persistentMultipleTabManager,
} from '@angular/fire/firestore';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { environment } from '../environments/environment';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(
      routes,
      withPreloading(PreloadAllModules),
      withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' })
    ),
    provideAnimations(),
    provideHttpClient(),
    importProvidersFrom(
      provideFirebaseApp(() => initializeApp(environment.firebaseConfig)),
      provideFirestore(() => initializeFirestore(getApp(), {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      })),
      provideAuth(() => getAuth()),
    ),
    provideTranslateService({ fallbackLang: 'sq' }),
    provideTranslateHttpLoader({ prefix: './assets/i18n/', suffix: '.json' }),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
