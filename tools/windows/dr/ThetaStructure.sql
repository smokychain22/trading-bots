-- Portable application structure. Definition bodies are hashed, not exported as plaintext.
-- Object ownership and ACLs are inventoried separately because provider roles cannot be
-- assumed to exist at the restore target.
WITH app_namespace AS (
  SELECT oid, nspname FROM pg_namespace
  WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'
), structure AS (
 SELECT jsonb_build_object(
  'formatVersion', 1,
  'schemas', (SELECT coalesce(jsonb_agg(nspname ORDER BY nspname),'[]'::jsonb) FROM app_namespace),
  'tables', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'name',n.nspname||'.'||c.relname,'kind',c.relkind,'persistence',c.relpersistence,
    'partition',coalesce(md5(pg_get_partkeydef(c.oid)),''),
    'partitionBound',coalesce(md5(pg_get_expr(c.relpartbound,c.oid)),''),
    'parents',coalesce((SELECT jsonb_agg(pn.nspname||'.'||parent.relname ORDER BY pn.nspname,parent.relname)
      FROM pg_inherits inh JOIN pg_class parent ON parent.oid=inh.inhparent
      JOIN pg_namespace pn ON pn.oid=parent.relnamespace WHERE inh.inhrelid=c.oid),'[]'::jsonb),
    'rlsEnabled',c.relrowsecurity,
    'rlsForced',c.relforcerowsecurity) ORDER BY n.nspname,c.relname),'[]'::jsonb)
    FROM pg_class c JOIN app_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p')),
  'columns', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'name',n.nspname||'.'||c.relname||'.'||a.attname,'position',a.attnum,
    'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
    'identity',a.attidentity,'generated',a.attgenerated,
    'defaultHash',coalesce(md5(pg_get_expr(d.adbin,d.adrelid)),''),
    'collation',CASE WHEN a.attcollation=0 THEN '' ELSE a.attcollation::regcollation::text END)
    ORDER BY n.nspname,c.relname,a.attnum),'[]'::jsonb)
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN app_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped),
  'constraints', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'name',n.nspname||'.'||c.relname||'.'||co.conname,'kind',co.contype,
    'validated',co.convalidated,'definitionHash',md5(pg_get_constraintdef(co.oid,true)))
    ORDER BY n.nspname,c.relname,co.conname),'[]'::jsonb)
    FROM pg_constraint co JOIN pg_class c ON c.oid=co.conrelid JOIN app_namespace n ON n.oid=c.relnamespace),
  'indexes', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'name',n.nspname||'.'||i.relname,'table',t.relname,'unique',x.indisunique,
    'primary',x.indisprimary,'valid',x.indisvalid,'definitionHash',md5(pg_get_indexdef(i.oid)))
    ORDER BY n.nspname,i.relname),'[]'::jsonb)
    FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class t ON t.oid=x.indrelid
    JOIN app_namespace n ON n.oid=t.relnamespace),
  'sequences', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'name',n.nspname||'.'||c.relname,'type',format_type(s.seqtypid,NULL),
    'start',s.seqstart,'increment',s.seqincrement,'min',s.seqmin,'max',s.seqmax,
    'cache',s.seqcache,'cycle',s.seqcycle,
    'ownedBy',coalesce(rn.nspname||'.'||rc.relname||'.'||a.attname,''))
    ORDER BY n.nspname,c.relname),'[]'::jsonb)
    FROM pg_class c JOIN app_namespace n ON n.oid=c.relnamespace JOIN pg_sequence s ON s.seqrelid=c.oid
    LEFT JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=c.oid AND d.refclassid='pg_class'::regclass AND d.deptype IN ('a','i')
    LEFT JOIN pg_class rc ON rc.oid=d.refobjid LEFT JOIN pg_namespace rn ON rn.oid=rc.relnamespace
    LEFT JOIN pg_attribute a ON a.attrelid=d.refobjid AND a.attnum=d.refobjsubid
    WHERE c.relkind='S'),
  'views', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'name',n.nspname||'.'||c.relname,'kind',c.relkind,
    'definitionHash',md5(pg_get_viewdef(c.oid,true))) ORDER BY n.nspname,c.relname),'[]'::jsonb)
    FROM pg_class c JOIN app_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('v','m')),
  'routines', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'name',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
    'kind',p.prokind,'definitionHash',md5(pg_get_functiondef(p.oid)))
    ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::jsonb)
    FROM pg_proc p JOIN app_namespace n ON n.oid=p.pronamespace WHERE p.prokind IN ('f','p','w')),
  'triggers', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'name',n.nspname||'.'||c.relname||'.'||t.tgname,'enabled',t.tgenabled,
    'definitionHash',md5(pg_get_triggerdef(t.oid,true))) ORDER BY n.nspname,c.relname,t.tgname),'[]'::jsonb)
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN app_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal),
  'rules', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'name',n.nspname||'.'||c.relname||'.'||r.rulename,'enabled',r.ev_enabled,
    'definitionHash',md5(pg_get_ruledef(r.oid,true))) ORDER BY n.nspname,c.relname,r.rulename),'[]'::jsonb)
    FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class JOIN app_namespace n ON n.oid=c.relnamespace
    WHERE r.rulename <> '_RETURN'),
  'types', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'name',n.nspname||'.'||t.typname,'kind',t.typtype,
    'base',CASE WHEN t.typbasetype=0 THEN '' ELSE format_type(t.typbasetype,NULL) END,
    'notNull',t.typnotnull,'defaultHash',coalesce(md5(t.typdefault),''),
    'labels',coalesce((SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid),'[]'::jsonb),
    'rangeSubtype',coalesce(format_type(r.rngsubtype,NULL),'')) ORDER BY n.nspname,t.typname),'[]'::jsonb)
    FROM pg_type t JOIN app_namespace n ON n.oid=t.typnamespace LEFT JOIN pg_range r ON r.rngtypid=t.oid
    LEFT JOIN pg_class c ON c.oid=t.typrelid
    WHERE t.typtype IN ('e','d','r','m') OR (t.typtype='c' AND c.relkind='c')),
  'domainConstraints',(SELECT coalesce(jsonb_agg(jsonb_build_object(
    'name',n.nspname||'.'||t.typname||'.'||co.conname,
    'definitionHash',md5(pg_get_constraintdef(co.oid,true)))
    ORDER BY n.nspname,t.typname,co.conname),'[]'::jsonb)
    FROM pg_constraint co JOIN pg_type t ON t.oid=co.contypid
    JOIN app_namespace n ON n.oid=t.typnamespace WHERE t.typtype='d'),
  'rlsPolicies', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'name',n.nspname||'.'||c.relname||'.'||p.polname,'command',p.polcmd,
    'permissive',p.polpermissive,'roles',coalesce((SELECT jsonb_agg(role_name ORDER BY role_name)
      FROM (SELECT CASE WHEN role_oid=0 THEN 'PUBLIC' ELSE role_oid::regrole::text END AS role_name
        FROM unnest(p.polroles) role_oid) role_names),'[]'::jsonb),
    'usingHash',coalesce(md5(pg_get_expr(p.polqual,p.polrelid)),''),
    'checkHash',coalesce(md5(pg_get_expr(p.polwithcheck,p.polrelid)),''))
    ORDER BY n.nspname,c.relname,p.polname),'[]'::jsonb)
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN app_namespace n ON n.oid=c.relnamespace),
  'extensions', (SELECT coalesce(jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname)
    ORDER BY e.extname),'[]'::jsonb) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace),
  'largeObjectCount', (SELECT count(*) FROM pg_largeobject_metadata),
  'migrationHistory', (SELECT coalesce(jsonb_agg(version ORDER BY version),'[]'::jsonb) FROM core.schema_migration)
 ) AS document
)
SELECT document::text FROM structure;
