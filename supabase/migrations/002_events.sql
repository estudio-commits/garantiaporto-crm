begin;
create function public.ingest_event(e jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a applications; d jsonb=e->'data'; aid uuid; cid uuid; existing form_events; discrepancy boolean=false; disorder boolean=false;
begin
 -- Lock a request before looking up the event: both steps serialize, including first insert.
 perform pg_advisory_xact_lock(hashtextextended(e->>'solicitud_id',0));
 select * into existing from form_events where event_id=(e->>'event_id')::uuid;
 if found then
  if existing.payload<>e then raise exception 'Event ID conflict'; end if;
  return jsonb_build_object('application_id',existing.application_id,'duplicate',true);
 end if;
 select * into a from applications where external_id=(e->>'solicitud_id')::uuid for update;
 if not found then
  insert into contacts default values returning id into cid;
  insert into applications(contact_id,external_id,full_name,phone,rent_amount,rent_currency,source,completion,attribution)
  values(cid,(e->>'solicitud_id')::uuid,d->>'full_name',d->>'phone',(d->>'rent_amount')::numeric,d->>'rent_currency','web',case when (e->>'step')::int=2 then 'completo' else 'parte_1_recibida' end,d-ARRAY['full_name','phone','rent_amount','rent_currency','national_id','monthly_income']) returning * into a;
  disorder=(e->>'step')::int=2;
 else
  discrepancy=a.full_name is distinct from d->>'full_name' or a.phone is distinct from d->>'phone' or (d->>'rent_amount' is not null and a.rent_amount is not null and a.rent_amount<>(d->>'rent_amount')::numeric) or (d->>'rent_currency' is not null and a.rent_currency is not null and a.rent_currency<>d->>'rent_currency');
  update applications set completion=case when completion='completo' or (e->>'step')::int=2 then 'completo' else completion end,rent_amount=coalesce(rent_amount,(d->>'rent_amount')::numeric),rent_currency=coalesce(rent_currency,d->>'rent_currency'),attribution=jsonb_strip_nulls(d-ARRAY['full_name','phone','rent_amount','rent_currency','national_id','monthly_income'])||attribution where id=a.id;
 end if;
 if (e->>'step')::int=2 then
  if exists(select 1 from application_sensitive s where s.application_id=a.id and ((nullif(d->>'national_id','') is not null and s.national_id<>'' and s.national_id<>d->>'national_id') or (d->>'monthly_income' is not null and s.monthly_income is not null and s.monthly_income<>(d->>'monthly_income')::numeric))) then discrepancy=true; end if;
  insert into application_sensitive(application_id,national_id,monthly_income) values(a.id,coalesce(d->>'national_id',''),(d->>'monthly_income')::numeric) on conflict(application_id) do update set national_id=coalesce(nullif(application_sensitive.national_id,''),excluded.national_id),monthly_income=coalesce(application_sensitive.monthly_income,excluded.monthly_income);
 end if;
 insert into form_events(id,event_id,application_id,step,sent_at,payload,out_of_order,discrepancy) values((e->>'event_id')::uuid,(e->>'event_id')::uuid,a.id,(e->>'step')::int,(e->>'sent_at')::timestamptz,e,disorder,discrepancy);
 insert into integration_attempts(event_id,status) values((e->>'event_id')::uuid,'processed');
 insert into audit_log(application_id,action,changes) values(a.id,'form_event',jsonb_build_object('step',e->'step','out_of_order',disorder,'discrepancy',discrepancy));
 return jsonb_build_object('application_id',a.id,'duplicate',false,'discrepancy',discrepancy);
end $$;
revoke all on function ingest_event(jsonb) from public,anon,authenticated;
grant execute on function ingest_event(jsonb) to service_role;
commit;
