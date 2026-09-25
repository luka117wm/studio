// Типы для typegen.mjs — чтобы тест в TS strict мог импортировать скрипт.
export declare const REPO: string
export declare const TYPES_DIR: string
export declare const REGENERATE: string
export declare const MANUAL: Set<string>
export declare function targetOf(source: string): string
export declare function loadSchemas(): Record<string, string>
export declare function bodyHash(body: string): string
export declare function header(source: string, body: string): string
export declare function parseGenerated(text: string): { hash: string; body: string } | null
export declare function schemaToTs(schema: unknown, source: string): Promise<string>
export declare function generate(schemas?: Record<string, string>): Promise<Map<string, string>>
export declare function check(schemas?: Record<string, string>): Promise<string[]>
export declare function write(schemas?: Record<string, string>): Promise<string[]>
