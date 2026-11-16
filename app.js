import { groupOrder } from './traits.mjs';
import { evaluateIdentity, evaluateTriangle, allAnswers, nearestToZero, partnerVectorKey, uniquePartnerProfiles } from './model.mjs';
import { validateNonzeroIdentity } from './weight_validation.mjs';
import { newProject, makeQuestionnaire, activeQuestionnaire, fillMissingAnswers, importProject } from './questionnaires.mjs';

const $ = id => document.getElementById(id);
const clone = value => structuredClone(value);
const uid = () => `item_${Math.random().toString(36).slice(2, 12)}`;
const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch]);
const fixed = value => (value >= 0 ? '+' : '') + (value!==0&&Math.abs(value)<.0005?value.toExponential(2):value.toFixed(3));
const plain = value => value.toFixed(3);
const percent = value => `${(value*100).toFixed(1)}%`;
const questionCount = count => `${count} ${{one:'вопрос',few:'вопроса',many:'вопросов',other:'вопроса'}[new Intl.PluralRules('ru').select(count)]}`;
const STORAGE_KEY='representation-triangle-ru-v3';

let project = newProject();
let loadedProject=false;
try {
  const saved=localStorage.getItem(STORAGE_KEY);
  if (saved) {project=importProject(JSON.parse(saved));loadedProject=true;}
} catch(err) { console.warn('Локальный проект недоступен: ',err); }
const current = () => activeQuestionnaire(project);
const workspace = () => current().workspace;
const selectedIdeal = () => workspace().ideals.find(p=>p.id===workspace().selected) || workspace().ideals[0];
function persist() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({format:'representation-triangle-ru-v3',project})); } catch(err) { console.warn('Не удалось сохранить состояние: ',err); } }
function change(options) { renderAll(options); persist(); }

