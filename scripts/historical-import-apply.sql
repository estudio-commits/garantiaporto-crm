do $import$
declare payload jsonb; c jsonb; d jsonb; evt jsonb; h jsonb; target uuid; aid uuid;
begin
 select p.payload into payload from porto_import_payload p;
 select u.id into target from auth.users u join public.profiles p on p.id=u.id where lower(u.email)=lower(payload->>'owner_email') and p.active;
 -- Lock the target profile too: don't import into a concurrently deactivated account.
 perform 1 from public.profiles where id=target and active for share;
 if not found then raise exception 'El responsable ya no esta activo';end if;
 for c in select value from jsonb_array_elements(payload->'cases') loop
  aid=(c->>'id')::uuid;d=c->'data';
  if exists(select 1 from public.applications where id=aid) then
   update porto_import_result set skipped=skipped+1;continue;
  end if;
  insert into public.contacts(id) values((c->>'contact_id')::uuid);
  insert into public.applications(id,contact_id,full_name,phone,national_id,rent_amount,rent_currency,guarantee_type,source,source_id,assigned_user_id,
    completion,stage,guarantee_stage,requested_date,decision,decision_date,decision_date_unknown,decision_reference,issued_date,issued_reference,issued_reference_unknown,summary,attribution)
  values(aid,(c->>'contact_id')::uuid,d->>'full_name',d->>'phone',nullif(d->>'national_id',''),(d->>'rent_amount')::numeric,d->>'rent_currency',d->>'guarantee_type','web','40000000-0000-4000-8000-000000000001',target,
    d->>'completion',d->>'stage',d->>'guarantee_stage',(d->>'requested_date')::date,d->>'decision',(d->>'decision_date')::date,coalesce((d->>'decision_date_unknown')::boolean,false),d->>'decision_reference',
    (d->>'issued_date')::date,d->>'issued_reference',coalesce((d->>'issued_reference_unknown')::boolean,false),coalesce(d->>'summary',''),coalesce(d->'attribution','{}'));
  if c->'sensitive' is not null and c->'sensitive'<>'null'::jsonb then
   insert into public.application_sensitive(application_id,national_id,monthly_income) values(aid,coalesce(c->'sensitive'->>'national_id',''),(c->'sensitive'->>'monthly_income')::numeric);
  end if;
  if c->'clearing' is not null and c->'clearing'<>'null'::jsonb then
   insert into public.clearing_records(application_id,result,detail) values(aid,c->'clearing'->>'result',c->'clearing'->>'detail');
  end if;
  for evt in select value from jsonb_array_elements(c->'events') loop
   insert into public.form_events(id,event_id,application_id,step,sent_at,payload,discrepancy)
   values((evt->>'id')::uuid,(evt->>'id')::uuid,aid,(evt->>'step')::integer,(evt->>'sent_at')::timestamptz,evt->'payload',coalesce((evt->>'discrepancy')::boolean,false));
  end loop;
  for h in select value from jsonb_array_elements(c->'history') loop
   insert into public.audit_log(application_id,actor_id,actor_name,action,changes,visibility,created_at)
   values(aid,null,h->>'actor_name',h->>'action',h->'changes',coalesce(h->>'visibility','admin'),coalesce((h->>'occurred_at')::timestamptz,clock_timestamp()));
  end loop;
  insert into public.audit_log(id,application_id,actor_id,actor_name,action,changes,visibility)
  values((c->>'marker_id')::uuid,aid,null,'Importación histórica autorizada','historical_import',jsonb_build_object('batch_id',payload->>'batch_id','source_digest',c->>'digest','review_id',c->>'key','nota','Datos históricos incorporados al CRM; no es un contacto nuevo con el cliente.'),'admin');
  update porto_import_result set inserted=inserted+1;
 end loop;
end $import$;
select inserted as clientes_cargados,skipped as clientes_ya_importados from porto_import_result;
