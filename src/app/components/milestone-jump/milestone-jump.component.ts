import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DistanceUnit } from '../../models/settings.model';
import { MAJOR_MILESTONES, Milestone } from '../../models/waypoint.model';
import { RouteDataService } from '../../services/route-data.service';

@Component({
  selector: 'app-milestone-jump',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './milestone-jump.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block'
  }
})
export class MilestoneJumpComponent {
  private readonly routeService = inject(RouteDataService);

  readonly unit = input<DistanceUnit>('miles');
  readonly customMilestones = input<Milestone[] | null>(null, { alias: 'milestones' });

  readonly milestones = computed<Milestone[]>(() => {
    const inputM = this.customMilestones();
    if (inputM && inputM.length > 0) return inputM;
    const serviceM = this.routeService.milestones();
    if (serviceM && serviceM.length > 0) return serviceM;
    return MAJOR_MILESTONES;
  });

  readonly jumpToMilestone = output<number>();
  readonly simulateGps = output<{ lat: number; lon: number }>();

  onMilestoneClick(mile: number): void {
    this.jumpToMilestone.emit(mile);
  }

  onSimulateGps(lat: number, lon: number): void {
    this.simulateGps.emit({ lat, lon });
  }
}
