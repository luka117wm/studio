/* Заявка выпуска (устав M4, решение 5): с чем выпуск идёт в чат за планом. Поля — `project.json → brief`;
   запись — автосохранением экрана (ключ `brief:<id>`), здесь только поля. */
import { Plus, Trash2 } from 'lucide-react'
import { useId } from 'react'
import type { EpisodeBrief } from '@/types/project'
import { Button, IconButton, Input, Textarea } from '../../ui'

export interface BriefFormProps {
  value: EpisodeBrief
  onChange: (next: EpisodeBrief) => void
}

type TextField = 'idea' | 'angle' | 'hook_promise' | 'notes'

const FIELDS: { field: TextField; label: string; placeholder: string; multiline?: boolean }[] = [
  { field: 'idea', label: 'Идея', placeholder: 'О чём выпуск: тема и эпоха' },
  { field: 'angle', label: 'Угол подачи', placeholder: 'Через чьи глаза и в каком порядке' },
  { field: 'hook_promise', label: 'Обещание хука', placeholder: 'Что зритель узнает к концу' },
  { field: 'notes', label: 'Заметки для чата', placeholder: 'Что учесть: факты, тон, чего избегать', multiline: true },
]

export function BriefForm({ value, onChange }: BriefFormProps) {
  const base = useId()
  const set = (patch: Partial<EpisodeBrief>) => onChange({ ...value, ...patch })
  const setSource = (index: number, patch: Partial<EpisodeBrief['sources'][number]>) =>
    set({ sources: value.sources.map((source, i) => (i === index ? { ...source, ...patch } : source)) })

  return (
    <form aria-label="Заявка" className="flex flex-col gap-3" onSubmit={(e) => e.preventDefault()}>
      {FIELDS.map(({ field, label, placeholder, multiline }) => {
        const id = `${base}-${field}`
        return (
          <div key={field} className="flex flex-col gap-1">
            <label htmlFor={id} className="text-12 text-muted">
              {label}
            </label>
            {multiline ? (
              <Textarea id={id} value={value[field]} onChange={(v) => set({ [field]: v })} placeholder={placeholder} rows={3} />
            ) : (
              <Input id={id} value={value[field]} onChange={(v) => set({ [field]: v })} placeholder={placeholder} />
            )}
          </div>
        )
      })}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-12 text-muted">Источники</legend>
        {value.sources.map((source, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              value={source.title}
              onChange={(title) => setSource(index, { title })}
              placeholder="Название"
              ariaLabel={`Источник ${index + 1}: название`}
              className="flex-1"
            />
            <Input
              value={source.url}
              onChange={(url) => setSource(index, { url })}
              type="url"
              placeholder="https://…"
              ariaLabel={`Источник ${index + 1}: ссылка`}
              className="flex-1"
            />
            <IconButton
              icon={Trash2}
              label={`Убрать источник ${index + 1}`}
              onClick={() => set({ sources: value.sources.filter((_, i) => i !== index) })}
            />
          </div>
        ))}
        <div>
          <Button variant="ghost" icon={Plus} onClick={() => set({ sources: [...value.sources, { title: '', url: '' }] })}>
            Добавить источник
          </Button>
        </div>
      </fieldset>
    </form>
  )
}
