\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

WITH catalog_lines AS (
  SELECT 'column|' || n.nspname || '|' || c.relname || '|' || a.attnum || '|' ||
         a.attname || '|' || format_type(a.atttypid, a.atttypmod) || '|' ||
         a.attnotnull || '|' || a.attidentity::text || '|' ||
         COALESCE(pg_get_expr(d.adbin, d.adrelid), '') AS line
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
     AND a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
    SELECT 'constraint|' || conrelid::regclass::text || '|' || conname || '|' ||
      contype::text || '|' || pg_get_constraintdef(oid)
    FROM pg_constraint
   WHERE connamespace = 'public'::regnamespace
  UNION ALL
  SELECT 'index|' || schemaname || '|' || tablename || '|' || indexname || '|' || indexdef
    FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL
  SELECT 'policy|' || schemaname || '|' || tablename || '|' || policyname || '|' ||
         permissive || '|' || roles::text || '|' || cmd || '|' ||
         COALESCE(qual, '') || '|' || COALESCE(with_check, '')
    FROM pg_policies WHERE schemaname = 'public'
  UNION ALL
  SELECT 'function|' || p.oid::regprocedure::text || '|' || p.prosecdef || '|' ||
         COALESCE(p.proconfig::text, '') || '|' || pg_get_functiondef(p.oid)
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
)
SELECT md5(string_agg(line, E'\n' ORDER BY line)) FROM catalog_lines;