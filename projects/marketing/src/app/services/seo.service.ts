import { Injectable, inject } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';

export interface SeoConfig {
  title: string;
  description: string;
  urlPath?: string;
  imageUrl?: string;
  keywords?: string;
}

const BASE_URL = 'https://alexbachmann.github.io/bike-packing-navigator/welcome/';
const DEFAULT_IMAGE =
  'https://alexbachmann.github.io/bike-packing-navigator/welcome/assets/images/og-preview.jpg';

@Injectable({
  providedIn: 'root',
})
export class SeoService {
  private titleService = inject(Title);
  private metaService = inject(Meta);

  setMeta(config: SeoConfig): void {
    const fullTitle = `${config.title} | Bikepack Navigator`;
    this.titleService.setTitle(fullTitle);

    const fullUrl = config.urlPath ? `${BASE_URL}${config.urlPath.replace(/^\//, '')}` : BASE_URL;
    const imageUrl = config.imageUrl || DEFAULT_IMAGE;

    this.metaService.updateTag({ name: 'description', content: config.description });
    if (config.keywords) {
      this.metaService.updateTag({ name: 'keywords', content: config.keywords });
    }

    // OpenGraph
    this.metaService.updateTag({ property: 'og:title', content: fullTitle });
    this.metaService.updateTag({ property: 'og:description', content: config.description });
    this.metaService.updateTag({ property: 'og:url', content: fullUrl });
    this.metaService.updateTag({ property: 'og:image', content: imageUrl });
    this.metaService.updateTag({ property: 'og:type', content: 'website' });

    // Twitter
    this.metaService.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
    this.metaService.updateTag({ name: 'twitter:title', content: fullTitle });
    this.metaService.updateTag({ name: 'twitter:description', content: config.description });
    this.metaService.updateTag({ name: 'twitter:url', content: fullUrl });
    this.metaService.updateTag({ name: 'twitter:image', content: imageUrl });
  }
}
