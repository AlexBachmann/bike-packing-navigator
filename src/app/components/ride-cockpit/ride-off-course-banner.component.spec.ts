import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  RideOffCourseBannerComponent,
  OffCourseAlertStatus
} from './ride-off-course-banner.component';

describe('RideOffCourseBannerComponent Unit Tests', () => {
  let component: RideOffCourseBannerComponent;
  let fixture: ComponentFixture<RideOffCourseBannerComponent>;

  const onCourseStatus: OffCourseAlertStatus = {
    isOffCourse: false,
    distanceMeters: 5,
    displayText: '',
    returnBearingDeg: 0
  };

  const offCourseStatus: OffCourseAlertStatus = {
    isOffCourse: true,
    distanceMeters: 45,
    displayText: '⚠️ Off Route: 45 m',
    returnBearingDeg: 135
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RideOffCourseBannerComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(RideOffCourseBannerComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('offCourseStatus', onCourseStatus);
    fixture.detectChanges();
  });

  it('1. should create and not render banner when on course', () => {
    expect(component).toBeTruthy();
    const banner = fixture.nativeElement.querySelector('[data-testid="off-course-banner"]');
    expect(banner).toBeNull();
  });

  it('2. should render banner when isOffCourse is true', () => {
    fixture.componentRef.setInput('offCourseStatus', offCourseStatus);
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector('[data-testid="off-course-banner"]');
    expect(banner).toBeTruthy();
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toContain('⚠️ Off Route: 45 m');
    expect(banner.textContent).toContain('Return');
  });

  it('3. should rotate return vector SVG according to relativeReturnAngle', () => {
    fixture.componentRef.setInput('offCourseStatus', offCourseStatus);
    fixture.componentRef.setInput('relativeReturnAngle', 45);
    fixture.detectChanges();

    const svg = fixture.nativeElement.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg.style.transform).toBe('rotate(45deg)');

    fixture.componentRef.setInput('relativeReturnAngle', -120);
    fixture.detectChanges();
    expect(svg.style.transform).toBe('rotate(-120deg)');
  });

  it('4. should transition smoothly between on-course and off-course', () => {
    fixture.componentRef.setInput('offCourseStatus', offCourseStatus);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="off-course-banner"]')).toBeTruthy();

    fixture.componentRef.setInput('offCourseStatus', onCourseStatus);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="off-course-banner"]')).toBeNull();
  });
});
