import { useState, useMemo, useEffect } from 'react'
import { t } from '../lib/i18n.js'
import { useNutritionStore, MEALS } from '../store/nutritionStore.js'
import { searchFoods } from '../lib/foods.js'
import { searchExternal } from '../lib/foodApis.js'
import { todayISO, isoOf, fmtDate, fmtNum, uid } from '../lib/format.js'
import { Section, Row, Button, Stepper, Segmented, SearchField } from '../components/ui.jsx'
import { useUI } from '../store/useUI.js'
import Icon from '../components/Icon.jsx'
import '../nutrition.css'

const MEAL_KEYS = { cafe: 'Breakfast', almoco: 'Lunch', lanche: 'Snack', jantar: 'Dinner' }
const ACTIVITIES = [
  { v: 'sedentario', k: 'Sedentary' },
  { v: 'leve', k: 'Light activity' },
  { v: 'moderado', k: 'Moderate activity' },
  { v: 'intenso', k: 'Intense activity' },
  { v: 'muito_intenso', k: 'Very intense activity' },
]
const GOALS = [
  { v: 'emagrecer', k: 'Lose weight' },
  { v: 'manter', k: 'Maintain' },
  { v: 'ganhar', k: 'Gain weight' },
]
const RESULT_SRC = { usda: 'USDA', off: 'Open Food Facts', nutritionix: 'Nutritionix' }

