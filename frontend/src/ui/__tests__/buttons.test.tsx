import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Plus } from 'lucide-react'
import { describe, expect, test, vi } from 'vitest'
import { Button, type ButtonVariant } from '../Button'
import { IconButton } from '../IconButton'

const variants: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger', 'statusOutline']

describe('Button', () => {
  test.each(variants)('вариант %s рендерится и кликается', async (variant) => {
    const onClick = vi.fn()
    render(
      <Button variant={variant} onClick={onClick}>
        Сохранить
      </Button>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  test('цена попадает в подпись до цента', () => {
    render(<Button price={1.605}>Сгенерировать 24 кадра</Button>)
    expect((screen.getByRole('button')).textContent).toContain('Сгенерировать 24 кадра (~$1.61)')
  })

  test('loading: подпись состояния, aria-busy, клики не проходят', async () => {
    const onClick = vi.fn()
    render(
      <Button loading loadingLabel="Генерирую 14 из 24" price={1.61} onClick={onClick}>
        Сгенерировать
      </Button>,
    )
    const button = screen.getByRole('button')
    expect((button).textContent).toContain('Генерирую 14 из 24')
    expect((button).textContent).not.toContain('$')
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.hasAttribute('disabled')).toBe(true)
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  test('disabled не кликается', async () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Нет
      </Button>,
    )
    await userEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  test('иконка скрыта от AT, имя — текст', () => {
    render(<Button icon={Plus}>Добавить кадр</Button>)
    const button = screen.getByRole('button', { name: 'Добавить кадр' })
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('IconButton', () => {
  test('доступное имя и title из label', () => {
    render(<IconButton icon={Plus} label="Добавить" />)
    const button = screen.getByRole('button', { name: 'Добавить' })
    expect(button.getAttribute('title')).toBe('Добавить')
  })

  test('вариант dangerHover рендерится', async () => {
    const onClick = vi.fn()
    render(<IconButton icon={Plus} label="Удалить" variant="dangerHover" onClick={onClick} />)
    await userEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(onClick).toHaveBeenCalled()
  })
})
