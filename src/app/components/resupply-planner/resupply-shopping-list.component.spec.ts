import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ResupplyShoppingListComponent } from './resupply-shopping-list.component';
import { DepartmentGroup } from '../../models/resupply.model';

describe('ResupplyShoppingListComponent', () => {
  let component: ResupplyShoppingListComponent;
  let fixture: ComponentFixture<ResupplyShoppingListComponent>;

  const mockGroups: DepartmentGroup[] = [
    {
      department: 'Bakery',
      items: [
        {
          id: 'tortilla__item',
          name: 'Tortilla',
          totalQuantity: 4,
          unit: 'item',
          department: 'Bakery',
          checked: false
        },
        {
          id: 'bagel__item',
          name: 'Bagel',
          totalQuantity: 2,
          unit: 'item',
          department: 'Bakery',
          checked: true
        }
      ]
    },
    {
      department: 'Beverages',
      items: [
        {
          id: 'electrolyte_powder__scoop',
          name: 'Electrolyte Powder',
          totalQuantity: 6,
          unit: 'scoop',
          department: 'Beverages',
          checked: false
        }
      ]
    }
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ResupplyShoppingListComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(ResupplyShoppingListComponent);
    component = fixture.componentInstance;
  });

  it('should create the component', () => {
    fixture.componentRef.setInput('departmentGroups', []);
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should render empty state when departmentGroups is empty and emit openBuilder', () => {
    fixture.componentRef.setInput('departmentGroups', []);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('No items in your shopping list yet');

    let openBuilderEmitted = false;
    component.openBuilder.subscribe(() => {
      openBuilderEmitted = true;
    });

    const openBtn = Array.from(compiled.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.includes('Open Resupply Plan'));
    expect(openBtn).toBeDefined();
    openBtn!.click();
    expect(openBuilderEmitted).toBe(true);
  });

  it('should render department headers with icons, names, and item counts', () => {
    fixture.componentRef.setInput('departmentGroups', mockGroups);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Bakery');
    expect(compiled.textContent).toContain('2 items');
    expect(compiled.textContent).toContain('Beverages');
    expect(compiled.textContent).toContain('1 items');
  });

  it('should render items with quantity, unit, and name', () => {
    fixture.componentRef.setInput('departmentGroups', mockGroups);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Tortilla');
    expect(compiled.textContent).toContain('4 item');
    expect(compiled.textContent).toContain('Bagel');
    expect(compiled.textContent).toContain('2 item');
  });

  it('should emit toggleItemChecked with item id when checkbox is clicked', () => {
    fixture.componentRef.setInput('departmentGroups', mockGroups);
    fixture.detectChanges();

    let toggledId = '';
    component.toggleItemChecked.subscribe((id) => {
      toggledId = id;
    });

    const checkboxes = fixture.nativeElement.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
    checkboxes[0].dispatchEvent(new Event('change'));
    expect(toggledId).toBe('tortilla__item');
  });

  it('should apply line-through and muted styles to checked items', () => {
    fixture.componentRef.setInput('departmentGroups', mockGroups);
    fixture.detectChanges();

    const labels = fixture.nativeElement.querySelectorAll('label') as NodeListOf<HTMLLabelElement>;
    expect(labels[0].className).toContain('text-slate-200');
    expect(labels[1].className).toContain('line-through');
  });

  it('should conditionally render Uncheck All button and emit uncheckAllItems on click', () => {
    fixture.componentRef.setInput('departmentGroups', mockGroups);
    fixture.componentRef.setInput('hasCheckedItems', false);
    fixture.detectChanges();

    let uncheckBtn = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.includes('Uncheck All'));
    expect(uncheckBtn).toBeUndefined();

    fixture.componentRef.setInput('hasCheckedItems', true);
    fixture.detectChanges();

    uncheckBtn = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.includes('Uncheck All'));
    expect(uncheckBtn).toBeDefined();

    let uncheckEmitted = false;
    component.uncheckAllItems.subscribe(() => {
      uncheckEmitted = true;
    });
    uncheckBtn!.click();
    expect(uncheckEmitted).toBe(true);
  });

  it('should emit copyShoppingList when Copy Shopping List button is clicked', () => {
    fixture.componentRef.setInput('departmentGroups', mockGroups);
    fixture.detectChanges();

    let copyEmitted = false;
    component.copyShoppingList.subscribe(() => {
      copyEmitted = true;
    });

    const copyBtn = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.includes('Copy Shopping List'));
    expect(copyBtn).toBeDefined();
    copyBtn!.click();
    expect(copyEmitted).toBe(true);
  });
});
