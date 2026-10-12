/* Сходство с референсом в правой панели экрана 3 (M4.11): у выпуска с `brief.reference_id` — «Сходство 3 %, норма, порог
   10 %» или warning с совпавшими фразами; без плана — «плана ещё нет». Перезапрашивается с каждым ответом плана:
   правка VO на листе сразу меняет долю (принцип 11). Сам отказ даёт «Утвердить план» (M4.10). */
import { useSimilarity } from '../../api/queries'
import { SimilarityBadge } from '../ideas/SimilarityBadge'

export function SimilarityPanel({ episodeId, planStamp }: { episodeId: string; planStamp: number }) {
  const similarity = useSimilarity(episodeId, planStamp)
  return (
    <section aria-label="Сходство с референсом" className="flex flex-col gap-2 border-t border-line p-3">
      <h2 className="text-13 font-semibold text-ink">Сходство с референсом</h2>
      <SimilarityBadge report={similarity.data} error={similarity.error} />
    </section>
  )
}
