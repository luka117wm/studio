import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, test } from 'vitest'
import { TabPanel } from '../TabPanel'
import { Tabs } from '../Tabs'

type Id = 'shot' | 'vo' | 'sfx'

function Harness() {
  const [value, setValue] = useState<Id>('shot')
  return (
    <>
      <Tabs
        ariaLabel="Инспектор"
        value={value}
        onChange={setValue}
        tabs={[
          { id: 'shot', label: 'Кадр' },
          { id: 'vo', label: 'Голос', disabled: true },
          { id: 'sfx', label: 'SFX' },
        ]}
      />
      <TabPanel id="shot" active={value === 'shot'}>
        Панель кадра
      </TabPanel>
      <TabPanel id="sfx" active={value === 'sfx'}>
        Панель SFX
      </TabPanel>
    </>
  )
}

describe('Tabs', () => {
  test('aria-selected, панели связаны, стрелки пропускают disabled', async () => {
    render(<Harness />)
    const shot = screen.getByRole('tab', { name: 'Кадр' })
    expect(shot.getAttribute('aria-selected')).toBe('true')
    const panel = screen.getByRole('tabpanel')
    expect(panel.id).toBe(shot.getAttribute('aria-controls'))
    expect(panel.textContent).toBe('Панель кадра')
    shot.focus()
    await userEvent.keyboard('{ArrowRight}')
    const sfx = screen.getByRole('tab', { name: 'SFX' })
    expect(sfx.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(sfx)
    expect(screen.getByRole('tabpanel').textContent).toBe('Панель SFX')
    await userEvent.keyboard('{ArrowRight}')
    expect(shot.getAttribute('aria-selected')).toBe('true')
  })
})
