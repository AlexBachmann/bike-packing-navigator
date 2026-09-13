import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AVAILABLE_CATEGORIES, CategoryItem } from '../../models/waypoint.model';

@Component({
  selector: 'app-category-filter',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './category-filter.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block'
  }
})
export class CategoryFilterComponent {
  readonly selectedCategories = input.required<Set<string>>();
  readonly availableCategories = input<CategoryItem[]>(AVAILABLE_CATEGORIES);
  readonly holdingCategory = input<string | null>(null);

  readonly selectAll = output<void>();
  readonly categoryClick = output<{ category: string; event: MouseEvent }>();
  readonly pointerDown = output<{ category: string; event: PointerEvent }>();
  readonly pointerUp = output<PointerEvent>();
  readonly pointerMove = output<PointerEvent>();
  readonly cancelPress = output<void>();

  onSelectAll(): void {
    this.selectAll.emit();
  }

  onCategoryClick(category: string, event: MouseEvent): void {
    this.categoryClick.emit({ category, event });
  }

  onPointerDown(category: string, event: PointerEvent): void {
    this.pointerDown.emit({ category, event });
  }

  onPointerUp(event: PointerEvent): void {
    this.pointerUp.emit(event);
  }

  onPointerMove(event: PointerEvent): void {
    this.pointerMove.emit(event);
  }

  onCancelPress(): void {
    this.cancelPress.emit();
  }
}
