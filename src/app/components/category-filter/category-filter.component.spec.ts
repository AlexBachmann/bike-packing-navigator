import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CategoryFilterComponent } from './category-filter.component';
import { AVAILABLE_CATEGORIES } from '../../models/waypoint.model';

describe('CategoryFilterComponent', () => {
  let component: CategoryFilterComponent;
  let fixture: ComponentFixture<CategoryFilterComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CategoryFilterComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(CategoryFilterComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('selectedCategories', new Set(['town', 'grocery']));
    fixture.componentRef.setInput('availableCategories', AVAILABLE_CATEGORIES);
    fixture.componentRef.setInput('holdingCategory', null);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render All button and category buttons', () => {
    const el = fixture.nativeElement as HTMLElement;
    const buttons = el.querySelectorAll('button');
    // 1 "All" button + 10 category buttons = 11 buttons
    expect(buttons.length).toBe(11);
    expect(buttons[0].textContent?.trim()).toBe('All');
  });

  it('should emit selectAll when All button is clicked', () => {
    let fired = false;
    component.selectAll.subscribe(() => {
      fired = true;
    });

    const el = fixture.nativeElement as HTMLElement;
    const allBtn = el.querySelector('button') as HTMLButtonElement;
    allBtn.click();
    expect(fired).toBe(true);
  });

  it('should emit categoryClick when a category button is clicked', () => {
    let clickedCategory: string | undefined;
    component.categoryClick.subscribe((evt) => {
      clickedCategory = evt.category;
    });

    const el = fixture.nativeElement as HTMLElement;
    const catButtons = el.querySelectorAll('button');
    // second button is the first category ("town")
    catButtons[1].click();
    expect(clickedCategory).toBe('town');
  });

  it('should emit pointerDown when pointer down occurs', () => {
    let downCategory: string | undefined;
    component.pointerDown.subscribe((evt) => {
      downCategory = evt.category;
    });

    const mockEvent = new PointerEvent('pointerdown');
    component.onPointerDown('food', mockEvent);
    expect(downCategory).toBe('food');
  });

  it('should have block host class', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.classList.contains('block')).toBe(true);
  });

  it('should emit pointerUp when pointerUp occurs', () => {
    let fired = false;
    component.pointerUp.subscribe(() => {
      fired = true;
    });
    const mockEvent = new PointerEvent('pointerup');
    component.onPointerUp(mockEvent);
    expect(fired).toBe(true);
  });

  it('should emit pointerMove when pointerMove occurs', () => {
    let fired = false;
    component.pointerMove.subscribe(() => {
      fired = true;
    });
    const mockEvent = new PointerEvent('pointermove');
    component.onPointerMove(mockEvent);
    expect(fired).toBe(true);
  });

  it('should emit cancelPress when onCancelPress is called', () => {
    let fired = false;
    component.cancelPress.subscribe(() => {
      fired = true;
    });
    component.onCancelPress();
    expect(fired).toBe(true);
  });

  it('should apply holding styles when holdingCategory matches button category', () => {
    fixture.componentRef.setInput('holdingCategory', 'town');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const catButtons = el.querySelectorAll('button');
    const townBtn = catButtons[1]; // second button is town
    expect(townBtn.className).toContain('scale-95');
    expect(townBtn.className).toContain('ring-2');
  });

  it('should style All button as active when all categories are selected', () => {
    const allKeys = new Set(AVAILABLE_CATEGORIES.map((c) => c.key));
    fixture.componentRef.setInput('selectedCategories', allKeys);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const allBtn = el.querySelector('button') as HTMLButtonElement;
    expect(allBtn.className).toContain('bg-slate-700');
  });

  it('should have type="button" on all buttons', () => {
    const el = fixture.nativeElement as HTMLElement;
    const buttons = el.querySelectorAll('button');
    buttons.forEach((btn) => {
      expect(btn.getAttribute('type')).toBe('button');
    });
  });

  it('should apply unselected styling to unselected categories', () => {
    fixture.componentRef.setInput('selectedCategories', new Set(['town']));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const buttons = el.querySelectorAll('button');
    // buttons[0] is All, buttons[1] is town (selected), buttons[2] is grocery (unselected)
    expect(buttons[2].className).toContain('opacity-60');
    expect(buttons[2].className).toContain('bg-slate-900');
  });
});
