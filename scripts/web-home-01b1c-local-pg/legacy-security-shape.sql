-- Disposable local fixture reproducing only the manifest-captured insecure
-- policy/grant shape that the convergence migration must remove.

CREATE POLICY users_insert_own ON public.users FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY users_select_own ON public.users FOR SELECT TO authenticated USING (true);
CREATE POLICY users_update_own ON public.users FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "allow anon read mascots" ON public.mascots FOR SELECT TO anon USING (true);
CREATE POLICY user_mascots_delete_own ON public.user_mascots FOR DELETE TO authenticated USING (true);
CREATE POLICY user_mascots_insert_own ON public.user_mascots FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY user_mascots_select_own ON public.user_mascots FOR SELECT TO authenticated USING (true);
CREATE POLICY user_mascots_update_own ON public.user_mascots FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "allow anon select redeem history" ON public.redeem_history FOR SELECT TO anon USING (true);
CREATE POLICY redeem_history_insert_own ON public.redeem_history FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY redeem_history_select_own ON public.redeem_history FOR SELECT TO authenticated USING (true);
CREATE POLICY shop_cart_delete_own ON public.shop_cart FOR DELETE TO authenticated USING (true);
CREATE POLICY shop_cart_insert_own ON public.shop_cart FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY shop_cart_select_own ON public.shop_cart FOR SELECT TO authenticated USING (true);
CREATE POLICY shop_cart_update_own ON public.shop_cart FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY orders_insert_all ON public.orders FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY orders_select_all ON public.orders FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY orders_update_all ON public.orders FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY order_items_insert_all ON public.order_items FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY order_items_select_all ON public.order_items FOR SELECT TO anon, authenticated USING (true);

GRANT ALL PRIVILEGES ON TABLE
  public.users, public.mascots, public.gifts, public.user_mascots,
  public.redeem_history, public.shop_products, public.shop_cart,
  public.orders, public.order_items
TO anon, authenticated;

GRANT ALL PRIVILEGES ON SEQUENCE
  public.user_mascots_id_seq, public.redeem_history_id_seq
TO anon, authenticated;

GRANT ALL ON FUNCTION public.generate_order_no() TO anon, authenticated;
GRANT ALL ON FUNCTION public.set_order_no() TO anon, authenticated;