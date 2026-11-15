import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultTraits,BEHAVIOR_GROUP} from '../traits.mjs';
import {newProject,makeQuestionnaire,activeQuestionnaire,fillMissingAnswers,validateProject,importProject,MIGRATION_DEFAULT_ANSWERS} from '../questionnaires.mjs';
import {evaluateIdentity,evaluateTriangle} from '../model.mjs';
import {readFileSync} from 'node:fs';
const legacyFixture=()=>JSON.parse(readFileSync(new URL('./fixtures/legacy-v3.json',import.meta.url),'utf8'));

test('23 default questions preserve all 16 original IDs, groups, weights and polarity',()=>{
  assert.equal(defaultTraits.length,23);
  assert.ok(defaultTraits.every(t=>t.enabled));
  const old=legacyFixture().project.questionnaires[0].traits;
  assert.deepEqual(defaultTraits.slice(0,16).map(t=>t.id),old.map(t=>t.id));
  for(const previous of old){
    const current=defaultTraits.find(t=>t.id===previous.id);
    assert.equal(current.weight,previous.weight);assert.equal(current.group,previous.group);
    assert.notEqual(current.female,current.male);assert.match(current.question,/[А-Яа-яЁё]/);
  }
  assert.equal(defaultTraits.find(t=>t.id==='genitals').female,'Женские');
  assert.equal(defaultTraits.find(t=>t.id==='genitals').male,'Мужские');
  assert.match(defaultTraits.find(t=>t.id==='chest').female,/молочные железы/);
  assert.match(defaultTraits.find(t=>t.id==='chest').male,/не выражены/);
  assert.equal(defaultTraits.find(t=>t.id==='height').weight,.85);
  assert.deepEqual(defaultTraits.filter(t=>t.group===BEHAVIOR_GROUP).map(t=>t.id),['romantic_initiative','flirting_style','courtship_role','physical_intimacy','sexual_initiative','sexual_dynamics']);
  assert.ok(defaultTraits.filter(t=>t.group===BEHAVIOR_GROUP).every(t=>t.weight===1));
  for(const t of defaultTraits)for(const field of ['question','female','male'])assert.match(t[field],/[А-Яа-яЁё]/);
});
test('default questionnaire selected and source is immutable by convention',()=>{
  const p=newProject();assert.equal(activeQuestionnaire(p).id,'default');
  assert.equal(activeQuestionnaire(p).builtin,true);
  assert.ok(validateProject(p));
});
test('fresh and blank workspaces use numbered partners without changing their profiles',()=>{
  const q=activeQuestionnaire(newProject());
  for (const workspace of [q.workspace,makeQuestionnaire(q,'blank_names','Пустая',true).workspace]) {
    assert.deepEqual(workspace.ideals.map(p=>p.name),['Партнер 1','Партнер 2']);
    assert.equal(workspace.selected,'ideal_male');
    assert.deepEqual(workspace.ideals.map(p=>p.weight),[50,50]);
  }
  assert.ok(Object.values(q.workspace.ideals[0].answers).every(a=>a===0));
  assert.ok(Object.values(q.workspace.ideals[1].answers).every(a=>a===1));
});
test('legacy default names migrate without changing answers, weights, selection or source data',()=>{
  const project=newProject(),workspace=activeQuestionnaire(project).workspace;
  workspace.ideals[0].name='Фемининный полюс';
  workspace.ideals[1].name='Маскулинный полюс';
  workspace.ideals[0].answers.genitals=1;
  workspace.ideals[1].weight=73;
  workspace.selected=workspace.ideals[0].id;
  const before=structuredClone(workspace);
  const restored=activeQuestionnaire(importProject({format:'representation-triangle-ru-v3',project})).workspace;
  assert.deepEqual(restored,{...before,ideals:before.ideals.map((p,i)=>({...p,name:`Партнер ${i+1}`}))});
  assert.deepEqual(workspace,before);
});
test('imports and questionnaire copies preserve custom partner names',()=>{
  const project=newProject(),q=activeQuestionnaire(project);
  q.workspace.ideals[0].name='Саша <3';
  q.workspace.ideals[1].name='Мой партнер';
  const custom=makeQuestionnaire(q,'custom_names','Моя анкета');
  custom.workspace.ideals[0].id='custom_partner';
  custom.workspace.ideals[0].name='Фемининный полюс';
  project.questionnaires.push(custom);
  const restored=importProject(JSON.parse(JSON.stringify({format:'representation-triangle-ru-v3',project})));
  assert.deepEqual(restored,project);
});
test('duplicated questionnaire can diverge without modifying default',()=>{
  const p=newProject(),base=activeQuestionnaire(p);
  const c=makeQuestionnaire(base,'new_1','Моя анкета');p.questionnaires.push(c);p.activeQuestionnaireId=c.id;
  c.traits[0].weight=7.5;c.traits[0].question='Новый вопрос';
  assert.equal(base.traits[0].weight,3);assert.notEqual(base.traits[0].question,c.traits[0].question);
  assert.ok(validateProject(p));
});
test('blank questionnaire can have traits added and answers filled',()=>{
  const p=newProject();const c=makeQuestionnaire(activeQuestionnaire(p),'new_2','Пустая',true);
  assert.equal(c.traits.length,0);
  c.traits.push({id:'n1',question:'Вопрос?',female:'А',male:'Б',group:'Пользовательские гипотезы',weight:0.5,enabled:true,note:''});
  fillMissingAnswers(c);p.questionnaires.push(c);p.activeQuestionnaireId=c.id;
  assert.equal(c.workspace.own.n1,1);assert.equal(c.workspace.ideals[0].answers.n1,1);
  assert.ok(validateProject(p));
});
test('JSON round trip preserves workspaces and custom question edits',()=>{
  const p=newProject();const c=makeQuestionnaire(activeQuestionnaire(p),'new_3','Тест');
  p.questionnaires.push(c);p.activeQuestionnaireId=c.id;c.traits[5].weight=.45;
  c.workspace.own.genitals=0;c.workspace.ideals[0].answers.genitals=1;
  const r=importProject(JSON.parse(JSON.stringify({format:'representation-triangle-ru-v3',project:p})));
  assert.ok(validateProject(r));assert.equal(r.activeQuestionnaireId,c.id);
  assert.equal(activeQuestionnaire(r).traits[5].weight,.45);
  assert.equal(activeQuestionnaire(r).workspace.own.genitals,0);
  assert.equal(r.questionnaires[0].traits[0].weight,3);
});
test('invalid imports rejected',()=>{
  const p=newProject();p.questionnaires[0].traits[0].id='__proto__';
  assert.throws(()=>importProject({format:'representation-triangle-ru-v3',project:p}));
});
test('JSON round trips and questionnaire copies retain all duplicate records and their saved weights',()=>{
  const project=newProject(),q=activeQuestionnaire(project);
  q.workspace.ideals[0].weight=23;q.workspace.ideals[1].weight=77;
  const baseline=evaluateTriangle(q.workspace.own,q.workspace.ideals,q.traits);
  q.workspace.ideals.push({...structuredClone(q.workspace.ideals[0]),id:'saved_copy',name:'Моя сохранённая копия',weight:99});
  q.workspace.selected='saved_copy';
  const before=structuredClone(project);
  const restored=importProject(JSON.parse(JSON.stringify({format:'representation-triangle-ru-v3',project})));
  assert.deepEqual(restored,before);
  assert.deepEqual(project,before);
  const loaded=activeQuestionnaire(restored);
  assert.equal(loaded.workspace.ideals.length,3);
  assert.deepEqual(evaluateTriangle(loaded.workspace.own,loaded.workspace.ideals,loaded.traits),baseline);
  const copy=makeQuestionnaire(loaded,'with_duplicates','Копия анкеты');
  assert.deepEqual(copy.workspace,loaded.workspace);
});
test('model remains mathematically valid under edited questionnaires',()=>{
  const p=newProject();const c=makeQuestionnaire(activeQuestionnaire(p),'n4','Мои веса');
  c.traits[0].weight=8.5;c.traits[1].enabled=false;
  const r=evaluateTriangle(c.workspace.own,c.workspace.ideals,c.traits);
  assert.equal(r.ok,true);
  assert.ok(Math.abs(r.homo+r.hetero+r.both-1)<1e-10);
  assert.ok(Math.abs(r.homo-r.hetero-r.a*r.mu)<1e-10);
});

