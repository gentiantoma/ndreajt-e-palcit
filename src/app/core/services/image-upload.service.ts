import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

/*
 * Upload pipeline: every image is resized + re-encoded to WebP on the
 * client BEFORE it ever reaches ImgBB, so the CDN serves small files
 * and the feed loads fast even on slow village connections.
 *
 * - Max edge 1600px (covers retina at the widest card/detail width)
 * - Quality steps down until the file fits the target byte budget
 * - EXIF orientation is respected via createImageBitmap when available
 * - Already-small WebP files are passed through untouched
 */
const MAX_EDGE          = 1600;
const TARGET_BYTES      = 320 * 1024;   // ~320 KB budget per photo
const QUALITY_STEPS     = [0.82, 0.72, 0.62, 0.5];
const SKIP_IF_SMALLER   = 150 * 1024;   // small WebP input → upload as-is

@Injectable({ providedIn: 'root' })
export class ImageUploadService {
  private http = inject(HttpClient);

  /** Decode with correct EXIF orientation; fall back to <img> decoding. */
  private async decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
    if ('createImageBitmap' in window) {
      try {
        return await createImageBitmap(file, { imageOrientation: 'from-image' } as any);
      } catch { /* Safari < 15 or odd formats — fall through */ }
    }
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load error')); };
      img.src = url;
    });
  }

  private toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) =>
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas toBlob failed')), 'image/webp', quality)
    );
  }

  async compress(file: File): Promise<Blob> {
    // Already an optimized small WebP — don't recompress (avoids quality loss)
    if (file.type === 'image/webp' && file.size <= SKIP_IF_SMALLER) return file;

    const source = await this.decode(file);
    const srcW = 'width'  in source ? source.width  : 0;
    const srcH = 'height' in source ? source.height : 0;

    const scale  = Math.min(1, MAX_EDGE / Math.max(srcW, srcH));
    const width  = Math.max(1, Math.round(srcW * scale));
    const height = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);
    if ('close' in source) (source as ImageBitmap).close();

    // Step quality down until the image fits the byte budget
    let blob = await this.toBlob(canvas, QUALITY_STEPS[0]);
    for (let i = 1; i < QUALITY_STEPS.length && blob.size > TARGET_BYTES; i++) {
      blob = await this.toBlob(canvas, QUALITY_STEPS[i]);
    }
    // If WebP encoding somehow inflated a tiny original, keep the original
    return blob.size < file.size || file.type !== 'image/webp' ? blob : file;
  }

  async upload(file: File): Promise<string> {
    const blob = await this.compress(file);
    const webpFile = new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
    const form = new FormData();
    form.append('image', webpFile);
    form.append('key', environment.imgbbApiKey);
    const res: any = await firstValueFrom(this.http.post('https://api.imgbb.com/1/upload', form));
    return res.data.url as string;
  }

  async uploadAll(files: File[]): Promise<string[]> {
    return Promise.all(files.map(f => this.upload(f)));
  }

  previewUrl(file: File): string {
    return URL.createObjectURL(file);
  }
}
