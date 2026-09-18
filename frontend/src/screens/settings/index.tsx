/* Экран 9 «Настройки и расходы»: навигация 224 фикс. + раздел. Содержимое — M11. */
import { KeyRound, Settings } from 'lucide-react'
import { useState } from 'react'
import { PanelHeader } from '../../app/PanelHeader'
import { ScreenLayout } from '../../app/ScreenLayout'
import type { RouteParams } from '../../app/routes'
import { channelById } from '../../mocks/fixtures'
import { useUiStore } from '../../store/uiStore'
import { EmptyState, cn } from '../../ui'

const SECTIONS = ['Провайдеры', 'Маршрутизация', 'Бюджеты', 'Расходы', 'Каналы'] as const
type Section = (typeof SECTIONS)[number]

export function SettingsScreen(_props: { params: RouteParams }) {
  const [section, setSection] = useState<Section>('Провайдеры')
  const channel = channelById(useUiStore((s) => s.channel))
  const quota = channel.voiceQuota
  return (
    <ScreenLayout
      left={{
        kind: 'settingsNav',
        title: 'Настройки',
        icon: Settings,
        children: (
          <nav aria-label="Разделы настроек" className="flex flex-col py-1">
            {SECTIONS.map((s) => (
              <button
                key={s}
                type="button"
                aria-current={s === section ? 'page' : undefined}
                onClick={() => setSection(s)}
                className={cn('flex h-row-md items-center px-3 text-left text-13', s === section ? 'bg-raised text-ink' : 'text-muted hover:text-ink')}
              >
                {s}
              </button>
            ))}
          </nav>
        ),
      }}
    >
      <PanelHeader
        title={section}
        note={`${channel.name} · ElevenLabs ${quota.usedChars.toLocaleString('ru-RU')} из ${quota.limitChars.toLocaleString('ru-RU')} символов`}
      />
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <EmptyState
          icon={KeyRound}
          title="Ключи провайдеров не заданы"
          description="Anthropic, Gemini, ElevenLabs, Kling, YouTube. Ключи лежат в backend/.env, фронт к провайдерам не ходит."
          primary={{ label: 'Добавить ключ', onClick: () => {} }}
        />
      </div>
    </ScreenLayout>
  )
}
