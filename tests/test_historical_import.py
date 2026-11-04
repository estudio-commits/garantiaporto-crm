"""End-to-end import checks in a disposable PostgreSQL database, synthetic data only."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import time
import uuid

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('builder',ROOT/'scripts/build-historical-import.py')
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
container='porto-import-test-'+uuid.uuid4().hex[:10]
def command(args,**kwargs):return subprocess.run(args,text=True,check=True,**kwargs)
def sql(value,fail=False):
 r=subprocess.run(['docker','exec','-i',container,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-At'],input=value,text=True,capture_output=True)
 if fail:
  assert r.returncode!=0,'Expected rejection';return r
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout

def fixture():
 cases=[]
 for i in range(2):
  approved=i==0
  data=dict(full_name=f'Caso Importación Ficticio {i}',phone=f'5989900000{i+1}',national_id=None,rent_amount=22000,rent_currency='UYU',guarantee_type='tradicional',completion='completo',stage='en_contacto',guarantee_stage='aprobada' if approved else 'sin_contactar',requested_date='2026-10-21',decision='aprobada' if approved else 'no_presentada',decision_date=None,decision_date_unknown=approved,decision_reference='Respaldo ficticio' if approved else None,issued_date='2026-11-03' if approved else None,issued_reference=None,issued_reference_unknown=approved,summary="Texto ficticio ' ; select 1; --",attribution={'utm_source':'ficticio','utm_campaign':'Campaña de prueba'})
  events=[dict(source_key=f'ficticio-{i}-{j}',step=j+1,sent_at=f'2026-10-2{j}T12:00:00Z',payload={'data':{'full_name':data['full_name'],'phone':data['phone'],'rent_amount':amount},'extra':{'synthetic_only':True}}) for j,amount in enumerate([20000,22000])]
  history=[dict(action='historical_form',actor_name='Fuente ficticia',occurred_at='2026-10-21T12:00:00Z',visibility='case',changes={'rent_amount':{'before':20000,'after':22000}}),dict(action='historical_sheet',actor_name='Planilla ficticia',occurred_at=None,visibility='admin',changes={'private':'Ficticio'})]
  cases.append(dict(key=f'T{i}',reviewed=True,data=data,sensitive={'monthly_income':50000,'national_id':''},clearing={'result':'no_figura','detail':'Ficticio'},events=events,history=history))
 return dict(batch_id='synthetic-only-v1',owner_email='seller@example.test',cases=cases)

try:
 command(['docker','run','-d','--name',container,'-e','POSTGRES_PASSWORD=isolated-only','postgres:17'],stdout=subprocess.DEVNULL)
 for attempt in range(30):
  if subprocess.run(['docker','exec',container,'pg_isready','-U','postgres'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:break
  time.sleep(1)
 sql((ROOT/'tests/bootstrap.sql').read_text())
 for f in sorted((ROOT/'supabase/migrations').glob('*.sql')):
  if f.name.startswith('009'):continue # The bundled installer must apply 009 itself.
  sql(f.read_text())
 sql("alter table auth.users add column email text; insert into auth.users values('00000000-0000-4000-8000-000000000002','seller@example.test'); insert into profiles values('00000000-0000-4000-8000-000000000002','Vendedor Ficticio','seller',true,false);")
 p=fixture(); script=builder.build(p,ROOT)
 assert '2|0' in sql(script)
 assert sql("select count(*) from applications").strip()=='2'
 assert sql("select count(*) from applications where guarantee_stage='aprobada' and decision_date is null and decision_date_unknown and issued_date='2026-11-03' and issued_reference is null and issued_reference_unknown").strip()=='1'
 assert sql("select count(*) from audit_log where changes->'rent_amount'->>'before'='20000' and changes->'rent_amount'->>'after'='22000'").strip()=='2'
 assert sql("select count(*) from form_events").strip()=='4'
 assert sql("select count(*) from notes").strip()=='0' # Import is not a new follow-up.
 sql("update applications set full_name='Modificado por equipo ficticio' where full_name='Caso Importación Ficticio 0'")
 assert '0|2' in sql(script)
 assert sql("select count(*) from applications where full_name='Modificado por equipo ficticio'").strip()=='1'
 changed=copy.deepcopy(p);changed['cases'][0]['data']['rent_amount']=24000
 sql(builder.build(changed,ROOT),fail=True)
 collision=copy.deepcopy(p);collision['batch_id']='another-batch'
 sql(builder.build(collision,ROOT),fail=True)
 missing=copy.deepcopy(p);missing['owner_email']='missing@example.test'
 sql(builder.build(missing,ROOT),fail=True)
 # New records with a failing second insert must roll the first one back too.
 rollback=copy.deepcopy(p);rollback['batch_id']='rollback-check'
 for i,c in enumerate(rollback['cases']):
  c['data']['full_name']=f'Otro Ficticio {i}';c['data']['phone']=f'5989800000{i+1}'
  for e in c['events']:e['source_key']+='-rollback'
 rollback['cases'][1]['data']['phone']=''
 sql(builder.build(rollback,ROOT),fail=True)
 assert sql("select count(*) from applications").strip()=='2'
 # RLS still protects income/originals; seller may edit ordinary case data, not evidence flags.
 sql("set role authenticated; set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002'; update applications set summary='Cambio permitido ficticio'; do $$begin if exists(select 1 from application_sensitive) or exists(select 1 from form_events) or exists(select 1 from audit_log where visibility='admin') then raise exception 'Sensitive leak';end if;end $$;")
 sql("set role authenticated; set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002'; update applications set decision_date_unknown=false where decision='aprobada';",fail=True)
 sql("set role authenticated; set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002'; update applications set issued_reference_unknown=false where decision='aprobada';",fail=True)
 # Missing references remain invalid unless explicitly marked as historical unknowns.
 sql("update applications set decision_date_unknown=false where decision='aprobada'",fail=True)
 sql("update applications set issued_reference_unknown=false where decision='aprobada'",fail=True)
 sql("update applications set issued_reference='Referencia ficticia completa' where decision='aprobada'")
 assert sql("select issued_reference_unknown from applications where decision='aprobada'").strip()=='f'
 sql("update applications set issued_date=null,issued_reference=null where decision='aprobada'; update applications set guarantee_stage='sin_contactar' where decision='aprobada'")
 assert sql("select count(*) from applications where decision_date_unknown or issued_reference_unknown").strip()=='0'
 # Historical entry correction keeps CRM activity unchanged and is repeatable.
 before_activity=sql("select string_agg(id::text||updated_at::text, ',' order by id) from applications")
 sql("insert into applications(full_name,phone) values('Cliente manual ficticio','59899123456')")
 manual_date=sql("select created_at from applications where full_name='Cliente manual ficticio'")
 correction=(ROOT/'supabase/migrations/010_historical_entry_dates.sql').read_text()
 # Mark fixture events as historical, as actual importer payloads do.
 sql("update form_events set payload=payload||'{\"historical\":true}'::jsonb")
 sql(correction)
 assert sql("select count(*) from applications where created_at='2026-10-20T12:00:00Z'").strip()=='2'
 assert sql("select created_at from applications where full_name='Cliente manual ficticio'")==manual_date
 assert sql("select string_agg(id::text||updated_at::text, ',' order by id) from applications where full_name<>'Cliente manual ficticio'")==before_activity
 assert sql("select count(*) from audit_log where action='historical_entry_date'").strip()=='2'
 sql(correction)
 assert sql("select count(*) from audit_log where action='historical_entry_date'").strip()=='2'
 assert sql("select tgenabled from pg_trigger where tgname='guard_application'").strip()=='O'
 print('PASS: synthetic import, assignment, original evidence, rent history, unknown dates/references, replay, collisions, missing owner, atomic rollback and seller permissions.')
finally:
 subprocess.run(['docker','rm','-f',container],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
