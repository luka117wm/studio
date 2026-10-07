// Панель «Источник плана» экрана 3 на моках API (`mocks/api.ts`): промпт части в буфер, вставка ответа чата.
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderApp } from '../../../app/__tests__/harness'
import { autosaver } from '../../../app/autosave'
import { STYLE_TOKEN } from '../../../mocks/api'
import { useUiStore } from '../../../store/uiStore'

const INITIAL = { channel: 'cursus' as const, episodeId: null, collapsed: { left: false, right: false }, toasts: [] }

let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  useUiStore.setState(INITIAL)
  writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
// Сначала размонтировать, потом снять фейки (L-024)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  autosaver.reset()
  Reflect.deleteProperty(navigator, 'clipboard')
})

async function panel(episodeId: string) {
  renderApp(`/episodes/${episodeId}/script`)
  return screen.findByRole('complementary', { name: 'Источник плана' }, { timeout: 3000 })
}

const copyButton = (root: HTMLElement, part: number, total = 4) =>
  within(root).findByRole('button', { name: `Скопировать промпт части ${part} из ${total}` }, { timeout: 3000 })

async function paste(root: HTMLElement, text: string) {
  await userEvent.click(within(root).getByRole('textbox', { name: 'Ответ из чата' }))
  await userEvent.paste(text)
  await userEvent.click(within(root).getByRole('button', { name: 'Применить вставку' }))
}

const strip = (root: HTMLElement, part: number) =>
  within(within(root).getByRole('list', { name: 'Части плана' })).getAllByRole('listitem')[part - 1]

describe('копирование промпта', () => {
  test('без идеи кнопка выключена с подписью; идея в заявке её включает', async () => {
    const root = await panel('monastery')
    const copy = await copyButton(root, 1)
    expect((copy as HTMLButtonElement).disabled).toBe(true)
    expect(within(root).getByText('Заполните идею')).toBeTruthy()

    await userEvent.type(await screen.findByRole('textbox', { name: 'Идея' }), 'Monastery ranks')
    expect((copy as HTMLButtonElement).disabled).toBe(false)
    expect(within(root).queryByText('Заполните идею')).toBeNull()
  })

  test('с заявкой — промпт части в буфере и тост', async () => {
    const root = await panel('samurai')
    await userEvent.click(await copyButton(root, 1))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0]?.[0]).toBe('Write part 1 of 4 of the director plan for episode samurai.')
    expect(await screen.findByText('Промпт части 1 из 4 скопирован')).toBeTruthy()
  })

  test('буфер отказал — диалог с текстом промпта, скопировать вручную', async () => {
    writeText.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
    const root = await panel('samurai')
    await userEvent.click(await copyButton(root, 1))
    const dialog = await screen.findByRole('dialog', { name: 'Промпт для чата' })
    expect(within(dialog).getByText('Буфер обмена недоступен. Выделите и скопируйте вручную.')).toBeTruthy()
    const text = within(dialog).getByRole('textbox', { name: 'Текст промпта' }) as HTMLTextAreaElement
    expect(text.value).toBe('Write part 1 of 4 of the director plan for episode samurai.')
    expect(text.readOnly).toBe(true)
  })
})

describe('вставка ответа', () => {
  test('часть принята: полоска ready, подпись, тост, поле очищено, следующая часть', async () => {
    const root = await panel('samurai')
    const apply = within(root).getByRole('button', { name: 'Применить вставку' }) as HTMLButtonElement
    expect(apply.disabled).toBe(true)

    await paste(root, '{"meta": {"part": 1}}')
    expect(await screen.findByText('Часть 1 из 4 принята, 26 кадров')).toBeTruthy()
    await waitFor(() => expect(strip(root, 1)?.getAttribute('data-state')).toBe('ready'))
    expect(strip(root, 2)?.getAttribute('data-state')).toBe('queued')
    expect(within(root).getByText('Часть 1 вставлена, 26 кадров. Ждёт часть 2.')).toBeTruthy()
    expect((within(root).getByRole('textbox', { name: 'Ответ из чата' }) as HTMLTextAreaElement).value).toBe('')
    expect(await copyButton(root, 2)).toBeTruthy()
  })

  test('отказ: текст, подсказка и ошибки с id кадра; поле не очищено, полоска failed', async () => {
    const root = await panel('samurai')
    const answer = `{"image": {"prompt": "runs, ${STYLE_TOKEN}"}}`
    await paste(root, answer)

    const alert = await within(root).findByRole('alert')
    expect(within(alert).getByText('Часть 1 не прошла проверку: 1 ошибка.')).toBeTruthy()
    expect(within(alert).getByText('Попросите чат исправить кадр s003 и прислать часть целиком.')).toBeTruthy()
    const issues = within(within(alert).getByRole('list', { name: 'Ошибки ответа' })).getAllByRole('listitem')
    expect(issues.map((li) => li.textContent)).toEqual([
      'кадр s003: в image.prompt стилевой токен «cinematic lighting» (lighting), ожидалось только действие, ' +
        'композиция и ракурс — стиль задаёт канон',
    ])
    expect((within(root).getByRole('textbox', { name: 'Ответ из чата' }) as HTMLTextAreaElement).value).toBe(answer)
    await waitFor(() => expect(strip(root, 1)?.getAttribute('data-state')).toBe('failed'))
  })

  test('последняя часть — новая версия плана: тост, план в центре, счётчики', async () => {
    const root = await panel('samurai')
    for (const part of [1, 2, 3]) {
      await paste(root, `part ${part}`)
      expect(await copyButton(root, part + 1)).toBeTruthy()
    }
    await paste(root, 'part 4')
    expect(await screen.findByText('План v001: +104 кадра')).toBeTruthy()
    expect(await screen.findByRole('article', { name: 'План' }, { timeout: 3000 })).toBeTruthy()
    expect(screen.getByText('Кадры', { selector: 'dt' }).nextElementSibling?.textContent).toBe('104')
    expect(within(root).getByText('План v001 принят. Новая версия — с части 1.')).toBeTruthy()
  })
})

describe('источник плана', () => {
  test('«Claude API» выключен, подсказка с причиной из настроек', async () => {
    const root = await panel('samurai')
    const api = within(root).getByRole('radio', { name: 'Claude API' })
    expect(api.getAttribute('aria-disabled')).toBe('true')
    expect(within(root).getByRole('radio', { name: 'Мост через чат' }).getAttribute('aria-checked')).toBe('true')
    // Подсказка появляется с ответом настроек: сегмент перемонтируется в якорь Tooltip — берём его заново
    await waitFor(() => {
      within(root).getByRole('radio', { name: 'Claude API' }).focus()
      expect(screen.getByRole('tooltip').textContent).toBe('Нет ключа ANTHROPIC_API_KEY — docs/api_keys.md')
    })
  })
})
