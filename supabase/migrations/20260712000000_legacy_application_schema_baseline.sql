-- WEB-HOME-01B.1C: authoritative zero-data legacy application baseline.
--
-- New databases apply this migration normally. Existing production must not
-- execute these CREATE TABLE statements: after a separate exact catalog
-- compatibility check and human approval, this historical version may be
-- marked applied in a later release task. This migration contains no rows.
--
-- Rollback (new/disposable databases only): drop the nine tables in reverse
-- dependency order, then drop set_order_no() and generate_order_no(). Never
-- use that rollback on an existing environment containing application data.

CREATE TABLE public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE,
    nickname TEXT,
    coins BIGINT DEFAULT 0,
    points BIGINT DEFAULT 0,
    tickets BIGINT DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    legacy_user_id TEXT
);

CREATE TABLE public.mascots (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    rarity TEXT NOT NULL,
    title TEXT,
    description TEXT,
    image TEXT,
    silhouette TEXT,
    points INTEGER DEFAULT 0,
    tickets INTEGER DEFAULT 0,
    duplicate_bonus INTEGER DEFAULT 0,
    enabled BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.gifts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    image TEXT,
    points_cost INTEGER DEFAULT 0,
    tickets_cost INTEGER DEFAULT 0,
    coins_cost INTEGER DEFAULT 0,
    stock INTEGER DEFAULT 999999,
    enabled BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.user_mascots (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id TEXT NOT NULL,
    mascot_id TEXT NOT NULL,
    mascot_name TEXT,
    rarity TEXT,
    image TEXT,
    first_obtained_at TIMESTAMPTZ DEFAULT now(),
    last_obtained_at TIMESTAMPTZ DEFAULT now(),
    obtain_count INTEGER DEFAULT 1,
    CONSTRAINT user_mascots_user_id_mascot_id_key UNIQUE (user_id, mascot_id)
);

CREATE TABLE public.redeem_history (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id TEXT NOT NULL,
    nickname TEXT,
    gift_id TEXT NOT NULL,
    gift_name TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    points_cost INTEGER DEFAULT 0,
    tickets_cost INTEGER DEFAULT 0,
    coins_cost INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.shop_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    subtitle TEXT,
    description TEXT,
    image TEXT,
    category TEXT DEFAULT 'general',
    price INTEGER DEFAULT 0,
    stock INTEGER DEFAULT 0,
    weight INTEGER DEFAULT 0,
    enabled BOOLEAN DEFAULT true,
    featured BOOLEAN DEFAULT false,
    unlock_type TEXT DEFAULT 'none',
    unlock_value TEXT,
    badge TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    required_mascot_id TEXT,
    required_mascot_count INTEGER DEFAULT 1,
    thumbnail TEXT,
    cover TEXT
);

CREATE TABLE public.shop_cart (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    selected BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    unlock_verified BOOLEAN DEFAULT false,
    CONSTRAINT shop_cart_user_id_product_id_key UNIQUE (user_id, product_id),
    CONSTRAINT shop_cart_product_id_fkey
        FOREIGN KEY (product_id) REFERENCES public.shop_products(id)
        ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE TABLE public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    order_no TEXT,
    total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_items INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lucky_message TEXT,
    payment_provider TEXT,
    payment_method TEXT,
    payment_status TEXT NOT NULL DEFAULT 'unpaid',
    merchant_trade_no TEXT,
    provider_trade_no TEXT,
    paid_at TIMESTAMPTZ,
    payment_raw JSONB,
    CONSTRAINT orders_order_no_key UNIQUE (order_no),
    CONSTRAINT orders_merchant_trade_no_key UNIQUE (merchant_trade_no)
);

CREATE TABLE public.order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL,
    product_id UUID NOT NULL,
    product_name TEXT NOT NULL,
    product_image TEXT,
    price NUMERIC(10,2) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    subtotal NUMERIC(10,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT order_items_order_id_fkey
        FOREIGN KEY (order_id) REFERENCES public.orders(id)
        ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE INDEX idx_orders_user ON public.orders (user_id);
CREATE INDEX idx_order_items_order ON public.order_items (order_id);
CREATE INDEX idx_order_items_product ON public.order_items (product_id);

CREATE FUNCTION public.generate_order_no()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    date_part_text TEXT;
    next_sequence INTEGER;
BEGIN
    date_part_text := to_char(now() AT TIME ZONE 'Asia/Taipei', 'YYMMDD');

    PERFORM pg_advisory_xact_lock(hashtext('orders-' || date_part_text));

    SELECT COALESCE(
        MAX(NULLIF(split_part(order_no, '-', 3), '')::INTEGER),
        0
    ) + 1
      INTO next_sequence
      FROM public.orders
     WHERE order_no LIKE 'LUCK-' || date_part_text || '-%';

    RETURN 'LUCK-' || date_part_text || '-' || lpad(next_sequence::TEXT, 6, '0');
END;
$$;

CREATE FUNCTION public.set_order_no()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.order_no IS NULL OR btrim(NEW.order_no) = '' THEN
        NEW.order_no := public.generate_order_no();
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_set_order_no
    BEFORE INSERT ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.set_order_no();

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mascots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_mascots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.redeem_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_cart ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY mascots_public_select
    ON public.mascots
    FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY gifts_public_select
    ON public.gifts
    FOR SELECT
    TO anon, authenticated
    USING (enabled = true);

CREATE POLICY shop_products_public_select
    ON public.shop_products
    FOR SELECT
    TO anon, authenticated
    USING (enabled = true);

REVOKE ALL PRIVILEGES ON TABLE
    public.users,
    public.mascots,
    public.gifts,
    public.user_mascots,
    public.redeem_history,
    public.shop_products,
    public.shop_cart,
    public.orders,
    public.order_items
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.mascots, public.gifts, public.shop_products
TO anon, authenticated;

GRANT SELECT ON TABLE
    public.users,
    public.user_mascots,
    public.redeem_history,
    public.shop_cart,
    public.orders,
    public.order_items
TO authenticated;

GRANT ALL PRIVILEGES ON TABLE
    public.users,
    public.mascots,
    public.gifts,
    public.user_mascots,
    public.redeem_history,
    public.shop_products,
    public.shop_cart,
    public.orders,
    public.order_items
TO service_role;

REVOKE ALL PRIVILEGES ON SEQUENCE
    public.user_mascots_id_seq,
    public.redeem_history_id_seq
FROM PUBLIC, anon, authenticated;

GRANT USAGE, SELECT ON SEQUENCE
    public.user_mascots_id_seq,
    public.redeem_history_id_seq
TO service_role;

REVOKE ALL ON FUNCTION public.generate_order_no() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_order_no() FROM PUBLIC, anon, authenticated;