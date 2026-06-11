import { Injectable, signal } from '@angular/core';
import { Toast } from '../models';

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);

  private add(type: Toast['type'], message: string) {
    const id = Math.random().toString(36).slice(2);
    this.toasts.update(list => [...list, { id, type, message }]);
    setTimeout(() => this.remove(id), 4000);
  }

  success(message: string)  { this.add('success', message); }
  error(message: string)    { this.add('error', message); }
  warning(message: string)  { this.add('warning', message); }
  info(message: string)     { this.add('info', message); }

  remove(id: string) {
    this.toasts.update(list => list.filter(t => t.id !== id));
  }
}
