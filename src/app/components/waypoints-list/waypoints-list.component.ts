import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WaypointViewModel } from '../../models/waypoint.model';
import { DistanceUnit } from '../../models/settings.model';
import { WaypointCardComponent } from '../waypoint-card/waypoint-card.component';

@Component({
  selector: 'app-waypoints-list',
  standalone: true,
  imports: [CommonModule, FormsModule, WaypointCardComponent],
  templateUrl: './waypoints-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block'
  }
})
export class WaypointsListComponent {
  readonly waypoints = input.required<WaypointViewModel[]>();
  readonly unit = input<DistanceUnit>('miles');
  readonly currentMile = input.required<number>();
  readonly isLoading = input<boolean>(false);
  readonly error = input<string | null>(null);
  readonly searchQuery = model<string>('');

  clearSearch(): void {
    this.searchQuery.set('');
  }
}
