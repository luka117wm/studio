// Testing Library чистит DOM сама только при globals: true — подключаем cleanup явно.
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(cleanup)
