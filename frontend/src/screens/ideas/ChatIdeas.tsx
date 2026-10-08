/* «Идеи из чата» — правая колонка 340 экрана 2 (артборд 2: карточки «Идей из кластеров»). Сверху — мост через чат на
   общих компонентах `screens/bridge/`: промпт идей в буфер, ответ чата в поле. Ниже — предложенные чатом идеи
   (`proposed`): название, оценка, «почему», описание; «В бэклог» переносит идею в центр, «Начать выпуск» создаёт
   выпуск. «Доказательств» и «Насыщенности» артборда нет: без радара для них нет данных (docs/visual_review.md). */
import { MessagesSquare } from 'lucide-react'
import type { Idea } from '@/types/idea'
import { useApplyIdeasAnswer, useIdeasPrompt, usePatchIdea, type ChannelId } from '../../api/queries'
import { useUiStore } from '../../store/uiStore'
import { Button, EmptyState } from '../../ui'
import { CopyPrompt } from '../bridge/CopyPrompt'
import { PasteAnswer, type AppliedAnswer } from '../bridge/PasteAnswer'
import { plural } from '../episodes/board'
import { IdeaScore } from './IdeaScore'
import { skippedLine } from './ideaView'

const IDEAS = ['идея', 'идеи', 'идей'] as const

export interface ChatIdeasProps {
  channel: ChannelId
  ideas: Idea[] | undefined
  onStart: (idea: Idea) => void
  busyId: string | null
}

export function ChatIdeas({ channel, ideas, onStart, busyId }: ChatIdeasProps) {
  const prompt = useIdeasPrompt(channel)
  const answer = useApplyIdeasAnswer(channel)
  const patch = usePatchIdea(channel)
  const pushToast = useUiStore((s) => s.pushToast)
  // Свежий ответ чата — сверху, сразу под полем; внутри ответа — в порядке чата (номера идут по ответу)
  const proposed = (ideas ?? [])
    .filter((idea) => idea.status === 'proposed')
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))

  const request = async () => {
    const issued = await prompt.mutateAsync(undefined)
    return { text: issued.text, copied: `Промпт идей скопирован: ${issued.count} ${plural(issued.count, IDEAS)}` }
  }

  const apply = async (text: string): Promise<AppliedAnswer> => {
    const result = await answer.mutateAsync(text)
    const added = `Добавлено ${result.created.length} ${plural(result.created.length, IDEAS)}`
    return {
      toast: result.skipped.length ? `${added}, пропущено ${result.skipped.length}` : added,
      warnings: result.skipped.map(skippedLine),
    }
  }

  const toBacklog = async (idea: Idea) => {
    try {
      await patch.mutateAsync({ id: idea.id, patch: { status: 'backlog' } })
      pushToast({ id: 'idea-backlog', message: `В бэклоге: ${idea.title}`, status: 'ready' })
    } catch (error) {
      pushToast({ id: 'idea-backlog', message: error instanceof Error ? error.message : String(error), status: 'failed' })
    }
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 border-b border-line p-3">
        <CopyPrompt label="Скопировать промпт идей" request={request} />
        <PasteAnswer apply={apply} />
      </div>
      {ideas && proposed.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title="Предложений нет"
          description="Скопируйте промпт, вставьте его в чат и верните ответ сюда: чат предложит идеи по семенам ниши и формату канала."
        />
      ) : (
        <ul aria-label="Идеи из чата" className="flex flex-col gap-2 p-3">
          {proposed.map((idea) => (
            <li key={idea.id}>
              <IdeaCard
                idea={idea}
                busy={busyId === idea.id}
                locked={busyId !== null || patch.isPending}
                onBacklog={() => void toBacklog(idea)}
                onStart={() => onStart(idea)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface CardProps {
  idea: Idea
  busy: boolean
  locked: boolean
  onBacklog: () => void
  onStart: () => void
}

/** Карточка предложения (артборд 2): название 13/500 и оценка, «почему» мелко, описание, действия под чертой */
function IdeaCard({ idea, busy, locked, onBacklog, onStart }: CardProps) {
  const description = idea.summary || idea.angle
  return (
    <article aria-label={idea.title} className="flex flex-col gap-2 rounded-panel border border-line bg-panel p-2">
      <div className="flex items-start gap-2">
        <h3 className="line-clamp-3 min-w-0 flex-1 text-13 leading-4 font-medium text-ink">{idea.title}</h3>
        <IdeaScore value={idea.score} />
      </div>
      {idea.score_reason && <p className="text-11 leading-3.5 text-muted">{idea.score_reason}</p>}
      {description && <p className="text-12 leading-4 text-muted">{description}</p>}
      <div className="flex items-center gap-2 border-t border-rule-inner pt-1.5">
        <Button size="sm" variant="ghost" disabled={locked} onClick={onBacklog}>
          В бэклог
        </Button>
        <Button size="sm" variant="secondary" loading={busy} loadingLabel="Создаю выпуск" disabled={locked && !busy} onClick={onStart}>
          Начать выпуск
        </Button>
      </div>
    </article>
  )
}
