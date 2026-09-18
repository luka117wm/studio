/* Штриховка 45°: две полосы из токенов accent / accent-hatch-dark, плитка 8px тайлится без шва.
   Бег — @keyframes ui-hatch из kit.css; при prefers-reduced-motion штриховка стоит.
   Строки литеральные: сканер Tailwind не видит классы, склеенные в рантайме. */
export const HATCH =
  'bg-[linear-gradient(45deg,var(--accent)_25%,var(--accent-hatch-dark)_25%,var(--accent-hatch-dark)_50%,var(--accent)_50%,var(--accent)_75%,var(--accent-hatch-dark)_75%)] bg-size-[8px_8px] animate-[ui-hatch_0.6s_linear_infinite] motion-reduce:animate-none'

/** То же на псевдоэлементе ::after — нижняя кромка loading-кнопки. */
export const HATCH_AFTER =
  'after:bg-[linear-gradient(45deg,var(--accent)_25%,var(--accent-hatch-dark)_25%,var(--accent-hatch-dark)_50%,var(--accent)_50%,var(--accent)_75%,var(--accent-hatch-dark)_75%)] after:bg-size-[8px_8px] after:animate-[ui-hatch_0.6s_linear_infinite] after:motion-reduce:animate-none'
