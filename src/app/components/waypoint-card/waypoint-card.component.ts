import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WaypointViewModel, getCategoryBadge } from '../../models/waypoint.model';
import { DistanceUnit } from '../../models/settings.model';

@Component({
  selector: 'app-waypoint-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './waypoint-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block'
  }
})
export class WaypointCardComponent {
  readonly waypoint = input.required<WaypointViewModel>();
  readonly unit = input<DistanceUnit>('miles');

  readonly categoryBadge = computed(() => getCategoryBadge(this.waypoint().category));
}
