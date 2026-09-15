import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface OffCourseAlertStatus {
  isOffCourse: boolean;
  distanceMeters: number;
  displayText: string;
  returnBearingDeg: number;
}

@Component({
  selector: 'app-ride-off-course-banner',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (offCourseStatus().isOffCourse) {
      <div
        data-testid="off-course-banner"
        role="alert"
        class="pointer-events-auto max-w-[90%] bg-rose-950/95 backdrop-blur-md border border-rose-500/70 text-rose-100 px-4 py-2 rounded-2xl shadow-2xl flex items-center gap-3 text-xs font-semibold tracking-wide animate-in fade-in slide-in-from-top-2 duration-200"
      >
        <span class="text-base text-rose-400 shrink-0">⚠️</span>
        <span class="flex-1">{{ offCourseStatus().displayText }}</span>
        <div class="flex items-center gap-1.5 pl-2 border-l border-rose-500/30 text-[11px] text-rose-300">
          <span>Return</span>
          <svg
            class="w-4 h-4 text-rose-400 transition-transform duration-200"
            [style.transform]="'rotate(' + relativeReturnAngle() + 'deg)'"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'contents'
  }
})
export class RideOffCourseBannerComponent {
  readonly offCourseStatus = input.required<OffCourseAlertStatus>();
  readonly relativeReturnAngle = input<number>(0);
}