test('legacy V3 builtin migration preserves old answers, names, weights, selection and all duplicates',()=>{
  const raw=legacyFixture(),w=raw.project.questionnaires[0].workspace;
  w.own.genitals=0;w.ideals[0].answers.chest=1;
  w.ideals[0].name='Мой первый';w.ideals[0].weight=23;w.ideals[1].weight=77;
  w.ideals.push({...structuredClone(w.ideals[0]),id:'old_copy',name:'Старая копия',weight:99});w.selected='old_copy';
  const before=structuredClone(raw),restored=importProject(raw),q=activeQuestionnaire(restored);
  assert.deepEqual(raw,before,'migration must not mutate the input');
  assert.equal(q.traits.length,23);assert.equal(q.migratedFrom,16);assert.equal(Object.hasOwn(q,'behaviorContribution'),false);
  const expected=structuredClone(w);
  for(const answers of [expected.own,...expected.ideals.map(p=>p.answers)])Object.assign(answers,MIGRATION_DEFAULT_ANSWERS);
  assert.deepEqual(q.workspace,expected);
  assert.deepEqual(importProject({format:'representation-triangle-ru-v3',project:restored}),restored,'migration is idempotent');
});

test('old modified copies and entirely custom questionnaires remain byte-for-byte equivalent as data',()=>{
  const raw=legacyFixture(),old=raw.project.questionnaires[0];
  const copied=makeQuestionnaire(old,'old_copy','Мои изменённые 16 вопросов');
  copied.traits[0].weight=7.25;copied.traits[1].female='Мой вариант';copied.traits[0].question='Мой старый вопрос?';
  copied.workspace.ideals[0].name='Фемининный полюс';
  const custom=makeQuestionnaire(old,'totally_custom','Своя анкета',true);
  custom.traits=[{id:'custom_only',group:'Пользовательские гипотезы',question:'Мой вопрос?',female:'А',male:'Б',note:'',enabled:true,weight:2.5}];
  fillMissingAnswers(custom);
  raw.project.questionnaires.push(copied,custom);raw.project.activeQuestionnaireId=copied.id;
  const before=structuredClone([copied,custom]);
  const restored=importProject(raw);
  assert.deepEqual(restored.questionnaires.slice(1),before);
  assert.equal(restored.activeQuestionnaireId,copied.id);
  assert.equal(activeQuestionnaire(restored).traits.length,16);
});

