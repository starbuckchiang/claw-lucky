-- WEB-HOME-01B.1C production compatibility preflight.
-- Read-only: queries pg_catalog only; never reads application rows.
-- A mismatch raises an exception. A PASS permits a future human-approved
-- baseline history-marking stage; it does not perform that marking.

\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

DO $$
DECLARE
  v_table text;
  v_actual text;
  v_count integer;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'users', 'mascots', 'gifts', 'user_mascots', 'redeem_history',
    'shop_products', 'shop_cart', 'orders', 'order_items'
  ] LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      RAISE EXCEPTION 'Missing required table public.%', v_table;
    END IF;
  END LOOP;

  WITH expected(table_name, ordinal_position, column_name, data_type, nullable, default_pattern, identity_mode) AS (
    VALUES
      ('users',1,'id','uuid',false,'gen_random_uuid', ''), ('users',2,'user_id','uuid',false,NULL,''), ('users',3,'nickname','text',true,NULL,''), ('users',4,'coins','bigint',true,'0',''), ('users',5,'points','bigint',true,'0',''), ('users',6,'tickets','bigint',true,'0',''), ('users',7,'status','text',true,'''active''',''), ('users',8,'created_at','timestamp with time zone',true,'now',''), ('users',9,'updated_at','timestamp with time zone',true,'now',''), ('users',10,'legacy_user_id','text',true,NULL,''),
      ('mascots',1,'id','text',false,NULL,''), ('mascots',2,'name','text',false,NULL,''), ('mascots',3,'rarity','text',false,NULL,''), ('mascots',4,'title','text',true,NULL,''), ('mascots',5,'description','text',true,NULL,''), ('mascots',6,'image','text',true,NULL,''), ('mascots',7,'silhouette','text',true,NULL,''), ('mascots',8,'points','integer',true,'0',''), ('mascots',9,'tickets','integer',true,'0',''), ('mascots',10,'duplicate_bonus','integer',true,'0',''), ('mascots',11,'enabled','boolean',true,'true',''), ('mascots',12,'sort_order','integer',true,'0',''), ('mascots',13,'created_at','timestamp with time zone',true,'now',''), ('mascots',14,'updated_at','timestamp with time zone',true,'now',''),
      ('gifts',1,'id','text',false,NULL,''), ('gifts',2,'name','text',false,NULL,''), ('gifts',3,'description','text',true,NULL,''), ('gifts',4,'image','text',true,NULL,''), ('gifts',5,'points_cost','integer',true,'0',''), ('gifts',6,'tickets_cost','integer',true,'0',''), ('gifts',7,'coins_cost','integer',true,'0',''), ('gifts',8,'stock','integer',true,'999999',''), ('gifts',9,'enabled','boolean',true,'true',''), ('gifts',10,'sort_order','integer',true,'0',''), ('gifts',11,'created_at','timestamp with time zone',true,'now',''), ('gifts',12,'updated_at','timestamp with time zone',true,'now',''),
      ('user_mascots',1,'id','bigint',false,NULL,'ALWAYS'), ('user_mascots',2,'user_id','text',false,NULL,''), ('user_mascots',3,'mascot_id','text',false,NULL,''), ('user_mascots',4,'mascot_name','text',true,NULL,''), ('user_mascots',5,'rarity','text',true,NULL,''), ('user_mascots',6,'image','text',true,NULL,''), ('user_mascots',7,'first_obtained_at','timestamp with time zone',true,'now',''), ('user_mascots',8,'last_obtained_at','timestamp with time zone',true,'now',''), ('user_mascots',9,'obtain_count','integer',true,'1',''),
      ('redeem_history',1,'id','bigint',false,NULL,'ALWAYS'), ('redeem_history',2,'user_id','text',false,NULL,''), ('redeem_history',3,'nickname','text',true,NULL,''), ('redeem_history',4,'gift_id','text',false,NULL,''), ('redeem_history',5,'gift_name','text',false,NULL,''), ('redeem_history',6,'quantity','integer',true,'1',''), ('redeem_history',7,'points_cost','integer',true,'0',''), ('redeem_history',8,'tickets_cost','integer',true,'0',''), ('redeem_history',9,'coins_cost','integer',true,'0',''), ('redeem_history',10,'status','text',true,'''pending''',''), ('redeem_history',11,'note','text',true,NULL,''), ('redeem_history',12,'created_at','timestamp with time zone',true,'now',''), ('redeem_history',13,'updated_at','timestamp with time zone',true,'now',''),
      ('shop_products',1,'id','uuid',false,'gen_random_uuid',''), ('shop_products',2,'name','text',false,NULL,''), ('shop_products',3,'subtitle','text',true,NULL,''), ('shop_products',4,'description','text',true,NULL,''), ('shop_products',5,'image','text',true,NULL,''), ('shop_products',6,'category','text',true,'''general''',''), ('shop_products',7,'price','integer',true,'0',''), ('shop_products',8,'stock','integer',true,'0',''), ('shop_products',9,'weight','integer',true,'0',''), ('shop_products',10,'enabled','boolean',true,'true',''), ('shop_products',11,'featured','boolean',true,'false',''), ('shop_products',12,'unlock_type','text',true,'''none''',''), ('shop_products',13,'unlock_value','text',true,NULL,''), ('shop_products',14,'badge','text',true,NULL,''), ('shop_products',15,'sort_order','integer',true,'0',''), ('shop_products',16,'created_at','timestamp with time zone',true,'now',''), ('shop_products',17,'updated_at','timestamp with time zone',true,'now',''), ('shop_products',18,'required_mascot_id','text',true,NULL,''), ('shop_products',19,'required_mascot_count','integer',true,'1',''), ('shop_products',20,'thumbnail','text',true,NULL,''), ('shop_products',21,'cover','text',true,NULL,''),
      ('shop_cart',1,'id','uuid',false,'gen_random_uuid',''), ('shop_cart',2,'user_id','text',false,NULL,''), ('shop_cart',3,'product_id','uuid',false,NULL,''), ('shop_cart',4,'quantity','integer',false,'1',''), ('shop_cart',5,'selected','boolean',true,'true',''), ('shop_cart',6,'created_at','timestamp with time zone',true,'now',''), ('shop_cart',7,'updated_at','timestamp with time zone',true,'now',''), ('shop_cart',8,'unlock_verified','boolean',true,'false',''),
      ('orders',1,'id','uuid',false,'gen_random_uuid',''), ('orders',2,'user_id','text',false,NULL,''), ('orders',3,'order_no','text',true,NULL,''), ('orders',4,'total_amount','numeric',false,'0',''), ('orders',5,'total_items','integer',false,'0',''), ('orders',6,'status','text',false,'''pending''',''), ('orders',7,'created_at','timestamp with time zone',false,'now',''), ('orders',8,'updated_at','timestamp with time zone',false,'now',''), ('orders',9,'lucky_message','text',true,NULL,''), ('orders',10,'payment_provider','text',true,NULL,''), ('orders',11,'payment_method','text',true,NULL,''), ('orders',12,'payment_status','text',false,'''unpaid''',''), ('orders',13,'merchant_trade_no','text',true,NULL,''), ('orders',14,'provider_trade_no','text',true,NULL,''), ('orders',15,'paid_at','timestamp with time zone',true,NULL,''), ('orders',16,'payment_raw','jsonb',true,NULL,''),
      ('order_items',1,'id','uuid',false,'gen_random_uuid',''), ('order_items',2,'order_id','uuid',false,NULL,''), ('order_items',3,'product_id','uuid',false,NULL,''), ('order_items',4,'product_name','text',false,NULL,''), ('order_items',5,'product_image','text',true,NULL,''), ('order_items',6,'price','numeric',false,NULL,''), ('order_items',7,'quantity','integer',false,'1',''), ('order_items',8,'subtotal','numeric',false,NULL,''), ('order_items',9,'created_at','timestamp with time zone',false,'now','')
  ), actual AS (
    SELECT table_name, ordinal_position, column_name, data_type,
           is_nullable = 'YES' AS nullable, column_default, identity_generation
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN ('users','mascots','gifts','user_mascots','redeem_history','shop_products','shop_cart','orders','order_items')
  )
  SELECT string_agg(COALESCE(e.table_name,a.table_name) || '.' || COALESCE(e.column_name,a.column_name), ', ' ORDER BY COALESCE(e.table_name,a.table_name), COALESCE(e.ordinal_position,a.ordinal_position))
    INTO v_actual
    FROM expected e FULL JOIN actual a USING (table_name, ordinal_position)
   WHERE e.column_name IS DISTINCT FROM a.column_name
      OR e.data_type IS DISTINCT FROM a.data_type
      OR e.nullable IS DISTINCT FROM a.nullable
      OR COALESCE(e.identity_mode,'') IS DISTINCT FROM COALESCE(a.identity_generation,'')
      OR (e.default_pattern IS NULL AND a.column_default IS NOT NULL)
      OR (e.default_pattern IS NOT NULL AND COALESCE(a.column_default,'') NOT ILIKE '%' || e.default_pattern || '%');
  IF v_actual IS NOT NULL THEN RAISE EXCEPTION 'Legacy column mismatch: %', v_actual; END IF;

  SELECT count(*) INTO v_count FROM pg_constraint
   WHERE (conrelid, conname, contype, pg_get_constraintdef(oid)) IN (
     ('public.users'::regclass,'users_pkey','p','PRIMARY KEY (id)'),
     ('public.users'::regclass,'users_user_id_key','u','UNIQUE (user_id)'),
     ('public.shop_cart'::regclass,'shop_cart_user_id_product_id_key','u','UNIQUE (user_id, product_id)'),
     ('public.orders'::regclass,'orders_order_no_key','u','UNIQUE (order_no)'),
     ('public.orders'::regclass,'orders_merchant_trade_no_key','u','UNIQUE (merchant_trade_no)')
   );
  IF v_count <> 5 THEN RAISE EXCEPTION 'Required PK/UNIQUE constraints are incompatible'; END IF;

  SELECT count(*) INTO v_count FROM pg_constraint
   WHERE (conrelid, conname, confdeltype, pg_get_constraintdef(oid)) IN (
     ('public.shop_cart'::regclass,'shop_cart_product_id_fkey','c','FOREIGN KEY (product_id) REFERENCES shop_products(id) ON DELETE CASCADE'),
     ('public.order_items'::regclass,'order_items_order_id_fkey','c','FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE')
   );
  IF v_count <> 2 THEN RAISE EXCEPTION 'Required legacy foreign keys are incompatible'; END IF;

  SELECT count(*) INTO v_count FROM pg_indexes
   WHERE schemaname = 'public' AND indexname IN ('idx_orders_user','idx_order_items_order','idx_order_items_product');
  IF v_count <> 3 THEN RAISE EXCEPTION 'Required legacy indexes are missing'; END IF;

  SELECT count(*) INTO v_count FROM pg_trigger
   WHERE tgrelid = 'public.orders'::regclass AND tgname = 'trigger_set_order_no'
     AND NOT tgisinternal AND (tgtype & 2) = 2 AND (tgtype & 4) = 4;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Order-number BEFORE INSERT trigger is incompatible'; END IF;

  SELECT count(*) INTO v_count FROM pg_proc
   WHERE oid IN ('public.generate_order_no()'::regprocedure, 'public.set_order_no()'::regprocedure)
     AND prosecdef AND 'search_path=public' = ANY(proconfig);
  IF v_count <> 2 THEN RAISE EXCEPTION 'Order-number functions are missing or not hardened'; END IF;

  SELECT pg_get_functiondef('public.generate_order_no()'::regprocedure) INTO v_actual;
  IF v_actual NOT LIKE '%Asia/Taipei%'
     OR v_actual NOT LIKE '%pg_advisory_xact_lock%'
     OR v_actual NOT LIKE '%LUCK-%'
     OR v_actual NOT LIKE '%lpad%' THEN
    RAISE EXCEPTION 'generate_order_no contract mismatch';
  END IF;

  SELECT count(*) INTO v_count FROM pg_class
   WHERE oid IN (
     'public.users'::regclass, 'public.mascots'::regclass, 'public.gifts'::regclass,
     'public.user_mascots'::regclass, 'public.redeem_history'::regclass,
     'public.shop_products'::regclass, 'public.shop_cart'::regclass,
     'public.orders'::regclass, 'public.order_items'::regclass
   ) AND relrowsecurity;
  IF v_count <> 9 THEN RAISE EXCEPTION 'RLS is not enabled on all legacy tables'; END IF;
END;
$$;

SELECT 'WEB_HOME_01B1C_PRODUCTION_COMPATIBILITY_PASS' AS result;
ROLLBACK;