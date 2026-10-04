import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { useNutritionStore, MEALS, portionOfRecipe } from '../store/nutritionStore.js'
import { useUI } from '../store/useUI.js'
import { Section, Row, Button, Stepper, TextField, NumberField } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { fmtNum } from '../lib/format.js'

// The same meal keys Nutrition.jsx writes its diary sections under — the entry's `meal`
// must land in the section the user picked here.
const MEAL_KEYS = { cafe: 'Breakfast', almoco: 'Lunch', lanche: 'Snack', jantar: 'Dinner' }
// Ingredient columns, in the order the add-food entry shows its macros. Each field is the
// SAME component the add-food form uses (TextField/NumberField from components/ui.jsx) —
// the food entry fields, one row per ingredient.
const COLUMNS = [
  { k: 'grams', label: 'Grams' },
  { k: 'kcal', label: 'Calories' },
  { k: 'protein', label: 'Protein' },
  { k: 'carbs', label: 'Carbs' },
  { k: 'fat', label: 'Fat' },
]
const blankIngredient = () => ({ name: '', grams: 0, kcal: 0, protein: 0, carbs: 0, fat: 0 })

// The portion read-out, reusing the add-food panel's own `.nut-pick-m` block so the
// numbers look identical wherever a portion is previewed.
const portionPreview = p => (
  <div className="nut-pick-m">
    <span className="nut-pick-k">
      <b>{fmtNum(p.kcal)}</b> kcal
    </span>
    <span>
      {t('Protein')} <b>{fmtNum(p.protein)} g</b>
    </span>
    <span>
      {t('Carbs')} <b>{fmtNum(p.carbs)} g</b>
    </span>
    <span>
      {t('Fat')} <b>{fmtNum(p.fat)} g</b>
    </span>
  </div>
)

export default function RecipesSection({ date }) {
  const recipes = useNutritionStore(s => s.recipes) || []
  const openSheet = useUI(s => s.openSheet)
  const openLog = r => openSheet(close => <RecipeLog recipe={r} date={date} close={close} />)
  const openEditor = r => openSheet(close => <RecipeEditor recipe={r} close={close} />)

  return (
    <Section title={t('Recipes')}>
      {!recipes.length && <div className="nut-note">{t('No recipes yet')}</div>}
      {recipes.map(r => {
        const per = portionOfRecipe(r, 0)
        return (
          <Row
            key={r.id}
            title={r.name}
            subtitle={t('{0} portions · {1} kcal per portion', r.portions, fmtNum(per.kcal))}
            accessory="chevron"
            onClick={() => openLog(r)}
          />
        )
      })}
      <Row icon="plus" title={t('New recipe')} onClick={() => openEditor(null)} />
    </Section>
  )
}

// One tap on a recipe: pick the meal and how many of its portions to log. The split into
// entries (and every number below) comes from the store's addRecipeToDiary, so what the
// sheet previews is exactly what lands in the diary.
function RecipeLog({ recipe, date, close }) {
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [meal, setMeal] = useState('almoco')
  const [portions, setPortions] = useState(Math.max(1, Math.round(recipe.portions) || 1))
  const per = portionOfRecipe(recipe, 0)
  const max = Math.max(1, Math.round(recipe.portions) || 1)

  const add = () => {
    const n = useNutritionStore.getState().addRecipeToDiary(date, meal, recipe.id, portions)
    useNutritionStore.getState().clearRemoved()
    close()
    toast(t('Added {0} portions to your diary', n))
  }
  // The editor is a sheet over this one (the app stacks sheets), and editing swaps the
  // recipe in place — so the log sheet is closed first rather than left showing the
  // version of the recipe that was open when it was tapped.
  const edit = () => {
    close()
    openSheet(inner => <RecipeEditor recipe={recipe} close={inner} />)
  }

  return (
    <div className="nut-pick">
      <h3>{recipe.name}</h3>
      <div className="nut-lbl">{t('Portion')}</div>
      {portionPreview(per)}
      <div className="nut-lbl">{t('Meal')}</div>
      <div className="nut-chips">
        {MEALS.map(m => (
          <button key={m} type="button" className={`chip${meal === m ? ' on' : ''}`} onClick={() => setMeal(m)}>
            {t(MEAL_KEYS[m])}
          </button>
        ))}
      </div>
      <Stepper
        label={t('Portions')}
        value={portions}
        decimal={false}
        onChange={v => setPortions(Math.min(max, Math.max(1, v)))}
      />
      <div style={{ height: 14 }} />
      <Button variant="primary" icon="plus" onClick={add}>
        {t('Add to diary')}
      </Button>
      <Button variant="ghost" icon="pencil" onClick={edit}>
        {t('Edit recipe')}
      </Button>
    </div>
  )
}

