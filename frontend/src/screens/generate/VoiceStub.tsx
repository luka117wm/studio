/* Панель «Голос» экрана 4 — заглушка на своём месте до модуля M7 (устав M6, решение пользователя): озвучка разделов,
   выравнивание и длина кадров по голосу появятся там. Действий нет. */
import { Mic } from 'lucide-react'
import { EmptyState } from '../../ui'

export function VoiceStub() {
  return (
    <div className="flex h-full items-center justify-center p-3">
      <EmptyState
        icon={Mic}
        title="Голос — в модуле M7"
        description="Озвучка по разделам, выравнивание по словам и длина кадров по голосу появятся в модуле M7. Кадры рисуются и без неё."
      />
    </div>
  )
}
