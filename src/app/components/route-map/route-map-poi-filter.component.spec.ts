import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouteMapPoiFilterComponent } from './route-map-poi-filter.component';
import { describe, it, expect, beforeEach } from 'vitest';

describe('RouteMapPoiFilterComponent', () => {
  let component: RouteMapPoiFilterComponent;
  let fixture: ComponentFixture<RouteMapPoiFilterComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RouteMapPoiFilterComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(RouteMapPoiFilterComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('activeFilter', 'all');
    fixture.detectChanges();
  });

  it('1. should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('2. should render all 7 POI filter buttons with type="button"', () => {
    const el = fixture.nativeElement as HTMLElement;
    const buttons = el.querySelectorAll('button');
    expect(buttons.length).toBe(7);
    buttons.forEach((btn) => {
      expect(btn.getAttribute('type')).toBe('button');
    });
  });

  it('3. should highlight the active filter button with appropriate colors', () => {
    const el = fixture.nativeElement as HTMLElement;
    const allBtn = el.querySelector('button') as HTMLButtonElement;
    expect(allBtn.className).toContain('bg-emerald-500');

    fixture.componentRef.setInput('activeFilter', 'bike_shop');
    fixture.detectChanges();

    const bikeShopBtn = el.querySelectorAll('button')[2] as HTMLButtonElement;
    expect(bikeShopBtn.className).toContain('bg-blue-500');
  });

  it('4. should emit filterChange when a category button is clicked', () => {
    let emittedFilter: string | undefined;
    component.filterChange.subscribe((cat) => {
      emittedFilter = cat;
    });

    const el = fixture.nativeElement as HTMLElement;
    const campBtn = el.querySelectorAll('button')[3] as HTMLButtonElement;
    campBtn.click();

    expect(emittedFilter).toBe('campground');
  });
});
