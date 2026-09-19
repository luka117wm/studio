/* Живые демонстрации с локальным состоянием: диалог, поповер, стек тостов (только компоненты). */
import { useRef, useState } from 'react'
import { useUiStore } from '../../../store/uiStore'
import { Button, Checkbox, Dialog, Popover } from '../../../ui'

export function DialogDemo({ size, title }: { size: 'sm' | 'md' | 'lg' | 'xl'; title: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>{title}</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Утвердить план"
        note={size}
        size={size}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Отмена</Button>
            <Button variant="primary" price={1.61} onClick={() => setOpen(false)}>
              Сгенерировать 24 кадра
            </Button>
          </>
        }
      >
        <p>24 кадра, 3 с анимацией. Бюджет выпуска: $4.00.</p>
      </Dialog>
    </>
  )
}

export function PopoverDemo() {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <span ref={anchorRef}>
        <Button onClick={() => setOpen(true)}>Фильтры</Button>
      </span>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} ariaLabel="Фильтры">
        <div className="flex flex-col gap-2">
          <Checkbox checked onChange={() => {}} label="Только failed" />
          <Checkbox checked={false} onChange={() => {}} label="С анимацией" />
        </div>
      </Popover>
    </>
  )
}

export function ToastStackDemo() {
  const pushToast = useUiStore((s) => s.pushToast)
  const show = () => {
    const items = [
      { id: 'demo-1', message: 'Перерисовано', status: 'ready' as const, action: { label: 'Отменить', onClick: () => {} } },
      { id: 'demo-2', message: 'Озвучено 8 разделов, списано $2.34', status: 'ready' as const },
      { id: 'demo-3', message: 'Кадр s047 не сгенерирован', status: 'failed' as const },
      { id: 'demo-4', message: 'Лимит выпуска близко: $18.20 из $20.00', status: 'warning' as const },
      { id: 'demo-5', message: 'Генерирую 78 из 104', status: 'generating' as const },
    ]
    items.forEach(pushToast)
  }
  return <Button onClick={show}>Показать 5 тостов</Button>
}
