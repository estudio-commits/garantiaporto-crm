begin;
create function public.validate_custom_value() returns trigger language plpgsql set search_path=public as $$
declare f custom_field_definitions;
begin
 select * into f from custom_field_definitions where id=new.field_id;
 if f.archived then raise exception 'Field is archived';end if;
 if new.value='' then return new;end if;
 if f.type='number' and new.value !~ '^-?[0-9]+([.][0-9]+)?$' then raise exception 'Invalid number';end if;
 if f.type='date' then perform new.value::date;end if;
 if f.type='boolean' and new.value not in ('Sí','No') then raise exception 'Invalid boolean';end if;
 if f.type='select' and not f.options ? new.value then raise exception 'Invalid option';end if;
 return new;
end $$;
create trigger validate_custom before insert or update on custom_field_values for each row execute function validate_custom_value();
-- No ordinary client may delete notes, events or audit rows.
revoke delete on all tables in schema public from authenticated;
commit;
