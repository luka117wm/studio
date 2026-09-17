// Типы для sync-tokens.mjs — чтобы тест в TS strict мог импортировать скрипт.
export declare const SOURCE: string
export declare const TARGET: string
export declare function compare(): { inSync: boolean; source: string; target: string | null }
export declare function write(): boolean