export default function Nutrition() {
  const [date, setDate] = useState(todayISO())
  const [adding, setAdding] = useState(null) // meal key the add-food panel is open for
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState(null)
  const [grams, setGrams] = useState(100)
  const [online, setOnline] = useState([])
  const [onlineState, setOnlineState] = useState('idle') // idle | loading | done | error
  const toast = useUI(s => s.toast)

  const profile = useNutritionStore(s => s.profile)
  const targets = useNutritionStore(s => s.targets)
  const log = useNutritionStore(s => s.log)
  const lastRemoved = useNutritionStore(s => s.lastRemoved)
  const setProfile = useNutritionStore(s => s.setProfile)
  const addEntry = useNutritionStore(s => s.addEntry)
  const removeEntry = useNutritionStore(s => s.removeEntry)
  const undoRemove = useNutritionStore(s => s.undoRemove)
  const clearRemoved = useNutritionStore(s => s.clearRemoved)
  const totalsFor = useNutritionStore(s => s.totalsFor)

  const day = useMemo(() => log[date] || [], [log, date])
  const totals = useMemo(() => totalsFor(date), [totalsFor, log, date])
  const local = useMemo(() => (query.trim() ? searchFoods(query, 12) : []), [query])
  const q = query.trim()
  const today = todayISO()
  const over = totals.kcal > targets.kcal
  const diff = Math.abs(targets.kcal - totals.kcal)

  // Debounced external search — kept alive only while the panel is open; an offline
  // device is an explicit error rather than a silent empty result.
  useEffect(() => {
    if (adding === null) return
    if (q.length < 2) {
      setOnline([])
      setOnlineState('idle')
      return
    }
    let alive = true
    setOnlineState('loading')
    const tm = setTimeout(() => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setOnline([])
        setOnlineState('error')
        return
      }
      searchExternal(q)
        .then(r => {
          if (alive) {
            setOnline(r)
            setOnlineState('done')
          }
        })
        .catch(() => {
          if (alive) {
            setOnline([])
            setOnlineState('error')
          }
        })
    }, 350)
    return () => {
      alive = false
      clearTimeout(tm)
    }
  }, [q, adding])

  const goDate = iso => {
    setDate(iso)
    clearRemoved()
  }
  const shift = delta => {
    const d = new Date(date + 'T12:00:00')
    d.setDate(d.getDate() + delta)
    goDate(isoOf(d))
  }
  const openAdd = meal => {
    setAdding(meal)
    setPicked(null)
    setQuery('')
    setOnline([])
    setOnlineState('idle')
  }
  const closeAdd = () => {
    setAdding(null)
    setPicked(null)
    setQuery('')
    setOnline([])
    setOnlineState('idle')
  }
  const pick = f => {
    setPicked(f)
    setGrams(100)
  }
  const confirmAdd = () => {
    const scale = grams / 100
    addEntry(date, {
      id: uid(),
      meal: adding,
      name: picked.name,
      source: picked.source,
      grams,
      kcal: Math.round(picked.per100g.kcal * scale),
      protein: Math.round(picked.per100g.protein * scale),
      carbs: Math.round(picked.per100g.carbs * scale),
      fat: Math.round(picked.per100g.fat * scale),
    })
    clearRemoved()
    closeAdd()
  }
  const onRemove = e => {
    removeEntry(date, e.id)
    toast(t('Entry removed'))
  }

  const bars = [
    { k: 'Protein', cur: totals.protein, goal: targets.protein, color: 'var(--teal)' },
    { k: 'Carbs', cur: totals.carbs, goal: targets.carbs, color: 'var(--blue)' },
    { k: 'Fat', cur: totals.fat, goal: targets.fat, color: 'var(--orange)' },
  ]

  const resultRow = (f, i) => (
    <Row
      key={(f.source || 'x') + f.name + i}
      onClick={() => pick(f)}
      accessory="chevron"
      title={f.name}
      subtitle={`${fmtNum(f.per100g.kcal)} kcal / 100 g${RESULT_SRC[f.source] ? ' · ' + RESULT_SRC[f.source] : ''}`}
    />
  )

  return (
    <>
      <div className="hdr">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1>{t('Nutrition')}</h1>
          <div className="sub">{fmtDate(date, true, date.slice(0, 4) !== today.slice(0, 4))}</div>
        </div>
      </div>

      <div className="card">
        <div className="nut-nav">
          <button
            className="iconbtn"
            style={{ width: 30, height: 30, fontSize: 15 }}
            onClick={() => shift(-1)}
            aria-label={t('Previous day')}
          >
            <Icon name="chevronLeft" />
          </button>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
            {date !== today ? (
              <Button size="sm" variant="tinted" onClick={() => goDate(today)}>
                {t('Today')}
              </Button>
            ) : (
              <div className="nut-nav-d">{fmtDate(date, false)}</div>
            )}
          </div>
          <button
            className="iconbtn"
            style={{ width: 30, height: 30, fontSize: 15 }}
            disabled={date >= today}
            onClick={() => shift(1)}
            aria-label={t('Next day')}
          >
            <Icon name="chevronRight" />
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="nut-sum-top">
          <div>
            <div className="nut-sum-l">{t('Calories')}</div>
            <div className="nut-kcal">
              <b>{fmtNum(totals.kcal)}</b>
              <span>/ {fmtNum(targets.kcal)} kcal</span>
            </div>
          </div>
          <div className={'nut-rem' + (over ? ' over' : '')}>
            {over ? `${t('Over target')} ${fmtNum(diff)} kcal` : `${t('Remaining')} ${fmtNum(diff)} kcal`}
          </div>
        </div>
        <div className="nut-bars">
          {bars.map(b => {
            const pct = b.goal > 0 ? Math.min(100, (b.cur / b.goal) * 100) : 0
            return (
              <div key={b.k}>
                <div className="nut-bar-h">
                  <span>{t(b.k)}</span>
                  <span className="dim">
                    {fmtNum(b.cur)} / {fmtNum(b.goal)} g
                  </span>
                </div>
                <div className="nut-bar-t">
                  <i style={{ width: pct + '%', background: b.color }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {lastRemoved && lastRemoved.date === date && (
        <div className="nut-undo">
          <span>{t('Entry removed')}</span>
          <Button size="sm" onClick={undoRemove}>
            {t('Undo')}
          </Button>
        </div>
      )}

      {!day.length && (
        <div className="empty nut-none">
          <div className="ico">
            <Icon name="plate" />
          </div>
          {t('No meals logged yet')}
        </div>
      )}

      {MEALS.map(meal => (
        <div key={meal}>
          <Section title={t(MEAL_KEYS[meal])}>
            {day
              .filter(e => e.meal === meal)
              .map(e => (
                <Row key={e.id} title={e.name} subtitle={`${fmtNum(e.grams)} g`}>
                  <span className="nut-ek">
                    {fmtNum(e.kcal)}
                    <i>kcal</i>
                  </span>
                  <button className="iconbtn nut-del" onClick={() => onRemove(e)} aria-label={t('Delete')}>
                    <Icon name="trash" />
                  </button>
                </Row>
              ))}
            <Row icon="plus" title={t('Add food')} onClick={() => openAdd(meal)} />
          </Section>

          {adding === meal && (
            <div className="nut-add">
              <div className="nut-add-h">
                <b>{t('Add food')}</b>
                <button className="iconbtn" onClick={closeAdd} aria-label={t('Cancel')}>
                  <Icon name="xmark" />
                </button>
              </div>
              {!picked ? (
                <>
                  <SearchField
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onClear={() => setQuery('')}
                    placeholder={t('Search foods')}
                    aria-label={t('Search foods')}
                  />
                  {!!q && local.length > 0 && <Section title={t('Local foods')}>{local.map(resultRow)}</Section>}
                  {q.length >= 2 && (onlineState === 'loading' || onlineState === 'error' || online.length > 0) && (
                    <Section title={t('Online results')}>
                      {onlineState === 'loading' && <div className="nut-st">{t('Searching…')}</div>}
                      {onlineState === 'error' && <div className="nut-st err">{t('Could not search online')}</div>}
                      {onlineState === 'done' && online.map(resultRow)}
                    </Section>
                  )}
                  {q.length >= 2 &&
                    onlineState !== 'loading' &&
                    onlineState !== 'error' &&
                    !local.length &&
                    !online.length && <div className="nut-st">{t('No matches for {0}', q)}</div>}
                </>
              ) : (
                <div className="nut-pick">
                  <div className="nut-pick-h">
                    <button className="iconbtn" onClick={() => setPicked(null)} aria-label={t('Back')}>
                      <Icon name="chevronLeft" />
                    </button>
                    <b>{picked.name}</b>
                  </div>
                  <div className="nut-lbl">{t('Meal')}</div>
                  <div className="nut-chips">
                    {MEALS.map(m => (
                      <button key={m} className={'chip' + (adding === m ? ' on' : '')} onClick={() => setAdding(m)}>
                        {t(MEAL_KEYS[m])}
                      </button>
                    ))}
                  </div>
                  <Stepper label={t('Grams')} unit="g" step={5} decimal={false} value={grams} onChange={setGrams} />
                  <div className="nut-sum-l" style={{ marginTop: 14 }}>
                    {t('Portion')}
                  </div>
                  <div className="nut-pick-m">
                    <span className="nut-pick-k">
                      <b>{fmtNum(Math.round((picked.per100g.kcal * grams) / 100))}</b> kcal
                    </span>
                    <span>
                      {t('Protein')} <b>{fmtNum(Math.round((picked.per100g.protein * grams) / 100))} g</b>
                    </span>
                    <span>
                      {t('Carbs')} <b>{fmtNum(Math.round((picked.per100g.carbs * grams) / 100))} g</b>
                    </span>
                    <span>
                      {t('Fat')} <b>{fmtNum(Math.round((picked.per100g.fat * grams) / 100))} g</b>
                    </span>
                  </div>
                  <Button variant="primary" icon="plus" onClick={confirmAdd}>
                    {t('Add')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      <Section title={t('Profile')} footer={t('Basal {0} kcal · Maintenance {1} kcal', targets.bmr, targets.tdee)}>
        <div className="nut-pad">
          <div className="nut-prof">
            <Stepper
              label={t('Weight')}
              unit="kg"
              step={0.5}
              value={profile.peso}
              onChange={v => setProfile({ peso: v })}
            />
            <Stepper
              label={t('Height')}
              unit="cm"
              step={1}
              value={profile.altura}
              onChange={v => setProfile({ altura: v })}
            />
            <Stepper
              label={t('Age')}
              step={1}
              decimal={false}
              value={profile.idade}
              onChange={v => setProfile({ idade: v })}
            />
          </div>
          <div className="nut-lbl">{t('Sex')}</div>
          <Segmented
            options={[
              { value: 'male', label: t('Male') },
              { value: 'female', label: t('Female') },
            ]}
            value={profile.sexo}
            onChange={v => setProfile({ sexo: v })}
          />
          <div className="nut-lbl">{t('Activity')}</div>
          <div className="nut-chips">
            {ACTIVITIES.map(a => (
              <button
                key={a.v}
                className={'chip' + (profile.atividade === a.v ? ' on' : '')}
                onClick={() => setProfile({ atividade: a.v })}
              >
                {t(a.k)}
              </button>
            ))}
          </div>
          <div className="nut-lbl">{t('Goal')}</div>
          <div className="nut-chips">
            {GOALS.map(g => (
              <button
                key={g.v}
                className={'chip' + (profile.objetivo === g.v ? ' on' : '')}
                onClick={() => setProfile({ objetivo: g.v })}
              >
                {t(g.k)}
              </button>
            ))}
          </div>
          <div className="nut-note">{t('Estimates for guidance — not medical advice.')}</div>
        </div>
      </Section>
    </>
  )
}
