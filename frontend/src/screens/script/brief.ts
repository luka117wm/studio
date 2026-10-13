import type { EpisodeBrief } from '@/types/project'

/** Заявка, которой ещё нет (`project.json → brief: null`): первое изменение создаёт её целиком */
export const EMPTY_BRIEF: EpisodeBrief = {
  idea: '',
  angle: '',
  hook_promise: '',
  notes: '',
  sources: [],
  idea_id: null,
  reference_id: null,
  reference_mode: 'none',
}
