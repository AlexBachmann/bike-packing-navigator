import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ResupplyRecipeCardComponent } from './resupply-recipe-card.component';
import { Recipe } from '../../models/resupply.model';

describe('ResupplyRecipeCardComponent', () => {
  let component: ResupplyRecipeCardComponent;
  let fixture: ComponentFixture<ResupplyRecipeCardComponent>;

  const mockRecipe: Recipe = {
    id: 'tuna-tortilla',
    name: 'Tuna Salad Tortilla',
    description: 'High-protein backcountry wrap with olive oil and spices',
    servings: 1,
    category: 'meal',
    isCustom: false,
    nutrients: {
      calories: 450,
      carbs: 35,
      protein: 30,
      fat: 18,
      sodium: 680,
      fluids: 0
    },
    ingredients: [
      { name: 'Tuna Pouch', quantity: 1, unit: 'pouch', department: 'Canned/Protein' },
      { name: 'Flour Tortilla', quantity: 1, unit: 'item', department: 'Bakery' }
    ]
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ResupplyRecipeCardComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(ResupplyRecipeCardComponent);
    component = fixture.componentInstance;
  });

  it('should create the component and render recipe details', () => {
    fixture.componentRef.setInput('recipe', mockRecipe);
    fixture.componentRef.setInput('quantity', 0);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Tuna Salad Tortilla');
    expect(text).toContain('High-protein backcountry wrap');
    expect(text).toContain('450 kcal');
    expect(text).toContain('35g C');
    expect(text).toContain('30g P');
    expect(text).toContain('(Meal)');
    expect(text).toContain('1 pouch Tuna Pouch');
  });

  it('should render favorite button with data-testid and toggle on click', () => {
    fixture.componentRef.setInput('recipe', mockRecipe);
    fixture.componentRef.setInput('isFavorite', false);
    fixture.detectChanges();

    const favBtn = fixture.nativeElement.querySelector('[data-testid="favorite-btn-tuna-tortilla"]') as HTMLButtonElement;
    expect(favBtn).toBeDefined();
    expect(favBtn.textContent).toContain('☆');

    let toggledId = '';
    component.toggleFavorite.subscribe((id) => (toggledId = id));
    favBtn.click();
    expect(toggledId).toBe('tuna-tortilla');

    fixture.componentRef.setInput('isFavorite', true);
    fixture.detectChanges();
    expect(favBtn.textContent).toContain('★');
  });

  it('should display Custom badge when recipe.isCustom is true', () => {
    fixture.componentRef.setInput('recipe', { ...mockRecipe, isCustom: true });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Custom');
  });

  it('should display Modified badge and Reset button when isModified is true', () => {
    fixture.componentRef.setInput('recipe', mockRecipe);
    fixture.componentRef.setInput('isModified', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Modified');

    let resetId = '';
    component.resetRecipe.subscribe((id) => (resetId = id));

    const resetBtn = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.includes('Reset'));
    expect(resetBtn).toBeDefined();
    resetBtn!.click();
    expect(resetId).toBe('tuna-tortilla');
  });

  it('should highlight card border when quantity > 0 and emit adjustQuantity on buttons', () => {
    fixture.componentRef.setInput('recipe', mockRecipe);
    fixture.componentRef.setInput('quantity', 2);
    fixture.detectChanges();

    const card = fixture.nativeElement.firstElementChild as HTMLElement;
    expect(card.className).toContain('border-emerald-500/70');

    const deltas: number[] = [];
    component.adjustQuantity.subscribe((d) => deltas.push(d));

    const decBtn = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.getAttribute('title') === 'Decrease quantity');
    const incBtn = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.getAttribute('title') === 'Increase quantity');

    decBtn!.click();
    incBtn!.click();
    expect(deltas).toEqual([-1, 1]);
  });

  it('should emit editRecipe and deleteRecipe when respective buttons are clicked', () => {
    fixture.componentRef.setInput('recipe', mockRecipe);
    fixture.detectChanges();

    let editedRecipe: Recipe | null = null;
    let deletedRecipe: Recipe | null = null;
    component.editRecipe.subscribe((r) => (editedRecipe = r));
    component.deleteRecipe.subscribe((r) => (deletedRecipe = r));

    const editBtn = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.includes('Edit'));
    const deleteBtn = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.includes('Delete'));

    editBtn!.click();
    expect(editedRecipe).toEqual(mockRecipe);

    deleteBtn!.click();
    expect(deletedRecipe).toEqual(mockRecipe);
  });
});
