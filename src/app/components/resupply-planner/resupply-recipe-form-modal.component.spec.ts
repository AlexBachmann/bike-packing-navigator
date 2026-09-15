import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  RecipeFormData,
  ResupplyRecipeFormModalComponent
} from './resupply-recipe-form-modal.component';
import { Recipe } from '../../models/resupply.model';

describe('ResupplyRecipeFormModalComponent', () => {
  let component: ResupplyRecipeFormModalComponent;
  let fixture: ComponentFixture<ResupplyRecipeFormModalComponent>;

  const mockRecipe: Recipe = {
    id: 'oatmeal-deluxe',
    name: 'Oatmeal Deluxe',
    description: 'Instant oats with chia and peanut butter',
    servings: 1,
    category: 'meal',
    nutrients: {
      calories: 550,
      carbs: 75,
      protein: 18,
      fat: 20,
      sodium: 320,
      fluids: 0
    },
    ingredients: [
      { name: 'Rolled Oats', quantity: 1, unit: 'cup', department: 'Bakery' },
      { name: 'Peanut Butter Packet', quantity: 1, unit: 'packet', department: 'Snacks/Candy' }
    ]
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ResupplyRecipeFormModalComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(ResupplyRecipeFormModalComponent);
    component = fixture.componentInstance;
  });

  it('should not render modal dialog when isOpen is false', () => {
    fixture.componentRef.setInput('isOpen', false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
  });

  it('should render Add Recipe mode with default values when mode is add', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('mode', 'add');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Add Recipe');
    expect(fixture.nativeElement.querySelectorAll('[data-testid="edit-ingredient-row"]').length).toBe(1);
  });

  it('should pre-populate form in Edit mode with recipe data', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('mode', 'edit');
    fixture.componentRef.setInput('recipe', mockRecipe);
    fixture.detectChanges();

    const nameInput = fixture.nativeElement.querySelector('input[aria-label="Recipe Name"]') as HTMLInputElement;
    expect(nameInput.value).toBe('Oatmeal Deluxe');

    const rows = fixture.nativeElement.querySelectorAll('[data-testid="edit-ingredient-row"]');
    expect(rows.length).toBe(2);
  });

  it('should emit cancel when close or cancel button is clicked', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('mode', 'add');
    fixture.detectChanges();

    let cancelCount = 0;
    component.cancel.subscribe(() => cancelCount++);

    const closeBtn = fixture.nativeElement.querySelector('button[aria-label="Close modal"]') as HTMLButtonElement;
    const cancelBtn = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.includes('Cancel'));

    closeBtn.click();
    cancelBtn!.click();
    expect(cancelCount).toBe(2);
  });

  it('should add an ingredient row when Add Item button is clicked', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('mode', 'add');
    fixture.detectChanges();

    const initialRows = fixture.nativeElement.querySelectorAll('[data-testid="edit-ingredient-row"]').length;
    const addBtn = fixture.nativeElement.querySelector('[data-testid="edit-add-ingredient-btn"]') as HTMLButtonElement;
    addBtn.click();
    fixture.detectChanges();

    const newRows = fixture.nativeElement.querySelectorAll('[data-testid="edit-ingredient-row"]').length;
    expect(newRows).toBe(initialRows + 1);
  });

  it('should remove an ingredient row when remove button is clicked', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('mode', 'edit');
    fixture.componentRef.setInput('recipe', mockRecipe);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('[data-testid="edit-ingredient-row"]').length).toBe(2);

    const removeButtons = fixture.nativeElement.querySelectorAll('button[aria-label="Remove ingredient"]') as NodeListOf<HTMLButtonElement>;
    removeButtons[0].click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('[data-testid="edit-ingredient-row"]').length).toBe(1);
  });

  it('should not emit save when recipe name is empty', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('mode', 'add');
    component.formName.set('');
    fixture.detectChanges();

    let saved = false;
    component.save.subscribe(() => (saved = true));

    const submitBtn = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.includes('Add Recipe'));
    submitBtn!.click();
    expect(saved).toBe(false);
  });

  it('should emit save with normalized RecipeFormData when valid', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('mode', 'add');
    component.formName.set('Summit Ramen');
    component.formCalories.set(400);
    component.formIngredients.set([
      { name: 'Ramen Noodles', quantity: 1, unit: 'pack', department: 'Canned/Protein' }
    ]);
    fixture.detectChanges();

    let savedData: RecipeFormData | null = null;
    component.save.subscribe((data) => (savedData = data));

    const submitBtn = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.includes('Add Recipe'));
    submitBtn!.click();

    expect(savedData).not.toBeNull();
    const result = savedData as RecipeFormData | null;
    expect(result?.name).toBe('Summit Ramen');
    expect(result?.nutrients.calories).toBe(400);
    expect(result?.ingredients.length).toBe(1);
  });
});
