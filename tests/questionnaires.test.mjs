import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultTraits} from '../traits.mjs';
import {newProject,makeQuestionnaire,activeQuestionnaire,fillMissingAnswers,validateProject,importProject} from '../questionnaires.mjs';
import {evaluateTriangle} from '../model.mjs';

test('default questionnaire includes the extended set and keeps all 9 original weights',()=>{
  assert.equal(defaultTraits.length,16);
  assert.ok(defaultTraits.every(t=>t.enabled));
  const first9={genitals:3.0,chest:1.8,facial_hair:1.5,voice:1.4,fat_distribution:.9,shoulders:.8,hair:.35,clothing:.55,cosmetics:.25};
  for(const [id,w] of Object.entries(first9)) assert.equal(defaultTraits.find(t=>t.id===id)?.weight,w);
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
