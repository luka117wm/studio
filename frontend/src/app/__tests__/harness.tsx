// Оболочка целиком на моках API: fetch → `mocks/api.ts`, EventSource — фейк. Свой кэш запросов на тест.
import { render } from '@testing-library/react'
import { StrictMode } from 'react'
import { stubApi, stubEventSource, type ApiStub } from '../../api/__tests__/fakes'
import { AppShell } from '../AppShell'
import { createQueryClient } from '../../api/queryClient'
import { Providers } from '../providers'

export function renderApp(path: string, options: { stub?: ApiStub; strict?: boolean } = {}) {
  const stub = options.stub ?? stubApi()
  stubEventSource()
  window.history.replaceState(null, '', path)
  const client = createQueryClient({ retryDelay: 0 })
  const tree = (
    <Providers client={client}>
      <AppShell />
    </Providers>
  )
  const result = render(options.strict ? <StrictMode>{tree}</StrictMode> : tree)
  return { ...result, stub, client }
}
