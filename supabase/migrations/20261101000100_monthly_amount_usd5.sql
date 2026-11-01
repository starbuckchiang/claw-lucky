-- New monthly checkouts are USD 5 again.
-- Historical rows stay as stored. The amount check already allows 1.00 and 5.00.
-- Yearly remains 48.00. No monthly_test.

DO $$
DECLARE
  def text;
  n1 int;
  n5 int;
BEGIN
  def := pg_get_functiondef('public.acquire_subscription_slot(text,text,text)'::regprocedure);
  n1 := (length(def) - length(replace(def, 'v_amount := 1.00', ''))) / length('v_amount := 1.00');
  n5 := (length(def) - length(replace(def, 'v_amount := 5.00', ''))) / length('v_amount := 5.00');
  IF position('v_amount := 48.00' in def) = 0 THEN
    RAISE EXCEPTION 'yearly amount missing';
  END IF;
  IF position('monthly_test' in def) > 0 THEN
    RAISE EXCEPTION 'monthly_test present';
  END IF;
  IF n1 = 1 AND n5 = 0 THEN
    EXECUTE replace(def, 'v_amount := 1.00', 'v_amount := 5.00');
  ELSIF n1 = 0 AND n5 = 1 THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'unexpected monthly amount assignments: 1.00=%, 5.00=%', n1, n5;
  END IF;
END $$;
