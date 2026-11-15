"""Browser QA with inlined modules: headless environment blocks all navigation."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re
import tempfile
import json
root=Path(__file__).resolve().parents[1]
artifacts=Path(tempfile.mkdtemp(prefix='triangle-browser-'))

def inline_html():
    html=(root/'index.html').read_text()
    html=html.replace('<link rel="stylesheet" href="./styles.css" />',f'<style>{(root/"styles.css").read_text()}</style>')
    sections=[]
    for f in ['traits.mjs','weight_validation.mjs','model.mjs','questionnaires.mjs','app.js']:
        s=(root/f).read_text()
        s=re.sub(r'^import .*?;\s*$', '', s, flags=re.MULTILINE)
        s=re.sub(r'\bexport (const|function)\b',r'\1',s)
        if f=='questionnaires.mjs':
            s=re.sub(r'\bclone\b','qclone',s)
        sections.append(s)
    html=html.replace('<script type="module" src="./app.js"></script>','')
    html=html.replace('</body>', '<script>'+ '\n'.join(sections)+'</script></body>')
    return html

def load_app(page):
    # A routed origin exercises localStorage without making external requests.
    page.route('http://triangle.test/**',lambda route:route.fulfill(content_type='text/html',body=inline_html()))
    page.goto('http://triangle.test/')

def scroll_positions(page):
    return page.evaluate('({page:window.scrollY,list:document.getElementById("questionList").scrollTop})')

def check_weight_validation(page):
    behavior=page.locator('.behavior-group')
    assert behavior.locator('h3').text_content()=='Романтическое и сексуальное поведение'
    assert behavior.locator('.question').count()==6
    assert not page.locator('#weightAxiomWarning').is_visible()
    assert page.locator('#groupSettings').count()==0
    assert 'Если ни один вариант не подходит полностью' in page.locator('.question-guidance').first.inner_text()
    page.once('dialog',lambda d:d.accept('Мои веса'))
    page.locator('#copyQuestionnaireBtn').click()
    assert not page.locator('#weightAxiomWarning').is_visible()
    weight=page.locator('[data-edit-id="height"][data-edit-field="weight"]')
    assert weight.input_value()=='0.85'
    weight.fill('0.8');weight.dispatch_event('change')
    assert page.locator('#weightAxiomWarning').is_visible()
    assert 'I = 0' in page.locator('#weightAxiomWarning').inner_text()
    assert page.evaluate('current().traits.find(t=>t.id==="height").weight')==0.8
    assert page.evaluate('project.questionnaires[0].traits.find(t=>t.id==="height").weight')==0.85
    page.reload()
    assert page.locator('#weightAxiomWarning').is_visible()
    assert page.evaluate('current().traits.find(t=>t.id==="height").weight')==0.8
    page.locator('#traitEditor summary').click()
    weight=page.locator('[data-edit-id="height"][data-edit-field="weight"]')
    weight.fill('0.85');weight.dispatch_event('change')
    assert not page.locator('#weightAxiomWarning').is_visible()
    page.once('dialog',lambda d:d.accept())
    page.locator('#resetBtn').click()
    page.reload()

def check_saved_migration(page):
    legacy=json.loads((root/'tests/fixtures/legacy-v3.json').read_text())
    page.evaluate('(raw)=>localStorage.setItem("representation-triangle-ru-v3",JSON.stringify(raw))',legacy)
    page.reload()
    assert page.locator('.question').count()==23
    assert page.locator('#migrationNotice').is_visible()
    old=legacy['project']['questionnaires'][0]['workspace']
    current=page.evaluate('workspace()')
    assert all(current['own'][key]==value for key,value in old['own'].items())
    assert current['selected']==old['selected']
    assert current['own']['height']==1
    assert [current['own'][key] for key in ['romantic_initiative','flirting_style','courtship_role','physical_intimacy','sexual_initiative','sexual_dynamics']]==[0,1,0,1,0,1]
    assert page.evaluate('JSON.parse(localStorage.getItem("representation-triangle-ru-v3")).project.questionnaires[0].traits.length')==23, 'successful migration must be persisted'
    page.once('dialog',lambda d:d.accept())
    page.locator('#resetBtn').click()
    page.reload()

def check_zero_identity_scrolling(page):
    # Custom questionnaire with weights [1,1] can produce I=0.
    for role in ['own','ideal']:
        fixture=page.evaluate('''(role)=>{
          const p=newProject(),q=makeQuestionnaire(activeQuestionnaire(p),'two_traits','Два одинаковых веса',true);
          q.traits=[0,1].map(i=>({id:`trait_${i}`,question:`Вопрос ${i}`,female:'A',male:'B',group:groupOrder[0],weight:1,enabled:true,note:''}));
          fillMissingAnswers(q);
          const balanced={trait_0:1,trait_1:0},valid={trait_0:1,trait_1:1};
          q.workspace.own=role==='own'?balanced:valid;
          q.workspace.ideals=[{id:'balanced_partner',name:'Партнер',answers:role==='ideal'?balanced:valid,weight:50}];
          q.workspace.selected='balanced_partner';
          p.questionnaires.push(q);p.activeQuestionnaireId=q.id;
          return {format:'representation-triangle-ru-v3',project:p};
        }''',role)
        page.locator('#importFile').set_input_files({'name':'zero-check.json','mimeType':'application/json','buffer':json.dumps(fixture).encode()})
        assert page.locator('#weightAxiomWarning').is_visible()
        assert page.locator('#errorMessage').is_visible()
        assert 'I = 0' in page.locator('#errorMessage').inner_text()
        radio=page.locator(f'input[data-role="{role}"][data-trait="trait_1"][value="1"]')
        radio.locator('..').scroll_into_view_if_needed()
        page.wait_for_timeout(150)
        before=scroll_positions(page)
        radio.locator('..').click()
        assert not page.locator('#errorMessage').is_visible()
        assert page.locator('#weightAxiomWarning').is_visible()
        assert scroll_positions(page)==before
        page.locator(f'input[data-role="{role}"][data-trait="trait_1"][value="0"]').locator('..').click()
        assert page.locator('#errorMessage').is_visible()
        assert scroll_positions(page)==before
    page.once('dialog',lambda d:d.accept())
    page.locator('#resetBtn').click()
    page.reload()

def create_partner_copy(page):
    count=page.locator('.profile-card').count()
    page.locator('#addProfileBtn').click()
    page.locator('#duplicatePartnerDialog button[value="edit"]').click()
    page.wait_for_function('(count)=>document.querySelectorAll(".profile-card").length===count',arg=count+1)

def check_duplicate_partners(page):
    dialog=page.locator('#duplicatePartnerDialog')
    result=lambda:page.evaluate('evaluateTriangle(workspace().own,workspace().ideals,current().traits)')
    before=page.evaluate('structuredClone(workspace())')
    expected=result()
    page.locator('#addProfileBtn').click()
    assert dialog.is_visible()
    assert dialog.locator('[value="select"]').evaluate('(el)=>el===document.activeElement')
    dialog.locator('[value="cancel"]').click()
    assert page.evaluate('workspace()')==before, 'cancel must leave all data intact'
    page.locator('#addProfileBtn').click()
    dialog.locator('[value="select"]').click()
    assert page.locator('.profile-card').count()==2
    assert result()==expected, 'selecting an identical existing partner must not change the triangle'
    page.locator('[data-action="duplicate"]').first.click()
    dialog.locator('[value="select"]').click()
    page.wait_for_function('document.getElementById("currentProfileName").textContent==="Партнер 1"')
    assert page.locator('#currentProfileName').inner_text()=='Партнер 1'
    assert page.locator('.profile-card').count()==2
    for count in [3,4]:
        create_partner_copy(page)
        assert page.locator('.profile-card').count()==count
        assert result()==expected, 'one or two saved copies must not change the result'
    page.locator('#partnerSettings summary').click()
    assert page.locator('[data-weight-share]').all_text_contents()==['50.0','50.0','0.0','0.0']
    assert page.locator('input[data-weight-id]').nth(2).is_disabled()
    assert page.locator('input[data-weight-id]').nth(3).is_disabled()
    assert 'Используется вес «Партнер 1»' in page.locator('#partnerWeightList').inner_text()
    assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth+2')
    fixture=page.evaluate('({format:"representation-triangle-ru-v3",project:structuredClone(project)})')
    for partner,weight in zip(fixture['project']['questionnaires'][0]['workspace']['ideals'],[20,80,99,0]):
        partner['weight']=weight
    page.locator('#importFile').set_input_files({'name':'duplicates.json','mimeType':'application/json','buffer':json.dumps(fixture).encode()})
    page.wait_for_function('document.querySelector("input[data-weight-id]").value==="20"')
    expected=result()
    assert abs(expected['both']-0.4)<1e-10
    page.reload()
    assert page.evaluate('project')==fixture['project'], 'localStorage must retain all duplicate records and weights'
    assert result()==expected
    with page.expect_download() as dl:
        page.locator('#exportBtn').click()
    export_path=artifacts/f'duplicates-{page.viewport_size["width"]}.json'
    dl.value.save_as(str(export_path))
    assert json.loads(export_path.read_text())['project']==fixture['project']
    page.once('dialog',lambda d:d.accept())
    page.locator('#resetBtn').click()
    page.locator('#importFile').set_input_files(str(export_path))
    page.wait_for_function('document.querySelectorAll(".profile-card").length===4')
    assert page.evaluate('project')==fixture['project']
    assert result()==expected, 'JSON must round trip duplicates without changing their effective influence'
    page.locator('.profile-select').nth(2).click()
    answer=page.locator('input[data-role="ideal"][value="1"]').first
    answer.locator('..').scroll_into_view_if_needed()
    page.wait_for_timeout(350)
    scroll=scroll_positions(page)
    answer.locator('..').click()
    page.wait_for_timeout(350)
    assert scroll_positions(page)==scroll, 'editing a duplicate into a unique partner must not jump'
    assert result()!=expected, 'genuinely different partner must influence the triangle'
    assert page.locator('input[data-weight-id]').nth(2).is_enabled()
    assert page.evaluate('workspace().own')==before['own']
    expected=result()
    page.locator('#partnerSettings summary').click()
    page.locator('input[data-weight-id]').first.press('End')
    assert result()!=expected, 'explicit unique weights must still affect the result'
    page.once('dialog',lambda d:d.accept())
    page.locator('#resetBtn').click()
    page.reload()

def check_partner_weights(page):
    settings=page.locator('#partnerSettings')
    summary=settings.locator('summary')
    sliders=settings.locator('input[data-weight-id]')
    weights=lambda:page.evaluate('workspace().ideals.map(p=>p.weight)')
    state=lambda:page.evaluate('JSON.parse(localStorage.getItem("representation-triangle-ru-v3")).project')
    assert summary.inner_text()=='Дополнительные настройки'
    assert not settings.evaluate('(el)=>el.open')
    assert not sliders.first.is_visible()
    assert page.locator('#profileList input[type="range"]').count()==0
    assert 'веса предпочтений' not in page.locator('#profileList').inner_text()
    create_partner_copy(page)
    page.locator('input[data-role="ideal"][value="0"]').first.locator('..').click()
    assert weights()==[50,50,50]
    probabilities=page.evaluate('evaluateTriangle(workspace().own,workspace().ideals,current().traits).evaluated.map(p=>p.probability)')
    assert probabilities==[1/3]*3, 'new default partners must have equal effective weights'
    summary.click()
    assert sliders.count()==3 and sliders.first.is_visible()
    before=page.locator('#bothValue').inner_text()
    sliders.first.press('End')
    assert weights()==[100,50,50]
    assert page.locator('#bothValue').inner_text()!=before, 'advanced weights must update the triangle live'
    assert settings.locator('[data-weight-share]').all_text_contents()==['50.0','25.0','25.0']
    assert sliders.first.evaluate('(el)=>el===document.activeElement'), 'weight adjustment must retain slider focus'
    sliders.nth(1).press('Home')
    assert weights()==[100,0,50]
    saved=state()
    summary.click()
    assert not sliders.first.is_visible()
    assert state()==saved, 'collapsing settings must not change saved weights'
    summary.click()
    assert weights()==[100,0,50]
    page.locator('input[data-role="own"]').first.locator('..').click()
    assert settings.evaluate('(el)=>el.open'), 'questionnaire updates must preserve the open section'
    saved=state()
    page.reload()
    assert not settings.evaluate('(el)=>el.open'), 'advanced settings start collapsed on page load'
    assert state()==saved and weights()==[100,0,50], 'custom and zero weights must survive reload'
    create_partner_copy(page)
    assert weights()==[100,0,50,50], 'adding must preserve existing custom weights'
    saved=state()
    with page.expect_download() as dl:
        page.locator('#exportBtn').click()
    export_path=artifacts/f'weights-{page.viewport_size["width"]}.json'
    dl.value.save_as(str(export_path))
    page.once('dialog',lambda d:d.accept())
    page.locator('#resetBtn').click()
    page.locator('#importFile').set_input_files(str(export_path))
    page.wait_for_function('document.querySelectorAll("#profileList .profile-card").length===4')
    assert state()==saved, 'JSON round trip must preserve custom weights'
    assert not settings.evaluate('(el)=>el.open')
    summary.click()
    assert [slider.input_value() for slider in sliders.all()]==['100','0','50','50']
    assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth+2'), 'advanced settings must fit the viewport'
    page.locator('[data-preset="masculine"]').click()
    create_partner_copy(page)
    assert weights()==[50,50], 'editable copies must preserve their stored default weights'
    page.once('dialog',lambda d:d.accept())
    page.locator('#resetBtn').click()
    page.reload()

def check_partner_presets(page):
    assert page.locator('.presets h3').inner_text()=='Быстрые примеры партнёров'
    assert page.locator('[data-preset]').all_text_contents()==[
        'Женственный партнёр','Мужественный партнёр','Андрогинный партнёр','Два противоположных партнёра']
    page.locator('input[data-role="own"]').first.locator('..').click()
    page.locator('#partnerSettings summary').click()
    page.locator('input[data-weight-id]').first.press('End')
    page.locator('input[data-weight-id]').nth(1).press('Home')
    page.locator('#partnerSettings summary').click()
    for preset,count in [('feminine',1),('masculine',1),('androgynous',1),('poles',2)]:
        button=page.locator(f'[data-preset="{preset}"]')
        button.scroll_into_view_if_needed()
        page.wait_for_timeout(350)
        before=page.evaluate('structuredClone(workspace())')
        scroll=page.evaluate('window.scrollY')
        button.click()
        page.wait_for_timeout(500)
        assert page.evaluate('window.scrollY')==scroll, f'{preset} must not scroll the main page'
        assert button.evaluate('(el)=>el===document.activeElement'), 'preset focus must remain on its button'
        after=page.evaluate('structuredClone(workspace())')
        assert after['own']==before['own'], 'presets must never modify own characteristics'
        assert not {p['id'] for p in before['ideals']} & {p['id'] for p in after['ideals']}, 'presets must replace the previous partner set'
        added=after['ideals']
        assert len(added)==count
        assert [p['name'] for p in added]==[f'Партнер {i+1}' for i in range(count)]
        assert all(p['weight']==50 for p in added), 'each preset starts with equal default weights'
        assert len({p['id'] for p in after['ideals']})==len(after['ideals'])
        assert after['selected']==added[0]['id']
        assert page.locator('#currentProfileName').inner_text()==added[0]['name']
        result=page.evaluate('(count)=>evaluateTriangle(workspace().own,workspace().ideals.slice(-count),current().traits)',count)
        assert result['ok']
        assert page.locator('#bothValue').inner_text()==page.evaluate('percent(evaluateTriangle(workspace().own,workspace().ideals,current().traits).both)'), 'triangle must reflect the selected set immediately'
        if preset=='feminine':
            assert result['mu']==-1
        elif preset=='masculine':
            assert result['mu']==1
        elif preset=='androgynous':
            assert 0<abs(result['mu'])<0.1
            assert result['both']==0, 'a single androgynous partner must remain one representation'
            assert abs(abs(result['mu'])-1/421)<1e-10, 'default nearest nonzero score is independently proven in weight_validation.test.mjs'
        else:
            assert added[0]['weight']==added[1]['weight']>0
            assert [p['identity'] for p in result['evaluated']]==[-1,1]
            assert [p['probability'] for p in result['evaluated']]==[0.5,0.5]
            assert result['mu']==0 and result['r']==1 and result['both']==1, 'opposite partners must remain two poles, not an averaged vector'
    saved=page.evaluate('JSON.parse(localStorage.getItem("representation-triangle-ru-v3")).project')
    page.reload()
    assert page.evaluate('JSON.parse(localStorage.getItem("representation-triangle-ru-v3")).project')==saved
    before=page.evaluate('structuredClone(workspace())')
    page.locator('input[data-role="ideal"]').nth(1).locator('..').click()
    after=page.evaluate('structuredClone(workspace())')
    assert after['own']==before['own']
    assert after['ideals'][-2]['answers']!=before['ideals'][-2]['answers'], 'generated partners must be editable'
    assert after['ideals'][-1]==before['ideals'][-1], 'editing one generated partner must not change the other'
    page.once('dialog',lambda d:d.accept())
    page.locator('#resetBtn').click()
    page.reload()

def check_custom_presets(page):
    fixture=page.evaluate('''()=>{
      const p=newProject(),q=makeQuestionnaire(activeQuestionnaire(p),'preset_custom','Примеры с моими весами',true);
      q.traits=[9,3,1,20].map((weight,i)=>({id:`custom_${i}`,question:`Вопрос ${i}`,female:'А',male:'Б',group:groupOrder[0],note:'',weight,enabled:i<3}));
      fillMissingAnswers(q);
      q.workspace.ideals[0].weight=23;q.workspace.ideals[1].weight=77;
      p.questionnaires.push(q);p.activeQuestionnaireId=q.id;
      return {format:'representation-triangle-ru-v3',project:p};
    }''')
    def import_fixture(data,count):
        page.locator('#importFile').set_input_files({'name':'presets.json','mimeType':'application/json','buffer':json.dumps(data).encode()})
        page.wait_for_function('(expected)=>document.getElementById("questionnaireSelect").value===expected.id && document.querySelectorAll("#profileList .profile-card").length===expected.count',arg={'id':data['project']['activeQuestionnaireId'],'count':count})
    import_fixture(fixture,2)
    assert page.locator('#questionnaireSelect').input_value()=='preset_custom'
    before=page.evaluate('structuredClone(project)')
    page.locator('[data-preset="androgynous"]').click()
    result=page.evaluate('evaluateIdentity(selectedIdeal().answers,current().traits)')
    assert result['ok'] and abs(abs(result['value'])-5/13)<1e-10, 'custom weights and disabled questions must determine the nearest nonzero profile'
    assert page.evaluate('workspace().own')==before['questionnaires'][1]['workspace']['own']
    page.locator('[data-preset="poles"]').click()
    result=page.evaluate('evaluateTriangle(workspace().own,workspace().ideals.slice(-2),current().traits)')
    assert result['both']==1 and [p['identity'] for p in result['evaluated']]==[-1,1]
    assert page.evaluate('project.questionnaires[0]')==before['questionnaires'][0], 'inactive questionnaires must not change'
    assert page.locator('.profile-card').count()==2
    assert page.evaluate('workspace().own')==before['questionnaires'][1]['workspace']['own']
    base=fixture['project']['questionnaires'][1]['workspace']['ideals'][0]
    fixture['project']['questionnaires'][1]['workspace']['ideals']=[{**base,'id':f'limit_{i}'} for i in range(29)]
    fixture['project']['questionnaires'][1]['workspace']['selected']='limit_0'
    import_fixture(fixture,29)
    before=page.evaluate('structuredClone(workspace())')
    page.locator('[data-preset="poles"]').click()
    assert page.locator('.profile-card').count()==2, 'presets must replace large partner sets'
    assert page.evaluate('workspace().own')==before['own']
    page.locator('[data-preset="feminine"]').click()
    assert page.locator('.profile-card').count()==1
    page.locator('[data-preset="masculine"]').click()
    assert page.locator('.profile-card').count()==1, 'switching one-partner sets must not accumulate profiles'
    page.once('dialog',lambda d:d.accept())
    page.locator('#resetBtn').click()
    page.reload()

def check_answer_scrolling(page):
    questions=page.locator('#questionList')
    page.evaluate('''()=>{
      const list=document.getElementById('questionList');
      window.scrollTo({top:window.scrollY+list.getBoundingClientRect().top-100,behavior:'instant'});
    }''')
    for offset in [0,350,900]:
        questions.evaluate('(el,offset)=>el.scrollTop=offset',offset)
        for role in ['own','ideal']:
            trait=questions.evaluate('''(list,role)=>{
              const bounds=list.getBoundingClientRect();
              return [...list.querySelectorAll(`input[data-role="${role}"]`)].find(input=>{
                const r=input.parentElement.getBoundingClientRect();
                return r.top>bounds.top+5 && r.bottom<Math.min(bounds.bottom,window.innerHeight)-5;
              }).dataset.trait;
            }''',role)
            for value in ['0','1']:
                radio=page.locator(f'input[data-role="{role}"][data-trait="{trait}"][value="{value}"]')
                before=scroll_positions(page)
                radio.evaluate('(el)=>window.answerUnderTest=el')
                radio.locator('..').click()
                page.wait_for_timeout(350)
                assert radio.is_checked()
                assert radio.evaluate('(el)=>el===window.answerUnderTest && el===document.activeElement'), 'answer DOM and focus must survive updates'
                assert scroll_positions(page)==before, (role,offset,before,scroll_positions(page))
            before=scroll_positions(page)
            radio.press('ArrowLeft')
            page.wait_for_timeout(350)
            assert page.locator(f'input[data-role="{role}"][data-trait="{trait}"][value="0"]').is_checked()
            assert scroll_positions(page)==before, 'keyboard answer switching must not scroll'
    before=scroll_positions(page)
    questions.hover()
    page.mouse.wheel(0,180)
    page.wait_for_timeout(350)
    after=scroll_positions(page)
    assert after['list']>before['list'], 'wheel must scroll the questionnaire'
    assert after['page']==before['page'], 'internal wheel scrolling must not move the page'

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--headless=new'])
    page=browser.new_page(viewport={'width':1440,'height':1000},device_scale_factor=1,accept_downloads=True)
    errors=[]
    page.on('pageerror',lambda exc:errors.append(str(exc)))
    load_app(page)
    check_saved_migration(page)
    check_weight_validation(page)
    check_zero_identity_scrolling(page)
    check_duplicate_partners(page)
    check_partner_presets(page)
    check_custom_presets(page)
    check_partner_weights(page)
    assert page.locator('html').get_attribute('lang')=='ru'
    assert page.locator('#questionnaireStatus').inner_text().startswith('23 вопроса')
    assert page.locator('.question').count()==23
    assert page.locator('#bothValue').inner_text()=='100.0%'
    assert page.locator('.topbar').get_by_text('Документ Word').count()==0
    assert page.locator('.hero .quickstart li').count()==3
    assert page.locator('#identityLabel').inner_text() != '—'
    assert page.locator('#identityMeter').get_attribute('aria-valuenow') is not None
    assert page.locator('#questionList').evaluate('(el)=>el.scrollHeight>el.clientHeight'), 'questions must scroll within tile 05'
    assert page.locator('.site-footer a[href$=".docx"]').count()==1
    assert page.locator('.method-panel').count()==0
    assert page.locator('#preferences h2').inner_text()=='Партнеры'
    assert page.locator('#questions h2').inner_text()=='Мои характеристики и выбранного партнера'
    assert page.locator('.profile-select').all_text_contents()==['Партнер 1','Партнер 2']
    assert page.locator('#currentProfileName').inner_text()=='Партнер 2'
    before=page.locator('#identityNumber').inner_text()
    page.locator('input[data-role="own"]').first.locator('..').click()
    after=page.locator('#identityNumber').inner_text()
    assert before != after, 'identity gauge must respond to edited own traits'
    assert after.startswith('Мой индекс:')
    page.locator('#questionList').evaluate('(el)=>el.scrollTop=120')
    assert page.locator('#questionList').evaluate('(el)=>el.scrollTop')>0
    check_answer_scrolling(page)
    page.locator('.profile-select').first.click()
    assert page.locator('#currentProfileName').inner_text()=='Партнер 1'
    own=page.locator('input[data-role="own"][data-trait="genitals"][value="0"]')
    partner=page.locator('input[data-role="ideal"][data-trait="genitals"][value="1"]')
    own.locator('..').click()
    partner.locator('..').click()
    assert own.is_checked() and partner.is_checked(), 'own and selected partner answers are independent'
    page.once('dialog',lambda d:d.accept('Саша <3'))
    page.locator('[data-action="rename"]').first.click()
    page.reload()
    assert page.locator('#currentProfileName').inner_text()=='Саша <3'
    assert own.is_checked() and partner.is_checked(), 'saved answers must survive reload'
    page.locator('.profile-select').nth(1).click()
    assert page.locator('#currentProfileName').inner_text()=='Партнер 2'
    page.locator('.brand').click()
    page.wait_for_timeout(700)
    before=page.evaluate('window.scrollY')
    page.locator('.quickstart a[href="#questions"]').click()
    page.wait_for_timeout(700)
    assert page.evaluate('window.scrollY')>before, 'explicit tile navigation must still scroll'
    assert page.evaluate('location.hash')=='#questions'
    page.screenshot(path=str(artifacts/'desktop.png'),full_page=True)
    page.once('dialog',lambda d:d.accept('Моя анкетка'))
    page.locator('#copyQuestionnaireBtn').click()
    assert page.locator('#questionnaireSelect').input_value()!='default'
    page.locator('#traitEditor').evaluate('(e)=>e.open=true')
    weight=page.locator('[data-edit-field="weight"]').first
    weight.fill('4.25')
    weight.dispatch_event('change')
    assert page.locator('[data-edit-field="weight"]').first.input_value()=='4.25'
    page.locator('[name="question"]').fill('Дополнительный тестовый вопрос?')
    page.locator('[name="female"]').fill('Вариант А')
    page.locator('[name="male"]').fill('Вариант Б')
    page.locator('#addTraitForm button[type="submit"]').click()
    assert page.locator('.question').count()==24
    assert page.locator('#questionnaireStatus').inner_text().startswith('24 вопроса')
    page.locator('#questionnaireSelect').select_option('default')
    assert page.locator('.question').count()==23
    page.locator('#questionnaireSelect').select_option(label='Моя анкетка')
    assert page.locator('.question').count()==24
    page.once('dialog',lambda d:d.accept('Пустая'))
    page.locator('#blankQuestionnaireBtn').click()
    assert page.locator('.question').count()==0
    assert page.locator('[data-preset]:disabled').count()==4, 'empty questionnaires cannot produce valid examples'
    page.locator('#traitEditor').evaluate('(e)=>e.open=true')
    page.locator('[name="question"]').fill('Новый вопрос?')
    page.locator('[name="female"]').fill('А')
    page.locator('[name="male"]').fill('Б')
    page.locator('#addTraitForm button[type="submit"]').click()
    assert page.locator('.question').count()==1
    assert page.locator('[data-preset]:disabled').count()==0
    assert not page.locator('#errorMessage').is_visible()
    with page.expect_download() as dl:
        page.locator('#exportBtn').click()
    download=dl.value
    assert download.suggested_filename=='triangle-project-v3.json'
    export_path=artifacts/'smoke_export.json'
    download.save_as(str(export_path))
    saved=page.evaluate('JSON.parse(localStorage.getItem("representation-triangle-ru-v3")).project')
    page.once('dialog',lambda d:d.accept())
    page.locator('#resetBtn').click()
    assert page.locator('.profile-select').all_text_contents()==['Партнер 1','Партнер 2']
    page.locator('#importFile').set_input_files(str(export_path))
    page.wait_for_function('document.getElementById("questionnaireSelect").selectedOptions[0].textContent==="Пустая"')
    assert page.evaluate('JSON.parse(localStorage.getItem("representation-triangle-ru-v3")).project')==saved, 'JSON import must restore custom questionnaires and partner names'
    assert not errors,errors
    phone=browser.new_page(viewport={'width':390,'height':844},device_scale_factor=1)
    load_app(phone)
    check_weight_validation(phone)
    check_zero_identity_scrolling(phone)
    check_duplicate_partners(phone)
    check_partner_presets(phone)
    check_partner_weights(phone)
    check_answer_scrolling(phone)
    phone.screenshot(path=str(artifacts/'mobile.png'),full_page=True)
    assert phone.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 2'), 'horizontal overflow on mobile'
    assert not errors,errors
    print('BROWSER SMOKE PASS: 23 questions, behavior block and unified weight validation, editable height/trait weights, legacy migration, duplicate invariance, localStorage/JSON, preset switching, scrolling, desktop/mobile layouts')
    print(f'Browser artifacts: {artifacts}')
    browser.close()