// Create or edit: name, portion count and one row of food-entry fields per ingredient,
// with the per-portion macros recomputed on every keystroke through the same pure math
// the diary split uses.
function RecipeEditor({ recipe, close }) {
  const toast = useUI(s => s.toast)
  const [name, setName] = useState(recipe?.name || '')
  const [portions, setPortions] = useState(Math.max(1, Math.round(recipe?.portions) || 2))
  const [ings, setIngs] = useState(() =>
    recipe?.ingredients?.length ? recipe.ingredients.map(i => ({ ...i })) : [blankIngredient()],
  )

  const draft = { id: recipe?.id, name: name.trim(), portions, ingredients: ings }
  const per = portionOfRecipe(draft, 0)
  const valid = !!draft.name && ings.some(i => i.name?.trim())
  const setIngredient = (i, patch) => setIngs(list => list.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  const save = () => {
    if (!valid) return
    useNutritionStore.getState().saveRecipe(draft)
    close()
    toast(t('Recipe saved'))
  }
  const remove = () => {
    if (recipe) useNutritionStore.getState().removeRecipe(recipe.id)
    close()
    toast(t('Recipe deleted'))
  }

  return (
    <div className="nut-pick">
      <h3>{recipe ? t('Edit recipe') : t('New recipe')}</h3>
      <div className="nut-lbl">{t('Recipe name')}</div>
      <TextField
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder={t('Recipe name')}
        aria-label={t('Recipe name')}
      />
      <Stepper label={t('Portions')} value={portions} decimal={false} onChange={v => setPortions(Math.max(1, v))} />
      <div className="nut-lbl">{t('Ingredients')}</div>
      <div className="nut-ing">
        <div className="nut-ing-head">
          <span />
          <span>g</span>
          <span>kcal</span>
          <span>{t('Protein')}</span>
          <span>{t('Carbs')}</span>
          <span>{t('Fat')}</span>
          <span />
        </div>
        {ings.map((ing, i) => (
          <div className="nut-ing-row" key={i}>
            <TextField
              value={ing.name}
              onChange={e => setIngredient(i, { name: e.target.value })}
              placeholder={t('Ingredient name')}
              aria-label={t('Ingredient name')}
            />
            {COLUMNS.map(c => (
              <NumberField
                key={c.k}
                value={ing[c.k]}
                onChange={v => setIngredient(i, { [c.k]: v })}
                aria-label={t(c.label)}
              />
            ))}
            <button
              type="button"
              className="iconbtn nut-ing-x"
              onClick={() => setIngs(list => list.filter((_, j) => j !== i))}
              aria-label={t('Delete')}
            >
              <Icon name="xmark" />
            </button>
          </div>
        ))}
      </div>
      <Button variant="tinted" icon="plus" onClick={() => setIngs(list => [...list, blankIngredient()])}>
        {t('Add ingredient')}
      </Button>
      <div className="nut-lbl">{t('Portion')}</div>
      {portionPreview(per)}
      <Button variant="primary" icon="check" onClick={save} disabled={!valid}>
        {t('Save')}
      </Button>
      {recipe && (
        <Button variant="ghost" className="dim" icon="trash" onClick={remove}>
          {t('Delete')}
        </Button>
      )}
    </div>
  )
}
