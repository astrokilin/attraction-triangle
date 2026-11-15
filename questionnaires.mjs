import { defaultTraits, groupOrder } from './traits.mjs';
import { allAnswers } from './model.mjs';

const clone = x => structuredClone(x);
const safeId = s => typeof s === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(s) && !['__proto__','prototype','constructor'].includes(s);
const isAnswers = (a, traits) => a && typeof a === 'object' && !Array.isArray(a) && traits.every(t => Object.hasOwn(a,t.id) && (a[t.id] === 0 || a[t.id] === 1));

export const LEGACY_DEFAULT_TRAIT_IDS = defaultTraits.slice(0,16).map(t=>t.id);
export const MIGRATION_DEFAULT_ANSWERS = Object.freeze({height:1,romantic_initiative:0,flirting_style:1,courtship_role:0,physical_intimacy:1,sexual_initiative:0,sexual_dynamics:1});

export function newWorkspace(traits) {
  return {
    own: allAnswers(traits, 1),
    ideals: [
      { id: 'ideal_female', name: 'Партнер 1', answers: allAnswers(traits, 0), weight: 50 },
      { id: 'ideal_male', name: 'Партнер 2', answers: allAnswers(traits, 1), weight: 50 }
    ],
    selected: 'ideal_male'
  };
}
export function makeDefaultQuestionnaire() {
  const traits = clone(defaultTraits);
  return { id: 'default', name: `Исходная расширенная (${traits.length} вопроса)`, builtin: true, revision:3, traits, workspace: newWorkspace(traits) };
}
export function newProject() {
  return { activeQuestionnaireId: 'default', questionnaires: [makeDefaultQuestionnaire()] };
}
export function activeQuestionnaire(project) {
  return project.questionnaires.find(q => q.id === project.activeQuestionnaireId) || project.questionnaires[0];
}
export function makeQuestionnaire(source, id, name, blank = false) {
  if (!safeId(id) || id === 'default' || typeof name !== 'string' || !name.trim()) throw new Error('Неправильное имя или ID анкеты.');
  const traits = blank ? [] : clone(source.traits);
  const workspace = blank ? newWorkspace([]) : clone(source.workspace);
  return {id, name:name.trim().slice(0,80), builtin:false, traits, workspace,
    ...(Object.hasOwn(source,'behaviorContribution')?{behaviorContribution:source.behaviorContribution}:{}),
    ...(!blank&&source.migratedFrom===16?{migratedFrom:16}:{})};
}
export function fillMissingAnswers(questionnaire) {
  const {traits,workspace} = questionnaire;
  for (const t of traits) {
    if (workspace.own[t.id] !== 0 && workspace.own[t.id] !== 1) workspace.own[t.id] = 1;
    for (const p of workspace.ideals) if (p.answers[t.id] !== 0 && p.answers[t.id] !== 1) p.answers[t.id] = 1;
  }
}
export function validateProject(project) {
  if (!project || !Array.isArray(project.questionnaires) || !project.questionnaires.length || project.questionnaires.length > 20) throw new Error('Неправильное число анкет.');
  const qids = new Set();
  for (const q of project.questionnaires) {
    if (!safeId(q.id) || qids.has(q.id) || typeof q.name !== 'string' || !q.name.trim() || q.name.length > 80 || typeof q.builtin !== 'boolean') throw new Error('Неправильная анкета.');
    if (q.id === 'default' && !q.builtin) throw new Error('Исходная анкета должна оставаться встроенной.');
    if (q.id !== 'default' && q.builtin) throw new Error('Нельзя создать другую встроенную анкету.');
    qids.add(q.id);
    if (Object.hasOwn(q,'behaviorContribution') && (!Number.isFinite(q.behaviorContribution) || q.behaviorContribution<0 || q.behaviorContribution>1)) throw new Error('Вклад поведения должен быть числом от 0 до 1.');
    if (!Array.isArray(q.traits) || q.traits.length > 64) throw new Error('Слишком много вопросов.');
    const tids = new Set();
    for (const t of q.traits) {
      if (!safeId(t.id) || tids.has(t.id)) throw new Error('Неверный или повторяющийся ID вопроса.');
      tids.add(t.id);
      if (!groupOrder.includes(t.group) || ![t.question,t.female,t.male,t.note].every(v => typeof v === 'string' && v.length <= 300) || !t.question.trim() || !t.female.trim() || !t.male.trim()) throw new Error('Некорректная формулировка вопроса.');
      if (!Number.isFinite(t.weight) || t.weight < 0.05 || t.weight > 20 || typeof t.enabled !== 'boolean') throw new Error('Некорректные веса вопросов.');
    }
    const w = q.workspace;
    if (!w || !Array.isArray(w.ideals) || !w.ideals.length || w.ideals.length > 30 || !isAnswers(w.own,q.traits)) throw new Error('Некорректные профили.');
    const pids = new Set();
    for (const p of w.ideals) {
      if (!safeId(p.id) || pids.has(p.id) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80 || !Number.isFinite(p.weight) || p.weight < 0 || p.weight > 100 || !isAnswers(p.answers,q.traits)) throw new Error('Некорректный профиль партнера.');
      pids.add(p.id);
    }
    if (!pids.has(w.selected)) throw new Error('Не существует выбранного партнера.');
  }
  if (!qids.has('default') || !qids.has(project.activeQuestionnaireId)) throw new Error('Неизвестная активная анкета.');
  return true;
}
/** Import only data: code never executes any value from the JSON. */
export function importProject(raw) {
  if (raw?.format !== 'representation-triangle-ru-v3') throw new Error('Неизвестный формат файла. Требуется экспорт V3.');
  validateProject(raw.project);
  const project = clone(raw.project);
  // Only the builtin is upgraded. Copies and completely custom questionnaires remain intact.
  const original = project.questionnaires.find(q=>q.id==='default');
  const builtin = makeDefaultQuestionnaire();
  const ids=new Set(original.traits.map(t=>t.id));
  const legacy=original.traits.length===16&&LEGACY_DEFAULT_TRAIT_IDS.every(id=>ids.has(id));
  const current=original.traits.length===builtin.traits.length&&builtin.traits.every(t=>ids.has(t.id));
  if(!legacy&&!current)throw new Error('Неизвестный состав исходной анкеты: ожидаются исходные 16 или 23 признака. Пользовательские анкеты должны иметь собственный ID.');
  builtin.workspace=original.workspace;
  // Legacy group share is intentionally not used by the unified-weight model.
  if(legacy){
    for(const answers of [builtin.workspace.own,...builtin.workspace.ideals.map(p=>p.answers)])Object.assign(answers,MIGRATION_DEFAULT_ANSWERS);
    builtin.migratedFrom=16;
  } else if(original.migratedFrom===16)builtin.migratedFrom=16;
  project.questionnaires = [builtin,...project.questionnaires.filter(q=>q.id!=='default')];
  for (const q of project.questionnaires) {
    // Rename only the original generated defaults, preserving custom partner names.
    for (const p of q.builtin?q.workspace.ideals:[]) {
      if (p.id === 'ideal_female' && p.name === 'Фемининный полюс') p.name = 'Партнер 1';
      if (p.id === 'ideal_male' && p.name === 'Маскулинный полюс') p.name = 'Партнер 2';
    }
    fillMissingAnswers(q);
  }
  validateProject(project);
  return project;
}
