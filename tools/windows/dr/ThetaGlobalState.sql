-- Names and privileges only. Never export role passwords or setting values.
WITH app_namespace AS (
  SELECT oid,nspname,nspowner,nspacl FROM pg_namespace
  WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'
)
SELECT jsonb_build_object(
 'formatVersion',1,
 'roles',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'name',rolname,'login',rolcanlogin,'superuser',rolsuper,'createRole',rolcreaterole,
   'createDatabase',rolcreatedb,'classification',CASE WHEN rolname LIKE 'pg_%' OR rolname LIKE 'avn%'
     OR left(rolname,6)='_aiven' OR left(rolname,9)='_avnadmin'
     OR rolname='postgres' THEN 'PROVIDER_MANAGED_RECREATE'
     ELSE 'PORTABLE_APPLICATION_OBJECT' END,
   'password','SECRET_RESTORE_SEPARATELY') ORDER BY rolname),'[]'::jsonb) FROM pg_roles),
 'database',(SELECT jsonb_build_object('name',datname,'owner',pg_get_userbyid(datdba),
   'acl',coalesce(datacl::text,''),'classification','PROVIDER_MANAGED_RECREATE')
   FROM pg_database WHERE datname=current_database()),
 'schemas',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',nspname,
   'owner',pg_get_userbyid(nspowner),'acl',coalesce(nspacl::text,''),
   'classification','PORTABLE_APPLICATION_OBJECT') ORDER BY nspname),'[]'::jsonb) FROM app_namespace),
 'objects',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',n.nspname||'.'||c.relname,
   'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'acl',coalesce(c.relacl::text,''),
   'classification','PORTABLE_APPLICATION_OBJECT') ORDER BY n.nspname,c.relname),'[]'::jsonb)
   FROM pg_class c JOIN app_namespace n ON n.oid=c.relnamespace
   WHERE c.relkind IN ('r','p','v','m','S','f')),
 'routines',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'name',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
   'owner',pg_get_userbyid(p.proowner),'acl',coalesce(p.proacl::text,''),
   'classification','PORTABLE_APPLICATION_OBJECT')
   ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::jsonb)
   FROM pg_proc p JOIN app_namespace n ON n.oid=p.pronamespace WHERE p.prokind IN ('f','p','w')),
 'defaultPrivileges',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'owner',pg_get_userbyid(d.defaclrole),'schema',coalesce(n.nspname,''),
   'objectType',d.defaclobjtype,'acl',d.defaclacl::text,
   'classification','PORTABLE_APPLICATION_OBJECT')
   ORDER BY pg_get_userbyid(d.defaclrole),coalesce(n.nspname,''),d.defaclobjtype),'[]'::jsonb)
   FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace),
 'databaseRoleSettings',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'role',CASE WHEN s.setrole=0 THEN 'ALL' ELSE s.setrole::regrole::text END,
   'database',CASE WHEN s.setdatabase=0 THEN 'ALL'
     ELSE (SELECT datname FROM pg_database WHERE oid=s.setdatabase) END,
   'settingNames',coalesce((SELECT jsonb_agg(split_part(setting,'=',1) ORDER BY split_part(setting,'=',1))
     FROM unnest(s.setconfig) setting),'[]'::jsonb),
   'settingValues','SECRET_RESTORE_SEPARATELY','classification','PROVIDER_MANAGED_RECREATE')
   ORDER BY s.setdatabase,s.setrole),'[]'::jsonb) FROM pg_db_role_setting s),
 'safeCurrentSettings',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'name',name,'value',setting,'source',source,'classification','PROVIDER_MANAGED_RECREATE')
   ORDER BY name),'[]'::jsonb) FROM pg_settings WHERE name IN
   ('server_version','server_encoding','TimeZone','search_path','default_transaction_read_only',
    'statement_timeout','idle_in_transaction_session_timeout','max_connections')),
 'tablespaces',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',spcname,
   'owner',pg_get_userbyid(spcowner),'classification','PROVIDER_MANAGED_RECREATE')
   ORDER BY spcname),'[]'::jsonb) FROM pg_tablespace),
 'extensions',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,
   'schema',n.nspname,'classification',CASE WHEN e.extname='plpgsql' THEN 'PROVIDER_MANAGED_RECREATE'
   ELSE 'PORTABLE_APPLICATION_OBJECT' END) ORDER BY e.extname),'[]'::jsonb)
   FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace)
)::text;
