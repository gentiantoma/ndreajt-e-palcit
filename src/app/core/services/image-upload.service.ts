import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

const MAX_WIDTH = 1920;
const QUALITY   = 0.85;

@Injectable({ providedIn: 'root' })
export class ImageUploadService {
  private http = inject(HttpClient);

  async compress(file: File): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width > MAX_WIDTH) {
          height = Math.round((height * MAX_WIDTH) / width);
          width = MAX_WIDTH;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')),
          'image/webp',
          QUALITY
        );
      };
      img.onerror = () => reject(new Error('Image load error'));
      img.src = url;
    });
  }

  async upload(file: File): Promise<string> {
    const blob = await this.compress(file);
    const webpFile = new File([blob], file.name.replace(/\.[^.]+$/, '.webp'), { type: 'image/webp' });
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
