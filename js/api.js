const DB = {
  users: "users",
  logs: "logs",
  gifts: "gifts",
  redeemHistory: "redeem_history",
  mascots: "mascots",
  userMascots: "user_mascots"
};

function getSupabaseClient() {
  if (!window.supabaseClient) {
    throw new Error("Supabase 尚未初始化，請確認 config.js 載入順序");
  }

  return window.supabaseClient;
}

window.Api = {
  async getUser(userId) {
    const { data, error } = await getSupabaseClient()
      .from(DB.users)
      .select("user_id,nickname,points,tickets,coins")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw error;

    return data;
  },

  async createUserIfNotExists({ userId, nickname = "" }) {
    const { data, error } = await getSupabaseClient()
      .from(DB.users)
      .upsert(
        {
          user_id: userId,
          nickname,
          points: 0,
          tickets: 0,
          coins: 20,
          updated_at: new Date().toISOString()
        },
        { 
          onConflict: "user_id"
        
        }
      )
      .select("user_id,nickname,points,tickets,coins")
      .single();

    if (error) throw error;

    return data;
  },

  async upsertUserMascot({
  userId,
  mascotId,
  mascotName = "",
  rarity = "",
  image = ""
}) {
  
  const existing = await getSupabaseClient()
    .from("user_mascots")
    .select("*")
    .eq("user_id", userId)
    .eq("mascot_id", mascotId)
    .maybeSingle();

  if (existing.error) throw existing.error;

  if (existing.data) {
    const { data, error } = await getSupabaseClient()
      .from("user_mascots")
      .update({
        mascot_name: mascotName || existing.data.mascot_name,
        rarity: rarity || existing.data.rarity,
        image: image || existing.data.image,
        obtain_count: Number(existing.data.obtain_count || 1) + 1,
        last_obtained_at: new Date().toISOString()
      })
      .eq("user_id", userId)
      .eq("mascot_id", mascotId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  const { data, error } = await getSupabaseClient()
    .from("user_mascots")
    .insert({
      user_id: userId,
      mascot_id: mascotId,
      mascot_name: mascotName,
      rarity,
      image,
      obtain_count: 1,
      first_obtained_at: new Date().toISOString(),
      last_obtained_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) throw error;
  return data;
},

async getUserMascots(userId) {
  const { data, error } = await getSupabaseClient()
    .from("user_mascots")
    .select("*")
    .eq("user_id", userId)
    .order("first_obtained_at", { ascending: false });

  if (error) throw error;
  return data || [];
},
  async getGiftList() {
    const { data, error } = await getSupabaseClient()
      .from(DB.gifts)
      .select("*")
      .eq("enabled", true)
      .gt("stock", 0)
      .order("sort_order", { ascending: true });

    if (error) throw error;

    return data || [];
  },

  async getMascots() {
  const { data, error } = await getSupabaseClient()
    .from("mascots")
    .select("*")
    .eq("enabled", true)
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return data || [];
},

  async getGiftById(giftId) {
    const { data, error } = await getSupabaseClient()
      .from(DB.gifts)
      .select("*")
      .eq("id", giftId)
      .maybeSingle();

    if (error) throw error;

    return data;
  },

  async adjustBalance({
    userId,
    nickname = "",
    pointsDelta = 0,
    ticketsDelta = 0,
    coinsDelta = 0,
    source = "",
    note = "",
    actionType = "adjust_balance"
  }) {
    const user = await this.getUser(userId);

    if (!user) {
      throw new Error("找不到使用者");
    }

    const nextPoints = Number(user.points || 0) + Number(pointsDelta || 0);
    const nextTickets = Number(user.tickets || 0) + Number(ticketsDelta || 0);
    const nextCoins = Number(user.coins || 0) + Number(coinsDelta || 0);

    if (nextPoints < 0) throw new Error("點數不足");
    if (nextTickets < 0) throw new Error("抽獎券不足");
    if (nextCoins < 0) throw new Error("金幣不足");

    const { data, error } = await getSupabaseClient()
      .from(DB.users)
      .update({
        nickname: nickname || user.nickname || "",
        points: nextPoints,
        tickets: nextTickets,
        coins: nextCoins,
        updated_at: new Date().toISOString()
      })
      .eq("user_id", userId)
      .select("user_id,nickname,points,tickets,coins")
      .single();

    if (error) throw error;

    await this.addLog({
      userId,
      nickname,
      actionType,
      coinsDelta,
      pointsDelta,
      ticketsDelta,
      note,
      source
    });

    return data;
  },

  async addLog({
    userId,
    nickname = "",
    actionType = "adjust_balance",
    coinsDelta = 0,
    pointsDelta = 0,
    ticketsDelta = 0,
    note = "",
    source = ""
  }) {
    const { error } = await getSupabaseClient()
      .from(DB.logs)
      .insert({
        user_id: userId,
        nickname,
        action_type: actionType,
        coins_change: Number(coinsDelta || 0),
        points_change: Number(pointsDelta || 0),
        tickets_change: Number(ticketsDelta || 0),
        note,
        source,
        created_at: new Date().toISOString()
      });

    if (error) {
      console.warn("[api debug] logs insert failed =", error);
    }
  },

  
  async addRedeemHistory({
    userId,
    nickname = "",
    giftId,
    giftName,
    quantity = 1,
    pointsCost = 0,
    ticketsCost = 0,
    coinsCost = 0,
    note = ""
  }) {
    const { data, error } = await getSupabaseClient()
      .from(DB.redeemHistory)
      .insert({
        user_id: userId,
        nickname,
        gift_id: giftId,
        gift_name: giftName,
        quantity: Number(quantity || 1),
        points_cost: Number(pointsCost || 0),
        tickets_cost: Number(ticketsCost || 0),
        coins_cost: Number(coinsCost || 0),
        status: "pending",
        note,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    return data;
  },  

   async getRedeemHistory(userId) {
  const { data, error } = await getSupabaseClient()
    .from(DB.redeemHistory)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return data || [];
 },  
  
  async redeemGift({
    userId,
    nickname = "",
    giftId,
    giftName,
    pointsCost = 0,
    ticketsCost = 0,
    coinsCost = 0,
    note = ""
  }) {
    const updatedUser = await this.adjustBalance({
      userId,
      nickname,
      pointsDelta: -Number(pointsCost || 0),
      ticketsDelta: -Number(ticketsCost || 0),
      coinsDelta: -Number(coinsCost || 0),
      source: "gift_page",
      note: note || `兌換禮物：${giftName}`,
      actionType: "gift_redeem"
    });

    const redeemRecord = await this.addRedeemHistory({
      userId,
      nickname,
      giftId,
      giftName,
      quantity: 1,
      pointsCost,
      ticketsCost,
      coinsCost,
      note: note || `兌換禮物：${giftName}`
    });

    return {
      ok: true,
      user: updatedUser,
      redeemRecord
    };
    
  },

  async decreaseGiftStock(giftId, quantity = 1) {
    const gift = await this.getGiftById(giftId);

    if (!gift) {
      throw new Error("找不到禮物");
    }

    const nextStock = Number(gift.stock || 0) - Number(quantity || 1);

    if (nextStock < 0) {
      throw new Error("禮物庫存不足");
    }

    const { data, error } = await getSupabaseClient()
      .from(DB.gifts)
      .update({
        stock: nextStock,
        updated_at: new Date().toISOString()
      })
      .eq("id", giftId)
      .select()
      .single();

    if (error) throw error;

    return data;
  }
};

