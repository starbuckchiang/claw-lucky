const DB = {
  users: "users",
  logs: "logs"
};

function getSupabaseClient() {
  if (!window.supabaseClient) {
    throw new Error("Supabase 尚未初始化，請確認 config.js 載入順序");
  }
  return window.supabaseClient;
}

window.Api = {
  async getUser(userId) {
    const supabaseClient = getSupabaseClient();

    const { data, error } = await supabaseClient
      .from(DB.users)
      .select("user_id,nickname,points,tickets")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  async createUserIfNotExists({ userId, nickname = "" }) {
    const supabaseClient = getSupabaseClient();

    const { data, error } = await supabaseClient
      .from(DB.users)
      .upsert(
        {
          user_id: userId,
          nickname,
          points: 0,
          tickets: 0,
          updated_at: new Date().toISOString()
        },
        { onConflict: "user_id" }
      )
      .select("user_id,nickname,points,tickets")
      .single();

    if (error) throw error;
    return data;
  },

  async adjustBalance({
    userId,
    nickname = "",
    pointsDelta = 0,
    ticketsDelta = 0,
    source = "gift_page",
    note = "",
    giftId = "",
    giftName = ""
  }) {
    const supabaseClient = getSupabaseClient();

    const user = await this.getUser(userId);

    if (!user) {
      throw new Error("找不到使用者");
    }

    const nextPoints = Number(user.points || 0) + Number(pointsDelta || 0);
    const nextTickets = Number(user.tickets || 0) + Number(ticketsDelta || 0);

    if (nextPoints < 0) throw new Error("點數不足");
    if (nextTickets < 0) throw new Error("抽獎券不足");

    const { data, error } = await supabaseClient
      .from(DB.users)
      .update({
        nickname: nickname || user.nickname || "",
        points: nextPoints,
        tickets: nextTickets,
        updated_at: new Date().toISOString()
      })
      .eq("user_id", userId)
      .select("user_id,nickname,points,tickets")
      .single();

    if (error) throw error;

    await this.addBalanceLog({
      userId,
      nickname,
      pointsDelta,
      ticketsDelta,
      source,
      note,
      giftId,
      giftName
    });

    return data;
  },

  async addBalanceLog({
    userId,
    nickname = "",
    pointsDelta = 0,
    ticketsDelta = 0,
    source = "",
    note = "",
    giftId = "",
    giftName = ""
  }) {
    const supabaseClient = getSupabaseClient();

    const { error } = await supabaseClient
      .from(DB.Logs)
      .insert({
        user_id: userId,
        nickname,
        points_delta: Number(pointsDelta || 0),
        tickets_delta: Number(ticketsDelta || 0),
        source,
        note,
        gift_id: giftId,
        gift_name: giftName,
        created_at: new Date().toISOString()
      });

    if (error) {
      console.warn("[api debug] balance log failed =", error);
    }
  }
};
