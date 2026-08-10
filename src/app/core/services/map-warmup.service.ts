import { Injectable, NgZone, inject } from '@angular/core';
import maplibregl from 'maplibre-gl';
import { PALC_COORDS } from './weather.service';

/** Free OpenFreeMap vector basemap — same look as the fuel app, no API key. */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/**
 * Keeps ONE MapLibre instance alive for the whole session so /map opens
 * instantly.
 *
 * `warmUp()` builds the map in a detached, off-screen host while the user is
 * still elsewhere — style, glyphs, sprite and the first tiles all download up
 * front. Opening the map page then just re-parents the already-rendered canvas.
 * Modeled on the fuel app's warm-up service.
 */
@Injectable({ providedIn: 'root' })
export class MapWarmupService {
  private zone = inject(NgZone);
  private container: HTMLDivElement | null = null;
  map: maplibregl.Map | null = null;
  ready = false;

  warmUp(center = { lat: PALC_COORDS.lat, lng: PALC_COORDS.lng, zoom: 10 }): void {
    if (this.map) return;
    this.container = document.createElement('div');
    this.container.style.width = '100%';
    this.container.style.height = '100%';

    const ghost = document.createElement('div');
    ghost.style.cssText =
      'position:fixed;left:-10000px;top:0;width:100vw;height:100vh;pointer-events:none;visibility:hidden;';
    ghost.appendChild(this.container);
    document.body.appendChild(ghost);

    // Build outside Angular's zone — MapLibre's rAF render loop must never
    // trigger change detection (it would spin into a freeze).
    this.zone.runOutsideAngular(() => {
      this.map = new maplibregl.Map({
        container: this.container!,
        style: MAP_STYLE_URL,
        center: [center.lng, center.lat],
        zoom: center.zoom,
        attributionControl: false,
        fadeDuration: 0,
        failIfMajorPerformanceCaveat: false,
      });
      this.map.on('load', () => (this.ready = true));
    });
  }

  /** Move the warm map into the page host (creating it if warm-up never ran). */
  attach(host: HTMLElement): maplibregl.Map {
    this.warmUp();
    const ghost = this.container!.parentElement;
    host.appendChild(this.container!);
    if (ghost && ghost !== host && ghost.parentElement === document.body) {
      document.body.removeChild(ghost);
    }
    this.zone.runOutsideAngular(() => this.map!.resize());
    return this.map!;
  }

  /** Detach from the page but keep the instance (and its tiles) warm. */
  detach(): void {
    if (!this.container || !this.map) return;
    const ghost = document.createElement('div');
    ghost.style.cssText =
      'position:fixed;left:-10000px;top:0;width:100vw;height:100vh;pointer-events:none;visibility:hidden;';
    ghost.appendChild(this.container);
    document.body.appendChild(ghost);
  }
}
