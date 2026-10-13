// Несохранённый текст режима «JSON» по выпуску (M4.7): живёт в памяти вкладки до «Сохранить как версию» или
// «Уйти без сохранения», поэтому переход на другой экран его не теряет. Черновик привязан к версии, с которой
// начат: пришла новая версия — старый текст не подставляется.
const drafts = new Map<string, { version: string; text: string }>()

/** Текст черновика для версии `version`; другой версии или черновика нет — null */
export function readJsonDraft(episodeId: string, version: string): string | null {
  const draft = drafts.get(episodeId)
  return draft?.version === version ? draft.text : null
}

/** Текст совпал с файлом версии — черновика нет */
export function writeJsonDraft(episodeId: string, version: string, text: string, base: string): void {
  if (text === base) drafts.delete(episodeId)
  else drafts.set(episodeId, { version, text })
}

/** В режиме «JSON» выпуска есть правки, не сохранённые версией */
export const hasJsonDraft = (episodeId: string): boolean => drafts.has(episodeId)
export const discardJsonDraft = (episodeId: string): void => void drafts.delete(episodeId)
