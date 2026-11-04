#!/usr/bin/env python3
"""Build an atomic SQL Editor import from a privately reviewed JSON payload.
Never put real payloads/output in the repository. No network or database access.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import uuid

def build(payload, root):
    if not isinstance(payload.get('owner_email'), str) or '@' not in payload['owner_email']:
        raise ValueError('A real, existing owner email is required')
    if not payload.get('batch_id') or not payload.get('cases'):
        raise ValueError('Batch identifier and reviewed cases are required')
    payload=json.loads(json.dumps(payload,ensure_ascii=False))
    seen=set(); event_ids=set()
    for case in payload['cases']:
        if not case.get('reviewed'):
            raise ValueError('Every case must have been reviewed')
        identity=str(uuid.uuid5(uuid.NAMESPACE_URL, payload['batch_id']+':'+case['key']))
        if identity in seen:raise ValueError('Repeated case key')
        seen.add(identity)
        case['id']=identity
        case['contact_id']=str(uuid.uuid5(uuid.UUID(identity),'contact'))
        case['marker_id']=str(uuid.uuid5(uuid.UUID(identity),'import-marker'))
        for event in case.get('events',[]):
            event['id']=str(uuid.uuid5(uuid.NAMESPACE_URL,'porto-mail:'+event['source_key']))
            if event['id'] in event_ids:raise ValueError('Repeated source event')
            event_ids.add(event['id'])
        case['digest']=hashlib.sha256(json.dumps({'case':case,'owner':payload['owner_email']},ensure_ascii=False,sort_keys=True).encode()).hexdigest()
    raw=json.dumps(payload,ensure_ascii=False,separators=(',',':'),allow_nan=False)
    migration=(root/'supabase/migrations/009_historical_evidence.sql').read_text().strip()
    assert migration.startswith('begin;') and migration.endswith('commit;')
    # String literal escaping; customer data never becomes executable SQL.
    literal="'"+raw.replace("'","''")+"'::jsonb"
    return ('-- PRIVATE CLIENT DATA. Run in your own Supabase SQL Editor only.\n'
      '-- One transaction. Failure rolls back everything. Repeat imports skip existing batch records.\n'
      'begin;\nset local standard_conforming_strings=on;\nset local lock_timeout=\'10s\';\n'
      "create temporary table porto_import_payload(payload jsonb not null) on commit drop;\n"
      'insert into porto_import_payload values('+literal+');\n'
      +(root/'scripts/historical-import-preflight.sql').read_text()+'\n'
      +migration[len('begin;'):-len('commit;')]+'\n'
      +(root/'scripts/historical-import-apply.sql').read_text()+'\ncommit;\n')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input',type=Path);parser.add_argument('output',type=Path)
    args=parser.parse_args();root=Path(__file__).resolve().parent.parent
    target=args.output.resolve()
    if target.is_relative_to(root):raise ValueError('Output must be outside the repository')
    sql=build(json.loads(args.input.read_text()),root)
    fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as f:f.write(sql)
    print('Private SQL prepared. Not executed.')
if __name__=='__main__':main()
