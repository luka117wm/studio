/* Реестр демонстраций каталога состояний (экран 10). Компонент → набор состояний; продуктовые состояния — отдельно.
   Каталог строится только отсюда; тест покрытия сверяет реестр с экспортами src/ui. */
import type { ReactNode } from 'react'
import type * as ui from '../../ui'
import { controls } from './demos/controls'
import { empty } from './demos/empty'
import { errors } from './demos/errors'
import { feedback } from './demos/feedback'
import { inputs } from './demos/inputs'
import { layers } from './demos/layers'
import { productStates } from './demos/product'

type Ui = typeof ui

/** Имена компонентов кита: экспорты-функции с заглавной буквы (cn, formatPrice, statusLabel — не компоненты) */
export type UiComponentName = {
  [K in keyof Ui]: K extends Capitalize<K> ? (Ui[K] extends (...args: never[]) => unknown ? K : never) : never
}[keyof Ui]

export type DemoGroupId = 'controls' | 'inputs' | 'layers' | 'feedback' | 'empty' | 'errors'

export interface Demo {
  component: UiComponentName
  /** Какие состояния показаны */
  state: string
  node: ReactNode
  note?: string
}

export interface DemoGroup {
  id: DemoGroupId
  title: string
  demos: Demo[]
}

export const groups: DemoGroup[] = [
  { id: 'controls', title: 'Управление', demos: controls },
  { id: 'inputs', title: 'Ввод', demos: inputs },
  { id: 'layers', title: 'Слои', demos: layers },
  { id: 'feedback', title: 'Обратная связь', demos: feedback },
  { id: 'empty', title: 'Пустые состояния', demos: empty },
  { id: 'errors', title: 'Состояния ошибок', demos: errors },
]

export type ProductSectionId = 'empty' | 'process' | 'errors' | 'conflict'

export interface ProductState {
  id: string
  section: ProductSectionId
  /** Где в продукте: «Выпуски — пусто» */
  where: string
  /** Условие: «первый запуск» */
  note: string
  noteWarning?: boolean
  node: ReactNode
}

export const productSections: { id: ProductSectionId; title: string; status: string }[] = [
  { id: 'empty', title: 'Пустые', status: 'Пустые состояния: каждое предлагает следующее действие' },
  { id: 'process', title: 'Процесс', status: 'Процессы: этап, процент, пауза и отмена в каждом' },
  { id: 'errors', title: 'Ошибки', status: 'Ошибки: что случилось и что сделать' },
  { id: 'conflict', title: 'Конфликт', status: 'Конфликт плана и генерации: 6 кадров устарели' },
]

export { productStates }

export function allDemos(): Demo[] {
  return groups.flatMap((g) => g.demos)
}

export function demosFor(component: UiComponentName): Demo[] {
  return allDemos().filter((d) => d.component === component)
}

/** Компоненты, у которых есть хотя бы одна демонстрация */
export function coveredComponents(): Set<string> {
  return new Set(allDemos().map((d) => d.component))
}
