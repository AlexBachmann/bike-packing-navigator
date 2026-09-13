import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationTab } from '../../models/settings.model';

@Component({
  selector: 'app-bottom-nav',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './bottom-nav.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block'
  }
})
export class BottomNavComponent {
  readonly activeTab = input.required<NavigationTab>();
  readonly tabChange = output<NavigationTab>();

  onTabClick(tab: NavigationTab): void {
    this.tabChange.emit(tab);
  }
}