test('legacy behaviorContribution field remains importable but is ignored in the new unified model',()=>{
  const project=newProject();
  project.questionnaires[0].behaviorContribution=.3;
  const custom=makeQuestionnaire(activeQuestionnaire(project),'group_copy','Моя старая анкета');
  project.questionnaires.push(custom);
  const restored=importProject(JSON.parse(JSON.stringify({format:'representation-triangle-ru-v3',project})));
  assert.equal(Object.hasOwn(restored.questionnaires[0],'behaviorContribution'),false);
  assert.equal(restored.questionnaires[1].behaviorContribution,.3,'custom legacy metadata is preserved for JSON compatibility');
  const answers=Object.fromEntries(restored.questionnaires[1].traits.map(t=>[t.id,t.group===BEHAVIOR_GROUP?0:1]));
  const a=evaluateIdentity(answers,restored.questionnaires[1].traits).value;
  assert.ok(Math.abs(a-9.05/21.05)<1e-12,'mixed answers distinguish unified weights from the obsolete 70/30 calculation');
});

test('unknown builtin dimensions are rejected explicitly rather than dropping stored answers',()=>{
  const raw=legacyFixture();raw.project.questionnaires[0].traits[0].id='unknown_genitals';
  for(const a of [raw.project.questionnaires[0].workspace.own,...raw.project.questionnaires[0].workspace.ideals.map(p=>p.answers)])a.unknown_genitals=a.genitals;
  assert.throws(()=>importProject(raw),/Неизвестный состав/);
});
