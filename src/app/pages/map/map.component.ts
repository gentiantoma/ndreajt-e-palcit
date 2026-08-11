import {
  Component, AfterViewInit, OnDestroy, ElementRef, ViewChild,
  NgZone, HostListener, inject, signal, computed, effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import maplibregl from 'maplibre-gl';
import { PALC_COORDS } from '../../core/services/weather.service';
import { MapWarmupService } from '../../core/services/map-warmup.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';
import { FirestoreService } from '../../core/services/firestore.service';
import { DiasporaMember, Place } from '../../core/models';

@Component({
  selector: 'app-map',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule],
  templateUrl: './map.component.html',
  styleUrls: ['./map.component.scss'],
})
export class MapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: true }) mapContainer!: ElementRef<HTMLDivElement>;

  private zone      = inject(NgZone);
  private warmup    = inject(MapWarmupService);
  private toast     = inject(ToastService);
  private translate = inject(TranslateService);
  private auth      = inject(AuthService);
  private fs        = inject(FirestoreService);
  private router    = inject(Router);

  private map!: maplibregl.Map;
  private navControl: maplibregl.NavigationControl | null = null;
  private attribControl: maplibregl.AttributionControl | null = null;
  private villageMarker: maplibregl.Marker | null = null;
  private userMarker: maplibregl.Marker | null = null;
  private markers = new Map<string, maplibregl.Marker>();
  private poiPopup: maplibregl.Popup | null = null;
  private onMapClickFn?: () => void;
  private poiClickFn?: (e: any) => void;
  private onZoomFn?: () => void;
  private readonly POI_MIN_ZOOM = 9;   // landmarks appear from this zoom
  private sub?: Subscription;
  private placesSub?: Subscription;
  private geoWatchId: number | null = null;
  private errorShown = false;

  readonly palc = PALC_COORDS;

  // view state
  is3D        = signal(false);
  isSatellite = signal(false);
  locating    = signal(false);
  tracking    = signal(false);
  isMobile    = window.innerWidth < 992;

  // members + search
  members     = signal<DiasporaMember[]>([]);
  memberCount = computed(() => this.members().length);
  searchOpen  = signal(false);
  searchQuery = signal('');
  searchResults = computed<DiasporaMember[]>(() => {
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return [];
    return this.members().filter(m =>
      [m.name, m.username, m.place].some(f => f && f.toLowerCase().includes(q))
    ).slice(0, 8);
  });

  // selected member card
  selected = signal<DiasporaMember | null>(null);

  // add-yourself flow
  placing     = signal(false);        // crosshair placement mode
  modalOpen   = signal(false);
  resolving   = signal(false);        // reverse-geocoding in progress
  saving      = signal(false);
  pendingLat  = signal(0);
  pendingLng  = signal(0);
  pendingPlace = signal('');
  formName    = signal('');
  formUsername = signal('');
  formMessage = signal('');
  myPin       = signal<DiasporaMember | null>(null);

  isLoggedIn = this.auth.isLoggedIn;
  get isSelectedMe(): boolean {
    return this.selected()?.uid === this.auth.currentUser()?.uid;
  }

  /** Hide the permanent "Palçi" village pin while placing, so the only red
   *  marker on screen is the placement crosshair (avoids the two-pins confusion). */
  private readonly placingFx = effect(() => {
    const hidden = this.placing();
    const el = this.villageMarker?.getElement();
    if (el) el.style.display = hidden ? 'none' : '';
  });

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      // Reparent the pre-warmed map — instant if warm-up already ran.
      this.map = this.warmup.attach(this.mapContainer.nativeElement);
      this.map.touchZoomRotate.disableRotation();

      this.attribControl = new maplibregl.AttributionControl({ compact: true });
      this.map.addControl(this.attribControl, 'bottom-left');
      if (!this.isMobile) {
        this.navControl = new maplibregl.NavigationControl({ showCompass: false });
        this.map.addControl(this.navControl, 'bottom-right');
      }

      this.map.on('error', () => {
        if (this.errorShown) return;
        this.errorShown = true;
        this.zone.run(() => this.toast.info(this.translate.instant('map.tiles_fallback')));
      });

      // Tapping the map dismisses the search results and any open member card.
      this.onMapClickFn = () => this.zone.run(() => {
        if (this.searchQuery()) this.searchQuery.set('');
        if (this.searchOpen())  this.searchOpen.set(false);
        if (this.selected())    this.selected.set(null);
      });
      this.map.on('click', this.onMapClickFn);

      const start = () => {
        this.placeVillageMarker();
        this.watchMembers();
        this.addPoiLayer();
        this.watchPlaces();
        // Close the landmark popup when zooming out past where pins disappear.
        this.onZoomFn = () => {
          if ((this.map.getZoom() ?? 0) < this.POI_MIN_ZOOM) this.poiPopup?.remove();
        };
        this.map.on('zoom', this.onZoomFn);
      };
      if (this.warmup.ready) start();
      else this.map.once('load', () => this.zone.run(start));
    });

    // Load my existing pin (if any) so the add form can prefill / offer edit.
    this.loadMyPin();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.placesSub?.unsubscribe();
    if (this.geoWatchId !== null) navigator.geolocation.clearWatch(this.geoWatchId);
    if (this.onMapClickFn) this.map?.off('click', this.onMapClickFn);
    if (this.poiClickFn)   this.map?.off('click', 'poi-icons', this.poiClickFn);
    if (this.onZoomFn)     this.map?.off('zoom', this.onZoomFn);
    this.poiPopup?.remove();
    this.markers.forEach(m => m.remove());
    this.markers.clear();
    this.userMarker?.remove();
    this.villageMarker?.remove();
    // Strip everything we added, then keep the basemap warm for next visit.
    try {
      if (this.navControl)    this.map.removeControl(this.navControl);
      if (this.attribControl) this.map.removeControl(this.attribControl);
      for (const id of ['satellite', '3d-buildings', 'poi-icons']) {
        if (this.map.getLayer(id)) this.map.removeLayer(id);
      }
      if (this.map.getSource('satellite')) this.map.removeSource('satellite');
      if (this.map.getSource('poi'))       this.map.removeSource('poi');
      this.map.easeTo({ pitch: 0, bearing: 0, duration: 0 });
    } catch { /* style may be mid-load */ }
    this.warmup.detach();
  }

  @HostListener('window:resize')
  onResize(): void {
    this.isMobile = window.innerWidth < 992;
    this.zone.runOutsideAngular(() => this.map?.resize());
  }

  /* ── members ── */

  private watchMembers(): void {
    this.sub = this.fs.diasporaMembers$().subscribe(list => {
      this.zone.run(() => {
        this.members.set(list);
        this.syncMarkers(list);
        const me = this.auth.currentUser()?.uid;
        this.myPin.set(list.find(m => m.uid === me) ?? null);
      });
    });
  }

  private syncMarkers(list: DiasporaMember[]): void {
    const ids = new Set(list.map(m => m.uid));
    // remove stale
    for (const [uid, mk] of this.markers) {
      if (!ids.has(uid)) { mk.remove(); this.markers.delete(uid); }
    }
    // add / update
    for (const m of list) {
      if (typeof m.lat !== 'number' || typeof m.lng !== 'number') continue;
      const existing = this.markers.get(m.uid);
      if (existing) { existing.setLngLat([m.lng, m.lat]); continue; }
      const el = this.buildAvatarEl(m);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.placing()) return;      // don't hijack the placement flow
        this.zone.run(() => this.selectMember(m));
      });
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([m.lng, m.lat])
        .addTo(this.map);
      this.markers.set(m.uid, marker);
    }
  }

  private buildAvatarEl(m: DiasporaMember): HTMLElement {
    const initial = (m.name || '?').trim().charAt(0).toUpperCase() || '?';
    const el = document.createElement('div');
    el.className = 'dia-pin';

    const av = document.createElement('span');
    av.className = 'dia-pin-av';

    const fallback = () => {
      av.textContent = initial;
      av.classList.add('dia-pin-initial');
    };

    if (m.photoURL) {
      const img = document.createElement('img');
      img.className = 'dia-pin-img';
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => { av.innerHTML = ''; fallback(); });
      img.src = m.photoURL;
      av.appendChild(img);
    } else {
      fallback();
    }

    const tail = document.createElement('span');
    tail.className = 'dia-pin-tail';
    el.appendChild(av);
    el.appendChild(tail);
    return el;
  }

  /* ── landmarks (POIs from OSM) — rendered as a GPU symbol layer ──
     A symbol layer stays perfectly locked to the map while panning/zooming
     (unlike DOM markers, which lag), and MapLibre's built-in collision
     detection means labels never overlap: the important ones show first and
     more appear as you zoom in. */

  private addPoiLayer(): void {
    if (this.map.getSource('poi')) return;
    this.map.addSource('poi', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } as any);
    this.map.addLayer({
      id: 'poi-icons',
      type: 'symbol',
      source: 'poi',
      minzoom: this.POI_MIN_ZOOM,
      layout: {
        'icon-image': ['concat', 'poi-', ['get', 'category']],
        // Grows as you approach: small and unobtrusive from afar, roughly twice
        // the size once you're zoomed in over the location itself.
        'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 13, 1.1, 15, 1.6, 17, 2],
        'icon-allow-overlap': false,     // ← collision: pins never stack
        'icon-optional': false,
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 13, 12, 17, 15],
        // In ems of text-size, so the label keeps clear of the growing icon
        'text-offset': [0, 1.8],
        'text-anchor': 'top',
        'text-optional': true,           // drop the label before hiding the icon
        'text-allow-overlap': false,
        'symbol-sort-key': ['get', 'rank'],   // lower rank = more important = wins
      },
      paint: {
        'text-color': '#2b2519',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.6,
      },
    } as any);

    this.poiClickFn = (e: any) => {
      if (this.placing()) return;        // ignore landmark taps while placing
      const f = e.features?.[0];
      if (!f) return;
      const coords = (f.geometry as any).coordinates as [number, number];
      const props = f.properties || {};
      this.zone.runOutsideAngular(() =>
        this.openPoiPopup({ name: props.name, category: props.category, emoji: props.emoji, lng: coords[0], lat: coords[1] }));
    };
    this.map.on('click', 'poi-icons', this.poiClickFn);
    this.map.on('mouseenter', 'poi-icons', () => (this.map.getCanvas().style.cursor = 'pointer'));
    this.map.on('mouseleave', 'poi-icons', () => (this.map.getCanvas().style.cursor = ''));
  }

  private watchPlaces(): void {
    this.placesSub = this.fs.places$().subscribe(list => {
      this.zone.runOutsideAngular(() => { this.renderPoi(list).catch(() => {}); });
    });
  }

  private async renderPoi(list: Place[]): Promise<void> {
    if (!this.map.getSource('poi')) return;
    // Icons must exist before the layer references them.
    await this.ensureIcons(list);
    if (!this.map.getSource('poi')) return;   // page left while loading
    const features = list
      .filter(p => typeof p.lat === 'number' && typeof p.lng === 'number')
      .map(p => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
        properties: { name: p.name, category: p.category, emoji: p.emoji, rank: p.rank ?? 50 },
      }));
    (this.map.getSource('poi') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features } as any);
  }

  /**
   * White vector silhouettes drawn inside a 48×48 viewBox — NOT emoji.
   * Emoji rendered to a canvas sit at different offsets on Android, iOS and
   * desktop (each platform ships its own emoji font with its own metrics), which
   * is why the icons drifted into the corner on phones. These paths are pure
   * geometry, so every device draws them identically and perfectly centred.
   */
  private static readonly GLYPHS: Record<string, string> = {
    ferry:      'M9 28h30l-5 9H14zM18 13h12v13H18zM23 7h2v6h-2z',
    lodging:    'M9 19h5v9h25v10h-5v-5H14v5H9zM18 21h7v5h-7z',
    worship:    'M21 8h6v10h10v6H27v16h-6V24H11v-6h10z',
    historic:   'M10 10h28v5H10zM16 17h4v16h-4zM28 17h4v16h-4zM10 35h28v5H10z',
    attraction: 'M24 8l5 11 12 1.5-9 8L34.5 41 24 34.5 13.5 41 16 28.5l-9-8L19 19z',
    viewpoint:  'M24 14c-9 0-15 10-15 10s6 10 15 10 15-10 15-10-6-10-15-10zm0 15a5 5 0 1 1 0-10 5 5 0 0 1 0 10z',
    food:       'M16 8v12h-2V8h-3v12a5 5 0 0 0 4 5v15h4V25a5 5 0 0 0 4-5V8h-3v12h-2V8zM32 8c-3 2-4 8-4 12s1 5 3 5v15h4V8z',
    peak:       'M6 38 20 14l8 13 4-6 10 17z',
    spring:     'M24 8s11 12 11 19a11 11 0 0 1-22 0c0-7 11-19 11-19z',
    waterfall:  'M24 8s11 12 11 19a11 11 0 0 1-22 0c0-7 11-19 11-19z',
    water:      'M24 8s11 12 11 19a11 11 0 0 1-22 0c0-7 11-19 11-19z',
    cave:       'M8 40V26a16 16 0 0 1 32 0v14h-8V26a8 8 0 0 0-16 0v14z',
    health:     'M20 8h8v12h12v8H28v12h-8V28H8v-8h12z',
    school:     'M8 12h14a5 5 0 0 1 2 4v22a5 5 0 0 0-2-2H8zM40 12H26a5 5 0 0 0-2 4v22a5 5 0 0 1 2-2h14z',
    fuel:       'M15 13h14a2 2 0 0 1 2 2v22H13V15a2 2 0 0 1 2-2zm3 4v6h8v-6zm16 5 3.5 3.5V33a3 3 0 0 1-6 0v-5h2v5a1 1 0 0 0 2 0v-6.2L34 24z',
    shop:       'M16 16v-2a8 8 0 0 1 16 0v2h6v22H10V16zm4 0h8v-2a4 4 0 0 0-8 0z',
    camp:       'M24 10 42 38H28l-4-8-4 8H6z',
    leisure:    'M24 8l10 14h-6l8 12H26v6h-4v-6H12l8-12h-6z',
    tower:      'M18 8h12v6l-2 4v20h-8V18l-2-4zM13 38h22v5H13z',
    place:      'M24 9 41 24h-5v15h-8V29h-8v10h-8V24H8z',
  };

  private iconsLoaded = new Set<string>();

  /** Build every category icon this dataset needs, once. */
  private async ensureIcons(list: Place[]): Promise<void> {
    const cats = new Map<string, string>();
    for (const p of list) {
      if (!cats.has(p.category)) cats.set(p.category, p.color || '#7a5c28');
    }
    await Promise.all([...cats].map(([cat, color]) => this.addCategoryIcon(cat, color)));
  }

  private addCategoryIcon(category: string, color: string): Promise<void> {
    const id = `poi-${category}`;
    if (this.iconsLoaded.has(id) || this.map.hasImage(id)) return Promise.resolve();
    this.iconsLoaded.add(id);

    const glyph = MapComponent.GLYPHS[category] ?? MapComponent.GLYPHS['place'];
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">` +
      `<circle cx="24" cy="24" r="20" fill="${color}" stroke="#ffffff" stroke-width="3"/>` +
      `<path fill="#ffffff" d="${glyph}" transform="translate(24 24) scale(0.62) translate(-24 -24)"/>` +
      `</svg>`;

    return new Promise<void>((resolve) => {
      const img = new Image(48, 48);
      img.onload = () => {
        if (!this.map.hasImage(id)) {
          try { this.map.addImage(id, img, { pixelRatio: 2 } as any); } catch { /* raced */ }
        }
        resolve();
      };
      img.onerror = () => { this.iconsLoaded.delete(id); resolve(); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  private openPoiPopup(p: { name: string; category: string; emoji: string; lat: number; lng: number }): void {
    this.poiPopup?.remove();
    const cat = this.translate.instant('map.cat.' + p.category);
    const catLabel = cat === 'map.cat.' + p.category ? '' : cat;
    const wrap = document.createElement('div');
    wrap.className = 'poi-pop';
    const emo = document.createElement('div'); emo.className = 'poi-pop-emoji'; emo.textContent = p.emoji || '📍';
    const nm  = document.createElement('div'); nm.className  = 'poi-pop-name';  nm.textContent  = p.name || '';
    wrap.appendChild(emo); wrap.appendChild(nm);
    if (catLabel) { const c = document.createElement('div'); c.className = 'poi-pop-cat'; c.textContent = catLabel; wrap.appendChild(c); }
    this.poiPopup = new maplibregl.Popup({ offset: 20, closeButton: false, className: 'poi-popup' })
      .setLngLat([p.lng, p.lat])
      .setDOMContent(wrap)
      .addTo(this.map);
  }

  selectMember(m: DiasporaMember): void {
    this.selected.set(m);
    this.searchOpen.set(false);
    this.searchQuery.set('');        // close the results dropdown after picking
    this.zone.runOutsideAngular(() =>
      this.map?.flyTo({ center: [m.lng, m.lat], zoom: Math.max(this.map.getZoom(), 11), speed: 1.4 })
    );
  }

  closeCard(): void { this.selected.set(null); }

  /* ── search ── */

  toggleSearch(): void {
    this.searchOpen.update(v => !v);
    if (!this.searchOpen()) this.searchQuery.set('');
  }
  onSearch(v: string): void { this.searchQuery.set(v); }
  clearSearch(): void { this.searchQuery.set(''); }

  /* ── village marker ── */

  private placeVillageMarker(): void {
    const el = document.createElement('div');
    el.className = 'palc-pin';
    el.innerHTML = '<span class="palc-pin-dot"></span><span class="palc-pin-label">Palçi 🏔️</span>';
    this.villageMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([this.palc.lng, this.palc.lat])
      .addTo(this.map);
  }

  /* ── controls ── */

  recenter(): void {
    this.zone.runOutsideAngular(() =>
      this.map?.flyTo({ center: [this.palc.lng, this.palc.lat], zoom: 12, pitch: this.is3D() ? 55 : 0, speed: 1.4 })
    );
  }

  toggle3D(): void {
    const on = !this.is3D();
    this.is3D.set(on);
    this.zone.runOutsideAngular(() => {
      if (!this.map) return;
      if (on) {
        this.add3DBuildings();
        this.map.touchZoomRotate.enableRotation();
        this.map.easeTo({ pitch: 55, duration: 600 });
      } else {
        if (this.map.getLayer('3d-buildings')) this.map.removeLayer('3d-buildings');
        this.map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
        this.map.touchZoomRotate.disableRotation();
      }
    });
  }

  private add3DBuildings(): void {
    if (!this.map || this.map.getLayer('3d-buildings')) return;
    if (!this.map.getSource('openmaptiles')) return;
    this.map.addLayer({
      id: '3d-buildings',
      source: 'openmaptiles',
      'source-layer': 'building',
      type: 'fill-extrusion',
      minzoom: 14,
      paint: {
        'fill-extrusion-color': '#cdbf9c',
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.85,
      },
    } as any);
  }

  toggleSatellite(): void {
    const on = !this.isSatellite();
    this.isSatellite.set(on);
    this.zone.runOutsideAngular(() => {
      if (!this.map) return;
      if (on) {
        if (!this.map.getSource('satellite')) {
          this.map.addSource('satellite', {
            type: 'raster',
            tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
          } as any);
        }
        if (!this.map.getLayer('satellite')) {
          this.map.addLayer({ id: 'satellite', type: 'raster', source: 'satellite' } as any, this.firstSymbolLayerId());
        }
      } else if (this.map.getLayer('satellite')) {
        this.map.removeLayer('satellite');
      }
    });
  }

  private firstSymbolLayerId(): string | undefined {
    const layers = this.map?.getStyle()?.layers || [];
    for (const l of layers) if (l.type === 'symbol') return l.id;
    return undefined;
  }

  /* ── geolocation ── */

  locateMe(): void {
    if (!navigator.geolocation) { this.toast.info(this.translate.instant('map.no_geo')); return; }
    this.locating.set(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.zone.run(() => this.locating.set(false));
        const { latitude, longitude } = pos.coords;
        this.setUserMarker(latitude, longitude);
        this.zone.runOutsideAngular(() => this.map?.flyTo({ center: [longitude, latitude], zoom: 12, speed: 1.6 }));
      },
      () => this.zone.run(() => { this.locating.set(false); this.toast.info(this.translate.instant('map.geo_denied')); }),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  /** Live location tracking (watchPosition) — toggled on/off, needs permission. */
  toggleTracking(): void {
    if (this.tracking()) {
      if (this.geoWatchId !== null) { navigator.geolocation.clearWatch(this.geoWatchId); this.geoWatchId = null; }
      this.tracking.set(false);
      return;
    }
    if (!navigator.geolocation) { this.toast.info(this.translate.instant('map.no_geo')); return; }
    this.tracking.set(true);
    this.geoWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        this.setUserMarker(latitude, longitude);
      },
      () => this.zone.run(() => { this.tracking.set(false); this.toast.info(this.translate.instant('map.geo_denied')); }),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 12000 }
    );
    this.toast.info(this.translate.instant('map.tracking_on'));
  }

  private setUserMarker(lat: number, lng: number): void {
    if (this.userMarker) { this.userMarker.setLngLat([lng, lat]); return; }
    const el = document.createElement('div');
    el.className = 'map-user-dot';
    this.userMarker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(this.map);
  }

  /* ── add yourself flow ── */

  startPlacing(): void {
    if (!this.isLoggedIn()) {
      this.toast.info(this.translate.instant('map.login_to_add'));
      this.router.navigate(['/login']);
      return;
    }
    this.selected.set(null);
    this.searchOpen.set(false);
    this.poiPopup?.remove();
    // Start over my existing pin if I have one, else over the current view.
    const mine = this.myPin();
    if (mine) this.zone.runOutsideAngular(() => this.map?.flyTo({ center: [mine.lng, mine.lat], zoom: 13, speed: 1.2 }));
    this.placing.set(true);
  }

  cancelPlacing(): void {
    this.placing.set(false);
    this.recenter();          // always return the view to Palç after cancelling
  }

  /** Snap the pending point to my current GPS position (with permission). */
  usePreciseLocation(): void {
    if (!navigator.geolocation) { this.toast.info(this.translate.instant('map.no_geo')); return; }
    this.locating.set(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.zone.run(() => this.locating.set(false));
        const { latitude, longitude } = pos.coords;
        this.zone.runOutsideAngular(() =>
          this.map?.flyTo({ center: [longitude, latitude], zoom: 15, speed: 1.8 })
        );
      },
      () => this.zone.run(() => { this.locating.set(false); this.toast.info(this.translate.instant('map.geo_denied')); }),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  /** Capture the map centre as the chosen coordinates, then reverse-geocode. */
  confirmPlacement(): void {
    const c = this.map.getCenter();
    this.pendingLat.set(+c.lat.toFixed(6));
    this.pendingLng.set(+c.lng.toFixed(6));
    this.placing.set(false);

    // Prefill identity from profile / existing pin
    const mine = this.myPin();
    this.formName.set(mine?.name || this.auth.publicDisplayName || '');
    this.formUsername.set(mine?.username || '');
    this.formMessage.set(mine?.message || '');

    this.modalOpen.set(true);
    this.reverseGeocode(c.lat, c.lng);
  }

  private async reverseGeocode(lat: number, lng: number): Promise<void> {
    this.resolving.set(true);
    this.pendingPlace.set('');
    try {
      const lang = this.translate.currentLang === 'en' ? 'en' : 'sq';
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=12&accept-language=${lang}`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      const data = await res.json();
      const a = data?.address ?? {};
      const town = a.city || a.town || a.village || a.municipality || a.county || a.state || '';
      const country = a.country || '';
      const label = [town, country].filter(Boolean).join(', ');
      this.zone.run(() => this.pendingPlace.set(label || data?.display_name || ''));
    } catch {
      this.zone.run(() => this.pendingPlace.set(''));
    } finally {
      this.zone.run(() => this.resolving.set(false));
    }
  }

  closeModal(): void { this.modalOpen.set(false); }

  async saveMe(): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;
    const name = this.formName().trim();
    if (name.length < 2) { this.toast.error(this.translate.instant('map.name_required')); return; }
    this.saving.set(true);
    try {
      await this.fs.setMyDiasporaPin(uid, {
        name,
        username: this.formUsername().trim() || undefined,
        photoURL: this.auth.userProfile()?.photoURL || this.auth.currentUser()?.photoURL || undefined,
        place: this.pendingPlace() || undefined,
        message: this.formMessage().trim() || undefined,
        lat: this.pendingLat(),
        lng: this.pendingLng(),
      } as any);
      this.toast.success(this.translate.instant('map.saved'));
      this.modalOpen.set(false);
      this.zone.runOutsideAngular(() =>
        this.map?.flyTo({ center: [this.pendingLng(), this.pendingLat()], zoom: 11, speed: 1.2 })
      );
    } catch {
      this.toast.error(this.translate.instant('toast.error_saving'));
    } finally {
      this.saving.set(false);
    }
  }

  async removeMe(): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;
    try {
      await this.fs.removeMyDiasporaPin(uid);
      this.toast.info(this.translate.instant('map.removed'));
      this.selected.set(null);
    } catch {
      this.toast.error(this.translate.instant('toast.error_generic'));
    }
  }

  private async loadMyPin(): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;
    const pin = await this.fs.getMyDiasporaPin(uid).catch(() => null);
    if (pin) this.myPin.set(pin);
  }
}
