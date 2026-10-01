/* Сквозной сценарий экрана 1 на моках API: диалог «Новый выпуск» → создание → тост → сценарий → «Выпуски»: карточка
   в «Сценарии» и выпуск в ближайшем пустом слоте → переименование в шапке → «Сохранено 12:41» (время записи мока). */
import { expect, test } from './api'

test.skip(({ viewport }) => viewport?.width !== 1536, 'сквозной сценарий идёт на базовой ширине')

test('создать выпуск, увидеть в слоте и на доске, переименовать', async ({ page, apiMock }) => {
  await page.clock.install({ time: new Date('2026-09-11T12:41:00+03:00') })
  await page.goto('/episodes')

  await page.getByRole('button', { name: 'Новый выпуск' }).click()
  const dialog = page.getByRole('dialog', { name: 'Новый выпуск' })
  await expect(dialog.getByRole('radio', { name: 'Cursus' })).toBeFocused()
  await expect(dialog.getByText('Рассказчик во втором лице, 8 разделов, ~100 кадров, ~$3.80 за выпуск')).toBeVisible()
  await dialog.getByRole('button', { name: 'Создать выпуск' }).click()

  await expect(page.getByRole('status').filter({ hasText: 'Выпуск создан: Cursus, слот 23 сентября' })).toBeVisible()
  await expect(page).toHaveURL('/episodes/c11/script')
  const title = page.getByTitle('Переименовать выпуск')
  await expect(title).toHaveText('Новый выпуск')

  await page.getByRole('link', { name: 'Studio' }).click()
  await expect(page).toHaveURL('/episodes')
  const column = page.getByRole('region', { name: 'Сценарий', exact: true })
  await expect(column.getByRole('link', { name: 'Новый выпуск, Сценарий' })).toBeVisible()
  const slot = page.getByRole('region', { name: 'Слоты публикации' }).getByRole('listitem', { name: '23 сентября' })
  await expect(slot).toHaveAttribute('data-state', 'filled')
  await expect(slot).toContainText('Новый выпуск')

  await title.click()
  const input = page.getByRole('textbox', { name: 'Название выпуска' })
  await input.fill('Ottoman Navy: every rank')
  await input.press('Enter')
  await expect(page.getByTestId('save-indicator')).toHaveText('Сохранено 12:41')
  await expect(column.getByRole('link', { name: 'Ottoman Navy: every rank, Сценарий' })).toBeVisible()
  await expect(slot).toContainText('Ottoman Navy: every rank')
  expect(apiMock.api.episodes.find((e) => e.id === 'c11')?.title).toBe('Ottoman Navy: every rank')
})
