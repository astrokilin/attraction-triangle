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
test('model remains mathematically valid under edited questionnaires',()=>{
  const p=newProject();const c=makeQuestionnaire(activeQuestionnaire(p),'n4','Мои веса');
  c.traits[0].weight=8.5;c.traits[1].enabled=false;
  const r=evaluateTriangle(c.workspace.own,c.workspace.ideals,c.traits);
  assert.equal(r.ok,true);
  assert.ok(Math.abs(r.homo+r.hetero+r.both-1)<1e-10);
  assert.ok(Math.abs(r.homo-r.hetero-r.a*r.mu)<1e-10);
});
