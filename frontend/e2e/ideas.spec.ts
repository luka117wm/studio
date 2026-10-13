/* Сквозные сценарии экрана 2 на моках API, канал Cursus.
   «Тренды»: семя → промпт идей в буфере → ответ чата → «В бэклог» → «Начать выпуск» → экран 3 с заявкой из идеи.
   «Референс»: субтитры → промпт разбора → ответ чата → карта структуры → «Новая тема по этой структуре» → экран 3.
   Ответы чата — `fixtures/` с прозой вокруг JSON; субтитры фикстуры — свой текст. */
import { expect, test } from './api'
import { chatAnswer, clipboardText, grantClipboard, pasteAnswer } from './chat'

test.skip(({ viewport }) => viewport?.width !== 1536, 'сквозные сценарии идут на базовой ширине')

test.beforeEach(async ({ page, baseURL }) => {
  await grantClipboard(page, baseURL)
  await page.clock.install({ time: new Date('2026-09-11T12:41:00+03:00') })
})

test('семена → идеи из чата → бэклог → выпуск', async ({ page, apiMock }) => {
  await page.goto('/ideas')
  const backlog = page.getByRole('region', { name: 'Бэклог идей' })
  await expect(page.getByText('Бэклог: 7 идей')).toBeVisible()

  // 1. Семя ниши — чип и сразу профиль канала
  const seeds = page.getByRole('complementary', { name: 'Семена ниши' })
  await seeds.getByRole('button', { name: 'Семя' }).click()
  await seeds.getByRole('textbox', { name: 'Новое семя' }).fill('mills')
  await seeds.getByRole('textbox', { name: 'Новое семя' }).press('Enter')
  await expect(seeds.getByRole('list', { name: 'Семена ниши' }).getByText('mills')).toBeVisible()
  const profile = apiMock.api.handle('GET', '/api/channels').body as { id: string; seeds?: string[] }[]
  expect(profile.find((c) => c.id === 'cursus')?.seeds).toContain('mills')

  // 2. Промпт идей в буфере, ответ чата: две идеи приняты, повтор бэклога пропущен с причиной
  const chat = page.getByRole('complementary', { name: 'Идеи из чата' })
  await chat.getByRole('button', { name: 'Скопировать промпт идей' }).click()
  await expect.poll(() => clipboardText(page)).toMatch(/^You are the idea editor of the history channel "Cursus"/)
  await pasteAnswer(page, chat.getByRole('textbox', { name: 'Ответ из чата' }), chatAnswer('ideas.txt'))
  await chat.getByRole('button', { name: 'Применить вставку' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Добавлено 2 идеи, пропущено 1' })).toBeVisible()
  await expect(chat.getByRole('list', { name: 'Предупреждения' })).toHaveText('Идея 3: «Every Rank in a Roman Legion» — уже в бэклоге')
  const mill = chat.getByRole('article', { name: 'Every Rank in a Medieval Mill' })
  await expect(mill).toBeVisible()
  await expect(chat.getByRole('article', { name: 'Every Rank in a Byzantine Court' })).toBeVisible()

  // 3. «В бэклог» → карточка в центре, счётчик растёт → «Начать выпуск» → экран 3 с заявкой из идеи
  await mill.getByRole('button', { name: 'В бэклог' }).click()
  await expect(page.getByText('Бэклог: 8 идей')).toBeVisible()
  await expect(mill).toBeHidden()
  await backlog.getByRole('article', { name: 'Every Rank in a Medieval Mill' }).getByRole('button', { name: 'Начать выпуск' }).click()
  await expect(page).toHaveURL('/episodes/c11/script')
  await expect(page.getByRole('status').filter({ hasText: 'Выпуск создан: Cursus, слот 23 сентября' })).toBeVisible()
  const brief = page.getByRole('region', { name: 'Заявка выпуска' })
  await expect(brief.getByRole('textbox', { name: 'Идея' })).toHaveValue('Every Rank in a Medieval Mill')
  await expect(brief.getByRole('textbox', { name: 'Обещание хука' })).toHaveValue('Почему мельника ненавидела вся деревня')
  const idea = (apiMock.api.handle('GET', '/api/ideas?channel=cursus').body as { title: string; status: string; episode_id: string | null }[]).find(
    (i) => i.title === 'Every Rank in a Medieval Mill',
  )
  expect(idea).toMatchObject({ status: 'used', episode_id: 'c11' })
})

test('референс → разбор → выпуск по структуре', async ({ page, apiMock }) => {
  await page.goto('/ideas')
  await page.getByRole('radiogroup', { name: 'Вкладка' }).getByRole('radio', { name: 'Референс' }).click()
  await expect(page).toHaveURL(/tab=reference/)

  // 4. Субтитры: новый референс поверх референса артборда
  const input = page.getByRole('complementary', { name: 'Ввод референса' })
  await input.getByRole('button', { name: 'Новый референс' }).click()
  const form = input.getByRole('form', { name: 'Новый референс' })
  await form.getByRole('textbox', { name: 'Ссылка на ролик' }).fill('youtube.com/watch?v=sample-medieval-mill')
  await pasteAnswer(page, form.getByRole('textbox', { name: 'Субтитры' }), chatAnswer('reference.srt'))
  await form.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Референс сохранён' })).toBeVisible()
  await expect(input.getByRole('region', { name: 'Субтитры референса' }).getByText('9 реплик, 3:00')).toBeVisible()
  const map = page.getByRole('region', { name: 'Карта структуры' })
  await expect(map.getByText('Разбора ещё нет')).toBeVisible()

  // Промпт разбора в буфере → ответ чата → карта из 6 сегментов, метрики и приёмы
  await input.getByRole('button', { name: 'Скопировать промпт разбора' }).click()
  await expect.poll(() => clipboardText(page)).toMatch(/^Analyse the structure of the video "youtube\.com\/watch\?v=sample-medieval-mill"/)
  await pasteAnswer(page, input.getByRole('textbox', { name: 'Ответ из чата' }), chatAnswer('reference-analysis.txt'))
  await input.getByRole('button', { name: 'Применить вставку' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Референс разобран: 6 сегментов' })).toBeVisible()
  await expect(map.getByRole('list', { name: 'Сегменты' }).getByRole('listitem')).toHaveCount(6)
  await expect(map.getByText('Every Rank in a Medieval Mill — Sample, 3:00')).toBeVisible()
  await expect(map.getByLabel('Метрики референса')).toBeVisible()
  await expect(map.getByRole('region', { name: 'Приёмы подачи' }).getByRole('listitem')).toHaveCount(3)

  // «Новая тема по этой структуре» → экран 3: заметка о референсе, идея пустая, режим structure_clone
  await map.getByRole('button', { name: 'Новая тема по этой структуре' }).click()
  await expect(page).toHaveURL('/episodes/c11/script')
  const note = page.getByLabel('Референс выпуска')
  await expect(note.getByRole('link', { name: 'Открыть референс' })).toHaveAttribute('href', '/ideas?tab=reference&ref=ref0002')
  await expect(page.getByRole('form', { name: 'Заявка' }).getByRole('textbox', { name: 'Идея' })).toHaveValue('')
  expect(apiMock.api.projects.get('c11')?.brief).toMatchObject({ reference_id: 'ref0002', reference_mode: 'structure_clone' })
})
