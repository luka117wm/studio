/* Заявка выпуска по референсу (M4.11): режим и ссылка на референс, только чтение — их задаёт создание выпуска на
   вкладке «Референс». Текста референса здесь нет: в план идёт только структура (принцип 11). */
import { FileSearch } from 'lucide-react'
import type { EpisodeBrief } from '@/types/project'
import { useReference } from '../../api/queries'
import { Link } from '../../app/Link'

const MODE: Record<'structure_clone' | 'own_version', string> = {
  structure_clone: 'новая тема по структуре',
  own_version: 'своя версия темы',
}

export function ReferenceNote({ brief }: { brief: EpisodeBrief }) {
  const reference = useReference(brief.reference_id)
  if (!brief.reference_id || brief.reference_mode === 'none') return null
  // Название — в кавычках; без названия (чат его не узнал) — ссылка или id как есть
  const title = reference.data?.title ? `«${reference.data.title}»` : reference.data?.url || brief.reference_id
  return (
    <p aria-label="Референс выпуска" className="flex items-center gap-2 text-12 text-muted">
      <FileSearch className="size-icon shrink-0" strokeWidth={1.5} aria-hidden />
      <span className="min-w-0 truncate">
        По референсу {title}: {MODE[brief.reference_mode]}.
      </span>
      <Link to={`/ideas?tab=reference&ref=${encodeURIComponent(brief.reference_id)}`} className="shrink-0 text-accent hover:underline">
        Открыть референс
      </Link>
    </p>
  )
}
