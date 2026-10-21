/* Предпросмотр итогового запроса кадра (M5.10; принцип 13, docs/prompt_assembly.md). Промпт, negative, референсы,
   seed, модель и цену собирает бэкенд (`GET …/shots/{id}/prompt`) из версий канона, к которым прибит выпуск, — экран
   только показывает: секции с источником, итоговый текст, negative, референсы. Проблемы канона — списком вместо
   промпта, со ссылками на экран 12. Диалог lg, а не всплывающее окно: промпт с секциями — тысячи знаков. */
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { EpisodeCanon, ShotPrompt as ShotPromptData } from '@/types/plan'
import { useShotPrompt } from '../../api/queries'
import { Button, Dialog, Skeleton, StatusGlyph } from '../../ui'
import { CanonLink } from './CanonLink'
import { canonHref } from './canonLinks'

export interface ShotPromptProps {
  episodeId: string
  /** `null` — диалог закрыт */
  shotId: string | null
  /** Время ответа плана: правка кадра — новый предпросмотр */
  planStamp: number
  canon: EpisodeCanon | null | undefined
  onClose: () => void
}

export function ShotPrompt({ episodeId, shotId, planStamp, canon, onClose }: ShotPromptProps) {
  const prompt = useShotPrompt(episodeId, shotId, planStamp)
  return (
    <Dialog
      open={shotId !== null}
      onClose={onClose}
      title={`Промпт кадра ${shotId ?? ''}`}
      note="собирает код из канона выпуска"
      size="lg"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Закрыть
        </Button>
      }
    >
      {prompt.error ? (
        <p role="alert" className="text-12 text-failed-text">
          {prompt.error.message}
        </p>
      ) : !prompt.data ? (
        <Skeleton variant="text" lines={8} />
      ) : prompt.data.problems.length ? (
        <Problems problems={prompt.data.problems} canon={canon} />
      ) : (
        <PromptBody prompt={prompt.data} />
      )}
    </Dialog>
  )
}

/** Источник секции по-русски: версия канона как есть, действие и крупность — из кадра */
const sourceLabel = (source: string) => (source === 'shot' ? 'кадр' : source)

function PromptBody({ prompt }: { prompt: ShotPromptData }) {
  const [full, setFull] = useState(false)
  return (
    <div className="flex flex-col gap-3">
      <dl className="flex items-stretch gap-3">
        {[
          { label: 'Модель', value: prompt.model },
          { label: 'Цена кадра', value: `~${prompt.usd.usd}` },
          { label: 'Seed', value: String(prompt.seed) },
          { label: 'Кадр', value: prompt.aspect_ratio },
        ].map((item, i) => (
          <div key={item.label} className={i > 0 ? 'flex flex-col gap-0.5 border-l border-line pl-3' : 'flex flex-col gap-0.5'}>
            <dt className="text-11 text-muted">{item.label}</dt>
            <dd className="text-13 font-medium">{item.value}</dd>
          </div>
        ))}
      </dl>

      <Block title="Секции промпта">
        <ol aria-label="Секции промпта" className="flex flex-col gap-2">
          {prompt.sections.map((section, i) => (
            <li key={i} className="flex flex-col gap-1">
              <div className="flex items-baseline gap-2">
                <span className="text-12 font-medium">{section.label}</span>
                <span className="min-w-0 truncate font-dense text-12 text-muted">{sourceLabel(section.source)}</span>
              </div>
              <Text>{section.text}</Text>
            </li>
          ))}
        </ol>
      </Block>

      <div className="flex flex-col gap-1">
        <Button variant="ghost" size="sm" className="self-start" icon={full ? ChevronDown : ChevronRight} onClick={() => setFull(!full)}>
          Итоговый текст
        </Button>
        {full && <Text label="Итоговый текст">{prompt.text}</Text>}
      </div>

      <Block title="Negative">
        <Text>{prompt.negative || '— пусто —'}</Text>
      </Block>

      <Block title={`Референсы: ${prompt.refs.length}`}>
        {prompt.refs.length === 0 ? (
          <p className="text-12 text-muted">Референсов нет: в кадре нет обликов, кадров стиля для эпохи нет.</p>
        ) : (
          <ol aria-label="Референсы" className="flex flex-col gap-0.5">
            {prompt.refs.map((ref, i) => (
              <li key={`${ref.owner}:${ref.slot}`} className="flex gap-2 text-12">
                <span className="w-5 shrink-0 text-right text-muted">{i + 1}</span>
                <span>{ref.label}</span>
              </li>
            ))}
          </ol>
        )}
        {prompt.dropped.length > 0 && (
          <ul aria-label="Не поместились" className="mt-1 flex flex-col gap-0.5">
            {prompt.dropped.map((ref) => (
              <li key={`${ref.owner}:${ref.slot}`} className="text-12 text-warning">
                {ref.label}: {ref.reason}
              </li>
            ))}
          </ul>
        )}
      </Block>

      {prompt.warnings.length > 0 && (
        <ul aria-label="Предупреждения" className="flex flex-col gap-1">
          {prompt.warnings.map((warning) => (
            <li key={warning} className="flex gap-1.5 text-12 text-warning">
              <StatusGlyph status="warning" label="Предупреждение" className="mt-px shrink-0" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <h3 className="text-12 font-semibold text-ink">{title}</h3>
      {children}
    </section>
  )
}

function Text({ children, label }: { children: string; label?: string }) {
  return (
    <p aria-label={label} className="rounded-control border border-line bg-raised px-2 py-1.5 text-12 leading-4 whitespace-pre-wrap text-ink">
      {children}
    </p>
  )
}

/** Сущность канона кадра, о которой проблема: облик — по id или пути персонажа, эпоха — по id, стиль — по ссылке.
 *  Тексты проблем — бэкенда (`docs/prompt_assembly.md`, «Проблемы»), адресата в них нет: ищем id сущностей
 *  канона выпуска в тексте. Не нашли (стилевой токен в действии) — проблема без ссылки. */
function problemLink(problem: string, canon: EpisodeCanon | null | undefined): { href: string; label: string } | null {
  if (!canon) return null
  for (const item of canon.appearances) {
    if (problem.includes(item.id) || problem.includes(`${item.ref.split('#')[0]} `)) {
      const sheet = item.resolved && item.sheet.status !== 'ready'
      return { href: canonHref('appearance', item.id, sheet), label: sheet ? `Лист ${item.id}` : `Облик ${item.id}` }
    }
  }
  for (const item of canon.periods) {
    if (problem.includes(item.id)) return { href: canonHref('period', item.id), label: `Эпоха ${item.id}` }
  }
  if (problem.includes(canon.style.ref)) return { href: canonHref('style', 'style'), label: 'Стиль канала' }
  return null
}

function Problems({ problems, canon }: { problems: string[]; canon: EpisodeCanon | null | undefined }) {
  return (
    <div role="alert" className="flex flex-col gap-2">
      <p className="text-13 text-failed-text">Запрос кадра не собран — рисовать его нельзя:</p>
      <ul aria-label="Проблемы канона" className="flex flex-col gap-1.5">
        {problems.map((problem) => {
          const link = problemLink(problem, canon)
          return (
            <li key={problem} className="flex flex-col gap-0.5 text-12">
              <span className="text-ink">{problem}</span>
              {link && (
                <CanonLink href={link.href} className="self-start text-accent">
                  {link.label} на экране «Канон»
                </CanonLink>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
