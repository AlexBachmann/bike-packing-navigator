import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink],
  templateUrl: './app.component.html',
})
export class AppComponent {
  title = 'Bikepack Navigator';
  readonly pwaUrl = '/bike-packing-navigator/';
  readonly mobileMenuOpen = signal(false);

  toggleMobileMenu(): void {
    this.mobileMenuOpen.update((val) => !val);
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }
}