function renderQuestionnaireSelect() {
  const select=$('questionnaireSelect');
  select.innerHTML=project.questionnaires.map(q=>`<option value="${escapeHtml(q.id)}" ${q.id===project.activeQuestionnaireId?'selected':''}>${escapeHtml(q.name)}</option>`).join('');
  const q=current();
  $('questionnaireStatus').textContent = `${questionCount(q.traits.length)}, ${q.traits.filter(t=>t.enabled).length} активных · ${q.builtin?'Вопросы исходной анкеты: только чтение. Для изменения вопросов и их весов создайте копию.':'Пользовательская анкета: вопросы и веса можно редактировать. Автосохранение в этом браузере.'}`;
  $('renameQuestionnaireBtn').disabled=q.builtin;
  $('deleteQuestionnaireBtn').disabled=q.builtin;
  document.querySelectorAll('button[data-preset]').forEach(btn=>{
    btn.disabled=!q.traits.some(t=>t.enabled && t.weight>0);
    btn.title=btn.disabled?'Добавьте или включите хотя бы один вопрос в анкете.':'';
  });
}
function renderProfiles() {
  const w=workspace();
  const originals=new Map(uniquePartnerProfiles(w.ideals,current().traits).map(p=>[partnerVectorKey(p.answers,current().traits),p]));
  $('profileList').innerHTML=w.ideals.map(p=>{
    const score=evaluateIdentity(p.answers,current().traits);
    return `<article class="profile-card ${p.id===w.selected?'selected':''}">
      <div class="profile-top"><button type="button" class="profile-select" data-action="select" data-id="${escapeHtml(p.id)}" title="Редактировать характеристики партнера">${escapeHtml(p.name)}</button>
      <button type="button" class="icon-btn" data-action="remove" data-id="${escapeHtml(p.id)}" aria-label="Удалить ${escapeHtml(p.name)}" ${w.ideals.length===1?'disabled':''}>×</button></div>
      <div class="profile-sub" ${score.ok?'':`title="${escapeHtml(score.reason)}"`}>${score.ok?`Профиль партнера: ${fixed(score.value)}`:'Профиль партнера: —'}</div>
      <div class="profile-actions"><button type="button" class="text-btn" data-action="rename" data-id="${escapeHtml(p.id)}">Переименовать</button><button type="button" class="text-btn" data-action="duplicate" data-id="${escapeHtml(p.id)}">Копировать</button></div>
    </article>`;
  }).join('');
  $('partnerWeightList').innerHTML=w.ideals.map(p=>{
    const original=originals.get(partnerVectorKey(p.answers,current().traits)),duplicate=original.id!==p.id;
    return `
    <div class="partner-weight">
      <div class="partner-weight-heading"><label for="w_${escapeHtml(p.id)}">${escapeHtml(p.name)}</label><span><span data-weight-share="${escapeHtml(p.id)}"></span>%</span></div>
      <div class="weight-row"><input id="w_${escapeHtml(p.id)}" aria-label="Вес предпочтения партнера ${escapeHtml(p.name)}" type="range" min="0" max="100" step="1" value="${p.weight}" data-weight-id="${escapeHtml(p.id)}" ${duplicate?'disabled':''}/><output for="w_${escapeHtml(p.id)}" data-weight-output="${escapeHtml(p.id)}">${p.weight}</output></div>
      ${duplicate?`<p class="helper">Используется вес «${escapeHtml(original.name)}». Измените характеристики, чтобы учитывать этот профиль отдельно.</p>`:''}
    </div>`;
  }).join('');
  updatePartnerWeightOutputs();
  $('currentProfileName').textContent=selectedIdeal()?.name||'—';
}
function updatePartnerWeightOutputs() {
  const partners=workspace().ideals,unique=uniquePartnerProfiles(partners,current().traits);
  const ids=new Set(unique.map(p=>p.id)),total=unique.reduce((sum,p)=>sum+Math.max(0,Number(p.weight)),0);
  for (const p of partners) {
    $('partnerWeightList').querySelector(`[data-weight-output="${p.id}"]`).textContent=String(p.weight);
    $('partnerWeightList').querySelector(`[data-weight-share="${p.id}"]`).textContent=total>0&&ids.has(p.id)?(Number(p.weight)/total*100).toFixed(1):'0.0';
  }
}
function renderQuestions() {
  const q=current(), w=q.workspace, ideal=selectedIdeal();
  const active=q.traits.filter(t=>t.enabled && t.weight>0);
  const groups=groupOrder.filter(group=>active.some(t=>t.group===group));
  $('questionList').innerHTML=groups.map(group=>{
    const items=active.filter(t=>t.group===group);
    return `<section class="question-group" data-question-group="${escapeHtml(group)}"><h3>${escapeHtml(group)}</h3>${items.map(t=>{
      const fields=(role,answers)=>`<div class="answer-group ${role==='ideal'?'ideal':''}"><span class="mini-header">${role==='own'?'Я':'ПАРТНЕР'}</span><div class="pair">${[0,1].map(value=>`<label class="choice"><input type="radio" name="q_${role}_${escapeHtml(t.id)}" data-trait="${escapeHtml(t.id)}" data-role="${role}" value="${value}" ${answers[t.id]===value?'checked':''}/><span>${escapeHtml(value===0?t.female:t.male)}</span></label>`).join('')}</div></div>`;
      return `<div class="question"><div class="question-head"><strong>${escapeHtml(t.question)}</strong><small title="${escapeHtml(t.note)}">вес ${Number(t.weight).toFixed(2)} ⓘ</small></div><div class="answer-grid">${fields('own',w.own)}${fields('ideal',ideal.answers)}</div></div>`;
    }).join('')}</section>`;
  }).join('')||'<p class="helper">В этой анкете нет активных вопросов. Добавьте их в конструкторе ниже.</p>';
}
function renderTraitEditor() {
  const q=current(),locked=q.builtin;
  $('addTraitForm').hidden=locked;
  $('traitEditorRows').innerHTML=(locked?'<div class="editor-locked-note">Для изменения вопросов или весов сначала создайте копию исходной анкеты.</div>':'')+q.traits.map(t=>{
    const id=escapeHtml(t.id);
    if(locked) return `<div class="editor-trait-row trait-editor-row-locked"><div><div class="trait-name">${escapeHtml(t.question)}</div><div class="trait-note">${escapeHtml(t.group)} · ${escapeHtml(t.female)} / ${escapeHtml(t.male)}<br/>${escapeHtml(t.note)}</div></div><span>вес: ${t.weight.toFixed(2)}</span><span>${t.enabled?'Включён':'Выключен'}</span></div>`;
    const input=(field,label,value,max=140)=>`<label class="${field==='question'?'full':''}">${label}<input type="text" maxlength="${max}" value="${escapeHtml(value)}" data-edit-field="${field}" data-edit-id="${id}"/></label>`;
    return `<div class="editor-trait-row">
      <div class="trait-fields">${input('question','Формулировка',t.question)}${input('female','Фемининный вариант',t.female,80)}${input('male','Маскулинный вариант',t.male,80)}
      <label class="full">Категория<select data-edit-field="group" data-edit-id="${id}">${groupOrder.map(g=>`<option ${g===t.group?'selected':''} value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('')}</select></label><span class="trait-note">${escapeHtml(t.note)}</span></div>
      <div class="trait-controls"><label><input type="checkbox" data-edit-field="enabled" data-edit-id="${id}" ${t.enabled?'checked':''}/> Включён</label><label>Вес <input type="number" min="0.05" max="20" step="0.05" value="${t.weight}" data-edit-field="weight" data-edit-id="${id}"/></label></div>
      <button type="button" class="text-btn" data-remove-trait="${id}">Удалить</button>
    </div>`;
  }).join('')||'<p class="helper">В этой анкете пока нет вопросов.</p>';
}
function setText(id,value) {$(id).textContent=value;}
function paintResult(result) {
  const error=$('errorMessage');
  error.hidden=result.ok; error.textContent=result.ok?'':`${result.context}: ${result.reason}`;
  $('positionDot').style.opacity=result.ok?'1':'.18'; $('positionGlow').style.opacity=result.ok?'.15':'.03';
  if (!result.ok) {
    setText('identityLabel','Профиль не определён');
    setText('identityNumber','Мой индекс: —');
    setText('identityDescription','Проверьте выбранные ответы и веса анкеты.');
    $('identityMeter').setAttribute('aria-valuenow','0');
    $('identityMeter').setAttribute('aria-valuetext','Профиль не определён');
    $('identityMarker').style.left='50%';
    for(const id of ['heteroValue','homoValue','bothValue'])setText(id,'—');
    for(const id of ['heteroBar','homoBar','bothBar'])$(id).style.width='0%';
    return;
  }
  const female=result.a<0;
  const strength=Math.abs(result.a);
  const intensity=strength<0.15?'Едва заметное':strength<0.4?'Небольшое':strength<0.7?'Умеренное':'Выраженное';
  const modelName=female?'женской':'мужской';
  setText('identityLabel',female?'Преобладает женская модель':'Преобладает мужская модель');
  setText('identityNumber',`Мой индекс: ${fixed(result.a)}`);
  setText('identityDescription',`${intensity} преобладание ${modelName} модели по выбранным вопросам. Это описание моих характеристик, а не моей ориентации.`);
  $('identityMarker').style.left=`${Math.max(0,Math.min(100,(result.a+1)*50))}%`;
  $('identityMeter').setAttribute('aria-valuenow',String(result.a));
  $('identityMeter').setAttribute('aria-valuetext',`${female?'Женская':'Мужская'} модель, индекс ${fixed(result.a)}`);
  for(const [name,v] of [['hetero',result.hetero],['homo',result.homo],['both',result.both]]) {
    setText(`${name}Value`,percent(v));$(`${name}Bar`).style.width=`${Math.max(0,Math.min(100,v*100))}%`;
  }
  const x=44*result.hetero+376*result.homo+210*result.both;
  const y=286*(result.hetero+result.homo)+28*result.both;
  for(const dot of [$('positionDot'),$('positionGlow')]){dot.setAttribute('cx',x.toFixed(4));dot.setAttribute('cy',y.toFixed(4));}
  $('triangleDesc').textContent=`Гетеросоответствие ${percent(result.hetero)}, гомосоответствие ${percent(result.homo)}, оба полюса ${percent(result.both)}.`;
}
function renderWeightWarning(){
  const box=$('weightAxiomWarning');
  const validation=validateNonzeroIdentity(current().traits);
  box.hidden=validation.status==='valid';
  box.textContent=validation.status==='invalid'
    ?'⚠ Нарушена аксиома I ≠ 0: при выбранных весах существует комбинация ответов, дающая I = 0. Веса не изменены. Настройте их вручную, если хотите обеспечить выполнение аксиомы для всех возможных профилей.'
    :validation.status==='unknown'
      ?`⚠ Проверка аксиомы I ≠ 0 не завершена: ${validation.reason} Веса сохранены без изменений.`
      :validation.status==='empty'?'⚠ Нет активных вопросов с положительными весами. Индекс I не определён.':'';
}
function updateDashboard(){paintResult(evaluateTriangle(workspace().own,workspace().ideals,current().traits));}
function renderAll({preserveTraitEditor=false}={}){renderQuestionnaireSelect();renderProfiles();renderQuestions();if(!preserveTraitEditor)renderTraitEditor();renderWeightWarning();updateDashboard();}

$('questionnaireSelect').addEventListener('change',event=>{project.activeQuestionnaireId=event.target.value;change();});
function addQuestionnaire(blank) {
  if(project.questionnaires.length>=20)return alert('Не более 20 анкет.');
  const source=current(),name=prompt('Название новой анкеты',blank?'Моя новая анкета':`${source.name} — копия`);
  if(name===null)return;if(!name.trim())return alert('Название не может быть пустым.');
  const q=makeQuestionnaire(source,uid(),name,blank);
  project.questionnaires.push(q);project.activeQuestionnaireId=q.id;change();$('traitEditor').open=true;
}
$('copyQuestionnaireBtn').addEventListener('click',()=>addQuestionnaire(false));
$('blankQuestionnaireBtn').addEventListener('click',()=>addQuestionnaire(true));
$('renameQuestionnaireBtn').addEventListener('click',()=>{
  const q=current();if(q.builtin)return;
  const name=prompt('Название анкеты',q.name);if(name!==null&&name.trim()){q.name=name.trim().slice(0,80);change();}
});
$('deleteQuestionnaireBtn').addEventListener('click',()=>{
  const q=current();if(q.builtin)return;
  if(!confirm(`Удалить анкету «${q.name}» со всеми ответами?`))return;
  project.questionnaires=project.questionnaires.filter(x=>x.id!==q.id);project.activeQuestionnaireId='default';change();
});
$('questionList').addEventListener('change',event=>{
  const input=event.target.closest('input[data-role][data-trait]');if(!input)return;
  const target=input.dataset.role==='own'?workspace().own:selectedIdeal().answers;
  target[input.dataset.trait]=Number(input.value);renderProfiles();updateDashboard();persist();
});
$('partnerWeightList').addEventListener('input',event=>{
  const input=event.target.closest('input[data-weight-id]');if(!input)return;
  const p=workspace().ideals.find(x=>x.id===input.dataset.weightId);if(!p)return;
  p.weight=Number(input.value);
  updatePartnerWeightOutputs();
  updateDashboard();persist();
});
$('profileList').addEventListener('click',event=>{
  const btn=event.target.closest('button[data-action]');if(!btn)return;
  const w=workspace(),p=w.ideals.find(item=>item.id===btn.dataset.id);if(!p)return;
  if(btn.dataset.action==='select')w.selected=p.id;
  if(btn.dataset.action==='remove'){if(w.ideals.length<=1)return;w.ideals=w.ideals.filter(item=>item.id!==p.id);if(w.selected===p.id)w.selected=w.ideals[0].id;}
  if(btn.dataset.action==='duplicate')return offerPartner({...clone(p),id:uid(),name:`${p.name} (копия)`});
  if(btn.dataset.action==='rename'){const name=prompt('Имя партнера',p.name);if(name!==null&&name.trim())p.name=name.trim().slice(0,80);}
  renderProfiles();renderQuestions();updateDashboard();persist();
});
function defaultPartnerWeight() {
  const w=workspace();
  const sharedWeight=w.ideals[0].weight;
  return sharedWeight>0&&w.ideals.every(p=>p.weight===sharedWeight)?sharedWeight:50;
}
let pendingPartner=null;
function addPartner(partner) {
  const w=workspace();if(w.ideals.length>=30)return alert('Не более 30 партнеров.');
  w.ideals.push(partner);w.selected=partner.id;change();
}
function offerPartner(partner) {
  const key=partnerVectorKey(partner.answers,current().traits);
  const original=workspace().ideals.find(p=>partnerVectorKey(p.answers,current().traits)===key);
  if(!original)return addPartner(partner);
  pendingPartner={partner,originalId:original.id,questionnaireId:current().id};
  $('duplicatePartnerDescription').textContent=`Такой набор характеристик уже есть у «${original.name}». Можно выбрать его или создать копию для изменения характеристик. Совпадающие профили учитываются в расчёте один раз.`;
  $('duplicatePartnerDialog').returnValue='cancel';
  $('duplicatePartnerDialog').showModal();
}
$('duplicatePartnerDialog').addEventListener('close',()=>{
  const pending=pendingPartner;pendingPartner=null;
  if(!pending||pending.questionnaireId!==current().id)return;
  if($('duplicatePartnerDialog').returnValue==='edit')return addPartner(pending.partner);
  if($('duplicatePartnerDialog').returnValue!=='select')return;
  workspace().selected=pending.originalId;
  renderProfiles();renderQuestions();updateDashboard();persist();
});
$('addProfileBtn').addEventListener('click',()=>{
  const w=workspace();
  const weight=defaultPartnerWeight();
  const previous=selectedIdeal();const p={id:uid(),name:`Партнер ${w.ideals.length+1}`,answers:clone(previous?.answers??w.own),weight};
  offerPartner(p);
});
function applyPreset(name) {
  const q=current(),w=workspace(),traits=q.traits;
  const presets={
    feminine:()=>[allAnswers(traits,0)],
    masculine:()=>[allAnswers(traits,1)],
    androgynous:()=>[nearestToZero(traits,1)],
    poles:()=>[allAnswers(traits,0),allAnswers(traits,1)]
  };
  if(!Object.hasOwn(presets,name)||!traits.some(t=>t.enabled && t.weight>0))return;
  const partners=presets[name]().map((answers,i)=>({id:uid(),name:`Партнер ${i+1}`,answers,weight:50}));
  w.ideals=partners;w.selected=partners[0].id;
  // Keep the preset button and its focus intact; selecting a partner does not navigate.
  renderProfiles();renderQuestions();updateDashboard();persist();
}
document.querySelectorAll('button[data-preset]').forEach(btn=>btn.addEventListener('click',()=>applyPreset(btn.dataset.preset)));
$('traitEditorRows').addEventListener('change',event=>{
  const input=event.target.closest('[data-edit-field][data-edit-id]');if(!input||current().builtin)return;
  const t=current().traits.find(t=>t.id===input.dataset.editId);if(!t)return;
  const field=input.dataset.editField;
  if(field==='enabled')t.enabled=input.checked;
  else if(field==='weight') {const v=Number(input.value);if(!Number.isFinite(v)||v<.05||v>20){alert('Вес должен быть от 0.05 до 20.');return renderTraitEditor();}t.weight=v;}
  else if(field==='group'){if(!groupOrder.includes(input.value))return;t.group=input.value;}
  else if(['question','female','male'].includes(field)){const value=input.value.trim();if(!value){alert('Текст ответа или вопроса не должен быть пустым.');return renderTraitEditor();}t[field]=value.slice(0,field==='question'?140:80);input.value=t[field];}
  // The edited controls already contain the new values. Keep their DOM for native Tab/focus.
  change({preserveTraitEditor:true});
});
$('traitEditorRows').addEventListener('click',event=>{
  const btn=event.target.closest('button[data-remove-trait]');if(!btn||current().builtin)return;
  if(!confirm('Удалить этот вопрос из анкеты?'))return;
  current().traits=current().traits.filter(t=>t.id!==btn.dataset.removeTrait);change();
});
$('addTraitForm').addEventListener('submit',event=>{
  event.preventDefault();if(current().builtin)return;
  if(current().traits.length>=64)return alert('Не более 64 вопросов.');
  const fd=new FormData(event.target),weight=Number(fd.get('weight'));
  if(!Number.isFinite(weight)||weight<.05||weight>20)return alert('Вес должен быть от 0.05 до 20.');
  const t={id:uid(),group:'Пользовательские гипотезы',question:String(fd.get('question')).trim().slice(0,140),female:String(fd.get('female')).trim().slice(0,80),male:String(fd.get('male')).trim().slice(0,80),weight,enabled:true,note:'Пользовательская гипотеза. Не проходила научную валидацию.'};
  if(!t.question||!t.female||!t.male)return alert('Заполните формулировку и оба ответа.');
  current().traits.push(t);fillMissingAnswers(current());event.target.reset();change();
});
function exportJson() {
  const data=JSON.stringify({format:'representation-triangle-ru-v3',exportedAt:new Date().toISOString(),project},null,2);
  const blob=new Blob([data],{type:'application/json'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='triangle-project-v3.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('exportBtn').addEventListener('click',exportJson);
$('importBtn').addEventListener('click',()=>$('importFile').click());
$('importFile').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;
  try{if(file.size>2_000_000)throw new Error('JSON-файл превышает 2 МБ.');project=importProject(JSON.parse(await file.text()));change();}
  catch(err){alert(`Ошибка импорта: ${err.message}`);}event.target.value='';
});
$('resetBtn').addEventListener('click',()=>{
  if(!confirm('Сбросить исходные профили и удалить все пользовательские анкеты и изменения?'))return;
  project=newProject();change();
});
renderAll();
if(loadedProject)persist();
