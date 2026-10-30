/* Полоса выбора экрана 4, 44 (артборд 4; layout.md, «Нижняя панель выделения»): сколько выбрано и сколько из них с
   ошибкой, модель — сегменты каталога `images` с ценой картинки в подсказке (не цены артборда), «Перерисовать
   выбранные (N, ~$X)» — пачка `redraw: true`; число и сумма — из одной сметы бэкенда для выбранных кадров и модели.
   Пока идёт смета нового выбора, видна прежняя пара, а кнопка недоступна: иначе нажатие ушло бы по чужой цене. Отказ
   (бюджет суммой, кадры заняты) — текстом в полосе до следующего выбора, без тоста об успехе. */
import { useEffect } from 'react'
import type { BatchSummary } from '@/types/batch'
import type { StageCatalog } from '@/types/provider'
import { budgetRefusal } from '../../api/client'
import { useGenerate, useRedrawBatchEstimate } from '../../api/queries'
import { useUiStore } from '../../store/uiStore'
import { Button, SegmentedControl } from '../../ui'
import { plural } from '../episodes/board'
import { SHOTS, shortLabels } from './grid'

// Влезает в полосу на 1536 (368 из 396 px): длиннее обрезается многоточием (сверка M6.12)
export const SELECTION_HINT = 'Клик выбирает, ⇧-клик — диапазон, наведение — действия'

export interface SelectionBarProps {
  episodeId: string
  /** Выбранные кадры по порядку плана */
  selected: readonly string[]
  /** Сколько выбранных — со сбоем */
  failed: number
  catalog: StageCatalog | undefined
  model: string | null
  onModel: (key: string) => void
  /** Пачка поставлена: тост о списанном по её концу, выбор снимается */
  onQueued: (batch: BatchSummary) => void
}

export function SelectionBar({ episodeId, selected, failed, catalog, model, onModel, onQueued }: SelectionBarProps) {
  const estimate = useRedrawBatchEstimate(episodeId, selected, model)
  const generate = useGenerate(episodeId)
  const pushToast = useUiStore((s) => s.pushToast)
  const count = selected.length
  const { reset } = generate
  // Отказ относится к тому выбору и модели, на которые пришёл; сравнение — по составу, не по ссылке: project.json
  // перезапрашивается во время пачки, и массив выбора пересобирается
  const key = `${model ?? ''}:${selected.join(',')}`
  useEffect(() => reset(), [key, reset])

  const submit = async () => {
    if (!count || !model || generate.isPending) return
    try {
      const result = await generate.mutateAsync({ shots: [...selected] as [string, ...string[]], model, redraw: true })
      const queued = result.batch.jobs.total
      pushToast({ id: `redraw-batch-${result.batch.id}`, message: `Поставлено ${queued} ${plural(queued, SHOTS)}, ~${result.batch.estimate.usd}`, status: 'ready' })
      onQueued(result.batch)
    } catch {
      // Показ — из generate.error
    }
  }

  const refusal = generate.error ? (budgetRefusal(generate.error)?.message ?? generate.error.message) : null
  const label = count
    ? `${plural(count, ['Выбран', 'Выбрано', 'Выбрано'])} ${count} ${plural(count, SHOTS)}${failed ? `, из них ${failed} с ошибкой` : ''}`
    : SELECTION_HINT
  const models = catalog?.models ?? []
  const labels = shortLabels(models.map((m) => m.label))
  const shown = count ? estimate.data : undefined
  const current = shown !== undefined && !estimate.isPlaceholderData

  return (
    <div role="region" aria-label="Выбор кадров" className="flex h-11 shrink-0 items-center gap-3 border-t border-line bg-strip px-3">
      {refusal ? (
        <p role="alert" className="min-w-0 flex-1 truncate text-12 text-failed-text" title={refusal}>
          {refusal}
        </p>
      ) : (
        <p className={count ? 'min-w-0 flex-1 truncate text-12 text-ink' : 'min-w-0 flex-1 truncate text-12 text-muted'}>{label}</p>
      )}
      {models.length > 0 && model !== null && (
        <div className="flex items-center gap-1.5">
          <span className="text-12 text-muted">Модель</span>
          <SegmentedControl
            ariaLabel="Модель перерисовки"
            value={model}
            onChange={onModel}
            options={models.map((m, i) => ({ value: m.key, label: labels[i] ?? m.label, tooltip: `${m.label} — ${m.price.usd} за кадр` }))}
          />
        </div>
      )}
      <Button
        variant="secondary"
        disabled={!current}
        loading={generate.isPending}
        loadingLabel="Ставлю в очередь"
        price={shown ? shown.total.usd_micro / 1_000_000 : undefined}
        priceNote={shown ? String(shown.count) : undefined}
        onClick={() => void submit()}
      >
        Перерисовать выбранные
      </Button>
    </div>
  )
}
